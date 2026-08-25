// resume-stream — client half.
//
// The host appends one known `hook/invoked` marker only after a retried step
// commits a complete assistant/message. This Definition renders that success
// marker as a compact inline status row. It performs O(1) matching, carries
// only scalar data, and has no timers/effects/polling.

window.__ModuleLoader__.load({
  id: '@omdp/dsh-resume-stream',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')

    var styles = {
      row: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        maxWidth: '100%',
        boxSizing: 'border-box',
        margin: '4px 0',
        padding: '3px 8px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.28))',
        borderRadius: '5px',
        background: 'var(--dsw-alias-bg-soft, rgba(148,163,184,.08))',
        color: 'var(--dsw-alias-label-secondary, #64748b)',
        fontSize: '12px',
        lineHeight: '18px',
        verticalAlign: 'middle'
      },
      recoveredIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '15px',
        height: '15px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-fill-success, #16a34a)',
        color: 'var(--dsw-alias-bg-base, #fff)',
        fontSize: '10px',
        fontWeight: 700,
        flex: '0 0 auto'
      },
      label: {
        color: 'var(--dsw-alias-label-primary, #334155)',
        fontWeight: 600,
        whiteSpace: 'nowrap'
      },
      meta: {
        color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
        whiteSpace: 'nowrap'
      }
    }

    function scalar(value) {
      return typeof value === 'string' || typeof value === 'number' ? value : null
    }

    var ResumeStatusView = React.memo(function ResumeStatusView(props) {
      var data = (props && props.node && props.node.data) || {}
      var turn = typeof data.turn === 'number' ? '第 ' + data.turn + ' 轮' : null
      var retry = typeof data.retry === 'number' ? '重试 ' + data.retry + ' 次' : null
      var count = typeof data.count === 'number' ? '累计 ' + data.count : null
      var meta = [turn, retry, count].filter(Boolean).join(' · ')
      var label = '本轮断流已自动恢复'
      return React.createElement(
        'div',
        {
          style: styles.row,
          'aria-label': label + (meta ? '，' + meta : ''),
          title: label + (meta ? ' · ' + meta : '')
        },
        React.createElement('span', { style: styles.recoveredIcon, 'aria-hidden': true }, '✓'),
        React.createElement('span', { style: styles.label }, label),
        meta ? React.createElement('span', { style: styles.meta }, meta) : null
      )
    })

    var resumeDefinition = {
      kind: 'resume-stream-status',
      target: 'chat',
      match: function (event) {
        if (!event || event.type !== 'hook/invoked' || !event.data) return null
        if (event.data.name !== 'resume-stream-recovered') return null
        var id = scalar(event.data.resumeId)
        if (typeof id !== 'string' || id.length === 0) return null
        if (typeof event.seq !== 'number') return null
        return { id: 'resume-stream-' + id, role: 'start' }
      },
      start: function (_context, match) {
        var data = match.event.data
        return {
          turn: typeof data.turn === 'number' ? data.turn : null,
          retry: typeof data.retry === 'number' ? data.retry : null,
          count: typeof data.count === 'number' ? data.count : null,
          seq: match.event.seq
        }
      },
      update: function (context) {
        return context.state
      },
      buildViewNode: function (context) {
        if (!context.state) return null
        var location = (context.start && context.start.location) ||
          (context.matches && context.matches[0] && context.matches[0].location) ||
          { kind: 'unresolved' }
        var first = context.matches && context.matches[0] && context.matches[0].event
        var anchorSeq = first && typeof first.seq === 'number' ? first.seq : context.state.seq
        if (typeof anchorSeq !== 'number') return null
        return {
          key: context.key,
          kind: 'resume-stream-status',
          id: context.id,
          target: 'chat',
          anchorSeq: anchorSeq,
          location: location,
          visibility: 'visible',
          data: {
            status: 'recovered',
            turn: context.state.turn,
            retry: context.state.retry,
            count: context.state.count
          }
        }
      }
    }

    function apply(ctx) {
      var conversationEvents = ctx.get('conversationEvents')
      if (conversationEvents !== undefined) {
        ctx.effect(function () {
          return conversationEvents.register(resumeDefinition)
        }, 'resume-stream: conversation definition')
      }

      var slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('conversation.chat.node', function () {
        return slots.register(
          { name: 'conversation.chat.node', key: 'resume-stream-status' },
          ResumeStatusView
        )
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  }
})
