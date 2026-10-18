# 三个 tag 并发发布再次撞车：E409 把一个版本号永久卡死，workflow 改为「按 tag 选包」

日期：2026-10-18
涉及：`.github/workflows/publish.yml`、`docs/npm-publish.md`、`dsh-connector/package.json`
结果：`@omdp/dsh-connector@0.3.9` **未发行**，顺延为 `0.3.10`；
`@omdp/dsh-key-fallback@3.3.3` 与 `@omdp/dsh-archived-sessions@0.3.11` 正常发行。

## 背景 / 问题

本轮完成「三个活跃插件适配 DSH `0.2.1-rc.2` + 归档视觉插件」后，把三个 tag
**一次性**推送（`git push origin` 逐条推，但都在几秒内完成）：

```sh
git tag v0.3.9-dsh-connector v3.3.3-key-fallback v0.3.11-archived-sessions
git push origin v0.3.9-dsh-connector
git push origin v3.3.3-key-fallback
git push origin v0.3.11-archived-sessions
```

`on: push: tags` 是**每个 tag 起一个 run**，于是 3 个 run 并发。事后直查 registry：

| 包 | workflow 结论 | registry 实际结果 |
|---|---|---|
| `@omdp/dsh-key-fallback@3.3.3` | success | ✅ 已发布 |
| `@omdp/dsh-archived-sessions@0.3.11` | success | ✅ 已发布 |
| `@omdp/dsh-connector@0.3.9` | success（run A） | ❌ **404，从未出现** |

两个 run（B、C）红在 `E409`，而唯一「绿」的 run A 里 `0.3.9` 其实也没落地。

## 根因

### 根因 1：并发重叠（与 2026-09-24 事故同型）

旧 workflow 每个 run 都**遍历全部包**去 publish，所以 3 个并发 run 争抢同一批版本。
npm 是**暂存发布**：`npm publish` 一开始上传，版本号就被占用，抢输的一方拿到

```
npm error 409 Conflict - PUT https://registry.npmjs.org/@omdp%2fdsh-connector
npm error Cannot publish over previously staged version "0.3.9".
```

实际上传时间线（三个 run 的日志对齐）：

| 时刻 | run | 事件 |
|---|---|---|
| 10:28:47 | A（`v0.3.9-dsh-connector`） | 启动 |
| 10:28:51 | B（`v3.3.3-key-fallback`） | 启动 |
| 10:28:54 | C（`v0.3.11-archived-sessions`） | 启动 |
| 10:28:58 | A | `+ @omdp/dsh-connector@0.3.9` |
| 10:29:00 | B、C | 同时 `##[group]publish @omdp/dsh-connector@0.3.9` |
| 10:29:24 | B | `E409` → job 红 |
| 10:29:30 / :33 | A | `+ @omdp/dsh-key-fallback@3.3.3` / `+ @omdp/dsh-archived-sessions@0.3.11` |
| — | C | 同样红在 connector 的 `E409` |

⇒ **两个 run 同时撞同一个版本号**，把 `0.3.9` 的暂存条目撞进了死状态：它始终没有被
提升成正式版本。`0.3.9` 至今 404，且 connector 的 packument `modified` 仍停在
`2026-09-29`（从未因这次上传而变动）。

### 根因 2（认知错误）：「先探测 `npm view` 再发」根本挡不住这个竞态

2026-09-24 的修复引入了 `if npm view "$name@$ver" ... then skip`，当时的意图是
「已发布就跳过」。但**同批并发时，对方此刻也还没发布**，探测必然回答「没发过」，
于是三个 run 全部认为该发 —— 探测对这类竞态是**无效**的。

> 教训：消除竞态只能靠消除**重叠**（让并发方各自处理不相交的资源），
> 不能靠「先查一下再动手」。查-改之间的窗口正是竞态本身。

### 与 2026-09-24 事故的关系

`notes/2026-09-24/deploy/concurrent-tags-and-masked-publish-failures.md` 已完整记录同一根因，
且当时就写下了「更稳的做法是让 workflow 只发布与该 tag 对应的那一个包……本仓库暂用
『遍历全部 + 已发布跳过』，故流程上限制一次一个 tag」。

那一轮只落地了**流程约定**（一次只推一个 tag），结构性修复被搁置 —— 于是本轮我一旦违反
约定（一次推 3 个 tag），故障立刻复现，而且比上次更重（上次暂存条目几分钟后自己出现了，
这次没有）。

## 修复

### 让 workflow 只发布「本 tag 所指名的那一个包」

tag 命名本就是 `<version>-<plugin>`，所以它能唯一确定目标包：

```yaml
- name: Publish packages
  run: |
    set -euo pipefail
    tag="${GITHUB_REF_NAME}"
    target=""
    for dir in dsh-connector dsh-key-fallback dsh-archived-sessions; do
      name=$(node -p "require('./$dir/package.json').name")
      ver=$(node -p "require('./$dir/package.json').version")
      short="${name#@omdp/}"   # @omdp/dsh-connector -> dsh-connector
      bare="${short#dsh-}"     # -> connector（历史 tag 两种写法都出现过）
      if [ "$tag" = "v$ver-$short" ] || [ "$tag" = "v$ver-$bare" ]; then
        target="$dir"
        echo "tag $tag -> $dir ($name@$ver)"
      fi
    done
    if [ -z "$target" ]; then
      echo "::error::tag '$tag' 未匹配任何活跃包的 <version>-<plugin>……"
      exit 1
    fi
    # …只对 $target 做「已发布则 skip，否则 publish」
```

