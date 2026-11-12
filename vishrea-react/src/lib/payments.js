import { api, loadRazorpay } from './api';

/** Local stand-in sheet. Opens only when the server set checkout_mode. Never loads checkout.razorpay.com. */
function openLocalStandin(rp) {
  return new Promise((resolve, reject) => {
    const root = document.createElement('div');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Local payment stand-in');
    root.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(26,23,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;';
    root.innerHTML = '<div style="background:#fff;color:#1a1719;max-width:420px;padding:24px;display:grid;gap:12px;"><p style="margin:0;font-weight:600;">Local payment stand-in</p><p style="margin:0;">This checkout stays on this computer. Razorpay’s payment window is not opened, and no bank is charged.</p><div style="display:flex;flex-wrap:wrap;gap:8px;"><button type="button" data-act="pay">Confirm payment</button><button type="button" data-act="fail">Simulate failure</button><button type="button" data-act="cancel">Cancel</button></div></div>';
    const close = () => root.remove();
    const fail = (message, flags) => {
      close();
      const err = new Error(message);
      Object.assign(err, flags);
      reject(err);
    };
    root.addEventListener('click', async (event) => {
      const act = event.target?.getAttribute?.('data-act');
      if (!act || !rp.local_confirm) return;
      if (act === 'cancel') return fail('Payment was not completed. Nothing was charged.', { dismissed: true });
      try {
        const signed = await api(rp.local_confirm.path, { method: 'POST', body: { ...rp.local_confirm.body, outcome: act === 'fail' ? 'failed' : 'captured' }, timeoutMs: 30000 });
        close();
        resolve(signed);
      } catch (err) {
        fail(err.message || 'The payment did not complete. Nothing was charged.', { dismissed: true, failed: true });
      }
    });
    document.body.appendChild(root);
  });
}

/**
 * Open Razorpay Checkout for a server-created gateway order.
 * Resolves with the handler response on success; rejects with { dismissed } or { failed }.
 */
export async function openRazorpay(rp, { description = 'Vishrea Studio order' } = {}) {
  if (rp?.checkout_mode === 'local') return openLocalStandin(rp);
  const Razorpay = await loadRazorpay();
  return new Promise((resolve, reject) => {
    let settled = false;
    // A mandate (UPI Autopay) checkout is identified by its subscription; the amount comes from the gateway.
    const target = rp.subscription_id ? { subscription_id: rp.subscription_id, recurring: 1 } : { order_id: rp.order_id, amount: rp.amount, currency: rp.currency || 'INR' };
    const rzp = new Razorpay({
      key: rp.key_id,
      ...target,
      name: rp.name || 'Vishrea Studio',
      description: rp.description || description,
      prefill: rp.prefill || {},
      theme: { color: '#1a1719' },
      retry: { enabled: true, max_count: 3 },
      handler: (resp) => {
        settled = true;
        resolve(resp);
      },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          if (settled) return;
          const reason = rzp.__lastFailure;
          const err = new Error(reason || 'Payment window closed before completion.');
          err.dismissed = true;
          if (reason) err.failed = true;
          reject(err);
        },
      },
    });
    rzp.on('payment.failed', (r) => {
      // Razorpay keeps the window open for retries; remember the reason for the UI.
      rzp.__lastFailure = r?.error?.description || 'Payment failed';
    });
    rzp.open();
  });
}

/** Poll an order until it is paid (webhook may finalise it) or the timeout passes. */
export async function waitForPaid(orderId, { timeoutMs = 60000, intervalMs = 3000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const d = await api(`/api/orders?id=${encodeURIComponent(orderId)}`);
      const s = d?.order?.payment_status;
      if (s && s !== 'pending') return s;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return 'pending';
}
