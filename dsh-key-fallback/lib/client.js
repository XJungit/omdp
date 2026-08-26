// @omdp/dsh-key-fallback — Client half (v3)
//
// 独立设置页「设置 → API Key 回退」：
//  1) provider 下拉（来自 /providers：live + dormant）→ 「启用」创建池
//  2) 每个池一张卡片：enabled 开关 / env / cooldownMs / rotateOn chips /
//     key 链（只写输入，保存后不回读，只显示 [hidden] 占位 + 删除）
//  3) 顶部刷新按钮 + 冷却重置
//
// 走 fetch 跟 host 通信（/dsh-key-fallback/*），视觉用 --dsw-alias-* 变量。
//
// ── 诊断：把渲染/运行时错误上报到 host 的 /dsh-key-fallback/diag ──
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

    // ── CSS（一次注入）──
    var CSS = [
      '.kf_root{display:flex;flex-direction:column;gap:16px;padding:0 24px 28px}',
      '.kf_head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));padding-bottom:12px}',
      '.kf_title{font-size:17px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);margin:0}',
      '.kf_sub{font-size:12.5px;color:var(--dsw-alias-label-secondary,#9aa);margin:4px 0 0;line-height:1.55}',
      '.kf_card{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.035));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
      '.kf_cardHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.kf_name{font-weight:600;font-size:14.5px;color:var(--dsw-alias-label-primary,#eee);display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.kf_badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid currentColor;line-height:1.6;white-space:nowrap}',
      '.kf_badge.muted{color:var(--dsw-alias-label-secondary,#9aa)}',
      '.kf_badge.ok{color:var(--dsw-alias-state-success-primary,#4ade80)}',
      '.kf_badge.warn{color:var(--dsw-alias-state-warn-primary,#fbbf24)}',
      '.kf_badge.brand{color:var(--dsw-alias-brand-primary,#7aa2ff);border-color:var(--dsw-alias-brand-primary,#7aa2ff)}',
      '.kf_badge.err{color:var(--dsw-alias-state-error-primary,#f87171)}',
      '.kf_switch{position:relative;width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.3));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));cursor:pointer;transition:background .15s;flex:none}',
      '.kf_switch::after{content:"";position:absolute;top:1px;left:1px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary,#9aa);transition:transform .15s,background .15s}',
      '.kf_switch.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 50%,transparent);border-color:var(--dsw-alias-brand-primary,#5b8cff)}',
      '.kf_switch.on::after{transform:translateX(14px);background:var(--dsw-alias-brand-primary,#7aa2ff)}',
      '.kf_btn{cursor:pointer;font:inherit;font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:inherit;transition:background .12s;flex:none}',
      '.kf_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}',
      '.kf_btn:disabled{opacity:.45;cursor:default}',
      '.kf_btn.primary{border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 15%,transparent);color:var(--dsw-alias-brand-primary,#7aa2ff)}',
      '.kf_btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 26%,transparent)}',
      '.kf_btn.danger{color:var(--dsw-alias-state-error-primary,#f87171);border-color:currentColor}',
      '.kf_btn.ghost{border-style:dashed}',
      '.kf_form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}',
      '.kf_form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa)}',
      '.kf_form input,.kf_form select,.kf_chips select{font:inherit;font-size:13px;padding:6px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-base,rgba(0,0,0,.18));color:inherit}',
      '.kf_form input:focus,.kf_form select:focus{outline:2px solid var(--dsw-alias-brand-primary,rgba(91,140,255,.5));outline-offset:0;border-color:transparent}',
      '.kf_keys{display:flex;flex-direction:column;gap:6px}',
      '.kf_keyRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:8px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.16));flex-wrap:wrap}',
      '.kf_keyLabel{font-weight:500;font-size:12.5px;color:var(--dsw-alias-label-primary,#eee);min-width:120px;flex:0 0 auto;display:flex;gap:8px;align-items:center}',
      '.kf_keyRef{font-size:11px;color:var(--dsw-alias-label-secondary,#9aa);font-family:ui-monospace,Menlo,Consolas,monospace;opacity:.7}',
      '.kf_inputSecret{flex:1;min-width:200px;font:inherit;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-base,rgba(0,0,0,.25));color:inherit}',
      '.kf_inputSecret:focus{outline:2px solid var(--dsw-alias-brand-primary,rgba(91,140,255,.5));border-color:transparent}',
      '.kf_hiddenBadge{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa);font-family:ui-monospace,Menlo,Consolas,monospace;padding:7px 10px;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:8px;flex:1;min-width:200px;text-align:center}',
      '.kf_chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.kf_chip{cursor:pointer;font:inherit;font-size:11.5px;padding:3px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:var(--dsw-alias-label-secondary,#9aa);transition:all .12s}',
      '.kf_chip:hover{color:var(--dsw-alias-label-primary,#ddd);border-color:var(--dsw-alias-brand-primary,#5b8cff)}',
      '.kf_chip.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 26%,transparent);color:var(--dsw-alias-brand-primary,#7aa2ff);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 60%,transparent)}',
      '.kf_err{color:var(--dsw-alias-state-error-primary,#f87171);font-size:12.5px;line-height:1.5}',
      '.kf_status{font-size:11px;padding:1px 8px;border-radius:999px;line-height:1.7;white-space:nowrap;flex:none}',
      '.kf_status.live{color:var(--dsw-alias-state-success-primary,#4ade80)}',
      '.kf_status.cooling{color:var(--dsw-alias-state-warn-primary,#fbbf24)}',
      '.kf_status.cooldown{color:var(--dsw-alias-state-error-primary,#f87171)}',
      '.kf_nextRow{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa)}',
      '.kf_nextSel{font:inherit;font-size:12px;background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:6px;padding:2px 6px}',
      '.kf_ok{color:var(--dsw-alias-state-success-primary,#4ade80);font-size:12.5px;line-height:1.5}',
      '.kf_empty{font-size:13px;color:var(--dsw-alias-label-secondary,#888);padding:16px 4px;text-align:center}',
      '.kf_addrow{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.035));border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:12px;padding:12px 14px}',
      '.kf_addrow label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa);min-width:240px;flex:1}',
      '.kf_spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-top-color:var(--dsw-alias-brand-primary,#5b8cff);border-radius:50%;animation:kf_spin .7s linear infinite;vertical-align:-2px;margin-right:6px}',
      '@keyframes kf_spin{to{transform:rotate(360deg)}}',
    ].join('')
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="@omdp/dsh-key-fallback"]')) {
      var tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', '@omdp/dsh-key-fallback')
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function api(path, options) {
      // 先进入 Promise 微任务：JSON.stringify、AbortController、fetch 的同步异常
      // 也必须落到统一错误结果，不能让按钮卡在"保存中"。
      return Promise.resolve().then(function () {
        var url = '/dsh-key-fallback' + path
        var opts = Object.assign({ method: 'GET' }, options || {})
        if (opts.body && typeof opts.body !== 'string') {
          opts.body = JSON.stringify(opts.body)
          opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
        }
        // 8s 超时：避免请求挂起导致 UI 一直"保存中"
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null
        var timer = null
        if (ctrl) {
          opts.signal = ctrl.signal
          timer = setTimeout(function () { ctrl.abort() }, 8000)
        }
        // Promise.race：即使宿主 fetch 忽略 AbortSignal，也保证 8s 内 settle，
        // 避免保存/删除永久卡在“保存中”。
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

    // ── 单个 key 行：编辑态显示 password input，未编辑显示 [hidden] 占位 ──
    function KeyRow(props) {
      var k = props.entry
      var editing = React.useState(false)
      var isEditing = editing[0]
      var setEditing = editing[1]
      var val = React.useState('')
      var value = val[0]
      var setValue = val[1]
      var busy = React.useState(false)
      var isBusy = busy[0]
      var setBusy = busy[1]
      var err = React.useState('')
      var setErr = err[1]
      function save() {
        if (!value) { setErr('请输入 key'); return }
        setBusy(true); setErr('')
        try {
          __kfReportDiag('save', 'PATCH start provider=' + props.provider + ' ref=')
        } catch (e) {}
        // 额外包一层 Promise：即使 api 被宿主替换或请求构造同步抛错，
        // 也一定会进入 catch，按钮不会永久停在"保存中"。
        Promise.resolve().then(function () {
          return api('/keys', { method: 'PATCH', body: { provider: props.provider, ref: k.ref, value: value, label: k.label || '' } })
        })
          .then(function (r) {
            if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return }
            setValue(''); setEditing(false); props.onChanged()
          })
          .catch(function (e) {
            setErr((e && e.message) || String(e))
          })
          .then(function () {
            // 成功、HTTP 错误、请求异常全部收口 busy 状态。
            setBusy(false)
          })
      }
      var isEnv = props.source === 'env'
      var st = k.status || (isEnv ? 'live' : '')
      var nowMs = Date.now()
      var cooling = k.cooldownRemainingMs > 0
      var stLabel = isEnv ? '' : (st === 'cooling' || cooling) ? ('冷却中 ' + Math.ceil((k.cooldownRemainingMs || 0) / 1000) + 's') : (st === 'recovered' ? '已恢复' : (st === 'cooldown' ? '冷却' : '正常'))
      return ce('div', { className: 'kf_keyRow' },
        ce('div', { className: 'kf_keyLabel' },
          k.label ? k.label : (k.ref || '').slice(-8),
          isEnv ? ce('span', { className: 'kf_badge brand' }, '[环境来源]') : null,
          isEnv || !stLabel ? null : ce('span', { className: 'kf_status ' + ((st === 'cooling' || cooling) ? 'cooling' : 'live') }, stLabel),
          ce('span', { className: 'kf_keyRef' }, k.ref)
        ),
        isEnv
          ? ce('span', { className: 'kf_hiddenBadge', style: { flex: 1 } }, '来自环境配置（不可编辑/删除；可设为当前、参与轮换）')
          : isEditing
            ? ce('div', null,
                ce('input', { className: 'kf_inputSecret', type: 'text', autoComplete: 'off', spellCheck: false, placeholder: '粘贴新 key（只写，不回读）', value: value, onChange: function (e) { setValue(e.target.value) } }),
                ce('button', { className: 'kf_btn primary', disabled: isBusy, onClick: save }, isBusy ? '保存…' : '保存'),
                ce('button', { className: 'kf_btn', onClick: function () { setEditing(false); setValue(''); setErr('') } }, '取消'),
              )
            : ce('div', null,
                ce('span', { className: 'kf_hiddenBadge' }, '[hidden] 已保存（点击「更新」可改）'),
                ce('button', { className: 'kf_btn', onClick: function () { setEditing(true) } }, '更新'),
              ),
        ce('label', { className: 'kf_nextRow' },
            '失败后切换到',
            ce('select', { className: 'kf_nextSel', value: k.nextRef || '', onChange: function (e) { api('/keys', { method: 'PATCH', body: { provider: props.provider, ref: k.ref, nextRef: e.target.value } }).then(function () { props.onChanged() }).catch(function () {}) } },
              ce('option', { value: '' }, '自动（顺序循环）'),
              (props.allRefs || []).filter(function (r) { return r !== k.ref }).map(function (r) { return ce('option', { key: r, value: r }, r.slice(-12)) }),
            ),
          ),
                props.currentRef === k.ref ? null : ce('button', { className: 'kf_btn primary', onClick: function () {
                  api('/keys', { method: 'PATCH', body: { provider: props.provider, ref: k.ref, useKeyRef: k.ref } })
                    .then(function () { props.onChanged() }).catch(function (e) { setErr((e && e.message) || String(e)) })
                } }, '设为当前'),
                isEnv ? null : ce('button', { className: 'kf_btn danger', onClick: function () { props.onDelete() } }, '删除'),
        isEnv || !k.lastErrorMsg ? null : ce('span', { className: 'kf_err', title: k.lastErrorMsg }, '上次错误: ' + k.lastErrorMsg.slice(0, 60)),
        err ? ce('span', { className: 'kf_err' }, err) : null,
      )
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
      var okSet = React.useState('')
      var ok = okSet[0]
      var setOk = okSet[1]
      var newKey = React.useState('')
      var newKeyVal = newKey[0]
      var setNewKey = newKey[1]
      var addBusy = React.useState(false)
      var isAddBusy = addBusy[0]
      var setAddBusy = addBusy[1]

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
      function setUseKey(ref) {
        api('/pools', { method: 'POST', body: { provider: pool.provider, enabled: pool.enabled, env: pool.env, cooldownMs: pool.cooldownMs, rotateOn: pool.rotateOn, useKeyRef: ref } })
          .then(function (r) { if (!r.ok) { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); return } props.onChanged() })
          .catch(function (e) { setErr(String(e && e.message || e)) })
      }
      function deletePool() {
        if (!confirm('确认删除「' + pool.provider + '」池（会清掉所有 key）？')) return
        api('/pools?provider=' + encodeURIComponent(pool.provider), { method: 'DELETE' })
          .then(function (r) { if (r.ok) props.onChanged(); else setErr((r.body && r.body.error) || ('HTTP ' + r.status)) })
          .catch(function (e) { setErr(String(e && e.message || e)) })
      }
      return ce('div', { className: 'kf_card' },
        ce('div', { className: 'kf_cardHead' },
          ce('div', { className: 'kf_name' },
            pool.displayName || pool.provider,
            ce('span', { className: 'kf_badge ' + (pool.enabled ? 'ok' : 'muted') }, pool.enabled ? '启用' : '停用'),
            ce('span', { className: 'kf_badge muted' }, 'env: ' + pool.env),
          ),
          ce('div', { style: { flex: 1 } }),
          ce('div', { className: 'kf_switch' + (pool.enabled ? ' on' : ''), onClick: toggle, title: pool.enabled ? '停用' : '启用' }),
          ce('button', { className: 'kf_btn danger', disabled: busy, onClick: deletePool }, '删除池'),
        ),
        ce('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#9aa)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' } },
          ce('span', null, 'key 数: ' + (Array.isArray(pool.keys) ? pool.keys.length : 0)),
          pool.currentRef ? ce('span', { style: { color: 'var(--dsw-alias-brand-primary,#7aa2ff)' } }, '当前用: ' + pool.currentRef.slice(-12)) : null,
          ce('span', null, 'cooldown: ' + (pool.cooldownMs || 0) + ' ms'),
          ce('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            ce('span', null, '当前使用:'),
            ce('select', { value: pool.useKeyRef || '_auto', onChange: function (e) { var v = e.target.value; if (v === '_auto') setUseKey(''); else setUseKey(v) } },
              ce('option', { value: '_auto' }, '自动轮换'),
              (Array.isArray(pool.keys) ? pool.keys : []).map(function (k) {
                return ce('option', { value: k.ref, key: k.ref }, (k.ref === pool.env ? '[环境] ' : '') + (k.label || k.ref.slice(-8)))
              }),
            ),
          ),
        ),
        ce('div', { className: 'kf_chips' },
          ce('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary,#9aa)', alignSelf: 'center' } }, '轮换触发码:'),
          ['QUOTA_EXCEEDED', 'AUTH', 'RATE_LIMIT'].map(function (code) {
            return ce('span', { key: code, className: 'kf_chip' + ((pool.rotateOn || []).includes(code) ? ' active' : '') }, code)
          }),
        ),
        ((Array.isArray(pool.keys) ? pool.keys : [])).length === 0
          ? ce('div', { className: 'kf_empty' }, '还没有 key。在下方粘贴第一个。')
          : ce('div', { className: 'kf_keys' }, (Array.isArray(pool.keys) ? pool.keys : []).map(function (k) {
                return ce(KeyRow, { key: k.ref, entry: k, provider: pool.provider, allRefs: (Array.isArray(pool.keys) ? pool.keys : []).map(function (x) { return x.ref }), onDelete: (k.ref === pool.env) ? null : function () { deleteKey(k.ref) }, onChanged: props.onChanged, source: (k.ref === pool.env) ? 'env' : 'user', currentRef: pool.currentRef || '' })
              }),
            ),
        ce('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
          ce('input', { className: 'kf_inputSecret', style: { flex: 1, minWidth: 220 }, type: 'text', autoComplete: 'off', spellCheck: false, placeholder: '粘贴新 API key 后点添加（只写，保存后不回读）', value: newKeyVal, onChange: function (e) { setNewKey(e.target.value) } }),
          ce('button', { className: 'kf_btn primary', disabled: isAddBusy, onClick: addKey }, isAddBusy ? '添加中…' : '添加 key'),
        ),
        err ? ce('div', { className: 'kf_err' }, err) : null,
        ok ? ce('div', { className: 'kf_ok' }, ok) : null,
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

      function refresh() {
        Promise.all([api('/pools'), api('/providers')])
          .then(function (rs) {
            if (!rs[0].ok) { setErr((rs[0].body && rs[0].body.error) || ('HTTP ' + rs[0].status)); return }
            setPools(rs[0].body.pools || [])
            var d = rs[1] && rs[1].body || {}; setDir((d && typeof d === 'object') ? d : {})
            setErr('')
          })
          .catch(function (e) { setErr(String(e && e.message || e)) })
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
            ce('h2', { className: 'kf_title' }, 'API Key 回退'),
            ce('p', { className: 'kf_sub' }, '为 LLM provider 维护多个 API key，请求失败时自动换下一个 key 重试。key 只写入本机 .credentials.yaml，不进设置文件。'),
          ),
          (pools || []).length === 0 ? ce('span', { className: 'kf_badge warn' }, '尚未启用') : ce('span', { className: 'kf_badge ok' }, (pools || []).length + ' 个池'),
        ),
        ce('div', { className: 'kf_addrow' },
          adding
            ? ce('div', null,
                ce('label', null,
                  ce('span', null, '选择 LLM provider'),
                  ce('select', { value: pick, onChange: function (e) { setPick(e.target.value) } },
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