三个要点：

1. **`dsh-` 前缀两种写法都接受** —— 历史 tag 里 `v0.3.8-dsh-connector` 带前缀，而
   `v3.3.1-key-fallback` / `v0.3.10-archived-sessions` 不带，命名并不统一。
2. **匹配不上就红**，不再回退成「遍历全部发」：这正是「忘了升 `version` 就打 tag」
   的信号，宁可让 CI 失败，也不要重演「顺手把别的包也发了」。
3. 保留「先探测 registry → 已发布则 skip」，它对付**重跑同一个 tag** 仍然正确
   （幂等），只是别指望它挡并发。

### 版本号顺延

npm 社区对 `E409 Cannot publish over previously staged version` 的常规处置就是
**改用下一个可用版本**（TinyFish 检索到的实现里甚至有「自动重试到下一个空闲版本号，
最多 5 次」的封装）。所以 `dsh-connector` 由 `0.3.9` 顺延为 **`0.3.10`**，
内容一字未改；`v0.3.9-dsh-connector` tag 作废。

## 验证

1. **YAML 合法性**：用 `yaml` 包真实 `parse()` 整个 workflow（不是肉眼看缩进）。
2. **把 run 块原样导出成 `.sh`，用桩 `npm` 逐 tag 试跑**（不联网、不发布）：

   | tag | 结果 |
   |---|---|
   | `v0.3.10-dsh-connector` / `v0.3.10-connector` | → `dsh-connector` ✅ |
   | `v3.3.3-key-fallback` / `v3.3.3-dsh-key-fallback` | → `dsh-key-fallback` ✅ |
   | `v0.3.11-archived-sessions` / `v0.3.11-dsh-archived-sessions` | → `dsh-archived-sessions` ✅ |
   | `v0.3.9-dsh-connector`（版本已顺延） | ⛔ 红（正确：tag 与 `package.json` 不一致） |
   | `v0.3.11-connector`（配错包名） | ⛔ 红 |
   | `v1.0.0-nonsense` | ⛔ 红 |

   另用「`npm view` 返回 0」的桩确认 skip 分支打印 `skip: …` 且 `exit=0`（幂等）。
3. **双向装配证据**（真机 `0.2.1-rc.2` CLI + 隔离 `DSH_HOME`）：
   - 放行侧：三个插件全部进树，`--dump-config` 退出 0、1244 行、门禁关键字 0 命中；
   - 反证侧：把 peer 改回旧声明后立刻 `skipping profile bundle … @0.3.10 is incompatible`。
4. **发布后以 registry 为准复核**（不用 `npm view`）：`/pkg/version` 直连 API。

## 可复用要点

- ⚠️ **`on: push: tags` 的 workflow 必须按「一个 run 只处理一个 tag 对应资源」设计**。
  「遍历全部 + 已发布跳过」在有并发时必然争抢，且**探测解决不了**。
- ⚠️ **「先查再改」不是同步原语**。查-改窗口就是竞态窗口；能消除重叠就不要靠检查。
- ⚠️ **流程约定是临时措施，不是修复**。2026-09-24 已经识别出结构性方案却只落了约定，
  两个月后同一故障复现且更重。识别出「更稳的做法」时，要么当场做，要么在文档里
  把它标成**未偿技术债**。
- 🔴 **npm 暂存发布的版本号会被永久的卡死**：`E409 Cannot publish over previously
  staged version` 之后，暂存条目**不保证会被提升**（2026-10-18 实测一直没有）。
  多次重跑只会复现同一个 409 ⇒ 别重试，直接顺延 patch 版本号。
  （对比 2026-09-24：那次暂存条目几分钟后自己出现了，所以「等几分钟」不总是够。）
- **绿色 workflow ≠ 制品已交付**。本轮的 run A 是 `success`，但它名下那个包根本没落地；
  唯一可信判据是直连 registry API 查 `/pkg/version`。
- **验证 workflow 改动不要只靠读**：YAML `parse()` + 把 run 块导出成真脚本用桩命令跑，
  能在一次 push 之前把全部分支（命中/skip/不命中）走一遍。

## 相关文件

- `.github/workflows/publish.yml`：改为按 tag 选包；匹配不上直接失败
- `dsh-connector/package.json`：`0.3.9` → `0.3.10`（内容不变）
- `docs/npm-publish.md`：发布流程、tag 约定、「一次一个 tag」约定的取消、
  暂存发布可能永不提升
- `README.md`（根）：中英文发布章节
- `dsh-connector/README.md`：变更记录补 0.3.10 与 0.3.9 未发行的说明
- `notes/2026-09-24/deploy/concurrent-tags-and-masked-publish-failures.md`：加复发交叉引用
- `notes/2026-10-18/dsh-compat/0.2.1-rc.2-跨三元组核查-四层证据.md`：反事实引用改用 0.3.10
