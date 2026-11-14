// Admin → Homepage → Hero carousel. Slides are edited as drafts and previewed with the same
// HeroCarousel component the homepage uses; publishing is a separate, explicit step. Every rule is
// enforced again on the server (/api/admin/homepage-carousel), which requires an admin session.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { api, uploadWithProgress } from '../lib/api';
import { ErrorState, LoadingState } from '../components/Status';
import { HeroCarousel } from '../components/HeroCarousel';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SLIDE,
  HERO_FONTS,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  SETTINGS_SPEC,
  SLIDE_SPEC,
  TEXT_LIMITS,
  ctaLink,
  imageProblem,
  naturalRatios,
  normalizeSlide,
  publishProblems,
} from '../lib/heroCarousel';

const ENDPOINT = '/api/admin/homepage-carousel';
const act = (action, body) => api(ENDPOINT, { method: 'POST', body: { action, ...body } });
const clone = (v) => JSON.parse(JSON.stringify(v));
const setIn = (obj, [k, ...rest], value) => ({ ...obj, [k]: rest.length ? setIn(obj?.[k] ?? {}, rest, value) : value });
const dt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const DEVICES = { desktop: { label: 'Desktop', width: 1280 }, tablet: { label: 'Tablet', width: 834 }, mobile: { label: 'Mobile', width: 390 } };
const LAYOUTS = [['full', 'Full-width banner'], ['split_image_right', 'Split: text left, image right'], ['split_image_left', 'Split: image left, text right']];

/** Plain explanation of what the chosen fit does with this banner. */
function fitNote(slide) {
  const fit = slide.image_settings.fit;
  if (fit === 'cover') return 'Fills the carousel height and crops the edges that do not fit. Click the banner, or use the focal point sliders, to choose what stays in view.';
  if (fit === 'contain') return 'The whole banner is shown inside the carousel height; any space around it uses the background colour.';
  const r = naturalRatios(slide);
  if (!r) return 'The slide takes the banner’s own proportions once a banner is uploaded, so nothing is cropped.';
  const tall = (w) => Math.round(w / r.slide);
  return `Nothing is cropped: the slide takes the banner’s proportions (${tall(1440)} px tall on a 1440 px screen, ${tall(834)} px on a tablet).${
    slide.mobile_image ? ' Phones show the mobile banner at its own proportions.' : ' On phones the whole banner is shown with the text below it; upload a mobile banner to put text over the image.'
  }`;
}

/** datetime-local value (local time) ⇄ ISO string. */
const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

function statusOf(entry) {
  if (entry.publication_status !== 'published') return { tone: 'warn', label: 'Draft' };
  const p = entry.published || {};
  const now = Date.now();
  if (!entry.is_active) return { tone: 'bad', label: 'Published · inactive' };
  if (p.starts_at && Date.parse(p.starts_at) > now) return { tone: 'warn', label: `Scheduled from ${dt(p.starts_at)}` };
  if (p.ends_at && Date.parse(p.ends_at) <= now) return { tone: 'bad', label: `Ended ${dt(p.ends_at)}` };
  return { tone: 'good', label: 'Live' };
}

// ---- Small controls ----------------------------------------------------------------------

