import { defineErrors, isErrorTag, type Infer } from 'faultline';
import type { TypedPromise } from '../../../../faultline/src/typed-promise';

const E = defineErrors('E', {
  Outer: { status: 500 },
  Inner: { status: 500 },
});

function outer() { throw E.Outer(); }
function inner() { throw E.Inner(); }

// 1. Try inside try — inner catch handles Inner, outer must handle Outer
function nested() {
  try {
    outer();
    try {
      inner();
    } catch (e) {
      if (isErrorTag(e, E.Inner)) return;
    }
  } catch (e) {
    // Should be flagged as uncovered for E.Outer (and possibly E.Inner if walkNode descends)
    return;
  }
}

// 2. Try inside a function literal inside a try — outer try should NOT pick up the inner throw
function isolatedClosure() {
  try {
    setTimeout(() => {
      try { inner(); } catch (e) {}
    }, 0);
  } catch (e) {
    // Outer catch shouldn't even be triggered — but the rule may misattribute
  }
}

async function throwsTypedA(): TypedPromise<number, Infer<typeof E.Outer>> {
  throw E.Outer();
}

// 3. Try containing a closure that calls a TypedPromise-annotated function.
//    The closure's throw does NOT escape to the outer catch — outer must not be flagged.
async function typedClosureInsideTry() {
  try {
    setTimeout(async () => {
      await throwsTypedA();
    }, 0);
  } catch (e) {
    // The outer catch never sees throwsTypedA's errors. Rule must not flag this.
  }
}
