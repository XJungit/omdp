# AI 编写的 DSH 插件：质量风险与崩溃讨论调研

> **调研对象**：DeepSeek Harness（`@deepseek-ai/dsh`）插件生态中，关于"AI 生成的插件容易出问题、质量差、易导致整个 DSH 崩溃"的公开讨论。
> **适用版本**：dsh `0.1.0-rc.6`（调研时点 2026-08-15；DSH 于 2026-08-13 开源，处于 developer preview，接口仍会快速变化）
> **调研方式**：GitHub Discussions / Issues、Hacker News、Reddit、中文技术社区（掘金 / 博客园 / 网易 / 第三方评测文章）
> **维护者**：@XJungit（omdp 仓库）

---

## 一、一句话结论

**"AI 写的 DSH 插件容易出问题、质量差、易导致崩溃"这个担忧在社区有真实、多来源的共鸣，而且有明确的架构根因：Cordis 插件单进程、共享 context 与工具注册表、没有运行时隔离——一个插件的小错误就可能让整个 DSH 卡住或崩掉。** DSH 设计上正是"插件主要给 AI 生成、给自己用"（不是靠社区 review 把关），所以这个风险是**结构性**的，不是个别现象。

---

## 二、核心架构根因（最重要）

### 来源：[Discussion #326 — Thoughts on "Everything is a Plugin" — the user-side cost](https://github.com/deepseek-ai/deepseek-harness/discussions/326)

作者 @phinn 深度分析了 DSH 的 49 个包依赖图后，直接点出：

- **"Plugin conflicts are inevitable"**（插件冲突不可避免）——依赖图已经不小，插件 A/B 可能争抢同一个服务/注册表条目。
- **"Cordis plugins share one process, one context object, one tool registry"**——所有插件跑在**同一个进程**里，共享 context 和工具注册表。
- 对比 Webpack loaders：**"那些平台有多年时间建立运行时隔离，Cordis 没有。"**
- 用户侧代价：普通用户不该被迫理解 Profile 组合、Bundle 装配、服务解析。

**推论**：任何插件抛未捕获异常、错误注册同名服务、或声明了错误的 `inject`，都可能：
1. 插件自身 `pending` 不生效（最常见，见下文 #380）；
2. 污染共享的工具注册表 / 服务解析；
3. 严重时**拖垮整个进程**。

### 来源：[Hacker News — DeepSeek Harness developer preview](https://news.ycombinator.com/item?id=49285244)

HN 讨论里有人一针见血地说明 DSH 的插件定位：

> "This is not for community plugins, **it's for AI generated plugins**."
> "If everything is a plugin it means plugins can do everything. **AI can write custom plugins for you.** So this means the tool is infinitely flexible for you, even without any community."

**含义**：DSH 的插件主要不是"社区审查过的成品"，而是"AI 现场生成、自用"。这意味着**没有社区 review 这道质量闸门**，插件质量完全取决于 AI 生成时的一次性表现——正是"AI 写的插件质量差"的结构性来源。

---

## 三、写插件踩坑实录（AI/新手最容易炸的点）

### 来源：[Discussion #380 — 写第一个 dsh 插件踩的六个坑（0.1.0-rc.6 本机复核）](https://github.com/deepseek-ai/deepseek-harness/discussions/380)

作者（做 dsh-superpowers）用 AI 辅助开发，踩了 6 个坑，全部是"AI 写插件"高频翻车点：

| # | 坑 | 表现 | 教训 |
|---|---|---|---|
| 1 | **import 路径解析** | dev 链接下 Node 走软链接真实路径，`createRequire` 找不到 `@deepseek-ai/*` → `MODULE_NOT_FOUND` | 插件尽量**只 import node 内置模块**，要服务全从 `ctx` 拿 |
| 2 | **`inject` 只能是字符串数组** | 写成 `{required:[...], optional:[...]}` → 启动**卡住**：`1 entry did not activate my-plugin: pending (waiting for services: required, optional)` | `inject` 必须是一维字符串数组 |
| 3 | **`inject` 对象写法被误解** | 对象形状被 Cordis 当作"服务名列表"（`Object.keys`），永远等不到服务 | 数组 = 服务名；对象 = 装饰器/拦截配置，别混用 |
| 4 | （其余坑：section 命名冲突、host/preset 分层、npm 发布） | 部分会 **fail loud**（撞名即报错） | 了解 Cordis 的分层与命名约定 |
| 5-6 | npm 发布相关（国内镜像只读、OTP 2FA） | publish 卡住 | 与 dsh 本身无关，但同样挡发布 |

