# 发布到 npm（GitHub Actions 自动发包）

本仓库的活动插件（`@omdp/dsh-connector`、`@omdp/dsh-vision-bridge`、
`@omdp/dsh-key-fallback`）通过 **GitHub Actions 在 push tag 时自动发布到 npm**。
`@omdp/dsh-gitbash-win` 与 `@omdp/dsh-resume-stream` 已归档，不再由本仓库维护或发布。
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

### 4. 首次发布：打 tag 触发 workflow

在 omdp 仓库根目录（或 GitHub 网页）打一个版本 tag：

```sh
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions 自动执行 `publish.yml`：
- `dsh-connector/` → `npm publish` → `@omdp/dsh-connector@0.1.0`
- `dsh-vision-bridge/` → `npm publish` → `@omdp/dsh-vision-bridge@0.1.0`

> `dsh-gitbash-win/` 与 `dsh-resume-stream/` 的发布步骤已随归档移除，不再由本仓库发布。

到 https://github.com/XJungit/omdp/actions 看运行结果，绿色 = 发布成功。

---

## 为什么单仓库 + GitHub 安装会出问题（务必读）

本仓库把三个包放在**同一个仓库**（`XJungit/omdp`）的不同子目录里。如果你
**不用 npm 发布，而是从 GitHub 远程安装**，命令长这样：

```sh
# 必须用 #path: 指定子目录（因为 3 个包在同一个仓库）
dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector
dsh plugin --profile web add github:XJungit/omdp#path:dsh-vision-bridge
# （dsh-gitbash-win 已归档，不再提供远程安装命令）
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
  "@omdp/dsh-connector": "^0.1.0",
  "@omdp/dsh-vision-bridge": "^0.1.0"
}
```

然后：

```sh
cd ~/.dsh/profiles/web
pnpm install
```

**为什么这更好**：
- npm 依赖是**普通依赖**，pnpm 不会做 git `#path:` 规范化——彻底告别"串包/嵌套"问题
- 更新 = `pnpm update @omdp/dsh-connector @omdp/dsh-vision-bridge`（标准 npm 语义）
- **不再需要 update-omdp.ps1 脚本**（它是为 git 安装的 #path: 自愈设计的）
- 不再有 `ERR_PNPM_IGNORED_BUILDS`（npm 装的是已打包产物，无 build 脚本）
- `allowBuilds` 也不用配了

### 更新流程（之后每次）

1. 改代码 → 提交推送到 GitHub
2. 升版本 + 打 tag：
   ```sh
   # 改各子目录 package.json 的 version（三个包一起升）
   git add -A && git commit -m "release v0.1.1"
   git tag v0.1.1
   git push origin master && git push origin v0.1.1
   ```
3. Actions 自动发新版本
4. 本机更新：
   ```sh
   cd ~/.dsh/profiles/web
   pnpm update @omdp/dsh-connector @omdp/dsh-vision-bridge
   ```

---

## 注意事项

- **版本号**：三个子目录的 `package.json` 的 `version` 决定 npm 版本。tag 名
  （`v0.1.0`）只是触发条件，不影响包版本。三个包通常一起升（workflow 每次
  都发全部三个，已存在的版本会被容错跳过）。
- **tag 名**：必须匹配 `v*`（workflow 触发条件）。
- **重复发布**：npm 不允许同版本号重复发布。workflow 已加
  `|| echo "skip: version already published"` 容错，但**正式发布时仍建议三个
  包版本同步升**，避免某个包漏发。
- **provenance**：workflow 用了 `--provenance`（npm 来源证明），需要 GitHub 的
  `id-token: write` 权限（已配置）。若你的 npm 账号不支持 provenance，可去掉
  `--provenance` 参数。
- **根 package.json**：仓库根的 `package.json` 是裸镜像（名字是
  `@omdp/dsh-connector`），**不要发布它**——workflow 只在三个子目录里 publish。
