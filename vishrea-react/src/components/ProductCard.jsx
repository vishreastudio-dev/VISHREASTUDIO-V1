import React from 'react';
import { Link } from 'react-router-dom';
import { imageFor, srcSetFor } from '../lib/imageFor';
import { formatINR } from '../lib/api';
import { useStore } from '../context/StoreContext';
import { useLikes, toggleLike } from '../lib/likes';

export const priceLabel = (p) => {
  if (p?.price_inr === null || p?.price_inr === undefined) return 'Price on request';
  return p.price_max_inr && p.price_max_inr > p.price_inr ? `From ${formatINR(p.price_inr)}` : formatINR(p.price_inr);
};

const altFor = (p) => [p.name, p.color && `in ${p.color.toLowerCase()}`].filter(Boolean).join(' ');

export const ProductCard = ({ product: p, className = 'product-card', showAvailability = false, eager = false }) => {
  const { user, activeSizeProfile } = useStore();
  const { isLiked } = useLikes();
  const liked = Boolean(isLiked(p.id) || isLiked(p.slug));

  const handleHeartClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLike(p, user);
  };

  return (
    <Link className={`${className}${p.available === false ? ' is-sold' : ''}`} to={`/product/${encodeURIComponent(p.slug || p.id)}`}>
      <div className="product-image">
        <img
          src={imageFor(p)}
          srcSet={srcSetFor(imageFor(p))}
          sizes="(max-width: 700px) 50vw, (max-width: 1100px) 33vw, 25vw"
          alt={altFor(p)}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          width="400"
          height="500"
        />
        {/* Floating Heart / Like Button for quick saving */}
        <button
          type="button"
          className={`product-card-heart ${liked ? 'is-liked' : ''}`}
          onClick={handleHeartClick}
          aria-label={liked ? `Remove ${p.name} from Likes` : `Save ${p.name} to Likes`}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill={liked ? '#7B1426' : 'rgba(255,255,255,0.9)'} stroke={liked ? '#7B1426' : '#1a1719'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {p.available === false ? (
          <span className="product-badge is-sold-out">Gone to a new home</span>
        ) : p.badge ? (
          <span className="product-badge">{p.badge}</span>
        ) : p.is_one_of_one ? (
          <span className="product-badge one-of-one-badge">1 of 1</span>
        ) : null}
      </div>
      <div className="product-meta">
        <small>{p.category || 'Vishrea Studio'}</small>
        <h3>{p.name}</h3>
        <p>
          {priceLabel(p)}
          {p.compare_at_price ? <span className="price-compare">{formatINR(p.compare_at_price)}</span> : null}
        </p>
        {showAvailability && p.available !== false && (
          <small className="product-sizes">{p.is_one_of_one ? `One of one${p.sizes?.length ? ` · ${p.sizes[0]}` : ''}` : p.sizes?.length ? p.sizes.join(' · ') : ''}</small>
        )}
      </div>
    </Link>
  );
};
