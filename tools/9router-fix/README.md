# 9router OpenCode 免费层热修

修复 9router 走 OpenCode Zen 免费层（`oc/<model>`、`Authorization: Bearer public`）时报
`403 FreeTierError` 的问题。

```
HTTP 403: {"type":"error","error":{"type":"FreeTierError",
"message":"Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"}}
```

## 为什么需要它

OpenCode 于 2026-09-17 起在 `https://opencode.ai/zen/v1/*` 上加了客户端门禁，
以下**两个条件必须同时满足**，否则 403：

1. `User-Agent` 为 `opencode/<maj>.<min>.<patch>` 且版本 **≥ 1.17.0**
   （裸 `opencode` / 外来 UA → 403；有版本但 < 1.17.0 → 426 UpgradeRequired）；
2. `x-opencode-session` 匹配 `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$`。

9router（含当前上游 master）两者都违反：UA 发裸 `"opencode"`，
session 发 `ses_` + 32 位 hex。本脚本就地修正编译产物中的这两处。

## 用法

```bash
node fix-opencode-freetier.cjs --check     # 只体检，退出码 1 表示存在漏洞
node fix-opencode-freetier.cjs --apply     # 打补丁（幂等；自动带时间戳备份）
node fix-opencode-freetier.cjs --restore   # 回滚到最近的备份
```

自定义安装位置（默认自动探测 Windows `%APPDATA%\npm` 与 Unix 全局 npm 路径）：

```bash
node fix-opencode-freetier.cjs --apply --dir "C:\path\to\node_modules\9router"
# 或设置环境变量 NINEROUTER_DIR
```

可覆盖注入的默认版本号：

```bash
NINEROUTER_OPENCODE_UA=opencode/1.19.0 node fix-opencode-freetier.cjs --apply
# 也可在 9router 运行时通过同名环境变量覆盖
```

**打完补丁必须重启 9router**——Next.js 构建产物在进程启动时载入内存：

```powershell
# Windows：结束 server 进程，父级 CLI 会自动重启它
Stop-Process -Id (Get-NetTCPConnection -State Listen -LocalPort 20128).OwningProcess -Force
```

## 行为

- 已是规范格式的 `x-opencode-session` **原样透传**；
  其他值通过 `sha256` **确定性地**映射为规范格式，保证粘性会话与上游 prompt cache 不失效。
- 下游 UA 若已是 `opencode/` 且版本 ≥ 1.17.0，**原样透传**（保留真实客户端标识）。
- 只修改 `buildHeaders()` 中两个表达式，纯函数、无副作用，不触碰请求体或路由。
- 备份文件与目标同目录，命名 `318.js.bak-<ISO 时间戳>`。

## 注意

这是对**已发布构建产物**的本地热补丁。上游 master 尚未修复，
任何 `npm i -g 9router` 都会覆盖它——升级后重跑 `--apply` 即可。

排查细节与实测数据见 `../../notes/2026-09-17/debug/9router-opencode-freetier-403.md`。
