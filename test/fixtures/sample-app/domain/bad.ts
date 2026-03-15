export function unsafeDomainThing(): never {
  throw new Error('raw throw');
}

export function leakingTransportError(): string {
  const value = 'Http.NotFound';
  return value;
}
