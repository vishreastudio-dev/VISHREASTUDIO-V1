import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

const ICONS = {
  description: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  camera: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
    </svg>
  ),
  globe: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  campaign: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l18-5v12L3 13v-2z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  ),
  banner: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  seo: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  faq: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  reply: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
    </svg>
  ),
};

const TOOLS = [
  { id: 'product_description', label: 'Product Description', icon: ICONS.description, desc: 'Craft luxury e-commerce copy tailored to silhouette, fit, and verified drape.' },
  { id: 'instagram_caption', label: 'Instagram Caption & Tags', icon: ICONS.camera, desc: 'Curate editorial Instagram captions, styling hooks, and slow-fashion tags.' },
  { id: 'social_media', label: 'Multi-Platform Social Copy', icon: ICONS.globe, desc: 'Pinterest, Threads, and LinkedIn editorial posts for drops and lookbooks.' },
  { id: 'campaign_announcement', label: 'Campaign Announcement', icon: ICONS.campaign, desc: 'Couture-style newsletters, collection reveals, and editorial press releases.' },
  { id: 'homepage_banner', label: 'Homepage Banner Copy', icon: ICONS.banner, desc: 'Punchy luxury headlines, subheads, and CTAs for homepage carousels.' },
  { id: 'seo_metadata', label: 'SEO Title & Meta Description', icon: ICONS.seo, desc: 'Search-optimized titles, meta descriptions, and keywords for discoverability.' },
  { id: 'product_faq', label: 'Garment FAQ Generator', icon: ICONS.faq, desc: 'Fit, styling, and fabric care guidance to ease buyer hesitation.' },
  { id: 'customer_reply', label: 'Customer Reply Draft', icon: ICONS.reply, desc: 'Polite, brand-aligned concierge replies to customer inquiries.' },
];

const TONES = [
  'Editorial, understated luxury',
  'Poetic, romantic, couture',
  'Minimalist, architectural, clean',
  'Vibrant, celebratory, festive party',
  'Warm, personal, concierge styling',
];

const PLATFORMS = ['Instagram', 'Pinterest', 'Threads', 'Newsletter / Email', 'LinkedIn'];
const LENGTHS = ['Concise (1 paragraph)', 'Medium (2 paragraphs)', 'Extended Editorial (3 paragraphs)'];

