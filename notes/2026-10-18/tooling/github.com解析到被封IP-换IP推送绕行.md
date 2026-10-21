# github.com 解析到被封 IP：用可达 IP + 一次性 `sslVerify=false` 推送

日期：2026-10-18
现象：`git push` 反复失败在 `Recv failure: Connection was reset` /
`Failed to connect to github.com:443 after 21103 ms`，而 `gh api` 与网页访问都正常。

## 诊断

| 检查 | 结果 |
|---|---|
| `Resolve-DnsName github.com` | `20.205.243.166` |
| TCP `20.205.243.166:443` | ❌ 不通 |
| TCP `140.82.121.3` / `140.82.112.3` / `140.82.113.3` / `20.27.177.113` / `4.208.26.198` / `20.201.28.151` | ✅ 全部通 |
| TCP `api.github.com:443` | ✅ 通 |
| TCP `codeload.github.com` / `objects.githubusercontent.com` | ✅ 通 |
| TCP `ghproxy.net` / `gh-proxy.com` | ✅ 通 |
| 本地代理端口（7890/7891/7897/10808/10809/1080/8080/2080） | 全部关闭 |
| `HKCU\...\Internet Settings` | `ProxyEnable = 0`（`ProxyServer` 虽写着 `127.0.0.1:7890` 但未启用） |

**结论：不是 github.com 整体不可用，而是它当前解析到的这**一个 IP**（`20.205.243.166`）
被网络阻断。** 其它 GitHub 边缘 IP 畅通。

> 关键鉴别点：`gh api repos/...` 正常 + `git push` 连不上 ⇒ 先怀疑**单个 IP**，
> 不要下「GitHub 挂了 / 需要代理」的结论。

## 绕行办法

直接给 git 一个**可达的 GitHub IP** 当 URL，让 GitHub 自己 301 回 `github.com`：

```sh
git -c http.sslVerify=false push \
  https://140.82.121.3/XJungit/omdp.git master:master
```

实测输出：

```
warning: redirecting to https://github.com/XJungit/omdp.git/
To https://140.82.121.3/XJungit/omdp.git
   4fa7e8a..b031341  master -> master
```

读操作同理：

```sh
git -c http.sslVerify=false ls-remote https://140.82.121.3/XJungit/omdp.git refs/heads/master
```

### 为什么需要 `sslVerify=false`

用 IP 当 URL 时 TLS 的 **SNI / Host 是那个 IP**，而服务器证书的 CN 是 `github.com`，
主机名不匹配 ⇒ 校验证书必然失败。此处三个约束使它可接受：

1. 是**一次性** `-c` 参数，**不写入任何配置文件**；
2. 跳转后真正通信的仍是 `github.com`，且本机本就配了自定义 CA：
   `http.sslcainfo=C:/Users/xj/.dsh/certs/git-ca-bundle.pem`、`http.schannelcheckrevoke=false`；
3. 只用于网络被单点阻断时的推送兜底，网络恢复后照常走 `git push origin`。

> ⚠️ 不要把它设成全局 `http.sslVerify=false`。那会把**所有**仓库的证书校验关掉。

## 其它可用通道（本次实测）

- ✅ **`gh api <path>`** —— 全程可用，是最稳的只读通道（用于查 run、查仓库状态）。
- ✅ **`git ls-remote https://ghproxy.net/https://github.com/XJungit/omdp.git`** —— 可读。
  （只验证了读；未验证该代理是否支持 push。）
- ❌ `hub.fastgit.org` —— 已失效。

## 可复用要点

1. **先分清「域名不通」还是「这个 IP 不通」**：`Resolve-DnsName` 拿 IP，再逐个
   `Test-NetConnection <ip> 443`，别只看域名解析成功就断定网络没问题。
2. **`gh api` 能通而 `git push` 不能**，基本可以锁定是 github.com 这个入口 IP 的问题；
   `gh` 走的是 `api.github.com`，两者解析到不同 IP。
3. **绕行手段按代价从低到高**：换 IP（本文）→ 代理 → Git Data API 手工造 commit
   （`api.github.com` 可用时兜底，代价最高）。
4. 推完记得**同步远端跟踪引用**：直接对 URL 推送不会更新 `refs/remotes/origin/*`，
   `git status` 会一直显示 `ahead N`。用
   `git update-ref refs/remotes/origin/master <已验证的远端 sha>` 校准
   （sha 要先经 `ls-remote` 核实，别凭本地值写）。
5. 这类网络绕行**不要**固化进仓库配置或 CI —— 它是环境问题的临时对策。

## ⏱️ 时效说明（2026-10-21 更新）

**本文的换 IP + `sslVerify=false` 绕行方案已失效，不要再照做。**

环境变了：`github.com` / `api.github.com` 现被 `Steam++.Accelerator`（本地 443
TLS 中间人）通过 hosts 劫持到 `127.0.0.1`，不再是「解析到一个被封的境外 IP」。
补入加速器根证书后，普通 `git push origin master` 实测 **EXIT 0，4 秒**完成：

```
git push origin master
   1d8bf4d..a49f73b  master -> master
```

因此：

- **不需要**换 IP，**不需要** `-c http.sslVerify=false`；
- 现在若报 `unable to get local issuer certificate (20)`，是中间人根证书缺失，
  按 `notes/2026-10-21/tooling/本地TLS中间人导致git拉取github依赖SSL失败-CA补根证书.md` 修；
- 本文的价值仅剩：区分「域名不通 / 某个 IP 不通 / 证书链不通」这套诊断思路，
  以及 `git update-ref` 校准远端跟踪引用的做法。

## 相关文件

- 本次推送目标：`XJungit/omdp`，`master` `4fa7e8a → b031341`
- `notes/2026-10-18/deploy/三个tag并发发布撞车-E409与暂存提升延迟8分钟-以及我下的错误结论.md`
  （同一批发布工作；发布本身的通道是 GitHub Actions，未受本问题影响）
