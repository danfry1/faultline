function cloneValue<T>(value: T, seen = new WeakSet<object>()): T {
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

  const [segment, ...rest] = path;

  if (segment === '*') {
    // Wildcard: apply to all enumerable keys (or array indices)
    if (Array.isArray(target)) {
      for (const item of target) {
        setRedactedAtPath(item, rest);
      }
    } else {
      for (const key of Object.keys(target as Record<string, unknown>)) {
        setRedactedAtPath((target as Record<string, unknown>)[key], rest);
      }
    }
    return;
  }

  if (rest.length === 0) {
    // Terminal segment — redact
    if (segment! in (target as Record<string, unknown>)) {
      (target as Record<string, unknown>)[segment!] = '[REDACTED]';
    }
    return;
  }

  // Recurse into the next level
  const next = (target as Record<string, unknown>)[segment!];
  if (next && typeof next === 'object') {
    setRedactedAtPath(next, rest);
  }
}

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
