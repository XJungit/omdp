# archive/ — 已归档插件与历史参考

本目录存放已停用/已被新版本替代的插件源码快照与历史版本备份，**留作历史参考**，不再维护。

按时间线（旧 → 新）：

## dsh-vision-bridge-0.1.12-2026-10-18T18-06-04/
`@omdp/dsh-vision-bridge` v0.1.12 源码快照（最后一个发布版本，npm 上仍可安装）。
**2026-10-18 主动停用**：使用方不再需要该桥接，故移出活跃插件列表
（不再随 tag 发布、不再出现在 `README.md` 的插件矩阵）。
保留原因：其中的「多模态/文本模型自动分流」与「文本模型代看端点」实现仍有参考价值。

## dsh-gitbash-win/
Windows GitBash 兼容插件（开源参考实现，来自 `buhuikongpan/dsh-win-gitbash`）；
作为「DSH 插件真实实现」的研读样例保留。

## resume-stream/
`@omdp/dsh-resume-stream` 先前发布版本的源码快照（含 mock server 与单元测试）。
最新发布见根目录 `dsh-resume-stream/`（当前活跃）。

## key-fallback-v1.0.7-2026-08-26T04-18-34/
`@omdp/dsh-key-fallback` v1.0.7 发布版本源码快照。

## key-fallback-v1-installed-backup-2026-08-26T05-46-58/
v1 安装在 profile 时的备份（cordis 配置 + lib）。

## key-fallback-installed-v1-backup-2026-08-26T06-52-58/
v1 安装在 profile 时的备份（含 README，另一个时间点）。

## key-fallback-installed-v3-wrap-2026-08-26T09-18-34/
v3「wrap」方案安装在 profile 时的备份。

## key-fallback-v3-design-draft-2026-08-26T09-53-08/
v3 设计草案（`lib_client.js`/`lib_index.js` 为命名草稿版）。

---

> 维护约定：新插件版本发布前的源码快照按「插件名-版本-时间戳」命名放入本目录；
> DSH 源码/文档抄本、测试用 settings 快照等一次性产物**不要**放这里。
