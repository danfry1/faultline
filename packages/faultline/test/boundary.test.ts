import { describe, expect, test } from 'bun:test';
import {
  defineErrors,
  defineBoundary,
  isAppError,
} from '../src/index';

const DomainErrors = defineErrors('Domain', {
  NotFound: {
    code: 'DOMAIN_NOT_FOUND',
    status: 404,
    params: (input: { id: string }) => input,
    message: ({ id }) => `Not found: ${id}`,
  },
  Forbidden: {
    code: 'DOMAIN_FORBIDDEN',
    status: 403,
  },
});

const HttpErrors = defineErrors('Http', {
  NotFound: {
    code: 'HTTP_NOT_FOUND',
    status: 404,
    params: (input: { resource: string }) => input,
    message: ({ resource }) => `${resource} not found`,
  },
  Forbidden: {
    code: 'HTTP_FORBIDDEN',
    status: 403,
  },
});

const boundary = defineBoundary({
  name: 'domain-to-http',
  from: DomainErrors,
  to: HttpErrors,
  map: {
    'Domain.NotFound': (e) => HttpErrors.NotFound({ resource: e.data.id }),
    'Domain.Forbidden': () => HttpErrors.Forbidden(),
  },
});

describe('boundary', () => {
  test('maps error and sets original as cause', () => {
    const original = DomainErrors.NotFound({ id: '42' });
    const mapped = boundary(original);
    expect(mapped._tag).toBe('Http.NotFound');
    expect(isAppError(mapped.cause)).toBe(true);
    if (isAppError(mapped.cause)) {
      expect(mapped.cause._tag).toBe('Domain.NotFound');
    }
  });

  test('always sets original as cause even when handler sets its own', () => {
    const customCause = new Error('custom');
    const boundaryWithCause = defineBoundary({
      name: 'test-cause-chain',
      from: DomainErrors,
      map: {
        'Domain.NotFound': () => HttpErrors.Forbidden().withCause(customCause),
        'Domain.Forbidden': () => HttpErrors.Forbidden(),
      },
    });

    const original = DomainErrors.NotFound({ id: '1' });
    const mapped = boundaryWithCause(original);
    // The mapped error should have the original as cause (overrides handler's cause)
    expect(isAppError(mapped.cause)).toBe(true);
    if (isAppError(mapped.cause)) {
      expect(mapped.cause._tag).toBe('Domain.NotFound');
    }
  });

  test('BoundaryViolation includes expected tags', () => {
    // Create an error with a tag the boundary doesn't handle
    const fakeError = DomainErrors.NotFound({ id: '1' });
    // Bypass type system to simulate an unknown tag
    Object.defineProperty(fakeError, '_tag', { value: 'Unknown.Tag', writable: false });

    const result = boundary(fakeError as any);
    expect(result._tag).toBe('System.BoundaryViolation');
    expect(result.data.expectedTags).toBeDefined();
    expect(Array.isArray(result.data.expectedTags)).toBe(true);
  });
});
