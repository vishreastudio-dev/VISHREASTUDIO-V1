// Admin dispatch preview only. The server builds and stores the customer's link with the same rule
// (lib/couriers.js); customers are shown the stored `tracking_url`.
const PLACEHOLDER = '{tracking}';

export function previewTrackingUrl(template, trackingNumber) {
  const t = String(template || '').trim();
  const number = String(trackingNumber || '').trim();
  if (!t || !number) return null;
  try {
    const u = new URL(t.split(PLACEHOLDER).join(encodeURIComponent(number)));
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
