/**
 * @omdp/dsh-connector — client half.
 *
 * Installed-package client bundle: the harness serves this file at
 * /plugins/<id>/client.js and expects a single window.__ModuleLoader__.load
 * handoff whose factory receives `require`. We register one unified settings
 * tab ("Connector") that manages two things in a single page:
 *   - MCP servers: read/edit the mcp-* block of cordis.patch.yml
 *   - user skills:  list/view/edit/remove SKILL.md files under ~/.dsh/skills
 *
 * It talks to the host half over the Package-private HTTP API the host mounts
 * on the DSH GUI webserver (/connector/api/*), exactly like
 * dsh-mcp-manager's client does with fetch — not the dynamic-only host.call.
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
      '.pm_root{display:flex;flex-direction:column;gap:20px;padding:0 24px 24px}' +
      '.pm_tabs{display:flex;gap:8px;padding:0 24px}' +
      '.pm_section{display:flex;flex-direction:column;gap:12px}' +
      '.pm_sectionHead{font-weight:600;font-size:15px}' +
      '.pm_row{display:flex;flex-direction:column;gap:8px;border:1px solid rgba(128,128,128,.3);border-radius:12px;padding:12px 14px}' +
      '.pm_rowHead{display:flex;align-items:center;gap:10px}' +
      '.pm_name{font-weight:600;font-size:14px}' +
      '.pm_kind{font-size:11px;padding:2px 8px;border-radius:8px;border:1px solid rgba(128,128,128,.4);color:var(--dsw-alias-label-secondary,#888)}' +
      '.pm_meta{font-size:12px;color:var(--dsw-alias-label-secondary,#888);word-break:break-all}' +
      '.pm_actions{margin-left:auto;display:flex;gap:8px}' +
      '.pm_btn{cursor:pointer;font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit}' +
      '.pm_btn:hover{background:rgba(128,128,128,.12)}' +
      '.pm_btn:disabled{opacity:.5;cursor:default}' +
      '.pm_btn.primary{border-color:transparent;background:var(--dsw-alias-interactive-bg-active,#2563eb);color:#fff}' +
      '.pm_btn.danger{border-color:#c62828;color:#c62828}' +
      '.pm_err{color:#c62828;font-size:12px}' +
      '.pm_form{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.pm_form label{display:flex;flex-direction:column;gap:4px;font-size:12px}' +
      '.pm_form input,.pm_form textarea,.pm_form select{font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit}' +
      '.pm_form .wide{grid-column:1 / -1}' +
      '.pm_add{border-style:dashed}' +
      '.pm_hint{font-size:12px;color:var(--dsw-alias-label-secondary,#888)}' +
      '.pm_textarea{font-family:ui-monospace,Menlo,Consolas,monospace;min-height:140px}'

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
          createElement('button', { className: 'pm_btn' + (tab === 'mcp' ? ' primary' : ''), onClick: function () { setTab('mcp') } }, 'MCP 服务器 MCP Servers'),
          createElement('button', { className: 'pm_btn' + (tab === 'skills' ? ' primary' : ''), onClick: function () { setTab('skills') } }, 'Skills 技能'),
        ),
        error ? createElement('div', { className: 'pm_err' }, error) : null,
        tab === 'mcp'
          ? createElement(McpPane, { mcp: mcp, busy: busy, onChanged: refresh })
          : createElement(SkillPane, { skills: skills, busy: busy, onChanged: refresh }),
      )
    }

    function McpPane(props) {
      var _a = react.useState(null)
      var editing = _a[0]
      var setEditing = _a[1]

      function save(server) {
        api('/mcp', {
          method: 'POST',
          body: JSON.stringify({ servers: props.mcp.servers.map(function (s) { return s.id === server.id ? server : s }).concat(props.mcp.servers.some(function (s) { return s.id === server.id }) ? [] : [server]) }),
        }).then(function () { setEditing(null); props.onChanged() })
      }
      function remove(id) {
        api('/mcp', {
          method: 'POST',
          body: JSON.stringify({ servers: props.mcp.servers.filter(function (s) { return s.id !== id }) }),
        }).then(function () { props.onChanged() })
      }

      var rows = props.mcp.servers.map(function (s) {
        return createElement('div', { className: 'pm_row', key: s.id },
          createElement('div', { className: 'pm_rowHead' },
            createElement('span', { className: 'pm_name' }, s.name || s.id),
            createElement('span', { className: 'pm_kind' }, s.transport || 'stdio'),
          ),
          createElement('div', { className: 'pm_meta' }, s.url ? 'url: ' + s.url : (s.command ? 'cmd: ' + s.command : '')),
          createElement('div', { className: 'pm_actions' },
            createElement('button', { className: 'pm_btn', onClick: function () { setEditing(s) } }, '编辑 Edit'),
            createElement('button', { className: 'pm_btn danger', onClick: function () { remove(s.id) } }, '删除 Delete'),
          ),
        )
      })

      return createElement('div', { className: 'pm_section' },
        createElement('div', { className: 'pm_sectionHead' }, 'MCP 服务器 MCP Servers'),
        createElement('div', { className: 'pm_hint' },
          props.mcp.exists ? '编辑 profiles/web/cordis.patch.yml 中的 mcp-* 块。保存后重启 dsh 生效。Edit the mcp-* block in cordis.patch.yml; restart dsh to apply.' : '未找到 cordis.patch.yml。cordis.patch.yml not found.'),
        rows,
        editing === null
          ? createElement('button', { className: 'pm_btn pm_add', onClick: function () { setEditing({ id: 'mcp-new', customId: '', name: '', transport: 'stdio', serverName: '', url: '', command: '', args: '' }) } }, '＋ 添加 MCP 服务器 Add MCP Server')
          : createElement(ServerForm, { value: editing, onSave: save, onCancel: function () { setEditing(null) } }),
      )
    }

    function ServerForm(props) {
      var _a = react.useState(props.value)
      var v = _a[0]
      var setV = _a[1]
      function set(key) { return function (val) { var next = Object.assign({}, v); next[key] = val; setV(next) } }

      var isNew = v.id === 'mcp-new'
      var derivedId = deriveServerId(v.serverName || v.name)
      var idValue = isNew ? (v.customId !== undefined && v.customId !== '' ? v.customId : derivedId) : v.id

      function submit() {
        if (isNew) {
          var custom = (v.customId || '').trim()
          var id = MCP_ID_RE.test(custom) ? custom : derivedId
          props.onSave(Object.assign({}, v, { id: id, name: v.serverName || v.name }))
        } else {
          props.onSave(Object.assign({}, v, { name: v.serverName || v.name }))
        }
      }

      return createElement('div', { className: 'pm_row' },
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

    function SkillPane(props) {
      var _a = react.useState(null)
      var editing = _a[0]
      var setEditing = _a[1]

      function open(name) {
        api('/skills/' + encodeURIComponent(name), { method: 'GET' }).then(function (skill) { setEditing(skill) })
      }
      function save(skill) {
        api('/skills', { method: 'PUT', body: JSON.stringify(skill) }).then(function () { setEditing(null); props.onChanged() })
      }
      function remove(name) {
        api('/skills/' + encodeURIComponent(name), { method: 'DELETE' }).then(function () { props.onChanged() })
      }

      var rows = props.skills.map(function (s) {
        return createElement('div', { className: 'pm_row', key: s.name },
          createElement('div', { className: 'pm_rowHead' },
            createElement('span', { className: 'pm_name' }, s.name),
          ),
          createElement('div', { className: 'pm_meta' }, s.description || ''),
          createElement('div', { className: 'pm_actions' },
            createElement('button', { className: 'pm_btn', onClick: function () { open(s.name) } }, '编辑 Edit'),
            createElement('button', { className: 'pm_btn danger', onClick: function () { remove(s.name) } }, '删除 Delete'),
          ),
        )
      })

      return createElement('div', { className: 'pm_section' },
        createElement('div', { className: 'pm_sectionHead' }, '用户 Skills (~/.dsh/skills) User Skills'),
        createElement('div', { className: 'pm_hint' }, '读写用户技能目录，保存即生效（skill catalog 自动刷新）。Read/write user skills; saved changes take effect immediately.'),
        rows,
        editing === null
          ? createElement('button', { className: 'pm_btn pm_add', onClick: function () { setEditing({ name: '', description: '', content: '' }) } }, '＋ 新建 Skill New Skill')
          : createElement(SkillForm, { value: editing, onSave: save, onCancel: function () { setEditing(null) } }),
      )
    }

    function SkillForm(props) {
      var _a = react.useState(props.value)
      var v = _a[0]
      var setV = _a[1]
      function set(key) { return function (val) { var next = Object.assign({}, v); next[key] = val; setV(next) } }

      return createElement('div', { className: 'pm_row' },
        createElement('div', { className: 'pm_form' },
          field('名称 (kebab-case) Name', v.name, set('name')),
          field('描述 Description', v.description, set('description')),
          createElement('label', { className: 'wide' },
            'SKILL.md 内容 (Markdown) Content',
            createElement('textarea', { className: 'pm_textarea wide', value: v.content || '', onChange: function (e) { var next = Object.assign({}, v); next.content = e.target.value; setV(next) } }),
          ),
        ),
        createElement('div', { className: 'pm_actions' },
          createElement('button', { className: 'pm_btn primary', onClick: function () { props.onSave(v) } }, '保存 Save'),
          createElement('button', { className: 'pm_btn', onClick: props.onCancel }, '取消 Cancel'),
        ),
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
    return module.exports
  },
})
