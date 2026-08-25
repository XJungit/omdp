'use strict'
// @omdp/dsh-key-fallback — Client half
// Settings → 插件 里的只读状态卡：显示每个 provider 的 key 数 / 游标 / 冷却。
function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  async function fetchJson(url, opts) {
    const r = await fetch(url, opts)
    return r.json()
  }

  function KeyFallbackCard() {
    const [state, setState] = React.useState({ loading: true, data: null })
    const refresh = React.useCallback(function () {
      fetchJson('/dsh-key-fallback/pools')
        .then(function (data) { setState({ loading: false, data: (data && data.pools) || {} }) })
        .catch(function () { setState({ loading: false, data: null }) })
    }, [])
    React.useEffect(function () {
      refresh()
      const t = setInterval(refresh, 2000)
      return function () { clearInterval(t) }
    }, [refresh])

    if (state.loading) {
      return React.createElement('div', { style: { fontSize: '12px', opacity: 0.6 } }, '加载中…')
    }
    const data = state.data || {}
    const providers = Object.keys(data)
    if (providers.length === 0) {
      return React.createElement('p', { style: { fontSize: '12px', opacity: 0.6, margin: 0 } },
        '未在 settings.yaml 配置 keyFallback.providers')
    }
    return React.createElement('div', { style: { fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } },
      providers.map(function (p) {
        const pd = data[p]
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

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: 'key-fallback',
      id: 'key-fallback',
      order: 50,
      label: () => 'API Key 回退',
      inject: () => ({}),
    }, KeyFallbackCard)
  })
}

exports.apply = apply
exports.inject = ['slots']
