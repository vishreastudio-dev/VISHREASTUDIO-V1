import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { InlineMessage } from './Status';

const FEATURES = [
  {
    key: 'skin-tone',
    eyebrow: 'Signature AI Technology',
    title: 'AI Skin Tone & Palette Engine',
    desc: 'Vishrea uses computer-vision AI to analyze your skin tone and undertone in natural light, curating garment colors that illuminate your complexion.',
    tag: 'Exclusive to Vishrea',
    actionText: 'Explore Colour Engine',
    actionLink: '/skin-tone',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 0 20Z" fill="currentColor" fillOpacity="0.2" />
        <path d="M12 6a6 6 0 0 1 0 12Z" />
      </svg>
    ),
    previewColors: ['#3b2219', '#633d2e', '#946343', '#c69573', '#e4bca1'],
  },
  {
    key: 'wardrobe',
    eyebrow: 'Private Haute Horlogerie',
    title: 'Your Private Wardrobe Vault',
    desc: 'Each 1-of-1 silhouette or reserved edit piece lives in your personal digital wardrobe vault. Access private styling records and track your curated garments.',
    tag: 'One-of-One Edits',
    actionText: 'Enter Private Wardrobe',
    actionLink: '/wardrobe',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
      </svg>
    ),
  },
  {
    key: 'wearers',
    eyebrow: 'Atelier Fit & Sizing',
    title: 'Precision Wearer Profiles',
    desc: 'Store exact anatomical measurements in centimetres for yourself and those you shop for. Every piece you select can be precision-tailored to your exact drape.',
    tag: 'Custom Silhouette',
    actionText: 'Setup Wearer Measurements',
    actionLink: '/account#wearers',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: 'membership',
    eyebrow: 'The Luxury Circle',
    title: 'Club Vishrea Membership',
    desc: 'Experience our monthly luxury subscription: 4 wardrobe credits every month, 48-hour early access to couture drops, complimentary studio pickups, and concierge styling.',
    tag: 'VIP Privileges',
    actionText: 'Discover Club Vishrea',
    actionLink: '/membership',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    key: 'style-assistant',
    eyebrow: '24/7 AI Concierge',
    title: 'AI Style Assistant',
    desc: 'Need styling advice, occasion pairings, or silhouette advice? Our intelligent styling assistant is always accessible in the bottom right corner.',
    tag: 'Personal Stylist',
    actionText: 'Start Browsing Catalogue',
    actionLink: '/catalogue',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
];

export function FirstTimeOnboardingModal() {
  const { user, completeProfile, completeOnboarding, fitPreferences } = useStore();
  const navigate = useNavigate();

  // If user is not logged in or is an admin, do not show
  if (!user || user.is_admin) return null;

  const needsProfile = !user.profile_completed;
  const needsTour = user.profile_completed && !user.onboarding_completed;

  if (!needsProfile && !needsTour) return null;

  return <OnboardingWizard user={user} needsProfile={needsProfile} completeProfile={completeProfile} completeOnboarding={completeOnboarding} navigate={navigate} fitPreferences={fitPreferences} />;
}

