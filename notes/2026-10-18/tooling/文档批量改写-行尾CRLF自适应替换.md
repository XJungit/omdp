# 批量改写文档：行尾（CRLF/LF）自适应替换

**日期**：2026-10-18　**分类**：tooling
**问题**：同一仓库内**行尾按文件各不相同**，用 here-string 做精确字符串替换时会静默 0 命中。

## 现象

用 PowerShell 脚本对文档做**精确字符串替换**（带命中数断言），
`docs/plugin-compatibility.md` 的替换全部失败：

```
ASSERT FAILED [文件头]: expected 1, found 0
```

但**同一套脚本**对 `AGENTS.md`、根 `README.md`、`.github/workflows/publish.yml` 全部成功。

## 根因

**同一个仓库里行尾不统一，且是按文件各不相同的**（本次实测）：

| 文件 | 行尾 |
|---|---|
| `docs/plugin-compatibility.md` | **CRLF**（1079 CRLF / 0 LF） |
| `docs/npm-publish.md` | **CRLF**（211 / 0） |
| `AGENTS.md` | LF |
| 根 `README.md` | LF |
| `archive/README.md` | LF |
| `.github/workflows/publish.yml` | LF |
| 三个插件的 `README.md` | LF |

脚本里的 here-string（`@'…'@`）字面量携带的是**脚本文件自身的行尾**（本次是 LF），
所以拿 LF 的 needle 去 CRLF 的 haystack 里找，永远 0 命中。

⚠️ 反直觉点：`.ps1` 里的 here-string **不会**被 PowerShell 自动规范化成 CRLF——
它忠实保留脚本文件的字节。把脚本存成 CRLF 能碰巧解决，但那是隐式依赖，不可靠。

## 解法：行尾自适应的替换助手

先探测目标文件的主导行尾，再把 `old`/`new` 双方都规范化到该行尾后匹配：

```powershell
function Rep {
  param([string]$Rel, [string]$Old, [string]$New, [string]$Label, [int]$Expected = 1)
  $p = Join-Path $root $Rel
  $raw = [System.IO.File]::ReadAllText($p)
  $crlf = ([regex]::Matches($raw, "`r`n")).Count
  $lone = ([regex]::Matches($raw, "(?<!`r)`n")).Count
  $eol = if ($crlf -gt $lone) { "`r`n" } else { "`n" }
  $o  = $Old.Replace("`r`n","`n").Replace("`n",$eol)   # 先压平再铺开
  $nn = $New.Replace("`r`n","`n").Replace("`n",$eol)
  $n = ([regex]::Matches($raw, [regex]::Escape($o))).Count
  if ($n -ne $Expected) { throw "ASSERT FAILED [$Label] in $Rel : expected $Expected, found $n" }
  [System.IO.File]::WriteAllText($p, $raw.Replace($o, $nn), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "  ok: $Label"
}
```

要点：
- `$Old.Replace("`r`n","`n").Replace("`n",$eol)` —— **先压平再铺开**，两步都不能省；
  只做后者会把已有的 `\r\n` 变成 `\r\r\n`。
- `[regex]::Escape($o)` 做字面量匹配 —— 文档里有大量 `` ` ``、`|`、`(`、`[` 等 regex 元字符。
- `New-Object System.Text.UTF8Encoding($false)` —— **无 BOM** 写回（目标文件都是无 BOM）。
- 每次替换都断言**预期命中次数**；命中数不符立即抛错且**不写文件**。

## 相关坑

- **`-replace` 是大小写不敏感的**：`-replace 'VERSION', $v` 会顺手改掉 JSON 键 `"version"`。
  → 构造 JSON 一律用 `[ordered]@{}` + `ConvertTo-Json`，**绝不做文本替换**。
- **`Select-String -Pattern 'a|b' -SimpleMatch`** 把 `|` 当字面量 ⇒ 永远 0 命中。
  用交替时**不要**加 `-SimpleMatch`。
- 子串匹配要防误伤：`.Contains('maxConsecutive')` 会命中 `maxConsecutiveDenials`。
- **函数名别用单字母**：`function R` 与内置别名 `r`（= `Invoke-History`）冲突，
  报 `找不到接受自变量 … 的位置参数`。改名 `Rep1` 即解决。
- **长文档的整段删除/插入**用行数组（`[System.Collections.Generic.List[string]]`）+
  「按标题定位、再向下找代码块围栏」比字符串替换稳，不要求把整段原文一字不差抄进脚本。
  本次删根 README 的插件章节、插新条目都用这个方法。
- **`Get-Content -Raw` 的 `.Length` ≠ 磁盘字节数**（CRLF 文件差 `行数` 个字节），
  别拿它判断「文件被并发改了」。
- 需要看真实行尾时用
  `[System.IO.File]::ReadAllBytes($p)` 数 `0x0D` / `0x0A`，或直接数 `"`r`n"` 与孤立 `"`n"`。

## 可复用要点

1. 动一个仓库的文档前，**先探测每个目标文件的行尾**，别假设统一。
2. 精确替换必须带**命中数断言**——「改错了但没报错」比失败更糟。
3. 写回时显式指定 UTF-8 **无 BOM**。
4. 大段结构性改动优先用**行号/锚点定位**，而不是把整段原文抄进脚本。
