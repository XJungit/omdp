# dsh-vision-bridge

**让纯文本模型也能"看图"的视觉桥插件**（`v0.1.7`）：自动区分多模态 / 文本模型。零第三方依赖。

## Requirements

- DeepSeek Harness 带 `web` profile GUI（`npx @deepseek-ai/dsh web`）
- Node.js `^22.19` 或 `>=24`
- 文本模型场景需要一个 OpenAI 兼容多模态端点（`provider.baseUrl` + `provider.apiKey`/`credential` + `provider.model`，默认 Agnes `agnes-2.5-flash`）

## Overview

DSH 视觉桥插件：让**纯文本模型也能"看图"**。自动区分多模态 / 文本模型。

- **多模态模型**（`inputModalities` 含 `image`）→ 不拦截，原图直接进上下文，模型自己看图。
- **文本模型**（如 deepseek-v4-flash）→ 插件调用**可配置的多模态端点**（baseUrl + apiKey + model）代看，
  把文字证据返回给文本模型。

适合：主力模型是文本模型（deepseek-v4-flash 等）、但需要处理图片（粘贴截图、本地图、URL）的用户。

**已实测验证**（Windows + DSH rc.8 + Agnes agnes-2.5-flash）：

- 粘贴图片 → 自动截获为临时路径文本 → 模型调 `vision_bridge_read_image` → Agnes 返回文字描述 OK
- 本地图片 → 转 data URL → 识别成功 OK
- 公网 URL → 取决于 Agnes 能否抓取（raw.githubusercontent 常不可达，建议用 data URL 或可达图床）

## Quick start

```sh
# 1. 安装（npm）
cd ~/.dsh/profiles/web
pnpm add @omdp/dsh-vision-bridge

# 2. 配置多模态端点（Web UI 设置 → Vision Bridge，或 cordis.patch.yml 覆盖 config）
#    至少配置 provider.baseUrl / provider.apiKey（或 credential） / provider.model

# 3. 重启 dsh
# 4. 在文本模型会话里粘贴一张图片 → 输入框出现临时路径 → 模型自动调 vision_bridge_read_image
```

最小可复现：安装 + 配置 Agnes 端点（或任意 OpenAI 兼容多模态端点）后，在纯文本模型
会话粘贴一张截图，模型应返回图片内容描述（如 "Vision Bridge Test 123"）。

## 功能列表

### 1. 自动分流（多模态 / 文本模型）

工具执行时调用 `llm.resolveModelInfo().inputModalities` 判断当前路由模型能力。

### 2. read_image 工具（`vision_bridge_read_image`）

- 参数：`path`（单图）/ `paths`（多图）/ `prompt`（文本模型的意图）/ `json`（结构化输出）
- 支持本地路径、http(s) URL、粘贴生成的临时路径
- 多模态模型调用 → 直接阅读；文本模型 → 调多模态端点代看

### 3. 粘贴 / 拖拽图片（client.js）

- **多模态模型**：粘贴图片走 DSH 原生上传，插件不拦截。是否多模态由前端查询 host 的 `/vision-bridge/capabilities`（基于 `llm.resolveModelInfo` 的真实 `inputModalities` 判定）；已知视觉别名（如 DSV4FV）在查询完成前也会快速放行。
- **纯文本模型**：捕获 paste → POST /vision-bridge/paste → 临时文件 → 路径文本入输入框。
- **多模态模型拖拽**：不拦截，交给 DSH 原生图片处理器和文件拖拽插件。
- **纯文本模型拖拽**：由本插件捕获，上传到 `/vision-bridge/paste` 并插入临时路径；捕获前会向文件拖拽插件发送空 drop 复位事件，避免“拖拽到 ❌”覆盖层卡死且不重复插入路径。
- 不会触发宿主图片准入（`inputModalities` 拒绝），因此文本模型仍能通过粘贴或拖拽路径"发图"。
- 前端按当前模型标签缓存能力判定；初始加载检查一次，之后通过 `MutationObserver` 和模型按钮点击事件感知选择器变化，不再每秒扫描全页面；能力查询未完成时仅对明确文本别名（如 DSV4F）转路径，其它模型 fail-open 放行原生事件；`pasteToPath: false` 可整体关闭转路径行为。

