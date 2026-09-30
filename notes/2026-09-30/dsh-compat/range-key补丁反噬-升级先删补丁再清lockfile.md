# range key 补丁反噬：升级时 ERR_PNPM_PATCH_FAILED，删条目后还要清 lockfile

**日期**：2026-09-30
**分类**：dsh-compat
**现象**：dshmarket 里 `@wxg-prc-cpg/browser-skill-dsh-plugin`（0.3.1→0.3.2）
与 `dsh-cost-meter`（1.7.45→1.7.46）**点「更新」都失败**，看起来毫无关系。

## 一句话结论

**两个失败同源**：profile 的 `pnpm-workspace.yaml` 里那条
`'@wxg-prc-cpg/browser-skill-dsh-plugin@^0.3.1'` 的 `patchedDependencies` 条目。
key 是 **range**，会匹配 0.3.2，pnpm 便拿 0.3.1 的旧补丁上下文去套 0.3.2 的新文件 →
`ERR_PNPM_PATCH_FAILED`，**整条 install 中止**。cost-meter 是**连带受害者**：
`pnpm add` 是**整档操作**，只要档里有一个依赖装不上，这次操作整体失败，
于是它看起来也「更新不了」。**把它当 cost-meter 的 bug 查会白查。**

## 根因链（三道，只有第一道需要改档案）

### 1. range key 会把补丁套到它从没写过的版本上

```
patchedDependencies:
  '@wxg-prc-cpg/browser-skill-dsh-plugin@^0.3.1': patches/@wxg-prc-cpg__browser-skill-dsh-plugin@0.3.1.patch
```

`^0.3.1` 匹配 0.3.2 ⇒ pnpm 重放一个只对 0.3.1 有效的补丁。报错：

```
[ERR_PNPM_PATCH_FAILED] Could not apply patch …\patches\@wxg-prc-cpg__browser-skill-dsh-plugin@0.3.1.patch
  to …\node_modules\@wxg-prc-cpg\browser-skill-dsh-plugin
```

**与「补丁内容是否已失效」是两件事**：这里连应用都过不去（上下文漂移），
比「应用成功但内容没意义」更早一步失败。

复现（两个独立环境，同一结果）：

- `%TEMP%\ptest`（全新空目录 + 只放这份 package/patch）：`pnpm add …@0.3.2` → `PACKAGES: +76` → `PATCH_FAILED`，**exit=1**；
- `%TEMP%\prof-sim`（整份实盘 profile 克隆）：同上；**删掉条目并移走 .patch 后，同一条命令 exit=0、`Done in 2.2s`**。

所以这不是「缓存的错」「网络问题」「mirror 问题」，是**档案里的条目本身**。

### 2. ⚠️ 两种 key 各有各的炸法（以前只记了半条教训）

| key 写法 | 炸法 | 实测 |
|---|---|---|
| **精确版本**（`pkg@0.11.17`） | 版本一漂移就匹配不到任何包 → `ERR_PNPM_UNUSED_PATCH`，**安装中止** | 2026-09-29 卸载 `@mars-sea/dsh-commandcode-provider` 即此 |
| **range**（`pkg@^0.3.1`） | 跟得上漂移，但把补丁**悄悄套到没写过的版本上** → `ERR_PNPM_PATCH_FAILED`，**安装中止** | 本次 browser-skill 0.3.1→0.3.2 |

⇒ **range key 不是「更稳」，只是把炸点从「匹配不上」挪到了「匹配上了但不该匹配」。**
根本对策只有一条：**上游一发新版就「升级 + 删补丁」，绝不长期挂补丁。**

### 3. 🔴 删条目之后必须清 `pnpm-lock.yaml`（本次新发现，最容易漏）

`patchedDependencies` **不只写在 `pnpm-workspace.yaml`，lockfile 里也有一份**：

```yaml
patchedDependencies:
  '@wxg-prc-cpg/browser-skill-dsh-plugin@^0.3.1': 61978fd4…      # 顶层
…
        version: 0.3.1(patch_hash=61978fd4…)                      # importers 段
  '@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.1(patch_hash=61978fd4…)': {}   # snapshots 段
```

只删 `pnpm-workspace.yaml` 的条目而不动 lockfile：

```
[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] Cannot proceed with the frozen installation.
The current "patchedDependencies" configuration doesn't match the value found in the lockfile
Update your lockfile using "pnpm install --no-frozen-lockfile"
```

**这一条必须修，不能当噪音放过**，因为两个环节都真的在用冻结语义：

- `dsh-plugin-manager` 门禁**驳回后的修复命令**就是 `install --frozen-lockfile`
  （`lib/index.js:649`，仅当回滚了 `pnpm-lock.yaml` 时才用 `--config.lockfile=false`）；
- `dshmarket` 恒以 **`CI=true`** 调 pnpm（`lib/dsh-cli.js:384`），而 CI=true 会打开 frozen-lockfile。

修法：`pnpm install --no-frozen-lockfile`，让 pnpm 自己重写 lockfile。
实测该命令**只改补丁相关的 3 处**（顶层条目、`patch_hash=…` 后缀、snapshot key），
其余 10 个依赖的 `specifier`/`version` **逐字节不变** —— 可以放心让它重写。

