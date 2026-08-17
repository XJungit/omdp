# dsh-drag-and-drop 插件排查记录（Windows 中文环境）

> 排查日期：2026-08-17
> 环境：Windows 11 + DSH 0.1.0-rc.6 + Node 24 + Everything 1.4.1/1.5
> 插件：`@omdsh-dev/dsh-drag-and-drop` v0.1.5（原版，bill9109/omdsh-dev）
> 相关插件：`@dsh-external/dsh-drag-to-attachment` v1.0.2（移植版，djt889）

## 问题现象

拖文件到 DSH 聊天框，**时灵时不灵**：
- 有的文件能定位（插入真实路径），有的不能（提示"未能定位原始路径"）
- 中文文件名（如 `新建 文本文档 (3).txt`）**必失败**
- 英文文件名（如 `README.md`）**能成功**
- 频繁弹出 **"命令行选项 - Everything"** 窗口

## 根因（多层 bug 叠加）

### Bug 1：`-whole-filename` 参数无效（第一层）

插件 `windowsSearch` 调 es.exe 用 `-whole-filename`，但 **ES 1.1.0.37 不支持该开关**（报 `Error 6: Unknown switch`，输出帮助文本）。

```
es.exe -n 5 -whole-filename "x"  → 帮助文本（失败）
es.exe -n 5 -w "x"               → 正常结果 ✅
```

### Bug 2（核心）：GBK 编码错误 → 中文文件名必失败

**真正的"时灵时不灵"元凶**。插件 `host.exec` 用默认 **UTF-8 解码** es.exe 输出，但 **es.exe 在中文 Windows 输出 GBK**：

```js
// 插件错误实现：无 encoding:'buffer'，默认 UTF-8 解码 → 中文乱码
const { stdout } = await execFileAsync('es.exe', [...], { ... });

// 正确实现：buffer + GBK 解码
const { stdout: rawOut } = await execFileAsync('es.exe', [...], { encoding: 'buffer', windowsHide: true });
new TextDecoder('gbk').decode(rawOut);  // → 中文正常
```

- 英文文件名（ASCII）→ UTF-8/GBK 都无差异 → **能定位**
- 中文文件名 → GBK 被 UTF-8 解码 → 乱码（`�½� �ı��ĵ�`）→ `basename === item.name` 失败 → **not-found**

### Bug 3：插件调用 `Everything.exe`（GUI）→ 弹"命令行选项"窗口

`windowsSearch` 循环 `["es.exe", "Everything.exe"]`，当 es.exe 不在 PATH 时**调用 `Everything.exe`（GUI 程序）**，用命令行参数启动 → **弹出"命令行选项"窗口**。

### Bug 4（环境/安装问题）：Everything 未正确安装

- 最初装在**中文路径** `D:\下载\Everything\portable`（应避免中文路径）
- 便携版**未开启 NTFS 索引**（索引数 0）→ es.exe 搜不到
- 需要**安装为服务**（`Everything 服务`）才能后台常驻 + 索引 NTFS

## 排查方法（关键技巧）

1. **直接加载插件模块测函数**：`node --input-type=module -e "import(...)"` 直接调 `indexedSearch`，隔离出"插件逻辑本身正常"还是"DSH 调用链问题"
2. **发现 lib/index.js vs lib/types/ 两份代码**：插件主入口 `lib/index.js` **内嵌**了自己的 `windowsSearch`（L245），`src/platform-search.ts` 编译的 `lib/types/platform-search.js` **可能未被引用**——**修错文件是排查中的大坑**
3. **用 `new TextDecoder('gbk')` 对照**：同一 es.exe 输出，UTF-8 解码 vs GBK 解码，立即暴露编码 bug
4. **监视 Everything 窗口**（`EnumWindows` + `IsWindowVisible`）：精确定位弹窗触发点

## 修复方案（本地已应用）

修改 `node_modules/@omdsh-dev/dsh-drag-and-drop/lib/`：

### lib/index.js（主入口，必须改）
```js
// 1. 循环只保留 es.exe（去掉 Everything.exe，避免弹窗）
for (const command of ["es.exe"]) {

// 2. es.exe 调用改 GBK buffer 解码
const { stdout: rawOut } = await execFileAsync(command, ["-n", String(100), "-w", name],
  { encoding: 'buffer', windowsHide: true });
return lines(new TextDecoder('gbk').decode(rawOut));
```

### lib/types/platform-search.js（保持一致）
```js
// 同样：只保留 es.exe + GBK 解码
for (const command of ['es.exe']) {
const { stdout: rawOut } = await execFileAsync(command, ['-n', String(PLATFORM_MAX_CANDIDATES), '-w', name],
  { encoding: 'buffer', windowsHide: true });
return lines(new TextDecoder('gbk').decode(rawOut));
```