> 作者最终结论（也是被坑后的共识）：**"让插件不 import 任何 `@deepseek-ai/`，只留 node 内置模块，要什么都从 `ctx` 上拿。"**

**这和你（XJungit）在 omdp 里的实践完全一致**：dsh-connector 与 dsh-vision-bridge 都是纯 JS、尽量零依赖、从 ctx 取服务——这不是巧合，是被坑后的防御性写法。

---

## 四、插件/依赖导致整个 DSH 崩溃的实证

### 来源：[Discussion #535 — [BUG] npx @deepseek-ai/dsh web 报错](https://github.com/deepseek-ai/deepseek-harness/discussions/535)

- `dsh web` **启动即崩**，因为两个 loader entry 导入失败：
  - `attachment` 插件：**`sharp` 模块加载失败**（win32-x64 原生二进制不匹配）
  - `subprocess` 插件：**`node-pty` 找不到**（`Cannot find package ... node-pty/index.js`）
- 关键点：**DSH 的 loader 在启动时同步导入所有 bundle 的 loader entry**，任何一个含原生依赖的插件装错平台，**整个 `dsh web` 直接抛错起不来**，而不是降级跳过。

**结论**：一个插件带坏一个二进制依赖 = 整个 harness 崩溃。这是"插件导致 DSH 完全崩溃"最直接、最典型的实证。

### 来源：[Discussion #758 — Windows sandbox (workspace-write) 崩溃 + 4 related issues](https://github.com/deepseek-ai/deepseek-harness/discussions/758)

- 非插件问题（纯 Windows 沙箱运行时），但同属"早期框架隐蔽坑"类别：临时目录清理后不自愈、ConstrainedLanguage 噪音、WMI 查询被拒、UAC 静默失败。
- 与本仓库的关联：**XJungit 本机也踩过 BUG-1**（`windows-acl-run: --temp is not an existing directory: C:\Windows\TEMP\dsh-*`），证明这类运行时脆弱性是真实且普遍的。

### 其他运行时隐藏问题

