# 工具结果能不能带图片？—— 能，而且多模态路由就该这么交付（vision-bridge 0.1.12）

> 2026-09-10 ｜ 分类：dsh-compat ｜ 相关插件：`@omdp/dsh-vision-bridge`（0.1.12）

## 背景 / 问题

0.1.11 修掉"路由误判"之后，用户立刻问了一个更根本的问题：

> 「现在多模态模型为什么还主动调用视觉插件，你完善一下」

症状：当前模型本身就能看图（多模态路由），却还是调用了 `vision_bridge_read_image`，
然后插件回一句：

> 当前模型支持图片输入，请直接阅读图片附件或图片内容，无需调用本桥。

这次调用就彻底白费了——模型想看图，桥却说"你自己看吧"，而模型手里往往只有一个**路径**
（用户给的、或粘贴流程给的），它并不能凭空看到文件。

## 结论（DSH 契约）

**工具结果可以直接携带图片块，且这正是 DSH 原生 `read_image` 的做法。**
契约（DSH 0.1.5-rc.1，`dsh-tool-fs/lib/index.js` 的 `read_image`）：

```js
output: {
  schema: {...},
  render: (_args, value) => [
    { type: 'text',  text: '<path>…</path>\n<type>image</type>\n<content>…</content>' },
    { type: 'image', attachment: ref },   // ← 图片本体就在这里回到模型
  ],
}
```

附件引用由 `attachments` 服务产出：

| 方法 | 形态 | 说明 |
|---|---|---|
| `saveImages(inputs)` | `[{data, mediaType, name?}] → ImageAttachmentRef[]` | 批量：先校验全部再落盘（原子） |
| `saveImage(input)` | `{data, mediaType, name?} → ImageAttachmentRef` | 单张抽象方法，**DSH 核心 `read_image` 用的就是这个** |
| `readImage(ref, signal)` | `→ {ref, data}` | 反向读取（插件粘贴转证据已在用） |
| `imageLimits` | `{mediaTypes, maxImageBytes, maxMessageImageBytes, maxImagesPerMessage, …}` | 部署侧图片策略，提交前先自查 |

`ImageMediaType` 只有四种：`image/png` / `image/jpeg` / `image/webp` / `image/gif`（HEIC 等一律进不了附件）。

顺带印证 0.1.11 的判断：`read_image` 的路由闸门注释原文就是
「Resolves the session's latest routed provider/model (**request header config, then agent options**)」。

## 0.1.12 的做法

工具执行时按路由分三种走向：

1. **多模态路由 + 本地图片** → `attachments.saveImages` 提交 → 返回
   `{branch:'native-image', images:[{path, image}], text: 信封}`，`render` 输出
   `[文本信封, 图片块]`。模型这次调用拿到的是**图本身**（等价原生读图，不经代读端点）。
2. **多模态路由 + 交付不了**（URL / HEIC / 超配额 / 附件服务不可用）→ **不拒绝服务**，
   直接落到代读端点，把文字描述给模型，并在结果开头写明原因。
3. **纯文本路由** → 原样走代读端点（`branch:'text'`）。

`force=true` 语义随之明确：**即使能原生看图，也强制走文字代读**（想拿 OCR/摘要而不是图时用）。

## 可复用要点

1. **工具不该"因为模型自己能做"就拒绝干活**：拒绝只会浪费一次往返，模型手里可能只有路径。
   正确做法是把它要的东西递过去（本地图 → 附件 + 图片块），或者在交付不了时退到可用路径。
2. **服务方法宁可"两个都认"**：批量 `saveImages` 原子性更好，但 `saveImage` 是核心在用的抽象方法；
   两个都探测（先批量、后单张），就不必赌某个版本上哪个存在。
3. **提交前先查 `imageLimits`**：`mediaTypes`（HEIC 白搭）、`maxImagesPerMessage`、
   `min(maxImageBytes, maxMessageImageBytes)` —— 自查一遍比让服务抛错更可控。
4. **宿主对象只取标量**：`ImageAttachmentRef` 逐字段拷成自有对象（`attachmentId/mediaType/bytes/width/height/name?/originalDimensions?`），
   绝不整体搬运或 `JSON.stringify` 活体数据。
5. **回归测试要覆盖降级**：本插件测试里锁定了「无附件服务 / 无保存方法 / 超图数上限 /
   文件不存在 / URL / 非图片文件」六条降级路径都必须返回 `{ok:false, reason}` 而不是抛错
   （`dsh-vision-bridge/test/route-resolution.test.mjs`）。

## 验证情况

- 离线：`node dsh-vision-bridge/test/route-resolution.test.mjs`（路由优先级 + 渲染 + 降级契约，全绿）。
- 契约：比对 DSH `read_image` 源码（同一注册表、同一图片块形状）。
- 活体：本次会话的动态探针（真跑一次 `tryNativeImageDelivery`）被审批分类器拦下，未执行；
  端到端验证落在重启后的人工测试（多模态会话里给一个本地图片路径，看模型是否收到图）。
