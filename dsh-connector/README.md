# @omdp/dsh-connector

一个 DeepSeek Harness (`dsh`) 插件，把 **MCP 服务器** 和 **用户 Skills** 的管理合并到 Web UI 的同一个设置页里（设置页标签：**Connector**）。

- **MCP**：读取/编辑 `profiles/web/cordis.patch.yml` 中的 `mcp-*` 块（结构化表单）。保存后**重启 `dsh` 生效**。
- **Skills**：列出/查看/编辑/删除 `~/.dsh/skills` 下的 `SKILL.md`。保存**即时生效**（filesystem provider 自动重新发现）。

设计上复用官方两款参考插件的方式：
- 设置页槽位注册方式参照 [`dsh-mcp-manager`](https://github.com/hyqhyq3/dsh-mcp-manager)（`settings.section` + Package 私有 HTTP API）。
- Skills 的 frontmatter 解析/序列化参照 [`dsh-skill-manager`](https://github.com/bitterSmilezzz/dsh-skill-manager)。

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
  "@omdp/dsh-connector": "^0.1.0"
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

## 使用

打开 Web UI 的 **设置 → Connector**：

1. **MCP 服务器** 区：
   - 列出当前 `cordis.patch.yml` 里的 `mcp-*` 服务器
   - 「编辑」改名称/传输/URL/命令/参数/Header；「删除」移除；「＋ 添加」新建
   - 保存后提示**重启 dsh** 才会真正加载新的 MCP server
2. **Skills** 区：
   - 列出 `~/.dsh/skills` 下的用户技能
   - 「编辑」改 frontmatter 与正文；「删除」移除目录；「＋ 新建」创建

## 工作原理

| 组成 | 机制 |
|---|---|
| 设置页 | client half 注册 `settings.section` 槽位（"Connector" 页签） |
| 跨边界调用 | client 用 `fetch('/connector/api/...')`，host 用 `ctx.webServer.register` 接收（安装包走 HTTP） |
| MCP 持久化 | 文本块级提取并替换 `cordis.patch.yml` 中含 `mcp-` 的 insert 块，**保留 `!!js` 表达式与 env 块原样**（preserve 桶） |
| Skill 持久化 | 直接读写 `~/.dsh/skills/<name>/SKILL.md` |

## 已知限制

- MCP 改动需**重启 dsh** 才生效（因为 `dsh-mcp-client` 实例是静态加载的）。若想要保存即时生效，需用 `dsh-mcp-manager`（它自行实现 MCP client）。
- 保存时按 `dsh-mcp-client` 的契约**校验**：`transport` 只能是 `stdio`/`streamable-http`；`serverName` 必须匹配 `[A-Za-z0-9_-]{1,32}`；stdio 的 `command` 必须是单个词且能在 PATH 中找到（或为绝对路径）；streamable-http 的 `url` 必须是合法 http(s)（`!!js` 表达式除外）；命令/URL/参数中不允许控制字符。任何一项不合法，保存会被拒绝（HTTP 400）并提示原因，**不会写入** `cordis.patch.yml`——坏配置永远到不了下次启动。
- MCP 块解析为结构化提取，复杂嵌套 YAML（如多 env 变量）在表单里以单字段呈现；极复杂配置请直接在 `cordis.patch.yml` 编辑。
- 不桥接 MCP 的 resources/prompts，只管理 server 配置。

## 安全实践

- **不要在 `cordis.patch.yml` 里写明文 token**。MCP server 需要密钥时，用环境变量引用（`!!js process.env.XXX`），例如：
  ```yaml
  env:
    AUTH_HEADER: !!js ('Bearer ' + process.env.ZHIHU_TOKEN)
  ```
  token 明文只存在于 `.env` / 系统环境变量，不落进配置文件（同 `dsh-mcp-manager` 的 `tokenEnv` 理念）。
- 本插件的 API（`/connector/api/*`）与 DSH GUI 同源，无额外鉴权——仅限本机使用，不要暴露到公网。
- Skills 内容与 MCP 配置都属于本地敏感数据，改动会直接写入磁盘。

## 兼容性

本插件采用**抗崩溃架构**，DSH 更新时不会导致 DSH 崩溃（硬保证）。

- **纯静态依赖**：只 `import node:*` + `yaml`（唯一第三方依赖，版本 `^2.9.0`），**零 `@deepseek-ai/*` 依赖**。
- **唯一的 DSH 硬依赖**：`ctx.webServer`（`inject: ['webServer']`），用于注册 `/connector/api/*` HTTP 路由。
- **失败隔离**：webServer 不可用/变化时插件**干净失败不加载**，DSH 照常运行；内部多处 try/catch 防御。

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本（`webServer` API 变化） | ✅ DSH 不崩；connector 需适配更新 |
| yaml 版本 | ✅ 独立 npm 包，不受 DSH 更新影响 |

## License

MIT
