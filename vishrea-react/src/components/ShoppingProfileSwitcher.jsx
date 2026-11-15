import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';

export function ShoppingProfileSwitcher({ isMobile = false }) {
  const {
    user,
    sizeProfiles,
    activeSizeProfile,
    switchActiveProfile,
    sizeFilterEnabled,
    setSizeFilterEnabled,
  } = useStore();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const fullProfileName = activeSizeProfile?.name || (user ? 'My Wardrobe' : 'Standard');
  const profileName = fullProfileName;
  const shortProfileName = fullProfileName.length > 12 ? (fullProfileName.split(' ')[0] || fullProfileName.slice(0, 10)) : fullProfileName;
  const clothingSize = activeSizeProfile?.clothing_size || 'M';
  const dressSize = activeSizeProfile?.category_sizes?.dresses || clothingSize;
  const pantSize = activeSizeProfile?.category_sizes?.pants || '30';

  const handleSelect = async (profileId) => {
    if (profileId === activeSizeProfile?.id) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await switchActiveProfile(profileId);
      setOpen(false);
    } finally {
      setSwitching(false);
    }
  };

  if (!user && isMobile) return null;

  return (
    <div
      ref={containerRef}
      className={`shopping-profile-container ${isMobile ? 'is-mobile' : ''}`}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        className="profile-switcher-btn"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Shopping for ${fullProfileName}. Click to change size profile.`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="profile-switcher-kicker">For:</span>
        <strong className="profile-switcher-name" title={fullProfileName}>{shortProfileName}</strong>
        <span className="profile-switcher-size-chip" title="Active clothing size">
          {clothingSize}
        </span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            marginLeft: 2,
          }}
          aria-hidden="true"
        >
          <path d="M1 1L5 5L9 1" />
        </svg>
      </button>

      {open && (
        <div
          className="profile-switcher-dropdown"
          role="menu"
          aria-label="Size Profiles"
        >
          <div className="profile-switcher-header">
            <span className="profile-switcher-eyebrow">ACTIVE SHOPPING PROFILE</span>
            <div className="profile-switcher-active-summary">
              <span className="profile-switcher-dot" />
              <strong>{fullProfileName}</strong>
              {activeSizeProfile?.is_primary && <span className="profile-primary-badge">PRIMARY</span>}
            </div>
            <div className="profile-sizes-summary-chips">
              <span>Top: {clothingSize}</span>
              <span>Dress: {dressSize}</span>
              <span>Bottom: {pantSize}</span>
              <span>Fit: {activeSizeProfile?.fit_preference || 'Regular'}</span>
            </div>
          </div>

          <div className="profile-filter-toggle-row">
            <label className="profile-filter-toggle-label">
              <input
                type="checkbox"
                checked={sizeFilterEnabled}
                onChange={(e) => setSizeFilterEnabled(e.target.checked)}
              />
              <span>Filter catalogue to fit {profileName}</span>
            </label>
          </div>

          <div className="profile-list-section">
            <span className="profile-list-heading">
              {user ? 'Switch Profile' : 'Sign in for Profiles'}
            </span>

            {user ? (
              <div className="profile-list-items" role="radiogroup">
                {(sizeProfiles || []).map((p) => {
                  const isActive = p.id === activeSizeProfile?.id;
                  const pTop = p.clothing_size || 'M';
                  const pDress = p.category_sizes?.dresses || pTop;
                  const pBottom = p.category_sizes?.pants || '30';

                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      disabled={switching}
                      className={`profile-item-btn ${isActive ? 'is-active' : ''}`}
                      onClick={() => handleSelect(p.id)}
                    >
                      <div className="profile-item-info">
                        <div className="profile-item-title-row">
                          <span className="profile-item-name">{p.name}</span>
                          {p.is_primary && <span className="profile-tag-pill">My Wardrobe</span>}
                          {p.relationship && p.relationship !== 'self' && (
                            <span className="profile-relation-pill">{p.relationship}</span>
                          )}
                        </div>
                        <div className="profile-item-sizes-row">
                          Top {pTop} · Dress {pDress} · Bottom {pBottom}
                        </div>
                      </div>
                      <div className="profile-item-radio">
                        {isActive && <span className="radio-inner" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '8px 12px 14px', fontSize: 12, color: 'var(--muted, #666)' }}>
                <p style={{ margin: '0 0 10px', lineHeight: 1.5 }}>
                  Sign in to create custom size profiles for yourself, friends, and family.
                </p>
                <Link
                  to="/login"
                  className="button button-dark"
                  style={{ width: '100%', textAlign: 'center', padding: '10px', fontSize: 11 }}
                  onClick={() => setOpen(false)}
                >
                  Sign In / Create Account
                </Link>
              </div>
            )}
          </div>

          {user && (
            <div className="profile-switcher-footer">
              <Link
                to="/account#size-profiles"
                className="profile-footer-action-link"
                onClick={() => setOpen(false)}
              >
                + Add Someone Else (Friend, Family)
              </Link>
              <Link
                to="/account#size-profiles"
                className="profile-footer-manage-link"
                onClick={() => setOpen(false)}
              >
                Manage All Profiles →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
