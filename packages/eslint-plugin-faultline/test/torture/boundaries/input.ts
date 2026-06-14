import { defineErrors, defineBoundary } from 'faultline';

const SrcErrors = defineErrors('Src', {
  A: { status: 500 },
});

const DstErrors = defineErrors('Dst', {
  X: { status: 500 },
});

// Boundary map handler — `throw` here is structurally a typed factory call, should not trip no-raw-throw
const boundary = defineBoundary({
  name: 'src-to-dst',
  from: SrcErrors,
  map: {
    'Src.A': () => DstErrors.X(),
  },
});

void boundary;
