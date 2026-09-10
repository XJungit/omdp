# archived-sessions 0.3.0 空包事故：`.gitignore` 的 `**/lib/` 吞掉 fork 源码

## 背景（用户报障）

`@omdp/dsh-archived-sessions@0.3.0` 发布后安装即崩 DSH。用户直查 npm tarball：
**只有 4 个文件（LICENSE / README.md / cordis.patch.yml / package.json），没有 `lib/`**——
而 `package.json` 的 `main` 指向 `lib/index.js`。插件加载失败 → DSH 启动被拖垮。

## 根因链（完整证据）

```
.gitignore:7  **/lib/                 ← 仓库把 lib/ 当构建产物全局忽略
   ↓
git add -A 静默跳过 dsh-archived-sessions/lib/index.js + client.js
   ↓
提交 3c650bc 只含 4 个文件（git ls-files 证实；check-ignore -v 直接命中该规则）
   ↓
CI checkout 该 tag → 工作树里根本没有 lib/ → npm pack 自然只有 4 个文件
   ↓
npm publish 成功、provenance 正常 → 看起来"发布成功"，实际是空壳包
```

关键点：**CI 日志一切正常**（tarball 4 文件、`+ @omdp/dsh-archived-sessions@0.3.0`、sigstore 签名齐全），
错误不在发布环节，而在**源码从未进 git**。本地 `npm pack` 演练时文件是齐的（6 个），
因为本地磁盘上有 lib/——**本地演练不能替代「从 git 内容打包」的验证**。

为什么 key-fallback 用同样的 `lib/` 布局却没事？它的 `lib/*.js` 在 `.gitignore` 规则生效之前
就已被跟踪——**git 忽略规则对已跟踪文件无效**，所以历史条目幸免，新目录必踩。

## 修复

1. `.gitignore` 加例外（**两行缺一不可**，git 无法重新包含仍被忽略目录下的文件）：
   ```gitignore
   !dsh-archived-sessions/lib/
   !dsh-archived-sessions/lib/**
   ```
   `check-ignore` 复验不再命中，`git status` 出现 `?? dsh-archived-sessions/lib/`。
2. 版本 bump `0.3.0 → 0.3.1`（0.3.0 已被污染，不可重发同名版本）。
3. 文档同步：包 README 变更记录（中英）、根 README 版本号、`docs/plugin-compatibility.md` §5 风险点 + 汇总表。
4. **发布前验证**（把这一步固化进流程）：先按 git 内容检出到临时目录再 `npm pack`，
   `tar -tzf` 核对文件清单必须含 `package/lib/index.js`。

## 可复用要点（发布前 checklist）

- **发布前必须验证 tarball 内容**，且验证对象是**从 git 提交内容导出**的副本，不是本地工作目录：
  `git worktree add <tmp> <ref> && (cd <tmp>/<subdir> && npm pack) && tar -tzf <tgz>`。
- 新增包里凡是 `main`/`exports` 指向的目录，先 `git check-ignore -v <path>` 确认没被忽略；
  被忽略就加 `!path/` + `!path/**` 两行例外。
- `git add -A` 对忽略文件是静默跳过（无任何警告）——提交后必须 `git ls-files <pkg>/` 核对文件数。
- 症状对照：包"安装即崩"且 npm 上体积异常小（本次 4.9 kB）→ 先怀疑 tarball 缺源码。
- 发布成功 ≠ 可用：`npm publish` 成功只证明打包+上传成功，**不证明包含预期文件**。

## 相关文件

- `.gitignore`（新增 3 行例外 + 注释）
- `dsh-archived-sessions/package.json`（0.3.1）、`dsh-archived-sessions/README.md`
- 根 `README.md`、`docs/plugin-compatibility.md`（§5 风险点记录了本次事故）
