# CommandCodeBot 蹭进 Contributors 事件（2026-09-04）

## 背景/问题

用户发现 `XJungit/omdp` 仓库页面显示 2 个 Contributors，其中一个是
`CommandCodeBot`，显示名还是 `npm i -g cmd` 广告语。排查确认与代码无关，
纯展示问题。

## 根因

- 外部 AI Agent（CommandCode）代提交时，在提交正文尾部手写了
  `Co-authored-by: CommandCodeBot <noreply@commandcode.ai>`，
  共两次：`868a474`（2026-08-25）、`837875d`（2026-09-04 v3.1.5）。
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