### Everything 正确安装
1. 装到**英文路径**（如 `C:\Users\xj\Everything`）
2. **安装为服务**（GUI 提示时选"安装 Everything 服务"）→ 后台常驻 + 索引 NTFS + 开机自启
3. es.exe 也可复制到 `%LOCALAPPDATA%\Microsoft\WindowsApps`（Windows 默认 PATH）

## 最终验证结果

| 测试 | 结果 |
|---|---|
| 中文文件（新建 文本文档 (3).txt） | ✅ `found`，路径正确 |
| 英文文件（README.md） | ✅ `found` |
| 连续多次调用 | ✅ 全部 `found` |
| 弹窗 | ✅ 无窗口 |

## 已提交的 Issue

| 仓库 | Issue | 内容 | 准确性 |
|---|---|---|---|
| djt889/dsh-drag-to-attachment | #1 | spawn 崩溃 + files 漏 vendor | ✅ 准确（独立实证） |
| bill9109/dsh-drag-and-drop | #4 | `-whole-filename` 参数 bug | ⚠️ 部分准确，已追加评论补充 GBK 核心 bug + 修正文件位置 |

## 经验教训

1. **排查必须找到"实际运行的代码"**——插件可能有多个实现文件（lib/index.js 内嵌 vs 编译产物），改错文件=白改
2. **中文 Windows 的 GBK 编码**是隐藏杀手——es.exe/PowerShell 输出编码与 Node 默认 UTF-8 不一致
3. **不要硬编码中文路径**——Everything 等工具应装英文路径
4. **GUI 程序被命令行调用会弹窗**——插件应只调 CLI（es.exe），绝不调 GUI（Everything.exe）
5. **测试 mock 掩盖真实 bug**——作者测试 mock 了 es.exe，从未真实验证，导致"测试通过但真实失败"

## 别人怎么安装 Everything（标准方式）

**不需要复制 es.exe、不需要特殊操作**。插件只要求 **`es.exe` 在 PATH 里**（`commandExists` 用 `where.exe` 查 PATH）。

### 推荐（官方安装器 + 服务）

```sh
# 1. 下载官方安装器
#    https://www.voidtools.com/downloads/ → Everything-1.4.1.1032.x64.msi

# 2. 安装（会装到 C:\Program Files\Everything）
#    安装过程中选择"安装 Everything 服务"（后台常驻 + 索引 NTFS，推荐）

# 3. 下载 ES 命令行工具（官方安装器不带 es.exe！）
#    https://www.voidtools.com/downloads/ → ES-1.1.0.37.x64.zip

# 4. 解压 es.exe 到官方推荐位置（自动在 PATH）
#    %LOCALAPPDATA%\Microsoft\WindowsApps\es.exe
```

### 注意点

| 项 | 说明 |
|---|---|
| **官方安装器不带 es.exe** | 必须**单独下载 ES 工具**（独立 zip） |
| **es.exe 官方推荐位置** | `%LOCALAPPDATA%\Microsoft\WindowsApps`（Windows 默认 PATH，无需手动加） |
| **路径避免中文** | 用英文路径（`C:\Program Files` 或用户目录英文路径） |
| **首次需 GUI 确认索引** | 装完打开 Everything → Tools → Options → Indexes → NTFS → 勾选卷（一次即可） |
| **服务模式** | 后台常驻 + 开机自启，es.exe 秒级连接 |

### 其他方式

| 方式 | 能用吗 | 额外操作 |
|---|---|---|
| 官方安装器（.msi） | ✅ | 需单独装 ES 到 WindowsApps |
| 便携版（zip） | ✅ | 需把目录加进 PATH，或复制 es.exe 到 WindowsApps |
| ES 单独安装 | ✅ | 官方推荐直接放 WindowsApps |

## Issue 核查结论（确保不污染开源项目）

| Issue | 准确性 | 处理 |
|---|---|---|
| djt889/dsh-drag-to-attachment #1 | ✅ **完全准确**（spawn 崩溃 + vendor 缺失，均代码实证） | 保留，无需修改 |
| bill9109/dsh-drag-and-drop #4 | ✅ **核心准确**（-whole-filename 参数 bug 实测成立），但初始表述有 2 处不完整：指错文件位置、漏 GBK 核心 bug | 已追加评论补充（GBK 核心 bug + 正确文件位置 + Everything.exe 弹窗） |

**结论**：两个 issue 的关键断言均经代码或实测验证，**无虚假/误导信息**，不会污染开源项目。Issue 4 的不完整处已通过追加评论修正。
