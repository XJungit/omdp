// mock-cut-server.mjs — 模拟“上游不发 finish_reason、直接掐断 SSE 连接”的故障源。
//
// 用途：确定性复现 resume-stream 插件处理的场景（对应 Zen/opencode 网关那种
// SSE body 中途关闭、没有终止块的故障）。当前版本会保留 TRANSPORT 错误，
// 在 agent/request-error 处对同一 turn+step 返回 { kind: 'retry' } 重试。
//
// 用法：
//   node mock-cut-server.mjs
// 然后在本机终端保持运行，再到 DSH 里加一个自定义 OpenAI 兼容供应商：
//   Base URL : http://127.0.0.1:8799/v1
//   API Key  : sk-mock（随便填，非空即可）
//   Model    : mock-test
// 选中该模型发任意一条消息即可复现。
//
// 注意：本文件不在 package.json 的 files 白名单里，不会被发布进 npm 包。

import http from 'node:http'

const PORT = 8799
let hits = 0

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/chat/completions')) {
    hits += 1
    console.log(`[mock] 第 ${hits} 次补全请求，开始推流…`)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    let i = 0
    const timer = setInterval(() => {
      i += 1
      const chunk = {
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-test',
        choices: [
          { index: 0, delta: { content: `第${i}段测试文本。` }, finish_reason: null },
        ],
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)

      if (i >= 5) {
        clearInterval(timer)
        // 复现 Zen 网关真实行为：推完若干段 delta 后“正常关闭”连接，
        // 不发 data:[DONE]、也不发带 finish_reason 的收尾块。DSH 的
        // openai-completions 解析器检测到 EOF 且无终止符，会归类为
        // TRANSPORT 错误 → agent/request-error → resume-stream 对同一
        // turn+step 返回 { kind: 'retry' } 重新发起请求（这正要验证的续流）。
        res.end()
        console.log('[mock] 已在无 finish_reason 的情况下正常关闭连接（复现 Zen）✔')
      }
    }, 200)

    req.on('close', () => clearInterval(timer))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'not found' } }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] 截断流服务器已启动: http://127.0.0.1:${PORT}/v1 （POST /v1/chat/completions）`)
})
