# 发布到 npm（GitHub Actions 自动发包）

本仓库的活动插件（`@omdp/dsh-connector`、`@omdp/dsh-key-fallback`、
`@omdp/dsh-archived-sessions`）通过 **GitHub Actions 在 push tag
时自动发布到 npm**。
`@omdp/dsh-gitbash-win`、`@omdp/dsh-resume-stream` 与 `@omdp/dsh-vision-bridge`
（**2026-10-18 归档**）已归档，不再由本仓库维护或发布。
本机不需要 npm 登录。

---

## 一次性配置（只需做一次）

### 1. 注册 npm 账号

到 https://www.npmjs.com/signup 注册（免费）。记下用户名，包将归属这个账号。

### 2. 生成 npm Automation token

1. 打开 https://www.npmjs.com/settings/<你的用户名>/tokens
2. **Generate New Token** → 类型选 **Automation**（CI 专用，不能手动登录，正好适合 Actions）
3. 复制生成的 token（`npm_xxxxxxxx...`）

> 注意：**Granular Access Token** 也可以，但必须勾选对 `@omdp/*` 两个包的
> **Read and write** 权限。Automation token 最简单（默认对账号下所有包可写）。

### 3. 把 token 加到 GitHub Secrets

1. 打开 https://github.com/XJungit/omdp/settings/secrets/actions
2. **New repository secret**
   - Name: `NPM_TOKEN`
   - Secret: 粘贴刚生成的 token
3. 保存

### 4. 发布：打 tag 触发 workflow

tag 必须写成 **`v<version>-<plugin>`**，且 version 要与该子目录 `package.json` 里的
`version` 一致 —— workflow 就是用它来决定发哪个包的：

```sh
git tag v0.3.10-dsh-connector
git push origin v0.3.10-dsh-connector
```

GitHub Actions 自动执行 `publish.yml`，**只发布这个 tag 指名的那个包**（该版本已在
registry 上则打印 skip 后成功退出）：
- `v<version>-dsh-connector`（也接受 `v<version>-connector`）→ `@omdp/dsh-connector`
- `v<version>-key-fallback`（也接受 `v<version>-dsh-key-fallback`）→ `@omdp/dsh-key-fallback`
- `v<version>-archived-sessions`（也接受 `v<version>-dsh-archived-sessions`）→ `@omdp/dsh-archived-sessions`

tag 匹配不上任何活跃包（例如忘了先升 `version` 就打 tag）⇒ **job 直接失败**，
不会误发别的包。

> `dsh-gitbash-win/`、`dsh-resume-stream/` 与 `dsh-vision-bridge/`（2026-10-18 归档）
> 的发布步骤已随归档移除，不再由本仓库发布。

到 https://github.com/XJungit/omdp/actions 看运行结果，绿色 = 发布成功。
⚠️ **但绿色不等于真的发出去了**——务必再用 registry 复核（见下方「注意事项」）。

---

## 为什么单仓库 + GitHub 安装会出问题（务必读）

本仓库把三个包放在**同一个仓库**（`XJungit/omdp`）的不同子目录里。如果你
**不用 npm 发布，而是从 GitHub 远程安装**，命令长这样：

```sh
# 必须用 #path: 指定子目录（因为 3 个包在同一个仓库）
dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector
dsh plugin --profile web add github:XJungit/omdp#path:dsh-key-fallback
# （dsh-gitbash-win / dsh-vision-bridge 已归档，不再提供远程安装命令）
```

**这不是简单的"命令长一点"——它埋着三个致命坑：**

### 坑 1：`#path:` 被 pnpm 规范化丢弃（最致命）

pnpm 的依赖解析器对 `github:...#path:xxx` 会做**规范化/重写**。实测：
`pnpm update` 会把 `github:XJungit/omdp#path:dsh-connector` **规范化成
`github:XJungit/omdp`**（丢掉 `#path:` 部分）。

结果：
- `@omdp/dsh-connector` 和 `@omdp/dsh-vision-bridge` **都解析到仓库根**
- 仓库根的 package.json 是 `@omdp/dsh-connector`（bare mirror）
- → **两个包都装成 connector 的代码**（交叉解析）
- 表现：vision-bridge 里是 connector 的逻辑、ID 错误、嵌套、崩溃

**这是本仓库曾经遇到的核心问题**，也是你迁移到 npm 的根本原因。

### 坑 2：pnpm 嵌套 + 依赖提升

