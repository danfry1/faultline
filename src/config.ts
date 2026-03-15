export interface ErrorSystemConfig {
  captureStack: boolean;
  redactPaths: readonly string[];
}

const defaultCaptureStack =
  typeof process === 'undefined' ? true : process.env.NODE_ENV !== 'production';

const currentConfig: ErrorSystemConfig = {
  captureStack: defaultCaptureStack,
  redactPaths: [],
};

export function configureErrors(
  input: Partial<ErrorSystemConfig>,
): Readonly<ErrorSystemConfig> {
  if (typeof input.captureStack === 'boolean') {
    currentConfig.captureStack = input.captureStack;
  }

  if (input.redactPaths) {
    currentConfig.redactPaths = [...input.redactPaths];
  }

  return getErrorConfig();
}

export function getErrorConfig(): Readonly<ErrorSystemConfig> {
  return {
    captureStack: currentConfig.captureStack,
    redactPaths: [...currentConfig.redactPaths],
  };
}
