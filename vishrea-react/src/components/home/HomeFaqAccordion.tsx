import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HOME_LOCAL_FAQS } from '../../content/faqs';
import './home-sections.css';

interface FaqItem {
  q: string;
  a: string;
}

interface HomeFaqAccordionProps {
  faqs?: FaqItem[];
}

// SVG Plus / Minus Icon
const PlusMinusIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transition: 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
      transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
    }}
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const HomeFaqAccordion: React.FC<HomeFaqAccordionProps> = ({
  faqs = HOME_LOCAL_FAQS,
}) => {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const toggle = (idx: number) => {
    setOpenIdx((cur) => (cur === idx ? null : idx));
  };

  return (
    <section
      className="vishrea-section"
      id="faqs"
      aria-labelledby="home-faq-heading"
      style={{ paddingTop: '48px', paddingBottom: '48px' }}
    >
      {/* Compact Header with Render content and new theme */}
      <div style={{ textAlign: 'center', maxWidth: '640px', margin: '0 auto 26px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ display: 'inline-block', width: '18px', height: '1.5px', backgroundColor: '#C9984A' }} aria-hidden="true" />
          <p className="vishrea-sub" style={{ margin: 0, fontSize: '0.72rem', letterSpacing: '0.14em' }}>FREQUENTLY ASKED QUESTIONS</p>
        </div>
        <h2 id="home-faq-heading" className="vishrea-headline" style={{ margin: '0 auto', fontSize: 'clamp(1.5rem, 2.4vw, 2.1rem)' }}>
          Everything You Need <span className="vishrea-gradient-text">To Know</span>
        </h2>
        <p className="vishrea-sub" style={{ marginTop: '8px', textTransform: 'none', fontSize: '0.86rem', lineHeight: '1.5' }}>
          Details on visiting our Hebbagodi boutique, personal styling consultations, and pan-India express delivery.
        </p>
      </div>

      {/* Modern Compact Accordion Items */}
      <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {faqs.map((faq, idx) => {
          const isOpen = openIdx === idx;
          const numberLabel = String(idx + 1).padStart(2, '0');

          return (
            <div
              key={faq.q}
              style={{
                backgroundColor: '#ffffff',
                border: isOpen ? '1.5px solid #C9984A' : '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: '12px',
                padding: '0 18px',
                boxShadow: isOpen
                  ? '0 6px 20px -4px rgba(201, 152, 74, 0.14)'
                  : '0 1px 3px rgba(0, 0, 0, 0.02)',
                transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
              }}
            >
              {/* Trigger */}
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${idx}`}
                onClick={() => toggle(idx)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '14px',
                  padding: '13px 0',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'inherit',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: '#C9984A',
                      letterSpacing: '0.08em',
                      flexShrink: 0,
                    }}
                  >
                    {numberLabel}
                  </span>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: '0.94rem',
                      fontWeight: 600,
                      lineHeight: '1.35',
                      color: isOpen ? '#7B1426' : 'var(--vishrea-ink)',
                      transition: 'color 0.2s ease',
                      fontFamily: 'inherit',
                    }}
                  >
                    {faq.q}
                  </h3>
                </div>

                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: isOpen ? '#7B1426' : 'rgba(0, 0, 0, 0.04)',
                    color: isOpen ? '#ffffff' : 'var(--vishrea-ink)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.25s ease',
                  }}
                >
                  <PlusMinusIcon isOpen={isOpen} />
                </div>
              </button>

              {/* Collapsible Content */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`faq-answer-${idx}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div
                      style={{
                        paddingBottom: '14px',
                        paddingLeft: '28px',
                        borderTop: '1px solid rgba(0, 0, 0, 0.05)',
                        paddingTop: '10px',
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.86rem',
                          lineHeight: '1.6',
                          color: 'var(--vishrea-soft)',
                        }}
                      >
                        {faq.a}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
};
