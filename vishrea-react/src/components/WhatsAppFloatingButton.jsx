import React from 'react';
import { SITE } from '../site.config.js';

export const WhatsAppFloatingButton = () => {
  const rawNumber = (SITE.contact?.whatsapp || '916364116567').replace(/\D/g, '');
  const defaultText = encodeURIComponent(
    'Hello Vishrea Studio! I would like to inquire about personal styling and outfits at your Hebbagodi boutique.'
  );
  const waUrl = `https://wa.me/${rawNumber}?text=${defaultText}`;

  return (
    <aside
      aria-label="WhatsApp Support"
      style={{
        position: 'fixed',
        left: '24px',
        bottom: '24px',
        zIndex: 9999,
        lineHeight: 0,
      }}
    >
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with Vishrea Studio on WhatsApp"
        title="Chat with Vishrea Studio on WhatsApp"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          borderRadius: '50%',
          filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.18))',
          transition: 'transform 0.2s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="24" cy="24" r="23" fill="#25D366" />
          <path
            fill="#FFFFFF"
            d="M24.1 11C16.9 11 11 16.9 11 24.1c0 2.5.7 4.9 2 7l-2.1 6.4 6.7-2c2 1.2 4.3 1.8 6.5 1.8 7.2 0 13.1-5.9 13.1-13.1S31.3 11 24.1 11zm6.5 18.2c-.3.8-1.6 1.5-2.2 1.6-.6.1-1.4.1-2.2-.2-.6-.2-1.3-.5-2.3-.9-3.8-1.7-6.3-5.5-6.5-5.8-.2-.3-1.6-2.1-1.6-4 0-1.9 1-2.8 1.3-3.2.4-.4.8-.5 1-.5.3 0 .5 0 .7.1.2 0 .5-.1.8.6.3.8 1.1 2.7 1.2 2.9.1.2.2.4 0 .7-.1.3-.2.4-.4.7-.2.2-.4.5-.6.7-.2.2-.4.4-.2.8.2.4 1 1.7 2.2 2.8 1.5 1.3 2.8 1.8 3.2 2 .4.2.6.2.9-.1.2-.3 1-1.2 1.3-1.6.3-.4.5-.3.9-.2.4.1 2.3 1.1 2.7 1.3.4.2.7.3.8.5.1.1.1 1-.2 1.8z"
          />
        </svg>
      </a>
    </aside>
  );
};
