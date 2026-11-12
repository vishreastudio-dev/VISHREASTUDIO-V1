// Online gift purchase form state. After a paid gift the form starts again empty, keeping only the
// buyer's own choices, so a second click can never re-send the same recipient's gift.

export const blankGiftPurchase = (months, keep = {}) => ({
  gift_mode: 'gift_to_her',
  membership_months: months,
  recipient_name: '',
  recipient_email: '',
  recipient_phone: '',
  wearer_id: '',
  start_date: '',
  message: '',
  sender_phone: '',
  ...keep,
});

export const afterGiftPaid = (form) => blankGiftPurchase(form.membership_months, { gift_mode: form.gift_mode, sender_phone: form.sender_phone });
