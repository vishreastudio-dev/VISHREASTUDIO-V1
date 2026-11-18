import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { InlineMessage } from './Status';

const DEFAULT_PROFILE_FORM = {
  id: null,
  name: '',
  relationship: 'friend',
  is_primary: false,
  size_standard: 'India',
  clothing_size: 'M',
  custom_size: '',
  category_sizes: {
    tops: 'M',
    dresses: 'M',
    skirts: 'M',
    pants: '30',
    jeans: '30',
    coord_sets: 'M',
  },
  bust: '',
  waist: '',
  hips: '',
  shoulder: '',
  inseam: '',
  height: '',
  measurement_unit: 'cm',
  fit_preference: 'regular',
  silhouette_preference: 'Fluid & Relaxed',
};

export function SizeProfilesSection() {
  const {
    sizeProfiles,
    activeSizeProfile,
    fitPreferences,
    switchActiveProfile,
    saveSizeProfile,
    deleteSizeProfile,
  } = useStore();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(DEFAULT_PROFILE_FORM);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const [saving, setSaving] = useState(false);

  const startCreate = () => {
    setForm({
      ...DEFAULT_PROFILE_FORM,
      name: '',
      relationship: 'friend',
      is_primary: false,
    });
    setShowMeasurements(false);
    setMsg({ tone: 'info', text: '' });
    setEditing('new');
  };

  const startEdit = (p) => {
    setForm({
      id: p.id,
      name: p.name || '',
      relationship: p.relationship || 'friend',
      is_primary: Boolean(p.is_primary),
      size_standard: p.size_standard || 'India',
      clothing_size: p.clothing_size || 'M',
      custom_size: p.custom_size || '',
      category_sizes: {
        tops: p.category_sizes?.tops || p.clothing_size || 'M',
        dresses: p.category_sizes?.dresses || p.clothing_size || 'M',
        skirts: p.category_sizes?.skirts || p.clothing_size || 'M',
        pants: p.category_sizes?.pants || '30',
        jeans: p.category_sizes?.jeans || '30',
        coord_sets: p.category_sizes?.coord_sets || p.clothing_size || 'M',
      },
      bust: p.bust ?? '',
      waist: p.waist ?? '',
      hips: p.hips ?? '',
      shoulder: p.shoulder ?? '',
      inseam: p.inseam ?? '',
      height: p.height ?? '',
      measurement_unit: p.measurement_unit || 'cm',
      fit_preference: p.fit_preference || 'regular',
      silhouette_preference: p.silhouette_preference || 'Fluid & Relaxed',
    });
    setShowMeasurements(Boolean(p.bust || p.waist || p.hips));
    setMsg({ tone: 'info', text: '' });
    setEditing(p.id);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setMsg({ tone: 'error', text: 'Please enter a name for this size profile.' });
      return;
    }

    setSaving(true);
    setMsg({ tone: 'info', text: '' });
    try {
      await saveSizeProfile({
        ...form,
        name: form.name.trim(),
        custom_size: form.clothing_size === 'Custom' ? form.custom_size : null,
      });
      setMsg({ tone: 'success', text: `Size profile "${form.name}" saved.` });
      setEditing(null);
    } catch (err) {
      setMsg({ tone: 'error', text: err.message || 'Could not save profile' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p) => {
    if (p.is_primary) {
      alert('Your primary profile cannot be deleted.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete "${p.name}"?`)) return;
    try {
      await deleteSizeProfile(p.id);
      setMsg({ tone: 'success', text: `Profile "${p.name}" deleted.` });
      if (editing === p.id) setEditing(null);
    } catch (err) {
      setMsg({ tone: 'error', text: err.message || 'Could not delete profile' });
    }
  };

  const profilesList = Array.isArray(sizeProfiles) ? sizeProfiles : [];
  const primaryProfile = profilesList.find((p) => p.is_primary) || profilesList[0] || null;
  const additionalProfiles = primaryProfile ? profilesList.filter((p) => p.id !== primaryProfile.id) : [];

  return (
    <div className="account-panel" id="size-profiles">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 22, margin: '0 0 6px', fontWeight: 400 }}>
            My Size Profiles
          </h2>
          <p style={{ color: 'var(--muted, #666)', fontSize: 13, margin: 0 }}>
            Curate collections by clothing size. Create separate profiles to shop for friends & family.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            className="button button-outline"
            style={{ fontSize: 11, padding: '8px 16px', letterSpacing: '0.08em', textTransform: 'uppercase' }}
            onClick={startCreate}
          >
            + Add Shopping Profile
          </button>
        )}
      </div>

      <InlineMessage id="size-profiles-msg" tone={msg.tone}>{msg.text}</InlineMessage>

      {/* EDIT / CREATE FORM MODAL OR INLINE CARD */}
      {editing && (
        <form
          onSubmit={handleSave}
          style={{
            background: '#faf8f6',
            border: '1px solid var(--line, #e2dcd7)',
            padding: '24px',
            marginBottom: 24,
            display: 'grid',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 18, margin: 0, fontWeight: 400 }}>
              {editing === 'new' ? 'New Size Profile' : `Edit: ${form.name}`}
            </h3>
            <button
              type="button"
              className="text-link"
              onClick={() => setEditing(null)}
              style={{ fontSize: 12 }}
            >
              Cancel
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                Profile Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Sister, Aanya, Friend"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line, #dcd4ce)', fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                Relationship
              </label>
              <select
                value={form.relationship}
                onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 13 }}
              >
                <option value="self">Self (My Wardrobe)</option>
                <option value="friend">Friend</option>
                <option value="sister">Sister</option>
                <option value="mother">Mother</option>
                <option value="partner">Partner</option>
                <option value="family">Family</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                Region Sizing Standard
              </label>
              <select
                value={form.size_standard}
                onChange={(e) => setForm({ ...form, size_standard: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 13 }}
              >
                <option value="India">India (Standard)</option>
                <option value="UK">UK Sizing</option>
                <option value="US">US Sizing</option>
                <option value="EU">EU Sizing</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                General Clothing Size
              </label>
              <select
                value={form.clothing_size}
                onChange={(e) => {
                  const s = e.target.value;
                  setForm({
                    ...form,
                    clothing_size: s,
                    ...(s !== 'Custom' ? {
                      category_sizes: {
                        ...form.category_sizes,
                        tops: s,
                        dresses: s,
                        skirts: s,
                        coord_sets: s,
                      }
                    } : {})
                  });
                }}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line, #dcd4ce)', background: '#fff', fontSize: 13 }}
              >
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
                <option value="XXL">XXL</option>
                <option value="Custom">Custom / Other</option>
              </select>
            </div>
          </div>

          {form.clothing_size === 'Custom' && (
            <div>
              <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                Custom Size Details
              </label>
              <input
                type="text"
                placeholder="e.g. 38B or Petite Medium"
                value={form.custom_size}
                onChange={(e) => setForm({ ...form, custom_size: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line, #dcd4ce)', fontSize: 13 }}
              />
            </div>
          )}

          {/* Category-Specific Sizing */}
          <div style={{ background: '#fff', border: '1px solid var(--line, #e2dcd7)', padding: 14 }}>
            <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
              Category-Specific Sizes
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
              <div>
                <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Tops</label>
                <select
                  value={form.category_sizes?.tops || 'M'}
                  onChange={(e) => setForm({ ...form, category_sizes: { ...form.category_sizes, tops: e.target.value } })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #dcd4ce', fontSize: 12 }}
                >
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Dresses</label>
                <select
                  value={form.category_sizes?.dresses || 'M'}
                  onChange={(e) => setForm({ ...form, category_sizes: { ...form.category_sizes, dresses: e.target.value } })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #dcd4ce', fontSize: 12 }}
                >
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Pants / Trousers</label>
                <select
                  value={form.category_sizes?.pants || '30'}
                  onChange={(e) => setForm({ ...form, category_sizes: { ...form.category_sizes, pants: e.target.value, jeans: e.target.value } })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #dcd4ce', fontSize: 12 }}
                >
                  {['26', '28', '30', '32', '34', '36', 'XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Skirts</label>
                <select
                  value={form.category_sizes?.skirts || 'M'}
                  onChange={(e) => setForm({ ...form, category_sizes: { ...form.category_sizes, skirts: e.target.value } })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #dcd4ce', fontSize: 12 }}
                >
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Co-ord Sets</label>
                <select
                  value={form.category_sizes?.coord_sets || 'M'}
                  onChange={(e) => setForm({ ...form, category_sizes: { ...form.category_sizes, coord_sets: e.target.value } })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #dcd4ce', fontSize: 12 }}
                >
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Fit preference */}
          <div>
            <label style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
              Fit Preference
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(Math.max((fitPreferences || []).filter(o => o.active !== false).length || 4, 2), 4)}, 1fr)`, gap: 8 }}>
              {(() => {
                const baseList = (fitPreferences && fitPreferences.length ? fitPreferences.filter(o => o.active !== false) : [
                  { id: 'relaxed', label: 'Relaxed' },
                  { id: 'regular', label: 'Regular' },
                  { id: 'slim', label: 'Slim' },
                  { id: 'oversized', label: 'Oversized' },
                ]);
                if (form.fit_preference && !baseList.some(o => o.id === form.fit_preference)) {
                  baseList.push({
                    id: form.fit_preference,
                    label: form.fit_preference.charAt(0).toUpperCase() + form.fit_preference.slice(1) + ' (Saved)',
                  });
                }
                return baseList.map((fp) => (
                  <button
                    key={fp.id}
                    type="button"
                    onClick={() => setForm({ ...form, fit_preference: fp.id })}
                    title={fp.description || fp.label}
                    style={{
                      padding: '8px 4px',
                      border: `1px solid ${form.fit_preference === fp.id ? 'var(--wine, #752238)' : 'var(--line, #dcd4ce)'}`,
                      background: form.fit_preference === fp.id ? '#fbf5f6' : '#fff',
                      color: form.fit_preference === fp.id ? 'var(--wine, #752238)' : '#333',
                      fontWeight: form.fit_preference === fp.id ? 600 : 400,
                      fontSize: 11.5,
                      textTransform: 'capitalize',
                      cursor: 'pointer',
                    }}
                  >
                    {fp.label || fp.id}
                  </button>
                ));
              })()}
            </div>
          </div>

          {/* Optional measurements */}
          <div>
            <button
              type="button"
              onClick={() => setShowMeasurements((v) => !v)}
              style={{ background: 'transparent', border: 0, padding: 0, color: 'var(--wine, #752238)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {showMeasurements ? 'Hide body measurements' : '+ Add body measurements (Optional)'}
            </button>
            {showMeasurements && (
              <div style={{ background: '#fff', border: '1px solid var(--line, #e2dcd7)', padding: 14, marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: '#666' }}>Used to verify custom drape</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['cm', 'inches'].map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setForm({ ...form, measurement_unit: u })}
                        style={{
                          padding: '2px 8px',
                          border: `1px solid ${form.measurement_unit === u ? 'var(--wine, #752238)' : '#ccc'}`,
                          background: form.measurement_unit === u ? '#752238' : '#fff',
                          color: form.measurement_unit === u ? '#fff' : '#333',
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
                    <input type="number" step="0.5" placeholder="Bust" value={form.bust} onChange={(e) => setForm({ ...form, bust: e.target.value })} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Waist</label>
                    <input type="number" step="0.5" placeholder="Waist" value={form.waist} onChange={(e) => setForm({ ...form, waist: e.target.value })} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Hips</label>
                    <input type="number" step="0.5" placeholder="Hips" value={form.hips} onChange={(e) => setForm({ ...form, hips: e.target.value })} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Shoulder</label>
                    <input type="number" step="0.5" placeholder="Shoulder" value={form.shoulder} onChange={(e) => setForm({ ...form, shoulder: e.target.value })} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Inseam</label>
                    <input type="number" step="0.5" placeholder="Inseam" value={form.inseam} onChange={(e) => setForm({ ...form, inseam: e.target.value })} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#666', display: 'block', marginBottom: 2 }}>Height</label>
                    <input type="number" step="0.5" placeholder="Height" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} style={{ width: '100%', padding: '6px', fontSize: 12, border: '1px solid #dcd4ce' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button className="button button-dark" disabled={saving}>
              {saving ? 'Saving Profile…' : 'Save Size Profile'}
            </button>
            <button type="button" className="button button-outline" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* PROFILES LIST */}
      <div style={{ display: 'grid', gap: 16 }}>
        {/* PRIMARY PROFILE (MY WARDROBE) */}
        {primaryProfile && (
          <div
            style={{
              border: `1px solid ${activeSizeProfile?.id === primaryProfile.id ? 'var(--wine, #752238)' : 'var(--line, #e2dcd7)'}`,
              background: activeSizeProfile?.id === primaryProfile.id ? '#fcf9f8' : '#ffffff',
              padding: '20px 24px',
              borderRadius: 2,
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 19, margin: 0, fontWeight: 400 }}>
                    {primaryProfile.name}
                  </h3>
                  <span style={{ fontSize: 9, letterSpacing: '0.12em', background: 'var(--cream, #f7f4f0)', color: 'var(--ink, #1a1719)', border: '1px solid var(--line, #e2dcd7)', padding: '2px 6px', fontWeight: 600 }}>
                    PRIMARY PROFILE
                  </span>
                  {activeSizeProfile?.id === primaryProfile.id && (
                    <span style={{ fontSize: 9, letterSpacing: '0.12em', background: 'var(--wine, #752238)', color: '#fff', padding: '2px 6px', fontWeight: 600 }}>
                      ACTIVE FOR SHOPPING
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#444', marginTop: 8 }}>
                  <span><b>Standard:</b> {primaryProfile.size_standard}</span>
                  <span style={{ color: 'var(--muted, #999)' }}>·</span>
                  <span><b>Tops:</b> {primaryProfile.clothing_size}</span>
                  <span style={{ color: 'var(--muted, #999)' }}>·</span>
                  <span><b>Dresses:</b> {primaryProfile.category_sizes?.dresses || primaryProfile.clothing_size}</span>
                  <span style={{ color: 'var(--muted, #999)' }}>·</span>
                  <span><b>Pants:</b> {primaryProfile.category_sizes?.pants || '30'}</span>
                  <span style={{ color: 'var(--muted, #999)' }}>·</span>
                  <span><b>Fit:</b> {primaryProfile.fit_preference || 'Regular'}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {activeSizeProfile?.id !== primaryProfile.id && (
                  <button
                    type="button"
                    className="button button-outline"
                    style={{ fontSize: 11, padding: '7px 14px', letterSpacing: '0.06em', textTransform: 'uppercase' }}
                    onClick={() => switchActiveProfile(primaryProfile.id)}
                  >
                    Shop With This Size
                  </button>
                )}
                <button
                  type="button"
                  className="button button-outline"
                  style={{ fontSize: 11, padding: '7px 14px', letterSpacing: '0.06em', textTransform: 'uppercase' }}
                  onClick={() => startEdit(primaryProfile)}
                >
                  Edit Sizes
                </button>
              </div>
            </div>
          </div>
        )}

        {!primaryProfile && !editing && (
          <div style={{ padding: '28px 20px', textAlign: 'center', background: '#faf8f5', border: '1px dashed #dcd4ce' }}>
            <p style={{ color: 'var(--muted, #666)', fontSize: 13, margin: '0 0 12px' }}>No size profile found yet.</p>
            <button type="button" className="button button-dark" onClick={startCreate} style={{ fontSize: 11, padding: '8px 16px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Create My Size Profile
            </button>
          </div>
        )}

        {/* ADDITIONAL PROFILES */}
        {additionalProfiles.length > 0 && (
          <div>
            <h4 style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted, #777)', margin: '18px 0 10px' }}>
              Shop for Someone Else ({additionalProfiles.length})
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              {additionalProfiles.map((p) => {
                const isActive = activeSizeProfile?.id === p.id;
                return (
                  <div
                    key={p.id}
                    style={{
                      border: `1px solid ${isActive ? 'var(--wine, #752238)' : 'var(--line, #e2dcd7)'}`,
                      background: isActive ? '#fcf9f8' : '#ffffff',
                      padding: '16px 18px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <strong style={{ fontSize: 15, fontFamily: 'Georgia, serif' }}>{p.name}</strong>
                        {isActive ? (
                          <span style={{ fontSize: 8.5, background: 'var(--wine, #752238)', color: '#fff', padding: '2px 6px', fontWeight: 600 }}>ACTIVE</span>
                        ) : (
                          <span style={{ fontSize: 9, background: '#f0ebe6', color: '#666', padding: '1px 6px', textTransform: 'capitalize' }}>{p.relationship}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#555', lineHeight: 1.6 }}>
                        <div><b>Tops:</b> {p.clothing_size} · <b>Dresses:</b> {p.category_sizes?.dresses || p.clothing_size}</div>
                        <div><b>Pants:</b> {p.category_sizes?.pants || '30'} · <b>Fit:</b> {p.fit_preference || 'Regular'}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--line, #eee)', paddingTop: 10 }}>
                      {!isActive && (
                        <button
                          type="button"
                          className="button button-dark"
                          style={{ fontSize: 10, padding: '5px 10px', flex: 1 }}
                          onClick={() => switchActiveProfile(p.id)}
                        >
                          Shop With Profile
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-outline"
                        style={{ fontSize: 10, padding: '5px 10px' }}
                        onClick={() => startEdit(p)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button-outline"
                        style={{ fontSize: 10, padding: '5px 10px', color: '#9a2d2d' }}
                        onClick={() => handleDelete(p)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
