# 9router v0.5.86 自己修好了 Zen 免费层门禁——热补丁正式退役

## 背景 / 命令

```bash
npm i -g 9router@latest --prefer-online
```

升级过程踩了两个坑，最后得到一个重要结论：**我们那个热补丁被上游吸收了**。

## 升级过程踩的坑

### 1. `EEXIST`：npm 拒绝覆盖旧启动垫片

```
npm error code EEXIST
npm error path C:\Users\xj\AppData\Roaming\npm\9router
npm error File exists: C:\Users\xj\AppData\Roaming\npm\9router
```

`%APPDATA%\npm\9router` 是上次安装生成的 **npm 启动垫片**（shim，821 字节，`#!/bin/sh`），
npm 升级时不会原地覆盖它。处理：删掉这三条垫片，npm 安装时会重新生成。

```powershell
Remove-Item "$env:APPDATA\npm\9router","$env:APPDATA\npm\9router.cmd","$env:APPDATA\npm\9router.ps1" -Force
```

**注意**：删垫片是安全的（纯派生物），但**不要**去删 `node_modules\9router`。

### 2. postinstall 被 npm 的 allowScripts 策略拦截

```
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   9router@0.5.86 (postinstall: node hooks/postinstall.js)
```

9router 的 postinstall 只做**运行时依赖预热**（把 better-sqlite3 等灌进
`~/.9router/runtime`），源码注释明确写「失败非致命，cli.js 运行时重试」：

```js
// Postinstall: warm-up SQLite deps into ~/.9router/runtime so the first
// `9router` start doesn't need network. Failure here is non-fatal
```

手动补跑即可（或 `npm install -g --allow-scripts=9router`）：

```bash
node "$APPDATA/npm/node_modules/9router/hooks/postinstall.js"   # -> ✅ SQLite engine ready
```

### 3. 构建产物换名了：`318.js` → 新布局

**重要**：v0.5.86 里原来的 `app/.next-cli-build/server/chunks/318.js` **不存在了**。
整个 OpenCode 相关实现被拆到多个 chunk：

| chunk | 内容 |
|---|---|
| `5330.js` | OpenCode 执行器（`buildHeaders` / `transformRequest` / `buildUrl`） |
| `6249.js` | `opencode-zen` provider + **规范 session 生成** + 必需工具集字面量 |
| `8499.js` | **工具集注入 + 响应侧工具名回映射**（`Ke`） |

> 教训：**补丁脚本不要硬编码 chunk 文件名**。我们的 `fix-opencode-freetier.cjs`
> 是先按目录扫描 + 锚点内容匹配定位的，所以 upgrade 后没有静默改错文件，只是
> 「找不到执行器」——这个设计是对的，要保留。

## 核心结论：是 9router 修好了，不是 Zen 放宽了

**这个区分至关重要**，靠 A 层（直连上游）做对照组：

| 观察 | 未打补丁 v0.5.86 的结果 | 含义 |
|---|---|---|
| **A 层**：逐条破坏四条判据 | 仍然 `403 FreeTierError` / `426 UpgradeRequired`（`read` 缺失→403、`bash` 缺失→403、`tools` 缺失→403、非流式→403） | **Zen 门禁一个字都没变** |
| **C 层**：经 9router 端到端 | **6/6 全 200**（4 chat + 2 responses，有无工具皆 200） | **9router 自己满足了门禁** |

如果 A 层也放行了，那结论会是「Zen 放宽了」，补丁同样是废的但**原因完全不同**，
且未来还可能再收紧。**没有 A 层这个对照组就会把两种原因混为一谈。**

## 上游是怎么实现的（且与官方源码一致）

`chunks/6249.js` 模块 17373：

```js
let l = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;                    // 规范 session 正则
let m = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let n = ["bash","glob","grep","read"];                          // ← 必需工具集（注入用）
function o(a = Date.now()) {
  let b = ~(4096n * BigInt(a) + 1n);                            // ← 官方 descending() 算法
  let c = Array.from({length:6}, (_,i) =>
    Number(b >> BigInt(40 - 8*i) & 255n).toString(16).padStart(2,"0")).join("");
  return `ses_${c}${...randomBytes(14) → base62 14 位...}`;       // 12 hex + 14 base62
}
```

- session 用的是**官方 `identifier.ts` 的 descending 时间算法**（我在前面两篇笔记里
  从官方源码逐行核对过），说明上游是**照官方实现对齐**的，不是碰运气。
- `8499.js` 里 `d = ["bash","glob","grep","read"]` + 一个 **name 映射表**：
  注入时把调用方的别名映射成必需名，响应里再把工具调用名**映射回原名**——
  这解决了我之前分析出的「注入的假工具被调用怎么办」问题，比我们的空壳注入更完备。
- UA 回退值是 `"opencode/1.18.31"`，`transformRequest` 开头强制 `b.stream=!0`。

数据库侧的**直接证据**（`requestDetails.providerRequest`）：

| 通道 | 调用方发的 | 9router 实际发往 Zen |
|---|---|---|
| responses（muse-spark） | 只有 `read` 1 个 | `{read,bash,glob,grep}` **4 个，扁平形状** |
| chat（nemotron） | 4 个 | 4 个，**nested 形状** |

按通道给正确形状——正是我们上一轮踩到 400 `tools[0]` 才发现的区别。

## 可复用要点

- **依赖升级后，先问「我这补丁还需要吗」，再问「怎么适配」。** 这次答案是前者：
  上游把整件事做了，适配就是放弃。`--check` 现在会直接给这个结论（exit 0 +
  `nothing to patch`），不再用「找不到执行器」把人引向错误方向。
- **判断「上游修复」还是「对方放宽」必须留对照组**：本地路径绿灯 + 直连路径红灯
  = 上游修复；两条都绿灯 = 对方放宽。只测一条会把结论搞反。
- **`--apply` 要能在「不需要」时安全跳过**，而不是硬改：检测到上游自修复就 exit 0。
- **npm 全局升级的三个常见噪音**：`EEXIST`（旧 shim）、`allowScripts` 拦截
  postinstall、构建产物换名/换布局。前两个不影响正确性，第三个要重新定位。
- **工具的价值会从「修」转向「验」**：补丁退役了，但三层验证与判据文档仍是
  升级后的回归测试 —— 因为门禁随时可能再变。

## 相关文件与命令

- 升级后自检：`node tools/9router-fix/fix-opencode-freetier.cjs --check`
- 三层验证：`node tools/9router-fix/verify-opencode-freetier.cjs`
- 上游证据位置：
  `%APPDATA%\npm\node_modules\9router\app\.next-cli-build\server\chunks\{5330,6249,8499}.js`
- 前序笔记：
  [`../../2026-09-17/debug/9router-opencode-freetier-403.md`](../../2026-09-17/debug/9router-opencode-freetier-403.md)、
  [`../../2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md`](../../2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md)
- DSH 侧只给 `pwsh` 的原因：
  [`../../2026-09-18/dsh-internals/windows-shell-tool-pwsh-not-bash.md`](../../2026-09-18/dsh-internals/windows-shell-tool-pwsh-not-bash.md)
