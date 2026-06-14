import { defineErrors } from 'faultline';

const E = defineErrors('Svc', {
  Bad: { status: 500 },
});

class Service {
  // 1. Throw in a method
  doThing(): number {
    throw E.Bad();
  }

  // 2. Throw in a getter
  get value(): number {
    throw E.Bad();
  }
}

function callMethod() {
  const s = new Service();
  try {
    return s.doThing();
  } catch (e) {
    return 0;
  }
}

function callGetter() {
  const s = new Service();
  try {
    return s.value;
  } catch (e) {
    return 0;
  }
}
