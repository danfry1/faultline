import {
  TaskResult,
  attempt,
  err,
  ok,
  type Result,
} from 'faultline';

import { UserErrors } from './errors';

export function getUser(id: string): Result<{ id: string }, ReturnType<typeof UserErrors.NotFound> | ReturnType<typeof UserErrors.Unauthorized>> {
  if (id === 'missing') {
    return err(UserErrors.NotFound({ userId: id }));
  }

  return ok({ id });
}

export async function fetchUser(id: string): Promise<{ id: string }> {
  if (id === 'explode') {
    throw new Error('network');
  }

  return { id };
}

export const loadUser = (id: string): TaskResult<{ id: string }, ReturnType<typeof UserErrors.NotFound>> =>
  TaskResult.ok(id).andThenTask(async (value) => {
    const syncResult = attempt(() => JSON.parse(`{"id":"${value}"}`));

    if (syncResult._type === 'err') {
      return TaskResult.err(UserErrors.NotFound({ userId: value }));
    }

    return TaskResult.ok(syncResult.value as { id: string });
  });

export function unsafeWrapper(): Result<string, ReturnType<typeof UserErrors.NotFound>> {
  try {
    const value = Math.random() > 2 ? 'never' : 'okay';
    return ok(value);
  } catch (error) {
    return err(UserErrors.NotFound({ userId: String(error) }));
  }
}
