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
  const [dodgeCount, setDodgeCount] = useState(0);
  const [dodgeOffset, setDodgeOffset] = useState({ x: 0, y: 0, rotate: 0 });
  const [isLauncherHovered, setIsLauncherHovered] = useState(false);
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
  const [isInputFocused, setIsInputFocused] = useState(false);
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

  const triggerDodge = () => {
    if (dodgeCount >= 2) return;
    const dodgePresets = [
      { x: -115, y: -80, rotate: -12 },
      { x: -65, y: -140, rotate: 10 },
      { x: -140, y: -30, rotate: -8 },
    ];
    const nextOffset = dodgePresets[dodgeCount % dodgePresets.length] || { x: -90, y: -90, rotate: -10 };
    setDodgeOffset(nextOffset);
    setDodgeCount((prev) => prev + 1);
  };

  const handleLauncherClick = () => {
    if (dodgeCount < 2) {
      triggerDodge();
      return;
    }
    setDodgeOffset({ x: 0, y: 0, rotate: 0 });
    setIsOpen(true);
    setIsMinimized(false);
  };

  const handleLauncherMouseEnter = () => {
    setIsLauncherHovered(true);
    if (dodgeCount < 2) {
      triggerDodge();
    }
  };

  const launcherTransform = (() => {
    if (dodgeOffset.x !== 0 || dodgeOffset.y !== 0) {
      if (dodgeCount >= 2 && isLauncherHovered) {
        return `translate3d(${dodgeOffset.x}px, ${dodgeOffset.y}px, 0) scale(1.1) rotate(0deg)`;
      }
      return `translate3d(${dodgeOffset.x}px, ${dodgeOffset.y}px, 0) rotate(${dodgeOffset.rotate}deg)`;
    }
    return isLauncherHovered
      ? 'translate3d(0, -4px, 0) scale(1.08)'
      : 'translate3d(0, 0, 0) scale(1)';
  })();

  return (
    <>
      {/* Floating Launcher Button — Larger Raw AI Stylist with Tease & Dodge */}
      {!isOpen && (
        <button
          type="button"
          className="style-assistant-launcher"
          aria-label="Open Vishrea Style Concierge"
          title={dodgeCount < 2 ? 'Catch me if you can!' : 'Open Vishrea Style Concierge'}
          onClick={handleLauncherClick}
          onMouseEnter={handleLauncherMouseEnter}
          onMouseLeave={() => setIsLauncherHovered(false)}
          style={{
            position: 'fixed',
            right: 'clamp(16px, 3.5vw, 32px)',
            bottom: 'clamp(16px, 3.5vw, 32px)',
            zIndex: 999,
            width: 'clamp(82px, 8.5vw, 94px)',
            height: 'clamp(82px, 8.5vw, 94px)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
            transform: launcherTransform,
            transition: 'transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <img
            src="/assets/chatbot-icon.png"
            alt="Vishrea Style Concierge"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
              imageRendering: 'high-quality',
              WebkitBackfaceVisibility: 'hidden',
              filter: 'drop-shadow(0 6px 16px rgba(0, 0, 0, 0.18))',
            }}
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
            right: 'clamp(10px, 3vw, 22px)',
            bottom: 'clamp(10px, 3vw, 22px)',
            width: isMinimized ? 'min(290px, calc(100vw - 20px))' : 'min(450px, calc(100vw - 20px))',
            height: isMinimized ? 58 : 'clamp(460px, 82dvh, 670px)',
            maxHeight: 'calc(100dvh - 24px)',
            background: '#FAF8F5',
            borderRadius: 20,
            boxShadow: '0 24px 60px rgba(18, 14, 16, 0.32), 0 0 0 1px rgba(184, 149, 96, 0.38)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            transition: 'height 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Header with Frosted Glass Blur & Espresso Gradient */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(26, 23, 25, 0.97) 0%, rgba(18, 16, 18, 0.99) 100%)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              color: '#fdfbf7',
              padding: '13px 18px',
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
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1.5px solid rgba(184, 149, 96, 0.85)',
                  background: '#121012',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
                }}
              >
                <img
                  src="/assets/chatbot-icon.png"
                  alt="Vishrea Concierge"
                  style={{ width: '92%', height: '92%', objectFit: 'contain' }}
                />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <strong
                    style={{
                      fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
                      fontSize: 15,
                      fontWeight: 500,
                      letterSpacing: '0.04em',
                      color: '#ffffff',
                    }}
                  >
                    Vishrea Style Concierge
                  </strong>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#dfb87c',
                      boxShadow: '0 0 8px rgba(223, 184, 124, 0.75)',
                      display: 'inline-block',
                    }}
                    title="Stylist Online"
                  />
                </div>
                {!isMinimized && (
                  <small
                    style={{
                      color: '#bbaea5',
                      fontSize: 9.5,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      fontWeight: 500,
                      display: 'block',
                      marginTop: 2,
                    }}
                  >
                    Personal Fashion & Wardrobe Advisor
                  </small>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  opacity: 0.8,
                  borderRadius: 4,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#b89560';
                  e.currentTarget.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#e5d7cc';
                  e.currentTarget.style.opacity = '0.8';
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
                  opacity: 0.8,
                  borderRadius: 4,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#b89560';
                  e.currentTarget.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#e5d7cc';
                  e.currentTarget.style.opacity = '0.8';
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
                  background: 'linear-gradient(180deg, #FAF8F5 0%, #F5F0E8 100%)',
                }}
              >
                {/* Refined Atelier Kicker */}
                <div style={{ textAlign: 'center', margin: '4px 0 8px' }}>
                  <span
                    style={{
                      fontSize: 9,
                      textTransform: 'uppercase',
                      letterSpacing: '0.2em',
                      color: '#b89560',
                      fontWeight: 600,
                      fontFamily: 'Inter, sans-serif',
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
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          overflow: 'hidden',
                          border: '1.5px solid rgba(184, 149, 96, 0.75)',
                          background: '#121012',
                          flexShrink: 0,
                          marginTop: 2,
                          boxShadow: '0 2px 6px rgba(26,23,25,0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <img
                          src="/assets/chatbot-icon.png"
                          alt="Vishrea Concierge"
                          style={{ width: '92%', height: '92%', objectFit: 'contain' }}
                        />
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                      {/* Message Bubble */}
                      <div
                        style={{
                          padding: m.sender === 'user' ? '13px 18px' : '14px 18px',
                          borderRadius: m.sender === 'user' ? '16px 16px 3px 16px' : '16px 16px 16px 3px',
                          fontSize: 13.5,
                          lineHeight: 1.65,
                          background: m.sender === 'user' ? 'linear-gradient(135deg, #242022 0%, #1a1719 100%)' : '#FDFBF7',
                          color: m.sender === 'user' ? '#fdfbf7' : '#242022',
                          border: m.sender === 'user' ? '1px solid rgba(184, 149, 96, 0.3)' : '1px solid #E5DEC9',
                          boxShadow:
                            m.sender === 'user'
                              ? '0 4px 12px rgba(26,23,25,0.18)'
                              : '0 2px 8px rgba(70, 50, 40, 0.04)',
                          whiteSpace: 'pre-wrap',
                          letterSpacing: '0.01em',
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
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        overflow: 'hidden',
                        border: '1.5px solid rgba(184, 149, 96, 0.75)',
                        background: '#121012',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        boxShadow: '0 2px 6px rgba(26,23,25,0.25)',
                      }}
                    >
                      <img
                        src="/assets/chatbot-icon.png"
                        alt="Vishrea Concierge"
                        style={{ width: '92%', height: '92%', objectFit: 'contain' }}
                      />
                    </div>
                    <div
                      style={{
                        padding: '10px 16px',
                        background: '#FDFBF7',
                        borderRadius: '14px 14px 14px 2px',
                        border: '1px solid #E5DEC9',
                        boxShadow: '0 2px 6px rgba(70,50,40,0.03)',
                        fontSize: 12,
                        color: '#7a6c62',
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

              {/* Starter Quick Actions — Interactive Boutique Tags */}
              {messages.length <= 2 && (
                <div
                  className="concierge-pills-row"
                  style={{
                    padding: '11px 16px',
                    background: '#f8f4ec',
                    borderTop: '1px solid #ebdcd0',
                    display: 'flex',
                    gap: 8,
                    overflowX: 'auto',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                  }}
                >
                  {QUICK_STARTERS.map((qs, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSendMessage(qs)}
                      style={{
                        whiteSpace: 'nowrap',
                        fontSize: 11.5,
                        fontWeight: 450,
                        letterSpacing: '0.02em',
                        padding: '7px 15px',
                        background: '#ffffff',
                        border: '1px solid #e0d7c7',
                        borderRadius: 9999,
                        color: '#38312e',
                        cursor: 'pointer',
                        boxShadow: '0 2px 5px rgba(60, 40, 30, 0.03)',
                        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#b89560';
                        e.currentTarget.style.background = '#fdfbf8';
                        e.currentTarget.style.color = '#1a1719';
                        e.currentTarget.style.transform = 'translateY(-1.5px)';
                        e.currentTarget.style.boxShadow = '0 4px 10px rgba(184, 149, 96, 0.18)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#e0d7c7';
                        e.currentTarget.style.background = '#ffffff';
                        e.currentTarget.style.color = '#38312e';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 2px 5px rgba(60, 40, 30, 0.03)';
                      }}
                    >
                      {qs}
                    </button>
                  ))}
                </div>
              )}

              {/* Input Bar — Refined Capsule Bar with Circular Send Action */}
              <div
                style={{
                  padding: '12px 16px 14px',
                  background: '#ffffff',
                  borderTop: '1px solid #ece4d8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    background: '#faf8f5',
                    borderRadius: 9999,
                    border: isInputFocused ? '1.5px solid #b89560' : '1.5px solid #dfd6c7',
                    boxShadow: isInputFocused
                      ? '0 0 0 3px rgba(184, 149, 96, 0.14)'
                      : '0 1px 4px rgba(0, 0, 0, 0.02)',
                    padding: '3px 6px 3px 18px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <input
                    ref={inputRef}
                    type="text"
                    className="concierge-capsule-input"
                    placeholder="Ask for an outfit, event styling, or order..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    disabled={isLoading}
                    style={{
                      flex: 1,
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      fontSize: 13,
                      color: '#1a1719',
                      fontFamily: 'inherit',
                      padding: '8px 0',
                    }}
                  />
                </div>

                <button
                  type="button"
                  aria-label="Send message"
                  onClick={() => handleSendMessage()}
                  disabled={isLoading || !inputValue.trim()}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background:
                      inputValue.trim() && !isLoading
                        ? 'linear-gradient(135deg, #242022 0%, #141214 100%)'
                        : '#eae3d8',
                    color: inputValue.trim() && !isLoading ? '#ffffff' : '#b2a597',
                    border:
                      inputValue.trim() && !isLoading
                        ? '1px solid rgba(184, 149, 96, 0.6)'
                        : '1px solid #dcd3c5',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: inputValue.trim() && !isLoading ? 'pointer' : 'default',
                    fontSize: 15,
                    fontWeight: 600,
                    flexShrink: 0,
                    boxShadow:
                      inputValue.trim() && !isLoading
                        ? '0 4px 12px rgba(26,23,25,0.22)'
                        : 'none',
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  onMouseEnter={(e) => {
                    if (inputValue.trim() && !isLoading) {
                      e.currentTarget.style.transform = 'scale(1.06) translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(184, 149, 96, 0.35)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1) translateY(0)';
                    if (inputValue.trim() && !isLoading) {
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(26,23,25,0.22)';
                    }
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