function OnboardingWizard({ user, needsProfile, completeProfile, completeOnboarding, navigate, fitPreferences = [] }) {
  const [stage, setStage] = useState(needsProfile ? 'profile' : 'tour');
  const [tourIndex, setTourIndex] = useState(0);

  // Profile Form state
  const [fullName, setFullName] = useState(user.name || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [ageConfirmed, setAgeConfirmed] = useState(true);
  const [preferredSilhouette, setPreferredSilhouette] = useState('Fluid & Relaxed');
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ tone: 'info', text: '' });

  // Size & Fit Profile state
  const [sizeStandard, setSizeStandard] = useState('India');
  const [clothingSize, setClothingSize] = useState('M');
  const [customSize, setCustomSize] = useState('');
  const [categorySizes, setCategorySizes] = useState({
    tops: 'M',
    dresses: 'M',
    skirts: 'M',
    pants: '30',
    jeans: '30',
    coord_sets: 'M',
  });
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [measurementUnit, setMeasurementUnit] = useState('cm');
  const [bust, setBust] = useState('');
  const [waist, setWaist] = useState('');
  const [hips, setHips] = useState('');
  const [shoulder, setShoulder] = useState('');
  const [inseam, setInseam] = useState('');
  const [height, setHeight] = useState('');
  const [fitPreference, setFitPreference] = useState('regular');

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setMsg({ tone: 'error', text: 'Please enter your full name.' });
      return;
    }
    let cleanPhone = phone.trim().replace(/[\s\-()]/g, '');
    if (cleanPhone.startsWith('+91')) cleanPhone = cleanPhone.slice(3);
    else if (cleanPhone.startsWith('91') && cleanPhone.length === 12) cleanPhone = cleanPhone.slice(2);
    else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) cleanPhone = cleanPhone.slice(1);

    if (!/^[6-9]\d{9}$/.test(cleanPhone) && !/^\+[1-9]\d{6,14}$/.test(cleanPhone)) {
      setMsg({ tone: 'error', text: 'Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.' });
      return;
    }
    if (!ageConfirmed) {
      setMsg({ tone: 'error', text: 'You must confirm that you are at least 18 years of age.' });
      return;
    }

    setSaving(true);
    setMsg({ tone: 'info', text: '' });
    try {
      await completeProfile({
        full_name: fullName.trim(),
        phone: cleanPhone,
        age_confirmed: true,
        whatsapp_opt_in: whatsappOptIn,
        preferred_silhouette: preferredSilhouette,
        size_standard: sizeStandard,
        clothing_size: clothingSize,
        custom_size: clothingSize === 'Custom' ? customSize : null,
        category_sizes: categorySizes,
        measurement_unit: measurementUnit,
        bust: bust || null,
        waist: waist || null,
        hips: hips || null,
        shoulder: shoulder || null,
        inseam: inseam || null,
        height: height || null,
        fit_preference: fitPreference,
      });
      setStage('tour');
    } catch (err) {
      setMsg({ tone: 'error', text: err.message || 'Could not save profile. Please check your inputs.' });
    } finally {
      setSaving(false);
    }
  };

  const currentFeature = FEATURES[tourIndex];

  const handleNextTour = () => {
    if (tourIndex < FEATURES.length - 1) {
      setTourIndex((i) => i + 1);
    } else {
      finishTour();
    }
  };

  const handlePrevTour = () => {
    if (tourIndex > 0) setTourIndex((i) => i - 1);
  };

  const finishTour = async (redirectPath) => {
    try {
      await completeOnboarding();
    } catch {}
    if (redirectPath) {
      navigate(redirectPath);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(26, 23, 25, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(8px, 2.5vw, 20px)',
        animation: 'fadeIn 0.3s ease-out',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        style={{
          width: 'min(620px, 100%)',
          maxHeight: 'min(92vh, 92dvh)',
          overflowY: 'auto',
          background: '#ffffff',
          borderRadius: 2,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          border: '1px solid var(--line, #e2dad5)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {stage === 'profile' ? (
          /* STAGE 1: MANDATORY PROFILE CREATION */
          <div style={{ padding: 'clamp(20px, 4.5vw, 44px)' }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--wine, #752238)',
                  fontWeight: 600,
                  display: 'inline-block',
                  marginBottom: 8,
                }}
              >
                Welcome to Vishrea Studio
              </span>
              <h2
                id="onboarding-title"
                style={{
                  fontFamily: 'Georgia, serif',
                  fontSize: 'clamp(26px, 4vw, 34px)',
                  fontWeight: 400,
                  margin: '4px 0 10px',
                  color: '#1a1719',
                }}
              >
                Complete Your Profile
              </h2>
              <p style={{ color: 'var(--muted, #666)', fontSize: 13, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>
                To unlock private curated pieces, tailored sizing, and secure order delivery, please finalize your details below.
              </p>
            </div>

            <form onSubmit={handleProfileSubmit} style={{ display: 'grid', gap: 18 }} noValidate>
              <div>
                <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6, color: '#333' }}>
                  Full Name <span style={{ color: 'var(--wine, #752238)' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  placeholder="e.g. Aanya Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '13px 14px',
                    border: '1px solid var(--line, #dcd4ce)',
                    fontSize: 15,
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6, color: '#333' }}>
                  Mobile Number <span style={{ color: 'var(--wine, #752238)' }}>*</span>
                </label>
                <input
                  type="tel"
                  required
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '13px 14px',
                    border: '1px solid var(--line, #dcd4ce)',
                    fontSize: 15,
                    fontFamily: 'inherit',
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--muted, #777)', marginTop: 4, display: 'block' }}>
                  Required for courier dispatch updates and WhatsApp concierge notifications.
                </span>
              </div>

              {/* YOUR SIZE & FIT PROFILE */}
              <div style={{ borderTop: '1px solid var(--line, #e2dcd7)', paddingTop: 18, marginTop: 4 }}>
                <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--wine, #752238)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Your Size & Fit Profile
                </span>
                <p style={{ fontSize: 12, color: 'var(--muted, #666)', margin: '0 0 14px', lineHeight: 1.5 }}>
                  Vishrea curates collections matching your exact sizing so you only see pieces that fit.
                </p>

                {/* Region Standard & General Size */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4, color: '#333' }}>
                      Size Standard
                    </label>
                    <select
                      value={sizeStandard}
                      onChange={(e) => setSizeStandard(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 13, fontFamily: 'inherit' }}
                    >
                      <option value="India">India (Standard)</option>
                      <option value="UK">UK Sizing</option>
                      <option value="US">US Sizing</option>
                      <option value="EU">EU Sizing</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4, color: '#333' }}>
                      Primary Clothing Size
                    </label>
                    <select
                      value={clothingSize}
                      onChange={(e) => {
                        const s = e.target.value;
                        setClothingSize(s);
                        if (s !== 'Custom') {
                          setCategorySizes((prev) => ({
                            ...prev,
                            tops: s,
                            dresses: s,
                            skirts: s,
                            coord_sets: s,
                          }));
                        }
                      }}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 13, fontFamily: 'inherit' }}
                    >
                      <option value="XS">XS (Extra Small)</option>
                      <option value="S">S (Small)</option>
                      <option value="M">M (Medium)</option>
                      <option value="L">L (Large)</option>
                      <option value="XL">XL (Extra Large)</option>
                      <option value="XXL">XXL (2X Large)</option>
                      <option value="Custom">Custom / Other</option>
                    </select>
                  </div>
                </div>

                {clothingSize === 'Custom' && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4, color: '#333' }}>
                      Specify Custom Size
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Petite M or 38B"
                      value={customSize}
                      onChange={(e) => setCustomSize(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line, #dcd4ce)', fontSize: 13, fontFamily: 'inherit' }}
                    />
                  </div>
                )}

                {/* Category-Specific Sizing */}
                <div style={{ background: '#faf8f6', border: '1px solid var(--line, #e8e2dd)', padding: '12px 14px', borderRadius: 2, marginBottom: 14 }}>
                  <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, color: '#1a1719' }}>
                    Category-Specific Sizes
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted, #666)', display: 'block', marginBottom: 2 }}>Tops</label>
                      <select
                        value={categorySizes.tops}
                        onChange={(e) => setCategorySizes({ ...categorySizes, tops: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 12, fontFamily: 'inherit' }}
                      >
                        {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted, #666)', display: 'block', marginBottom: 2 }}>Dresses</label>
                      <select
                        value={categorySizes.dresses}
                        onChange={(e) => setCategorySizes({ ...categorySizes, dresses: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 12, fontFamily: 'inherit' }}
                      >
                        {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted, #666)', display: 'block', marginBottom: 2 }}>Pants / Trousers</label>
                      <select
                        value={categorySizes.pants}
                        onChange={(e) => setCategorySizes({ ...categorySizes, pants: e.target.value, jeans: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 12, fontFamily: 'inherit' }}
                      >
                        {['26', '28', '30', '32', '34', '36', 'XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted, #666)', display: 'block', marginBottom: 2 }}>Skirts</label>
                      <select
                        value={categorySizes.skirts}
                        onChange={(e) => setCategorySizes({ ...categorySizes, skirts: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 12, fontFamily: 'inherit' }}
                      >
                        {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted, #666)', display: 'block', marginBottom: 2 }}>Co-ord Sets</label>
                      <select
                        value={categorySizes.coord_sets}
                        onChange={(e) => setCategorySizes({ ...categorySizes, coord_sets: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 12, fontFamily: 'inherit' }}
                      >
                        {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Fit Preference */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6, color: '#333' }}>
                    Fit Preference
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(Math.max((fitPreferences || []).filter(o => o.active !== false).length || 4, 2), 4)}, 1fr)`, gap: 8 }}>
                    {((fitPreferences && fitPreferences.length ? fitPreferences.filter(o => o.active !== false) : [
                      { id: 'relaxed', label: 'Relaxed' },
                      { id: 'regular', label: 'Regular' },
                      { id: 'slim', label: 'Slim' },
                      { id: 'oversized', label: 'Oversized' },
                    ])).map((fp) => (
                      <button
                        key={fp.id}
                        type="button"
                        onClick={() => setFitPreference(fp.id)}
                        title={fp.description || fp.label}
                        style={{
                          padding: '8px 4px',
                          border: `1px solid ${fitPreference === fp.id ? 'var(--wine, #752238)' : 'var(--line, #dcd4ce)'}`,
                          background: fitPreference === fp.id ? '#fbf5f6' : '#fff',
                          color: fitPreference === fp.id ? 'var(--wine, #752238)' : '#333',
                          fontWeight: fitPreference === fp.id ? 600 : 400,
                          fontSize: 11.5,
                          textTransform: 'capitalize',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          borderRadius: 2,
                        }}
                      >
                        {fp.label || fp.id}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Body Measurements Toggle */}
                <div style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() => setShowMeasurements((v) => !v)}
                    style={{
                      background: 'transparent',
                      border: 0,
                      padding: 0,
                      color: 'var(--wine, #752238)',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{showMeasurements ? '− Hide optional measurements' : '+ Add precise body measurements (Optional)'}</span>
                  </button>

                  {showMeasurements && (
                    <div style={{ background: '#fdfbf9', border: '1px solid var(--line, #e2dcd7)', padding: 14, marginTop: 8, borderRadius: 2 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, color: 'var(--muted, #666)' }}>Used to verify tailored fits & recommendations</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {['cm', 'inches'].map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => setMeasurementUnit(u)}
                              style={{
                                padding: '2px 8px',
                                border: `1px solid ${measurementUnit === u ? 'var(--wine, #752238)' : 'var(--line, #dcd4ce)'}`,
                                background: measurementUnit === u ? '#752238' : '#fff',
                                color: measurementUnit === u ? '#fff' : '#444',
                                fontSize: 10,
                                cursor: 'pointer',
                              }}
                            >
                              {u}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Bust</label>
                          <input type="number" step="0.5" placeholder={measurementUnit === 'cm' ? '88' : '34.5'} value={bust} onChange={(e) => setBust(e.target.value)} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Waist</label>
                          <input type="number" step="0.5" placeholder={measurementUnit === 'cm' ? '72' : '28'} value={waist} onChange={(e) => setWaist(e.target.value)} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Hips</label>
                          <input type="number" step="0.5" placeholder={measurementUnit === 'cm' ? '96' : '38'} value={hips} onChange={(e) => setHips(e.target.value)} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Shoulder</label>
                          <input type="number" step="0.5" placeholder={measurementUnit === 'cm' ? '38' : '15'} value={shoulder} onChange={(e) => setShoulder(e.target.value)} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Inseam</label>
                          <input type="number" step="0.5" placeholder={measurementUnit === 'cm' ? '76' : '30'} value={inseam} onChange={(e) => setInseam(e.target.value)} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Height</label>
                          <input type="number" step="0.5" placeholder={measurementUnit === 'cm' ? '165' : '65'} value={height} onChange={(e) => setHeight(e.target.value)} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6, color: '#333' }}>
                  Preferred Silhouette & Fit Style
                </label>
                <select
                  value={preferredSilhouette}
                  onChange={(e) => setPreferredSilhouette(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    border: '1px solid var(--line, #dcd4ce)',
                    fontSize: 14,
                    background: '#fff',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="Fluid & Relaxed">Fluid & Relaxed (Draped Silhouettes)</option>
                  <option value="Tailored & Architectural">Tailored & Architectural (Structured Lines)</option>
                  <option value="Contoured & Sculpted">Contoured & Sculpted (Fitted Eveningwear)</option>
                  <option value="Minimalist Contemporary">Minimalist Contemporary (Clean Essentials)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#333', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={whatsappOptIn}
                    onChange={(e) => setWhatsappOptIn(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--wine, #752238)' }}
                  />
                  Receive delivery alerts & styling updates on WhatsApp
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#333', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={ageConfirmed}
                    onChange={(e) => setAgeConfirmed(e.target.checked)}
                    required
                    style={{ width: 16, height: 16, accentColor: 'var(--wine, #752238)' }}
                  />
                  I confirm that I am at least 18 years of age <span style={{ color: 'var(--wine, #752238)' }}>*</span>
                </label>
              </div>

              <InlineMessage id="onboarding-msg" tone={msg.tone}>{msg.text}</InlineMessage>

              <button
                type="submit"
                disabled={saving || !fullName.trim() || !phone.trim() || !ageConfirmed}
                className="button button-dark"
                style={{
                  padding: '16px',
                  fontSize: 12,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  marginTop: 6,
                }}
              >
                {saving ? 'Creating Profile…' : 'Complete Profile & Explore Features →'}
              </button>
            </form>
          </div>
        ) : (
          /* STAGE 2: FIRST-TIME FEATURE EXPLORATION / NAVIGATION FLOW */
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Header with step pill */}
            <div
              style={{
                padding: 'clamp(16px, 4vw, 24px) clamp(16px, 4vw, 32px) clamp(12px, 3vw, 18px)',
                borderBottom: '1px solid var(--line, #eee)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: 10.5,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'var(--wine, #752238)',
                    fontWeight: 600,
                  }}
                >
                  Vishrea Exploration Guide &bull; Step {tourIndex + 1} of {FEATURES.length}
                </span>
                <h3
                  id="onboarding-title"
                  style={{
                    fontFamily: 'Georgia, serif',
                    fontSize: 22,
                    fontWeight: 400,
                    margin: '4px 0 0',
                    color: '#1a1719',
                  }}
                >
                  {currentFeature.title}
                </h3>
              </div>
              <span
                style={{
                  background: 'var(--cream, #f7f3ee)',
                  color: '#634b3e',
                  fontSize: 11,
                  padding: '5px 12px',
                  borderRadius: 20,
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                }}
              >
                {currentFeature.tag}
              </span>
            </div>

            {/* Feature Content Card */}
            <div style={{ padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 32px) 24px' }}>
              <div
                style={{
                  background: 'linear-gradient(135deg, #fcfaf8 0%, #f6f1eb 100%)',
                  border: '1px solid #e7ded5',
                  padding: 'clamp(16px, 4vw, 28px)',
                  borderRadius: 4,
                  marginBottom: 24,
                  display: 'flex',
                  gap: 'clamp(12px, 3vw, 20px)',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: '#ffffff',
                    border: '1px solid #dfd6cd',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--wine, #752238)',
                    flexShrink: 0,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                  }}
                >
                  {currentFeature.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.14em',
                      color: 'var(--wine, #752238)',
                      margin: '0 0 6px',
                      fontWeight: 600,
                    }}
                  >
                    {currentFeature.eyebrow}
                  </p>
                  <p style={{ fontSize: 14.5, lineHeight: 1.65, color: '#332f31', margin: 0 }}>
                    {currentFeature.desc}
                  </p>

                  {currentFeature.previewColors && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 14, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#777', marginRight: 4 }}>Example Palette:</span>
                      {currentFeature.previewColors.map((hex, i) => (
                        <span
                          key={i}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            backgroundColor: hex,
                            border: '1px solid rgba(0,0,0,0.1)',
                            display: 'inline-block',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Dots */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
                {FEATURES.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setTourIndex(i)}
                    aria-label={`Jump to step ${i + 1}`}
                    style={{
                      width: i === tourIndex ? 28 : 8,
                      height: 8,
                      borderRadius: 4,
                      background: i === tourIndex ? 'var(--wine, #752238)' : '#dfd7d0',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      transition: 'all 0.25s ease',
                    }}
                  />
                ))}
              </div>

              {/* Navigation Controls */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {tourIndex > 0 && (
                    <button
                      type="button"
                      className="button button-outline"
                      onClick={handlePrevTour}
                      style={{ padding: '12px 18px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}
                    >
                      &larr; Previous
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => finishTour('/catalogue')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted, #777)',
                      fontSize: 12,
                      textDecoration: 'underline',
                      padding: '12px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    Skip Tour
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => finishTour(currentFeature.actionLink)}
                    style={{
                      padding: '12px 20px',
                      fontSize: 11,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      borderColor: 'var(--wine, #752238)',
                      color: 'var(--wine, #752238)',
                    }}
                  >
                    {currentFeature.actionText} &rarr;
                  </button>
                  <button
                    type="button"
                    className="button button-dark"
                    onClick={handleNextTour}
                    style={{ padding: '12px 22px', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}
                  >
                    {tourIndex < FEATURES.length - 1 ? 'Next Feature' : 'Finish & Shop'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
