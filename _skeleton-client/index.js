// SKELETON — DSH bundle WITH a Web UI settings tab.
// Copy this directory, rename, and implement your logic.
//
// Structure:
//   - index.js   (host half):  runs in Node, registers an HTTP prefix on the
//                              DSH webserver so the browser client can call it.
//   - client.js  (client half): runs in the browser, renders the settings tab
//                              and talks to the host half over fetch().
//
// The host/client split is NOT the dynamic-plugin `harness.handle`/`host.call`
// RPC. For an installed bundle package, the browser reaches the host through
// the webserver prefix registered below (see dsh-mcp-manager for the reference
// implementation). The `dsh.client` manifest in package.json is what makes the
// harness serve client.js at /plugins/<id>/client.js.

const NAME = 'REPLACE-ME'
const API_PREFIX = '/REPLACE-ME/api'

export const inject = ['webServer']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.logger?.info?.('[%s] loaded', NAME)

  // Minimal example route. Replace with your plugin's endpoints.
  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    if (!path.startsWith(API_PREFIX)) {
      res.writeHead(404)
      res.end()
      return
    }
    if (req.method === 'GET' && path === API_PREFIX + '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, plugin: NAME }))
      return
    }
    res.writeHead(404)
    res.end()
  }

  // Register the prefix handler. ctx.effect ensures it is removed on unload/HMR.
  ctx.webServer.register({ kind: 'prefix', path: '/REPLACE-ME', handler: route })
  ctx.effect(() => route)
}
