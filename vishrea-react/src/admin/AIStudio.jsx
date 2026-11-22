import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

const SparkleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
  </svg>
);

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

  const charCount = (generatedContent || '').length;
  const wordCount = (generatedContent || '').trim() ? (generatedContent || '').trim().split(/\s+/).length : 0;

  return (
    <div className="ai-studio-shell">
      {/* Top Segmented Navigation Tabs */}
      <div className="ai-studio-tabs-bar">
        <div className="ai-studio-tab-group" role="tablist" aria-label="AI Studio Sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'generator'}
            className={`ai-studio-tab-pill ${activeTab === 'generator' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('generator')}
          >
            Content Tools
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'copilot'}
            className={`ai-studio-tab-pill ${activeTab === 'copilot' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('copilot')}
          >
            Admin Co-Pilot
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'drafts'}
            className={`ai-studio-tab-pill ${activeTab === 'drafts' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('drafts')}
          >
            Drafts & Versions
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a7d83', fontWeight: 600 }}>
            Editorial AI Atelier
          </span>
          <span className="badge badge-success" style={{ fontSize: 10 }}>
            Live Verified
          </span>
        </div>
      </div>

      {/* Global Notifications */}
      {message && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: message.type === 'error' ? '#fef2f2' : '#f0fdf4',
            color: message.type === 'error' ? '#991b1b' : '#166534',
            border: `1px solid ${message.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 16 }}
            aria-label="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: CONTENT GENERATOR */}
      {activeTab === 'generator' && (
        <div className="ai-studio-grid">
          {/* Left Column: Configuration & Controls */}
          <div className="ai-panel-card">
            <div className="ai-panel-head">
              <h2 className="ai-panel-title">1. Select Content Tool</h2>
              <span style={{ fontSize: 11, color: '#8c7e84', fontWeight: 500 }}>
                Tool {TOOLS.findIndex((t) => t.id === selectedTool) + 1} of 8
              </span>
            </div>

            {/* 8 Content Tools Grid */}
            <div className="ai-tools-grid">
              {TOOLS.map((t) => {
                const isSelected = selectedTool === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`ai-tool-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelectedTool(t.id)}
                  >
                    <div className="ai-tool-card-head">
                      <div className="ai-tool-icon">{t.icon}</div>
                      <strong className="ai-tool-name">{t.label}</strong>
                    </div>
                    <p className="ai-tool-desc">{t.desc}</p>
                  </button>
                );
              })}
            </div>

            <div className="ai-panel-head" style={{ marginTop: 24 }}>
              <h2 className="ai-panel-title">2. Context & Product Parameters</h2>
            </div>

            <div>
              {/* Product Selector */}
              <div className="ai-field">
                <label className="ai-label">
                  Attach Verified Catalogue Product (Optional)
                </label>
                <select
                  className="ai-select"
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
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
                <div className="ai-product-preview">
                  <div className="ai-product-thumb">
                    {selectedProduct.image_url || (Array.isArray(selectedProduct.images) && selectedProduct.images[0]) ? (
                      <img
                        src={selectedProduct.image_url || selectedProduct.images[0]}
                        alt={selectedProduct.name}
                      />
                    ) : (
                      <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 10, color: '#888', textAlign: 'center', padding: 4 }}>
                        No Photo
                      </div>
                    )}
                  </div>
                  <div className="ai-product-info">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--wine, #8b263e)', fontWeight: 600 }}>
                        Verified Catalogue Piece
                      </span>
                      <span className="ai-product-price">₹{selectedProduct.price_inr}</span>
                    </div>
                    <h4 className="ai-product-title">{selectedProduct.name}</h4>
                    <div className="ai-product-badges">
                      <span className="ai-product-badge">Category: {selectedProduct.category || 'Piece'}</span>
                      <span className="ai-product-badge">Color: {selectedProduct.color || 'Studio shade'}</span>
                      <span className="ai-product-badge">Fabric: {selectedProduct.material || 'Studio fabric'}</span>
                      <span className="ai-product-badge">Season: {selectedProduct.colour_season || 'All seasons'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Specific inputs depending on tool */}
              {selectedTool === 'customer_reply' ? (
                <>
                  <div className="ai-field">
                    <label className="ai-label">Customer Name</label>
                    <input
                      type="text"
                      className="ai-input"
                      placeholder="e.g. Priya Sharma"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </div>
                  <div className="ai-field">
                    <label className="ai-label">Customer Inquiry</label>
                    <textarea
                      rows={3}
                      className="ai-textarea"
                      placeholder="e.g. Does the wine slip dress fit true to size, and can it be expedited to Mumbai?"
                      value={inquiry}
                      onChange={(e) => setInquiry(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="ai-field">
                      <label className="ai-label">Tone</label>
                      <select className="ai-select" value={tone} onChange={(e) => setTone(e.target.value)}>
                        {TONES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>

                    <div className="ai-field">
                      <label className="ai-label">Target Platform</label>
                      <select className="ai-select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                        {PLATFORMS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="ai-field">
                    <label className="ai-label">Campaign / Collection Theme (Optional)</label>
                    <input
                      type="text"
                      className="ai-input"
                      placeholder="e.g. Autumn Equinox, Midnight Soirée, Festive Slow Fashion"
                      value={campaign}
                      onChange={(e) => setCampaign(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Primary Generate Button */}
              <button
                type="button"
                className="ai-generate-btn"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                <SparkleIcon />
                <span>{isGenerating ? 'Generating Studio Copy...' : generatedContent ? 'Regenerate Content' : 'Generate Content'}</span>
              </button>
            </div>
          </div>

          {/* Right Column: Output & Approval Canvas */}
          <div className="ai-panel-card">
            <div className="ai-panel-head">
              <h2 className="ai-panel-title">3. Output & Approval Workflow</h2>
              {currentDraftStatus && (
                <span className={`badge ${currentDraftStatus === 'published' ? 'badge-success' : currentDraftStatus === 'approved' ? 'badge-info' : 'badge-warn'}`}>
                  {currentDraftStatus.toUpperCase()}
                </span>
              )}
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--muted, #666)', lineHeight: 1.5 }}>
              All AI outputs remain drafts until explicitly approved and published by an administrator. You can refine and edit directly below.
            </p>

            <textarea
              className="ai-editor-canvas"
              rows={15}
              value={generatedContent}
              onChange={(e) => setGeneratedContent(e.target.value)}
              placeholder="Your generated content will appear here. Select a tool on the left, attach a product if desired, and click 'Generate Content'."
            />

            <div className="ai-editor-footer">
              <span>
                {lastProvider
                  ? `Engine: ${lastProvider === 'groq' ? 'Groq Cloud (qwen-3.8-27b)' : 'Primary AI Engine'}`
                  : 'Ready for generation'}
              </span>
              <span>
                {wordCount} {wordCount === 1 ? 'word' : 'words'} &bull; {charCount} chars
              </span>
            </div>

            {/* Action Bar */}
            <div className="ai-actions-bar">
              <button
                type="button"
                className="ai-btn-ghost"
                onClick={() => {
                  if (!generatedContent) return;
                  navigator.clipboard.writeText(generatedContent);
                  setMessage({ type: 'success', text: 'Content copied to clipboard.' });
                }}
                disabled={!generatedContent}
              >
                Copy Text
              </button>

              <button
                type="button"
                className="ai-btn-ghost"
                onClick={handleSaveDraft}
                disabled={!generatedContent}
              >
                Save Draft
              </button>

              <button
                type="button"
                className="ai-btn-approve"
                onClick={() => handleApprove()}
                disabled={!generatedContent}
              >
                Approve
              </button>

              {selectedTool === 'product_description' && selectedProductId && (
                <button
                  type="button"
                  className="ai-btn-publish"
                  onClick={() => handlePublish()}
                  disabled={!generatedContent || currentDraftStatus !== 'approved'}
                  title={currentDraftStatus !== 'approved' ? 'Approve before publishing' : 'Publish description to product catalogue'}
                >
                  Publish to Store
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CONVERSATIONAL CO-PILOT */}
      {activeTab === 'copilot' && (
        <div className="ai-panel-card" style={{ maxWidth: 960, margin: '0 auto', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'clamp(480px, 75dvh, 680px)' }}>
          {/* Chat Header */}
          <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--admin-line, #ebe6e1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontFamily: 'Georgia, serif', fontSize: 16 }}>Vishrea Studio Operational Assistant</strong>
              <small style={{ display: 'block', color: 'var(--muted, #666)', fontSize: 11, marginTop: 2 }}>
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
          <div style={{ padding: '10px 20px', background: '#faf8f5', borderBottom: '1px solid var(--admin-line, #ebe6e1)', display: 'flex', gap: 8, overflowX: 'auto' }}>
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
                    background: m.role === 'user' ? '#181417' : '#f5f2ee',
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
          <form onSubmit={handleSendChat} style={{ padding: '16px 20px', borderTop: '1px solid var(--admin-line, #ebe6e1)', display: 'flex', gap: 12 }}>
            <input
              type="text"
              className="ai-input"
              placeholder="Ask anything about catalogue copy, operational summaries, or marketing ideas..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={isChatLoading}
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              disabled={isChatLoading || !chatInput.trim()}
              className="btn primary"
              style={{ padding: '0 22px' }}
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: DRAFTS & VERSIONS */}
      {activeTab === 'drafts' && (
        <div className="ai-panel-card">
          <div className="ai-panel-head">
            <div>
              <h2 className="ai-panel-title">Saved Content Drafts & Versions</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted, #666)' }}>
                Track version revisions, review approval status, and deploy approved content to the store.
              </p>
            </div>
            <button
              type="button"
              className="btn"
              onClick={loadDrafts}
            >
              Refresh List
            </button>
          </div>

          {loadingDrafts ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 13 }}>Loading drafts...</div>
          ) : drafts.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', border: '1px dashed var(--admin-line, #ebe6e1)', borderRadius: 6 }}>
              <p style={{ margin: 0, color: 'var(--muted, #666)', fontSize: 13 }}>No saved drafts yet. Generate and click "Save Draft" in the Content Tools tab.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Product</th>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 500 }}>{d.title}</td>
                      <td style={{ color: 'var(--muted, #666)' }}>{d.content_type?.replace(/_/g, ' ')}</td>
                      <td>
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
                      <td>v{d.version}</td>
                      <td>
                        <span className={`badge ${d.status === 'published' ? 'badge-success' : d.status === 'approved' ? 'badge-info' : 'badge-warn'}`}>
                          {d.status}
                        </span>
                      </td>
                      <td style={{ color: '#888' }}>{new Date(d.updated_at).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="table-actions" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            type="button"
                            className="btn-action"
                            onClick={() => {
                              setSelectedTool(d.content_type);
                              setSelectedProductId(d.product_id || '');
                              setGeneratedContent(d.content);
                              setCurrentDraftId(d.id);
                              setCurrentDraftStatus(d.status);
                              setActiveTab('generator');
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-action"
                            onClick={() => handleViewVersions(d)}
                          >
                            History
                          </button>
                          {d.status !== 'approved' && d.status !== 'published' && (
                            <button
                              type="button"
                              className="btn-action"
                              style={{ color: '#8b263e', borderColor: '#f3c5d0' }}
                              onClick={() => handleApprove(d.id)}
                            >
                              Approve
                            </button>
                          )}
                          {d.status === 'approved' && d.product_id && (
                            <button
                              type="button"
                              className="btn-action"
                              style={{ color: '#166534', borderColor: '#86efac' }}
                              onClick={() => handlePublish(d.id)}
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
            <div className="modal is-visible" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setViewingVersions(null); }}>
              <div className="modal-content" style={{ maxWidth: 720 }}>
                <div className="panel-head">
                  <h2 style={{ fontSize: 16 }}>Version History: {viewingVersions.title}</h2>
                  <button type="button" onClick={() => setViewingVersions(null)} style={{ background: 'none', border: 0, fontSize: 18, cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
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
