// @omdp/dsh-key-fallback — Client half (v6)
//
// 独立设置页「设置 → API Key 回退」：
//  1) provider 下拉（来自 /providers：live + dormant）→ 「启用」创建池
//  2) 每个池一张卡片：enabled 开关 / env / cooldownMs / rotateOn 可点选 chips /
//     key 链（只写输入 + 眼睛看明文 + 环境密钥可编辑）
//  3) 顶部刷新 + 冷却重置
//
// 走 fetch 跟 host 通信（/dsh-key-fallback/*），视觉用 --dsw-alias-* 变量。

function __kfReportDiag(kind, message, stack) {
  try {
    fetch('/dsh-key-fallback/diag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind, message: String(message || '').slice(0, 500), stack: String(stack || '').slice(0, 1500), at: Date.now() }),
    }).catch(function () {})
  } catch (e) {}
}
window.addEventListener('error', function (e) {
  __kfReportDiag('error', e && e.message, e && e.error && e.error.stack)
})
window.addEventListener('unhandledrejection', function (e) {
  var r = e && e.reason
  __kfReportDiag('unhandledrejection', r && r.message || String(r), r && r.stack)
})
window.__ModuleLoader__.load({
  id: '@omdp/dsh-key-fallback',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var ce = React.createElement

    // ── 常用代码 / 名称 ──
    // 预设 chips = DSH LlmError 标准码（换 key 有意义的全集）。这些码决定「失败后是否换 key」，
    // 与 DSH 的重试机制（provider 的 retryPolicy.retryableCodes，决定同一把 key 是否重发）独立互补。
    var ROTATE_CODES = ['QUOTA', 'AUTH', 'RATE_LIMIT', 'TIMEOUT', 'TRANSPORT', 'SERVER', 'EMPTY_RESPONSE', 'INVALID_CREDENTIAL']
    function codeLabel(c) {
      return { QUOTA: '配额用尽', AUTH: '认证失败', RATE_LIMIT: '限流', TIMEOUT: '超时', TRANSPORT: '传输错误', SERVER: '服务端', EMPTY_RESPONSE: '空响应', INVALID_CREDENTIAL: '凭据无效' }[c] || c
    }

    // ── CSS（一次注入）──
    var CSS = [
      '.kf_root{display:flex;flex-direction:column;gap:18px;padding:0 24px 30px;max-width:980px;margin:0 auto}',
      '.kf_head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.kf_title{font-size:19px;font-weight:700;color:var(--dsw-alias-label-primary,#f1f1f1);margin:0;display:flex;align-items:center;gap:10px;letter-spacing:.2px}',
      '.kf_title .kf_dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#4ade80,#22d3ee);box-shadow:0 0 10px rgba(74,222,128,.6)}',
      '.kf_sub{font-size:12.5px;color:var(--dsw-alias-label-secondary,#9aa);margin:6px 0 0;line-height:1.65}',
      '.kf_headRight{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.kf_badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:3px 10px;border-radius:999px;border:1px solid currentColor;line-height:1.55;white-space:nowrap;font-weight:500}',
      '.kf_badge.muted{color:var(--dsw-alias-label-secondary,#9aa)}',
      '.kf_badge.ok{color:var(--dsw-alias-state-success-primary,#4ade80)}',
      '.kf_badge.warn{color:var(--dsw-alias-state-warn-primary,#fbbf24)}',
      '.kf_badge.brand{color:var(--dsw-alias-brand-primary,#7aa2ff);border-color:var(--dsw-alias-brand-primary,#7aa2ff)}',
      '.kf_badge.err{color:var(--dsw-alias-state-error-primary,#f87171)}',
      '.kf_btn{cursor:pointer;font:inherit;font-size:12px;padding:6px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:inherit;transition:background .12s,border-color .12s,transform .05s;flex:none;line-height:1.5}',
      '.kf_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}',
      '.kf_btn:active:not(:disabled){transform:scale(.97)}',
      '.kf_btn:disabled{opacity:.45;cursor:default}',
      '.kf_btn.primary{border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 14%,transparent);color:var(--dsw-alias-brand-primary,#7aa2ff)}',
      '.kf_btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 26%,transparent)}',
      '.kf_btn.danger{color:var(--dsw-alias-state-error-primary,#f87171);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f87171) 55%,transparent)}',
      '.kf_btn.ghost{border-style:dashed}',
      '.kf_card{background:linear-gradient(180deg,var(--dsw-alias-bg-layer-1,rgba(255,255,255,.045)),rgba(255,255,255,.015));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:14px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset}',
      '.kf_cardHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.kf_avatar{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#0b1220;background:linear-gradient(135deg,#7aa2ff,#22d3ee);flex:none;text-transform:uppercase}',
      '.kf_name{font-weight:700;font-size:14.5px;color:var(--dsw-alias-label-primary,#f1f1f1);display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.kf_switch{position:relative;width:36px;height:21px;border-radius:999px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.3));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));cursor:pointer;transition:background .15s;flex:none}',
      '.kf_switch::after{content:"";position:absolute;top:1px;left:1px;width:17px;height:17px;border-radius:50%;background:var(--dsw-alias-label-secondary,#9aa);transition:transform .15s,background .15s}',
      '.kf_switch.on{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#4ade80) 45%,transparent);border-color:var(--dsw-alias-state-success-primary,#4ade80)}',
      '.kf_switch.on::after{transform:translateX(15px);background:#4ade80}',
      '.kf_meta{display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--dsw-alias-label-secondary,#9aa);background:var(--dsw-alias-bg-base,rgba(0,0,0,.14));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:10px;padding:9px 12px}',
      '.kf_meta b{color:var(--dsw-alias-label-primary,#e8e8e8);font-weight:600}',
      '.kf_activePill{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--dsw-alias-state-success-primary,#4ade80)}',
      '.kf_activePill::before{content:"";width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 8px rgba(74,222,128,.8);animation:kf_pulse 1.8s ease-in-out infinite}',
      '@keyframes kf_pulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '.kf_sel{font:inherit;font-size:12px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.18));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;padding:4px 8px}',
      '.kf_section{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#778);display:flex;align-items:center;gap:8px}',
      '.kf_section::after{content:"";flex:1;height:1px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.15))}',
      '.kf_chips{display:flex;gap:7px;flex-wrap:wrap;align-items:center}',
      '.kf_chip{cursor:pointer;font:inherit;font-size:11.5px;padding:4px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:var(--dsw-alias-label-secondary,#9aa);transition:all .12s;display:inline-flex;align-items:center;gap:5px}',
      '.kf_chip:hover{color:var(--dsw-alias-label-primary,#ddd);border-color:var(--dsw-alias-brand-primary,#5b8cff)}',
      '.kf_chip.on{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#4ade80) 18%,transparent);color:var(--dsw-alias-state-success-primary,#4ade80);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#4ade80) 55%,transparent)}',
      '.kf_chip.on::before{content:"✓";font-size:10px}',
      '.kf_customRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.kf_input{font:inherit;font-size:12.5px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-base,rgba(0,0,0,.2));color:inherit;outline:none}',
      '.kf_input:focus{border-color:var(--dsw-alias-brand-primary,#5b8cff);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 25%,transparent)}',
      '.kf_keys{display:flex;flex-direction:column;gap:7px}',
      '.kf_keyRow{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));border-radius:10px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.14));flex-wrap:wrap;transition:border-color .12s}',
      '.kf_keyRow.active{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#4ade80) 55%,transparent)}',
      '.kf_statusDot{width:8px;height:8px;border-radius:50%;flex:none}',
      '.kf_statusDot.live{background:#4ade80}',
      '.kf_statusDot.cooling{background:#fbbf24;box-shadow:0 0 6px rgba(251,191,36,.6)}',
      '.kf_statusDot.recovered{background:#38bdf8}',
      '.kf_keyName{font-weight:600;font-size:12.5px;color:var(--dsw-alias-label-primary,#e8e8e8);min-width:56px;display:flex;align-items:center;gap:6px}',
      '.kf_keyRef{font-size:10.5px;color:var(--dsw-alias-label-secondary,#9aa);font-family:ui-monospace,Menlo,Consolas,monospace;opacity:.75;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kf_keyVal{flex:1;min-width:170px;max-width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;padding:6px 10px;border-radius:8px;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-base,rgba(0,0,0,.22));color:inherit;overflow-wrap:anywhere;word-break:break-all;line-height:1.5}',
      '.kf_keyActions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.kf_err{color:var(--dsw-alias-state-error-primary,#f87171);font-size:12px;line-height:1.5}',
      '.kf_ok{color:var(--dsw-alias-state-success-primary,#4ade80);font-size:12px;line-height:1.5}',
      '.kf_empty{font-size:13px;color:var(--dsw-alias-label-secondary,#888);padding:18px 4px;text-align:center}',
      '.kf_addrow{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.035));border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:12px;padding:13px 15px}',
      '.kf_addrow label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa);min-width:240px;flex:1}',
      '.kf_spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-top-color:var(--dsw-alias-brand-primary,#5b8cff);border-radius:50%;animation:kf_spin .7s linear infinite;vertical-align:-2px;margin-right:6px}',
      '@keyframes kf_spin{to{transform:rotate(360deg)}}',
      '.kf_iconBtn{cursor:pointer;font:inherit;font-size:12px;width:28px;height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:var(--dsw-alias-label-secondary,#9aa);display:inline-flex;align-items:center;justify-content:center;transition:all .12s;flex:none;line-height:1}',
      '.kf_iconBtn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#eee);border-color:var(--dsw-alias-brand-primary,#5b8cff);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12))}',
      '.kf_iconBtn:disabled{opacity:.4;cursor:default}',
      '.kf_envNote{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa);border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:8px;padding:6px 10px;flex:1;min-width:150px;overflow-wrap:anywhere}',
    ].join('')
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="@omdp/dsh-key-fallback"]')) {
      var tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', '@omdp/dsh-key-fallback')
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function api(path, options) {
      return Promise.resolve().then(function () {
        var url = '/dsh-key-fallback' + path
        var opts = Object.assign({ method: 'GET' }, options || {})
        if (opts.body && typeof opts.body !== 'string') {
          opts.body = JSON.stringify(opts.body)
          opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
        }
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null
        var timer = null
        if (ctrl) {
          opts.signal = ctrl.signal
          timer = setTimeout(function () { ctrl.abort() }, 8000)
        }
        var timeoutP = new Promise(function (_, reject) {
          var t = setTimeout(function () { reject(new Error('请求超时')) }, 8000)
          if (typeof t === 'object' && t && typeof t.unref === 'function') t.unref()
        })
        return Promise.race([fetch(url, opts), timeoutP])
      }).then(function (resp) {
        return resp.json().then(function (body) { return { ok: resp.ok, status: resp.status, body: body } }).catch(function () { return { ok: resp.ok, status: resp.status, body: {} } })
      }).catch(function (e) {
        return { ok: false, status: 0, body: { error: '请求超时或失败: ' + (e && e.message || e) } }
      })
    }

    // ── 单个 key 行：状态点 / 短名 / ref / 明文揭示 / 更新 / 删除 ──
    function KeyRow(props) {
      var k = props.entry
      var isEnv = props.source === 'env'
      var editing = React.useState(false)
      var isEditing = editing[0]
      var setEditing = editing[1]
      var val = React.useState('')
      var value = val[0]
      var setValue = val[1]
      var reveal = React.useState(false)
      var isRevealed = reveal[0]
      var setRevealed = reveal[1]
      var plain = React.useState('')
      var plainText = plain[0]
      var setPlain = plain[1]
      var busy = React.useState(false)
      var isBusy = busy[0]
      var setBusy = busy[1]
      var err = React.useState('')
      var setErr = err[1]
      var revealing = React.useState(false)
      var isRevealing = revealing[0]
      var setRevealing = revealing[1]

      function save() {
        if (!value) { setErr('请输入 key'); return }
        setBusy(true); setErr('')
        Promise.resolve().then(function () {
          return api('/keys', { method: 'PATCH', body: { provider: props.provider, ref: k.ref, value: value, label: k.label || '' } })
        })
          .then(function (r) {
            if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return }
            setValue(''); setEditing(false); props.onChanged()
          })
          .catch(function (e) { setErr((e && e.message) || String(e)) })
          .then(function () { setBusy(false) })
      }
      function toggleReveal() {
        if (isRevealed) { setRevealed(false); setPlain(''); return }
        setRevealing(true); setErr('')
        api('/keys/plain?provider=' + encodeURIComponent(props.provider) + '&ref=' + encodeURIComponent(k.ref))
          .then(function (r) {
            setRevealing(false)
            if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return }
            setPlain(r.body.value || ''); setRevealed(true)
          })
          .catch(function (e) { setRevealing(false); setErr(String(e && e.message || e)) })
      }
      var st = k.status || (isEnv ? 'live' : '')
      var cooling = k.cooldownRemainingMs > 0
      var dotCls = isEnv ? 'live' : (cooling || st === 'cooling') ? 'cooling' : (st === 'recovered' ? 'recovered' : 'live')
      var stLabel = isEnv ? '环境' : (cooling ? '冷却 ' + Math.ceil((k.cooldownRemainingMs || 0) / 1000) + 's' : (st === 'recovered' ? '已恢复' : '正常'))
      return ce('div', { className: 'kf_keyRow' + (k.active ? ' active' : '') },
        ce('span', { className: 'kf_statusDot ' + dotCls, title: stLabel }),
        ce('span', { className: 'kf_keyName' },
          k.name || (k.ref || '').slice(-8),
          k.active ? ce('span', { className: 'kf_badge ok', style: { padding: '1px 7px', fontSize: 10.5 } }, '当前') : null,
        ),
        ce('span', { className: 'kf_keyRef', title: k.ref }, k.ref),
        isEnv && !isRevealed
          ? ce('span', { className: 'kf_envNote' },
              props.pool.envSource === 'env' && props.pool.envWritable === false
                ? '由启动环境提供（只读）'
                : '环境来源 · 可编辑/参与轮换',
            )
          : isEditing
            ? ce('input', { className: 'kf_input kf_keyVal', type: 'text', autoComplete: 'off', spellCheck: false, placeholder: '粘贴新 key（只写，不回读）', value: value, onChange: function (e) { setValue(e.target.value) } })
            : ce('span', { className: 'kf_keyVal' },
                isRevealed ? plainText || '(空)' : '[hidden] 已保存',
              ),
        ce('div', { className: 'kf_keyActions' },
          isEnv || !stLabel ? null : ce('span', { className: 'kf_badge ' + ((cooling || st === 'cooling') ? 'warn' : (st === 'recovered' ? 'brand' : 'ok')), style: { padding: '1px 8px', fontSize: 10.5 } }, stLabel),
          ce('button', { className: 'kf_iconBtn', title: isRevealed ? '隐藏明文' : '显示明文', disabled: isRevealing, onClick: toggleReveal }, isRevealing ? '…' : (isRevealed ? '🙈' : '👁')),
          isEnv ? null : (isEditing
            ? ce('span', null,
                ce('button', { className: 'kf_btn primary', disabled: isBusy, onClick: save }, isBusy ? '保存…' : '保存'),
                ce('button', { className: 'kf_btn', onClick: function () { setEditing(false); setValue(''); setErr('') } }, '取消'),
              )
            : ce('button', { className: 'kf_btn', onClick: function () { setEditing(true) } }, '更新')),
          ce('label', { className: 'kf_meta', style: { padding: '2px 8px', gap: 5, fontSize: 11.5, background: 'transparent', border: 'none' } },
            '失败后→',
            ce('select', { className: 'kf_sel', value: k.nextRef || '', onChange: function (e) { api('/keys', { method: 'PATCH', body: { provider: props.provider, ref: k.ref, nextRef: e.target.value } }).then(function () { props.onChanged() }).catch(function () {}) } },
              ce('option', { value: '' }, '自动'),
              (props.allRefs || []).filter(function (r) { return r !== k.ref }).map(function (r) { return ce('option', { key: r, value: r }, displayShort(r, props.allNames)) }),
            ),
          ),
          props.currentRef === k.ref ? null : ce('button', { className: 'kf_btn primary', onClick: function () {
            api('/pools', { method: 'POST', body: { provider: props.provider, enabled: props.pool.enabled, env: props.pool.env, cooldownMs: props.pool.cooldownMs, rotateOn: props.pool.rotateOn, useKeyRef: k.ref } })
              .then(function (r) { if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return } props.onChanged() })
              .catch(function (e) { setErr(String(e && e.message || e)) })
          } }, '设为当前'),
          isEnv ? null : ce('button', { className: 'kf_btn danger', onClick: function () { props.onDelete() } }, '删除'),
        ),
        !k.lastErrorMsg ? null : ce('span', { className: 'kf_err', title: k.lastErrorMsg }, '上次错误: ' + k.lastErrorMsg.slice(0, 50)),
        err ? ce('span', { className: 'kf_err' }, err) : null,
      )
    }

    function displayShort(ref, names) {
      if (names && names[ref]) return names[ref]
      var m = /_key(\d+)$/.exec(ref || '')
      if (m) return 'key' + m[1]
      return (ref || '').slice(-8)
    }

    // ── 单个 provider 池卡片 ──
    function PoolCard(props) {
      var pool = props.pool
      var busySet = React.useState(false)
      var busy = busySet[0]
      var setBusy = busySet[1]
      var errSet = React.useState('')
      var err = errSet[0]
      var setErr = errSet[1]
      var newKey = React.useState('')
      var newKeyVal = newKey[0]
      var setNewKey = newKey[1]
      var addBusy = React.useState(false)
      var isAddBusy = addBusy[0]
      var setAddBusy = addBusy[1]
      var envEdit = React.useState('')
      var envEditVal = envEdit[0]
      var setEnvEdit = envEdit[1]
      var envBusy = React.useState(false)
      var isEnvBusy = envBusy[0]
      var setEnvBusy = envBusy[1]
      var customCode = React.useState('')
      var customCodeVal = customCode[0]
      var setCustomCode = customCode[1]

      function savePool(patch) {
        var body = Object.assign({ provider: pool.provider, enabled: pool.enabled, env: pool.env, cooldownMs: pool.cooldownMs, rotateOn: pool.rotateOn }, patch || {})
        api('/pools', { method: 'POST', body: body })
          .then(function (r) {
            if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return }
            props.onChanged()
          })
          .catch(function (e) { setErr(String(e && e.message || e)) })
      }
      function toggle() {
        if (busy) return
        setBusy(true); setErr('')
        api('/pools', { method: 'POST', body: { provider: pool.provider, enabled: !pool.enabled, env: pool.env, cooldownMs: pool.cooldownMs, rotateOn: pool.rotateOn } })
          .then(function (r) { setBusy(false); if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return } props.onChanged() })
          .catch(function (e) { setBusy(false); setErr(String(e && e.message || e)) })
      }
      function addKey() {
        if (!newKeyVal) { setErr('请粘贴 key'); return }
        setAddBusy(true); setErr('')
        api('/keys', { method: 'POST', body: { provider: pool.provider, label: '', value: newKeyVal } })
          .then(function (r) {
            setAddBusy(false)
            if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return }
            setNewKey(''); props.onChanged()
          })
          .catch(function (e) { setAddBusy(false); setErr(String(e && e.message || e)) })
      }
      function deleteKey(ref) {
        if (!confirm('确认删除这个 key？')) return
        api('/keys?provider=' + encodeURIComponent(pool.provider) + '&ref=' + encodeURIComponent(ref), { method: 'DELETE' })
          .then(function (r) { if (r.ok) props.onChanged(); else setErr((r.body && r.body.error) || ('HTTP ' + r.status)) })
          .catch(function (e) { setErr(String(e && e.message || e)) })
      }
      function deletePool() {
        if (!confirm('确认删除「' + pool.provider + '」池（会清掉所有 key）？')) return
        api('/pools?provider=' + encodeURIComponent(pool.provider), { method: 'DELETE' })
          .then(function (r) { if (r.ok) props.onChanged(); else setErr((r.body && r.body.error) || ('HTTP ' + r.status)) })
          .catch(function (e) { setErr(String(e && e.message || e)) })
      }
      function resetCooldown() {
        api('/reset', { method: 'POST', body: { provider: pool.provider } })
          .then(function (r) { if (r.ok) props.onChanged(); else setErr((r.body && r.body.error) || ('HTTP ' + r.status)) })
          .catch(function (e) { setErr(String(e && e.message || e)) })
      }
      function toggleCode(code) {
        var next = (pool.rotateOn || []).slice()
        var i = next.indexOf(code)
        if (i >= 0) next.splice(i, 1)
        else next.push(code)
        if (next.length === 0) next = ROTATE_CODES.slice()
        savePool({ rotateOn: next })
      }
      function addCustomCode() {
        var c = String(customCodeVal || '').trim().toUpperCase().replace(/\s+/g, '_')
        if (!c) return
        var next = (pool.rotateOn || []).slice()
        if (next.indexOf(c) < 0) next.push(c)
        setCustomCode('')
        savePool({ rotateOn: next })
      }
      function saveEnvKey() {
        if (!envEditVal) { setErr('请输入环境密钥'); return }
        setEnvBusy(true); setErr('')
        api('/keys', { method: 'PATCH', body: { provider: pool.provider, ref: pool.env, value: envEditVal } })
          .then(function (r) {
            setEnvBusy(false)
            if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return }
            setEnvEdit(''); props.onChanged()
          })
          .catch(function (e) { setEnvBusy(false); setErr(String(e && e.message || e)) })
      }
      var keys = Array.isArray(pool.keys) ? pool.keys : []
      var userKeys = keys.filter(function (k) { return k.ref !== pool.env })
      var allRefs = keys.map(function (x) { return x.ref })
      var allNames = {}
      keys.forEach(function (k) { allNames[k.ref] = k.name })

      return ce('div', { className: 'kf_card' },
        ce('div', { className: 'kf_cardHead' },
          ce('span', { className: 'kf_avatar' }, (pool.displayName || pool.provider || '?').slice(0, 1)),
          ce('div', { className: 'kf_name' },
            pool.displayName || pool.provider,
            ce('span', { className: 'kf_badge ' + (pool.enabled ? 'ok' : 'muted') }, pool.enabled ? '启用' : '停用'),
            ce('span', { className: 'kf_badge muted' }, 'env: ' + pool.env),
          ),
          ce('div', { style: { flex: 1 } }),
          ce('button', { className: 'kf_btn', title: '重置冷却', onClick: resetCooldown }, '↺ 重置冷却'),
          ce('div', { className: 'kf_switch' + (pool.enabled ? ' on' : ''), onClick: toggle, title: pool.enabled ? '停用' : '启用' }),
          ce('button', { className: 'kf_btn danger', disabled: busy, onClick: deletePool }, '删除池'),
        ),
        ce('div', { className: 'kf_meta' },
          ce('span', null, 'key 数: ', ce('b', null, keys.length)),
          ce('span', null, 'cooldown: ', ce('b', null, pool.cooldownMs + ' ms')),
          ce('span', null, '当前使用: ', pool.activeRef && pool.activeName
            ? ce('span', { className: 'kf_activePill' }, pool.activeName)
            : ce('span', { className: 'kf_badge muted', style: { padding: '1px 8px', fontSize: 10.5 } }, '尚未使用')),
          ce('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            ce('span', null, '锁定:'),
            ce('select', { className: 'kf_sel', value: pool.useKeyRef || '_auto', onChange: function (e) { var v = e.target.value; savePool({ useKeyRef: (v === '_auto' ? '' : v) }) } },
              ce('option', { value: '_auto' }, '自动轮换'),
              (keys).map(function (k) { return ce('option', { value: k.ref, key: k.ref }, (k.ref === pool.env ? '[环境] ' : '') + (k.name || k.ref.slice(-8))) }),
            ),
          ),
        ),
        ce('div', { className: 'kf_section' }, '轮换触发码'),
        ce('div', { className: 'kf_chips' },
          ROTATE_CODES.map(function (code) {
            var on = (pool.rotateOn || []).indexOf(code) >= 0
            return ce('button', { key: code, className: 'kf_chip' + (on ? ' on' : ''), title: codeLabel(code), onClick: function () { toggleCode(code) } }, codeLabel(code))
          }),
        ),
        ce('div', { className: 'kf_customRow' },
          ce('input', { className: 'kf_input', style: { width: 130 }, placeholder: '自定义错误码', value: customCodeVal, onChange: function (e) { setCustomCode(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') addCustomCode() } }),
          ce('button', { className: 'kf_btn ghost', onClick: addCustomCode }, '+ 添加'),
          (pool.rotateOn || []).filter(function (c) { return ROTATE_CODES.indexOf(c) < 0 }).map(function (c) {
            return ce('span', { key: c, className: 'kf_chip on' }, c)
          }),
          ce('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#9aa)' } }, '勾选=该错误发生后换下一把 key；换 key 与 DSH 的重试再发相互独立'),
        ),
        ce('div', { className: 'kf_customRow', style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#778)', lineHeight: 1.6 } },
          '补充：DSH 的重试插件负责「同一把 key 重发几次」，由各模型 provider 的 retryPolicy 决定；',
          ce('br'),
          '这里只决定「失败后是否切换到下一把 key」。预设 chips 已含 LlmError 标准码，下方输入框用于添加非标准/自定义错误码（与 provider 返回的 failure.code 精确匹配）。',
        ),
        ce('div', { className: 'kf_section' }, '密钥链'),
        keys.length === 0
          ? ce('div', { className: 'kf_empty' }, '还没有 key。在下方粘贴第一个。')
          : ce('div', { className: 'kf_keys' },
              keys.map(function (k) {
                return ce(KeyRow, { key: k.ref, entry: k, provider: pool.provider, pool: pool, allRefs: allRefs, allNames: allNames, onDelete: (k.ref === pool.env) ? null : function () { deleteKey(k.ref) }, onChanged: props.onChanged, source: (k.ref === pool.env) ? 'env' : 'user', currentRef: pool.activeRef || '' })
              }),
            ),
        true
          ? ce('div', { className: 'kf_customRow', style: { background: 'var(--dsw-alias-bg-base,rgba(0,0,0,.1))', padding: '8px 10px', borderRadius: 10 } },
              ce('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary,#9aa)', flex: '0 0 auto' } }, '更新环境密钥 (' + pool.env + '):'),
              pool.envWritable === false
                ? ce('span', { className: 'kf_envNote', style: { border: 'none', padding: 0 } }, '由启动环境提供，只读（请在启动 DSH 的终端里修改）')
                : ce('span', { style: { display: 'flex', flex: 1, gap: 8, flexWrap: 'wrap', minWidth: 220 } },
                    ce('input', { className: 'kf_input kf_keyVal', type: 'text', autoComplete: 'off', spellCheck: false, placeholder: '粘贴新环境密钥（只写，不回读）', value: envEditVal, onChange: function (e) { setEnvEdit(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') saveEnvKey() } }),
                    ce('button', { className: 'kf_btn primary', disabled: isEnvBusy, onClick: saveEnvKey }, isEnvBusy ? '保存…' : '保存'),
                  ),
            )
          : null,
        ce('div', { className: 'kf_customRow' },
          ce('input', { className: 'kf_input kf_keyVal', type: 'text', autoComplete: 'off', spellCheck: false, placeholder: '粘贴新 API key 后点添加（只写，保存后不回读）', value: newKeyVal, onChange: function (e) { setNewKey(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') addKey() } }),
          ce('button', { className: 'kf_btn primary', disabled: isAddBusy, onClick: addKey }, isAddBusy ? '添加中…' : '+ 添加 key'),
        ),
        err ? ce('div', { className: 'kf_err' }, err) : null,
      )
    }

    // ── 顶级 Tab ──
    function FallbackTab() {
      var poolsSet = React.useState(null)
      var pools = poolsSet[0]
      var setPools = poolsSet[1]
      var dirSet = React.useState(null)
      var dir = dirSet[0]
      var setDir = dirSet[1]
      var errSet = React.useState('')
      var err = errSet[0]
      var setErr = errSet[1]
      var pickSet = React.useState('')
      var pick = pickSet[0]
      var setPick = pickSet[1]
      var addingSet = React.useState(false)
      var adding = addingSet[0]
      var setAdding = addingSet[1]
      var refreshing = React.useState(false)
      var isRefreshing = refreshing[0]
      var setRefreshing = refreshing[1]

      function refresh() {
        setRefreshing(true)
        Promise.all([api('/pools'), api('/providers')])
          .then(function (rs) {
            setRefreshing(false)
            if (!rs[0].ok) { setErr((rs[0].body && rs[0].body.error) || ('HTTP ' + rs[0].status)); return }
            setPools(rs[0].body.pools || [])
            var d = rs[1] && rs[1].body || {}; setDir((d && typeof d === 'object') ? d : {})
            setErr('')
          })
          .catch(function (e) { setRefreshing(false); setErr(String(e && e.message || e)) })
      }
      React.useEffect(function () { refresh() }, [])

      function addPool() {
        if (!pick) { setErr('请选择 provider'); return }
        api('/pools', { method: 'POST', body: { provider: pick, enabled: true } })
          .then(function (r) {
            if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return }
            setPick(''); setAdding(false); refresh()
          })
          .catch(function (e) { setErr(String(e && e.message || e)) })
      }

      var existing = new Set((pools || []).map(function (p) { return p.provider }))
      var all = []
      if (dir) {
        var dl = Array.isArray(dir.live || dir.providers) ? dir.live : []
        var dd = Array.isArray(dir.dormant) ? dir.dormant : []
        dl.forEach(function (p) { if (!existing.has(p.id)) all.push({ id: p.id, name: p.name, hint: '运行中' }) })
        dd.forEach(function (p) { if (!existing.has(p.id)) all.push({ id: p.id, name: p.name, hint: '休眠' }) })
      }

      return ce('div', { className: 'kf_root' },
        ce('div', { className: 'kf_head' },
          ce('div', null,
            ce('h2', { className: 'kf_title' }, ce('span', { className: 'kf_dot' }), 'API Key 回退'),
            ce('p', { className: 'kf_sub' }, '为 LLM provider 维护多个 API key，请求失败时自动换下一个 key 重试。key 只写入本机 .credentials.yaml，不进设置文件。'),
          ),
          ce('div', { className: 'kf_headRight' },
            (pools || []).length === 0 ? ce('span', { className: 'kf_badge warn' }, '尚未启用') : ce('span', { className: 'kf_badge ok' }, (pools || []).length + ' 个池'),
            ce('button', { className: 'kf_btn', disabled: isRefreshing, onClick: refresh }, isRefreshing ? '刷新…' : '↻ 刷新'),
          ),
        ),
        ce('div', { className: 'kf_addrow' },
          adding
            ? ce('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', width: '100%' } },
                ce('label', null,
                  ce('span', null, '选择 LLM provider'),
                  ce('select', { className: 'kf_sel', style: { fontSize: 13, padding: '7px 10px' }, value: pick, onChange: function (e) { setPick(e.target.value) } },
                    ce('option', { value: '' }, '— 选择 —'),
                    all.map(function (p) { return ce('option', { value: p.id, key: p.id }, p.name + '（' + p.id + ' · ' + p.hint + '）') }),
                  ),
                ),
                ce('button', { className: 'kf_btn primary', onClick: addPool }, '启用'),
                ce('button', { className: 'kf_btn', onClick: function () { setAdding(false); setPick('') } }, '取消'),
              )
            : ce('button', { className: 'kf_btn primary', onClick: function () { setAdding(true) } }, '+ 启用新 provider 池'),
        ),
        err ? ce('div', { className: 'kf_err' }, err) : null,
        !pools
          ? ce('div', { className: 'kf_empty' }, ce('span', { className: 'kf_spinner' }), '加载中…')
          : pools.length === 0 ? ce('div', { className: 'kf_empty' }, '还没有任何池，点上方「启用新 provider 池」开始。')
          : pools.map(function (p) { return ce(PoolCard, { key: p.provider, pool: p, onChanged: refresh }) }),
      )
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', function () {
        return slots.register({
          name: 'settings.section',
          id: 'key-fallback',
          order: 62,
          label: 'API Key 回退',
        }, FallbackTab)
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
