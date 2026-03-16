export interface ErrorSystemConfig {
  readonly captureStack: boolean;
  readonly redactPaths: readonly string[];
}

const defaultCaptureStack =
  typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production'
    ? false
    : true;

const defaults: ErrorSystemConfig = {
  captureStack: defaultCaptureStack,
  redactPaths: [],
};

let currentConfig: { captureStack: boolean; redactPaths: string[] } = {
  captureStack: defaults.captureStack,
  redactPaths: [...defaults.redactPaths],
};
let cachedFrozen: Readonly<ErrorSystemConfig> = Object.freeze({ ...defaults, redactPaths: [...defaults.redactPaths] });

export function configureErrors(
  input: Partial<ErrorSystemConfig>,
): Readonly<ErrorSystemConfig> {
  if (input.captureStack !== undefined) {
    currentConfig.captureStack = input.captureStack;
  }

  if (input.redactPaths !== undefined) {
    currentConfig.redactPaths = [...input.redactPaths];
  }

  cachedFrozen = Object.freeze({
    captureStack: currentConfig.captureStack,
    redactPaths: [...currentConfig.redactPaths],
  });

  return cachedFrozen;
}

export function getErrorConfig(): Readonly<ErrorSystemConfig> {
  return cachedFrozen;
}

export function resetErrorConfig(): void {
  currentConfig = {
    captureStack: defaults.captureStack,
    redactPaths: [...defaults.redactPaths],
  };
  cachedFrozen = Object.freeze({
    captureStack: defaults.captureStack,
    redactPaths: [...defaults.redactPaths],
  });
}
