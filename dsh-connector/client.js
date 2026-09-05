/**
 * @omdp/dsh-connector — client half.
 *
 * Installed-package client bundle: the harness serves this file at
 * /plugins/<id>/client.js and expects a single window.__ModuleLoader__.load
 * handoff whose factory receives `require`. We register one unified settings
 * tab ("Connector") with three panes:
 *   - MCP servers: read/edit the mcp-* block of cordis.patch.yml
 *   - user skills:  list/view/edit/remove SKILL.md files under ~/.dsh/skills
 *   - marketplace:  read-only ModelScope Skills Center + MCP Plaza browser
 *                   (30-min in-process cache on the host, nothing on disk)
 *
 * It talks to the host half over the Package-private HTTP API the host mounts
 * on the DSH GUI webserver (/connector/api/*), exactly like
 * dsh-mcp-manager's client does with fetch — not the dynamic-only host.call.
 *
 * Visual language follows the DSH theme tokens (--dsw-alias-*): surfaces use
 * layer-1/2 backgrounds, borders use border-l1/l2, accents use brand-primary,
 * and badges reuse the state success/warn colors so the panel blends into the
 * GUI in both light and dark themes.
 *
 * @module @omdp/dsh-connector/client
 */

window.__ModuleLoader__.load({
  id: '@omdp/dsh-connector',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')
    var createElement = react.createElement

    var css =
      /* layout */
      '.pm_root{display:flex;flex-direction:column;gap:18px;padding:0 24px 28px}' +
      '.pm_tabs{display:flex;gap:4px;padding:2px 24px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));margin:0 -24px 4px}' +
      '.pm_tab{cursor:pointer;font:inherit;font-size:13px;padding:8px 14px 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9aa);border-bottom:2px solid transparent;margin-bottom:-1px}' +
      '.pm_tab:hover{color:var(--dsw-alias-label-primary,#ddd)}' +
      '.pm_tab.active{color:var(--dsw-alias-label-primary,#f4f4f4);border-bottom-color:var(--dsw-alias-brand-primary,#5b8cff);font-weight:600}' +
      '.pm_section{display:flex;flex-direction:column;gap:12px}' +
      '.pm_sectionHead{font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-primary,#eee);display:flex;align-items:center;gap:8px}' +
      '.pm_sectionHead .pm_hint{margin-left:0}' +
      /* cards */
      '.pm_card{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.035));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;transition:background .15s,border-color .15s}' +
      '.pm_card:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.4))}' +
      '.pm_cardHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.pm_name{font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary,#eee)}' +
      '.pm_meta{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa);word-break:break-all;line-height:1.5}' +
      '.pm_desc{font-size:12.5px;color:var(--dsw-alias-label-secondary,#aab);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      /* badges */
      '.pm_badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid currentColor;line-height:1.6;white-space:nowrap}' +
      '.pm_badge.muted{color:var(--dsw-alias-label-secondary,#9aa)}' +
      '.pm_badge.ok{color:var(--dsw-alias-state-success-primary,#4ade80)}' +
      '.pm_badge.warn{color:var(--dsw-alias-state-warn-primary,#fbbf24)}' +
      '.pm_badge.brand{color:var(--dsw-alias-brand-primary,#7aa2ff);border-color:var(--dsw-alias-brand-primary,#7aa2ff)}' +
      '.pm_badge.err{color:var(--dsw-alias-state-error-primary,#f87171)}' +
      /* buttons */
      '.pm_actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.pm_btn{cursor:pointer;font:inherit;font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:inherit;transition:background .12s;flex:none}' +
      '.pm_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}' +
      '.pm_btn:disabled{opacity:.45;cursor:default}' +
      '.pm_btn.primary{border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 15%,transparent);color:var(--dsw-alias-brand-primary,#7aa2ff)}' +
      '.pm_btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 26%,transparent)}' +
      '.pm_btn.danger{color:var(--dsw-alias-state-error-primary,#f87171);border-color:currentColor}' +
      '.pm_btn.ghost{border-style:dashed}' +
      /* form */
      '.pm_form{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.pm_form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa)}' +
      '.pm_form input,.pm_form textarea,.pm_form select{font:inherit;font-size:13px;padding:6px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));color:inherit}' +
      '.pm_form input:focus,.pm_form textarea:focus,.pm_form select:focus{outline:2px solid var(--dsw-alias-brand-primary,rgba(91,140,255,.5));outline-offset:0;border-color:transparent}' +
      '.pm_form .wide{grid-column:1 / -1}' +
      '.pm_textarea{font-family:ui-monospace,Menlo,Consolas,monospace;min-height:140px}' +
      /* market */
      '.pm_search{display:flex;gap:8px}' +
      '.pm_search input{flex:1;font:inherit;font-size:13px;padding:7px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));color:inherit}' +
      '.pm_search input:focus{outline:2px solid var(--dsw-alias-brand-primary,rgba(91,140,255,.5));border-color:transparent}' +
      '.pm_groupHead{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#9aa);text-transform:uppercase;letter-spacing:.08em;margin:8px 0 2px}' +
      '.pm_code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55;background:var(--dsw-alias-bg-base,rgba(0,0,0,.25));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));border-radius:8px;padding:8px 10px;overflow:auto;max-height:220px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary,#9aa)}' +
      '.pm_envRow{display:flex;gap:8px;align-items:baseline;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa)}' +
      '.pm_envRow code{color:var(--dsw-alias-label-primary,#ddd)}' +
      '.pm_spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-top-color:var(--dsw-alias-brand-primary,#5b8cff);border-radius:50%;animation:pm_spin .7s linear infinite;vertical-align:-2px}' +
      '@keyframes pm_spin{to{transform:rotate(360deg)}}' +
      '.pm_err{color:var(--dsw-alias-state-error-primary,#f87171);font-size:12px}' +
      '.pm_ok{color:var(--dsw-alias-state-success-primary,#4ade80);font-size:12px}' +
      '.pm_empty{font-size:12px;color:var(--dsw-alias-label-secondary,#888);padding:10px 2px}' +
      '.pm_btnrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      /* market grid & icons */
      '.pm_grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:2px;align-items:start}' +
      '@media(max-width:760px){.pm_grid{grid-template-columns:1fr}}' +
      '.pm_mcard{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.035));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;transition:background .15s,border-color .15s}' +
      '.pm_mcard:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.4))}' +
      '.pm_mhead{display:flex;align-items:center;gap:10px;min-width:0}' +
      '.pm_icon{width:38px;height:38px;border-radius:10px;flex:none;object-fit:cover;background:var(--dsw-alias-bg-layer-2,#333);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25))}' +
      '.pm_avatar{width:38px;height:38px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#fff;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 72%,#1e1e28),color-mix(in srgb,#a06bff 72%,#1e1e28));text-transform:uppercase}' +
      '.pm_mtitle{min-width:0;flex:1}' +
      '.pm_mname{font-weight:600;font-size:13.5px;color:var(--dsw-alias-label-primary,#eee);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px}' +
      '.pm_mid{font-size:11px;color:var(--dsw-alias-label-secondary,#9aa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.pm_stats{display:flex;gap:12px;flex-wrap:wrap}' +
      '.pm_stat{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa);display:inline-flex;align-items:center;gap:4px}' +
      '.pm_stat b{font-weight:600;color:inherit}' +
      '.pm_chips{display:flex;gap:6px;flex-wrap:wrap}' +
      '.pm_chip{cursor:pointer;font:inherit;font-size:11.5px;padding:4px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:var(--dsw-alias-label-secondary,#9aa);transition:all .12s}' +
      '.pm_chip:hover{color:var(--dsw-alias-label-primary,#ddd);border-color:var(--dsw-alias-brand-primary,#5b8cff)}' +
      '.pm_chip.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 26%,transparent);color:var(--dsw-alias-brand-primary,#7aa2ff);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#5b8cff) 60%,transparent)}' +
      '.pm_chipToggle{color:var(--dsw-alias-brand-primary,#5b8cff);border-style:dashed}' +
      '.pm_toolFilter{margin-top:10px;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l1,rgba(128,128,128,.22));display:flex;flex-direction:column;gap:8px}' +
      '.pm_toolFilterHead{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);display:flex;align-items:center;gap:8px;flex-wrap:wrap}'

    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@omdp/dsh-connector/section"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = '@omdp/dsh-connector'
      tag.dataset.pluginCss = '@omdp/dsh-connector/section'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    function api(path, options) {
      return fetch('/connector/api' + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      }).then(function (resp) {
        return resp.json().catch(function () { return {} })
      })
    }

    // Clipboard with a fallback: 127.0.0.1 is a secure context so
    // navigator.clipboard normally works; execCommand covers edge cases.
    function copyText(text, done) {
      function fallback() {
        try {
          var ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          var ok = document.execCommand('copy')
          document.body.removeChild(ta)
          done(ok === true)
        } catch (e) {
          done(false)
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true) }, fallback)
      } else {
        fallback()
      }
    }

    function useCopied() {
      var _a = react.useState('')
      var copied = _a[0]
      var setCopied = _a[1]
      function copy(text) {
        copyText(text, function (ok) {
          setCopied(ok ? '已复制 ✓' : '复制失败')
          setTimeout(function () { setCopied('') }, 1600)
        })
      }
      return { copied: copied, copy: copy }
    }

    // Server ids must stay kebab-case under the fixed `mcp-` prefix: the host
    // parser and dsh-mcp-client both key on it, so the prefix is not optional.
    var MCP_ID_RE = /^mcp-[a-z0-9]+(?:-[a-z0-9]+)*$/

    function deriveServerId(serverName) {
      var base = (serverName || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return 'mcp-' + (base || 'server')
    }

    function field(label, value, onChange) {
      return createElement('label', { className: 'wide' },
        label,
        createElement('input', { value: value || '', onChange: function (e) { onChange(e.target.value) } }),
      )
    }

    function selectField(label, value, opts, onChange) {
      return createElement('label', null,
        label,
        createElement('select', { value: value || opts[0], onChange: function (e) { onChange(e.target.value) } },
          opts.map(function (o) { return createElement('option', { value: o, key: o }, o) }),
        ),
      )
    }

    function badge(text, kind) {
      return createElement('span', { className: 'pm_badge ' + kind }, text)
    }

    function ManageTab() {
      var _a = react.useState('mcp')
      var tab = _a[0]
      var setTab = _a[1]
      var _b = react.useState({ servers: [], exists: true })
      var mcp = _b[0]
      var setMcp = _b[1]
      var _c = react.useState([])
      var skills = _c[0]
      var setSkills = _c[1]
      var _d = react.useState('')
      var error = _d[0]
      var setError = _d[1]
      var _e = react.useState(false)
      var busy = _e[0]
      var setBusy = _e[1]

      function refresh() {
        setBusy(true)
        setError('')
        Promise.all([api('/mcp', { method: 'GET' }), api('/skills', { method: 'GET' })]).then(function (r) {
          setMcp(r[0])
          setSkills(r[1].skills || [])
        }).catch(function (e) {
          setError(String(e))
        }).finally(function () { setBusy(false) })
      }
      react.useEffect(function () { refresh() }, [])

      return createElement('div', { className: 'pm_root' },
        createElement('div', { className: 'pm_tabs' },
          createElement('button', { className: 'pm_tab' + (tab === 'mcp' ? ' active' : ''), onClick: function () { setTab('mcp') } }, 'MCP 服务器'),
          createElement('button', { className: 'pm_tab' + (tab === 'skills' ? ' active' : ''), onClick: function () { setTab('skills') } }, 'Skills 技能'),
          createElement('button', { className: 'pm_tab' + (tab === 'market' ? ' active' : ''), onClick: function () { setTab('market') } }, '市场探索'),
        ),
        error ? createElement('div', { className: 'pm_err' }, error) : null,
        tab === 'mcp'
          ? createElement(McpPane, { mcp: mcp, busy: busy, onChanged: refresh })
          : tab === 'skills'
            ? createElement(SkillPane, { skills: skills, busy: busy, onChanged: refresh })
            : createElement(MarketPane, { skills: skills, onChanged: refresh }),
      )
    }

    /* ─────────────────────────── MCP servers ─────────────────────────── */

    /* ─────────────────── MCP 工具过滤（tool-filter）───────────────────
     * 每个 server 一张卡片下的工具多选区：勾选 = allow 放行，未勾 = prompt 隐藏
     * + 执行期硬拦截。无配置 = 全量放行。规则存 settings.yaml `connector:` 节，
     * 保存后新会话即生效（无需重启；当前会话的已加载 schema 下次请求刷新）。
     * 工具列表来自 host 的 GET /api/mcp/tools/:serverName（读 tools.schemas()
     * 的实时注册）；server 未连接时列表为空，显示提示而非多选框。
     * ─────────────────────────────────────────────────────────────── */

    // 全 server 的过滤规则缓存：key: serverName → { tools: [publicName], allow: [rawName] }。
    // 注意：这是普通函数（非 Hook），由 McpPane 直接调用；内部的 useState/useEffect
    // 之所以合法，是因为 McpPane 每次渲染都以相同顺序调用它（servers 为空时也调用，
    // 只是 effect 内提前返回）。servers 变化才重拉。
    function useToolFilters(servers) {
      var _a = react.useState({})
      var cache = _a[0]
      var setCache = _a[1]
      react.useEffect(function () {
        var cancelled = false
        var names = (servers || []).map(function (s) { return s.serverName }).filter(Boolean)
        if (!names.length) { setCache({}); return }
        Promise.all(names.map(function (n) {
          return api('/mcp/tools/' + encodeURIComponent(n), { method: 'GET' })
            .then(function (r) { return { name: n, data: r } })
            .catch(function () { return { name: n, data: null } })
        })).then(function (pairs) {
          if (cancelled) return
          var next = {}
          pairs.forEach(function (p) {
            if (p.data && !p.data.error) next[p.name] = { tools: p.data.tools || [], allow: p.data.allow || [] }
          })
          setCache(next)
        })
        return function () { cancelled = true }
      }, [(servers || []).map(function (s) { return s.serverName }).join(',')])
      return [cache, setCache]
    }

    function ToolFilterBadge(props) {
      // 卡片头徽标：有过滤规则才显示“已过滤 N/M”，无规则不占位。
      var info = (props.cache || {})[props.serverName]
      if (!info || !info.allow.length || !info.tools.length) return null
      return badge('已过滤 ' + info.allow.length + '/' + info.tools.length, 'brand')
    }

    function ToolFilterBox(props) {
      var info = (props.cache || {})[props.serverName]
      var _a = react.useState(false)
      var saving = _a[0]
      var setSaving = _a[1]
      var _b = react.useState('')
      var err = _b[0]
      var setErr = _b[1]
      if (!props.serverName) return null
      if (!info) return createElement('div', { className: 'pm_meta' }, '工具列表加载中…')
      if (!info.tools.length) return createElement('div', { className: 'pm_meta' }, '该 server 暂无已注册工具（未连接或无需过滤）。')
      var allow = info.allow
      // raw 名 = 公开名去掉 `mcp__<server>__` 前缀。serverName 本身可含下划线
      // 但公开名用双下划线分隔、且 server 是第一段，所以按 `__` 切分取第一段
      // 校验后余下 join 回 raw（与 host 侧 splitPublicName 同逻辑）。
      function rawOf(publicName) {
        var parts = String(publicName).slice(5).split('__')
        if (parts.length >= 2 && parts[0] === props.serverName) return parts.slice(1).join('__')
        var prefix = 'mcp__' + props.serverName + '__'
        if (String(publicName).indexOf(prefix) === 0) return String(publicName).slice(prefix.length)
        return publicName
      }
      function toggle(raw) {
        var next = allow.indexOf(raw) === -1 ? allow.concat([raw]) : allow.filter(function (t) { return t !== raw })
        save(next)
      }
      function save(next) {
        setSaving(true)
        setErr('')
        var body = { filters: {} }
        // 读当前全量规则：只改这一个 server，其余保持（避免并发覆盖）。
        api('/mcp/filters', { method: 'GET' }).then(function (r) {
          var filters = (r && r.filters) || {}
          if (!next.length) delete filters[props.serverName]
          else filters[props.serverName] = { allow: next }
          body.filters = filters
          return api('/mcp/filters', { method: 'PUT', body: JSON.stringify(body) })
        }).then(function (r) {
          if (r && r.error) { setErr(r.error); return }
          changed()
        }).catch(function (e) {
          setErr(String(e))
        }).finally(function () { setSaving(false) })
      }
      return createElement('div', { className: 'pm_toolFilter' },
        createElement('div', { className: 'pm_toolFilterHead' },
          '工具过滤 Tool filter',
          saving ? createElement('span', { className: 'pm_spinner' }) : null,
          allow.length
            ? createElement('button', { className: 'pm_btn', onClick: function () { save([]) } }, '清除（全量放行）')
            : createElement('span', { className: 'pm_meta' }, '未配置 = 全量放行'),
        ),
        err ? createElement('div', { className: 'pm_err' }, err) : null,
        createElement('div', { className: 'pm_chips' },
          info.tools.map(function (pub) {
            var raw = rawOf(pub)
            var on = allow.indexOf(raw) !== -1
            return createElement('button', {
              key: pub,
              className: 'pm_chip' + (on ? ' active' : ''),
              title: pub,
              onClick: function () { toggle(raw) },
            }, (on ? '✓ ' : '') + raw)
          }),
        ),
        createElement('div', { className: 'pm_meta' }, '保存后新会话即生效，无需重启。未勾选的工具模型不可见、调用被拒。'),
      )
    }

    function McpPane(props) {
      var _a = react.useState(null)
      var editing = _a[0]
      var setEditing = _a[1]
      var _b = react.useState('')
      var err = _b[0]
      var setErr = _b[1]
      var _c = useToolFilters(props.mcp.servers)
      var filterCache = _c[0]
      var setFilterCache = _c[1]
      // 刷新后工具列表可能变化（server 重连/改名），清掉旧缓存重拉。
      function changed() {
        setFilterCache({})
        props.onChanged()
      }

      function save(server) {
        api('/mcp', {
          method: 'POST',
          body: JSON.stringify({ servers: props.mcp.servers.map(function (s) { return s.id === server.id ? server : s }).concat(props.mcp.servers.some(function (s) { return s.id === server.id }) ? [] : [server]) }),
        }).then(function (r) {
          if (r && r.error) { setErr(r.error); return }
          setErr('')
          setEditing(null)
          changed()
        })
      }
      function remove(id) {
        api('/mcp', {
          method: 'POST',
          body: JSON.stringify({ servers: props.mcp.servers.filter(function (s) { return s.id !== id }) }),
        }).then(function (r) {
          if (r && r.error) { setErr(r.error); return }
          setErr('')
          changed()
        })
      }

      var rows = props.mcp.servers.map(function (s) {
        return createElement('div', { className: 'pm_card', key: s.id },
          createElement('div', { className: 'pm_cardHead' },
            createElement('span', { className: 'pm_name' }, s.name || s.id),
            badge(s.transport || 'stdio', 'muted'),
            createElement(ToolFilterBadge, { serverName: s.serverName, cache: filterCache }),
          ),
          createElement('div', { className: 'pm_meta' }, s.url ? 'url: ' + s.url : (s.command ? 'cmd: ' + s.command : '')),
          createElement('div', { className: 'pm_actions' },
            createElement('button', { className: 'pm_btn', onClick: function () { setEditing(s) } }, '编辑 Edit'),
            createElement('button', { className: 'pm_btn danger', onClick: function () { remove(s.id) } }, '删除 Delete'),
          ),
          createElement(ToolFilterBox, { serverName: s.serverName, cache: filterCache, onChanged: changed }),
        )
      })

      return createElement('div', { className: 'pm_section' },
        createElement('div', { className: 'pm_sectionHead' },
          'MCP 服务器 MCP Servers',
          props.busy ? createElement('span', { className: 'pm_spinner' }) : null,
        ),
        err ? createElement('div', { className: 'pm_err' }, err) : null,
        createElement('div', { className: 'pm_meta' },
          props.mcp.exists ? '编辑 profiles/web/cordis.patch.yml 中的 mcp-* 块。保存后重启 dsh 生效。Edit the mcp-* block in cordis.patch.yml; restart dsh to apply.' : '未找到 cordis.patch.yml。cordis.patch.yml not found.'),
        rows,
        editing === null
          ? createElement('button', { className: 'pm_btn pm_btn ghost', onClick: function () { setEditing({ id: 'mcp-new', customId: '', name: '', transport: 'stdio', serverName: '', url: '', command: '', args: '' }) } }, '＋ 添加 MCP 服务器 Add MCP Server')
          : createElement(ServerForm, { value: editing, onSave: save, onCancel: function () { setEditing(null) } }),
      )
    }

    function ServerForm(props) {
      // Normalize a block-sequence `args` (parsed into argsLines[]) into the
      // space-separated string the form edits, and drop argsLines so a save
      // always goes through the `args` field (renderServer re-emits it as an
      // inline array). Without this, editing a server whose args were written
      // as a YAML block sequence shows an empty Args box, and clearing the
      // field can't remove the old argsLines.
      function initForm(value) {
        var a = value.args || ''
        if (!a && value.argsLines && value.argsLines.length) {
          a = value.argsLines.join(' ')
        }
        var next = Object.assign({}, value, { args: a })
        delete next.argsLines
        return next
      }
      var _a = react.useState(initForm(props.value))
      var v = _a[0]
      var setV = _a[1]
      var _b = react.useState('')
      var err = _b[0]
      var setErr = _b[1]
      function set(key) { return function (val) { var next = Object.assign({}, v); next[key] = val; setV(next) } }

      var isNew = v.id === 'mcp-new'
      var derivedId = deriveServerId(v.serverName || v.name)
      var idValue = isNew ? (v.customId !== undefined && v.customId !== '' ? v.customId : derivedId) : v.id

      // dsh-mcp-client's own serverName contract; the harness rejects anything
      // else at boot, so it must be rejected here.
      var SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
      var CONTROL_CHARS = /[\x00-\x1f\x7f]/
      var TRANSPORTS = { stdio: true, 'streamable-http': true }

      function looksLikeExpression(value) {
        var text = (value || '').trim()
        return text.indexOf('!!js') === 0 || text.indexOf('process.env') !== -1 || text.indexOf('&&') !== -1 || text.indexOf('(') === 0
      }

      function submit() {
        var problems = []
        var t = v.transport || 'stdio'
        var name = (v.serverName || '').trim()
        if (!name) problems.push('serverName 必填 Name is required')
        else if (!SERVER_NAME_RE.test(name)) problems.push('serverName 必须为 1-32 位 [A-Za-z0-9_-] Name must match [A-Za-z0-9_-]{1,32}')
        if (!TRANSPORTS[t]) problems.push('未知传输类型 Unknown transport')
        if (t === 'stdio') {
          var command = (v.command || '').trim()
          if (!command) problems.push('stdio 传输必须填 Command Command is required for stdio')
          else if (/\s|['"]/.test(command)) problems.push('Command 必须是单个词，不能有空格或引号 Command must be a single token (no spaces/quotes)')
          else if (CONTROL_CHARS.test(command)) problems.push('Command 不能含控制字符 Command must not contain control characters')
          var argsText = (v.args || '').trim()
          if (argsText && CONTROL_CHARS.test(argsText)) problems.push('Args 不能含控制字符 Args must not contain control characters')
        }
        if (t === 'streamable-http') {
          var url = (v.url || '').trim()
          if (!url) problems.push('streamable-http 传输必须填 URL URL is required for streamable-http')
          else if (!looksLikeExpression(url)) {
            try {
              var parsed = new URL(url)
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') problems.push('URL 必须是 http(s) URL must be http(s)')
            } catch (e) {
              problems.push('URL 无效 Invalid URL')
            }
          }
        }
        if (isNew) {
          var custom = (v.customId || '').trim()
          if (custom && !MCP_ID_RE.test(custom)) problems.push('ID 必须以 mcp- 开头且为小写 kebab-case，如 mcp-github ID must be mcp-<kebab-case>')
        }
        if (problems.length) { setErr(problems.join('；')); return }
        setErr('')
        // Never send a stale argsLines back: renderServer prefers argsLines over
        // args, so a leftover array would clobber the edited/cleared args field.
        var next = Object.assign({}, v)
        delete next.argsLines
        if (isNew) {
          var id = MCP_ID_RE.test(custom) ? custom : derivedId
          props.onSave(Object.assign({}, next, { id: id, name: v.serverName || v.name }))
        } else {
          props.onSave(Object.assign({}, next, { name: v.serverName || v.name }))
        }
      }

      return createElement('div', { className: 'pm_card' },
        err ? createElement('div', { className: 'pm_err' }, err) : null,
        createElement('div', { className: 'pm_form' },
          field('名称 (serverName) Name', v.serverName, set('serverName')),
          selectField('传输 Transport', v.transport, ['stdio', 'streamable-http'], set('transport')),
          field('URL (http)', v.url, set('url')),
          field('命令 (stdio) Command', v.command, set('command')),
          field('参数 (空格分隔) Args', v.args, set('args')),
          field('Header', v.header, set('header')),
          isNew
            ? createElement('label', { className: 'wide' },
                'ID (默认自动生成，前缀固定 mcp- 如 mcp-github) ID (auto, fixed mcp- prefix)',
                createElement('input', {
                  value: idValue,
                  onChange: function (e) { set('customId')(e.target.value) },
                }),
              )
            : createElement('div', { className: 'pm_meta wide' }, 'id: ' + v.id),
        ),
        createElement('div', { className: 'pm_actions' },
          createElement('button', { className: 'pm_btn primary', onClick: submit }, '保存 Save'),
          createElement('button', { className: 'pm_btn', onClick: props.onCancel }, '取消 Cancel'),
        ),
      )
    }

    /* ───────────────────────────── Skills ────────────────────────────── */

    function SkillPane(props) {
      var _a = react.useState(null)
      var editing = _a[0]
      var setEditing = _a[1]
      var _b = react.useState('')
      var err = _b[0]
      var setErr = _b[1]
      var _c = react.useState(null)
      var updates = _c[0]
      var setUpdates = _c[1]
      var _d = react.useState(false)
      var checking = _d[0]
      var setChecking = _d[1]

      function open(name) {
        api('/skills/' + encodeURIComponent(name), { method: 'GET' }).then(function (skill) {
          if (skill && skill.error) { setErr(skill.error); return }
          setErr('')
          setEditing(skill)
        })
      }
      function save(skill) {
        api('/skills', { method: 'PUT', body: JSON.stringify(skill) }).then(function (r) {
          if (r && r.error) { setErr(r.error); return }
          setErr('')
          setEditing(null)
          props.onChanged()
        })
      }
      function remove(name) {
        api('/skills/' + encodeURIComponent(name), { method: 'DELETE' }).then(function (r) {
          if (r && r.error) { setErr(r.error); return }
          setErr('')
          props.onChanged()
        })
      }
      function checkUpdates() {
        setChecking(true)
        setErr('')
        api('/skills/check-updates', { method: 'GET' }).then(function (r) {
          if (r && r.error) { setErr(r.error); setUpdates(null); return }
          setUpdates(r.items || [])
        }).finally(function () { setChecking(false) })
      }

      var rows = props.skills.map(function (s) {
        var update = updates ? updates.find(function (u) { return u.name === s.name }) : null
        return createElement('div', { className: 'pm_card', key: s.name },
          createElement('div', { className: 'pm_cardHead' },
            createElement('span', { className: 'pm_name' }, s.name),
            s.source ? badge('来源 ' + s.source, 'muted') : null,
            update ? (update.updateAvailable ? badge('有更新', 'warn') : badge('最新', 'ok')) : null,
          ),
          createElement('div', { className: 'pm_meta' }, s.description || ''),
          createElement('div', { className: 'pm_actions' },
            createElement('button', { className: 'pm_btn', onClick: function () { open(s.name) } }, '编辑 Edit'),
            createElement('button', { className: 'pm_btn danger', onClick: function () { remove(s.name) } }, '删除 Delete'),
          ),
        )
      })

      return createElement('div', { className: 'pm_section' },
        createElement('div', { className: 'pm_sectionHead' },
          '用户 Skills (~/.dsh/skills) User Skills',
          props.busy ? createElement('span', { className: 'pm_spinner' }) : null,
          createElement('span', { className: 'pm_actions', style: { marginLeft: 'auto' } },
            createElement('button', { className: 'pm_btn', disabled: checking, onClick: checkUpdates }, checking ? '检查中…' : '检查更新'),
          ),
        ),
        err ? createElement('div', { className: 'pm_err' }, err) : null,
        createElement('div', { className: 'pm_meta' }, '读写用户技能目录，保存即生效（skill catalog 自动刷新）。带来源的 skill 可与魔搭市场比对更新时间。Read/write user skills; saved changes take effect immediately.'),
        rows,
        editing === null
          ? createElement('button', { className: 'pm_btn pm_btn ghost', onClick: function () { setEditing({ name: '', description: '', content: '' }) } }, '＋ 新建 Skill New Skill')
          : createElement(SkillForm, { value: editing, onSave: save, onCancel: function () { setEditing(null) } }),
      )
    }

    function SkillForm(props) {
      var _a = react.useState(props.value)
      var v = _a[0]
      var setV = _a[1]
      var _b = react.useState('')
      var err = _b[0]
      var setErr = _b[1]
      function set(key) { return function (val) { var next = Object.assign({}, v); next[key] = val; setV(next) } }

      function submit() {
        var name = (v.name || '').trim()
        if (!name) { setErr('名称必填 Name is required'); return }
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) { setErr('名称必须是小写 kebab-case，如 my-skill Name must be kebab-case'); return }
        setErr('')
        props.onSave(Object.assign({}, v, { name: name }))
      }

      return createElement('div', { className: 'pm_card' },
        err ? createElement('div', { className: 'pm_err' }, err) : null,
        createElement('div', { className: 'pm_form' },
          field('名称 (kebab-case) Name', v.name, set('name')),
          field('描述 Description', v.description, set('description')),
          createElement('label', { className: 'wide' },
            'SKILL.md 内容 (Markdown) Content',
            createElement('textarea', { className: 'pm_textarea wide', value: v.content || '', onChange: function (e) { var next = Object.assign({}, v); next.content = e.target.value; setV(next) } }),
          ),
        ),
        createElement('div', { className: 'pm_actions' },
          createElement('button', { className: 'pm_btn primary', onClick: submit }, '保存 Save'),
          createElement('button', { className: 'pm_btn', onClick: props.onCancel }, '取消 Cancel'),
        ),
      )
    }

    /* ─────────────────────────── marketplace ─────────────────────────── */

    // 12 official ModelScope skill categories (skills-center.md taxonomy).
    var SKILL_CATEGORIES = [
      { id: '', label: '全部' },
      { id: 'developer-tools', label: '开发者工具' },
      { id: 'code-quality-testing', label: '代码质量' },
      { id: 'ai-media', label: 'AI 媒体' },
      { id: 'frontend-development', label: '前端开发' },
      { id: 'cloud-devops', label: '云与运维' },
      { id: 'ai-automation', label: 'AI 自动化' },
      { id: 'analytics', label: '数据分析' },
      { id: 'doc-processing', label: '文档处理' },
      { id: 'skill-management', label: '技能管理' },
      { id: 'mobile-development', label: '移动开发' },
      { id: 'marketing-seo', label: '营销 SEO' },
      { id: 'other', label: '其他' },
    ]

    // 12438 -> "12.4k", 987654 -> "987.7k", 1.2e7 -> "12.0M"
    function fmtNum(n) {
      var v = Number(n)
      if (!isFinite(v)) return ''
      if (v >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '亿'
      if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
      if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
      return String(v)
    }

    var SKILL_CAT_LABEL = {}
    SKILL_CATEGORIES.forEach(function (c) { if (c.id) SKILL_CAT_LABEL[c.id] = c.label })
    function catLabel(id) { return SKILL_CAT_LABEL[id] || id }

    function MarketIcon(props) {
      var _a = react.useState(true)
      var ok = _a[0]
      var setOk = _a[1]
      if (props.logo && ok) {
        return createElement('img', {
          className: 'pm_icon',
          src: props.logo,
          alt: '',
          onError: function () { setOk(false) },
        })
      }
      return createElement('div', { className: 'pm_avatar' }, (props.label || '?').charAt(0))
    }

    // Chinese labels for the official ModelScope MCP plaza taxonomy (the
    // dolphin API returns ~90 category ids with exact counts via FiledAgg;
    // labels below are the sidebar names where they exist, sensible
    // translations elsewhere, and the raw id as a fallback).
    var MCP_CAT_LABEL = {
      'developer-tools': '开发者工具', search: '搜索工具', 'calendar-management': '日程管理',
      other: '其他', 'browser-automation': '浏览器自动化', 'knowledge-and-memory': '知识管理',
      communication: '交流协作', 'research-and-data': '学术研究', databases: '数据库',
      'app-automation': '应用自动化', finance: '金融', 'file-systems': '文件系统',
      'entertainment-and-media': '娱乐与多媒体', 'cloud-platforms': '云平台', 'os-automation': '系统自动化',
      'rag-systems': 'RAG 系统', 'image-and-video-processing': '图像视频', 'autonomous-agents': '自主智能体',
      'note-taking': '笔记记录', 'version-control': '版本控制', 'location-services': '位置服务',
      monitoring: '监控', 'agent-orchestration': 'Agent 编排', 'security-and-iam': '安全与身份',
      'code-execution': '代码执行', 'web-scraping': '网页抓取', 'content-management-systems': '内容管理',
      'documentation-access': '文档访问', 'art-and-culture': '文化与艺术', 'social-media': '社交媒体',
      virtualization: '虚拟化', 'project-management': '项目管理', 'code-analysis': '代码分析',
      'ecommerce-and-retail': '电商零售', 'multimedia-processing': '多媒体处理',
      'travel-and-transportation': '出行交通', 'customer-data-platforms': '客户数据平台',
      marketing: '营销', 'cloud-storage': '云存储', 'education-and-learning-tools': '教育学习',
      'testing-and-qa-tools': '测试质检', 'home-automation-and-iot': '家居物联网', 'shell-access': 'Shell 访问',
      'command-line': '命令行', 'api-testing': 'API 测试', 'ci-cd': 'CI/CD', 'vector-databases': '向量数据库',
      'games-and-gamification': '游戏化', 'speech-processing': '语音处理', 'health-and-wellness': '健康',
      'text-summarization': '文本摘要', 'customer-and-marketing': '客户营销', 'weather-services': '天气服务',
      observability: '可观测性', 'data-platforms': '数据平台', 'customer-support': '客户支持',
      'open-data': '开放数据', blockchain: '区块链', 'government-data': '政务数据',
      'coding-agents': '编程智能体', 'audio-processing': '音频处理', 'penetration-testing': '渗透测试',
      cryptocurrency: '加密货币', 'language-translation': '语言翻译', 'text-to-speech': '语音合成',
      'erp-systems': '企业 ERP', 'fitness-tracking': '健身追踪', 'legal-and-compliance': '法律合规',
      'biology-and-medicine': '生物医学', 'software-architecture': '软件架构', AIGC: 'AIGC',
      bioinformatics: '生物信息', 'home-automation': '家居自动化', security: '安全', sports: '体育',
      transportation: '交通运输', productivity: '生产力工具', 'feature-flags': '特性开关', education: '教育',
      'weather-and-climate': '天气气候', 'health-and-fitness': '健康健身', 'real-estate': '房地产',
      'fitness-and-sports': '健身运动', 'network-services': '网络服务', healthcare: '医疗保健',
      'sports-and-recreation': '运动休闲', 'Knowledge&Memory': '知识管理', weather: '天气', travel: '出行',
      DeveloperTools: '开发者工具', 'network-monitoring': '网络监控', fitness: '健身',
      'Research&Data': '学术研究', 'travel-services': '出行服务', health: '健康',
      'research-an-data': '学术研究', 'aerospace-and-astrodynamics': '航空航天', data: '数据',
      'security-and-compliance': '安全合规', gaming: '游戏', 'workplace-and-productivity': '工作生产力',
      web3: 'Web3',
    }
    var MCP_CAT_LABEL_OF = function (id) { return MCP_CAT_LABEL[id] || id }

    function MarketPane(props) {
      var _a = react.useState('')
      var mcpSearch = _a[0]
      var setMcpSearch = _a[1]
      var _b = react.useState(null)
      var mcpResult = _b[0]
      var setMcpResult = _b[1]
      var _c = react.useState(false)
      var mcpBusy = _c[0]
      var setMcpBusy = _c[1]
      var _d = react.useState({})
      var mcpDetail = _d[0]
      var setMcpDetail = _d[1]
      var _e = react.useState('')
      var skillSearch = _e[0]
      var setSkillSearch = _e[1]
      var _f = react.useState(null)
      var skillResult = _f[0]
      var setSkillResult = _f[1]
      var _g = react.useState(false)
      var skillBusy = _g[0]
      var setSkillBusy = _g[1]
      var _h = react.useState({})
      var skillDetail = _h[0]
      var setSkillDetail = _h[1]
      var _i = react.useState('')
      var err = _i[0]
      var setErr = _i[1]
      var _j = react.useState('')
      var category = _j[0]
      var setCategory = _j[1]
      var _k = react.useState('mcp')
      var sub = _k[0]
      var setSub = _k[1]
      var _l = react.useState('')
      var mcpCat = _l[0]
      var setMcpCat = _l[1]
      var _m = react.useState(1)
      var mcpPage = _m[0]
      var setMcpPage = _m[1]
      var _n = react.useState(1)
      var skillPage = _n[0]
      var setSkillPage = _n[1]
      var _o = react.useState([])
      var mcpCats = _o[0]
      var setMcpCats = _o[1]
      var _p = react.useState(false)
      var mcpCatsOpen = _p[0]
      var setMcpCatsOpen = _p[1]
      // Collapsed state shows "all" + the top popular categories (the dolphin
      // category table arrives in count-descending order); the toggle reveals
      // the full taxonomy.
      var visibleMcpCats = mcpCatsOpen || !mcpCats.length ? mcpCats : mcpCats.slice(0, 12)

      function findMcp(term, cat, page, append) {
        var q = (term !== undefined ? term : mcpSearch).trim()
        var c = cat !== undefined ? cat : mcpCat
        var p = page || 1
        setMcpBusy(true)
        setErr('')
        api('/market/mcp?search=' + encodeURIComponent(q) + '&page=' + p + (c ? '&category=' + encodeURIComponent(c) : ''), { method: 'GET' }).then(function (r) {
          if (r && r.error) { setErr(r.error); setMcpResult(null); return }
          if (!c) setMcpCats(r.categories || []) // unfiltered responses carry the global category table
          setMcpResult(append && mcpResult ? Object.assign({}, r, { items: mcpResult.items.concat(r.items) }) : r)
          setMcpPage(p)
        }).finally(function () { setMcpBusy(false) })
      }
      function findSkills(term, cat, page, append) {
        var q = (term !== undefined ? term : skillSearch).trim()
        var c = cat !== undefined ? cat : category
        var p = page || 1
        setSkillBusy(true)
        setErr('')
        var qs = '/market/skills?search=' + encodeURIComponent(q) + '&page=' + p
        if (c) qs += '&category=' + encodeURIComponent(c)
        api(qs, { method: 'GET' }).then(function (r) {
          if (r && r.error) { setErr(r.error); setSkillResult(null); return }
          setSkillResult(append && skillResult ? Object.assign({}, r, { items: skillResult.items.concat(r.items) }) : r)
          setSkillPage(p)
        }).finally(function () { setSkillBusy(false) })
      }
      function openMcp(id) {
        api('/market/mcp/' + encodeURIComponent(id), { method: 'GET' }).then(function (r) {
          if (r && r.error) { setErr(r.error); return }
          var next = Object.assign({}, mcpDetail)
          next[id] = r.item
          setMcpDetail(next)
        })
      }
      function openSkill(id) {
        api('/market/skills/' + encodeURIComponent(id), { method: 'GET' }).then(function (r) {
          if (r && r.error) { setErr(r.error); return }
          var next = Object.assign({}, skillDetail)
          next[id] = r.item
          setSkillDetail(next)
        })
      }

      // Load the default (hot) lists right away so the tab never opens empty.
      react.useEffect(function () {
        findMcp('', '', 1, false)
        findSkills('', '', 1, false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // Category filtering is server-side (dolphin Criterion); the response
      // total already reflects the chosen category and the item list arrives
      // pre-filtered with exact counts (FiledAgg) mirrored on the chips.
      var loadedMcp = mcpResult && mcpResult.items ? mcpResult.items : []
      var mcpRows = loadedMcp
        .map(function (s) {
          var d = mcpDetail[s.id]
          return createElement(McpMarketItem, {
            key: s.id, item: s, detail: d,
            onOpen: function () {
              if (d) {
                var next = Object.assign({}, mcpDetail)
                delete next[s.id]
                setMcpDetail(next)
              } else {
                openMcp(s.id)
              }
            },
          })
        })

      var skillRows = skillResult && skillResult.items
        ? skillResult.items.map(function (s) {
            var d = skillDetail[s.id]
            return createElement(SkillMarketItem, {
              key: s.id, item: s, detail: d, skills: props.skills,
              onOpen: function () {
                if (d) {
                  var next = Object.assign({}, skillDetail)
                  delete next[s.id]
                  setSkillDetail(next)
                } else {
                  openSkill(s.id)
                }
              },
              onChanged: props.onChanged,
            })
          })
        : []

      return createElement('div', { className: 'pm_section' },
        createElement('div', { className: 'pm_sectionHead' }, '市场探索 Marketplace'),
        createElement('div', { className: 'pm_meta' },
          '浏览魔搭社区（ModelScope）技能中心与 MCP 广场。列表数据缓存在 DSH 进程内存（30 分钟），不写任何文件；安装/部署请复制命令自行执行。Browse ModelScope Skills Center & MCP Plaza; cached in-process only, nothing saved to disk.'),
        err ? createElement('div', { className: 'pm_err' }, err) : null,

        createElement('div', { className: 'pm_chips', style: { margin: '2px 0 4px' } },
          createElement('button', { className: 'pm_chip' + (sub === 'mcp' ? ' active' : ''), onClick: function () { setSub('mcp') } }, 'MCP 市场'),
          createElement('button', { className: 'pm_chip' + (sub === 'skills' ? ' active' : ''), onClick: function () { setSub('skills') } }, 'Skills 市场'),
        ),

        sub === 'mcp'
          ? createElement('div', { className: 'pm_section' },
              createElement('div', { className: 'pm_search' },
                createElement('input', {
                  placeholder: '搜索 MCP 服务，如 map / github / fetch Search…',
                  value: mcpSearch,
                  onChange: function (e) { setMcpSearch(e.target.value) },
                  onKeyDown: function (e) { if (e.key === 'Enter') findMcp(undefined, undefined, 1, false) },
                }),
                createElement('button', { className: 'pm_btn primary', disabled: mcpBusy, onClick: function () { findMcp(undefined, undefined, 1, false) } }, mcpBusy ? '搜索中…' : '搜索'),
              ),
              createElement('div', { className: 'pm_chips' },
                createElement('button', {
                  key: 'all',
                  className: 'pm_chip' + (!mcpCat ? ' active' : ''),
                  onClick: function () { setMcpCat(''); findMcp(undefined, '', 1, false) },
                }, '全部 ' + (mcpResult && mcpResult.total ? mcpResult.total.toLocaleString() : '')),
                visibleMcpCats.map(function (c) {
                  return createElement('button', {
                    key: c.id,
                    className: 'pm_chip' + (mcpCat === c.id ? ' active' : ''),
                    onClick: function () { setMcpCat(c.id); findMcp(undefined, c.id, 1, false) },
                  }, MCP_CAT_LABEL_OF(c.id) + ' ' + c.count.toLocaleString())
                }),
                mcpCats.length > 12
                  ? createElement('button', {
                      key: 'toggle',
                      className: 'pm_chip pm_chipToggle',
                      onClick: function () { setMcpCatsOpen(!mcpCatsOpen) },
                    }, mcpCatsOpen ? '收起 ▴' : '展开全部 ' + mcpCats.length + ' ▾')
                  : null,
              ),
              mcpResult && mcpResult.total
                ? createElement('div', { className: 'pm_meta' },
                    (mcpCat
                      ? '分类 ' + MCP_CAT_LABEL_OF(mcpCat) + '：共 ' + mcpResult.total.toLocaleString() + ' 个 MCP 服务'
                      : '共 ' + mcpResult.total.toLocaleString() + ' 个 MCP 服务，已加载 ' + loadedMcp.length + ' 条'),
                  )
                : null,
              createElement('div', { className: 'pm_grid' }, mcpRows),
              mcpResult && mcpResult.items && !loadedMcp.length
                ? createElement('div', { className: 'pm_empty' }, '没有匹配的 MCP 服务。No matching MCP servers.')
                : null,
              mcpResult && mcpResult.hasMore
                ? createElement('div', { className: 'pm_actions', style: { justifyContent: 'center' } },
                    createElement('button', { className: 'pm_btn', disabled: mcpBusy, onClick: function () { findMcp(mcpSearch, mcpCat, mcpPage + 1, true) } }, '加载更多 ' + mcpResult.total.toLocaleString() + ' 中已看 ' + loadedMcp.length),
                  )
                : null,
            )
          : createElement('div', { className: 'pm_section' },
              createElement('div', { className: 'pm_search' },
                createElement('input', {
                  placeholder: '搜索技能，如 code-review / deploy Search…',
                  value: skillSearch,
                  onChange: function (e) { setSkillSearch(e.target.value) },
                  onKeyDown: function (e) { if (e.key === 'Enter') findSkills(undefined, undefined, 1, false) },
                }),
                createElement('button', { className: 'pm_btn primary', disabled: skillBusy, onClick: function () { findSkills(undefined, undefined, 1, false) } }, skillBusy ? '搜索中…' : '搜索'),
              ),
              createElement('div', { className: 'pm_chips' },
                SKILL_CATEGORIES.map(function (c) {
                  return createElement('button', {
                    key: c.id || 'all',
                    className: 'pm_chip' + (category === c.id ? ' active' : ''),
                    onClick: function () { setCategory(c.id); setSkillPage(1); findSkills(skillSearch, c.id, 1, false) },
                  }, c.label)
                }),
              ),
              skillResult && skillResult.total
                ? createElement('div', { className: 'pm_meta' },
                    '共 ' + skillResult.total.toLocaleString() + ' 个技能，已加载 ' + (skillResult.items ? skillResult.items.length : 0) + ' 条',
                  )
                : null,
              createElement('div', { className: 'pm_grid' }, skillRows),
              skillResult && skillResult.items && !skillResult.items.length
                ? createElement('div', { className: 'pm_empty' }, '没有匹配的技能。No matching skills.')
                : null,
              skillResult && skillResult.hasMore
                ? createElement('div', { className: 'pm_actions', style: { justifyContent: 'center' } },
                    createElement('button', { className: 'pm_btn', disabled: skillBusy, onClick: function () { findSkills(skillSearch, category, skillPage + 1, true) } }, '加载更多 ' + skillResult.total.toLocaleString() + ' 中已看 ' + skillResult.items.length),
                  )
                : null,
            ),
      )
    }

    // One MCP market entry — 2-col grid card with icon, lazy detail panel.
    function McpMarketItem(props) {
      var item = props.item
      var d = props.detail
      var _a = react.useState(null)
      var variant = _a[0]
      var setVariant = _a[1]
      var copied = useCopied()
      var configs = d && Array.isArray(d.serverConfig) ? d.serverConfig : []
      var cfgText = ''
      if (configs.length) {
        var sel = variant !== null && variant < configs.length ? configs[variant] : configs[0]
        cfgText = JSON.stringify(sel, null, 2)
      }

      return createElement('div', { className: 'pm_mcard', key: item.id },
        createElement('div', { className: 'pm_mhead' },
          createElement(MarketIcon, { logo: item.logo, label: (item.name || item.id).charAt(0) }),
          createElement('div', { className: 'pm_mtitle' },
            createElement('div', { className: 'pm_mname' },
              item.name || item.id,
              item.configured ? badge('已配置', 'ok') : null,
            ),
            createElement('div', { className: 'pm_mid' }, item.id),
          ),
        ),
        createElement('div', { className: 'pm_desc' }, item.description || ''),
        createElement('div', { className: 'pm_stats' },
          createElement('span', { className: 'pm_stat' }, 'by ', createElement('b', null, item.publisher || '—')),
          item.views !== undefined
            ? createElement('span', { className: 'pm_stat' }, '👁 ', createElement('b', null, fmtNum(item.views)))
            : null,
          (item.categories && item.categories.length)
            ? createElement('span', { className: 'pm_stat' }, createElement('b', null, item.categories.slice(0, 2).join(' / ')))
            : null,
        ),
        createElement('div', { className: 'pm_actions' },
          createElement('button', { className: 'pm_btn', onClick: props.onOpen }, d ? '收起' : '详情'),
          d && configs.length
            ? createElement('button', { className: 'pm_btn primary', onClick: function () { copied.copy(cfgText) } },
                copied.copied || '复制配置')
            : null,
        ),
        d ? createElement('div', { className: 'pm_section', style: { marginTop: '4px' } },
          createElement('div', { className: 'pm_actions' },
            d.hosted ? badge('Hosted 官方托管', 'brand') : null,
            d.verified ? badge('已认证 Verified', 'brand') : null,
            d.stars > 0 ? badge('★ ' + fmtNum(d.stars), 'muted') : null,
          ),
          (d.envSchema && d.envSchema.length)
            ? createElement('div', { className: 'pm_meta' },
                '环境变量 Env vars: ',
                d.envSchema.map(function (ev) {
                  return createElement('span', { key: ev.key, className: 'pm_envRow' },
                    createElement('code', null, ev.key),
                    ev.required ? badge('必填', 'warn') : null,
                  )
                }),
              )
            : null,
          configs.length
            ? createElement('div', { className: 'pm_section' },
                configs.length > 1
                  ? createElement('label', null,
                      '配置变体 Config variant',
                      createElement('select', { value: variant === null ? 0 : variant, onChange: function (e) { setVariant(Number(e.target.value)) } },
                        configs.map(function (_, i) { return createElement('option', { value: i, key: i }, 'variant ' + (i + 1)) }),
                      ),
                    )
                  : null,
                createElement('div', { className: 'pm_code' }, cfgText),
              )
            : null,
          d.readme ? createElement('div', { className: 'pm_meta' }, d.readme.slice(0, 240) + (d.readme.length > 240 ? ' …' : '')) : null,
          d.source ? createElement('div', { className: 'pm_meta' }, '来源: ' + d.source) : null,
        ) : null,
      )
    }

    // One market skill entry — grid card, install commands, record-source link.
    function SkillMarketItem(props) {
      var item = props.item
      var d = props.detail
      var copied = useCopied()
      var _a = react.useState('')
      var linkErr = _a[0]
      var setLinkErr = _a[1]
      var _b = react.useState('')
      var linkOk = _b[0]
      var setLinkOk = _b[1]
      var _c = react.useState(null)
      var target = _c[0]
      var setTarget = _c[1]

      var alreadyLinked = props.skills.some(function (s) { return s.source === item.id })
      var installs = d && Array.isArray(d.installCommand) ? d.installCommand : []

      function recordSource() {
        setLinkErr('')
        setLinkOk('')
        if (!target) { setLinkErr('请先选择一个本地技能 Please pick a local skill'); return }
        api('/skills/' + encodeURIComponent(target) + '/source', {
          method: 'POST',
          body: JSON.stringify({ marketId: item.id, modified: d ? d.fileModified : undefined }),
        }).then(function (r) {
          if (r && r.error) { setLinkErr(r.error); return }
          setLinkOk('已关联 ' + target + ' ✓')
          props.onChanged()
        })
      }

      return createElement('div', { className: 'pm_mcard', key: item.id },
        createElement('div', { className: 'pm_mhead' },
          createElement(MarketIcon, { logo: item.logo, label: (item.name || item.id).charAt(0) }),
          createElement('div', { className: 'pm_mtitle' },
            createElement('div', { className: 'pm_mname' },
              item.name || item.id,
              item.installed || alreadyLinked ? badge('已安装', 'ok') : null,
              d && d.updateAvailable ? badge('有更新', 'warn') : null,
            ),
            createElement('div', { className: 'pm_mid' }, item.id),
          ),
        ),
        createElement('div', { className: 'pm_desc' }, item.description || ''),
        createElement('div', { className: 'pm_stats' },
          item.downloads !== undefined
            ? createElement('span', { className: 'pm_stat' }, '⬇ ', createElement('b', null, fmtNum(item.downloads)), ' 下载')
            : createElement('span', { className: 'pm_stat' }, 'by ', createElement('b', null, item.developer || '—')),
          item.views !== undefined
            ? createElement('span', { className: 'pm_stat' }, '👁 ', createElement('b', null, fmtNum(item.views)))
            : null,
          item.category ? createElement('span', { className: 'pm_stat' }, createElement('b', null, catLabel(item.category))) : null,
        ),
        createElement('div', { className: 'pm_actions' },
          createElement('button', { className: 'pm_btn', onClick: props.onOpen }, d ? '收起' : '详情'),
        ),
        d ? createElement('div', { className: 'pm_section', style: { marginTop: '4px' } },
          createElement('div', { className: 'pm_meta' },
            '市场更新 Market modified: ' + (d.fileModified || '—'),
            d.localSkill ? ' · 本地记录: ' + d.localSkill.sourceUpdated : '',
          ),
          installs.length
            ? createElement('div', { className: 'pm_section' },
                createElement('div', { className: 'pm_meta' }, '安装命令 Install command（复制后自行执行）:'),
                installs.map(function (cmd, i) {
                  return createElement('div', { key: i, className: 'pm_btnrow' },
                    createElement('div', { className: 'pm_code', style: { flex: 1 } }, cmd),
                    createElement('button', { className: 'pm_btn', onClick: function () { copied.copy(cmd) } }, copied.copied || '复制 Copy'),
                  )
                }),
              )
            : null,
          alreadyLinked
            ? createElement('div', { className: 'pm_ok' }, '已关联到本地技能 ✓ Linked to a local skill.')
            : createElement('div', { className: 'pm_btnrow' },
                createElement('label', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#9aa)' } },
                  '关联本地技能 Link to local skill',
                  createElement('select', { value: target || '', onChange: function (e) { setTarget(e.target.value) } },
                    props.skills.map(function (s) { return createElement('option', { value: s.name, key: s.name }, s.name) }),
                  ),
                ),
                createElement('button', { className: 'pm_btn', onClick: recordSource }, '记录来源 Record source'),
              ),
          linkErr ? createElement('div', { className: 'pm_err' }, linkErr) : null,
          linkOk ? createElement('div', { className: 'pm_ok' }, linkOk) : null,
          d.source ? createElement('div', { className: 'pm_meta' }, '来源: ' + d.source) : null,
        ) : null,
      )
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'connector', order: 55, label: 'Connector 连接器' },
          ManageTab,
        )
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})