// @omdp/dsh-key-fallback — Client half
// Settings → 插件 里的只读状态卡：显示每个 provider 的 key 数 / 游标 / 冷却。
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory receiving `require`) — the same zero-dependency stance as the
// host half. The registered id MUST be the package name (@omdp/dsh-key-fallback):
// dsh-client-modules rejects any bundle whose __ModuleLoader__.load id does not
// match the package it was loaded for.
window.__ModuleLoader__.load({
  id: '@omdp/dsh-key-fallback',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')

    function fetchJson(url) {
      return fetch(url).then(function (r) { return r.json() })
    }

    function KeyFallbackCard() {
      var s = React.useState({ loading: true, data: null })
      var state = s[0]
      var setState = s[1]
      var refresh = React.useCallback(function () {
        fetchJson('/dsh-key-fallback/pools')
          .then(function (data) { setState({ loading: false, data: (data && data.pools) || {} }) })
          .catch(function () { setState({ loading: false, data: null }) })
      }, [])
      React.useEffect(function () {
        refresh()
        var t = setInterval(refresh, 2000)
        return function () { clearInterval(t) }
      }, [refresh])

      if (state.loading) {
        return React.createElement('div', { style: { fontSize: '12px', opacity: 0.6 } }, '加载中…')
      }
      var data = state.data || {}
      var providers = Object.keys(data)
      if (providers.length === 0) {
        return React.createElement('p', { style: { fontSize: '12px', opacity: 0.6, margin: 0 } },
          '未在 settings.yaml 配置 keyFallback.providers')
      }
      return React.createElement('div', { style: { fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } },
        providers.map(function (p) {
          var pd = data[p]
          return React.createElement('div', { key: p, style: { padding: '6px 0', borderTop: '1px solid var(--dsw-alias-border-l2, #eee)' } },
            React.createElement('div', { style: { fontWeight: 600 } }, p + '  (' + pd.env + ')'),
            React.createElement('div', { style: { opacity: 0.8 } }, 'key 数: ' + pd.keyCount + '，当前游标: ' + pd.currentIndex),
            pd.cooling.length > 0
              ? React.createElement('div', { style: { color: '#c62828' } }, '冷却中: ' + pd.cooling.join(', '))
              : null,
            pd.healthy.length > 0
              ? React.createElement('div', { style: { color: '#2e7d32' } }, '健康: ' + pd.healthy.join(', '))
              : null,
          )
        }),
      )
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      // settings.plugin.item 是 root-scope 的 keyed slot（注册只需 key）；本卡是只读状态展示，
      // 不需要 settingsScope 绑定可编辑配置。与 resume-stream 的 slots.inject 姿势一致。
      slots.inject('settings.plugin.item', () => slots.register({
        name: 'settings.plugin.item',
        key: 'key-fallback',
      }, KeyFallbackCard))
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