### 4. 包装 provider（`(vision bridge)` 模型条目）

- `registerAdapter` 注册新 provider，模型元数据声明 `inputModalities:['text','image']`
- 在模型选择器选该条目 → 原生粘贴放行 → 请求时 `convertImagesToEvidence` 把图片块转证据文本再委托上游

### 5. agent/pre-step 自动识别（autoRead）

- `autoRead`: `true` 强制开启 / `false` 关闭 / 缺省自动（多模态跳过，纯文本自动转证据）

### 6. 临时文件生命周期

- paste 路由写入的临时文件：TTL 10 分钟自动清理 + 插件卸载时清理

## 安装

### 方式一：本地 `link:` 安装（推荐，自动激活）

避免从 GitHub 直接拉取的网络/TLS 问题。在 `profiles/web/package.json` 的
`dependencies` 里加入（或直接编辑）：

```json
"@omdp/dsh-vision-bridge": "link:D:/WorkSpace/omdp/dsh-vision-bridge"
```

然后在该 profile 下重建 lockfile 并建立 junction：

```sh
cd ~/.dsh/profiles/web
pnpm install --lockfile-only --offline
```

> `pnpm install` 会为 `link:` 依赖建立 `node_modules/@omdp/dsh-vision-bridge` junction
> 指向 `D:/WorkSpace/omdp/dsh-vision-bridge`，插件源码即仓库源码，**改仓库 → 重启 dsh 即生效**。
> 确保 `dsh.profile.bundles` 里包含 `"@omdp/dsh-vision-bridge"`（包内声明了
> `dsh.bundle.patch`，激活行自动生效，无需手动改 `cordis.patch.yml`）。

### 方式二：本机 web profile 手动安装（备用）

在 `profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: vision-bridge
      name: '@omdp/dsh-vision-bridge'
      config:
        provider:
          baseUrl: https://api.agnes-ai.cn/v1
          model: agnes-2.5-flash
          credential: AGNES_API_KEY
        defaultPrompt: 请完整描述这张图片的内容，包括所有文字、布局、元素和细节。
```

密钥：`.credentials.yaml` / `.env` 均加 `AGNES_API_KEY`。

重启 DSH（web profile）生效。插件本体零依赖。

### 方式三（推荐）：从 npm 安装

插件已发布到 npm（GitHub Actions 自动发包，见仓库根 `docs/npm-publish.md`）。
在 profile 的 `package.json` 加入依赖后 `pnpm install`：

```jsonc
"dependencies": {
  "@omdp/dsh-vision-bridge": "^0.1.7"
}
```

```sh
cd ~/.dsh/profiles/web
pnpm install
```

更新：`pnpm update @omdp/dsh-vision-bridge`（标准 npm 语义，无 git `#path:` 问题）。

### 方式四：从 GitHub 远程安装（备选）

不想本地 checkout 时，可直接从仓库装（`#path:` 指向子目录）：

```sh
dsh plugin --profile web add github:XJungit/omdp#path:dsh-vision-bridge
```

> **安装命令前提**：上面的 `dsh plugin add` 需要 `dsh` 已在 PATH。若你是按官方文档用 `npx` 运行 dsh（没有全局 `dsh` 命令），上面这行会报 `command not found: dsh` —— 改用等价命令：
> `npx @deepseek-ai/dsh plugin --profile web add github:XJungit/omdp#path:dsh-vision-bridge`（不要求 `dsh` 在 PATH）。

pnpm ≥10 默认拒绝运行 git 依赖的构建脚本，首次 `add` 会失败，需在
`profiles/web/pnpm-workspace.yaml` 加白名单后重试：

