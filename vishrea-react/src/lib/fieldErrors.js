// Point the user at the field a validation error is about. Server errors name the field in
// their code (`invalid_phone`, `sender_name_required`, `full_name_too_long`); client checks pass
// the field name directly. Fields are matched by their `name` attribute inside the form.

/** API field a server error refers to, or null. */
export function errorField(err) {
  const code = String(err?.code || '');
  const m = code.match(/^invalid_(.+)$/) || code.match(/^(.+)_(required|too_long)$/);
  return m ? m[1] : null;
}

export function clearFieldErrors(form) {
  form?.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-errormessage');
  });
}

/**
 * Mark `field` (or the field named by a server error) invalid, tie it to the message element and
 * focus it. Returns true when a matching field was found.
 */
// Shared validators report a generic field name; these are the form fields they can refer to.
const ALIASES = { gstin: ['gst_number', 'buyer_gstin'], phone: ['sender_phone', 'shipping_phone'], email: ['sender_email'] };

export function markFieldError(form, fieldOrError, messageId) {
  if (!form) return false;
  clearFieldErrors(form);
  const name = typeof fieldOrError === 'string' ? fieldOrError : errorField(fieldOrError);
  const el = name ? [name, ...(ALIASES[name] || [])].map((n) => form.querySelector(`[name="${CSS.escape(n)}"]`)).find(Boolean) : null;
  if (!el) return false;
  el.setAttribute('aria-invalid', 'true');
  if (messageId) el.setAttribute('aria-errormessage', messageId);
  el.focus();
  return true;
}

/** Clear a field's invalid state as soon as the user edits it (attach to a form's onInput). */
export function clearOnInput(e) {
  if (e.target?.getAttribute?.('aria-invalid') === 'true') {
    e.target.removeAttribute('aria-invalid');
    e.target.removeAttribute('aria-errormessage');
  }
}
