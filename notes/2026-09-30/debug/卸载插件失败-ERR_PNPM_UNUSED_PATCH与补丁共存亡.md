# 卸载第三方插件失败：`ERR_PNPM_UNUSED_PATCH`（补丁条目与依赖共存亡）

> 分类：`debug/` · 日期：2026-09-30
> 场景：桌面端插件页对 `dsh-client-auto-continue` 点「卸载」→ 失败并回滚

## 现象

UI 报错：

```
卸载失败: ✓ Lockfile passes supply-chain policies (verified 14m ago)
Progress: resolved 1, reused 0, downloaded 0, added 0
[ERR_PNPM_UNUSED_PATCH] The following patches were not used:
dsh-client-auto-continue@^0.11.9
Either remove them from "patchedDependencies" or update them to match
packages in your dependencies.
```

关键：**这不是权限 / 沙箱 / git 问题，是 pnpm 的补丁一致性校验**。

## 根因

`pnpm-workspace.yaml` 里挂着：

```yaml
patchedDependencies:
  dsh-client-auto-continue@^0.11.9: patches/dsh-client-auto-continue@0.11.9.patch
```

卸载会把该依赖从 `dependencies` 移出，这条补丁随即**不再绑定任何包**
→ pnpm 判定「补丁未被使用」→ `ERR_PNPM_UNUSED_PATCH` **中止整次操作**。
插件管理器随后回滚 `package.json` / `pnpm-lock.yaml`
（`dsh-plugin-manager/lib/types/operations.js` 的 `restore()`），
于是表现为「卸载失败」且依赖依然在。

⚠️ 这条坑 `pnpm-workspace.yaml` 自己的注释（第 36-38 行）**早就记过**
（「补丁与该包在 dependencies 里的存在与否共存亡，否则 pnpm 报
ERR_PNPM_UNUSED_PATCH、整个操作回滚」），但当时是为「移除依赖」记的，
**没意识到「卸载」就是那个场景本身**。有记录 ≠ 有意识。

## 修复（稳定顺序）

1. 备份 `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml`；
2. **先摘 `patchedDependencies` 条目**（换成说明性注释更好，避免将来误加回）；
3. 再 remove：

```powershell
$node='C:\Users\xj\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm='C:\Users\xj\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
Push-Location "$env:USERPROFILE\.dsh\profiles\desktop"
& $node $pnpm remove dsh-client-auto-continue
```

本次实测：`exit code = 0`，2 秒完成；四处引用（`dependencies` /
`bundles` / `node_modules` / `pnpm-lock.yaml`）全部清空。

- **`.patch` 文件不必删**（无人引用即被忽略），保留以备回滚；
- 但**恢复条目必须与恢复依赖同时做**，否则又是 `UNUSED_PATCH`。

用运行时自带的 node + pnpm 执行，与插件管理器走的是同一套（pnpm 11.7.0）。

## 为什么没有改走「升级到 0.12.0」

| 版本 | `@deepseek-ai/dsh-settings` peer |
|---|---|
| `0.11.9` | `^0.1.0-rc.7 \|\| ^0.1.7-0` |
| `0.12.0` | `^0.1.0-rc.7 \|\| ^0.1.7-0` |

实测 `npm view <pkg>@<ver> peerDependencies --json` 两版输出**逐字相同**，
上游发新版但 peer 一个字符没动，升级不解决门禁问题。
`@wxg-prc-cpg/browser-skill-dsh-plugin` 同理：0.3.1 已是最新，peer 仍是 `^0.1.5-rc.3`。

→ **判定方法**：升级前先比对 peer，别凭「发新版了应该修了」就升。

## 🔴 附带发现：精确版本补丁对同三元组的后续 rc 无效

用 pnpm 内置 semver 实测（`runtimeVersion = 0.2.0-rc.2`）：

