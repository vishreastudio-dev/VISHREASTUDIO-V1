import { useState, useEffect } from 'react';
import { api } from './api';

const LIKES_KEY = 'vishrea_likes';

/**
 * Read the current likes map from localStorage:
 * returns Record<string, { id, product_id, name, category, price_inr, image_url, slug, liked_at }>
 */
export function readLikes() {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(LIKES_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const map = {};
      parsed.forEach((item) => {
        const id = typeof item === 'string' ? item : item?.id || item?.product_id;
        if (id) {
          map[id] = typeof item === 'object' ? item : { id, product_id: id };
        }
      });
      return map;
    }
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Return array of liked items sorted by newest first.
 */
export function getLikedItemsList() {
  const map = readLikes();
  return Object.values(map).sort((a, b) => {
    const ta = a.liked_at ? new Date(a.liked_at).getTime() : 0;
    const tb = b.liked_at ? new Date(b.liked_at).getTime() : 0;
    return tb - ta;
  });
}

/**
 * Write the likes map to localStorage and dispatch custom event.
 */
export function saveLikes(likesMap) {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LIKES_KEY, JSON.stringify(likesMap));
      window.dispatchEvent(new CustomEvent('vishrea_likes_changed', { detail: likesMap }));
    }
  } catch (err) {
    console.warn('Failed to save likes to localStorage:', err);
  }
}

/**
 * Dispatch a floating toast notification.
 */
export function triggerLikeToast(message) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vishrea_toast', { detail: { text: message, icon: 'heart' } }));
  }
}

/**
 * Check if a product/piece ID is liked.
 */
export function isItemLiked(id) {
  if (!id) return false;
  const map = readLikes();
  return Boolean(map[id]);
}

/**
 * React hook to observe likes in real-time across all components.
 */
export function useLikes() {
  const [likesMap, setLikesMap] = useState(() => readLikes());

  useEffect(() => {
    const handleLikesChange = (e) => {
      setLikesMap(e.detail || readLikes());
    };
    const handleStorage = (e) => {
      if (e.key === LIKES_KEY) {
        setLikesMap(readLikes());
      }
    };

    window.addEventListener('vishrea_likes_changed', handleLikesChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('vishrea_likes_changed', handleLikesChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const items = Object.values(likesMap);
  return {
    likesMap,
    items,
    count: items.length,
    isLiked: (id) => Boolean(id && likesMap[id]),
  };
}

/**
 * Toggle like for a piece or product.
 * Returns the new liked state (true if now liked, false if unliked).
 */
export async function toggleLike(pieceOrProduct, user = null) {
  const prod = pieceOrProduct?.product || pieceOrProduct;
  const id = pieceOrProduct?.id || prod?.id;
  if (!id) return false;

  const currentMap = readLikes();
  const willLike = !currentMap[id];
  const name = prod?.name || pieceOrProduct?.name || 'Curated Piece';

  if (willLike) {
    currentMap[id] = {
      id,
      product_id: prod?.id || id,
      name,
      category: prod?.category || pieceOrProduct?.category || 'Vishrea Studio',
      price_inr: prod?.price_inr ?? pieceOrProduct?.price_inr ?? null,
      image_url: prod?.image_url || (Array.isArray(prod?.images) ? prod.images[0] : null) || pieceOrProduct?.image_url || null,
      slug: prod?.slug || pieceOrProduct?.slug || '',
      liked_at: new Date().toISOString(),
    };
    triggerLikeToast(`Saved "${name}" to Likes & Wardrobe`);
  } else {
    delete currentMap[id];
    triggerLikeToast(`Removed "${name}" from Likes`);
  }

  saveLikes(currentMap);

  // If user is logged in and we have a valid UUID product id, sync with wardrobe
  const productId = prod?.id || id;
  if (user && productId && /^[0-9a-f-]{36}$/i.test(String(productId))) {
    try {
      if (willLike) {
        await api('/api/wardrobe', {
          method: 'POST',
          body: { action: 'save', product_id: productId },
        });
      } else {
        await api('/api/wardrobe', {
          method: 'DELETE',
          body: { product_id: productId },
        });
      }
    } catch (err) {
      console.warn('Wardrobe sync warning:', err.message);
    }
  }

  return willLike;
}

/**
 * Like all pieces in a look.
 */
export async function likeAllInLook(pieces, user = null) {
  if (!Array.isArray(pieces) || !pieces.length) return;
  const currentMap = readLikes();

  for (const piece of pieces) {
    const prod = piece?.product || piece;
    const id = piece?.id || prod?.id;
    if (!id) continue;

    currentMap[id] = {
      id,
      product_id: prod?.id || id,
      name: prod?.name || piece?.name || 'Curated Piece',
      category: prod?.category || piece?.category || 'Vishrea Studio',
      price_inr: prod?.price_inr ?? piece?.price_inr ?? null,
      image_url: prod?.image_url || (Array.isArray(prod?.images) ? prod.images[0] : null) || piece?.image_url || null,
      slug: prod?.slug || piece?.slug || '',
      liked_at: new Date().toISOString(),
    };

    const productId = prod?.id || id;
    if (user && productId && /^[0-9a-f-]{36}$/i.test(String(productId))) {
      try {
        await api('/api/wardrobe', {
          method: 'POST',
          body: { action: 'save', product_id: productId },
        });
      } catch (err) {
        console.warn('Wardrobe sync warning:', err.message);
      }
    }
  }

  saveLikes(currentMap);
  triggerLikeToast(`Saved ${pieces.length} look pieces to Likes & Wardrobe`);
}
