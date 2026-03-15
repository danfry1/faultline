import { narrowError, type TypedPromise, type Infer } from '../../../src/index';
import { UserErrors, EmailErrors } from './errors';

// Functions that declare their error types via TypedPromise
export const getUser: (id: string) => TypedPromise<
  { id: string; name: string; email: string },
  Infer<typeof UserErrors.NotFound> | Infer<typeof UserErrors.Unauthorized>
> = async (id) => {
  if (id === 'missing') throw UserErrors.NotFound({ userId: id });
  if (id === 'banned') throw UserErrors.Unauthorized();
  return { id, name: 'Alice', email: 'alice@example.com' };
};

export const sendEmail: (to: string, body: string) => TypedPromise<
  void,
  Infer<typeof EmailErrors.SendFailed>
> = async (to, _body) => {
  if (to === 'bad@example.com') throw EmailErrors.SendFailed({ to, reason: 'bounced' });
};

// GOOD: narrowError covers all called functions' error types
export async function goodHandler(userId: string) {
  try {
    const user = await getUser(userId);
    await sendEmail(user.email, 'Welcome!');
    return { status: 200 };
  } catch (e) {
    const error = narrowError(e, [UserErrors, EmailErrors]);
    return { status: error.status ?? 500, error: error.code };
  }
}

// BAD: narrowError is missing EmailErrors — sendEmail's errors are uncovered
export async function badHandler(userId: string) {
  try {
    const user = await getUser(userId);
    await sendEmail(user.email, 'Welcome!');
    return { status: 200 };
  } catch (e) {
    const error = narrowError(e, [UserErrors]);
    //    ^ should flag: EmailErrors.SendFailed is not covered
    return { status: error.status ?? 500, error: error.code };
  }
}
