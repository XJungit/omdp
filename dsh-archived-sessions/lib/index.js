/**
 * Host half of the archived-sessions page (@omdp/dsh-archived-sessions).
 *
 * Fork of @muwinds/dsh-archived-sessions 0.2.0, adapted for DSH 0.1.5-rc.1:
 *  - sessionPersistence.list() now returns SessionPersistenceSnapshot[]
 *    ({ header, revision, eventCount?, sizeBytes? }), not bare headers;
 *  - the abstract service no longer exposes locate(meta); the JSONL backend's
 *    path helpers (projectDir / sessionDir / logPath + encodeSegment) are used
 *    instead to resolve the on-disk artifact, so list/delete work again.
 *  - delete now removes the whole parentSession subtree (issue #2) and an
 *    orphan sweep removes subagent dirs whose parent is already gone.
 *
 * Exposes a small JSON API under /dsh-archived/* on the harness web server:
 *   POST /dsh-archived/list         {}                -> { items, totalBytes }
 *   POST /dsh-archived/unarchive    { sessionId }     -> { ok, changed, archivedSessionIds }
 *   POST /dsh-archived/delete       { sessionId }     -> { ok, deleted, sessionId, path?, sizeBytes?, reason?, alsoDeleted? }
 *   POST /dsh-archived/detail       { sessionId }     -> { id, createdAt, cwd, totalEvents, messageCount, truncated, messages }
 *   POST /dsh-archived/orphans      {}                -> { items, totalBytes }
 *   POST /dsh-archived/sweep        {}                -> { removed, freedBytes, items }
 *
 * The browser half ships in the same package (exports["./client"], dsh.client).
 */

/** Wait for the browser HTTP carrier before registering the route. */
export const inject = ["webServer"];

/** Plugin display name for the loader. */
export const name = "dsh-archived-sessions";

// ---------- helpers ----------

function parentDir(p) {
  const a = p.lastIndexOf("/");
  const b = p.lastIndexOf("\\");
  const i = a > b ? a : b;
  return i <= 0 ? p : p.slice(0, i);
}

function sessionIdOf(args) {
  if (args === null || typeof args !== "object") throw new Error("sessionId is required");
  const id = args.sessionId;
  if (typeof id !== "string" || id.length === 0) throw new Error("sessionId is required");
  return id;
}

/** Extract readable text from a content-block array. */
function blocksText(blocks) {
  if (!Array.isArray(blocks)) return "";
  const parts = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "reasoning" && typeof b.text === "string") parts.push("[思考] " + b.text);
    else if (b.type === "tool-call") parts.push("[调用 " + (b.name || "?") + "]");
    else if (b.type === "tool-result") parts.push("[工具结果]");
    else if (b.type === "image") parts.push("[图片]");
  }
  return parts.join("\n");
}

/**
 * Recursive byte size of a session directory via the fs service.
 * Returns null when the path cannot be resolved (missing on disk).
 */
async function dirSizeBytes(fsSvc, dirPath, depth) {
  let target;
  try {
    target = await fsSvc.resolve(dirPath);
  } catch (e) {
    return null;
  }
  try {
    const info = await fsSvc.stat(target);
    if (!info) return 0;
    if (info.type !== "directory") return info.size || 0;
    if (depth > 10) return 0;
    let total = 0;
    let entries = [];
    try {
      entries = await fsSvc.listDir(target);
    } catch (e) {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.type === "directory") {
        const sub = await dirSizeBytes(fsSvc, fsSvc.processPath(entry.target), depth + 1);
        total += sub === null ? 0 : sub;
      } else {
        total += entry.size || 0;
      }
    }
    return total;
  } catch (e) {
    return 0;
  }
}

/**
 * Resolve an explicit danger-full-access policy so the shell executor runs the
 * deletion unconfined. On Windows deployments where the ACL sandbox backend
 * cannot start (its temp root must live outside the workspace), any confined
 * mode would fail before the command even runs.
 */
function dangerPolicy(ctx) {
  const sp = ctx.get("sandboxPolicy");
  if (!sp || typeof sp.resolve !== "function") return undefined;
  try {
    return sp.resolve({ mode: "danger-full-access" });
  } catch (e) {
    return undefined;
  }
}

