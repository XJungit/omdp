# AI 编写的 DSH 插件为什么容易出问题？—— 风险综述与防御实践

> **适用版本**：DeepSeek Harness `@deepseek-ai/dsh` `0.1.0-rc.6`（2026-08-15）
> **作者**：@XJungit
> **类型**：经验分享 / 讨论（非官方文档）
> **说明**：DSH 仍处于 developer preview，核心插件与 API 会快速演进，文中的约定以当前 rc.6 为准，失效时欢迎指正。

---

## 摘要

DeepSeek Harness 的定位是"一切皆插件"，并且插件**主要不是给社区 review 的成品，而是给 AI 现场生成、自用的**。这带来了一个结构性风险：**Cordis 插件跑在同一个进程里、共享 context 与工具注册表、没有运行时隔离——一个 AI 写的插件只要犯一个小错，轻则插件不生效，重则拖垮整个 DSH。**

本文第一部分汇总社区里的真实证据（GitHub Discussions / Hacker News / Reddit / 中文社区），说明"AI 写的 DSH 插件质量差、容易导致崩溃"不是个别现象，而是有架构根因的普遍问题；第二部分给出作者在 omdp 仓库（dsh-connector / dsh-vision-bridge 两个插件的实际落地）验证过的防御实践，希望能帮大家少踩坑。

---

## 一、问题：插件为什么"跑着跑着就出问题"

如果你用 AI 写过 DSH（Cordis）插件，大概经历过这些：

- 插件装上后**一直 pending，不生效**，日志里是 `waiting for services: ...`
- 运行时报 `cannot get property "xxx" without inject`
- 启动时 `Cannot find package ...` 直接 **`dsh web` 起不来**
- 插件之间**互相覆盖 / 撞名**，行为变得不可预测

这些不是个例。它们的共同根源，是 DSH 的插件架构本身。

---

## 二、架构根因：单进程、共享注册表、无隔离