export function AIStudio() {
  const [activeTab, setActiveTab] = useState('generator'); // 'generator' | 'copilot' | 'drafts'
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Content Generator State
  const [selectedTool, setSelectedTool] = useState('product_description');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [tone, setTone] = useState(TONES[0]);
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [length, setLength] = useState(LENGTHS[1]);
  const [language, setLanguage] = useState('English');
  const [campaign, setCampaign] = useState('');
  const [inquiry, setInquiry] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');

  // Generation Output State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [lastProvider, setLastProvider] = useState('');
  const [currentDraftId, setCurrentDraftId] = useState(null);
  const [currentDraftStatus, setCurrentDraftStatus] = useState('draft');
  const [message, setMessage] = useState(null);

  // Co-Pilot Chat State
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      content:
        'Welcome to Vishrea AI Studio. I am your editorial and operational assistant. I can draft catalogue descriptions, create campaign copy, or summarize inventory status. How can I assist you?',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  // Drafts & Versions State
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [viewingVersions, setViewingVersions] = useState(null);
  const [versionsList, setVersionsList] = useState([]);

  // Fetch real products for product-aware generation
  useEffect(() => {
    async function loadProducts() {
      setLoadingProducts(true);
      try {
        const res = await api.get('/api/catalogue?limit=100');
        if (res?.products) {
          setProducts(res.products);
        }
      } catch (err) {
        console.error('Failed to load products for AI Studio:', err);
      } finally {
        setLoadingProducts(false);
      }
    }
    loadProducts();
  }, []);

  // Update selectedProduct object when dropdown changes
  useEffect(() => {
    if (selectedProductId) {
      const p = products.find((x) => x.id === selectedProductId);
      setSelectedProduct(p || null);
    } else {
      setSelectedProduct(null);
    }
  }, [selectedProductId, products]);

  // Load drafts when entering Drafts tab
  const loadDrafts = async () => {
    setLoadingDrafts(true);
    try {
      const res = await api.get('/api/admin/ai-studio?action=drafts');
      if (res?.drafts) setDrafts(res.drafts);
    } catch (err) {
      console.error('Failed to load drafts:', err);
    } finally {
      setLoadingDrafts(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'drafts') {
      loadDrafts();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'copilot') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, activeTab]);

  // Trigger Content Generation
  const handleGenerate = async () => {
    setIsGenerating(true);
    setMessage(null);
    try {
      const payload = {
        tool: selectedTool,
        product_id: selectedProductId || null,
        tone,
        platform,
        length,
        language,
        campaign,
        inquiry,
        customer_name: customerName,
        notes,
      };

      const res = await api.post('/api/admin/ai-studio?action=generate', payload);
      if (res?.generated_content) {
        setGeneratedContent(res.generated_content);
        setLastProvider(res.provider || 'primary');
        setCurrentDraftId(null);
        setCurrentDraftStatus('draft');
        setMessage({ type: 'success', text: `Draft generated successfully via ${res.provider || 'AI engine'}.` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Generation failed. Please verify AI API keys in .env.' });
    } finally {
      setIsGenerating(false);
    }
  };

  // Save Draft to database
  const handleSaveDraft = async () => {
    if (!generatedContent.trim()) return;
    try {
      const title =
        selectedProduct?.name
          ? `${selectedProduct.name} - ${selectedTool.replace(/_/g, ' ')}`
          : `${selectedTool.replace(/_/g, ' ')} Draft`;

      const res = await api.post('/api/admin/ai-studio?action=save_draft', {
        draft_id: currentDraftId,
        content_type: selectedTool,
        product_id: selectedProductId || null,
        title,
        content: generatedContent,
      });

      if (res?.draft) {
        setCurrentDraftId(res.draft.id);
        setCurrentDraftStatus(res.draft.status);
        setMessage({ type: 'success', text: `Draft saved successfully as Version ${res.draft.version}.` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to save draft.' });
    }
  };

  // Approve Draft
  const handleApprove = async (draftIdToApprove) => {
    const id = draftIdToApprove || currentDraftId;
    if (!id && !generatedContent.trim()) return;

    try {
      let targetId = id;
      if (!targetId) {
        // Save first
        const title = selectedProduct?.name
          ? `${selectedProduct.name} - ${selectedTool.replace(/_/g, ' ')}`
          : `${selectedTool.replace(/_/g, ' ')} Draft`;

        const saveRes = await api.post('/api/admin/ai-studio?action=save_draft', {
          content_type: selectedTool,
          product_id: selectedProductId || null,
          title,
          content: generatedContent,
        });
        targetId = saveRes.draft.id;
        setCurrentDraftId(targetId);
      }

      const res = await api.post('/api/admin/ai-studio?action=approve', { draft_id: targetId });
      if (res?.ok) {
        setCurrentDraftStatus('approved');
        setMessage({ type: 'success', text: 'Content approved by administrator. Ready for publication.' });
        if (activeTab === 'drafts') loadDrafts();
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to approve draft.' });
    }
  };

  // Publish approved description to live catalogue
  const handlePublish = async (draftIdToPublish) => {
    const id = draftIdToPublish || currentDraftId;
    if (!id) return;
    if (!window.confirm('Are you sure you want to publish this content directly to the live store?')) return;

    try {
      const res = await api.post('/api/admin/ai-studio?action=publish', { draft_id: id });
      if (res?.ok) {
        setCurrentDraftStatus('published');
        setMessage({ type: 'success', text: res.message || 'Content published successfully!' });
        if (activeTab === 'drafts') loadDrafts();
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to publish content.' });
    }
  };

  // View Version History Modal
  const handleViewVersions = async (draft) => {
    try {
      const res = await api.get(`/api/admin/ai-studio?action=draft_history&draft_id=${draft.id}`);
      if (res?.versions) {
        setVersionsList(res.versions);
        setViewingVersions(draft);
      }
    } catch (err) {
      console.error('Failed to load version history:', err);
    }
  };

  // Send message to Co-Pilot Chat
  const handleSendChat = async (e) => {
    e.preventDefault();
    const q = chatInput.trim();
    if (!q || isChatLoading) return;

    const userMsg = { role: 'user', content: q };
    const newChat = [...chatMessages, userMsg];
    setChatMessages(newChat);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const res = await api.post('/api/admin/ai-studio?action=copilot', {
        message: q,
        history: newChat.slice(-8),
      });

      if (res?.reply) {
        setChatMessages([...newChat, { role: 'assistant', content: res.reply, provider: res.provider }]);
      }
    } catch (err) {
      setChatMessages([
        ...newChat,
        { role: 'assistant', content: `Co-pilot error: ${err.message || 'Unable to connect to AI engine.'}` },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 16px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 24, margin: 0, fontWeight: 500, letterSpacing: '0.02em' }}>
              Vishrea AI Studio
            </h1>
            <span
              style={{
                fontSize: 9.5,
                background: '#f4ece1',
                color: '#8b572a',
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              Admin Authorized
            </span>
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--muted, #666)', fontSize: 13 }}>
            Private content generation and operational co-pilot, grounded in verified catalogue attributes.
          </p>
        </div>

        {/* Tab Switcher (No Emojis) */}
        <div style={{ display: 'flex', background: '#f0ece7', borderRadius: 8, padding: 3 }}>
          <button
            type="button"
            onClick={() => setActiveTab('generator')}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              borderRadius: 6,
              border: 0,
              background: activeTab === 'generator' ? '#fff' : 'transparent',
              color: activeTab === 'generator' ? '#1a1719' : '#666',
              fontWeight: activeTab === 'generator' ? 600 : 400,
              boxShadow: activeTab === 'generator' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Content Tools
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('copilot')}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              borderRadius: 6,
              border: 0,
              background: activeTab === 'copilot' ? '#fff' : 'transparent',
              color: activeTab === 'copilot' ? '#1a1719' : '#666',
              fontWeight: activeTab === 'copilot' ? 600 : 400,
              boxShadow: activeTab === 'copilot' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Admin Co-Pilot
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('drafts')}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              borderRadius: 6,
              border: 0,
              background: activeTab === 'drafts' ? '#fff' : 'transparent',
              color: activeTab === 'drafts' ? '#1a1719' : '#666',
              fontWeight: activeTab === 'drafts' ? 600 : 400,
              boxShadow: activeTab === 'drafts' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Drafts & Versions
          </button>
        </div>
      </div>

      {/* Global Notifications */}
      {message && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: message.type === 'error' ? '#fef2f2' : '#f0fdf4',
            color: message.type === 'error' ? '#991b1b' : '#166534',
            border: `1px solid ${message.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
          }}
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 14 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: CONTENT GENERATOR */}
      {activeTab === 'generator' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 24, alignItems: 'start' }}>
          {/* Left Configuration Column */}
          <div style={{ background: '#fff', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 8, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 17, margin: 0, fontWeight: 500 }}>
                1. Select Content Tool
              </h2>
              <span style={{ fontSize: 11, color: '#888' }}>
                Tool {TOOLS.findIndex((t) => t.id === selectedTool) + 1} of 8
              </span>
            </div>

            {/* Tool Selection Grid (Clean Icons, No Emojis) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
              {TOOLS.map((t) => {
                const isSelected = selectedTool === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTool(t.id)}
                    style={{
                      textAlign: 'left',
                      padding: '11px 12px',
                      borderRadius: 6,
                      border: `1.5px solid ${isSelected ? '#8b3a51' : 'var(--admin-line, #e5e7eb)'}`,
                      background: isSelected ? '#fbf7f8' : '#faf9f8',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4, color: isSelected ? '#8b3a51' : '#444' }}>
                      {t.icon}
                      <strong style={{ fontSize: 12, color: isSelected ? '#8b3a51' : '#1a1719' }}>{t.label}</strong>
                    </div>
                    <small style={{ fontSize: 10.5, color: '#666', display: 'block', lineHeight: 1.4 }}>{t.desc}</small>
                  </button>
                );
              })}
            </div>

            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 17, margin: '0 0 14px', fontWeight: 500 }}>
              2. Context & Product Parameters
            </h2>

            <div style={{ display: 'grid', gap: 16 }}>
              {/* Product Selector */}
              <div>
                <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600 }}>
                  Attach Verified Catalogue Product (Optional)
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--admin-line, #e5e7eb)',
                    borderRadius: 6,
                    fontSize: 13,
                    background: '#fff',
                  }}
                >
                  <option value="">-- No specific product (General brand / campaign) --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (₹{p.price_inr} • {p.category || 'Piece'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Verified Product Facts & Image Preview */}
              {selectedProduct && (
                <div style={{ background: '#fcfaf7', border: '1px solid #e7ded3', borderRadius: 6, padding: '16px', display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                  {/* Product Image Display */}
                  <div style={{ flexShrink: 0, position: 'relative' }}>
                    {selectedProduct.image_url || (Array.isArray(selectedProduct.images) && selectedProduct.images[0]) ? (
                      <div style={{ width: 100, height: 130, borderRadius: 4, overflow: 'hidden', border: '1px solid #dcd4cc', background: '#fff', position: 'relative' }}>
                        <img
                          src={selectedProduct.image_url || selectedProduct.images[0]}
                          alt={selectedProduct.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        {Array.isArray(selectedProduct.images) && selectedProduct.images.length > 1 && (
                          <span style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 9, padding: '2px 5px', borderRadius: 2 }}>
                            {selectedProduct.images.length} photos
                          </span>
                        )}
                      </div>
                    ) : (
                      <div style={{ width: 100, height: 130, borderRadius: 4, border: '1px dashed #d0c5bc', background: '#f5efe8', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 8 }}>
                        <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' }}>No image uploaded</span>
                      </div>
                    )}
                  </div>

                  {/* Verified Details */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#8a6538', fontWeight: 600 }}>
                        Verified Catalogue Data
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1719' }}>₹{selectedProduct.price_inr}</span>
                    </div>
                    <h4 style={{ margin: '0 0 6px', fontSize: 15, fontFamily: 'Georgia, serif', fontWeight: 400, color: '#1a1719' }}>
                      {selectedProduct.name}
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '6px 12px', fontSize: 12, color: '#555', marginTop: 8 }}>
                      <div><strong style={{ color: '#222' }}>Category:</strong> {selectedProduct.category || 'Piece'}</div>
                      <div><strong style={{ color: '#222' }}>Color:</strong> {selectedProduct.color || 'Studio shade'}</div>
                      <div><strong style={{ color: '#222' }}>Fabric:</strong> {selectedProduct.material || 'Verified studio material'}</div>
                      <div><strong style={{ color: '#222' }}>Season:</strong> {selectedProduct.colour_season || 'All seasons'}</div>
                    </div>

                    {/* Multi-image thumbnail gallery strip if multiple images */}
                    {Array.isArray(selectedProduct.images) && selectedProduct.images.length > 1 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
                        {selectedProduct.images.map((img, idx) => (
                          <img
                            key={idx}
                            src={img}
                            alt=""
                            style={{ width: 34, height: 42, objectFit: 'cover', borderRadius: 2, border: '1px solid #d5cbc2', cursor: 'pointer' }}
                            title={`Photo ${idx + 1}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Specific inputs depending on tool */}
              {selectedTool === 'customer_reply' ? (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600 }}>
                      Customer Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Priya Sharma"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 6, fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600 }}>
                      Customer Inquiry
                    </label>
                    <textarea
                      rows={3}
                      placeholder="e.g. Does the wine slip dress fit true to size, and can it be expedited to Mumbai?"
                      value={inquiry}
                      onChange={(e) => setInquiry(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 6, fontSize: 13 }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600 }}>
                        Tone
                      </label>
                      <select
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 6, fontSize: 12, background: '#fff' }}
                      >
                        {TONES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600 }}>
                        Target Platform
                      </label>
                      <select
                        value={platform}
                        onChange={(e) => setPlatform(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 6, fontSize: 12, background: '#fff' }}
                      >
                        {PLATFORMS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600 }}>
                      Campaign / Collection Theme (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Autumn Equinox, Midnight Soirée, Festive Slow Fashion"
                      value={campaign}
                      onChange={(e) => setCampaign(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 6, fontSize: 13 }}
                    />
                  </div>
                </>
              )}

              {/* Primary Generate Button (Prominent, High-Visibility) */}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  marginTop: 6,
                  height: 46,
                  background: isGenerating ? '#777' : '#1a1719',
                  color: '#fff',
                  border: 0,
                  borderRadius: 6,
                  fontSize: 12,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  cursor: isGenerating ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'background 0.2s',
                }}
              >
                {isGenerating ? 'Generating Content...' : 'Generate Content'}
              </button>
            </div>
          </div>

          {/* Right Output & Approval Column */}
          <div style={{ background: '#fff', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 8, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 17, margin: 0, fontWeight: 500 }}>
                3. Output & Approval Workflow
              </h2>
              {currentDraftStatus && (
                <span
                  style={{
                    fontSize: 9.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontWeight: 600,
                    background: currentDraftStatus === 'published' ? '#dcfce7' : currentDraftStatus === 'approved' ? '#e0f2fe' : '#fef3c7',
                    color: currentDraftStatus === 'published' ? '#166534' : currentDraftStatus === 'approved' ? '#0369a1' : '#92400e',
                  }}
                >
                  {currentDraftStatus}
                </span>
              )}
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--muted, #666)' }}>
              All AI outputs remain drafts until explicitly approved and published by an administrator. You can refine and edit directly below.
            </p>

            <textarea
              rows={15}
              value={generatedContent}
              onChange={(e) => setGeneratedContent(e.target.value)}
              placeholder="Your generated content will appear here. Select a tool on the left, attach a product if desired, and click 'Generate Content'."
              style={{
                width: '100%',
                padding: '14px',
                border: '1px solid var(--admin-line, #e5e7eb)',
                borderRadius: 6,
                fontSize: 13,
                lineHeight: 1.7,
                fontFamily: 'inherit',
                resize: 'vertical',
                background: '#faf9f8',
                color: '#1a1719',
              }}
            />

            {/* Action Bar (Clean Text Buttons, No Emojis) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  padding: '9px 18px',
                  fontSize: 11.5,
                  letterSpacing: '0.04em',
                  border: 0,
                  borderRadius: 4,
                  background: '#1a1719',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: isGenerating ? 'wait' : 'pointer',
                }}
              >
                {isGenerating ? 'Generating...' : generatedContent ? 'Regenerate' : 'Generate Content'}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!generatedContent) return;
                  navigator.clipboard.writeText(generatedContent);
                  setMessage({ type: 'success', text: 'Content copied to clipboard.' });
                }}
                disabled={!generatedContent}
                style={{
                  padding: '9px 15px',
                  fontSize: 11.5,
                  border: '1px solid var(--admin-line, #e5e7eb)',
                  borderRadius: 4,
                  background: '#fff',
                  cursor: generatedContent ? 'pointer' : 'default',
                  opacity: generatedContent ? 1 : 0.5,
                }}
              >
                Copy Text
              </button>

              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={!generatedContent}
                style={{
                  padding: '9px 16px',
                  fontSize: 11.5,
                  border: '1px solid #1a1719',
                  borderRadius: 4,
                  background: '#fff',
                  color: '#1a1719',
                  fontWeight: 600,
                  cursor: generatedContent ? 'pointer' : 'default',
                  opacity: generatedContent ? 1 : 0.5,
                }}
              >
                Save Draft
              </button>

              <button
                type="button"
                onClick={() => handleApprove()}
                disabled={!generatedContent}
                style={{
                  padding: '9px 16px',
                  fontSize: 11.5,
                  border: 0,
                  borderRadius: 4,
                  background: '#0284c7',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: generatedContent ? 'pointer' : 'default',
                  opacity: generatedContent ? 1 : 0.5,
                }}
              >
                Approve
              </button>

              {selectedTool === 'product_description' && selectedProductId && (
                <button
                  type="button"
                  onClick={() => handlePublish()}
                  disabled={!generatedContent || currentDraftStatus !== 'approved'}
                  title={currentDraftStatus !== 'approved' ? 'Approve before publishing' : 'Publish description to product catalogue'}
                  style={{
                    padding: '9px 16px',
                    fontSize: 11.5,
                    border: 0,
                    borderRadius: 4,
                    background: currentDraftStatus === 'approved' ? '#16a34a' : '#cbd5e1',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: currentDraftStatus === 'approved' ? 'pointer' : 'not-allowed',
                  }}
                >
                  Publish to Store
                </button>
              )}
            </div>

            {lastProvider && (
              <small style={{ display: 'block', marginTop: 14, color: '#888', fontSize: 10.5 }}>
                Engine: {lastProvider === 'groq' ? 'Groq Cloud (qwen-3.8-27b)' : 'OpenAI'} &bull; Approval required before store sync
              </small>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CONVERSATIONAL CO-PILOT (No Emojis) */}
      {activeTab === 'copilot' && (
        <div style={{ maxWidth: 900, margin: '0 auto', background: '#fff', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 8, display: 'flex', flexDirection: 'column', height: 650, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          {/* Chat Header */}
          <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--admin-line, #e5e7eb)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontFamily: 'Georgia, serif', fontSize: 16 }}>Vishrea Studio Operational Assistant</strong>
              <small style={{ display: 'block', color: 'var(--muted, #666)', fontSize: 11 }}>
                Connected to live inventory & catalogue metrics. Cannot perform financial or destructive mutations.
              </small>
            </div>
            <button
              type="button"
              onClick={() => setChatMessages([chatMessages[0]])}
              style={{ fontSize: 11, color: 'var(--muted, #888)', background: 'none', border: 0, textDecoration: 'underline', cursor: 'pointer' }}
            >
              Clear Thread
            </button>
          </div>

          {/* Quick Prompts Bar */}
          <div style={{ padding: '10px 20px', background: '#faf9f8', borderBottom: '1px solid var(--admin-line, #e5e7eb)', display: 'flex', gap: 8, overflowX: 'auto' }}>
            {[
              'Check this month total earnings',
              'Summarize catalogue inventory status',
              'Draft an Instagram caption for the Wine Slip Dress',
              'Suggest 3 campaign themes for next month',
              'Check recent order activity',
            ].map((qp) => (
              <button
                key={qp}
                type="button"
                onClick={() => setChatInput(qp)}
                style={{
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  padding: '5px 12px',
                  borderRadius: 20,
                  border: '1px solid #e0d7ce',
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#444',
                }}
              >
                {qp}
              </button>
            ))}
          </div>

          {/* Message Thread */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {chatMessages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '82%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    fontSize: 13,
                    lineHeight: 1.6,
                    background: m.role === 'user' ? '#1a1719' : '#f5f2ee',
                    color: m.role === 'user' ? '#fff' : '#111',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {m.content}
                </div>
                {m.provider && (
                  <span style={{ fontSize: 9.5, color: '#999', marginTop: 3 }}>via {m.provider}</span>
                )}
              </div>
            ))}
            {isChatLoading && (
              <div style={{ alignSelf: 'flex-start', padding: '10px 14px', borderRadius: 8, background: '#f5f2ee', fontSize: 12, color: '#666' }}>
                Consulting catalogue facts...
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendChat} style={{ padding: '16px 20px', borderTop: '1px solid var(--admin-line, #e5e7eb)', display: 'flex', gap: 12 }}>
            <input
              type="text"
              placeholder="Ask anything about catalogue copy, operational summaries, or marketing ideas..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={isChatLoading}
              style={{ flex: 1, padding: '12px 14px', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 6, fontSize: 13 }}
            />
            <button
              type="submit"
              disabled={isChatLoading || !chatInput.trim()}
              style={{
                padding: '0 22px',
                background: '#1a1719',
                color: '#fff',
                border: 0,
                borderRadius: 6,
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: DRAFTS & VERSIONS (No Emojis) */}
      {activeTab === 'drafts' && (
        <div style={{ background: '#fff', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 8, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 18, margin: 0, fontWeight: 500 }}>Saved Content Drafts & Versions</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted, #666)' }}>
                Track version revisions, review approval status, and deploy approved content to the store.
              </p>
            </div>
            <button
              type="button"
              onClick={loadDrafts}
              style={{ fontSize: 12, padding: '7px 14px', border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
            >
              Refresh List
            </button>
          </div>

          {loadingDrafts ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 13 }}>Loading drafts...</div>
          ) : drafts.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', border: '1px dashed var(--admin-line, #e5e7eb)', borderRadius: 6 }}>
              <p style={{ margin: 0, color: 'var(--muted, #666)', fontSize: 13 }}>No saved drafts yet. Generate and click "Save Draft" in the Content Tools tab.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--admin-line, #e5e7eb)', textAlign: 'left', background: '#faf9f8' }}>
                    <th style={{ padding: '10px 12px' }}>Title</th>
                    <th style={{ padding: '10px 12px' }}>Type</th>
                    <th style={{ padding: '10px 12px' }}>Product</th>
                    <th style={{ padding: '10px 12px' }}>Version</th>
                    <th style={{ padding: '10px 12px' }}>Status</th>
                    <th style={{ padding: '10px 12px' }}>Updated</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px', fontWeight: 500 }}>{d.title}</td>
                      <td style={{ padding: '12px', color: 'var(--muted, #666)' }}>{d.content_type?.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {(() => {
                            const prod = products.find((p) => p.id === d.product_id);
                            const img = prod?.image_url || (Array.isArray(prod?.images) && prod?.images[0]);
                            return img ? (
                              <img src={img} alt="" style={{ width: 28, height: 36, objectFit: 'cover', borderRadius: 2, border: '1px solid #e0e0e0', flexShrink: 0 }} />
                            ) : null;
                          })()}
                          <span>{d.product_name || '—'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px' }}>v{d.version}</td>
                      <td style={{ padding: '12px' }}>
                        <span
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 3,
                            textTransform: 'uppercase',
                            fontWeight: 600,
                            background: d.status === 'published' ? '#dcfce7' : d.status === 'approved' ? '#e0f2fe' : '#fef3c7',
                            color: d.status === 'published' ? '#166534' : d.status === 'approved' ? '#0369a1' : '#92400e',
                          }}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#888' }}>{new Date(d.updated_at).toLocaleDateString()}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTool(d.content_type);
                              setSelectedProductId(d.product_id || '');
                              setGeneratedContent(d.content);
                              setCurrentDraftId(d.id);
                              setCurrentDraftStatus(d.status);
                              setActiveTab('generator');
                            }}
                            style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 3, background: '#fff', cursor: 'pointer' }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleViewVersions(d)}
                            style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--admin-line, #e5e7eb)', borderRadius: 3, background: '#fff', cursor: 'pointer' }}
                          >
                            History
                          </button>
                          {d.status !== 'approved' && d.status !== 'published' && (
                            <button
                              type="button"
                              onClick={() => handleApprove(d.id)}
                              style={{ padding: '4px 8px', fontSize: 11, border: 0, borderRadius: 3, background: '#0284c7', color: '#fff', cursor: 'pointer' }}
                            >
                              Approve
                            </button>
                          )}
                          {d.status === 'approved' && d.product_id && (
                            <button
                              type="button"
                              onClick={() => handlePublish(d.id)}
                              style={{ padding: '4px 8px', fontSize: 11, border: 0, borderRadius: 3, background: '#16a34a', color: '#fff', cursor: 'pointer' }}
                            >
                              Publish
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Versions Modal */}
          {viewingVersions && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'grid',
                placeItems: 'center',
                zIndex: 1000,
                padding: 20,
              }}
            >
              <div
                style={{
                  background: '#fff',
                  borderRadius: 8,
                  maxWidth: 720,
                  width: '100%',
                  maxHeight: '85vh',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontFamily: 'Georgia, serif', fontSize: 16 }}>Version History: {viewingVersions.title}</strong>
                  <button type="button" onClick={() => setViewingVersions(null)} style={{ background: 'none', border: 0, fontSize: 16, cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {versionsList.map((v) => (
                    <div key={v.id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 14, background: '#faf9f8' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <strong>Version {v.version_number}</strong>
                        <span style={{ fontSize: 11, color: '#888' }}>{new Date(v.created_at).toLocaleString()}</span>
                      </div>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12, background: '#fff', padding: 10, borderRadius: 4, border: '1px solid #eee' }}>
                        {v.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