```yaml
allowBuilds:
  '@omdp/dsh-vision-bridge': true
```

（本插件是纯 JS 零构建，白名单是唯一门槛，无需 `prepare` 脚本。详见官方
[publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。）

## 更新

本地 link 模式下没有"拉取"这一步：直接 `git pull` 或编辑 `D:/WorkSpace/omdp`，
然后**重启 `dsh --profile web`**（或刷新浏览器页面）加载新代码。

## 卸载

```sh
# 1. 从依赖移除
cd ~/.dsh/profiles/web
pnpm remove @omdp/dsh-vision-bridge

# 2. 从 bundles 移除（若 pnpm remove 未自动清理）
#    编辑 profiles/web/package.json，从 dsh.profile.bundles 删掉 "@omdp/dsh-vision-bridge"

# 3. 临时文件清理（插件卸载时自动清理，若残留可手动删）
#    os.tmpdir() 下的 vision-bridge 私有临时目录
```

**禁用（临时）**：在 `cordis.patch.yml` 加 `- id: vision-bridge\n  disabled: true`
（或从 bundles 移除后重启），无需删除包。

## 配置字段

| 字段 | 默认值 | 说明 |
|---|---|---|
| `provider.baseUrl` | `https://api.agnes-ai.cn/v1` | 多模态端点（OpenAI 兼容） |
| `provider.apiKey` | `''` | 明文 key（与 credential 二选一） |
| `provider.credential` | `AGNES_API_KEY` | DSH credential 引用 |
| `provider.model` | `agnes-2.5-flash` | 多模态模型名 |
| `defaultPrompt` | 描述图片 | 无意图时的默认提示词 |
| `toolName` | `vision_bridge_read_image` | 工具名（独特名避免与宿主 read_image 遮蔽） |
| `families` | `[deepseek, glm]` | 包装成 vision 的文本模型族 |
| `timeoutMs` | `120000` | 多模态调用超时 |
| `autoRead` | 缺省自动 | true/false/自动（多模态跳过，纯文本转换） |
| `pasteToPath` | `true` | 粘贴截获路由 |
| `pasteTtlMs` | `600000` | 粘贴临时文件保留时长 |
| `visionProvider` | `true` | 注册 `(vision bridge)` 包装 provider |

## Troubleshooting（排错经验）

1. **新增插件必须用 `- insert:`**，顶层 `- id + name` 只做配置覆盖，不会新增插件。
2. **Windows 插件名不能用 `C:/...` 绝对路径**（Node `import()` 把 `C:` 当 scheme）；用 `file:///` URL 或 **包名 + node_modules junction**（推荐）。
3. **工具 `parameters` 必须是完整 JSON Schema（`type:"object"` + `properties`）**：本插件通过 `ctx.tools.register` 注册（已安装 bundle 路径），`parameters` 会被**原样转发**给 OpenAI 兼容的 provider。若写成 DSH 的 per-property map（顶层无 `type`），provider 会收到 `type: null` 并拒绝（`schema must be a JSON Schema of 'type: "object"', got 'type: null'`）。动态插件 `defineTool` 才用 per-property `ParameterSchemaSpec` 写法，这里不适用。
4. **工具名用独特名**（`vision_bridge_read_image`），否则被宿主原生 `read_image` 遮蔽。
5. **package.json 必须声明 `dsh.client`**（platform: web, immediately），否则 client.js 不会被 client-modules 加载，粘贴截获不生效。
6. **注册日志已改为写入 `os.tmpdir()` 下的临时文件**（旧版写死 `C:\Users\xj\...` 绝对路径，换机器会失效）。
7. **本地文件读取有 25MB 上限**（先 `stat` 再读，避免大图 base64 膨胀 ~33% 吃内存）；文件不存在会报 `file not found` 而不是裸 ENOENT。
8. **HTTP 错误会附加中文原因提示**：401 → key 无效/缺失、404 → 端点/模型不存在、429 → 限流、5xx → 服务端异常，模型/Agent 能直接看到失败原因。
9. **粘贴路由增加 Content-Type 快速拒绝**（非 `image/*` 直接 415，不缓冲大上传）；真实校验仍靠 magic-byte 嗅探，缺 Content-Type 的客户端也兼容。

## 安全

- api key 优先走 DSH credential（不落配置文件明文）。
- 粘贴路由：Content-Type 检查 + magic-byte 校验 + 25MB 上限 + 私有临时目录（0600）+ TTL 清理。
- 本地文件读取 25MB 上限，防超大图内存占用。
- 图片会发送到你配置的多模态端点，注意隐私。

## Permissions & data

| 数据 | 访问方式 | 说明 |
|---|---|---|
| 本地图片文件 | **读取**（路径参数） | 转 data URL 发送到多模态端点；25MB 上限 |
| 粘贴/拖拽图片 | **接收并写临时文件** | `os.tmpdir()` 下私有目录（0600），TTL 10 分钟 + 卸载清理 |
| 多模态端点（baseUrl） | **网络发送** | 图片 + prompt 发到配置的 OpenAI 兼容端点（默认 Agnes） |
| apiKey / credential | 读取 | 优先 DSH credential，明文 key 也可（`provider.apiKey`） |
| `ctx.llm` / `ctx.attachments` | DSH 服务 | resolveModelInfo / readImage 等 |

**注意**：图片会**离开本机**发送到多模态端点——隐私敏感图片请勿使用，或自建端点。
**不收集**：无遥测、无外部上报（除多模态端点外无其他网络请求）。

## Development

```sh
# 本地开发：link: 安装，改源码 → 重启 dsh 即生效
cd ~/.dsh/profiles/web
pnpm add "link:D:/WorkSpace/omdp/dsh-vision-bridge"

# 语法检查
node --check D:/WorkSpace/omdp/dsh-vision-bridge/index.js
node --check D:/WorkSpace/omdp/dsh-vision-bridge/client.js

# 发布（GitHub Actions 自动发包）
# 改 dsh-vision-bridge/package.json 的 version → git tag vX.Y.Z → push
```

结构：`index.js`（host）/ `client.js`（粘贴截获，`dsh.client.immediately`）/ `cordis.patch.yml`。
贡献：PR 到 https://github.com/XJungit/omdp。

## License & security

MIT License。安全问题请通过 GitHub Issues 私密报告（https://github.com/XJungit/omdp/issues）。
涉及多模态 apiKey 的配置请勿提交到公开仓库。


## 兼容性

本插件采用**抗崩溃架构**，DSH 更新时不会导致 DSH 崩溃（硬保证）。

- **纯静态依赖**：只 `import node:*`，**零第三方依赖、零 `@deepseek-ai/*` 依赖**（最稳）。
- **DSH 硬依赖**：`ctx.tools` / `ctx.attachments` / `ctx.llm` / `ctx.credentials`（`inject` 声明）。
- **防御性编码**：所有 DSH 服务调用都有 `?.` / `typeof` 检查（如 `ctx.credentials?.resolve?.()`、
  `typeof ctx.llm?.registerAdapter !== 'function'` → 提前 return），**API 缺失时优雅降级**，不崩溃。

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本（`ctx.llm` API 变化） | ✅ DSH 不崩；LLM 相关功能可能降级（适配器/流式），需适配 |
| DSH 服务缺失 | ✅ 优雅降级（防御性编码） |

**最后验证**：DSH `0.1.0-rc.8`（2026-08-20，已在本机运行实例活体验证 paste 路由；autoRead 改用 rc.8 pre-step 载荷的 `payload.agent` 获取当前路由模型）。rc.8 起 DeepSeek 适配器支持原生图片请求，多模态模型场景下 autoRead 会自动放行不再代看。当前 npm 版本 `0.1.7`（2026-08-27 发布）。