## 为什么 cost-meter 是「连带受害者」（机制）

1. pnpm 的 `add` 是**整档**操作：档里有任何依赖装不上，整条命令 exit≠0；
2. 更要紧的是 `dsh-plugin-manager` 装完后的**第二道门禁**（`lib/index.js:615-654`）：
   它遍历**全部直接依赖**跑 `evaluatePluginCompatibility`，
   只有 **`untouched`**（`beforeDependencies[name] === spec` 且安装前后 package.json
   字节相同 ⇒ `:622`）的包才降级为「只警告、继续留着」，
   否则把问题算进 `warnings`/`incompatible`（`:638-640`）→ **`restore()` 回滚 + `exitCode = 1`**（`:647`、`:663`）。

于是：只要档里还留着**未修好的** browser-skill@0.3.1，
**任何**「碰了档」的操作都会被这道门禁驳回 —— 表现为「cost-meter 自己更新不了」。

**实测证据**（真门禁函数 + 运行时 `0.2.0-rc.2`）：

| 包 | 版本 | 判定 |
|---|---|---|
| `dsh-cost-meter` | 1.7.45 | PASS |
| `dsh-cost-meter` | **1.7.46** | **PASS** |
| `@wxg-prc-cpg/browser-skill-dsh-plugin` | 0.3.1 | **BLOCK**（5 条 peer） |
| `@wxg-prc-cpg/browser-skill-dsh-plugin` | **0.3.2** | **PASS** |

且 `1.7.46` 与 `1.7.45` 的 peer 声明**逐字相同**（`dsh-credentials` / `dsh-home-paths`，
均为 `^0.1.0-rc.6 || … || >=0.2.0-rc.1 <0.3.0-0`）⇒ **cost-meter 侧没有任何 bug 需要修**。

日志里的旁证：cost-meter 那次失败的错误串里嵌的是 browser-skill 的 5 条 peer ——
**报错里出现谁，谁才是真凶**，报错挂在被点的那一项只是表象。

## 处置（本次实盘动作）

1. `package.json`：`browser-skill` 抬到 `^0.3.2`、`dsh-cost-meter` 抬到 `^1.7.46`
   （上游 0.3.2 已原生声明 `^0.1.5-rc.3 || ^0.2.0-rc.1`，**补丁已无必要**）；
2. `pnpm-workspace.yaml`：删掉那条 `patchedDependencies` 条目（保留说明性注释）；
3. 把 `patches/@wxg-prc-cpg__browser-skill-dsh-plugin@0.3.1.patch`
   **移出**到 `patches-removed/`（移而不是删，备回滚）；
4. `pnpm install --no-frozen-lockfile` 重写 `pnpm-lock.yaml`，消除 `CONFIG_MISMATCH`。

**验证**（两条点击顺序都跑通，`CI=true` 复刻 dshmarket 的真实调用）：

| 顺序 | 结果 |
|---|---|
| 先 browser-skill 再 cost-meter | 两步都 exit=0；磁盘 0.3.2 / 1.7.46 |
| **先 cost-meter（最坏顺序）** | 也 exit=0：browser-skill 被顺带装成 0.3.2 —— 因为钉版已是 `^0.3.2` |

两条顺序都收在：全量门禁 `evaluatePluginCompatibility`（运行时 `0.2.0-rc.2`）
**异常项 0**、`patch_hash` / `patchedDependencies` 在 lockfile 里 **0 命中**、
`install --frozen-lockfile` **exit=0**。

> 顺序无关性**依赖于把钉版一并抬高**：若只删补丁条目、不改 `^0.3.1` 钉版，
> 则「先点 cost-meter」会把 browser-skill 装回**未打补丁的 0.3.1** → 立刻被门禁 BLOCK。
> 这正是 `pnpm-workspace.yaml` 注释里那条「删补丁必须同时抬钉版」的由来。

## 可复用要点

1. **`patchedDependencies` 会污染整个 profile 的所有安装操作**。症状可能是
   「另一个完全无关的包更新失败」——**先看报错里嵌的是谁的 peer/名字**。
2. **range key ≠ 安全**：它把 `UNUSED_PATCH` 换成了 `PATCH_FAILED`。
   升级第三方插件时，**先删补丁（连同 lockfile 里的记录）再升级**，
   或干脆「升级 + 删补丁」一步做完。**别让它长期挂在档里。**
3. **删 `patchedDependencies` 条目后必须让 pnpm 重写 lockfile**
   （`pnpm install --no-frozen-lockfile`），否则冻结安装报 `LOCKFILE_CONFIG_MISMATCH`，
   而 `dsh-plugin-manager` 的修复路径与 `dshmarket` 都走冻结语义。
4. **优先等上游原生修复**：`browser-skill` 0.3.2、`cost-meter` 1.7.44、
   `dshmarket` 1.66.5、`dsh-watcher` 0.7.0 都已原生支持 0.2.0-rc.1；
   补丁只应作临时桥接，上游一发新版就退场。
5. **验证要覆盖「点击顺序」**：用户先点哪一个不由我们决定，
   而本次两条顺序的失败/成功机制**并不相同**，只测一条会漏。