function Range({ label, value, rule, step = 1, unit = '', onChange }) {
  const id = useId();
  return (
    <div className="hce-field">
      <label htmlFor={id}>
        {label} <output htmlFor={id}>{value}{unit}</output>
      </label>
      <input id={id} type="range" min={rule.min} max={rule.max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function ColorField({ label, value, onChange, allowTransparent = false }) {
  const id = useId();
  const transparent = value === 'transparent';
  return (
    <div className="hce-field">
      <label htmlFor={id}>{label}</label>
      <div className="hce-color">
        <input id={id} type="color" value={transparent ? '#ffffff' : value} disabled={transparent} onChange={(e) => onChange(e.target.value)} />
        <input
          aria-label={`${label} (hex)`}
          value={transparent ? 'none' : value}
          disabled={transparent}
          maxLength={7}
          onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onChange(e.target.value.toLowerCase())}
        />
        {allowTransparent && (
          <label className="hce-inline">
            <input type="checkbox" checked={transparent} onChange={(e) => onChange(e.target.checked ? 'transparent' : '#ffffff')} /> None
          </label>
        )}
      </div>
    </div>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="hce-field">
      <span className="hce-label">{label}</span>
      <div className="hce-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 3×3 visual position control. */
function PositionPad({ label, value, onChange }) {
  const xs = ['left', 'center', 'right'];
  const ys = ['top', 'middle', 'bottom'];
  return (
    <div className="hce-field">
      <span className="hce-label">{label}</span>
      <div className="hce-pad" role="radiogroup" aria-label={label}>
        {ys.map((y) =>
          xs.map((x) => {
            const on = value.x === x && value.y === y;
            return (
              <button key={`${x}-${y}`} type="button" role="radio" aria-checked={on} aria-label={`${y} ${x}`} className={on ? 'is-on' : ''} onClick={() => onChange({ ...value, x, y })}>
                <span />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function TextInput({ label, value, max, onChange, error, multiline = false, placeholder }) {
  const id = useId();
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className={`hce-field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label} <small>{value.length}/{max}</small>
      </label>
      <Tag id={id} value={value} maxLength={max} rows={multiline ? 3 : undefined} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} />
      {error && <small className="hce-error">{error}</small>}
    </div>
  );
}

function Group({ title, children, defaultOpen = false }) {
  return (
    <details className="hce-group" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="hce-group-body">{children}</div>
    </details>
  );
}

function TextStyleEditor({ value, spec, onChange }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <>
      <div className="hce-field">
        <label>
          Font
          <select value={value.font} onChange={(e) => set('font')(e.target.value)}>
            {Object.entries(HERO_FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
        </label>
      </div>
      <div className="hce-row">
        <Range label="Size (desktop)" value={value.size} rule={spec.size} unit="px" onChange={set('size')} />
        <Range label="Size (mobile)" value={value.mobile_size} rule={spec.mobile_size} unit="px" onChange={set('mobile_size')} />
      </div>
      <div className="hce-row">
        <div className="hce-field">
          <label>
            Weight
            <select value={value.weight} onChange={(e) => set('weight')(Number(e.target.value))}>
              {spec.weight.opts.map((w) => <option key={w} value={w}>{{ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi-bold', 700: 'Bold' }[w]} ({w})</option>)}
            </select>
          </label>
        </div>
        <ColorField label="Colour" value={value.color} onChange={set('color')} />
      </div>
      <div className="hce-row">
        <label className="hce-inline"><input type="checkbox" checked={value.italic} onChange={(e) => set('italic')(e.target.checked)} /> Italic</label>
        <label className="hce-inline"><input type="checkbox" checked={value.uppercase} onChange={(e) => set('uppercase')(e.target.checked)} /> Capitals</label>
      </div>
      <Segmented label="Alignment" value={value.align} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={set('align')} />
      <div className="hce-row">
        <Range label="Line height" value={value.line_height} rule={spec.line_height} step={0.01} onChange={set('line_height')} />
        <Range label="Letter spacing" value={value.letter_spacing} rule={spec.letter_spacing} step={0.005} unit="em" onChange={set('letter_spacing')} />
      </div>
    </>
  );
}

function CtaEditor({ value, onChange, destinations, errors, prefix }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  const link = ctaLink(value.url);
  const known = destinations.some(([href]) => href === value.url);
  return (
    <>
      <label className="hce-inline"><input type="checkbox" checked={value.visible} onChange={(e) => set('visible')(e.target.checked)} /> Show this button</label>
      <TextInput label="Button label" value={value.label} max={TEXT_LIMITS.cta_label} onChange={set('label')} error={errors[`${prefix}.label`]} placeholder="EXPLORE SWEATERS" />
      <div className={`hce-field${errors[`${prefix}.url`] ? ' has-error' : ''}`}>
        <label>
          Destination
          <select value={known ? value.url : ''} onChange={(e) => e.target.value && set('url')(e.target.value)}>
            <option value="">Custom address…</option>
            {destinations.map(([href, text]) => <option key={href} value={href}>{text}</option>)}
          </select>
        </label>
        <input aria-label="Destination address" value={value.url} maxLength={TEXT_LIMITS.cta_url} placeholder="/catalogue/sweaters or https://…" onChange={(e) => set('url')(e.target.value)} />
        <small className={value.url && !link ? 'hce-error' : ''}>
          {!value.url ? 'A page on this site (starting with /) or an http(s):// address.' : link ? (link.internal ? 'Opens a page on this site.' : 'Opens an external website.') : 'Not a valid destination.'}
        </small>
        {errors[`${prefix}.url`] && <small className="hce-error">{errors[`${prefix}.url`]}</small>}
      </div>
      <label className="hce-inline"><input type="checkbox" checked={value.new_tab} onChange={(e) => set('new_tab')(e.target.checked)} /> Open in a new tab</label>
      <Segmented label="Size" value={value.size} options={[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]} onChange={set('size')} />
      <div className="hce-row">
        <ColorField label="Background" value={value.bg} allowTransparent onChange={set('bg')} />
        <ColorField label="Text" value={value.color} onChange={set('color')} />
      </div>
      <div className="hce-row">
        <ColorField label="Border" value={value.border} allowTransparent onChange={set('border')} />
        <Range label="Border width" value={value.border_width} rule={SLIDE_SPEC.primary_cta.border_width} unit="px" onChange={set('border_width')} />
      </div>
      <div className="hce-row">
        <Range label="Corner radius" value={value.radius} rule={SLIDE_SPEC.primary_cta.radius} unit="px" onChange={set('radius')} />
        <label className="hce-inline"><input type="checkbox" checked={value.uppercase} onChange={(e) => set('uppercase')(e.target.checked)} /> Capitals</label>
      </div>
      <div style={{ marginTop: 12, padding: '12px 14px', background: '#f9f8f6', border: '1px solid #e5dfd8', borderRadius: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1719', display: 'block', marginBottom: 8 }}>
          Manual Button Movement &amp; Placement
        </span>
        <div className="hce-row">
          <Range
            label="Horizontal Position (X)"
            value={value.offset_x || 0}
            rule={SLIDE_SPEC.primary_cta.offset_x}
            unit="px"
            onChange={set('offset_x')}
          />
          <Range
            label="Vertical Position (Y)"
            value={value.offset_y || 0}
            rule={SLIDE_SPEC.primary_cta.offset_y}
            unit="px"
            onChange={set('offset_y')}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#777', marginRight: 4 }}>Nudge:</span>
          <button
            type="button"
            className="btn"
            style={{ padding: '3px 8px', fontSize: 11 }}
            title="Move left 5px"
            onClick={() => set('offset_x')(Math.max(-250, (Number(value.offset_x) || 0) - 5))}
          >
            &larr; Left 5px
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: '3px 8px', fontSize: 11 }}
            title="Move right 5px"
            onClick={() => set('offset_x')(Math.min(250, (Number(value.offset_x) || 0) + 5))}
          >
            &rarr; Right 5px
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: '3px 8px', fontSize: 11 }}
            title="Move up 5px"
            onClick={() => set('offset_y')(Math.max(-250, (Number(value.offset_y) || 0) - 5))}
          >
            &uarr; Up 5px
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: '3px 8px', fontSize: 11 }}
            title="Move down 5px"
            onClick={() => set('offset_y')(Math.min(250, (Number(value.offset_y) || 0) + 5))}
          >
            &darr; Down 5px
          </button>
          {((value.offset_x && value.offset_x !== 0) || (value.offset_y && value.offset_y !== 0)) && (
            <button
              type="button"
              className="btn"
              style={{ padding: '3px 8px', fontSize: 10, color: 'var(--wine, #752238)' }}
              onClick={() => {
                set('offset_x')(0);
                set('offset_y')(0);
              }}
            >
              Reset (0,0)
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ---- Image upload ------------------------------------------------------------------------

const readSize = (file) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

function ImageUploader({ kind, layout, value, focal, onFocal, onChange, error, toast }) {
  const [progress, setProgress] = useState(null);
  const [problem, setProblem] = useState(null);
  const inputRef = useRef(null);
  const currentProblem = value ? imageProblem(kind, layout, value.width, value.height) : null;
  const pick = async (file) => {
    if (!file) return;
    setProblem(null);
    if (!IMAGE_TYPES.includes(file.type)) return setProblem('Choose a JPG, PNG or WEBP image.');
    if (file.size > IMAGE_MAX_BYTES) return setProblem(`The image is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${IMAGE_MAX_BYTES / 1048576} MB. Export it smaller and try again.`);
    const size = await readSize(file);
    const bad = size ? imageProblem(kind, layout, size.width, size.height) : 'This file could not be opened as an image.';
    if (bad) return setProblem(bad);
    setProgress(0);
    try {
      const r = await uploadWithProgress(file, setProgress, { purpose: 'banner' });
      onChange({ url: r.ref, width: r.width || size.width, height: r.height || size.height });
      toast(`${kind === 'mobile' ? 'Mobile' : 'Desktop'} banner uploaded. Save the slide to keep it.`);
    } catch (err) {
      setProblem(err.message || 'The upload failed. Try again.');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  // Clicking the thumbnail sets the focal point that stays visible when the image is cropped.
  const setFocal = (e) => {
    if (!onFocal) return;
    const r = e.currentTarget.getBoundingClientRect();
    onFocal(Math.round(((e.clientX - r.left) / r.width) * 100), Math.round(((e.clientY - r.top) / r.height) * 100));
  };
  return (
    <div className={`hce-upload${error || problem ? ' has-error' : ''}`}>
      {value ? (
        <button type="button" className="hce-thumb" onClick={setFocal} title="Click the most important part of the picture to keep it in view when cropped">
          <img src={value.url} alt="" />
          {focal && <span className="hce-focal" style={{ left: `${focal[0]}%`, top: `${focal[1]}%` }} aria-hidden="true" />}
        </button>
      ) : (
        <div className="hce-thumb is-empty">{kind === 'mobile' ? 'No mobile banner: the desktop banner is used' : 'No banner yet'}</div>
      )}
      <div className="hce-upload-actions">
        <label className="btn">
          {value ? 'Replace image' : 'Upload image'}
          <input ref={inputRef} type="file" accept={IMAGE_TYPES.join(',')} hidden disabled={progress !== null} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {value && <button type="button" className="btn" onClick={() => onChange(null)}>Remove</button>}
      </div>
      {progress !== null && (
        <div className="hce-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Upload progress">
          <span style={{ width: `${progress}%` }} />
          <small>Uploading… {progress}%</small>
        </div>
      )}
      {value && <small>{value.width} × {value.height} px{onFocal ? ' · click the image to set its focal point' : ''}</small>}
      {(problem || error || currentProblem) && <small className="hce-error">{problem || error || currentProblem}</small>}
    </div>
  );
}

// ---- Preview -----------------------------------------------------------------------------

/** HeroCarousel rendered at a real device width and scaled down to fit the panel. */
function DevicePreview({ slides, settings, device, toast }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });
  const width = DEVICES[device].width;
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const scale = Math.min(1, outer.current.clientWidth / width);
      setBox({ scale, height: inner.current.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={outer} className="hce-device" style={{ height: box.height || undefined }}>
      <div ref={inner} className="hce-device-frame" style={{ width, transform: `scale(${box.scale})` }}>
        <HeroCarousel
          key={`${device}-${settings.transition_type}`}
          slides={slides}
          settings={settings}
          device={device}
          label="Preview"
          onPreviewLink={(href) => toast(`Preview only: this button goes to ${href}`)}
        />
      </div>
    </div>
  );
}

function PreviewPane({ slides, settings, toast, note }) {
  const [device, setDevice] = useState('desktop');
  return (
    <div className="hce-preview">
      <div className="hce-preview-bar">
        <strong>Live preview</strong>
        <div className="hce-seg" role="radiogroup" aria-label="Preview device">
          {Object.entries(DEVICES).map(([k, d]) => (
            <button key={k} type="button" role="radio" aria-checked={device === k} className={device === k ? 'is-on' : ''} onClick={() => setDevice(k)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {slides.length ? <DevicePreview slides={slides} settings={settings} device={device} toast={toast} /> : <p className="empty">No slides to preview.</p>}
      {note && <small className="hce-note">{note}</small>}
    </div>
  );
}

// ---- Slide editor ------------------------------------------------------------------------

function SlideEditor({ entry, data, onClose, onSaved, toast }) {
  const [slide, setSlide] = useState(() => clone(entry ? entry.slide : { ...DEFAULT_SLIDE }));
  const [initial] = useState(() => JSON.stringify(entry ? entry.slide : DEFAULT_SLIDE));
  const [version, setVersion] = useState(entry?.version);
  const [id, setId] = useState(entry?.id || null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(slide) !== initial;
  const set = (path) => (v) => setSlide((s) => setIn(s, path, v));
  const preview = normalizeSlide(slide).slide;
  const pending = publishProblems(preview);
  const destinations = [
    ['/catalogue', 'Shop all'],
    ...data.categories.map((c) => [`/catalogue/${c.slug}`, `Category: ${c.name}`]),
    ['/membership', 'Membership'],
    ['/gifting', 'Gifting'],
    ['/skin-tone', 'Find your colours'],
    ['/contact', 'Help & contact'],
  ];

  const close = useCallback(() => {
    if (dirty && !window.confirm('Discard your unsaved changes to this slide?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const save = async (publish) => {
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      let r;
      if (id) r = await act('update', { id, slide, version, publish });
      else {
        r = await act('create', { slide });
        if (publish) r = await act('publish', { id: r.result.id, version: r.result.version });
      }
      const saved = r.result;
      setId(saved.id);
      setVersion(saved.version);
      toast(publish ? 'Slide published. The homepage shows it on the next visit.' : 'Draft saved. The homepage is unchanged until you publish.');
      onSaved();
      onClose();
    } catch (err) {
      if (err.details?.fields) setErrors(err.details.fields);
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const o = slide.overlay;
  const im = slide.image_settings;
  return (
    <div className="hce" role="dialog" aria-modal="true" aria-label={id ? 'Edit slide' : 'New slide'}>
      <header className="hce-head">
        <div>
          <h2>{id ? `Edit slide${slide.heading ? `: ${slide.heading}` : ''}` : 'New slide'}</h2>
          <small>
            {entry?.publication_status === 'published' ? 'Published. Save draft keeps the live version unchanged until you publish again.' : 'Draft. Not visible on the homepage until published.'}
            {dirty && ' · Unsaved changes'}
          </small>
        </div>
        <div className="hce-head-actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>Close</button>
          <button type="button" className="btn" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
          <button type="button" className="btn primary" onClick={() => save(true)} disabled={busy || Object.keys(pending).length > 0} title={Object.values(pending)[0] || 'Save and show on the homepage'}>
            {entry?.publication_status === 'published' ? 'Save & publish' : 'Publish'}
          </button>
        </div>
      </header>
      {Object.keys(errors).length > 0 && (
        <div className="hce-alert" role="alert">
          {Object.values(errors).map((m) => <div key={m}>{m}</div>)}
        </div>
      )}
      <div className="hce-body">
        <div className="hce-form">
          <Group title="Banner image" defaultOpen>
            <Segmented label="Layout" value={slide.layout_type} options={LAYOUTS} onChange={set(['layout_type'])} />
            <span className="hce-label">Desktop banner</span>
            <ImageUploader
              kind="desktop"
              layout={slide.layout_type}
              value={slide.desktop_image}
              error={errors.desktop_image}
              focal={[im.focal_x, im.focal_y]}
              onFocal={(x, y) => setSlide((s) => setIn(setIn(s, ['image_settings', 'focal_x'], x), ['image_settings', 'focal_y'], y))}
              onChange={set(['desktop_image'])}
              toast={toast}
            />
            <span className="hce-label">Mobile banner (optional)</span>
            <ImageUploader
              kind="mobile"
              layout={slide.layout_type}
              value={slide.mobile_image}
              error={errors.mobile_image}
              focal={slide.mobile_image ? [im.mobile_focal_x, im.mobile_focal_y] : null}
              onFocal={slide.mobile_image ? (x, y) => setSlide((s) => setIn(setIn(s, ['image_settings', 'mobile_focal_x'], x), ['image_settings', 'mobile_focal_y'], y)) : null}
              onChange={set(['mobile_image'])}
              toast={toast}
            />
            <TextInput label="Image description (alt text)" value={slide.image_alt} max={TEXT_LIMITS.image_alt} onChange={set(['image_alt'])} error={errors.image_alt || pending.image_alt} placeholder="Model in a green embroidered sweater" />
            <Segmented
              label="Image fit"
              value={im.fit}
              options={[['natural', 'Natural proportions'], ['contain', 'Whole image in set height'], ['cover', 'Fill set height (crop)']]}
              onChange={set(['image_settings', 'fit'])}
            />
            <small className="hce-note">{fitNote(preview)}</small>
            <div className="hce-row">
              <Range label="Focal point (horizontal)" value={im.focal_x} rule={SLIDE_SPEC.image_settings.focal_x} unit="%" onChange={set(['image_settings', 'focal_x'])} />
              <Range label="Focal point (vertical)" value={im.focal_y} rule={SLIDE_SPEC.image_settings.focal_y} unit="%" onChange={set(['image_settings', 'focal_y'])} />
            </div>
            <div className="hce-row">
              <Range label="Mobile focal (horizontal)" value={im.mobile_focal_x} rule={SLIDE_SPEC.image_settings.mobile_focal_x} unit="%" onChange={set(['image_settings', 'mobile_focal_x'])} />
              <Range label="Mobile focal (vertical)" value={im.mobile_focal_y} rule={SLIDE_SPEC.image_settings.mobile_focal_y} unit="%" onChange={set(['image_settings', 'mobile_focal_y'])} />
            </div>
            <ColorField label={slide.layout_type === 'full' ? 'Background colour (behind the image)' : 'Text panel colour'} value={im.background} onChange={set(['image_settings', 'background'])} />
          </Group>

          <Group title="Text content" defaultOpen>
            <Segmented label="Display" value={slide.display_mode} options={[['overlay', 'Text and buttons over the image'], ['image_only', 'Image only (finished banner)']]} onChange={set(['display_mode'])} />
            {slide.display_mode === 'image_only' && <small className="hce-note">All text and buttons are hidden but kept, so you can switch back without retyping.</small>}
            <label className="hce-inline"><input type="checkbox" checked={slide.visibility.heading} onChange={(e) => set(['visibility', 'heading'])(e.target.checked)} /> Show heading</label>
            <TextInput label="Heading" value={slide.heading} max={TEXT_LIMITS.heading} onChange={set(['heading'])} error={errors.heading} placeholder="Cozy Layers for Every Mood" />
            <label className="hce-inline"><input type="checkbox" checked={slide.visibility.subtitle} onChange={(e) => set(['visibility', 'subtitle'])(e.target.checked)} /> Show subtitle</label>
            <TextInput label="Subtitle" value={slide.subtitle} max={TEXT_LIMITS.subtitle} onChange={set(['subtitle'])} error={errors.subtitle} />
            <label className="hce-inline"><input type="checkbox" checked={slide.visibility.description} onChange={(e) => set(['visibility', 'description'])(e.target.checked)} /> Show description</label>
            <TextInput label="Description" value={slide.description} max={TEXT_LIMITS.description} multiline onChange={set(['description'])} error={errors.description} />
          </Group>

          <Group title="Heading style">
            <TextStyleEditor value={slide.heading_style} spec={SLIDE_SPEC.heading_style} onChange={set(['heading_style'])} />
          </Group>
          <Group title="Subtitle style">
            <TextStyleEditor value={slide.subtitle_style} spec={SLIDE_SPEC.subtitle_style} onChange={set(['subtitle_style'])} />
          </Group>
          <Group title="Description style">
            <TextStyleEditor value={slide.description_style} spec={SLIDE_SPEC.description_style} onChange={set(['description_style'])} />
          </Group>

          <Group title="Text position and spacing">
            <div className="hce-row">
              <PositionPad label="Desktop and tablet" value={o.desktop} onChange={set(['overlay', 'desktop'])} />
              <PositionPad label="Mobile" value={o.mobile} onChange={set(['overlay', 'mobile'])} />
            </div>
            <div className="hce-row">
              <Range label="Text width (desktop)" value={o.desktop.max_width} rule={SLIDE_SPEC.overlay.desktop.max_width} unit="%" onChange={set(['overlay', 'desktop', 'max_width'])} />
              <Range label="Text width (mobile)" value={o.mobile.max_width} rule={SLIDE_SPEC.overlay.mobile.max_width} unit="%" onChange={set(['overlay', 'mobile', 'max_width'])} />
            </div>
            <div className="hce-row">
              <Range label="Side margin (desktop)" value={o.desktop.inset_x} rule={SLIDE_SPEC.overlay.desktop.inset_x} unit="%" onChange={set(['overlay', 'desktop', 'inset_x'])} />
              <Range label="Side margin (mobile)" value={o.mobile.inset_x} rule={SLIDE_SPEC.overlay.mobile.inset_x} unit="%" onChange={set(['overlay', 'mobile', 'inset_x'])} />
            </div>
            <div className="hce-row">
              <Range label="Top/bottom margin (desktop)" value={o.desktop.inset_y} rule={SLIDE_SPEC.overlay.desktop.inset_y} unit="%" onChange={set(['overlay', 'desktop', 'inset_y'])} />
              <Range label="Top/bottom margin (mobile)" value={o.mobile.inset_y} rule={SLIDE_SPEC.overlay.mobile.inset_y} unit="%" onChange={set(['overlay', 'mobile', 'inset_y'])} />
            </div>
            <Range label="Space between lines of text" value={o.gap} rule={SLIDE_SPEC.overlay.gap} unit="px" onChange={set(['overlay', 'gap'])} />
            <Segmented label="Legibility backdrop" value={o.panel} options={[['none', 'None'], ['gradient', 'Soft gradient'], ['card', 'Card behind text']]} onChange={set(['overlay', 'panel'])} />
            {o.panel !== 'none' && (
              <div className="hce-row">
                <ColorField label="Backdrop colour" value={o.panel_color} onChange={set(['overlay', 'panel_color'])} />
                <Range label="Backdrop strength" value={o.panel_opacity} rule={SLIDE_SPEC.overlay.panel_opacity} unit="%" onChange={set(['overlay', 'panel_opacity'])} />
              </div>
            )}
          </Group>

          <Group title="Primary button">
            <CtaEditor value={slide.primary_cta} onChange={set(['primary_cta'])} destinations={destinations} errors={{ ...pending, ...errors }} prefix="primary_cta" />
          </Group>
          <Group title="Secondary button (optional)">
            <CtaEditor value={slide.secondary_cta} onChange={set(['secondary_cta'])} destinations={destinations} errors={{ ...pending, ...errors }} prefix="secondary_cta" />
          </Group>

          <Group title="Schedule">
            <div className="hce-row">
              <div className="hce-field">
                <label>
                  Show from
                  <input type="datetime-local" value={toLocal(slide.starts_at)} onChange={(e) => set(['starts_at'])(fromLocal(e.target.value))} />
                </label>
              </div>
              <div className={`hce-field${errors.ends_at || pending.ends_at ? ' has-error' : ''}`}>
                <label>
                  Show until
                  <input type="datetime-local" value={toLocal(slide.ends_at)} onChange={(e) => set(['ends_at'])(fromLocal(e.target.value))} />
                </label>
                {(errors.ends_at || pending.ends_at) && <small className="hce-error">{errors.ends_at || pending.ends_at}</small>}
              </div>
            </div>
            <small className="hce-note">Leave both empty to show the slide whenever it is published and active. Schedule changes take effect when you publish.</small>
          </Group>
        </div>
        <PreviewPane
          slides={[{ ...preview, id: id || 'draft' }]}
          settings={{ ...data.settings, autoplay_enabled: false }}
          toast={toast}
          note={Object.keys(pending).length ? `Before publishing: ${Object.values(pending).join(' ')}` : 'Ready to publish.'}
        />
      </div>
    </div>
  );
}

// ---- Settings ----------------------------------------------------------------------------

function SettingsPanel({ data, onSaved, toast }) {
  const [s, setS] = useState(() => ({ ...DEFAULT_SETTINGS, ...data.settings }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setS((cur) => ({ ...cur, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify({ ...DEFAULT_SETTINGS, ...data.settings });
  const previewSlides = data.slides.filter((e) => e.is_active && e.slide.desktop_image).map((e) => ({ ...e.slide, id: e.id }));
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await act('settings', { settings: s });
      toast('Carousel settings saved. They apply to the homepage straight away.');
      onSaved();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (k, label) => <label className="hce-inline"><input type="checkbox" checked={s[k]} onChange={(e) => set(k)(e.target.checked)} /> {label}</label>;
  return (
    <div className="hce-body is-settings">
      <div className="hce-form">
        <div className="hce-group-body">
          {toggle('is_enabled', 'Show the carousel on the homepage (when off, the original hero is shown)')}
          {toggle('autoplay_enabled', 'Move to the next slide automatically')}
          <Range label="Time on each slide" value={s.autoplay_interval / 1000} rule={{ min: SETTINGS_SPEC.autoplay_interval.min / 1000, max: SETTINGS_SPEC.autoplay_interval.max / 1000 }} step={0.5} unit=" s" onChange={(v) => set('autoplay_interval')(Math.round(v * 1000))} />
          {toggle('pause_on_hover', 'Pause while the pointer is over the carousel')}
          <Segmented label="Transition" value={s.transition_type} options={[['fade', 'Fade'], ['slide', 'Slide with parallax']]} onChange={set('transition_type')} />
          <Range label="Transition speed" value={s.transition_duration} rule={SETTINGS_SPEC.transition_duration} step={50} unit=" ms" onChange={set('transition_duration')} />
          {toggle('show_navigation', 'Show previous / next arrows')}
          {toggle('show_pagination', 'Show slide indicators')}
          <div className="hce-row">
            <Range label="Height (desktop)" value={s.desktop_height} rule={SETTINGS_SPEC.desktop_height} step={10} unit="px" onChange={set('desktop_height')} />
            <Range label="Height (mobile)" value={s.mobile_height} rule={SETTINGS_SPEC.mobile_height} step={10} unit="px" onChange={set('mobile_height')} />
          </div>
          <small className="hce-note">The heights apply to slides set to “Whole image in set height” or “Fill set height”. Slides with natural proportions follow their banner’s shape. Visitors who prefer reduced motion never see automatic movement; everyone can pause it.</small>
          <div className="actions">
            <button type="button" className="btn" disabled={!dirty || busy} onClick={() => setS({ ...DEFAULT_SETTINGS, ...data.settings })}>Undo changes</button>
            <button type="button" className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>
          </div>
        </div>
      </div>
      <PreviewPane slides={previewSlides} settings={s} toast={toast} note="Preview of all active slides with a banner, using their latest drafts." />
    </div>
  );
}

// ---- Section -----------------------------------------------------------------------------

export function HomepageSection({ toast }) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tab, setTab] = useState('slides');
  const [editing, setEditing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(null);
  const dragId = useRef(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await api(ENDPOINT), loading: false, error: null });
      setOrder(null);
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!previewing) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPreviewing(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewing]);

  const run = async (fn, ok) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
      await load();
    }
  };

  const { data, loading, error } = state;
  if (loading && !data) return <section className="panel"><LoadingState /></section>;
  if (error && !data) return <section className="panel"><ErrorState error={error} onRetry={load} /></section>;

  const slides = order ? order.map((id) => data.slides.find((s) => s.id === id)).filter(Boolean) : data.slides;
  const commitOrder = (ids) => {
    setOrder(ids);
    run(() => act('reorder', { ids }), 'Order saved. The homepage uses the new order.');
  };
  const move = (from, to) => {
    if (to < 0 || to >= slides.length || from === to) return;
    const ids = slides.map((s) => s.id);
    const [m] = ids.splice(from, 1);
    ids.splice(to, 0, m);
    commitOrder(ids);
  };
  const remove = (e) => {
    const published = e.publication_status === 'published';
    const msg = published
      ? `“${e.slide.heading || 'Untitled slide'}” is published${e.live ? ' and showing on the homepage now' : ''}.\n\nDelete it permanently? It disappears from the homepage immediately. This cannot be undone.`
      : `Delete the draft “${e.slide.heading || 'Untitled slide'}”? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    run(() => api(`${ENDPOINT}?id=${encodeURIComponent(e.id)}${published ? '&confirm=true' : ''}`, { method: 'DELETE' }), 'Slide deleted');
  };
  const live = data.slides.filter((e) => e.live).length;
  const full = data.slides.length >= data.limits.max_slides;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Homepage · Hero carousel</h2>
          <p>
            Banner slides at the top of the homepage. Text and buttons are edited here and drawn over the image, so you never need to re-upload a banner to change its words.{' '}
            {data.settings.is_enabled ? (live ? `${live} slide${live === 1 ? ' is' : 's are'} live now.` : 'No slide is live, so the homepage shows its original hero.') : 'The carousel is switched off, so the homepage shows its original hero.'}
          </p>
        </div>
        <div className="actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <a className="btn" href="/" target="_blank" rel="noopener noreferrer">
            View Homepage
          </a>
          <button type="button" className="btn primary" disabled={full} title={full ? `At most ${data.limits.max_slides} slides` : undefined} onClick={() => setEditing({ entry: null })}>
            + Add Slide
          </button>
        </div>
      </div>
      <div className="hce-seg hce-tabs" role="tablist" aria-label="Carousel">
        <button type="button" role="tab" aria-selected={tab === 'slides'} className={tab === 'slides' ? 'is-on' : ''} onClick={() => setTab('slides')}>Slides</button>
        <button type="button" role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'is-on' : ''} onClick={() => setTab('settings')}>Carousel settings</button>
      </div>

      {tab === 'settings' ? (
        <SettingsPanel key={JSON.stringify(data.settings)} data={data} onSaved={load} toast={toast} />
      ) : (
        <div className="table-wrap">
          <table className="table hce-list">
            <thead>
              <tr>
                <th style={{ width: 36 }} aria-label="Drag to reorder" />
                <th style={{ width: 80 }}>Order</th>
                <th style={{ width: 140 }}>Banner</th>
                <th>Slide</th>
                <th style={{ width: 140 }}>Status</th>
                <th style={{ minWidth: 480, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!slides.length && <tr><td colSpan="6" className="empty">No slides yet. Add a slide and upload its banner.</td></tr>}
              {slides.map((e, i) => {
                const st = statusOf(e);
                const problems = Object.values(e.problems);
                return (
                  <tr
                    key={e.id}
                    draggable={!busy}
                    onDragStart={(ev) => {
                      dragId.current = e.id;
                      ev.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(ev) => ev.preventDefault()}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      const from = slides.findIndex((s) => s.id === dragId.current);
                      dragId.current = null;
                      move(from, i);
                    }}
                    className={e.is_active ? '' : 'is-muted'}
                  >
                    <td className="hce-grip" title="Drag to reorder" aria-hidden="true">
                      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style={{ opacity: 0.45, display: 'inline-block', verticalAlign: 'middle' }}>
                        <circle cx="2.5" cy="2" r="1.5" />
                        <circle cx="7.5" cy="2" r="1.5" />
                        <circle cx="2.5" cy="7" r="1.5" />
                        <circle cx="7.5" cy="7" r="1.5" />
                        <circle cx="2.5" cy="12" r="1.5" />
                        <circle cx="7.5" cy="12" r="1.5" />
                      </svg>
                    </td>
                    <td>
                      <div className="hce-order">
                        <span style={{ fontWeight: 600, minWidth: 18, textAlign: 'center' }}>{i + 1}</span>
                        <button type="button" className="btn" disabled={busy || i === 0} onClick={() => move(i, i - 1)} aria-label={`Move slide ${i + 1} up`} title="Move up">↑</button>
                        <button type="button" className="btn" disabled={busy || i === slides.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move slide ${i + 1} down`} title="Move down">↓</button>
                      </div>
                    </td>
                    <td>
                      {e.slide.desktop_image ? <img className="hce-list-thumb" src={e.slide.desktop_image.url} alt="" loading="lazy" /> : <span className="hce-list-thumb is-empty">No banner</span>}
                    </td>
                    <td>
                      <strong>{e.slide.heading || (e.slide.display_mode === 'image_only' ? 'Image-only banner' : 'Untitled slide')}</strong>
                      <small style={{ display: 'block', color: 'var(--muted)' }}>
                        {LAYOUTS.find(([k]) => k === e.slide.layout_type)?.[1]}
                        {e.slide.display_mode === 'image_only' ? ' · image only' : ''}
                        {e.slide.primary_cta.visible && e.slide.primary_cta.label ? ` · ${e.slide.primary_cta.label} → ${e.slide.primary_cta.url}` : ''}
                      </small>
                      {problems.length > 0 && <small className="hce-error" style={{ display: 'block' }}>To publish: {problems[0]}</small>}
                    </td>
                    <td>
                      <span className={`status ${st.tone}`}>{st.label}</span>
                      {e.has_unpublished_changes && <small style={{ display: 'block', color: '#8a5a00' }}>Unpublished changes</small>}
                      {e.publication_status === 'draft' && !e.is_active && <small style={{ display: 'block', color: 'var(--muted)' }}>Inactive</small>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div className="hce-row-actions">
                        <button type="button" className="btn primary" disabled={busy} onClick={() => setEditing({ entry: e })} title="Edit slide layout, text & positioning">
                          Edit
                        </button>
                        <button type="button" className="btn" disabled={busy} onClick={() => setPreviewing(e)} title="Preview slide">
                          Preview
                        </button>
                        {e.publication_status === 'published' ? (
                          <button type="button" className="btn" disabled={busy} onClick={() => run(() => act('unpublish', { id: e.id }), 'Slide unpublished. It is now a draft.')} title="Move back to draft">
                            Unpublish
                          </button>
                        ) : (
                          <button type="button" className="btn" disabled={busy || problems.length > 0} title={problems[0] || 'Publish to live carousel'} onClick={() => run(() => act('publish', { id: e.id, version: e.version }), 'Slide published')}>
                            Publish
                          </button>
                        )}
                        <button type="button" className="btn" disabled={busy} onClick={() => run(() => act('activate', { id: e.id, is_active: !e.is_active }), e.is_active ? 'Slide deactivated' : 'Slide activated')} title={e.is_active ? 'Deactivate slide' : 'Activate slide'}>
                          {e.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button type="button" className="btn" disabled={busy || full} onClick={() => run(() => act('duplicate', { id: e.id }), 'Slide duplicated as a draft')} title="Duplicate as a new draft">
                          Duplicate
                        </button>
                        <button type="button" className="btn hce-danger" disabled={busy} onClick={() => remove(e)} title="Delete slide">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {slides.length > 1 && <small className="hce-note">Drag rows, or use the arrows, to change the order. The new order applies to the homepage immediately.</small>}
        </div>
      )}

      {editing && <SlideEditor key={editing.entry?.id || 'new'} entry={editing.entry} data={data} onClose={() => setEditing(null)} onSaved={load} toast={toast} />}
      {previewing && (
        <div className="hce" role="dialog" aria-modal="true" aria-label="Slide preview">
          <header className="hce-head">
            <div>
              <h2>Preview: {previewing.slide.heading || 'Untitled slide'}</h2>
              <small>{previewing.has_unpublished_changes ? 'Showing the latest draft, which differs from the live version.' : 'Showing the latest saved version.'}</small>
            </div>
            <div className="hce-head-actions">
              <button type="button" className="btn" onClick={() => setPreviewing(null)}>Close</button>
              <button type="button" className="btn primary" onClick={() => { setEditing({ entry: previewing }); setPreviewing(null); }}>Edit</button>
            </div>
          </header>
          <PreviewPane slides={[{ ...previewing.slide, id: previewing.id }]} settings={{ ...data.settings, autoplay_enabled: false }} toast={toast} />
        </div>
      )}
    </section>
  );
}