/**
 * Refuse to delete anything that does not look like a per-session directory.
 * The dir name must be a `session-` prefixed id (new format) or a bare UUID
 * (old format), so a resolution mistake can never take out an arbitrary path.
 */
function assertSessionDirName(dirPath) {
  const last = dirPath.replace(/[\\/]+$/, "");
  const name = last.slice(last.lastIndexOf("/") + 1, last.length).slice(last.lastIndexOf("\\") + 1);
  const ok = /^session-[0-9a-fA-F-]{36}$/.test(name) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name);
  if (!ok) throw new Error("拒绝删除非会话目录: " + dirPath);
}

/** Delete a directory recursively through the shell executor (pwsh / rm). */
async function removeDir(ctx, dirPath) {
  assertSessionDirName(dirPath);
  const shell = ctx.get("shell");
  if (!shell || typeof shell.resolve !== "function" || typeof shell.run !== "function") {
    throw new Error("shell executor unavailable; cannot delete from disk");
  }
  const isWindows = /^[A-Za-z]:[\\/]/.test(dirPath);
  const command = isWindows
    ? "Remove-Item -LiteralPath '" + dirPath.replace(/'/g, "''") + "' -Recurse -Force -ErrorAction Stop"
    : "rm -rf -- '" + dirPath.replace(/'/g, "'\\''") + "'";
  const request = { command, timeoutMs: 60000 };
  const policy = dangerPolicy(ctx);
  if (policy) request.sandboxPolicy = policy;
  let spec;
  try {
    spec = shell.resolve(request);
  } catch (e) {
    throw new Error("shell resolve failed: " + String((e && e.message) || e));
  }
  const result = await shell.run(spec);
  if (result && result.exitCode === 0) return;
  let detail = "";
  try {
    const out = result && (result.stderr || result.stdout);
    if (out && typeof out.text === "string") detail = out.text.slice(0, 400);
  } catch (e) {
    detail = "";
  }
  throw new Error("删除失败 (exit " + String(result && result.exitCode) + "): " + (detail || dirPath));
}

/**
 * Remove one id from the durable archive set and keep the registry's in-memory
 * state consistent so its own later writes cannot clobber it.
 */
async function removeFromArchiveSet(ctx, sessionId) {
  const registry = ctx.get("workspaceRegistry");
  if (!registry) throw new Error("workspace registry unavailable");
  if (!registry.state || typeof registry.state !== "object") throw new Error("workspace registry is not started");
  const current = registry.archivedSessionIds;
  if (!Array.isArray(current) || !current.includes(sessionId)) return false;
  const next = current.filter((id) => id !== sessionId);
  const state = Object.assign({}, registry.state, { archivedSessionIds: next });
  if (typeof registry.setState === "function") {
    await registry.setState(state);
    return true;
  }
  const domain = ctx.get("storageDomain");
  if (!domain) throw new Error("storage domain unavailable");
  const unit = domain.get("workspace");
  if (!unit || !unit.global || typeof unit.global.set !== "function") throw new Error("workspace domain is not open");
  await unit.global.set(state);
  registry.state = state;
  return true;
}

/** A session is deletable unless its agent is actively running a turn. */
function sessionRunning(ctx, sessionId) {
  const agents = ctx.get("agents");
  if (!agents || typeof agents.get !== "function") return false;
  const agent = agents.get(sessionId);
  return !!(agent && agent.status === "running");
}

/**
 * Evict a live session from the in-memory store (the store's own detach path),
 * so a deleted session cannot resurface in the workspace afterward.
 */
function evictSessionFromMemory(ctx, sessionId) {
  const sessions = ctx.get("sessions");
  if (!sessions) return false;
  try {
    const store = sessions.store;
    if (!store || typeof store.get !== "function") return false;
    const entry = store.get(sessionId);
    if (!entry || typeof entry.detach !== "function") return false;
    entry.detach();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Resolve the on-disk location for one session in the DSH 0.1.5-rc.1 JSONL
 * backend layout. The abstract sessionPersistence service no longer exposes
 * locate(); the JSONL backend's own path helpers are exported and used here.
 * Falls back to a best-effort path when the jsonl backend module is not
 * importable (older DSH), where the old layout used the same encoding.
 */
let jsonlBackend = null;
try {
  jsonlBackend = await import("@deepseek-ai/dsh-session-persistence-jsonl");
} catch (e) {
  jsonlBackend = null;
}

function encodeSegment(raw) {
  if (raw.length === 0) throw new Error("cannot encode an empty path segment");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

function projectKey(cwd) {
  if (cwd.length === 0) throw new Error("cannot encode an empty project path");
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/** Read an environment variable without assuming `process` exists. */
function env(name) {
  try {
    return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
  } catch (e) {
    return undefined;
  }
}

/**
 * Candidate JSONL session roots, probed in order at call time.
 *
 * DSH stores every session under `<DSH_HOME>/sessions` (DSH_HOME defaults to
 * `~/.dsh`), and the abstract sessionPersistence service exposes no root, so the
 * location is derived from the environment rather than hard-coded — the plugin
 * then works on any machine and any DSH_HOME.
 */
function candidateRoots() {
  const out = [];
  const push = (p) => {
    if (typeof p !== "string" || p.length === 0) return;
    const trimmed = p.replace(/[\\/]+$/, "");
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed);
  };
  const home = env("DSH_HOME");
  if (typeof home === "string" && home.replace(/[\\/]+$/, "").length > 0) {
    push(home + "/sessions");
  } else {
    const userHome = env("USERPROFILE") || env("HOME");
    if (typeof userHome === "string" && userHome.length > 0) push(userHome + "/.dsh/sessions");
  }
  return out;
}

/** Build one session's on-disk directory path under a candidate root. */
function buildSessionDir(root, header) {
  const key = header.cwd === undefined ? "_no-cwd" : projectKey(header.cwd);
  const id = encodeSegment(header.id);
  const sep = root.endsWith("/") || root.endsWith("\\") ? "" : "/";
  return root + sep + key + sep + id;
}

/**
 * Resolve the on-disk session directory for one header, confirming existence
 * through the fs service. Returns { path, found } — `found` is false when no
 * candidate root holds the session (deletion then prunes the archive id only).
 */
async function resolveSessionLocation(ctx, header) {
  const fsSvc = ctx.get("fs");
  const backend = jsonlBackend && typeof jsonlBackend.sessionDir === "function" ? jsonlBackend : null;
  const roots = candidateRoots();
  if (roots.length === 0) return { path: "", found: false };
  let last = null;
  for (const root of roots) {
    let dirPath;
    if (backend && typeof jsonlBackend.projectDir === "function") {
      try {
        dirPath = backend.sessionDir(root, header.cwd, header.id);
      } catch (e) {
        dirPath = buildSessionDir(root, header);
      }
    } else {
      dirPath = buildSessionDir(root, header);
    }
    last = { path: dirPath, found: false };
    if (!fsSvc || typeof fsSvc.resolve !== "function") {
      last.found = true;
      break;
    }
    try {
      await fsSvc.resolve(dirPath);
      last.found = true;
      break;
    } catch (e) {
      // not under this root; try the next
    }
  }
  return last;
}

// ---------- API handlers ----------

async function handleList(ctx) {
  const registry = ctx.get("workspaceRegistry");
  const persistence = ctx.get("sessionPersistence");
  if (!registry || !persistence) return { items: [], totalBytes: 0 };
  const archived = Array.isArray(registry.archivedSessionIds) ? [...registry.archivedSessionIds] : [];
  if (archived.length === 0) return { items: [], totalBytes: 0 };

  const snapshots = await persistence.list();
  const byId = new Map();
  for (const snap of snapshots) {
    if (snap && typeof snap === "object" && snap.header && typeof snap.header === "object") {
      byId.set(snap.header.id, snap);
    } else if (snap && typeof snap === "object" && typeof snap.id === "string") {
      byId.set(snap.id, snap);
    }
  }

  const titles = new Map();
  const query = ctx.get("sessionQuery");
  if (query && typeof query.readTitleSnapshots === "function") {
    try {
      const results = await query.readTitleSnapshots(archived);
      for (const r of results) {
        if (r && r.status === "fulfilled" && r.value && r.value.title && typeof r.value.title.title === "string") {
          titles.set(r.sessionId, r.value.title.title);
        }
      }
    } catch (e) {
      // best effort
    }
  }

  const liveSvc = ctx.get("sessions");
  const fsSvc = ctx.get("fs");
  const items = [];
  let totalBytes = 0;
  for (const id of archived) {
    const snap = byId.get(id);
    const header = snap && snap.header ? snap.header : (snap && typeof snap.id === "string" ? snap : null);
    let sizeBytes = 0;
    let missing = false;
    let path = null;
    if (header) {
      // Prefer the snapshot's cheap size when present.
      if (typeof snap.sizeBytes === "number" && snap.sizeBytes >= 0) {
        sizeBytes = snap.sizeBytes;
        path = null;
      } else {
        let location = null;
        try {
          location = await resolveSessionLocation(ctx, header);
        } catch (e) {
          location = null;
        }
        if (location && typeof location.path === "string" && location.path.length > 0) {
          path = location.path;
          if (fsSvc) {
            const size = await dirSizeBytes(fsSvc, location.path, 0);
            if (size === null) missing = true;
            else sizeBytes = size;
          }
        } else {
          missing = true;
        }
      }
    } else {
      missing = true;
    }
    totalBytes += sizeBytes;
    items.push({
      id,
      title: titles.get(id) || null,
      createdAt: header ? header.createdAt : null,
      cwd: header ? header.cwd || null : null,
      parentSession: header ? header.parentSession || null : null,
      sizeBytes,
      missing,
      live: !!(liveSvc && liveSvc.get(id) !== undefined),
      running: sessionRunning(ctx, id),
      path
    });
  }
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { items, totalBytes };
}

async function handleUnarchive(ctx, args) {
  const sessionId = sessionIdOf(args);
  const registry = ctx.get("workspaceRegistry");
  if (!registry) throw new Error("workspace registry unavailable");
  if (!Array.isArray(registry.archivedSessionIds) || !registry.archivedSessionIds.includes(sessionId)) {
    throw new Error("会话 '" + sessionId + "' 不在归档集合中");
  }
  const changed = await removeFromArchiveSet(ctx, sessionId);
  return { ok: true, changed, archivedSessionIds: [...registry.archivedSessionIds] };
}

/** Collect the whole parentSession subtree (ids present in the archive set). */
async function collectSubtreeIds(ctx, rootId, snapshots) {
  const byParent = new Map();
  for (const snap of snapshots) {
    const h = snap && typeof snap === "object" && snap.header ? snap.header : snap;
    if (h && typeof h === "object" && typeof h.parentSession === "string" && h.parentSession.length > 0) {
      let list = byParent.get(h.parentSession);
      if (!list) {
        list = [];
        byParent.set(h.parentSession, list);
      }
      list.push(typeof h.id === "string" ? h.id : "");
    }
  }
  const result = [rootId];
  const seen = new Set(result);
  let i = 0;
  while (i < result.length) {
    const cur = result[i];
    const kids = byParent.get(cur) || [];
    for (const k of kids) {
      if (k && !seen.has(k)) {
        seen.add(k);
        result.push(k);
      }
    }
    i++;
  }
  return result.slice(1);
}

async function handleDelete(ctx, args) {
  const sessionId = sessionIdOf(args);
  const registry = ctx.get("workspaceRegistry");
  const persistence = ctx.get("sessionPersistence");
  if (!registry || !persistence) throw new Error("workspace registry or session persistence unavailable");
  if (!Array.isArray(registry.archivedSessionIds) || !registry.archivedSessionIds.includes(sessionId)) {
    throw new Error("会话 '" + sessionId + "' 不在归档集合中");
  }
  if (sessionRunning(ctx, sessionId)) {
    throw new Error("会话 '" + sessionId + "' 正在运行中，无法删除");
  }
  // A live (in-memory) session would otherwise resurface in the workspace once
  // the archive entry is pruned; evict it so the deletion is complete.
  const liveSvc = ctx.get("sessions");
  const isLive = !!(liveSvc && typeof liveSvc.get === "function" && liveSvc.get(sessionId) !== undefined);
  if (isLive && !evictSessionFromMemory(ctx, sessionId)) {
    throw new Error("会话 '" + sessionId + "' 仍驻留内存且无法移除，删除未完成；请重启 Harness 后重试");
  }

  const snapshots = await persistence.list();
  const subtree = await collectSubtreeIds(ctx, sessionId, snapshots);

  const headers = new Map();
  for (const snap of snapshots) {
    const h = snap && typeof snap === "object" && snap.header ? snap.header : snap;
    if (h && typeof h === "object" && typeof h.id === "string") headers.set(h.id, h);
  }

  const deletedIds = [];
  const failedIds = [];
  for (const id of [sessionId, ...subtree]) {
    const header = headers.get(id);
    if (!header) {
      // Already gone from persistence: just prune the archive id.
      if (registry.archivedSessionIds.includes(id)) {
        await removeFromArchiveSet(ctx, id);
      }
      deletedIds.push(id);
      continue;
    }
    let location = null;
    try {
      location = await resolveSessionLocation(ctx, header);
    } catch (e) {
      location = null;
    }
    if (!location || typeof location.path !== "string" || location.path.length === 0) {
      if (registry.archivedSessionIds.includes(id)) {
        await removeFromArchiveSet(ctx, id);
      }
      deletedIds.push(id);
      continue;
    }
    const dirPath = location.path;
    const fsSvc = ctx.get("fs");
    let sizeBytes = 0;
    if (fsSvc) {
      const size = await dirSizeBytes(fsSvc, dirPath, 0);
      sizeBytes = size === null ? 0 : size;
    }
    try {
      await removeDir(ctx, dirPath);
    } catch (e) {
      failedIds.push(id);
      continue;
    }
    if (registry.archivedSessionIds.includes(id)) {
      await removeFromArchiveSet(ctx, id);
    }
    deletedIds.push(id);
  }

  if (failedIds.length > 0) {
    throw new Error("部分会话删除失败: " + failedIds.join(", "));
  }
  return {
    ok: true,
    deleted: deletedIds.includes(sessionId),
    sessionId,
    alsoDeleted: subtree.filter((id) => deletedIds.includes(id)),
    sizeBytes: 0,
    reason: deletedIds.length === 0 ? "no-artifact" : undefined
  };
}

async function handleDetail(ctx, args) {
  const sessionId = sessionIdOf(args);
  const query = ctx.get("sessionQuery");
  if (!query || typeof query.readSession !== "function") {
    throw new Error("session query unavailable");
  }
  let snapshot;
  try {
    snapshot = await query.readSession(sessionId);
  } catch (e) {
    throw new Error("无法读取会话内容（可能已从磁盘删除）: " + String((e && e.message) || e));
  }
  if (!snapshot || !Array.isArray(snapshot.events)) {
    throw new Error("会话内容为空或不可读");
  }
  const events = snapshot.events;
  const messages = [];
  const MAX_MESSAGES = 100;
  const MAX_TEXT = 8000;
  for (const ev of events) {
    if (messages.length >= MAX_MESSAGES) break;
    if (!ev || typeof ev !== "object" || !ev.data || typeof ev.data !== "object") continue;
    const data = ev.data;
    if (ev.type === "user/message") {
      const text = blocksText(data.content);
      if (text) messages.push({ seq: ev.seq, time: ev.time, role: "user", text: text.slice(0, MAX_TEXT) });
    } else if (ev.type === "assistant/message" && data.message && typeof data.message === "object") {
      const text = blocksText(data.message.content);
      if (text) messages.push({ seq: ev.seq, time: ev.time, role: "assistant", text: text.slice(0, MAX_TEXT) });
    } else if (ev.type === "tool/call") {
      const name = typeof data.name === "string" ? data.name : "?";
      const argsText = typeof data.arguments === "string" ? data.arguments.slice(0, 300) : "";
      messages.push({ seq: ev.seq, time: ev.time, role: "tool", text: "[" + name + "] " + argsText });
    }
  }
  const header = snapshot.session || null;
  return {
    id: sessionId,
    createdAt: header ? header.createdAt : null,
    cwd: header ? header.cwd || null : null,
    parentSession: header ? header.parentSession || null : null,
    totalEvents: events.length,
    messageCount: messages.length,
    truncated: messages.length >= MAX_MESSAGES,
    messages
  };
}

/** List orphaned subagent sessions: on disk, parent already gone, not archived. */
async function handleOrphans(ctx) {
  const registry = ctx.get("workspaceRegistry");
  const persistence = ctx.get("sessionPersistence");
  if (!registry || !persistence) return { items: [], totalBytes: 0 };
  const archived = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : [];
  const live = new Set(archived);
  const snapshots = await persistence.list();
  const known = new Set();
  const byParent = new Map();
  for (const snap of snapshots) {
    const h = snap && typeof snap === "object" && snap.header ? snap.header : snap;
    if (h && typeof h === "object" && typeof h.id === "string") {
      known.add(h.id);
      if (typeof h.parentSession === "string" && h.parentSession.length > 0) {
        let list = byParent.get(h.parentSession);
        if (!list) {
          list = [];
          byParent.set(h.parentSession, list);
        }
        list.push(h.id);
      }
    }
  }
  const fsSvc = ctx.get("fs");
  const items = [];
  let totalBytes = 0;
  for (const id of known) {
    if (live.has(id)) continue;
    let h = null;
    for (const snap of snapshots) {
      const hh = snap && typeof snap === "object" && snap.header ? snap.header : snap;
      if (hh && typeof hh === "object" && hh.id === id) {
        h = hh;
        break;
      }
    }
    if (!h || typeof h.parentSession !== "string" || h.parentSession.length === 0) continue;
    if (known.has(h.parentSession)) continue;
    let location = null;
    try {
      location = await resolveSessionLocation(ctx, h);
    } catch (e) {
      location = null;
    }
    if (!location || typeof location.path !== "string" || location.path.length === 0) continue;
    const dirPath = location.path;
    let sizeBytes = 0;
    if (fsSvc) {
      const size = await dirSizeBytes(fsSvc, dirPath, 0);
      sizeBytes = size === null ? 0 : size;
    }
    totalBytes += sizeBytes;
    items.push({
      id,
      parentSession: h.parentSession,
      createdAt: h.createdAt || null,
      cwd: h.cwd || null,
      sizeBytes,
      missing: sizeBytes === 0
    });
  }
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { items, totalBytes };
}

/** Sweep orphaned subagent sessions: delete their dirs + prune from archive set. */
async function handleSweep(ctx) {
  const { items } = await handleOrphans(ctx);
  const removed = [];
  let freedBytes = 0;
  for (const item of items) {
    const persistence = ctx.get("sessionPersistence");
    const snapshots = await persistence.list();
    let h = null;
    for (const snap of snapshots) {
      const hh = snap && typeof snap === "object" && snap.header ? snap.header : snap;
      if (hh && typeof hh === "object" && hh.id === item.id) {
        h = hh;
        break;
      }
    }
    if (!h) continue;
    let location = null;
    try {
      location = await resolveSessionLocation(ctx, h);
    } catch (e) {
      location = null;
    }
    if (!location || typeof location.path !== "string" || location.path.length === 0) continue;
    const dirPath = location.path;
    try {
      await removeDir(ctx, dirPath);
    } catch (e) {
      continue;
    }
    freedBytes += item.sizeBytes;
    removed.push(item.id);
  }
  return { removed, freedBytes, items: removed.length };
}

// ---------- HTTP route ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

export function apply(ctx) {
  const handlers = {
    list: () => handleList(ctx),
    unarchive: (args) => handleUnarchive(ctx, args),
    delete: (args) => handleDelete(ctx, args),
    detail: (args) => handleDetail(ctx, args),
    orphans: () => handleOrphans(ctx),
    sweep: () => handleSweep(ctx)
  };

  async function handler(req, res) {
    if ((req.method || "") !== "POST") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    const pathname = (req.url || "").split("?")[0].replace(/\/+$/, "");
    let action = null;
    for (const key of Object.keys(handlers)) {
      if (pathname === "/dsh-archived/" + key) {
        action = key;
        break;
      }
    }
    if (action === null) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    let body = {};
    try {
      const raw = await readBody(req);
      if (raw.trim().length > 0) body = JSON.parse(raw);
    } catch (e) {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    try {
      sendJson(res, 200, await handlers[action](body));
    } catch (e) {
      sendJson(res, 500, { error: (e && e.message) || String(e) });
    }
  }

  ctx.webServer.register({
    kind: "prefix",
    path: "/dsh-archived",
    handler
  });
}
