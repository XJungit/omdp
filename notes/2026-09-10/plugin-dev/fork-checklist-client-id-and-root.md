# fork 一个 DSH 插件后必须过一遍的检查清单（archived-sessions 0.3.2 的教训）

## 背景

`@omdp/dsh-archived-sessions` 0.3.0/0.3.1 发布后复查，又发现**两处 fork 时漏改的遗留**——
说明只改 `package.json` 的包名远远不够。

## 这次踩到（0.3.2 修）

| # | 遗留 | 后果 | 修法 |
|---|---|---|---|
| 1 | `lib/client.js` 的 `window.__ModuleLoader__.load({ id: "@muwinds/dsh-archived-sessions" })` 没跟着包名改 | 浏览器端按 `@omdp/dsh-archived-sessions` 找模块，id 不匹配 → client 半区不渲染（**设置页里根本没有这个 tab**），host 半区却正常——极易被误判成"插件已工作" | 改成 `@omdp/dsh-archived-sessions`。对照活模板：connector 的 client.js 用 `id: '@omdp/dsh-connector'`（与包名一致） |
| 2 | `CANDIDATE_ROOTS = ["C:\\Users\\xj\\.dsh\\sessions"]` 硬编码本机路径 | 换机器/换 DSH_HOME 就找不到任何会话目录（列表全"文件缺失"、删除退化为只清归档标记） | 改为运行时推导：`<DSH_HOME>/sessions`，缺省 `~/.dsh/sessions` |

## 关键事实：sessionPersistence 服务不暴露 root

用 `cordis_inspect_query`（host / Service / listService，service=sessionPersistence）查到的公开面只有
`create` / `open` / `flush` / `stat` / `list` —— **没有 root、没有 config**。
所以想拿会话根目录只能靠环境（`DSH_HOME`，DSH 会给每个插件进程注入；缺省 `~/.dsh`）或
可选 import `@deepseek-ai/dsh-session-persistence-jsonl` 的后端函数自己拼。

## forkl 检查清单（可复用）

1. `grep -ri <旧包名/作者名>` 全量扫：`package.json`、`lib/*.js`、`README*`、`cordis.patch.yml`。
   注释里保留出处可以，**代码里的标识符必须全换**。
2. **模块 id**：client 半区 `__ModuleLoader__.load({ id })` 必须等于新包名。
3. **绝对路径/用户名/盘符**：`grep -n "C:\\\\|/Users/"` 扫一遍，任何本机路径都要改成运行时推导。
4. **路由/存储键前缀**：本次是 `/dsh-archived/*`（保持不动没问题，但要确认 host 与 client 两端一致）。
5. **slot id / order**：与宿主既有 slot 冲突检查（本次 `settings.section` + `order: 30`）。
6. **peer 声明**：只列实测版本；profile 未直装的包不要硬声明（用可选 `import()` + 内置 fallback）。
7. **发布前**：从 git 内容（不是本地目录）检出后 `npm pack` + `tar -tzf` 核对文件清单。
8. **装机验证**：`node -e "import('<pkg>')"` 能 `LOAD OK`（host 半区）；client 半区在 Node 里报
   `window is not defined` 属正常（浏览器代码）。

## 相关

- 事故笔记：`notes/2026-09-10/deploy/archived-sessions-0.3.0-empty-tarball.md`（空包事故）
- 版本：0.3.2（2026-09-10）
