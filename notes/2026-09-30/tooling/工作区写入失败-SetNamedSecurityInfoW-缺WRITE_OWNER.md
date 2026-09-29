# 工作区写入被 Windows 文件权限挡住：`SetNamedSecurityInfoW failed (Win32 5)`

> 分类：`tooling/` · 日期：2026-09-30
> 场景：清理 `.scratch/` 时，所有涉及工作区的 pwsh 调用**齐刷刷失败**

## 现象

删临时文件时，连续三条命令（列目录、统计、grep）**全部**失败，报错完全一样：

```
Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\WorkSpace\omdp)
```

Win32 错误码 `5` = `ACCESS_DENIED`。

两个识别特征：

1. **与命令内容无关** —— 只读的 `Get-ChildItem` 和 `grep` 也照样失败。
   说明失败发生在**沙箱给工作区授权（provisioning）这一步**，
   还没轮到命令本身执行；
2. **报错里点名的是工作区根目录** `D:\WorkSpace\omdp` —— 这就是问题对象。

⚠️ 极易误判为「命令写错了」「路径打错了」「沙箱策略不允许这个操作」。
实际上命令一个字都没问题，是**工作区自身缺少一项权限**。

## 根因

沙箱要把工作区授权给自己（`grantWrite`），而**授予权限这个动作本身**
需要调用者在目标目录上同时具备两项权利：`WRITE_DAC`（改权限）和
`WRITE_OWNER`（改所有者）。实测该目录：

| 权利 | 修复前 | 修复后 |
|---|---|---|
| `WRITE_DAC`（改权限） | ✅ true | ✅ true |
| `WRITE_OWNER`（改所有者） | ❌ **false** | ✅ true |

`WRITE_DAC` 有、`WRITE_OWNER` 缺 → 授权失败 → 整条命令链失败。

值得注意：**目录所有者就是当前登录用户本人**（`IS_CURRENT_USER=True`），
但所有者身份**不等于**自动拥有 `WRITE_OWNER` 的**有效权利**
——该目录的显式 ACE 里没有当前用户的条目（`MY_RIGHTS=[]`）。

## 处置

用 `diagnose-windows-sandbox-acl` 技能自带脚本，**一次调用同时诊断 + 修复**
（该脚本无模式开关；`-Path` 与 `-AllowRoot` 会连带检查整条祖先链）：

```powershell
& '<skill目录>\scripts\diagnose-windows-sandbox-acl.ps1' `
    -Path 'D:\WorkSpace\omdp' -AllowRoot 'D:\WorkSpace\omdp' `
    -Out 'D:\WorkSpace\acl-recovery'
```

⚠️ **必须用未受限方式运行**：脚本要写权限，受限令牌下跑只会把沙箱自身的限制
误报成「缺少权利」。未受限 ≠ 提权（本次令牌仍是 Medium 完整性）。

结果：

```
VERDICT=PRECONDITION                      # 无法同时以 WRITE_DAC + WRITE_OWNER 打开
GRANTED D:\WorkSpace\omdp                 # 补一条当前用户 FullControl 允许项
verification: status=verified
  after: {writeDac: true, writeOwner: true}
SUMMARY FIXED=0 GRANTED=1 REFUSED=0 RESTORED=0
```

`nextAction = verify_original_confined_operation` → 重跑原操作即成功。

**改动只加了一条允许项，文件内容与所有者都没变**；备份与回滚脚本：
`D:\WorkSpace\acl-recovery\acl-backup-0fb7f16ef33f400ebc5d22116b3444c0.json(.ps1)`
（`-Out` 要选持久、用户可写的目录，**别放技能资源目录**——技能卸载时会被删）。

## 附带观察

- 祖先链上 `D:\WorkSpace` 同样缺 `WRITE_OWNER`，但**未被选中修复**
  —— `-AllowRoot` 把它挡在范围外（只改「该目录本身或严格位于其下」的对象，
  避免为修一个工作区去动它的上级）。
- `D:\` 连 `WRITE_DAC` 都没有且属主是 `S-1-5-18`（SYSTEM），**属正常**，非故障。
- 子树扫描 1077 个对象、9 个显式应用包允许项 `packageSources=[]`，
  **未发现** `S-1-15-2-*` 类多余权限项，故本次无需清理。

## 与本次任务的关系

这是**纯环境故障**，与「清理临时文件」这件事本身无关——
只是清理动作恰好是第一次触碰工作区，把早已存在的权限缺失暴露出来。
任务本身（删 `.scratch/`、删会话临时脚本）在权限修复后正常完成。

## 可复用要点

1. **同一报错、与命令内容无关、且点名工作区根** ⇒ 直接判定为
   **工作区权限 provisioning 失败**，不要反复改写命令。
2. `SetNamedSecurityInfoW ... Win32 5` = `ACCESS_DENIED`；
   `grantWrite(<路径>)` 里的路径就是待修对象。
3. 缺的往往是 **`WRITE_OWNER`**（`WRITE_DAC` 通常已具备）——
   而「我是所有者」**不**保证有效权利。
4. **诊断与修复一次调用完成**，别拆成「先看报告、再请求修一次」：
   脚本设计上就是同一轮完成，拆开等于多要一次授权。
5. 修完**重跑原操作**才算验证；`completed` 不等于 `verified`，
   **只信 `verification` 记录**。
6. 保留 `-Out` 目录与回滚脚本，直到确认环境稳定；
   本次 `D:\WorkSpace\acl-recovery` 即为该用途。

## 相关文件

- 诊断/修复脚本：`diagnose-windows-sandbox-acl` 技能 → `scripts/diagnose-windows-sandbox-acl.ps1`
- 备份与回滚：`D:\WorkSpace\acl-recovery\acl-backup-0fb7f16ef33f400ebc5d22116b3444c0.json(.ps1)`
- 完整报告：`D:\WorkSpace\acl-recovery\acl-report-8142215160b54771967afb2d45179791.jsonl`
- 被阻塞的任务：清理 `.scratch/`（见 `.gitignore` 第 42 行注释）
