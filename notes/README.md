# 文档笔记（Development Notes）

本目录沉淀 OMDP 仓库开发过程中的**教训、经验、坑、决策依据**（见根 `AGENTS.md` 规范 2）。

## 结构（三层）

```
notes/
  └── <yyyy-MM-dd>/            # 第二层：时间（按日期自然排序）
      └── <category>/          # 第三层：按功能/主题分类
          └── <主题>.md        # 一篇笔记一个主题
```

## 分类约定（第三层）

| 分类目录 | 内容 |
|---|---|
| `dsh-compat/` | DSH 版本适配 / 兼容性排查 |
| `plugin-dev/` | 插件开发 / 重构 / 架构 |
| `dsh-internals/` | DSH 源码研究（API 契约、事件载荷） |
| `deploy/` | 部署、发布、npm |
| `debug/` | 排障记录（根因 → 修复 → 验证） |
| `tooling/` | 环境、工具链、git/npm/sandbox 坑 |

新分类按需创建，保持目录整洁；一篇笔记只讲一个主题。