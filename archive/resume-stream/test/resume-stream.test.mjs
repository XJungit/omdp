// resume-stream.test.mjs — empirical harness for the host half, without DSH.
//
// Builds a minimal Cordis-like context and a fake session/agent, then drives
// the agent/request-error and session/event listeners the plugin registers. It
// asserts the same-step retry contract:
//   - a native { kind: 'retry' } passes through without a fallback marker;
//   - a declined native chain triggers a bounded fallback llm/retry + retry;
//   - non-retryable codes fall straight through with no fallback;
//   - the recovered marker is emitted only after a complete assistant/message.
//
// It points HOME at a temp dir so the async diagnostics log never touches the
// real ~/.dsh.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

process.env.HOME ||= mkdtempSync(join(tmpdir(), 'resume-stream-'))

const mod = await import('../lib/index.js')

function makeContext() {
  const listeners = new Map()
  const on = (name, callback, options = {}) => {
    const list = listeners.get(name) ?? []
    if (options.prepend) list.unshift(callback)
    else list.push(callback)
    listeners.set(name, list)
    return () => {
      const current = listeners.get(name) ?? []
      const index = current.indexOf(callback)
      if (index !== -1) current.splice(index, 1)
    }
  }
  const dispatch = (name, ...args) => {
    for (const cb of listeners.get(name) ?? []) cb(...args)
  }
  return {
    listeners,
    on,
    dispatch,
    // The plugin declares inject:['timer'], so real Cordis sets ctx.timer.
    timer: { timeout: () => Promise.resolve() },
    get(service) {
      if (service === 'timer') return { timeout: () => Promise.resolve() }
      return undefined
    },
    logger: { info() {}, warn() {} },
  }
}

function makeSession() {
  const events = []
  let seq = 0
  return {
    events,
    append(type, data) {
      const event = { type, data, seq: ++seq }
      events.push(event)
      return event
    },
  }
}

const ctx = makeContext()
mod.apply(ctx)

async function invokeRequestError(payload, downstream = undefined) {
  const callbacks = [...(ctx.listeners.get('agent/request-error') ?? [])]
  const next = async () => downstream
  const first = callbacks[0]
  return first(payload, next)
}

const basePayload = {
  turn: 1,
  step: 1,
  provider: 'test-provider',
  failure: { code: 'TRANSPORT', message: 'stream cut' },
  signal: { aborted: false },
}

function sessionAppend(session, type, data) {
  session.append(type, data)
  const event = session.events[session.events.length - 1]
  ctx.dispatch('session/event', session, event)
  return event
}

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
}

// Test 1: native retry passes through, no synthetic fallback marker.
{
  const s = makeSession()
  const result = await invokeRequestError({ ...basePayload, agent: { session: s } }, { kind: 'retry' })
  assert.deepEqual(result, { kind: 'retry' }, 'native retry must pass through')
  assert.equal(s.events.filter((e) => e.type === 'llm/retry').length, 0, 'no synthetic llm/retry on a native retry')
}

// Test 2: declined native chain triggers a bounded fallback retry.
{
  const s = makeSession()
  const result = await invokeRequestError({ ...basePayload, agent: { session: s } }, undefined)
  assert.deepEqual(result, { kind: 'retry' }, 'fallback must return retry')
  const retries = s.events.filter((e) => e.type === 'llm/retry')
  assert.equal(retries.length, 1, 'exactly one fallback llm/retry')
  assert.equal(retries[0].data.policyKey, 'resume-stream-fallback-v1')
  assert.equal(s.events.filter((e) => e.type === 'llm/retry-started').length, 1, 'one llm/retry-started after the wait')
  assert.equal(s.events.filter((e) => e.type === 'assistant/message').length, 0, 'no assistant/message committed on a retry')
}

// Test 3: non-retryable code falls straight through with no fallback.
{
  const s = makeSession()
  const result = await invokeRequestError(
    { ...basePayload, agent: { session: s }, failure: { code: 'AUTH', message: 'no' } },
    undefined,
  )
  assert.equal(result, undefined, 'non-retryable declines without a retry')
  assert.equal(s.events.filter((e) => e.type === 'llm/retry').length, 0, 'no fallback for non-retryable')
}

// Test 4: fallback retry then a complete assistant/message → one recovered marker.
{
  const s = makeSession()
  const turned = await invokeRequestError({ ...basePayload, agent: { session: s } }, undefined)
  assert.equal(turned.kind, 'retry')
  sessionAppend(s, 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'completed body' }] },
  })
  await tick()
  await tick()
  const markers = s.events.filter((e) => e.type === 'hook/invoked' && e.data.name === 'resume-stream-recovered')
  assert.equal(markers.length, 1, 'exactly one recovered marker after a complete message')
  assert.equal(markers[0].data.status, 'recovered')
}

console.log('resume-stream: all assertions passed')
