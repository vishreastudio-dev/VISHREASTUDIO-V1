import React from 'react';
import { Link, NavLink } from 'react-router-dom';

export const AccountNav = () => (
  <nav className="account-nav" aria-label="Account" style={{ display: 'grid', gap: '8px', height: 'fit-content' }}>
    <p className="eyebrow">MY VISHREA</p>
    <NavLink to="/account" end>Overview</NavLink>
    <NavLink to="/orders">Orders & exchanges</NavLink>
    <NavLink to="/membership">Membership & credits</NavLink>
    <NavLink to="/wardrobe">Wardrobe Bag</NavLink>
    <Link to="/account#referrals">Refer a friend</Link>
    <NavLink to="/skin-tone">Colour profile</NavLink>
  </nav>
);

export const STATUS_LABEL = {
  pending: 'Awaiting payment',
  paid: 'Paid',
  failed: 'Payment failed',
  cancelled: 'Cancelled',
  expired: 'Payment window closed',
  refund_required: 'Refund in progress',
  refunded: 'Refunded',
  pending_payment: 'Awaiting payment',
  processing: 'Preparing',
  packed: 'Packed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
};

export const statusTone = (s) => (['paid', 'delivered', 'dispatched', 'processing', 'packed'].includes(s) ? 'good' : ['pending', 'pending_payment', 'refund_required'].includes(s) ? 'warn' : 'bad');
