/**
 * Makes any value safe for `JSON.stringify()` — handles circular references,
 * BigInt, Symbol, undefined, Map, Set, Date, RegExp, and class instances.
 * Returns a deep clone where all non-JSON-safe values are replaced with
 * string representations.
 */
export function toJsonSafe<T>(value: T): T {
  return jsonSafeClone(value, new WeakSet<object>());
}

function jsonSafeClone<T>(value: T, seen: WeakSet<object>): T {
  if (value === null || value === undefined) return value;

  if (typeof value === 'bigint') return value.toString() as T;
  if (typeof value === 'symbol') return value.toString() as T;
  if (typeof value === 'function') return '[Function]' as T;
  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]' as T;
  seen.add(value as object);

  if (value instanceof Date) return value.toISOString() as T;
  if (value instanceof RegExp) return value.toString() as T;
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) obj[String(k)] = jsonSafeClone(v, seen);
    return obj as T;
  }
  if (value instanceof Set) return [...value].map((v) => jsonSafeClone(v, seen)) as T;
  if (value instanceof Error) return { name: value.name, message: value.message } as T;

  if (Array.isArray(value)) return value.map((item) => jsonSafeClone(item, seen)) as T;

  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return String(value) as T;
  }

  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    cloned[key] = jsonSafeClone((value as Record<string, unknown>)[key], seen);
  }
  return cloned as T;
}

// Generic deep-clone for redaction: preserves types (Date, Map, Set, etc.) since
// the output is used in memory, not serialized to JSON
/** Deep-clones a value preserving Date, RegExp, Map, Set, and handling circular references. */
export function cloneValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[Circular]' as T;
  }

  seen.add(value as object);

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T;
  }

  if (value instanceof Map) {
    const cloned = new Map();
    for (const [k, v] of value) {
      cloned.set(k, cloneValue(v, seen));
    }
    return cloned as T;
  }

  if (value instanceof Set) {
    const cloned = new Set();
    for (const v of value) {
      cloned.add(cloneValue(v, seen));
    }
    return cloned as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item, seen)) as T;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    // Class instance — don't try to deep-clone, just pass through
    return value;
  }

  // Plain object: cast to Record for key enumeration since T is confirmed as non-null object
  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    cloned[key] = cloneValue((value as Record<string, unknown>)[key], seen);
  }
  return cloned as T;
}

function setRedactedAtPath(target: unknown, path: readonly string[]): void {
  if (!target || typeof target !== 'object' || path.length === 0) {
    return;
  }

  // path.length > 0 guaranteed by early return above
  const [segment, ...rest] = path;
  if (segment === undefined) return;
  const key = segment;

  // Type narrowing: target confirmed as non-null object above, cast to Record for property access
  const obj = target as Record<string, unknown>;

  if (key === '*') {
    // Wildcard: apply to all enumerable keys (or array indices).
    // Non-object items (null, primitives) are silently skipped — best-effort redaction.
    if (Array.isArray(target)) {
      for (const item of target) {
        setRedactedAtPath(item, rest);
      }
    } else {
      for (const k of Object.keys(obj)) {
        setRedactedAtPath(obj[k], rest);
      }
    }
    return;
  }

  if (rest.length === 0) {
    // Terminal segment — redact
    if (key in obj) {
      obj[key] = '[REDACTED]';
    }
    return;
  }

  // Recurse into the next level
  const next = obj[key];
  if (next && typeof next === 'object') {
    setRedactedAtPath(next, rest);
  }
}

/**
 * Deep-clones a value and replaces matching paths with `'[REDACTED]'`.
 * Returns the original reference when `redactPaths` is empty (no clone).
 *
 * @param redactPaths Dot-separated paths to redact. Use `*` as a wildcard
 *   segment to match all keys/indices at that level.
 *
 * @example
 * ```ts
 * applyRedactions(obj, ['data.password', 'context.*.meta.token'])
 * ```
 */
export function applyRedactions<T>(
  value: T,
  redactPaths: readonly string[],
): T {
  if (redactPaths.length === 0) {
    return value;
  }

  const cloned = cloneValue(value);

  for (const path of redactPaths) {
    setRedactedAtPath(cloned, path.split('.'));
  }

  return cloned;
}
