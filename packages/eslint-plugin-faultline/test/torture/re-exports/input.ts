// Aliased imports — does the rule recognize them?
import { narrowError as nE, defineErrors as dE } from 'faultline';

const Errs = dE('User', {
  NotFound: { status: 404, message: (d: { id: string }) => `nf ${d.id}` },
});

function get(id: string) {
  if (!id) throw Errs.NotFound({ id });
  return { id };
}

function handled(id: string) {
  try {
    return get(id);
  } catch (e) {
    const err = nE(e, [Errs]);
    if (err._tag === 'User.NotFound') return null;
    throw err;
  }
}