- [Discussion #483 — force-kill 后 write-behind 丢失未刷新尾部](https://github.com/deepseek-ai/deepseek-harness/discussions/483)（输入延迟/丢失）
- [Discussion #712 — Python SDK 会话恢复 id 冲突](https://github.com/deepseek-ai/deepseek-harness/discussions/712)

---

## 五、社区普遍吐槽（质量与稳定性）

### 来源：[DeepSeek Harness 测试反馈两极分化（5toy 第三方评测聚合）](https://5toy.com/s/13814)

- **liustack**（modlens 视觉插件作者）：想粘贴图片识图，发现 DSH 多模态支持**硬编码、没给第三方完整接口**，只能"注册特殊模型变体绕过限制"，评价"太早期，很不完善"。
- **Bohu**：eval 发现 agent policy bug——dsh 要求调查每个非零 exit code，但 `grep` 无匹配也返回 1 → 误判失败 → **自我强化验证循环**；同任务对比 pi：请求 61 vs 32、耗时 10m38s vs 4m55s、成本 $0.17 vs $0.05、输入 token 290万 vs 54.8万。
- **0xCkvin**：装完有 "Internal Testing Notice"，官方明说核心插件和基础 API 会在未来几个月**快速演进**（= 插件接口不稳定，会变）。
- 文章结论：**"更适合开发者测试、拆解和做插件，不适合直接交给生产环境跑关键业务。"**

### 来源：[Reddit — r/DeepSeek "Harness and tools for deepseek"](https://www.reddit.com/r/DeepSeek/comments/1ug8ecg/harness_and_tools_for_deepseek)

> "it was breaking very often where it got stuck, **so much badly written code** and repeatedly trying"

直接吐槽"经常卡死、大量写得烂的代码"。

### 来源：[Hacker News（同前）](https://news.ycombinator.com/item?id=49285244)

- 有人指出插件生态的普遍宿命："插件通常因为唯一维护者失去兴趣而死；只有足够流行且对核心功能必需才能存活。"
- 也有人正面评价："DSH 插件**必须要有 cleanup handler**"（比很多框架更规范）。

---

## 六、中文社区的插件开发实录（补充视角）

- [给 DeepSeek Harness 加一双"眼睛"：全局图片识别插件的完整实现与踩坑实录（掘金）](https://juejin.cn/post/7673655608423235634) —— 与 omdp 的 dsh-vision-bridge 同类，记录了实现图片识别插件时的踩坑过程。
- [给 deepseek-harness 写一个工具插件：从开发到真实调用（博客园）](https://www.cnblogs.com/nandanghonghu/articles/22489996) —— 工具插件从零到真实调用的完整记录。
- [DeepSeek Harness 插件开发实战：从设计理念到 npm 发布（博客园）](https://www.cnblogs.com/pc2005/p/22477987) —— 含 npm 发布流程（印证 #380 的发布坑）。
- [DeepSeek Harness 拆解：一套能拼装的 Agent 架构（网易）](https://www.163.com/dy/article/L4AHS9B70518R7MO.html) —— 架构层面分析"拼装式"Agent。
- [DeepSeek 把 Harness 开源了：一切皆插件，但真正的差距在局部（博客园）](https://www.cnblogs.com/weiwuji/p/22456195) —— 对"一切皆插件"的冷静评价。

---

## 七、风险清单（AI 写 DSH 插件时高频踩雷）

综合以上来源，以下是最容易让"AI 写的插件"出问题、甚至搞崩 DSH 的点：

1. **`inject` 声明错误**（对象写法 / 漏服务）→ 插件 `pending`、启动卡住（#380）
2. **访问未注入的服务**（如 `ctx.credentials` 没在 `inject` 里）→ 每次调用抛错（omdp 实测：`cannot get property "credentials" without inject`）
3. **import `@deepseek-ai/*` 路径在 dev 链接下解析失败** → `MODULE_NOT_FOUND`（#380）
4. **原生/二进制依赖**（sharp、node-pty 等）平台不匹配 → 整个 `dsh web` 启动即崩（#535）
5. **同名服务 / section 冲突** → fail loud 或互相覆盖（#380、#326）
6. **未捕获异常** → 因单进程无隔离，可能波及整个 harness（#326）
7. **接口不稳定**：DSH rc 阶段 API 快速演进，AI 学的旧写法可能很快失效（5toy、官方 Internal Testing Notice）

---

## 八、防御建议（来自社区共识 + omdp 实践）

1. **插件只 import node 内置模块，服务全从 `ctx` 拿**（#380 作者 + omdp 一致做法）
2. **`inject` 用一维字符串数组**，需要什么服务就明确声明什么（别靠 `?.` 兜底，Cordis 的 Proxy 会在 get 时直接抛错）
3. **零依赖 / 纯 JS**：避免原生二进制（sharp/node-pty 类），从根上避开 #535 那类启动崩溃
4. **本地 link 开发 + 小步验证**：先 `dsh --dump-config` / 起一个最小会话验证，再推远端
5. **给插件加 defensive 边界**：关键调用包 try/catch、注册前查重（omdp 的 vision-bridge 已对工具重名做了 fallback）
6. **关注 rc 迭代**：DSH 接口在变，文档里标注"适用版本"，失效及时更新
7. **不要在生产环境跑关键业务**（社区共识）

---

## 九、来源清单（按类型）

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
- [博客园 — 给 deepseek-harness 写一个工具插件](https://www.cnblogs.com/nandanghonghu/articles/22489996)
- [博客园 — 插件开发实战：从设计理念到 npm 发布](https://www.cnblogs.com/pc2005/p/22477987)
- [博客园 — 一切皆插件，但真正的差距在局部](https://www.cnblogs.com/weiwuji/p/22456195)
- [网易 — DeepSeek Harness 拆解：一套能拼装的 Agent 架构](https://www.163.com/dy/article/L4AHS9B70518R7MO.html)

---

*本文档为社区公开讨论的整理与归纳，观点归属原作者；标注版本 `dsh 0.1.0-rc.6`，DSH 仍处 developer preview，接口与行为会变，请以最新官方文档为准。*
