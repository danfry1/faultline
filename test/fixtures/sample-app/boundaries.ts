import { defineBoundary } from 'faultline';

import { HttpErrors, UserErrors } from './errors';

export const domainToHttp = defineBoundary({
  name: 'domain-to-http',
  from: UserErrors,
  to: HttpErrors,
  map: {
    'User.NotFound': (error) =>
      HttpErrors.NotFound({
        resource: 'user',
        id: error.data.userId,
      }),
    'User.Unauthorized': () => HttpErrors.Forbidden(),
  },
});
