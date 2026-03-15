function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, entryValue]) => [key, cloneValue(entryValue)],
    );

    return Object.fromEntries(entries) as T;
  }

  return value;
}

function setRedactedAtPath(target: unknown, path: readonly string[]): void {
  if (!target || typeof target !== 'object' || path.length === 0) {
    return;
  }

  let cursor: unknown = target;

  for (let index = 0; index < path.length - 1; index += 1) {
    if (!cursor || typeof cursor !== 'object') {
      return;
    }

    cursor = (cursor as Record<string, unknown>)[path[index]!];
  }

  if (!cursor || typeof cursor !== 'object') {
    return;
  }

  const key = path[path.length - 1]!;

  if (key in (cursor as Record<string, unknown>)) {
    (cursor as Record<string, unknown>)[key] = '[REDACTED]';
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
