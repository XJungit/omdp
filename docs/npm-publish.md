# 发布到 npm（GitHub Actions 自动发包）

本仓库的两个插件（`@omdp/dsh-connector`、`@omdp/dsh-vision-bridge`）通过
**GitHub Actions 在 push tag 时自动发布到 npm**。本机不需要 npm 登录。

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

到 https://github.com/XJungit/omdp/actions 看运行结果，绿色 = 发布成功。

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
   # 改 dsh-connector/package.json 和 dsh-vision-bridge/package.json 的 version
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

- **版本号**：`dsh-connector/package.json` 和 `dsh-vision-bridge/package.json`
  的 `version` 决定 npm 版本。tag 名（`v0.1.0`）只是触发条件，不影响包版本。
- **tag 名**：必须匹配 `v*`（workflow 触发条件）。
- **重复发布**：npm 不允许同版本号重复发布。升版本再打 tag，或先 `npm unpublish`（慎用）。
- **provenance**：workflow 用了 `--provenance`（npm 来源证明），需要 GitHub 的
  `id-token: write` 权限（已配置）。若你的 npm 账号不支持 provenance，可去掉
  `--provenance` 参数。
- **根 package.json**：仓库根的 `package.json` 是裸镜像（名字是
  `@omdp/dsh-connector`），**不要发布它**——workflow 只在两个子目录里 publish。
