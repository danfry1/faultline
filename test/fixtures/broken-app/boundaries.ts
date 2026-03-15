import { defineBoundary } from '../../../src/index';

import { HttpErrors, UserErrors } from './errors';

export const domainToHttp = defineBoundary({
  name: 'domain-to-http',
  from: UserErrors,
  to: HttpErrors,
  // @ts-expect-error intentional incomplete boundary to exercise doctor diagnostics
  map: {
    'User.NotFound': (error) =>
      HttpErrors.NotFound({
        resource: 'user',
        id: error.data.userId,
      }),
  },
});
