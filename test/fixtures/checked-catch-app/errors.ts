import { defineErrors } from 'faultline';

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

export const EmailErrors = defineErrors('Email', {
  SendFailed: {
    code: 'EMAIL_SEND_FAILED',
    status: 502,
    params: (input: { to: string; reason: string }) => input,
    message: (data: { to: string; reason: string }) => `Failed to send email to ${data.to}: ${data.reason}`,
  },
});