单仓库的 `#path:` 安装还会触发 pnpm 的**嵌套依赖**行为：子目录的
package.json 依赖可能被提升/嵌套到奇怪的位置，导致 `require` 解析失败、
`Cannot find module`、`ERR_MODULE_NOT_FOUND`。

### 坑 3：scoped 包 + git 源版本不稳定

`@omdp/*` 是 scoped 包。从 git 源安装时：
- 版本号解析成 **git commit hash**（不是 semver）→ `pnpm update` 行为不可预测
- `@omdp/dsh-connector` 这种 scope 名 + git 源，npm/pnpm 的处理规则特殊

### 对比：为什么 npm 安装就没事

| | GitHub 安装（单仓库） | NPM 安装（现在） |
|---|---|---|
| 命令 | `github:XJungit/omdp#path:dsh-connector`（长、易错） | `@omdp/dsh-connector`（简洁） |
| `#path:` 规范化 | ❌ 会被 pnpm 丢弃 → 交叉解析 | ✅ 无此问题 |
| 子目录定位 | 靠 `#path:`（脆弱） | 包本身就是一个 unit |
| 版本 | git hash（不稳定） | semver（稳定） |
| 多包同仓库 | ❌ 容易串 | ✅ 每个包独立 |

**结论**：**单仓库 + `#path:` + GitHub = 天然脆弱**。npm 发布让每个包成为
独立 unit，彻底绕开 `#path:` 问题。**这是本仓库采用 npm 发布的根本原因。**

### 什么时候 GitHub 安装才安全？

只有**每个包单独一个仓库**（无 `#path:`）才适合 GitHub 安装：
```sh
dsh plugin add github:XJungit/dsh-connector      # 单独仓库，无 #path:
```
但本仓库是单仓库，所以 **GitHub 安装注定要 `#path:`、注定脆弱**——保持 npm 发布。

---

## 发布后的安装方式（彻底摆脱 git `#path:` 问题）

发布成功后，profile 里的依赖从 git 换成 npm：

```jsonc
// ~/.dsh/profiles/web/package.json
"dependencies": {
  "@omdp/dsh-connector": "^0.3.10",
  "@omdp/dsh-key-fallback": "^3.3.3",
  "@omdp/dsh-archived-sessions": "^0.3.11"
}
```

然后：

```sh
cd ~/.dsh/profiles/web
pnpm install
```

**为什么这更好**：
- npm 依赖是**普通依赖**，pnpm 不会做 git `#path:` 规范化——彻底告别"串包/嵌套"问题
- 更新 = `pnpm update @omdp/dsh-connector @omdp/dsh-key-fallback @omdp/dsh-archived-sessions`（标准 npm 语义）
- **不再需要 update-omdp.ps1 脚本**（它是为 git 安装的 #path: 自愈设计的）
- 不再有 `ERR_PNPM_IGNORED_BUILDS`（npm 装的是已打包产物，无 build 脚本）
- `allowBuilds` 也不用配了

### 更新流程（之后每次）

1. 改代码 → 提交推送到 GitHub
2. 升版本（**只升你动过的包**）+ 打 tag，tag 格式 `<version>-<plugin>`（tag 里的
   version 必须与 `package.json` 一致）：
   ```sh
   # 改对应子目录 package.json 的 version，再打同名 tag
   git add -A && git commit -m "release ..."
   git tag v0.3.10-dsh-connector
   git push origin master && git push origin v0.3.10-dsh-connector
   ```
3. Actions **只发这个 tag 指名的包**（已存在则 skip 后成功退出）
4. 本机更新：
   ```sh
   cd ~/.dsh/profiles/web
   pnpm update @omdp/dsh-connector
   ```

> ✅ **2026-10-18 起，一次推多个 tag 也安全了** —— 因为每个 run 只碰自己那个包，
> 重叠为零。（旧 workflow 每个 run 都遍历全部包，并发时争抢同一批版本 ⇒
> `E409 Cannot publish over previously staged version` ⇒「看起来都成功、实际各漏一部分」；
> 2026-09-24 与 2026-10-18 两次事故同一成因。）
>
> ⚠️ 顺带纠正一个直觉错误：**「先探测 `npm view` 再发」挡不住这个竞态** ——
> 同批并发时对方此刻也还没发布，探测必然回答「没发过」。消除竞态只能靠消除**重叠**
> （按 tag 选包），不能靠探测。

---

## 注意事项

