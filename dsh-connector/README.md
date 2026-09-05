# @omdp/dsh-connector

**MCP 服务器 + 用户 Skills + 魔搭市场浏览三合一设置页**（`v0.3.0`）。适合需要在 DSH 里频繁增删改 MCP server / skills、又不想手改 `cordis.patch.yml` 的用户。

## Requirements

- DeepSeek Harness 带 `web` profile GUI（`npx @deepseek-ai/dsh web`）
- Node.js `^22.19` 或 `>=24`
- `@deepseek-ai/cordis` `4.0.1` / `4.0.2`（已实测版本；插件无 peer 声明，唯一 DSH 硬依赖是 `ctx.webServer`）

## Overview

把 **MCP 服务器**、**用户 Skills** 的管理和 **魔搭（ModelScope）市场浏览**
合并到 DSH Web UI 的同一个设置页（设置页标签：**Connector**）。

- **MCP**：读取/编辑 `profiles/web/cordis.patch.yml` 中的 `mcp-*` 块（结构化表单）。保存后**重启 `dsh` 生效**。
- **工具过滤（0.3.0 新增）**：每台 MCP server 卡片下可勾选放行的工具（`mcp__<server>__<raw>` 公开名按 `__` 切分回 raw 名）。规则存 `settings.yaml` 的 `connector.toolFilters`（`{<serverName>: {allow: [...]}}`），**无配置 = 全量放行**；保存后新会话即生效、无需重启。生效三件套：`systemPrompt.tools(provider)` 隐藏 schema + `ctx.tools.guard` 执行期硬拦截（做法参照 `hyqhyq3/dsh-mcp-manager`）。典型场景：tinyfish 这类 15 个工具只留 `search`/`fetch_content` 两个免费工具。
- **Skills**：列出/查看/编辑/删除 `~/.dsh/skills` 下的 `SKILL.md`。保存**即时生效**（filesystem provider 自动重新发现）。
- **市场探索（0.2.0 新增）**：只读浏览魔搭社区 [Skills 中心](https://modelscope.cn/skills) 与 [MCP 广场](https://modelscope.cn/mcp)（匿名 OpenAPI，无需密钥）。
  - 列表/详情：名称、作者、分类、下载/浏览数、认证标识（Hosted 官方托管 / 已认证）
  - **一键复制** skill 安装命令（`npx / curl / modelscope` 三种）与 MCP 配置片段（`server_config` 的 `mcpServers` JSON）
  - **Skill 更新提示**：把本地 skill 关联市场条目（写入 frontmatter 的 `source`/`sourceUpdated`）后，「检查更新」比对市场 `file_last_modified` 标出"有更新/最新"
  - **零落盘**：市场数据只存在 DSH 进程内存（30 分钟 TTL 缓存），重启即清，从不写文件
  - MCP 为部署模式、无版本概念，不提供更新提示（仅浏览与复制配置）

设计上复用官方两款参考插件的方式：
- 设置页槽位注册方式参照 [`dsh-mcp-manager`](https://github.com/hyqhyq3/dsh-mcp-manager)（`settings.section` + Package 私有 HTTP API）。
- Skills 的 frontmatter 解析/序列化参照 [`dsh-skill-manager`](https://github.com/bitterSmilezzz/dsh-skill-manager)。

## Quick start

```sh
# 1. 安装（npm）
cd ~/.dsh/profiles/web
pnpm add @omdp/dsh-connector

# 2. 确认 bundle 挂载
node "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --dump-config | grep connector

# 3. 重启 dsh
# 4. 打开 Web UI → 设置 → Connector，即可看到 MCP 服务器和 Skills 两个区
```

最小可复现：安装后打开设置页 → Connector → 在 MCP 区点「＋添加」→ 填一个
stdio server（如 `cmd /c npx -y @upstash/context7-mcp`）→ 保存 → 重启 dsh → 该
MCP server 可用。

### SSE(MCP over SSE) 如何处理

本插件**不**内置 SSE 桥接。需要连接走 legacy SSE 协议的 MCP 服务器（如知乎搜索 / 全网搜索）时，仍在 `cordis.patch.yml` 里用 [`mcp-remote`](https://github.com/geelen/mcp-remote) 把 SSE 转成 stdio，本插件只是把它作为一条普通 mcp-remote 配置来可视化编辑。这样避免重造进程管理逻辑——连接本身交给成熟的 mcp-remote。

## 安装

**推荐：本地 `link:` 安装**（避免从 GitHub 直接拉取的网络/TLS 问题）。在
`profiles/web/package.json` 的 `dependencies` 里加入（或直接编辑）：

```json
"@omdp/dsh-connector": "link:D:/WorkSpace/omdp/dsh-connector"
```

然后在该 profile 下重建 lockfile 并建立 junction（`dsh plugin add` 底层就是 pnpm，
等价于）：

```sh
cd ~/.dsh/profiles/web
pnpm install --lockfile-only --offline   # 按 link 依赖重写 lockfile
```

> `pnpm install` 会为 `link:` 依赖建立 `node_modules/@omdp/dsh-connector` junction
> 指向 `D:/WorkSpace/omdp/dsh-connector`，插件源码即仓库源码，**改仓库 → 重启 dsh 即生效**。

确保 `dsh.profile.bundles` 里包含 `"@omdp/dsh-connector"`（包内声明了
`dsh.bundle.patch`，激活行自动生效，无需手动改 `cordis.patch.yml`）。

> 安装前请先**备份** `profiles/web/cordis.patch.yml`。本插件会改写其中的 MCP 块。

### 方式一（推荐）：从 npm 安装

插件已发布到 npm（GitHub Actions 自动发包，见仓库根 `docs/npm-publish.md`）。
在 profile 的 `package.json` 加入依赖后 `pnpm install`：

```jsonc
"dependencies": {
  "@omdp/dsh-connector": "^0.3.0"
}
```

```sh
cd ~/.dsh/profiles/web
pnpm install
```

更新：`pnpm update @omdp/dsh-connector`（标准 npm 语义，无 git `#path:` 问题）。

### 备选：从 GitHub 远程安装

不想本地 checkout 时，可直接从仓库装（`#path:` 指向子目录）：

```sh
dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector
```

> **安装命令前提**：上面的 `dsh plugin add` 需要 `dsh` 已在 PATH。若你是按官方文档用 `npx` 运行 dsh（没有全局 `dsh` 命令），上面这行会报 `command not found: dsh` —— 改用等价命令：
> `npx @deepseek-ai/dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector`（不要求 `dsh` 在 PATH）。

pnpm ≥10 默认拒绝运行 git 依赖的构建脚本，首次 `add` 会失败，需在
`profiles/web/pnpm-workspace.yaml` 加白名单后重试：

```yaml
allowBuilds:
  '@omdp/dsh-connector': true
```

（本插件是纯 JS 零构建，白名单是唯一门槛，无需 `prepare` 脚本。详见官方
[publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。）

## 更新

本地 link 模式下**没有"拉取"这一步**：直接 `git pull` 或编辑 `D:/WorkSpace/omdp`，
然后**重启 `dsh --profile web`** 加载新代码（运行中的进程仍用旧代码）。

## 卸载

```sh
# 1. 从依赖移除
cd ~/.dsh/profiles/web
pnpm remove @omdp/dsh-connector

# 2. 从 bundles 移除（pnpm remove 会重写 package.json，若 bundles 里还有则手动删）
#    编辑 profiles/web/package.json，从 dsh.profile.bundles 删掉 "@omdp/dsh-connector"

# 3. （可选）还原被插件改写的 MCP 块
#    插件改写过 cordis.patch.yml 里的 mcp-* 块；若想彻底还原，从备份恢复或手动编辑
```

**禁用（临时）**：在 `cordis.patch.yml` 加一行 `- id: connector\n  disabled: true`
（或从 bundles 移除后重启），无需删除包。

## 使用

打开 Web UI 的 **设置 → Connector**：

1. **MCP 服务器** 区：
   - 列出当前 `cordis.patch.yml` 里的 `mcp-*` 服务器
   - 「编辑」改名称/传输/URL/命令/参数/Header；「删除」移除；「＋ 添加」新建
   - 每台 server 卡片下有**工具过滤**多选（chips）：勾选即放行，未勾选的工具模型不可见、调用被拒；「清除」回到全量放行
   - 保存后提示**重启 dsh** 才会真正加载新的 MCP server（工具过滤规则除外：存 settings，**新会话即生效**）
2. **Skills** 区：
   - 列出 `~/.dsh/skills` 下的用户技能
   - 「编辑」改 frontmatter 与正文；「删除」移除目录；「＋ 新建」创建
   - 「检查更新」：对已关联市场来源的 skill 比对魔搭更新时间，显示"有更新/最新"徽标
3. **市场探索** 区：
   - MCP 市场：输入关键词搜索魔搭 MCP 广场；条目显示作者/浏览数与"已配置"徽标；展开详情看
     Hosted / 认证 / 环境变量 / 配置变体，**「复制配置」** 一键复制 `mcpServers` JSON 片段
   - Skills 市场：搜索魔搭技能中心；展开详情看三条安装命令（逐个**复制**，自行执行），
     「记录来源」把本地技能关联到该市场条目（写 frontmatter `source`/`sourceUpdated`）
   - 全部数据经 host 30 分钟内存缓存代理，仅本机内存，不写盘

## 工作原理

| 组成 | 机制 |
|---|---|
| 设置页 | client half 注册 `settings.section` 槽位（"Connector" 页签；client factory 须 `exports.inject = ['slots']`，否则 fiber 在 slots 就绪前跑 apply 会静默丢注册） |
| 跨边界调用 | client 用 `fetch('/connector/api/...')`，host 用 `ctx.webServer.register` 接收（安装包走 HTTP） |
| MCP 持久化 | 文本块级提取并替换 `cordis.patch.yml` 中含 `mcp-` 的 insert 块，**保留 `!!js` 表达式与 env 块原样**（preserve 桶） |
| 工具过滤 | 规则存 settings `connector` 命名空间（`toolFilters`）；`systemPrompt.tools(provider)` 滤 schema + `tools.guard` 硬拦截；`dsh-mcp-client` Config 封闭，规则**不能**写进 mcp 行 config |
| Skill 持久化 | 直接读写 `~/.dsh/skills/<name>/SKILL.md` |

## 已知限制

- MCP 改动需**重启 dsh** 才生效（因为 `dsh-mcp-client` 实例是静态加载的）。若想要保存即时生效，需用 `dsh-mcp-manager`（它自行实现 MCP client）。
- 保存时按 `dsh-mcp-client` 的契约**校验**：`transport` 只能是 `stdio`/`streamable-http`；`serverName` 必须匹配 `[A-Za-z0-9_-]{1,32}`；stdio 的 `command` 必须是单个词且能在 PATH 中找到（或为绝对路径）；streamable-http 的 `url` 必须是合法 http(s)（`!!js` 表达式除外）；命令/URL/参数中不允许控制字符。任何一项不合法，保存会被拒绝（HTTP 400）并提示原因，**不会写入** `cordis.patch.yml`——坏配置永远到不了下次启动。
- MCP 块解析为结构化提取，复杂嵌套 YAML（如多 env 变量）在表单里以单字段呈现；极复杂配置请直接在 `cordis.patch.yml` 编辑。
- 不桥接 MCP 的 resources/prompts，只管理 server 配置。
- **市场只读**：不做 MCP 部署、不做 skill 安装（MCP 部署/部分 skill 安装不是简单改配置）。安装命令/配置片段请复制后自行执行。
- **版本提示仅限 skill**：魔搭 MCP 是部署模式、无版本概念，不提供更新提示；skill 的"有更新"以市场 `file_last_modified` 对比本地 `sourceUpdated` 判定（需先「记录来源」）。
- 市场依赖 `modelscope.cn` 可达性；不可达时接口返回 502 提示，不影响 MCP/skill 本地管理。

## Troubleshooting

| 问题 | 原因 / 解决 |
|---|---|
| 设置页看不到 Connector 标签 | bundle 未挂载：确认 `dsh.profile.bundles` 含 `@omdp/dsh-connector`，重启 dsh；仍无则检查 client.js 尾部 `exports.inject = ['slots']` 是否在（缺了会静默丢注册） |
| 工具过滤不生效（模型仍能看到/调用） | 过滤规则只对**新会话**生效（当前会话的 schema 已下发）；确认 settings.yaml 有 `connector.toolFilters` 且 serverName 拼写与 patch 一致 |
| 保存 MCP 被拒（HTTP 400） | 配置不合法（transport/serverName/command/url 校验失败），按提示修正——插件不会写入坏配置 |
| MCP server 保存后不生效 | 需**重启 dsh**（`dsh-mcp-client` 静态加载） |
| `/connector/api/*` 404 | client/host 边界异常：确认插件 host 半边已加载（重启），浏览器强刷缓存 |
| 改动丢失 | 检查是否误用了旧版（`link:` 模式下改仓库源码需重启才生效） |

日志：插件错误会进入 dsh 启动的 stderr 日志（profile 下的 `dsh-boot.err`）。
回滚：MCP 块改动前先备份 `cordis.patch.yml`；或直接用 `dsh-undo-savepoint` 快照回滚。

## Development

```sh
# 本地开发：用 link: 安装（README 顶部方式一），改仓库源码 → 重启 dsh 即生效
cd ~/.dsh/profiles/web
pnpm add "link:D:/WorkSpace/omdp/dsh-connector"

# 语法检查
node --check D:/WorkSpace/omdp/dsh-connector/index.js
node --check D:/WorkSpace/omdp/dsh-connector/client.js

# 发布（GitHub Actions 自动发包，见 docs/npm-publish.md）
# 改 dsh-connector/package.json 的 version → git tag vX.Y.Z → push
```

结构：`index.js`（host，HTTP API）/ `client.js`（Web UI 设置页）/ `cordis.patch.yml`（bundle 激活行）。
贡献：PR 到 https://github.com/XJungit/omdp。

## License & security

MIT License。安全问题请通过 GitHub Issues 私密报告（https://github.com/XJungit/omdp/issues），
或直接联系维护者。涉及 token 的配置（README「安全实践」）请勿提交到公开仓库。

## 安全实践

- **不要在 `cordis.patch.yml` 里写明文 token**。MCP server 需要密钥时，用环境变量引用（`!!js process.env.XXX`），例如：
  ```yaml
  env:
    AUTH_HEADER: !!js ('Bearer ' + process.env.ZHIHU_TOKEN)
  ```
  token 明文只存在于 `.env` / 系统环境变量，不落进配置文件（同 `dsh-mcp-manager` 的 `tokenEnv` 理念）。
- 本插件的 API（`/connector/api/*`）与 DSH GUI 同源，无额外鉴权——仅限本机使用，不要暴露到公网。
- Skills 内容与 MCP 配置都属于本地敏感数据，改动会直接写入磁盘。

## Permissions & data

| 数据 | 访问方式 | 说明 |
|---|---|---|
| `profiles/web/cordis.patch.yml` | **读写** | MCP 块的结构化编辑（保留 `!!js`/env 原样） |
| `~/.dsh/skills/**/SKILL.md` | **读写** | 用户技能文件的查看/编辑/删除/新建；「记录来源」会写 `source`/`sourceUpdated` frontmatter |
| `~/.dsh/settings.yaml` 等 | 只读 | 不主动读写 |
| HTTP `/connector/api/*` | 本机监听 | 与 DSH GUI 同源，无额外鉴权 |
| 魔搭 `modelscope.cn/openapi/v1` | **只读外部** | 市场浏览代理（匿名）；结果仅存进程内存（30 分钟 TTL），**不写文件、不落盘** |
| 环境变量 | 只读引用 | 只读 `process.env.*`，不持久化 |

**不收集**：无遥测、无外部上报、无用户数据离开本机。

## 兼容性

本插件采用**抗崩溃架构**，DSH 更新时不会导致 DSH 崩溃（硬保证）。

- **纯静态依赖**：只 `import node:*` + `yaml`（唯一第三方依赖，版本 `^2.9.0`），**零 `@deepseek-ai/*` 依赖**（`@deepseek-ai/schemastery` 仅 peer 声明，供工具过滤的 settings schema 用，无则过滤静默全放行）。
- **唯一的 DSH 硬依赖**：`ctx.webServer`（`inject: ['webServer']`），用于注册 `/connector/api/*` HTTP 路由。
- **失败隔离**：webServer 不可用/变化时插件**干净失败不加载**，DSH 照常运行；内部多处 try/catch 防御。

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本（`webServer` API 变化） | ✅ DSH 不崩；connector 需适配更新 |
| yaml 版本 | ✅ 独立 npm 包，不受 DSH 更新影响 |
| 魔搭市场不可达 | ✅ 市场接口报 502，本地 MCP/skill 管理不受影响 |

**最后验证**：DSH `0.1.0-rc.8`（2026-08-20）；0.2.0 市场功能以 `node --check` +
真实 HTTP 集成测试通过（11 项：skills/mcp 列表与详情、证书/Hosted 标识、安装命令、
记录来源回写、更新判定），未改动 DSH 实例。当前 npm 版本 `0.3.0`。
