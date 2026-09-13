/**
 * dsh-projection-guard — host half.
 *
 * Guards the persisted session-projection cache (`session_projcache.json`)
 * against projection units whose checkpoint state is not lossless JSON.
 *
 * Root cause it guards against: the projection-cache `put()` serializes the
 * whole per-session checkpoint in one `snapshotJsonValue(rows)` call. A single
 * unit that stores a non-JSON value (a `Map`, `Set`, class instance, … — e.g.
 * third-party plugins) makes the ENTIRE write fail. Because that failure is
 * fail-soft (log-only), the cache silently stops updating; after a restart
 * every cold session loses its `title` projection and the UI falls back to
 * showing the workspace folder name.
 *
 * This plugin makes the write path resilient generically:
 *
 *   1. Per-row degradation — wraps `sessionProjectionCache.put()` and drops
 *      only the rows that are not lossless JSON, keeping every healthy row
 *      (title, sessionListMetadata, stats, …) durable. One bad unit can no
 *      longer stall the whole cache.
 *   2. Startup self-heal — scans persisted sessions whose cache row lacks a
 *      title and cold-reads their logs to backfill the title projection, so an
 *      already-stale cache recovers without user action.
 *
 * No official or third-party files are modified; the guard is purely a
 * runtime wrapper, so it survives upgrades and works on any deployment.
 */
