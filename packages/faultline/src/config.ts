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

/** Configure global error system settings. Merges provided values into current config. */
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

/** Returns the current frozen error system configuration. Same reference until config changes. */
export function getErrorConfig(): Readonly<ErrorSystemConfig> {
  return cachedFrozen;
}

/** Resets error system configuration to defaults. Useful for test isolation. */
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