- **版本号**：各子目录的 `package.json` 的 `version` 决定 npm 版本。tag 名不再只是触发
  条件 —— workflow 用它**选包**，所以 tag 里的 version 必须与 `package.json` 一致
  （不一致 ⇒ 匹配失败 ⇒ job 红）。另外**一个版本号一旦被 npm 暂存占用就不能再用**，
  只能顺延到下一个 patch（见下方「暂存发布」）。
- **tag 名**：必须匹配 `v*`（workflow 触发条件），并写成 `<version>-<plugin>`
  （如 `v0.3.10-dsh-connector`、`v3.3.3-key-fallback`、`v0.3.11-archived-sessions`）；
  插件名带不带 `dsh-` 前缀都接受（历史 tag 两种写法都出现过）。
- **重复发布与真实失败必须区分开**：workflow 现在先 `npm view "$name@$ver"` 探测，
  只有「确实已发布」才跳过；**任何其他失败都会让 job 明确失败**。
  > 历史教训：旧写法是 `npm publish ... || echo "skip: version already published"`，
  > 它把**真实失败**（401/403/409）也伪装成 success——2026-09-24 三个 tag 并发导致
  > `@omdp/dsh-key-fallback@3.2.2` 实际没发出去，而 workflow 全部报
  > `conclusion=success`，只能靠直接查 registry 才发现。
  > **判定「发出去了没有」永远以 registry 为准**（`npm view <pkg>@<ver> version` 或
  > `curl https://registry.npmjs.org/<urlencoded-name>/<ver>`），不要相信 job 的绿色勾。
- **provenance**：workflow 用了 `--provenance`（npm 来源证明），需要 GitHub 的
  `id-token: write` 权限（已配置）。若你的 npm 账号不支持 provenance，可去掉
  `--provenance` 参数。
- **根 package.json**：仓库根的 `package.json` 是裸镜像（名字是
  `@omdp/dsh-connector`），**不要发布它**——workflow 只在三个子目录里 publish。
- **npm 新版是「暂存发布」（staged publishing）**：`npm publish` 可能先把 tarball 放进
  暂存队列并提示 `Your package is being processed and may take a few minutes to become
  available`，**版本号会被立即占用**（此时重复发布同一版本会报
  `E409 Cannot publish over previously staged version`），但在审核/处理完成前
  `npm view <pkg>@<ver>` 仍可能 404。所以**上传成功 ≠ 立刻可安装**，查不到时先等几分钟
  再重查，别急着重复发（重复发反而会被 409 拦下）。
  ⏳ **提升延迟可能远超「几分钟」**（2026-10-18 实测）：`@omdp/dsh-connector@0.3.9` 的暂存
  条目被两个并发 run 同时撞击后，直到**上传后约 8 分钟**（10:28:58 → 10:37:09）才被提升发布。
  这期间 `npm view` 一直 404、packument 的 `modified` 纹丝不动、重跑仍报 `E409`，
  **看起来非常像「这个版本号废了」，其实没有**。
  ⇒ `E409 Cannot publish over previously staged version` 的含义是「有人正在处理，别挤」，
  **不是**「坏了」。补救顺序：**先等**（≥15 分钟、间隔多次复查 registry），
  确认长时间仍未提升才顺延到下一个 patch 版本号。
  事故复盘（含一次据此下错结论的经过）见 `notes/2026-10-18/deploy/`。
- 🔴 **`npm view` 会吃本地缓存，复核请直连 registry API**（2026-10-01 实测）：
  `@omdp/dsh-archived-sessions@0.3.10` 已在 `08:38:44` 由 CI 成功发布（日志有
  `+ @omdp/dsh-archived-sessions@0.3.10` + 签名 provenance），且 registry 记录的
  `time["0.3.10"] = 08:41:54`；但本地 `npm view '@omdp/dsh-archived-sessions@0.3.10' version`
  **连续 8 次（约 3 分钟）仍报 E404**，因为 `npm view` 读的是本地 packument 缓存。
  直连 API 立刻拿到正确结果：

  ```sh
  curl -s https://registry.npmjs.org/@omdp%2Fdsh-archived-sessions \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j['dist-tags'],Object.keys(j.versions))})"
  ```

  注意名称里的 `/` 要编码成 `%2F`；`/pkg/version` 路径对 scoped 包**不能**直接拼。
  **结论：复核以 registry API 为准**（`npm view` 只作辅助，遇到 404 先怀疑缓存）。
  另外 registry 返回的 `dist.integrity` 可与本地 `npm pack` 产物比对，用于确认发出的
  确实是你验证过的那份 tarball。