来自官方仓库的讨论 [Discussion #326 — Thoughts on "Everything is a Plugin" — the user-side cost](https://github.com/deepseek-ai/deepseek-harness/discussions/326)，作者 @phinn 分析了 DSH 的 49 个包依赖图后指出：

> **"Cordis plugins share one process, one context object, one tool registry."**
> （Cordis 插件共享一个进程、一个 context 对象、一个工具注册表。）

他还对比了 Webpack loaders："那些平台花了多年时间建立**运行时隔离**，Cordis 没有。"

**这意味着什么：**

| 风险 | 后果 |
|---|---|
| 一个插件抛未捕获异常 | 可能波及整个进程，影响所有会话 |
| 两个插件注册同名服务 / 工具 / section | 互相覆盖或 `fail loud`，行为不可预测 |
| 插件声明了错误的 `inject` | 自己 pending 不生效，甚至阻塞启动 |
| 插件依赖的原生二进制装错平台 | loader 同步导入失败，**整个 `dsh web` 启动即崩** |

而 Hacker News 上关于 DSH 的讨论（[DeepSeek Harness developer preview](https://news.ycombinator.com/item?id=49285244)）更是点破了设计定位：

> "This is not for community plugins, **it's for AI generated plugins**. If everything is a plugin it means plugins can do everything. AI can write custom plugins for you."

翻译过来就是：**DSH 的插件是给 AI 生成、给自己用的，没有社区 review 这道质量闸门。** 所以"AI 写的插件质量差"是设计使然，不是偶然现象。

---

## 三、社区证据：这不是个别现象

### 3.1 官方 GitHub Discussions

**① [Discussion #380 — 写第一个 dsh 插件踩的六个坑（0.1.0-rc.6 本机复核）](https://github.com/deepseek-ai/deepseek-harness/discussions/380)**

作者（做 dsh-superpowers，把 Superpowers 方法论搬进 DSH）用 AI 辅助开发，踩了 6 个坑，几乎全是"AI 写插件"高频翻车点：

- **坑 1：import 路径解析失败**。dev 链接下 Node 走软链接的真实路径，`createRequire` 找不到 `@deepseek-ai/*` → `MODULE_NOT_FOUND`。
- **坑 2：`inject` 写成对象**。`{ required: [...], optional: [...] }` 会被 Cordis 当成"我要 required 和 optional 这两个服务"，插件永远 pending，启动卡住。
- **坑 3：`inject` 数组 vs 对象的语义混淆**。数组每一项是服务名；对象走 `Object.keys()`，是拦截配置，别混用。
- **坑 4-6**：section 命名冲突、host/preset 分层、npm 发布（国内镜像只读、OTP 2FA）。

作者的最终结论非常关键：

> "我最后让插件不 import 任何 `@deepseek-ai/`，只留 node 内置模块，要什么都从 `ctx` 上拿。"

**② [Discussion #535 — npx @deepseek-ai/dsh web 报错](https://github.com/deepseek-ai/deepseek-harness/discussions/535)**

插件依赖导致**整个 DSH 启动即崩**的实证：
- `attachment` 插件：`sharp` 原生二进制加载失败（win32-x64 不匹配）
- `subprocess` 插件：`node-pty` 找不到（`Cannot find package ...`）

因为 **DSH 的 loader 在启动时同步导入所有 bundle 的 loader entry**，任何一个含原生依赖的插件装错平台，整个 `dsh web` 直接抛错起不来，而不是降级跳过。

**③ [Discussion #758 — Windows sandbox (workspace-write) 崩溃 + 4 related issues](https://github.com/deepseek-ai/deepseek-harness/discussions/758)**

虽然不是插件问题，但同属"早期框架隐蔽坑"：沙箱临时目录清理后不自愈、ConstrainedLanguage 噪音、WMI 查询被拒、UAC 静默失败。作者本人在 Windows 上也踩过 BUG-1（`windows-acl-run: --temp is not an existing directory`），说明这类运行时脆弱性是真实普遍的。

**④ 其他运行时隐藏问题**
- [Discussion #483 — force-kill 后 write-behind 丢失未刷新尾部](https://github.com/deepseek-ai/deepseek-harness/discussions/483)
- [Discussion #712 — Python SDK 会话恢复 id 冲突](https://github.com/deepseek-ai/deepseek-harness/discussions/712)

### 3.2 英文社区

- **Hacker News**（同上）：确认"插件给 AI 生成"的定位；也有人指出插件生态的普遍宿命——"插件通常因唯一维护者失去兴趣而死"。
- **Reddit**（[r/DeepSeek — Harness and tools for deepseek](https://www.reddit.com/r/DeepSeek/comments/1ug8ecg/harness_and_tools_for_deepseek)）："it was breaking very often where it got stuck, **so much badly written code**"——直接吐槽经常卡死、大量写得烂的代码。

### 3.3 中文社区 / 第三方评测

- **[5toy — DeepSeek Harness 测试反馈两极分化](https://5toy.com/s/13814)**：
  - liustack（modlens 视觉插件作者）：多模态支持**硬编码、没给第三方完整接口**，只能"注册特殊模型变体绕过"，评价"太早期，很不完善"。
  - Bohu：eval 发现策略 bug——dsh 要求调查每个非零 exit code，但 `grep` 无匹配也返回 1 → 误判失败 → **自我强化验证循环**（同任务请求数 61 vs 32、成本 $0.17 vs $0.05、token 290万 vs 54.8万）。
  - 结论："更适合开发者测试、拆解和做插件，**不适合直接交给生产环境跑关键业务**。"
- **[掘金 — 给 DSH 加一双"眼睛"：图片识别插件踩坑实录](https://juejin.cn/post/7673655608423235634)**：与视觉插件同类的实现与踩坑过程。
- **[博客园 — 插件开发实战：从设计理念到 npm 发布](https://www.cnblogs.com/pc2005/p/22477987)**：含 npm 发布流程（印证 #380 的发布坑）。

---

## 四、AI 写插件的高频雷点清单（含真实报错）

以下是社区证据 + 作者实测汇总的、AI 写 DSH 插件最容易犯的错：

| # | 雷点 | 典型表现 / 报错 |
|---|---|---|
| 1 | `inject` 写成对象（`{required, optional}`） | `1 entry did not activate my-plugin: pending (waiting for services: required, optional)` |
| 2 | 访问未注入的服务 | `cannot get property "credentials" without inject`（Cordis 的 Proxy 在 get 时直接抛，`?.` 救不了） |
| 3 | import `@deepseek-ai/*` 在 dev 链接下解析失败 | `MODULE_NOT_FOUND` |
| 4 | 依赖原生二进制（sharp / node-pty 等） | `dsh web` 启动即崩：`Could not load the "sharp" module using the win32-x64 runtime` / `Cannot find package ... node-pty` |
| 5 | 注册同名服务 / 工具 / section | fail loud 或互相覆盖，行为不可预测 |
| 6 | 未捕获异常 | 单进程无隔离，可能波及整个 harness |
| 7 | 工具 `parameters` 用 DSH per-property map | OpenAI 兼容 provider 报 `schema must be a JSON Schema of 'type: "object"', got 'type: null'`（HTTP 400） |
| 8 | 依赖 rc 期的接口细节 | API 快速演进，AI 学的旧写法很快失效 |

> 其中第 7 条是作者在 dsh-vision-bridge 上**实测踩过**的：`ctx.tools.register`（已安装 bundle 路径）会把 `parameters` 原样转发给 provider，per-property map（顶层无 `type`）到了 provider 手里变成 `type: null` 被拒。必须写完整的 JSON Schema（`{ type: 'object', properties: {...} }`）。

---

## 五、防御实践：如何写出"不崩"的 DSH 插件

### 5.1 三条核心原则

1. **纯 JavaScript / 零构建**：避免 TS 编译产物缺失、避免原生二进制（sharp / node-pty 类），从根上避开 #535 那类启动崩溃。
2. **零运行时依赖**：插件只 import Node 内置模块，要任何能力都从 `ctx` 上拿（社区共识，见 #380）。
3. **`inject` 显式声明 + 一维字符串数组**：需要什么服务就明确声明什么，别靠 `?.` 兜底。

### 5.2 `inject` 正确写法

```js
// ✅ 正确：一维字符串数组
export const inject = ['tools', 'agents', 'attachments', 'llm', 'credentials']

// ❌ 错误：对象写法会被当成两个"服务名"
export const inject = { required: ['systemPrompt'], optional: ['skills'] }
```

### 5.3 服务访问的正确姿势

Cordis 对未注入服务的访问会在 `get` 时**直接抛错**（Proxy 实现），所以：

```js
// ❌ 这样写没用：错误在访问 ctx.credentials 时就抛了
const cred = await ctx.credentials?.resolve?.(ref)

// ✅ 先在 inject 里声明 'credentials'，再访问
export const inject = ['credentials']
// apply(ctx) 里：
const cred = await ctx.credentials.resolve(ref)
```

### 5.4 工具注册的正确姿势（JSON Schema）

`ctx.tools.register`（已安装 bundle 路径）会把 `parameters` **原样转发**给 OpenAI 兼容 provider，所以必须是完整的 JSON Schema：

```js
ctx.tools.register({
  name: 'my_tool',
  description: '...',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '...' },
      verbose: { type: 'boolean', description: '...' },
    },
    additionalProperties: false,
  },
  // ...
})
```

> 动态插件 `defineTool` 才用 per-property 的 `ParameterSchemaSpec` 写法；`ctx.tools.register` 这条路不适用。

### 5.5 错误处理与边界

- 关键调用包 `try/catch`，失败降级为可读的文本/错误信息，而不是抛到顶层。
- 注册前查重：工具名、服务名、section 名尽量带插件自己的前缀，避免撞名。
- 对"同名已存在"做 fallback（例如工具名被占用时换一个备用名注册），而不是让注册直接失败。

### 5.6 本地开发与验证流程

1. **本地 `link:` 安装**（`"@omdp/xxx": "link:D:/path"` + `pnpm install`），改完重启 DSH 即生效，避免每次远程拉取。
2. **小步验证**：先 `dsh --profile xxx --dump-config` 看 patch 层是否正确加载，再起一个最小会话测工具。
3. 用 `node --check` 做语法校验，`import` 后做 smoke test（确认模块能加载、导出函数存在）。

### 5.7 发布注意

- GitHub 远程安装会遇到 **pnpm ≥10 的构建脚本拦截**：首次 `dsh plugin add github:...` 会失败，需在 profile 的 `pnpm-workspace.yaml` 加：
  ```yaml
  allowBuilds:
    '@omdp/xxx': true
  ```
- 纯 JS 插件无需 `prepare` 脚本，`allowBuilds` 是唯一门槛。
- 若发 npm，注意国内镜像只读、`npm publish` 只认 `--otp`（见 #380）。

---

## 六、作者实践：omdp 仓库怎么做的

作者维护的 [omdp](https://github.com/XJungit/omdp) monorepo 里有两个插件，完全按上面的原则落地：

- **`@omdp/dsh-connector`**：MCP + Skills 管理插件。纯 JS、仅依赖 `yaml`；写 `cordis.patch.yml` 前做完整校验（transport/serverName/url/command），并原子写入，保证"坏配置到不了下次启动"。
- **`@omdp/dsh-vision-bridge`**：视觉桥插件（给文本模型加"眼睛"）。**零依赖**、只 import Node 内置模块；工具 `parameters` 用完整 JSON Schema（修掉了 `type: null` 400）；`inject` 显式声明（修掉了 `cannot get property "credentials" without inject`）；工具重名做 fallback；粘贴路由做 magic-byte 校验 + 25MB 上限 + TTL 清理。

这些修复过程本身就是"AI 写插件踩坑"的活案例——建议直接参考仓库里的实现。

---

## 七、开放讨论（欢迎社区参与）

1. **DSH 是否需要为第三方插件提供某种隔离/沙箱？** 现在单进程共享 context，一个插件崩可能拖垮整个 harness。未来会不会有进程级隔离或插件级错误域？
2. **"插件主要给 AI 生成"这个定位，是否意味着官方应该提供更好的插件校验/调试工具？** 比如 `--dump-config` 之外，能不能有"插件体检"工具，提前暴露 inject 错误、服务缺失、schema 问题？
3. **社区需要一份"AI 写 DSH 插件安全清单"吗？** 如果大家觉得有用，可以一起维护一份，减少重复踩坑。

---

## 附录：来源链接

**GitHub Discussions（官方仓库）**
- [#380 写第一个 dsh 插件踩的六个坑](https://github.com/deepseek-ai/deepseek-harness/discussions/380)
- [#326 "Everything is a Plugin" — the user-side cost](https://github.com/deepseek-ai/deepseek-harness/discussions/326)
- [#535 npx @deepseek-ai/dsh web 报错](https://github.com/deepseek-ai/deepseek-harness/discussions/535)
- [#758 Windows sandbox 崩溃 + 4 related issues](https://github.com/deepseek-ai/deepseek-harness/discussions/758)
- [#483 force-kill 后输入丢失](https://github.com/deepseek-ai/deepseek-harness/discussions/483)
- [#712 Python SDK 会话恢复 id 冲突](https://github.com/deepseek-ai/deepseek-harness/discussions/712)

**英文社区**
- [Hacker News — DeepSeek Harness developer preview](https://news.ycombinator.com/item?id=49285244)
- [Reddit — Harness and tools for deepseek](https://www.reddit.com/r/DeepSeek/comments/1ug8ecg/harness_and_tools_for_deepseek)

**中文社区 / 第三方**
- [5toy — DeepSeek Harness 测试反馈两极分化](https://5toy.com/s/13814)
- [掘金 — 给 DSH 加一双"眼睛"：图片识别插件踩坑实录](https://juejin.cn/post/7673655608423235634)
- [博客园 — 插件开发实战：从设计理念到 npm 发布](https://www.cnblogs.com/pc2005/p/22477987)

---

*本文为社区公开讨论的整理与作者实测的归纳，观点归属原作者；DSH 仍处 developer preview，接口与行为会变，请以最新官方文档为准。*
