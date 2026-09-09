# vision-bridge 粘贴失效：DSH 0.1.2-rc.1 composer 换 Lexical contenteditable

## 背景 / 问题

用户报（2026-09-09）：dsh-vision-bridge 在**文本模型**下粘贴图片"没反应、不转路径"。
预期行为：文本模型 → bridge 判定 → 图片 POST `/vision-bridge/paste` 写临时文件 → 返回路径文本 → 插入输入框。

排查期间用户附了浏览器 console，满是 BFCache 断连、better-sidebar / auto-approval 404 等
**第三方 client 噪音**——与本问题不同源，勿混为一谈。

## 根因

- **host 侧完全健康**（运行实例直连验证）：
  - `GET /vision-bridge/capabilities?label=deepseek-v4-flash` → `200 {"known":true,"multimodal":false}`（判定正确）
  - `GET /vision-bridge/paste` → `405`（路由在，POST-only）
  - 注册日志每次启动正常写入 `%TEMP%\dsh-vision-bridge-register.log`
- **client 侧回归**：DSH 在 **2026-09-04 升 0.1.2-rc.1** 时把 composer 从 `<textarea>`
  换成 **Lexical contenteditable**（源码铁证 `dsh-client-ui-conversation/lib/client.js`：
  `<div contenteditable="true" role="textbox" data-composer-input>`，注释明言
  "text surface is the shell-owned Lexical editor"，composer 区域无任何 textarea）。
- vision-bridge 0.1.9（2026-09-03 发布，验证于 DSH 0.1.0-rc.8 / 8-20）的 client `insertText()`
  首行写死 `if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) return`。
- 症状闭环：文本模型 → `imageDecision='bridge'` → `preventDefault` 吞图 + 上传成功拿 path →
  `insertText` 对 `DIV` 静默 return → 路径插不进 composer = "粘贴没反应"。
  （若 client 完全没加载，DSH 原生会显示缩略图 = 有反应；"无反应"反向佐证是拦截后插入失败。）

## 修复（v0.1.10，`dsh-vision-bridge/client.js`）

1. 新增 `editableHostOf(node)`：从事件目标向上找可编辑宿主
   （`TEXTAREA` / `INPUT` / `contenteditable="true|plaintext-only"`）。
2. 重写 `insertText(host, text)`：
   - contenteditable：`document.execCommand('insertText')` → 浏览器原生编辑管线触发
     beforeinput/input → **Lexical 同步模型**（与用户手打等价）；execCommand 未生效时
     兜底 `host.dispatchEvent(new InputEvent('beforeinput', {inputType:'insertText', data}))`。
   - textarea/input：保持原 value-setter + input 事件回退（旧 composer 行为）。
3. onPaste / onDrop 的 bridge 分支先同步解析宿主；**找不到可编辑宿主就 return 放行原生事件，
   不再吞图**（原来先 preventDefault 再插入，宿主缺失时图片被白白吞掉）。

`node --check client.js` 通过。

## 可复用要点

- **DSH 的 0.1.x 演进，client 侧最大变数是 composer 输入层**：textarea → Lexical contenteditable。
  任何"向输入框注入文本"的第三方 client 都要解析可编辑宿主，不能写死 tagName。
- Lexical 是**受控编辑器**，直接改 DOM/派发 input 无效会被 reconcile 抹掉；正确注入路径是
  走浏览器原生编辑管线（`execCommand('insertText')` 触发 beforeinput/input）或合成
  `beforeinput`（`inputType:'insertText'`）。
- host/API 层"源码零改动兼容"≠ client 层兼容：composer 元素类型、slot 树等 UI 结构变化
  不反映在 host API 核查里，需单独做浏览器层验证（详见 `docs/plugin-compatibility.md` 头部 caveat）。
- 排查顺序建议：先直连 host 路由（capabilities/paste 405 探测）排除 host，再读 client bundle
  的宿主假设；浏览器 console 满屏第三方噪音要会过滤。
- 验证状态：host 侧 0.1.2-rc.1 下已直连验证；client 插入修复逻辑与 Lexical 同步机制对齐，
  浏览器活体验证待 0.1.10 部署后补充（README 已如实标注，未虚报）。

## 相关文件

- 修复：`dsh-vision-bridge/client.js`（`editableHostOf`/`insertText`/`onPaste`/`onDrop`）
- DSH 源码参考：`@deepseek-ai/dsh-client-ui-conversation/lib/client.js`
  （composer seat / `ComposerContentEditable` / Lexical beforeinput-input 管线）
- 发布：tag `v0.1.10`（GitHub Actions publish.yml 自动发包，已发布版本自动 skip）
