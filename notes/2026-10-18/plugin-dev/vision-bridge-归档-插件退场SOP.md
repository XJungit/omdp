# 插件退场 SOP：`dsh-vision-bridge` 归档（2026-10-18）

**日期**：2026-10-18　**分类**：plugin-dev
**结论**：`@omdp/dsh-vision-bridge` 因**使用方不再需要**而主动停用归档。
归档原因是「需求消失」，**不是**「被 DSH 原生能力替代」。

## 背景

`@omdp/dsh-vision-bridge` v0.1.12 是「给纯文本模型加眼睛」的桥接插件：探测被路由模型是否支持图片
（`llm.resolveModelInfo().inputModalities`），对纯文本模型把粘贴/附加的图片转发到可配置的
OpenAI 兼容多模态端点（默认 Agnes `agnes-2.5-flash`），把返回文本作为证据喂回。

用户判定**不再需要**，要求归档（不是修 bug、不是等替代方案）。

> ⚠️ **表述纪律**：归档原因就是「不再需要」。**不要**写成「DSH 已内置图片输入」——
> 这与事实不符，且会误导未来的判断（将来若又要用，会以为有原生方案而不再看这份归档）。

## 归档动作清单（可复用的「插件退场」SOP）

一个插件从「活跃」变「归档」，要动的不只是目录：

### 1. 源码迁移

```powershell
git mv dsh-vision-bridge archive/dsh-vision-bridge-0.1.12-2026-10-18T18-06-04
```

命名规范 `<插件名>-<最后发布版本>-<时间戳>`，与 `archive/README.md` 的约定一致。
**迁移后逐个核对字节数**（本次 7 个文件全部一致）：`client.js` 15919 / `cordis.patch.yml` 300 /
`index.js` 41984 / `LICENSE` 1064 / `package.json` 1025 / `README.md` 21134 /
`test/route-resolution.test.mjs` 9787。

### 2. 发布流水线（最容易漏）

`.github/workflows/publish.yml` 的 `for dir in …` 循环移除该目录，并把注释里的
「活跃包清单」与「归档不发布」说明同步更新。
**漏了会让 CI 在 tag 推送时去发布一个不存在的目录。**

### 3. 仓库级文档

- `AGENTS.md` 头部「当前活跃」列表；
- 根 `README.md`：目录树（**中英各一处**）、插件章节（中英各一处）、npm 依赖示例、
  `pnpm update` 示例、`dsh plugin add` 示例、`allowBuilds` 白名单、archive 树、Conventions 蓝本句
  ——本次光根 README 就有 **18 处**引用；
- `docs/plugin-compatibility.md`：文件头、该插件章节标题改「已归档」+ blockquote、
  汇总对比表、门禁影响表、总体结论；
- `docs/npm-publish.md`：头部活动插件列表、发布目录清单、远程安装示例、
  profile deps 示例、更新命令；
- `docs/DSH-plugin-quality-zh-discussion.md` 的插件清单；
- `archive/README.md`：新增该快照小节，写清**归档日期 + 原因 + 保留价值**。

### 4. 不要动的

- `notes/**` 里的历史引用 —— 那是**历史记录**，改写等于篡改；
- npm 上已发布的版本 —— 保留可安装，只是不再发新版；
- 被 gitignore 的日志/构建产物。

## 判据：哪些引用该改、哪些该留

| 引用性质 | 处置 |
|---|---|
| **当前状态描述**（「活跃插件有 N 个」、目录树、发布清单、依赖示例） | **必须改** |
| **历史事件记录**（「当时该插件在 0.1.6 上的实测结论」、变更记录条目） | **保留**，只在文件头加一句「本文档为演进记录」 |
| **示例/类比**（质量文档里拿它当正面例子） | 加一句归档标注即可，不必删 |

## 可复用要点

1. **归档 = 一次跨 6+ 文件的同步动作**。先列全清单再动手，否则必漏。
2. `git mv` 保留历史，比 `rm` + 新建更可追溯。
3. 归档后**验证发布流水线不再尝试发布它**（循环变量 + 注释都要对）。
4. 归档 ≠ 删除：`archive/` 的定位是「留作历史参考」，`README.md` 要写清保留价值
   （本次保留的是「多模态/文本模型自动分流」与「文本模型代看端点」的实现）。
5. 该插件**零 `peerDependencies`** ⇒ 完全不受版本门禁约束：在任何 DSH 版本上都不会被跳过，
   但也**没有自动保护**（不会因为不兼容而被拦下）。这是「无 peer」的两面性。

## 相关文件

- `archive/dsh-vision-bridge-0.1.12-2026-10-18T18-06-04/`
- `archive/README.md`、`.github/workflows/publish.yml`、`AGENTS.md`
- 根 `README.md`、`docs/plugin-compatibility.md`、`docs/npm-publish.md`
