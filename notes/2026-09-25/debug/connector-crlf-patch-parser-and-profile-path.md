# CRLF 的 cordis.patch.yml 让「工具过滤」整块消失 + 插件改错 profile 的补丁文件

- 日期：2026-09-25
- 插件：`@omdp/dsh-connector`（0.3.5 → 0.3.6）
- 环境：DSH 桌面版 0.1.7-rc.2（跑 `C:\Users\xj\.dsh\profiles\desktop`）
- 关联：`docs/plugin-compatibility.md` 0.1.7 专项「变更 7」「变更 8」

## 现象

用户在桌面端打开「设置 → Connector → MCP 服务器」：四张 server 卡片只剩
名字 + `stdio` 徽标 + 编辑/删除按钮，**「工具过滤 Tool filter」整块不见了**（连
「工具列表加载中…」这类提示都没有），而 tavily / tinyfish 明明是 `streamable-http`，徽标却都写着 `stdio`。

同一时刻后端**过滤仍然生效**（Agent 能看到 `mcp__tinyfish__*` 只剩 `search` / `fetch_content`），
`GET /connector/api/mcp/filters` 也返回了 `{"tinyfish":{"allow":["fetch_content","search"]}}`
——说明不是数据丢失，是**解析/展示**出了问题。

## 根因（两个独立 bug，都在插件侧）

### 1. CRLF 让逐行解析器静默失配（直接触发本次现象）

`index.js` 的 `parseMcpServers()` 逐行解析 MCP 块：

```js
const lines = blockText.split('\n')          // 修复前
const kv = line.match(/^\s+(\w+):\s*(.*)$/)  // ★ CRLF 下必然失败
```

JS 里 `.` **不匹配** `\r`，`$`（无 `m` 标志）也**不匹配 `\r` 之前的位置**。CRLF 文件的每一行都以
`\r` 结尾，于是这一行匹配失败，`transport`/`serverName`/`command`/`url` 全部落进
「原样保留」的 `preserve` 桶（设计上用于 env 块、`!!js` 表达式等未建模行），
`cur.serverName` 保持初始值 `''`。

前端 `ToolFilterBox` 的第一句就是：

```js
if (!props.serverName) return null    // 静默不渲染任何东西
```

⇒ 工具过滤区彻底消失；`transport:""` 又让 `badge(s.transport || 'stdio')` 一律显示 `stdio`。
`- id:` 那一行之所以还能解析出来，是因为它的正则用的是 `\s*$`（`\s` 能吃掉 `\r`）。

**换行是怎么变成 CRLF 的**：本次事故中是我自己用 PowerShell `Set-Content` 重写
`cordis.patch.yml` 时把原来的 LF 全量转成了 CRLF（`Get-Content` 去换行 → `Set-Content`
按平台换行重新拼接）。改前备份是 `LF(0 CRLF, 419 LF)`，改后是 `CRLF(413 CRLF, 0 LF)`。
用户手改/编辑器保存同样会触发——这是插件必须自己防住的输入形态。

### 2. `patchPath()` 硬编码 `profiles/web`（顺带挖出的第二个 bug）

```js
function patchPath() {
  return join(resolveHome(), 'profiles', 'web', 'cordis.patch.yml')   // 修复前
}
```

桌面端实际跑的是 `profiles/desktop`（命令行证据：

```
"D:\DeepSeek Harness\DeepSeek Harness.exe" --expose-internals
  "…\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js"
  "…\app.asar\dsh"  C:\Users\xj\.dsh\profiles\desktop  …
```

）。于是桌面端「MCP 服务器」面板读写的其实是 **web profile** 的文件：对自己的 MCP 配置毫无影响，
UI 提示还把 `编辑 profiles/web/cordis.patch.yml…` 明晃晃写出来误导排障（两个 profile 的 MCP 块当时
恰好逐行一致，症状才没暴露）。

## 修复（0.3.6）

1. **解析前归一化换行**：新增 `toLf(text)`（`String(text).replace(/\r\n?/g, '\n')`），
   `parseMcpServers()` 入口先过一遍；写回时 `buildPatch()` 的结果也统一成 LF。
   这样 `stripQuotes()` / `stripListScalar()` 里同样以 `$` 锚定的正则一并恢复。
2. **补丁路径问 `profileContext`**：0.1.7 起 `dsh-app-boot` 提供

   ```ts
   interface ProfileContext { name; dir; patchPath; installAnchor; cwd; home; … }
   declare module '@deepseek-ai/cordis' { interface Context { profileContext: ProfileContext } }
   ```

   `apply()` 里 `ctx.get('profileContext')`，有就用它的 `patchPath`，无（0.1.5/0.1.6）则回退历史路径。
   `GET /connector/api/mcp` 顺带回传 `patchPath`，设置页提示改为显示真实路径。

## 验证

- **解析回归**：把仓库源码里的解析函数抽出来在 node 里跑（LF / CRLF 双形态 × 6 项断言 + patchPath 2 项）。
  - 用 `git show HEAD:dsh-connector/index.js`（修复前）跑：**CRLF 组 4 项全红**（`serverName`/`transport`/`command` 全是 `""`），
    patchPath 也忽略注入的 profile 路径；LF 组全绿。
  - 修复后：**14/14 通过**。
- **真机复核**：修好换行后直接打桌面端接口
  `GET http://127.0.0.1:19387/connector/api/mcp` → 四个 server 的 `transport`/`serverName` 全部正确
  （`context7`/`github`/`tavily`/`tinyfish`，含两个 `streamable-http`）；`…/mcp/tools/tinyfish` → 28 个工具。
  UI 按 F5 后工具过滤区回归。
- **文件无损**：忽略换行后与改前逐字节一致（`-replace "\r",''` 后比较为 `True`），且有
  `cordis.patch.yml.bak-eol-20260925` 备份。

## 可复用要点

1. **JS 正则与 CRLF**：`$` 不匹配 `\r` 前的位置、`.` 不吃 `\r`。任何「读用户可编辑文本 → 逐行 `match`」
   的地方，入口统一 `replace(/\r\n?/g, '\n')`；`split('\n')` 之后别忘了值里可能残留 `\r`。
2. **写文件必须显式选换行**：PowerShell `Set-Content` / `Out-File` 在 Windows 上会用 CRLF，
   改配置文件的脚本要么用 `[System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))`
   自己控制，要么改完立刻把换行恢复回去（`-replace "\r\n","\n"`）。
3. **插件不要自己拼 profile 路径**：用 `ctx.get('profileContext').patchPath` / `.dir`；
   同一台机器上多个 profile 的 `cordis.patch.yml` 内容可能不同，「读 → 改 → 写」必须锁定当前 profile。
4. **前端 `return null` 会掩盖后端问题**：`ToolFilterBox` 的 `if (!props.serverName) return null`
   让「后端解析失败」表现成「功能不存在」。排查时**先打接口看字段**（`curl …/connector/api/mcp`），
   比在 UI 上猜快一个数量级。
5. **改动别人的配置文件前先记录换行/编码**：`CRLF=0, LF=419` 这种计数五秒就能拿到，
   却是这次事故能立刻定性的关键证据。
