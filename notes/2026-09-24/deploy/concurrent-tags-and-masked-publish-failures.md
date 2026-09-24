# 并发推多个 tag ⇒ 多个 workflow 争抢同一批版本，且旧 `|| echo` 把失败伪装成成功

日期：2026-09-24
涉及：`.github/workflows/publish.yml`、`docs/npm-publish.md`；发布 `connector@0.3.4` /
`key-fallback@3.2.2` / `archived-sessions@0.3.6`

## 背景 / 问题

本轮修复完成后，我一次性创建并推送了三个 tag：

```sh
git tag v0.3.4-dsh-connector v3.2.2-key-fallback v0.3.6-archived-sessions   # 实际是逐条 tag，但一次性 push
git push origin v0.3.4-dsh-connector v3.2.2-key-fallback v0.3.6-archived-sessions
```

三个 workflow run 都报 `conclusion=success`，**步骤级也全是 success**。
但直查 registry 后发现：

| 包 | registry 实际结果 |
|---|---|
| `@omdp/dsh-connector@0.3.4` | ✅ 已发布（`latest=0.3.4`） |
| `@omdp/dsh-archived-sessions@0.3.6` | ✅ 已发布（`latest=0.3.6`） |
| `@omdp/dsh-key-fallback@3.2.2` | ❌ **完全没有发布**（packument 里无 `3.2.2`） |

## 结论 / 根因（两层，都要修）

### 根因 1：`on: push: tags` 是「每个 tag 一个 run」，而每个 run 都遍历全部包

`publish.yml` 的触发是 `on: push: tags: ['v*']`，**job 内固定遍历四个包目录发布**。
推 3 个 tag ⇒ **3 个 run 并发**，每个都去发全部四个包 ⇒ 同一批版本被三个 run 争抢：

- 第一个抢到的报 `+ @omdp/dsh-connector@0.3.4`，提示
  `Your package is being processed and may take a few minutes to become available.`；
- 另外两个撞上重复提交，npm 拒绝：
  - `E409 Cannot publish over previously staged version "0.3.4"`（暂存发布机制）
  - `E403 ... cannot publish over the previously published versions: 0.1.12`

每个 run 里**都有某个包侥幸先成功**，于是三个 run 各成功一部分、各失败一部分，
最终只有 connector 和 archived-sessions 落到了 registry，key-fallback **谁都没发成**
（三方都撞在别人身上）。

### 根因 2（更严重）：`|| echo "skip: version already published"` 把真实失败伪装成成功

旧 workflow 每个包一步，命令是：

```yaml
run: 'npm publish --provenance --access public || echo "skip: version already published"'
```

`||` 的意图是「已发布就跳过、不要卡住别的包」，但它**无法区分**：

- 真正的「已发布」（预期跳过）；与
- 401 未授权 / 403 无权限 / 409 冲突 / 网络失败（**应当报警**）。

结果：key-fallback 明明没发出去，步骤照样 `success`、job 照样 `conclusion=success`——
**绿色勾说谎了**，只能靠直接查 registry 才发现。

## 修复

### 修 workflow：先探测注册表，只吞「已发布」这一种情况

```yaml
- name: Publish packages
  run: |
    set -euo pipefail
    for dir in dsh-connector dsh-vision-bridge dsh-key-fallback dsh-archived-sessions; do
      name=$(node -p "require('./$dir/package.json').name")
      ver=$(node -p "require('./$dir/package.json').version")
      if npm view "$name@$ver" version >/dev/null 2>&1; then
        echo "skip: $name@$ver is already published"
        continue
      fi
      (cd "$dir" && npm publish --provenance --access public)
    done
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

要点：**跳过与否由「注册表里有没有」决定**（主动探测），而不是由 publish 的退出码决定。
于是「已发布」是显式 skip、**其他任何失败都会让 job 红**（`set -e` + 无 `||`）。

### 修流程约定：一次只推一个 tag

因为每个 run 都会遍历全部包，**并发推多个 tag 必然争抢**。约定改为
`git tag v0.3.4-dsh-connector` + 单独 push，完成（或确认已发）后再推下一个。
tag 命名沿用 `<version>-<plugin>`。

## 可复用要点

- ⚠️ **`|| true` / `|| echo "..."` 是 CI 里最危险的惯用法**：它把「预期内的可忽略错误」
  和「真实故障」一并吞掉。要跳过某种预期情况，就**显式探测那个条件**（如先查 registry），
  不要用退出码兜底。
- ⚠️ **绿色 workflow ≠ 制品已交付**。发布类流水线必须**以最终仓库为判据**复核：
  `npm view <pkg>@<ver> version`，或
  `curl https://registry.npmjs.org/<urlencoded-name>/<ver>`。
  本轮的判据还踩了两次小坑：① 本地 npm 指向腾讯镜像（`mirrors.tencent.com`），直查可能滞后/不同步，
  要显式 `--registry https://registry.npmjs.org/` 或直接 curl registry；
  ② 用字符串包含判断「存在」时，`Not found`（真失败）与 `"version not found: 3.2.2"`
  都会命中 `not found` 子串，必须用 `npm view` 的退出码（它本身就是「找不到即非 0」）来判定。
- **tag 触发型 workflow 要按「一次一个 tag」设计**，否则 `push` 多 tag 就是并发的自相残杀。
  更稳的做法是让 workflow 只发布「与该 tag 对应」的那一个包（例如 tag 名里带包名，
  解析后只发该目录）；本仓库暂用「遍历全部 + 已发布跳过」，故流程上限制一次一个 tag。
- **npm 新版「暂存发布」（staged publishing）**：`npm publish` 可能先入暂存队列
  （提示 `being processed and may take a few minutes`）——**版本号立即被占用**
  （重复发同版本 → `E409 Cannot publish over previously staged version`），
  但处理完成前 `npm view` 可能仍 404。**上传成功 ≠ 立刻可安装**：查不到先等几分钟，
  别急着重发（重发反而被 409 拦）。
- **本机 npm 未登录（`ENEEDAUTH`）不影响 CI 发布**：发布走 GitHub Actions + `NPM_TOKEN`
  secret，本机不需要 `npm login`；本机只读探测要加 `--registry`。

## 相关文件

- `.github/workflows/publish.yml`：改为「探测 registry → 跳过已发布 → 其余失败即失败」的单步循环
- `docs/npm-publish.md`：更新流程（一步一个 tag）、注意事项（为何不能用 `|| echo`、
  以 registry 为准复核、staged publishing 语义）
- 根 `README.md`：发布章节的 tag 示例改为 `<version>-<plugin>`
- `docs/plugin-compatibility.md`：总体结论第 6 条（仓库改动不影响在跑的系统 +
  手拷 `node_modules` 会被 `pnpm install` 还原）