/** Lossless-JSON validation and detached snapshots (inlined to avoid external module resolution issues when linked locally). */
function hasIntrinsicConstructor(prototype, name) {
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
  if (typeof constructor !== 'function') return false
  try {
    return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`
  } catch {
    return false
  }
}

function isIntrinsicObjectPrototype(value) {
  return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, 'Object')
}

function hasPlainArrayPrototype(value) {
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, 'Array')) return false
  const objectPrototype = Object.getPrototypeOf(prototype)
  return typeof objectPrototype === 'object' && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype)
}

function hasPlainObjectPrototype(value) {
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || (typeof prototype === 'object' && isIntrinsicObjectPrototype(prototype))
}

function enumerableStringKeys(value) {
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0
  return keys
}

function walkJsonValue(value, detach) {
  const ancestors = new Set()
  let root
  const assign = (destination, item) => {
    if (destination === void 0) return
    if (destination.kind === 'root') root = item
    else if (destination.kind === 'array') destination.target[destination.index] = item
    else Object.defineProperty(destination.target, destination.key, {
      value: item,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  const tasks = [{
    kind: 'visit',
    value,
    ...(detach ? { destination: { kind: 'root' } } : {}),
  }]
  for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
    if (task.kind === 'leave') {
      ancestors.delete(task.source)
      continue
    }
    if (task.kind === 'array-item') {
      if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0
      tasks.push({
        kind: 'visit',
        value: task.source[task.index],
        ...(task.target === void 0 ? {} : { destination: {
          kind: 'array',
          target: task.target,
          index: task.index,
        } }),
      })
      continue
    }
    if (task.kind === 'object-property') {
      tasks.push({
        kind: 'visit',
        value: task.source[task.key],
        ...(task.target === void 0 ? {} : { destination: {
          kind: 'object',
          target: task.target,
          key: task.key,
        } }),
      })
      continue
    }
    const current = task.value
    if (current === null) {
      assign(task.destination, null)
      continue
    }
    if (typeof current === 'boolean' || typeof current === 'string') {
      assign(task.destination, current)
      continue
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) return void 0
      assign(task.destination, current)
      continue
    }
    if (typeof current !== 'object') return void 0
    if (ancestors.has(current)) return void 0
    if (Array.isArray(current)) {
      if (!hasPlainArrayPrototype(current)) return void 0
      const length = current.length
      if (Reflect.ownKeys(current).length !== length + 1) return void 0
      const target = detach ? [] : void 0
      if (target !== void 0) assign(task.destination, target)
      ancestors.add(current)
      tasks.push({
        kind: 'leave',
        source: current,
      })
      for (let index = length - 1; index >= 0; index--) {
        tasks.push({
          kind: 'array-item',
          source: current,
          index,
          ...(target === void 0 ? {} : { target }),
        })
      }
      continue
    }
    if (!hasPlainObjectPrototype(current)) return void 0
    const keys = enumerableStringKeys(current)
    if (keys === void 0) return void 0
    const target = detach ? {} : void 0
    if (target !== void 0) assign(task.destination, target)
    ancestors.add(current)
    tasks.push({
      kind: 'leave',
      source: current,
    })
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      if (key === void 0) return void 0
      tasks.push({
        kind: 'object-property',
        source: current,
        key,
        ...(target === void 0 ? {} : { target }),
      })
    }
  }
  return detach ? root : true
}

export function snapshotJsonValue(value) {
  return walkJsonValue(value, true)
}

export const name = 'dsh-projection-guard'
export const inject = ['sessionProjectionCache']

/**
 * Pure guard core: drop every checkpoint row that is not lossless JSON.
 * Returns `{ rows, dropped }` — `dropped` lists the offending keys.
 * Throws when no row survives (same contract as the original put()).
 */
export function sanitizeCheckpoint(rows) {
  const safe = {}
  const dropped = []
  for (const [key, row] of Object.entries(rows)) {
    const detached = snapshotJsonValue(row)
    if (detached === undefined) dropped.push(key)
    else safe[key] = detached
  }
  if (Object.keys(safe).length === 0) {
    throw new TypeError('projection checkpoint is not losslessly JSON-serializable (no unit state satisfies the plain-JSON contract)')
  }
  return { rows: safe, dropped }
}

/** Pure title check: whether a cached snapshot already carries a usable title. */
export function hasUsableTitle(cached) {
  const title = cached?.values?.title
  return typeof title === 'string' && title.length > 0
}

/**
 * Cordis plugin entry.
 *
 * @param ctx - host plugin context (sessionProjectionCache injected).
 * @param config - `{ repairOnStart?, logDropped? }` (schema defaults applied by loader).
 */
export function apply(ctx, config = {}) {
  const repairOnStart = config.repairOnStart !== false
  const logDropped = config.logDropped !== false
  const cache = ctx.sessionProjectionCache
  const stats = { wrappedPutCalls: 0, droppedRows: 0, repairedTitles: 0, lastError: null }

  // ── 1. wrap put() with per-row degradation ────────────────────────────────
  const originalPut = cache.put
  if (typeof originalPut !== 'function') {
    stats.lastError = 'sessionProjectionCache.put is not a function; guard inactive'
    ctx.logger?.warn?.(`${name}: ${stats.lastError}`)
  } else {
    const wrappedPut = async function (id, identity, rows) {
      stats.wrappedPutCalls += 1
      const { rows: safe, dropped } = sanitizeCheckpoint(rows)
      if (dropped.length > 0) {
        stats.droppedRows += dropped.length
        if (logDropped) {
          ctx.logger?.warn?.(`${name}: dropping non-JSON projection row(s) [${dropped.join(', ')}] for "${id}"`)
        }
      }
      return originalPut.call(this, id, identity, safe)
    }
    cache.put = wrappedPut
    ctx.effect(() => () => {
      if (cache.put === wrappedPut) cache.put = originalPut
    }, `${name}.put-wrapper`)
  }

  // ── 2. startup self-heal: backfill missing titles from persisted logs ─────
  if (repairOnStart) {
    const repair = async () => {
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) return
      let headers
      try {
        headers = await persistence.list()
      } catch (error) {
        stats.lastError = `persistence.list failed: ${error instanceof Error ? error.message : String(error)}`
        ctx.logger?.warn?.(`${name}: ${stats.lastError}`)
        return
      }
      for (const header of headers) {
        // Subagent sessions are not listed; skip them for efficiency.
        if (header.parentSession !== undefined) continue
        if (ctx.fiber.state !== 2) return
        let cached
        try {
          cached = cache.cachedSnapshot(header)
        } catch (error) {
          stats.lastError = `cachedSnapshot failed for ${header.id}: ${error instanceof Error ? error.message : String(error)}`
          continue
        }
        if (hasUsableTitle(cached)) continue
        try {
          await cache.coldSnapshot(header.id)
          stats.repairedTitles += 1
        } catch (error) {
          // Missing log / read failures are expected for abandoned sessions.
          stats.lastError = `coldSnapshot failed for ${header.id}: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      ctx.logger?.info?.(`${name}: startup self-heal done (repairedTitles=${stats.repairedTitles})`)
    }
    // Defer so the write path is fully wired before we scan.
    const timer = setTimeout(() => { void repair() }, 1000)
    ctx.effect(() => () => clearTimeout(timer), `${name}.repair-timer`)
  }

  // ── 3. read-only status route for observability ───────────────────────────
  const webServer = ctx.get('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/projection-guard/status',
      handler: async (req, res) => {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({ name, ...stats }))
      },
    }), `${name}.status-route`)
  }
}

export default { name, inject, apply }
