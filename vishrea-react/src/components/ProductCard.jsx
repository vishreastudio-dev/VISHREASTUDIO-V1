import React from 'react';
import { Link } from 'react-router-dom';
import { imageFor, srcSetFor } from '../lib/imageFor';
import { formatINR } from '../lib/api';

export const priceLabel = (p) => {
  if (p?.price_inr === null || p?.price_inr === undefined) return 'Price on request';
  return p.price_max_inr && p.price_max_inr > p.price_inr ? `From ${formatINR(p.price_inr)}` : formatINR(p.price_inr);
};

const altFor = (p) => [p.name, p.color && `in ${p.color.toLowerCase()}`].filter(Boolean).join(' ');

export const ProductCard = ({ product: p, className = 'product-card', showAvailability = false, eager = false }) => (
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
      {p.available === false ? <span className="product-badge is-sold-out">Sold out</span> : p.badge ? <span className="product-badge">{p.badge}</span> : null}
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
