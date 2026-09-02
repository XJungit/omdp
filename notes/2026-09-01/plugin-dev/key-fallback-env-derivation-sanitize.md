# key-fallback env 名自动派生消毒（3.1.4）

## 背景 / 问题

2026-09-01 用户在「设置 → API Key 回退」里为 provider `b-ai`（显示名 `B.AI`）新建池，
点「启用」后页面报错 **`env must be POSIX identifier`**。

## 根因

- 客户端「选择 LLM provider → 启用」只 POST `{ provider, enabled: true }`，不传 `env`。
- 服务端自动派生 `provider.toUpperCase() + '_API_KEY'`（`lib/index.js` POST /pools 分支），
  再经 `isCredentialRefName`（`/^[A-Za-z_][A-Za-z0-9_]*$/`）校验。
- provider id 含 `-` / `.`（如 `b-ai` → `B-AI_API_KEY`、`B.AI` → `B.AI_API_KEY`）
  必然校验失败 → HTTP 400。

另发现 `buildPools` 重建 env 索引处（`poolsByEnv`）用同样的未消毒派生（`name.toUpperCase() + '_API_KEY'`），
属于同一类隐患（仅影响含非法字符 provider 名的既有池的 env 索引键）。

## 修复（v3.1.4）

`lib/index.js` 新增共享 helper：

```js
function deriveEnvName(name) {
  return String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'
}
```

两处自动派生统一改调 `deriveEnvName`（`b-ai` → `B_AI_API_KEY`、`B.AI` → `B_AI_API_KEY`）；
显式传入的 `env` 仍走原 `isCredentialRefName` 校验不变。既有 `NINEROUTER_API_KEY` 等干净名不受影响。

## 可复用要点

- provider id 并非总是合法 POSIX 标识符（可含 `-`/`.`/大小写），任何"把名字转成 env 键名"
  的派生都必须消毒；只对显式用户输入做严格校验。
- 客户端新建池流程（选择 provider 下拉 → 直接 POST）不提供 env 输入，默认走服务端派生，
  因此服务端派生必须健壮。
- 排查"设置页 400 报错"类问题：读 HTTP 层发回的 `{ error }` 文案 → 在服务端源码里搜该文案
  定位校验点 → 确认触发输入的格式。
