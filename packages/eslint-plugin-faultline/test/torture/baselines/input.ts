import { defineErrors, isErrorTag, narrowError } from 'faultline';

const UserErrors = defineErrors('User', {
  NotFound: { status: 404, message: (data: { userId: string }) => `not found ${data.userId}` },
});

function getUser(id: string) {
  if (!id) throw UserErrors.NotFound({ userId: id });
  return { id };
}

// 1. Properly handled with isErrorTag — should NOT report
function handled1(id: string) {
  try {
    return getUser(id);
  } catch (e) {
    if (isErrorTag(e, UserErrors.NotFound)) {
      return { id: 'guest' };
    }
    throw e;
  }
}

// 2. Properly handled with narrowError — should NOT report
function handled2(id: string) {
  try {
    return getUser(id);
  } catch (e) {
    const err = narrowError(e, [UserErrors]);
    if (err._tag === 'User.NotFound') return { id: 'guest' };
    throw err;
  }
}

// 3. Pure sync helper, no throws — should NOT report any rule
function pure(a: number, b: number) {
  return a + b;
}

// 4. Plain promise chain, no throws — should NOT report
async function fetchAndLog(url: string) {
  const res = await fetch(url);
  console.log(res.status);
  return res;
}
