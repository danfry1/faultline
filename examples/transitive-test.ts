import { defineErrors, type TypedPromise, type Infer } from 'faultline';

const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
});

const PaymentErrors = defineErrors('Payment', {
  Declined: {
    status: 402,
    message: (data: { reason: string }) => `Payment declined: ${data.reason}`,
  },
});

const chargeCard: (id: string) => TypedPromise<
  boolean,
  Infer<typeof PaymentErrors.Declined> | Infer<typeof UserErrors.NotFound>
> = async (id) => {
  if (id === 'broke') throw PaymentErrors.Declined({ reason: 'insufficient funds' });
  if (id === 'missing') throw UserErrors.NotFound({ userId: id });
  return true;
};

const getUser: (id: string) => TypedPromise<
  { id: string; name: string },
  Infer<typeof UserErrors.NotFound>
> = async (id) => {
  await chargeCard(id);
  if (id === 'missing') throw UserErrors.NotFound({ userId: id });
  return { id, name: 'Alice' };
};
