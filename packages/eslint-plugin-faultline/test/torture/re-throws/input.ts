import { defineErrors } from 'faultline';

const UserErrors = defineErrors('User', {
  NotFound: { status: 404, message: (data: { userId: string }) => `not found ${data.userId}` },
  Unauthorized: { status: 401 },
});

function getUser(id: string) {
  if (!id) throw UserErrors.NotFound({ userId: id });
  return { id };
}

// 1. Bare re-throw — catch is uncovered (no narrowing)
function bareRethrow(id: string) {
  try {
    return getUser(id);
  } catch (e) {
    throw e;
  }
}

// 2. Conditional re-throw — partial handling, still uncovered for NotFound
function conditionalRethrow(id: string) {
  try {
    return getUser(id);
  } catch (e) {
    if (Math.random() > 0.5) throw e;
    return { id: 'fallback' };
  }
}

// 3. Wrap-and-rethrow with a known typed factory — should NOT report mismatch
function wrappedRethrow(id: string): never {
  try {
    return getUser(id) as never;
  } catch (e) {
    throw UserErrors.Unauthorized();
  }
}
