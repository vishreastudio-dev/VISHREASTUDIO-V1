// Helper function matching original public/app.js:imageFor exactly
export const imageFor = (p) =>
  p?.image_url ||
  {
    Tops: '/assets/tops.jpg',
    Dresses: '/assets/dress.jpg',
    Skirts: '/assets/tops.jpg',
    Pants: '/assets/editorial.jpg',
    'Crop Tops': '/assets/tops.jpg',
    'Party Dresses': '/assets/party.jpg',
    'Coord Sets': '/assets/editorial.jpg',
    Sweaters: '/assets/knit.jpg',
    'Long Coats & Shrugs': '/assets/party.jpg',
    'Sweatshirts & Hoodies': '/assets/knit.jpg',
    Cardigans: '/assets/knit.jpg'
  }[p?.category] ||
  '/assets/editorial.jpg';

/**
 * `srcset` for image hosts that resize on request (Unsplash: `w=` with `auto=format` serves
 * WebP/AVIF), so phones download a card-sized image. Other URLs (uploads) are left as they are.
 */
export function srcSetFor(url, widths = [320, 480, 720, 960]) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'images.unsplash.com') return undefined;
    if (!u.searchParams.has('auto')) u.searchParams.set('auto', 'format');
    return widths
      .map((w) => {
        u.searchParams.set('w', String(w));
        return `${u.toString()} ${w}w`;
      })
      .join(', ');
  } catch {
    return undefined;
  }
}
