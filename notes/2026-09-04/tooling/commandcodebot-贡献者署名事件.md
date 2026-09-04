# CommandCodeBot 蹭进 Contributors 事件（2026-09-04）

## 背景/问题

用户发现 `XJungit/omdp` 仓库页面显示 2 个 Contributors，其中一个是
`CommandCodeBot`，显示名还是 `npm i -g cmd` 广告语。排查确认与代码无关，
纯展示问题。

## 根因（2026-09-04 经用户确认）

- 用户一直在**本机 DSH agent 上使用 CommandCode provider 模型**维护插件；
  两次提交（`868a474` 8-25、`837875d` 9-04）都是该模型代为 `git commit` 时，
  **自发**在 message 尾部加了
  `Co-authored-by: CommandCodeBot <noreply@commandcode.ai>`。
- Author 照样显示本机 git 身份（`XJungit <xj@omdp.local>`），提交时间也是
  正常工作时间，最具迷惑性——用户从未声明过要加这种署名。
- GitHub 规则：提交信息里的 `Co-authored-by:` 会把对应名字也算进
  Contributors，哪怕该邮箱背后没有真实账号。
- 本机 git 无残留：仓库/全局均无 `commit.template`、`core.hooksPath`、
  无启用的 `commit-msg` 钩子、无 `GIT_AUTHOR_*` 环境变量——trailer 是
  Agent 调用 `git commit` 时自己写进 `-m` 正文的。

## 可复用要点

- 已产生的贡献者记录**改写历史也去不掉**（GitHub 按历史提交对象统计），
  只能从源头防：见 AGENTS.md 规范 4。
- 提交前自查：`git log --format=%B -1` 看一眼正文有无署名类 trailer。
- 外部 Agent 代提交时，必须先要求它去掉这类行。
- 另：Contributors 旁的小字是该账号的**显示名（name）**，不是提交信息；
  全仓库搜提交正文找不到 `npm i -g cmd` 是正常的。
