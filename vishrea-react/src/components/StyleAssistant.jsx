import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const QUICK_STARTERS = [
  'Styling for an evening dinner',
  'Help me find pieces for my colour palette',
  'Sizing and fit advice',
  'Tell me about Walkin Wardrobe',
  'New pieces in the studio this week',
];

export function StyleAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: 'assistant',
      content:
        'Welcome to Vishrea Studio. I am your personal style concierge. Whether you are curating a look for an evening event, seeking palette recommendations, or inquiring about our Walkin Wardrobe, I am delighted to assist you.',
      products: [],
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [messages, isOpen, isMinimized]);

  const handleSendMessage = async (textToSend) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isLoading) return;

    const userMessage = { sender: 'user', content: text };
    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInputValue('');
    setIsLoading(true);

    try {
      const res = await api('/api/style-assistant', {
        method: 'POST',
        body: {
          message: text,
          history: newHistory.slice(-6).map((m) => ({ sender: m.sender, content: m.content })),
        },
      });

      if (res?.ok || res?.reply) {
        setMessages([
          ...newHistory,
          {
            sender: 'assistant',
            content: res.reply,
            products: Array.isArray(res.products) ? res.products : [],
          },
        ]);
      } else {
        throw new Error(res?.error || 'Failed to reach stylist');
      }
    } catch (err) {
      setMessages([
        ...newHistory,
        {
          sender: 'assistant',
          content:
            'I am momentarily unable to retrieve our catalogue. You can explore our collection on the catalogue page, or connect with our studio directly at care@vishreastudio.com.',
          products: [],
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <>
      {/* Floating Launcher Button — Humanized Luxury Concierge */}
      {!isOpen && (
        <button
          type="button"
          className="style-assistant-launcher"
          aria-label="Open Vishrea Style Concierge"
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          style={{
            position: 'fixed',
            right: 'clamp(12px, 3vw, 24px)',
            bottom: 'clamp(12px, 3vw, 24px)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'linear-gradient(135deg, #1f1b1d 0%, #2b2428 100%)',
            color: '#fdfbf7',
            padding: '10px 18px 10px 12px',
            borderRadius: 36,
            boxShadow: '0 8px 24px rgba(26, 23, 25, 0.28), 0 0 0 1px rgba(184, 149, 96, 0.45)',
            cursor: 'pointer',
            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            border: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 12px 30px rgba(26, 23, 25, 0.35), 0 0 0 1px rgba(184, 149, 96, 0.65)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(26, 23, 25, 0.28), 0 0 0 1px rgba(184, 149, 96, 0.45)';
          }}
        >
          {/* Coat hanger icon matching luxury atelier concierge */}
          <div
            style={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3c0 1.2.7 2.2 1.8 2.7L2 14.5a1.5 1.5 0 0 0 .8 2.7h18.4a1.5 1.5 0 0 0 .8-2.7L13.2 7.7A3 3 0 0 0 15 5a3 3 0 0 0-3-3z" />
            </svg>
          </div>
          <div style={{ textAlign: 'left' }}>
            <span
              className="concierge-title"
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: 13,
                letterSpacing: '0.03em',
                display: 'block',
                lineHeight: 1.2,
                fontWeight: 500,
              }}
            >
              Style Concierge
            </span>
            <small className="concierge-subtext" style={{ fontSize: 9.5, color: '#d8c2aa', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Personal Stylist
            </small>
          </div>
          {/* Live presence indicator */}
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#34d399',
              display: 'inline-block',
              marginLeft: 4,
              boxShadow: '0 0 6px rgba(52, 211, 153, 0.7)',
            }}
            title="Stylist Online"
          />
        </button>
      )}

      {/* Style Concierge Drawer / Dialog */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Vishrea Style Concierge"
          style={{
            position: 'fixed',
            right: 'clamp(10px, 3vw, 20px)',
            bottom: 'clamp(10px, 3vw, 20px)',
            width: isMinimized ? 'min(280px, calc(100vw - 20px))' : 'min(440px, calc(100vw - 20px))',
            height: isMinimized ? 56 : 'clamp(420px, 80dvh, 640px)',
            maxHeight: 'calc(100dvh - 24px)',
            background: '#faf8f5',
            borderRadius: 16,
            boxShadow: '0 20px 48px rgba(21, 19, 21, 0.28), 0 0 0 1px rgba(184, 149, 96, 0.3)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: 'Inter, system-ui, sans-serif',
            transition: 'height 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: '#1a1719',
              color: '#fdfbf7',
              padding: '12px 18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(184, 149, 96, 0.35)',
              cursor: isMinimized ? 'pointer' : 'default',
            }}
            onClick={isMinimized ? () => setIsMinimized(false) : undefined}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              {/* Concierge Avatar */}
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1.5px solid rgba(216, 194, 170, 0.45)',
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                }}
              >
                <img
                  src="/brand-avatar.png"
                  alt="Vishrea Concierge"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong style={{ fontFamily: 'Georgia, serif', fontSize: 14.5, letterSpacing: '0.03em' }}>
                    Vishrea Style Concierge
                  </strong>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#34d399',
                      display: 'inline-block',
                    }}
                    title="Active Concierge"
                  />
                </div>
                {!isMinimized && (
                  <small style={{ color: '#d1b8c0', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Personal Fashion & Wardrobe Advisor
                  </small>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Minimize Button */}
              <button
                type="button"
                aria-label={isMinimized ? 'Expand' : 'Minimize'}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMinimized(!isMinimized);
                }}
                style={{
                  background: 'none',
                  border: 0,
                  color: '#e5d7cc',
                  fontSize: 15,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  opacity: 0.85,
                  borderRadius: 4,
                }}
                title={isMinimized ? 'Expand window' : 'Minimize window'}
              >
                {isMinimized ? '▢' : '—'}
              </button>

              {/* Close Button */}
              <button
                type="button"
                aria-label="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                style={{
                  background: 'none',
                  border: 0,
                  color: '#e5d7cc',
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  opacity: 0.85,
                  borderRadius: 4,
                }}
                title="Close Concierge"
              >
                ✕
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Message Thread */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  background: 'linear-gradient(180deg, #faf8f5 0%, #f4eee7 100%)',
                }}
              >
                {/* Refined Atelier Kicker */}
                <div style={{ textAlign: 'center', margin: '2px 0 6px' }}>
                  <span
                    style={{
                      fontSize: 8.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.18em',
                      color: '#9e7b47',
                      fontWeight: 600,
                    }}
                  >
                    Bespoke Atelier Advisory
                  </span>
                </div>

                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: m.sender === 'user' ? '84%' : '92%',
                      display: 'flex',
                      gap: 9,
                      alignItems: 'flex-start',
                    }}
                  >
                    {/* Stylist Avatar next to assistant messages */}
                    {m.sender === 'assistant' && (
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          overflow: 'hidden',
                          border: '1px solid rgba(184, 149, 96, 0.45)',
                          background: '#fff',
                          flexShrink: 0,
                          marginTop: 3,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <img
                          src="/brand-avatar.png"
                          alt="Vishrea Concierge"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                      {/* Message Bubble */}
                      <div
                        style={{
                          padding: '13px 16px',
                          borderRadius: m.sender === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                          fontSize: 13,
                          lineHeight: 1.62,
                          background: m.sender === 'user' ? '#1a1719' : '#ffffff',
                          color: m.sender === 'user' ? '#fdfbf7' : '#1a1719',
                          boxShadow:
                            m.sender === 'user'
                              ? '0 3px 8px rgba(26,23,25,0.18)'
                              : '0 2px 8px rgba(26,23,25,0.05), 0 0 0 1px rgba(220,210,198,0.5)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {m.content}
                      </div>

                      {/* Direct Clickable Product Cards with Images */}
                      {Array.isArray(m.products) && m.products.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
                            <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9e7b47', fontWeight: 600 }}>
                              Live Inventory Feed ({m.products.length} {m.products.length === 1 ? 'Piece' : 'Pieces'})
                            </span>
                            <span style={{ fontSize: 8.5, color: '#8c7d75' }}>Tap card to view details</span>
                          </div>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: m.products.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))',
                              gap: 10,
                            }}
                          >
                            {m.products.map((prod) => (
                              <Link
                                key={prod.id}
                                to={`/product/${prod.slug}`}
                                onClick={() => setIsMinimized(true)}
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  background: '#ffffff',
                                  border: '1px solid #e5dcd3',
                                  borderRadius: 8,
                                  overflow: 'hidden',
                                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                                  textDecoration: 'none',
                                  color: 'inherit',
                                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.transform = 'translateY(-2px)';
                                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(26,23,25,0.12)';
                                  e.currentTarget.style.borderColor = '#b89560';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.transform = 'translateY(0)';
                                  e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.04)';
                                  e.currentTarget.style.borderColor = '#e5dcd3';
                                }}
                              >
                                {/* Direct Product Image Link */}
                                <div
                                  style={{
                                    width: '100%',
                                    height: 145,
                                    background: '#f2ece4',
                                    overflow: 'hidden',
                                    position: 'relative',
                                  }}
                                >
                                  {prod.image_url ? (
                                    <img
                                      src={prod.image_url}
                                      alt={prod.name}
                                      loading="lazy"
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        transition: 'transform 0.3s ease',
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        height: '100%',
                                        display: 'grid',
                                        placeItems: 'center',
                                        color: '#8c7d75',
                                        fontSize: 10,
                                        fontFamily: 'Georgia, serif',
                                      }}
                                    >
                                      Vishrea Atelier
                                    </div>
                                  )}

                                  {/* Stock / Badge Tag */}
                                  <span
                                    style={{
                                      position: 'absolute',
                                      top: 6,
                                      left: 6,
                                      background: prod.available ? 'rgba(26,23,25,0.88)' : '#8b3a51',
                                      color: '#fff',
                                      fontSize: 8,
                                      padding: '2px 6px',
                                      borderRadius: 3,
                                      letterSpacing: '0.08em',
                                      textTransform: 'uppercase',
                                      fontWeight: 600,
                                      backdropFilter: 'blur(4px)',
                                    }}
                                  >
                                    {prod.available ? (prod.badge || 'In Stock') : 'Sold Out'}
                                  </span>
                                </div>

                                {/* Product Info & Direct Action */}
                                <div
                                  style={{
                                    padding: '10px 10px 12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    flex: 1,
                                    justifyContent: 'space-between',
                                  }}
                                >
                                  <div>
                                    <small
                                      style={{
                                        fontSize: 8.5,
                                        color: '#8a7d76',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.06em',
                                        display: 'block',
                                      }}
                                    >
                                      {prod.category || 'Studio Piece'}
                                    </small>
                                    <strong
                                      style={{
                                        fontFamily: 'Georgia, serif',
                                        fontSize: 12,
                                        display: 'block',
                                        margin: '3px 0 4px',
                                        lineHeight: 1.3,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        color: '#1a1719',
                                      }}
                                      title={prod.name}
                                    >
                                      {prod.name}
                                    </strong>
                                    <div style={{ fontSize: 12, color: '#1a1719', fontWeight: 600 }}>
                                      ₹{Number(prod.price_inr).toLocaleString('en-IN')}
                                    </div>
                                  </div>

                                  {/* Direct Clickable Button Link */}
                                  <div
                                    style={{
                                      marginTop: 8,
                                      textAlign: 'center',
                                      padding: '5px 8px',
                                      background: '#1a1719',
                                      color: '#ffffff',
                                      fontSize: 10,
                                      borderRadius: 4,
                                      fontWeight: 500,
                                      letterSpacing: '0.04em',
                                      transition: 'background 0.2s',
                                    }}
                                  >
                                    View Piece →
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div
                    style={{
                      alignSelf: 'flex-start',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                    }}
                  >
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        overflow: 'hidden',
                        border: '1px solid rgba(184, 149, 96, 0.45)',
                        background: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src="/brand-avatar.png"
                        alt="Vishrea Concierge"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>
                    <div
                      style={{
                        padding: '10px 14px',
                        background: '#fff',
                        borderRadius: '14px 14px 14px 2px',
                        border: '1px solid #e5dcd3',
                        fontSize: 11.5,
                        color: '#6e5d53',
                        fontStyle: 'italic',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      Consulting our studio stylist...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Starter Quick Actions — Humanized Concierge Queries */}
              {messages.length <= 2 && (
                <div
                  style={{
                    padding: '9px 14px',
                    background: '#f4eee7',
                    borderTop: '1px solid #ebdcd0',
                    display: 'flex',
                    gap: 6,
                    overflowX: 'auto',
                    scrollbarWidth: 'none',
                  }}
                >
                  {QUICK_STARTERS.map((qs, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSendMessage(qs)}
                      style={{
                        whiteSpace: 'nowrap',
                        fontSize: 11,
                        padding: '5px 12px',
                        background: '#fff',
                        border: '1px solid #dacbbd',
                        borderRadius: 16,
                        color: '#2d2729',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#b89560';
                        e.currentTarget.style.background = '#fcfaf7';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#dacbbd';
                        e.currentTarget.style.background = '#fff';
                      }}
                    >
                      {qs}
                    </button>
                  ))}
                </div>
              )}

              {/* Input Bar */}
              <div
                style={{
                  padding: '12px 14px',
                  background: '#ffffff',
                  borderTop: '1px solid #ebdcd0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Ask for an outfit, event styling, or order..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: 22,
                    border: '1px solid #dcd3c8',
                    fontSize: 12.5,
                    outline: 'none',
                    background: '#faf8f5',
                    color: '#1a1719',
                    fontFamily: 'inherit',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#b89560')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#dcd3c8')}
                />
                <button
                  type="button"
                  aria-label="Send message"
                  onClick={() => handleSendMessage()}
                  disabled={isLoading || !inputValue.trim()}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: inputValue.trim() && !isLoading ? '#1a1719' : '#e0d8cf',
                    color: '#ffffff',
                    border: 0,
                    display: 'grid',
                    placeItems: 'center',
                    cursor: inputValue.trim() && !isLoading ? 'pointer' : 'default',
                    fontSize: 14,
                    transition: 'all 0.2s ease',
                  }}
                >
                  ↑
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
