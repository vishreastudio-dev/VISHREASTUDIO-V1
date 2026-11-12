// Customer-facing status wording shared by pages (kept here so it can be unit tested).

// A mandate can be authorised with UPI or a card, so the status never names the method.
export const MANDATE_COPY = {
  authenticated: 'Autopay set up',
  active: 'Autopay active',
  pending: 'Payment being retried',
  halted: 'Autopay stopped after failed retries',
  paused: 'Autopay paused',
  cancelled: 'Autopay cancelled',
  completed: 'Autopay mandate ended',
  cancel_pending: 'Stopping autopay',
};

export const piecesLabel = (n) => `${n} ${Number(n) === 1 ? 'piece' : 'pieces'}`;

export const bagPackedMessage = (pieces) => `Your ${piecesLabel(pieces)} ${Number(pieces) === 1 ? 'is' : 'are'} being packed. We dispatch within 48 hours.`;