| manifest 来源 | peer 声明 | rc.2 判定 |
|---|---|---|
| registry 原文 | `^0.1.0-rc.7 \|\| ^0.1.7-0` | 拦截 |
| **磁盘（已打补丁）** | `^0.1.0-rc.7 \|\| ^0.1.7-0 \|\| 0.2.0-rc.1` | **拦截** |
| 改成三元组区间 | `^0.1.0-rc.7 \|\| ^0.1.7-0 \|\| >=0.2.0-rc.1 <0.2.1-0` | 放行 |

**精确版本 `0.2.0-rc.1` 只放行 rc.1 本身**，rc.2 不认。

这修正了
`notes/2026-09-30/dsh-compat/补丁改不了安装门禁-两道门禁与升级顺序.md`
里「补丁 ✅ 能救装后复检 / 启动加载」的说法：该结论**有前提**
——补丁内容必须对**当前**运行时版本有效。上一轮把补丁写成精确版本，
等于把补丁的寿命绑死在那一个 rc 上。连"补丁能治的那道门"也一起失效了。

→ 补丁若要继续用，追加的必须也是**区间**（与 `AGENTS.md` 规范 3 同源）；
→ 更根本地看，**内容固化、不随运行时演进是补丁路线自带的缺陷**。
能卸载、或能换到上游已修版本时，优先那么做。

## 本次改动清单

| 文件 | 改动 |
|---|---|
| `package.json` | `dependencies` + `bundles` 条目移除（`pnpm remove` 完成） |
| `pnpm-workspace.yaml` | `patchedDependencies` 中该条目删除，改写为说明性注释 |
| `pnpm-lock.yaml` | 由 pnpm 重写 |
| `patches/dsh-client-auto-continue@0.11.9.patch` | **保留**（备回滚） |

备份：`*.bak-uninstall-autocontinue-20260930-023944`（三个文件各一份）。

未动：`@wxg-prc-cpg/browser-skill-dsh-plugin`（用户明确「不用管其他的」）——
它状态相同（上游最新版 peer 仍未适配、补丁追加的是精确 `0.2.0-rc.1`），
`patchedDependencies` 里那条也仍在。

## 可复用要点

1. **`ERR_PNPM_UNUSED_PATCH` = 补丁条目失去绑定**，与网络、权限、沙箱无关；
   `patchedDependencies` 条目与 `dependencies` 依赖**共存亡**，两个方向都要同步。
2. **卸载（不只安装）会踩这个坑**：先摘条目再 remove 才是稳定顺序。
3. **别删 `.patch` 文件**（无人引用无害），但恢复时条目与依赖必须一起回来。
4. **升级前比对 peer**：`npm view <pkg>@<ver> peerDependencies --json`；
   上游常发版本而 peer 不变。
5. **精确版本补丁会随同三元组的下一个 rc 失效**——补丁里要写版本就写区间。
6. UI 文案里的 `[ERR_PNPM_...]` 是 pnpm 的真实错误码，**优先按 pnpm 语义排查**，
   别先怀疑插件本身或沙箱。
7. **自己的注释记了坑，也可能在别的动作上重新踩**：本次踩的就是自己写过的规则，
   只是触发动作从「移除依赖」换成了「卸载插件」。记录时要写清**适用动作集合**。

## 相关文件 / 命令

- `C:\Users\xj\.dsh\profiles\desktop\pnpm-workspace.yaml`（`patchedDependencies`，含本次注释）
- `C:\Users\xj\.dsh\profiles\desktop\.plugin-manager\logs\operation-*\pnpm.log`
  （门禁拒绝原文：`installation rejected ... nothing was installed`）
- 门禁安装预检实现：`dsh-plugin-manager/lib/types/operations.js:296-319`
  （`namedSpecManifest()` → `pnpm view <spec> name version peerDependencies --json`）
- 参考：`notes/2026-09-30/dsh-compat/补丁改不了安装门禁-两道门禁与升级顺序.md`
- 参考：`notes/2026-09-30/plugin-dev/peer-三元组区间取代逐版本枚举.md`
