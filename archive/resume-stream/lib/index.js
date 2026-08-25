// resume-stream — host half.
//
// A transport cut must remain an error until AgentLoop's
// `agent/request-error` recovery seam sees it. Rewriting the finish chunk to
// `stop` commits the partial BlockAssembler as a completed assistant message;
// that was the reason half-reasoning/half-body turns stopped permanently.
//
// This plugin lets DSH's native recovery chain run first. If it returns
// `{ kind: 'retry' }`, AgentLoop retries the SAME turn + step. If no listener
// handles a TRANSPORT/TIMEOUT failure, this plugin supplies a bounded fallback.
// No synthetic user message, stream rewrite, or second-turn race is involved.
//
// A compact UI marker is appended only after the retried step successfully
// commits `assistant/message`. It uses the known inert `hook/invoked` event;
// custom persisted event types are rejected by the session loader.

import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = '@omdp/dsh-resume-stream'
export const inject = ['timer']

const STORE_PATH = '.dsh/resume-stream/count.json'
const LEGACY_STORE_PATH = '.dsh/resume-stream-count.json'
const LOG_DIR = join(homedir(), '.dsh', 'resume-stream')
const LOG_PATH = join(LOG_DIR, 'resume-stream.log')
const LOG_OLD_PATH = join(LOG_DIR, 'resume-stream.log.old')
const LOG_MAX_BYTES = 256 * 1024
const MAX_FALLBACK_RETRIES = 5
const RETRYABLE_CODES = new Set(['TRANSPORT', 'TIMEOUT'])
const FALLBACK_POLICY_KEY = 'resume-stream-fallback-v1'

const state = {
  count: 0,
  lastProvider: null,
  lastAt: 0,
  loaded: false,
  pendingIncrements: 0,
  pendingProvider: null,
  pendingAt: 0,
}

// Live Session objects are WeakMap keys. Values contain only owned scalars.
const retryStates = new WeakMap()
let storeReady = Promise.resolve()
let storeWriteQueue = Promise.resolve()
let logQueue = Promise.resolve()
let logDirReady = false

function enqueueLog(line) {
  logQueue = logQueue
    .then(async () => {
      try {
        if (!logDirReady) {
          await mkdir(LOG_DIR, { recursive: true })
          logDirReady = true
        }
        try {
          const info = await stat(LOG_PATH)
          if (info.size > LOG_MAX_BYTES) await rename(LOG_PATH, LOG_OLD_PATH).catch(() => {})
        } catch {
          /* log file does not exist yet */
        }
        await appendFile(LOG_PATH, `${new Date().toISOString()} ${line}\n`)
      } catch {
        /* Diagnostics are best-effort and never affect recovery. */
      }
    })
    .catch(() => {})
}

async function readStore(fs) {
  if (fs === undefined) return { parsed: undefined, legacy: false }
  for (const path of [STORE_PATH, LEGACY_STORE_PATH]) {
    try {
      const target = await fs.resolve(path)
      const text = await fs.readText(target)
      if (typeof text !== 'string' || text.length === 0) continue
      return { parsed: JSON.parse(text), legacy: path === LEGACY_STORE_PATH }
    } catch {
      /* Try the next path. */
    }
  }
  return { parsed: undefined, legacy: false }
}

function queueStoreWrite(fs) {
  if (fs === undefined || !state.loaded) return
  const snapshot = JSON.stringify({
    count: state.count,
    lastProvider: state.lastProvider,
    lastAt: state.lastAt,
  })
  storeWriteQueue = storeWriteQueue
    .then(async () => {
      const target = await fs.resolve(STORE_PATH)
      await fs.writeText(target, snapshot)
    })
    .catch(() => {})
}

function loadStore(ctx) {
  if (state.loaded) return Promise.resolve()
  const fs = ctx.get('fs')
  if (fs === undefined) {
    state.loaded = true
    return Promise.resolve()
  }
  return readStore(fs)
    .then(({ parsed, legacy }) => {
      const pending = state.pendingIncrements
      const pendingProvider = state.pendingProvider
      const pendingAt = state.pendingAt
      const baseCount = parsed && typeof parsed.count === 'number' ? parsed.count : 0
      state.count = baseCount + pending
      if (parsed && typeof parsed.count === 'number') {
        state.lastProvider = parsed.lastProvider ?? null
        state.lastAt = parsed.lastAt ?? 0
      }
      if (pending > 0) {
        state.lastProvider = pendingProvider
        state.lastAt = pendingAt
      }
      state.pendingIncrements = 0
      state.pendingProvider = null
      state.pendingAt = 0
      state.loaded = true
      if (legacy || pending > 0) queueStoreWrite(fs)
    })
    .catch(() => {
      // Keep any in-memory increments when the persistence backend is absent.
      state.loaded = true
      state.pendingIncrements = 0
      state.pendingProvider = null
      state.pendingAt = 0
    })
}

