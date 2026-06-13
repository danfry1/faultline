import { describe, expect, test } from 'bun:test';
import {
  defineErrors,
  defineBoundary,
  isAppError,
  isErr,
  isOk,
} from '../src/index';

const DomainErrors = defineErrors('Domain', {
  NotFound: {
    status: 404,
    message: (data: { id: string }) => `Not found: ${data.id}`,
  },
  Forbidden: {
    status: 403,
  },
});

const HttpErrors = defineErrors('Http', {
  NotFound: {
    status: 404,
    message: (data: { resource: string }) => `${data.resource} not found`,
  },
  Forbidden: {
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

  test('try() returns Ok(mapped) for a handled tag (no throw)', () => {
    const result = boundary.try(DomainErrors.NotFound({ id: '42' }));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value._tag).toBe('Http.NotFound');
      expect(isAppError(result.value.cause) && result.value.cause._tag).toBe('Domain.NotFound');
    }
  });

  test('try() returns Err(BoundaryViolation) for an unmapped tag instead of throwing', () => {
    const fakeError = DomainErrors.NotFound({ id: '1' });
    Object.defineProperty(fakeError, '_tag', { value: 'Unknown.Tag', writable: false });

    let result!: ReturnType<typeof boundary.try>;
    expect(() => { result = boundary.try(fakeError as never); }).not.toThrow();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('System.BoundaryViolation');
      expect((result.error.data as { fromTag: string }).fromTag).toBe('Unknown.Tag');
      expect(isAppError(result.error.cause)).toBe(true);
    }
  });

  test('BoundaryViolation throws on unhandled tag', () => {
    const fakeError = DomainErrors.NotFound({ id: '1' });
    Object.defineProperty(fakeError, '_tag', { value: 'Unknown.Tag', writable: false });

    expect(() => boundary(fakeError as any)).toThrow();

    try {
      boundary(fakeError as any);
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      if (isAppError(e)) {
        expect(e._tag).toBe('System.BoundaryViolation');
        expect((e.data as any).expectedTags).toEqual(['Domain.NotFound', 'Domain.Forbidden']);
        expect((e.data as any).fromTag).toBe('Unknown.Tag');
        expect((e.data as any).boundary).toBe('domain-to-http');
      }
    }
  });
});
