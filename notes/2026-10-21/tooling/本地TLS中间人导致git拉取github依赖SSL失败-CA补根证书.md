# 本地 TLS 中间人导致 git 拉取 GitHub 依赖 SSL 失败：把拦截器根证书补进 CA bundle

日期：2026-10-21

现象：在 profile 里更新 `github:aa2246740/dsh-watcher#main` 失败，插件市场报

```
dsh-watcher 更新失败，且更新前的构建未能验证恢复
{"code":"operation-error","diagnostic":"fatal: unable to access
 'https://github.com/aa2246740/dsh-watcher/': SSL certificate OpenSSL verify
 result: unable to get local issuer certificate (20)"}
```

注意 `exit=128` 是 **git 的**退出码，不是 pnpm 的。同一次更新里 `dshmarket`
（registry 包）和 `dsh-cost-meter` 都成功了，只有 git-hosted 依赖失败——
这个「只挂 git 依赖、registry 依赖正常」的分化就是第一线索。

## 诊断

| 检查 | 结果 |
|---|---|
| `Get-NetTCPConnection -LocalPort 443 -State Listen` | `0.0.0.0:443` pid 38612 `Steam++.Accelerator` |
| `C:\Windows\System32\drivers\etc\hosts` 有效行 | 246 行，**246 行全是 `127.0.0.1 <host>`** |
| hosts 中的 github 条目 | `github.com`、`api.github.com`、`raw.githubusercontent.com` 等 26 条全部指向 `127.0.0.1` |
| `codeload.github.com` | **不在 hosts 里**，仍走真实 IP，HTTPS 200 |
| `git config --get http.sslbackend` | `openssl`（不是 `schannel`） |
| `git config --get http.sslcainfo` | `C:/Users/xj/.dsh/certs/git-ca-bundle.pem` |
| `git config --get http.sslverify` | `true` |
| `git ls-remote https://github.com/aa2246740/dsh-watcher` | ❌ EXIT 128，`unable to get local issuer certificate (20)` |
| `git -c http.sslVerify=false ls-remote ...` | ✅ EXIT 0 |

**根因**：`Steam++.Accelerator` 在 `0.0.0.0:443` 做本地 TLS 中间人，并把
`github.com` / `api.github.com` 等 hosts 劫持到 `127.0.0.1`，用它的自签名根
`CN=SteamTools Certificate` 现签一张 `CN=github.com` 的叶证书。

关键点：**这个根证书装进了 Windows 证书存储，但 git 用不到**。
因为 `http.sslbackend=openssl` 时 git 只认 `http.sslcainfo` 指定的 PEM 文件，
**完全不读 Windows 的 `Cert:\LocalMachine\Root`**。所以浏览器/`gh` 正常、
只有 git 挂——这正是「其他工具都能访问 GitHub，唯独 git 不行」的原因。

证书存储里有两个 SteamTools 自签根，不能盲加：

| Thumbprint | NotAfter | 可用 |
|---|---|---|
| `F7F4E1E85A84DE1AC7A2C6C374858ECDB7E02084` | 2026-10-08（**已过期**） | ❌ |
| `D3997CDBA6432C00E004C6214C1DE4F8A523292B` | 2027-08-14 | ✅ |

用 `X509Chain` + `CustomRootTrust` 对 `CN=github.com` 叶证书做链构建验证：
前者 `Build(leaf)=False`（过期），后者 `True`。**只加能构链的那个**。

## 修复

把有效根追加进 git 的 CA bundle（先备份、先在临时 bundle 上验证）：

```powershell
$src = 'C:\Users\xj\.dsh\certs\git-ca-bundle.pem'
$bak = "$src.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item -LiteralPath $src -Destination $bak          # 备份

$root = Get-ChildItem Cert:\LocalMachine\Root |
        Where-Object { $_.Thumbprint -eq 'D3997CDBA6432C00E004C6214C1DE4F8A523292B' }

# 追加 PEM 块（含来源注释，便于日后审计/回滚）
$pem = "-----BEGIN CERTIFICATE-----`n" +
       [Convert]::ToBase64String($root.RawData, 'InsertLineBreaks') +
       "`n-----END CERTIFICATE-----`n"
Add-Content -LiteralPath $src -Value $pem
```

结果：`230464 B / 151 证书` → `232181 B / 152 证书`，备份
`git-ca-bundle.pem.bak-20261021-163225`。`http.sslverify` 保持 `true`。

**没有**用 `http.sslVerify=false`：那会把整机所有 HTTPS git 操作的证书校验
关掉，包括真实远端。只补一个能构链的根，影响面 = 该加速器签发的证书。

## 验证

单点验证不够，必须走完「git 能用 + pnpm 能装」两段：

```
git ls-remote https://github.com/aa2246740/dsh-watcher  → EXIT 0
git ls-remote https://github.com/XJungit/omdp            → EXIT 0
```

再在**临时目录**（不碰运行中的 profile）真实装一次 git-hosted 依赖：

```
pnpm install --no-frozen-lockfile --ignore-scripts   → EXIT 0
lockfile: version: https://codeload.github.com/aa2246740/dsh-watcher/tar.gz/2d807629a9fa763b897586cd4d5b7cd06514a25e
node_modules/dsh-watcher/package.json → version 0.9.0
```

这一步才是端到端证明：pnpm 解析 `#main` 需要 `git ls-remote`（走
`github.com`，被劫持 → 之前挂在这里），拿到 commit 后再从
`codeload.github.com` 下 tarball（没被劫持，一直是通的）。

## 可复用要点

- **分化定位法**：同一次批量操作里「registry 包成功、git-hosted 包失败」⇒
  几乎一定是 git 传输层问题，而不是 registry/网络整体不可用。
- `exit=128` + `unable to get local issuer certificate` ⇒ 缺中间/根证书，
  不是 DNS 或超时。对照 `Failed to connect` / `Connection was reset`（那是网络层）。
- **git 的 openssl 后端不读 Windows 证书存储**。装了根证书却不生效，先看
  `git config --get http.sslbackend` 和 `http.sslcainfo`。
- 加根证书前必须做**链构建验证**，别把证书存储里同名的过期根一起加进去。
- 验证要**两段**：`git ls-remote` 通了 ≠ pnpm 能装；反过来说
  `codeload` 通也不代表 git 解析能过。
- 同一台机器上依赖本地加速器/hosts 劫持时，任何 git-hosted 依赖
  （`github:owner/repo#ref`）都会踩这个坑，且**只在改动机器或加速器换根时复发**。

相关文件：

- `C:\Users\xj\.dsh\certs\git-ca-bundle.pem`（152 证书，已补 SteamTools 根）
- `C:\Users\xj\.dsh\certs\git-ca-bundle.pem.bak-20261021-163225`（原 151 证书备份）
- `notes/2026-10-18/tooling/github.com解析到被封IP-换IP推送绕行.md`（同一天机器上
  的另一类 GitHub 网络问题：那次是 IP 不通，这次是证书链不通）
