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

    function fetchJson(url, signal) {
      return fetch(url, signal ? { signal: signal } : undefined).then(function (r) { return r.json() })
    }

    // 卡片可见性驱动的"仅在用户观看时轮询"：
    // 不看（页面隐藏 / 卡片滚出视口 / 组件卸载）→ 停止轮询，零网络；
    // 重新可见 → 立即刷新并恢复每 2s 轮询，数据最多晚 2s，正常及时。
    function KeyFallbackCard() {
      var s = React.useState({ loading: true, data: null })
      var state = s[0]
      var setState = s[1]
      var rootRef = React.useRef(null)
      var ioRef = React.useRef(null)

      // 回调 ref：卡片根元素变化（loading ↔ 列表）时先解除旧元素再观察新元素，
      // 避免旧元素因被移除触发 isIntersecting:false 而错误停止轮询。
      var attachRoot = React.useCallback(function (el) {
        var prev = rootRef.current
        var io = ioRef.current
        if (io && prev && prev !== el) io.unobserve(prev)
        rootRef.current = el
        if (io && el) io.observe(el)
      }, [])

      var refresh = React.useCallback(function () {
        fetchJson('/dsh-key-fallback/pools')
          .then(function (data) { setState({ loading: false, data: (data && data.pools) || {} }) })
          .catch(function () { setState({ loading: false, data: null }) })
      }, [])

      React.useEffect(function () {
        var alive = true
        var timer = null
        var pageVisible = !document.hidden
        var cardVisible = true

        function stop() {
          if (timer !== null) { clearInterval(timer); timer = null }
        }
        function start() {
          if (!alive || timer !== null || !pageVisible || !cardVisible) return
          refresh()
          timer = setInterval(refresh, 2000)
        }
        function sync() {
          if (!alive) return
          if (pageVisible && cardVisible) start()
          else stop()
        }
        function onVisibility() {
          pageVisible = !document.hidden
          sync()
        }

        document.addEventListener('visibilitychange', onVisibility)

        if (typeof IntersectionObserver === 'function') {
          var io = new IntersectionObserver(function (entries) {
            if (!alive) return
            for (var i = 0; i < entries.length; i++) {
              cardVisible = entries[i].isIntersecting
            }
            sync()
          }, { threshold: 0.01 })
          ioRef.current = io
          var el = rootRef.current
          if (el) io.observe(el)
        }

        refresh()
        start()

        return function () {
          alive = false
          stop()
          document.removeEventListener('visibilitychange', onVisibility)
          if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null }
          ioRef.current = null
        }
      }, [refresh])

      if (state.loading) {
        return React.createElement('div', { ref: attachRoot, style: { fontSize: '12px', opacity: 0.6 } }, '加载中…')
      }
      var data = state.data || {}
      var providers = Object.keys(data)
      if (providers.length === 0) {
        return React.createElement('p', { ref: attachRoot, style: { fontSize: '12px', opacity: 0.6, margin: 0 } },
          '未在 settings.yaml 配置 keyFallback.providers')
      }
      return React.createElement('div', { ref: attachRoot, style: { fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } },
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
      // settings.plugin.item 是 root-scope 的 keyed slot，按 settings 命名空间
      // 分发：host 端 installSettingsSection 注册 key-fallback 命名空间，使它
      // 进入 served 集合后，本卡片才会被 ConfigurablePluginsTab 渲染。
      // 参考 dshmarket：注册通过嵌套 settingsScope inject（保持模块级无
      // settingsScope 硬依赖——旧宿主没有该服务时不至于拖垮整个插件）。
      var scopedInject = ctx.inject
      if (typeof scopedInject === 'function') {
        scopedInject(['settingsScope'], function (scoped) {
          var scopedSlots = scoped.slots
          if (!scopedSlots) return
          scopedSlots.inject('settings.plugin.item', function () {
            return scopedSlots.register({
              name: 'settings.plugin.item',
              key: 'key-fallback',
            }, KeyFallbackCard)
          })
        })
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
