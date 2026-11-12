import React from 'react';
import { Link } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { Faq } from '../components/Faq';
import { usePageSeo } from '../lib/usePageSeo';
import { faqSchema } from '../lib/schema';
import { HELP_FAQS } from '../content/faqs';
import { useApi } from '../lib/useApi';
import { SITE, absoluteUrl } from '../site.config.js';

const waLink = (n) => `https://wa.me/${String(n).replace(/[^\d]/g, '')}`;

export const Contact = () => {
  // Seller and grievance details come from admin Settings and appear only once the owner verifies them.
  const legal = useApi('/api/content', { maxAge: 60_000 }).data?.legal;
  usePageSeo({
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Help & contact', url: '/contact' }],
    schema: faqSchema(absoluteUrl('/contact'), HELP_FAQS),
  });

  return (
    <div>
      <Header />
      <main id="main-content" className="prose-page">
        <nav aria-label="Breadcrumb" className="breadcrumb-nav">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Help &amp; contact</span>
        </nav>
        <h1>Help &amp; contact</h1>
        <p className="lead">
          The quickest way to reach us is WhatsApp, where someone from the studio will reply.
        </p>

        <dl className="contact-list">
          <div>
            <dt>WhatsApp</dt>
            <dd>
              <a href={waLink(SITE.contact.whatsapp)} target="_blank" rel="noopener noreferrer">{SITE.contact.whatsapp}</a>
              <span>Orders, sizing, exchanges and studio pickup</span>
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${String(SITE.contact.phone || SITE.contact.whatsapp).replace(/[^\d+]/g, '')}`}>{SITE.contact.phone || SITE.contact.whatsapp}</a>
              <span>Orders, sizing, exchanges and studio pickup</span>
            </dd>
          </div>
          {SITE.contact.email && (
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${SITE.contact.email}`}>{SITE.contact.email}</a>
                <span>Operational support</span>
              </dd>
            </div>
          )}
          <div>
            <dt>Studio</dt>
            <dd>
              Vishrea Studio
              <span>{[SITE.address.streetAddress, SITE.address.locality, SITE.address.region, 'India'].filter(Boolean).join(', ')}</span>
              <span>Free pickup for online orders{SITE.openingHours ? ` · ${SITE.openingHours}` : ''}</span>
            </dd>
          </div>
          {legal?.legal_name && (
            <div>
              <dt>Registered business</dt>
              <dd>
                {legal.legal_name}
                {legal.address && <span>{legal.address}</span>}
                {legal.gstin && <span>GSTIN {legal.gstin}</span>}
              </dd>
            </div>
          )}
          {legal?.grievance_officer && (
            <div>
              <dt>Grievance officer</dt>
              <dd>
                {legal.grievance_officer.name}
                {legal.grievance_officer.email && <a href={`mailto:${legal.grievance_officer.email}`}>{legal.grievance_officer.email}</a>}
                {legal.grievance_officer.phone && <span>{legal.grievance_officer.phone}</span>}
              </dd>
            </div>
          )}
        </dl>

        <section aria-labelledby="faq-title" className="prose-section">
          <h2 id="faq-title">Delivery, exchanges and payment</h2>
          <Faq items={HELP_FAQS} />
        </section>

        <p className="prose-related">
          Policies: <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/returns">Refunds &amp; exchanges</Link> · <Link to="/legal/shipping">Shipping</Link> · <Link to="/legal/exchange-damage">Damage window</Link>
        </p>
      </main>
      <Footer />
    </div>
  );
};
