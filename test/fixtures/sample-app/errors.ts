import { defineErrors } from '../../../src/index';

export const UserErrors = defineErrors('User', {
  NotFound: {
    code: 'USER_NOT_FOUND',
    status: 404,
    params: (input: { userId: string }) => input,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  Unauthorized: {
    code: 'USER_UNAUTHORIZED',
    status: 401,
  },
});

export const HttpErrors = defineErrors('Http', {
  NotFound: {
    code: 'HTTP_NOT_FOUND',
    status: 404,
    params: (input: { resource: string; id: string }) => input,
    message: (data: { resource: string; id: string }) =>
      `${data.resource}:${data.id} not found`,
  },
  Forbidden: {
    code: 'HTTP_FORBIDDEN',
    status: 403,
  },
});