function stepKey(turn, step) {
  return `${turn}:${step}`
}

function getState(session) {
  let map = retryStates.get(session)
  if (map === undefined) {
    map = new Map()
    retryStates.set(session, map)
  }
  return map
}

function appendMarker(ctx, session, data) {
  try {
    session.append('hook/invoked', data)
  } catch (error) {
    enqueueLog(`session marker failed: ${String(error)}`)
  }
}

function appendMarkerAfterCurrentAppend(ctx, session, data) {
  ctx.timer.timeout(0).then(() => appendMarker(ctx, session, data)).catch(() => {})
}

function retryableFailure(failure) {
  return Boolean(failure && RETRYABLE_CODES.has(failure.code))
}

function incrementCount(ctx, provider) {
  state.count += 1
  state.lastProvider = provider ?? state.lastProvider ?? '未知'
  state.lastAt = Date.now()
  if (!state.loaded) {
    state.pendingIncrements += 1
    state.pendingProvider = state.lastProvider
    state.pendingAt = state.lastAt
  } else {
    queueStoreWrite(ctx.get('fs'))
  }
  return state.count
}

function recordAcceptedRetry(ctx, session, event) {
  const data = event?.data ?? {}
  const turn = data.turn
  const step = data.step
  const key = stepKey(turn, step)
  const map = getState(session)
  const previous = map.get(key)
  const fallback = data.policyKey === FALLBACK_POLICY_KEY
  const retry = Number.isSafeInteger(data.retry) && data.retry > 0
    ? data.retry
    : (previous?.retry ?? 0) + 1
  const entry = previous ?? {
    resumeId: randomUUID(),
    turn,
    step,
    retry: 0,
    fallbackRetries: 0,
    nativeRetrySeen: false,
    provider: data.provider ?? '未知',
  }
  entry.resumeId = typeof data.retryId === 'string' && data.retryId.length > 0
    ? data.retryId
    : entry.resumeId
  entry.turn = turn
  entry.step = step
  entry.retry = retry
  entry.provider = data.provider ?? entry.provider
  entry.maxRetries = Number.isSafeInteger(data.maxRetries) ? data.maxRetries : MAX_FALLBACK_RETRIES
  entry.fallbackRetries = fallback ? retry : entry.fallbackRetries
  entry.nativeRetrySeen = entry.nativeRetrySeen || !fallback
  map.set(key, entry)

  const count = incrementCount(ctx, entry.provider)
  const message = String(data.failure?.message ?? '').replace(/\s+/g, ' ').slice(0, 180)
  enqueueLog(
    `retry accepted | provider=${entry.provider} code=${data.failure?.code ?? '?'} count=${count} turn=${turn ?? '?'} step=${step ?? '?'} retry=${retry}/${entry.maxRetries} source=${fallback ? 'fallback' : 'dsh'} msg=${message}`,
  )
  ctx.logger.info(`[resume-stream] 流式断流，正在同一步重试（第 ${retry} 次）`)
}

function recordRecovered(ctx, session, event) {
  const turn = event.data?.turn
  const step = event.data?.step
  const map = retryStates.get(session)
  const entry = map?.get(stepKey(turn, step))
  if (entry === undefined) return
  map.delete(stepKey(turn, step))
  if (event.data?.interrupted === true) return

  appendMarkerAfterCurrentAppend(ctx, session, {
    name: 'resume-stream-recovered',
    resumeId: entry.resumeId,
    mode: 'same-step-retry',
    status: 'recovered',
    provider: entry.provider,
    turn: turn ?? null,
    step: step ?? null,
    retry: entry.retry,
    count: state.count,
  })
  enqueueLog(
    `retry recovered | provider=${entry.provider} turn=${turn ?? '?'} step=${step ?? '?'} retry=${entry.retry}`,
  )
}

function clearStep(session, event) {
  retryStates.get(session)?.delete(stepKey(event.data?.turn, event.data?.step))
}

async function waitBeforeRetry(ctx, signal, delay) {
  if (delay <= 0 || signal?.aborted) return !signal?.aborted
  try {
    await ctx.timer.timeout(delay)
    return !signal?.aborted
  } catch {
    return false
  }
}

