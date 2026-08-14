// SKELETON — client half for a DSH bundle with a Web UI settings tab.
//
// This file is served by the harness at /plugins/<id>/client.js and handed to
// the browser via window.__ModuleLoader__.load. The `factory` receives a
// `require` that resolves harness-provided modules (react, slots, styles) —
// these are NOT npm dependencies and must not be listed in package.json.
//
// The settings tab is registered into the `settings.section` list slot. The
// slot contract (verified via the client Slots inspect provider): each entry
// needs { name: 'settings.section', id, order, label } and a React component
// as the second argument. `label` is the sidebar button text.

window.__ModuleLoader__.load({
  id: 'REPLACE-ME',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var react = require('react')
    var createElement = react.createElement

    // Scoped CSS, injected once.
    var css = '.sk_root{padding:0 24px 24px}.sk_btn{cursor:pointer;font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit}.sk_btn.primary{border-color:transparent;background:#2563eb;color:#fff}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="REPLACE-ME/section"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = 'REPLACE-ME'
      tag.dataset.pluginCss = 'REPLACE-ME/section'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // Fetch helper: host half is reached through the webserver prefix.
    function api(path, options) {
      return fetch('/REPLACE-ME/api' + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      }).then(async (resp) => ({ ok: resp.ok, status: resp.status, body: await resp.json().catch(() => ({})) }))
    }

    function Tab() {
      var _a = react.useState('')
      var msg = _a[0]
      var setMsg = _a[1]
      function ping() {
        api('/ping', { method: 'GET' })
          .then(function (r) { setMsg(JSON.stringify(r.body)) })
          .catch(function (e) { setMsg(String(e)) })
      }
      return createElement('div', { className: 'sk_root' },
        createElement('p', null, 'REPLACE-ME settings tab — replace this UI with your plugin.'),
        createElement('button', { className: 'sk_btn primary', onClick: ping }, 'Ping host'),
        msg ? createElement('pre', null, msg) : null,
      )
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'REPLACE-ME', order: 60, label: 'REPLACE-ME' },
          Tab,
        )
      })
    }

    exports.apply = apply
    return module.exports
  },
})