function fallbackDelay(failure, retry) {
  if (Number.isFinite(failure?.providerRetryAfterMs) && failure.providerRetryAfterMs > 0) {
    return Math.min(failure.providerRetryAfterMs, 3000)
  }
  return Math.min(250 * 2 ** (retry - 1), 3000)
}

function fallbackRetryData(payload, retry, retryId, delay) {
  return {
    retryId,
    turn: payload.turn,
    step: payload.step,
    provider: payload.provider,
    mode: 'normal',
    policyKey: FALLBACK_POLICY_KEY,
    retry,
    maxRetries: MAX_FALLBACK_RETRIES,
    delayMs: delay,
    failure: payload.failure,
  }
}

export function isRetryableFailure(failure) {
  return retryableFailure(failure)
}

export function isErrorFinishChunk(chunk) {
  return Boolean(
    chunk &&
      chunk.type === 'finish' &&
      chunk.reason?.kind === 'error' &&
      isRetryableFailure(chunk.reason.failure),
  )
}

export function apply(ctx) {
  enqueueLog(`apply() called | plugin=${name} mode=same-step-retry`)
  storeReady = loadStore(ctx)
  storeReady.catch(() => {})

  // Prepend so we can observe the result of DSH's native llm-retry listener.
  // A native { kind: 'retry' } decision is never replaced.
  ctx.on('agent/request-error', async (payload, next) => {
    const failure = payload?.failure
    if (!isRetryableFailure(failure) || payload.signal?.aborted) return next()
    const session = payload.agent?.session
    if (session === undefined || session === null) return next()

    const downstream = await next()
    const key = stepKey(payload.turn, payload.step)
    const map = getState(session)
    if (downstream?.kind === 'retry') {
      // Native llm-retry records its llm/retry event synchronously. This
      // fallback covers another recovery listener that returns retry without a
      // durable retry event.
      if (!map.has(key) && !payload.signal?.aborted) {
        recordAcceptedRetry(ctx, session, {
          data: {
            retryId: randomUUID(),
            turn: payload.turn,
            step: payload.step,
            provider: payload.provider,
            retry: 1,
            maxRetries: MAX_FALLBACK_RETRIES,
            failure,
          },
        })
      }
      return downstream
    }
    if (payload.signal?.aborted) return downstream

    const previous = map.get(key)
    // Once the configured native policy has retried this step, respect its
    // limit instead of adding a second independent retry chain.
    if (previous?.nativeRetrySeen === true) return downstream
    const fallbackRetries = previous?.fallbackRetries ?? 0
    if (fallbackRetries >= MAX_FALLBACK_RETRIES) {
      map.delete(key)
      enqueueLog(`fallback retry exhausted | turn=${payload.turn} step=${payload.step} provider=${payload.provider}`)
      return downstream
    }

    const retry = fallbackRetries + 1
    const delay = fallbackDelay(failure, retry)
    const retryId = previous?.resumeId ?? randomUUID()
    const retryData = fallbackRetryData(payload, retry, retryId, delay)

    // The native conversation projection uses llm/retry to hide the failed
    // partial chunk state before the next attempt. This is the same event
    // schema used by dsh-llm-retry and is a known persisted event.
    try {
      session.append('llm/retry', retryData)
    } catch (error) {
      enqueueLog(`fallback llm/retry marker failed: ${String(error)}`)
    }
    // If an unusual Session implementation rejected the append, still keep a
    // bounded in-memory fallback ledger so repeated failures cannot loop.
    if (!map.has(key)) recordAcceptedRetry(ctx, session, { data: retryData })

    if (!await waitBeforeRetry(ctx, payload.signal, delay)) return downstream
    if (payload.signal?.aborted) return downstream
    try {
      session.append('llm/retry-started', {
        retryId,
        turn: payload.turn,
        step: payload.step,
        retry,
      })
    } catch (error) {
      enqueueLog(`fallback llm/retry-started marker failed: ${String(error)}`)
    }
    return { kind: 'retry' }
  }, { prepend: true })

  // The llm/retry event is the source of truth for an accepted retry. The
  // success marker is deferred because session/event observers run while the
  // original assistant/message append is still publishing.
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'llm/retry' && isRetryableFailure(event.data?.failure)) {
      recordAcceptedRetry(ctx, session, event)
    } else if (event?.type === 'assistant/message') {
      recordRecovered(ctx, session, event)
    } else if (event?.type === 'step/end') {
      clearStep(session, event)
    }
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle' && agent?.session !== undefined) retryStates.delete(agent.session)
  })
}
