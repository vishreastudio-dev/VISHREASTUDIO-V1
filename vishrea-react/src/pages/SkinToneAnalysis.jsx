import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../context/StoreContext';
import { Header, Footer } from '../components/Layout';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { analyseImage } from '../lib/colourEngine';
import { matchProducts } from '../lib/colourMatch';
import { detectFace, loadFaceDetector } from '../lib/faceDetection';
import { usePageSeo } from '../lib/usePageSeo';

// Each step is real work, shown for at least STAGE_MIN_MS so the reading is easy to follow.
const STAGES = ['Finding your face…', 'Reading your skin tone…', 'Measuring undertone and contrast…', 'Building your palette…'];
const STAGE_LABELS = ['Face', 'Skin tone', 'Undertone', 'Palette'];
const STAGE_MIN_MS = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be opened as an image.'));
    img.src = src;
  });
}

export const SkinToneAnalysis = () => {
  usePageSeo({ breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Colour Profile', url: '/skin-tone' }] });

  const { colourProfile, setColourProfile } = useStore();
  const [analyzing, setAnalyzing] = useState(false);
  const [stageText, setStageText] = useState(STAGES[0]);
  const [stageIndex, setStageIndex] = useState(0);
  const [statusMsg, setStatusMsg] = useState('Your photo stays in this browser. Only the resulting colour profile can be saved.');
  const [previewSrc, setPreviewSrc] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [result, setResult] = useState(colourProfile?.season ? colourProfile : null);
  const [saveStatus, setSaveStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [products, setProducts] = useState([]);
  const [problem, setProblem] = useState(null);
  const [faceCentre, setFaceCentre] = useState(null);
  const runSeq = useRef(0);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const resultRef = useRef(null);
  const timers = useRef([]);
  const objectUrl = useRef(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  const releasePreview = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  // Release the camera, timers and in-memory image when leaving the page or hiding the tab.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && stopCamera();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      stopCamera();
      timers.current.forEach(clearTimeout);
      releasePreview();
    };
  }, [stopCamera, releasePreview]);

  // Start loading the face detector while the visitor chooses a photo; a failure is reported on analyse.
  useEffect(() => {
    loadFaceDetector().catch(() => {});
  }, []);

  useEffect(() => {
    if (cameraActive && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraActive]);

  useEffect(() => {
    if (!result || products.length) return;
    api('/api/catalogue?limit=48&in_stock=true').then((d) => setProducts(d.products || [])).catch(() => {});
  }, [result, products.length]);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusMsg('This browser cannot open the camera. Choose a photo instead.');
      return;
    }
    try {
      setStatusMsg('Starting camera…');
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      setCameraActive(true);
      setStatusMsg('Camera ready. Centre your face in soft, even light and capture.');
    } catch {
      setStatusMsg('Camera access was blocked or not found. You can still choose a photo instead.');
    }
  };

  const runAnalysis = async (source) => {
    const run = ++runSeq.current;
    setAnalyzing(true);
    setResult(null);
    setProblem(null);
    setSaveStatus('');
    setStatusMsg('Analysing on this device…');
    timers.current.forEach(clearTimeout);
    timers.current.push(setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60));
    // Run one step, keeping it on screen for at least STAGE_MIN_MS; a newer analysis cancels this one.
    const step = async (i, work) => {
      setStageIndex(i);
      setStageText(STAGES[i]);
      const started = performance.now();
      await nextFrame();
      const out = await work();
      const left = STAGE_MIN_MS - (performance.now() - started);
      if (left > 0) await sleep(left);
      if (run !== runSeq.current) throw Object.assign(new Error('cancelled'), { cancelled: true });
      return out;
    };
    try {
      const img = typeof source === 'string' ? await loadImage(source) : source;
      const face = await step(0, () => detectFace(img));
      const r = await step(1, () => analyseImage(img, face));
      await step(2, () => null);
      await step(3, () => null);
      setResult(r);
      setFaceCentre(r.faceCentre || null);
      setColourProfile({ season: r.season, alternative: r.alternative, undertone: r.undertone, tone: r.tone, palette: r.palette, leadColor: r.leadColor, bestColors: r.bestColors, neutrals: r.neutrals, lessColors: r.lessColors, confidence: r.confidence, quality: r.quality, lighting: r.lighting, method: r.method, evidence: r.evidence });
      setStatusMsg(r.confidence < 0.6 ? 'Analysis complete. The light wasn’t ideal, so treat this as a starting point.' : 'Analysis complete.');
    } catch (err) {
      if (err.cancelled) return;
      setProblem(err.message);
      setStatusMsg(err.message);
    } finally {
      if (run === runSeq.current) setAnalyzing(false);
    }
  };

  const captureCamera = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    stopCamera();
    releasePreview();
    canvas.toBlob((blob) => {
      if (!blob) return;
      objectUrl.current = URL.createObjectURL(blob);
      setPreviewSrc(objectUrl.current);
      runAnalysis(objectUrl.current);
    }, 'image/jpeg', 0.9);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatusMsg('Please choose an image file.');
      return;
    }
    releasePreview();
    objectUrl.current = URL.createObjectURL(file);
    setPreviewSrc(objectUrl.current);
    runAnalysis(objectUrl.current);
  };

  const handleSave = async () => {
    if (!result || isSaving) return;
    setIsSaving(true);
    setSaveStatus('Saving…');
    try {
      // Derived attributes only — the photo itself is never sent.
      await api('/api/colour-review', {
        method: 'POST',
        body: { undertone: result.undertone, season: result.season, palette: result.palette, source: 'on_device', model_version: 'vishrea-colour-2 (face + YCrCb/HSV mask + CIELAB/HSV + white-point)', confidence: result.confidence, quality_score: result.quality, lighting: result.lighting },
      });
      setSaveStatus('Saved to your Vishrea profile.');
    } catch (e) {
      setSaveStatus(e.status === 401 ? 'SIGNIN_REQUIRED' : e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const matches = result ? matchProducts(products, result, 4) : [];

  const colourCard = (x, isLead = false) => (
    <div key={x[0]} className={`style-colour${isLead ? ' is-lead' : ''}`}>
      <i style={{ background: x[1] }}></i>
      <div>
        <strong>{x[0]}</strong>
        <small>{x[1]}</small>
      </div>
    </div>
  );

  return (
    <div>
      <Header />
      <main id="main-content" className="skin-page">
        <nav aria-label="Breadcrumb" className="breadcrumb-nav">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Find your colours</span>
        </nav>
        <section className="skin-intro compact-intro">
          <p className="eyebrow">Colour profile</p>
          <h1>
            Find colours <em>that feel like you.</em>
          </h1>
          <p>
            Upload a photo or use your camera and we’ll suggest an undertone, depth and a palette to shop by. It all happens in your browser — the photo never leaves your device, and nothing is saved unless you choose to keep the palette.
          </p>
        </section>

        <section className={`skin-capture-hub ${analyzing || result ? 'has-active-analysis' : ''}`}>
          <h2>Start with a photo.</h2>
          <p className="skin-helper">
            Face the camera in soft daylight, without filters or heavy make-up. A window works better than a ring light.
          </p>

          <div className="skin-input-row hub-inputs">
            <label className="upload-control">
              <input
                ref={fileInputRef}
                id="skinFile"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
              />
              <span>Choose photo</span>
            </label>
            <button
              className="button button-outline"
              id="startCamera"
              type="button"
              onClick={cameraActive ? stopCamera : startCamera}
            >
              {cameraActive ? 'Close camera' : 'Use camera'}
            </button>
          </div>

          {cameraActive && (
            <div className="camera-wrap" id="cameraWrap">
              <video ref={videoRef} id="skinVideo" playsInline autoPlay muted></video>
              <div className="camera-overlay">
                <span>Centre your face</span>
              </div>
              <div className="camera-actions">
                <button className="button button-dark" id="captureSkin" type="button" onClick={captureCamera}>
                  Capture & analyse
                </button>
                <button className="text-button" id="stopCamera" type="button" onClick={stopCamera}>
                  Close camera
                </button>
              </div>
            </div>
          )}

          {previewSrc && !analyzing && (
            <div className="active-photo-preview">
              <img src={previewSrc} alt="Selected preview" />
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setPreviewSrc(null);
                  releasePreview();
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Change photo
              </button>
            </div>
          )}

          <button
            className="button button-dark full main-analyse-btn"
            id="analyseSkin"
            type="button"
            disabled={!previewSrc || analyzing}
            title={!previewSrc ? 'Please upload or capture a photo first' : undefined}
            onClick={() => {
              if (previewSrc) {
                runAnalysis(previewSrc);
              }
            }}
          >
            {analyzing ? 'Analysing your skin tone…' : 'Review my palette'}
          </button>
          <p className="skin-status" id="skinStatus" aria-live="polite">
            {statusMsg}
          </p>
        </section>

        {/* Dynamic Analysis Section: Appears Below Once Started/Completed */}
        {(analyzing || result || problem) && (
          <section className="skin-results-section" id="skinResult" ref={resultRef}>
            {!analyzing && problem ? (
              <div className="analysis-problem" role="alert">
                <span className="result-label">WE COULDN’T READ THIS PHOTO</span>
                <h2>{problem}</h2>
                <ul>
                  <li>Face the camera straight on, with your whole face in the frame.</li>
                  <li>Use soft daylight from a window; avoid filters, sunglasses and strong shadows.</li>
                  <li>Make sure you’re the only person in the photo.</li>
                </ul>
                <button
                  type="button"
                  className="button button-dark"
                  onClick={() => {
                    setProblem(null);
                    setPreviewSrc(null);
                    releasePreview();
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                      fileInputRef.current.click();
                    }
                  }}
                >
                  Choose another photo
                </button>
              </div>
            ) : analyzing ? (
              <div className="analysis-loading expanded-loading">
                <div className="scan-orbit">
                  <span></span>
                  <i></i>
                </div>
                <span className="result-label">VISHREA COLOUR INTELLIGENCE</span>
                <h2>Reading your colours.</h2>
                <p id="analysisStage">{stageText}</p>
                <div className="loading-steps">
                  {STAGE_LABELS.map((label, i) => (
                    <span key={label} className={stageIndex >= i ? 'active' : ''}>{label}</span>
                  ))}
                </div>
              </div>
            ) : result ? (
              <div className="analysis-results-container">
                <div className="results-badge-bar">
                  <span className="result-label">YOUR VISHREA PALETTE</span>
                  <span className="source-tag">On-device analysis</span>
                </div>

                {/* Visual Comparison */}
                <section className="analysis-comparison">
                  <div className="analysis-face">
                    <div className="analysis-face-frame">
                      {previewSrc ? <img src={previewSrc} alt="Your photo" style={faceCentre ? { objectPosition: `${faceCentre.x}% ${faceCentre.y}%` } : undefined} /> : <span>V</span>}
                    </div>
                    <small>YOUR PHOTO</small>
                  </div>
                  <div className="analysis-connector">
                    <span className="analysis-line"></span>
                    <b>V</b>
                    <span className="analysis-line"></span>
                    <small>COLOUR READ</small>
                  </div>
                  <div className="analysis-read">
                    <div className="analysis-v-mark">V</div>
                    <small>VISHREA PROFILE</small>
                    <strong>{result.season || result.undertone}</strong>
                    <i style={{ background: result.leadColor?.[1] || '#B85C43' }}></i>
                    <em>{result.leadColor?.[0] || 'Signature'}</em>
                  </div>
                </section>

                <div className="analysis-result-head">
                  <div>
                    <small>VISHREA COLOUR PROFILE</small>
                    <h2>{result.undertone}</h2>
                    <p>
                      {result.tone} depth · {Math.round((result.confidence || 0.9) * 100)}% confidence
                    </p>
                  </div>
                  <div className="confidence-ring">
                    {Math.round((result.confidence || 0.9) * 100)}
                    <span>%</span>
                  </div>
                </div>

                {/* Intelligence summary */}
                {result.season && (
                  <section className="intelligence-summary">
                    <div>
                      <span className="eyebrow">VISHREA COLOUR INTELLIGENCE</span>
                      <h3>{result.season}</h3>
                      <p>
                        Matched on four things: undertone, how light or deep your skin is, how clear or soft its colour is, and the contrast with your hair.
                        {result.alternative ? ` Your closest alternative is ${result.alternative}.` : ''}
                      </p>
                    </div>
                    <div className="evidence-grid">
                      {(result.evidence || [
                        { label: 'Undertone', value: result.undertone, score: 94 },
                        { label: 'Depth', value: result.tone, score: 88 },
                        { label: 'Contrast', value: 'Balanced', score: 70 }
                      ]).map((e) => (
                        <div key={e.label}>
                          <small>{e.label}</small>
                          <strong>{e.value}</strong>
                          <span>{Math.round(e.score)}%</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Best colour hero */}
                <section className="best-colour-hero">
                  <div>
                    <span className="eyebrow">YOUR FIRST PICK</span>
                    <h3>{result.leadColor?.[0] || 'Signature'}</h3>
                    <p>
                      {result.leadColor?.[0] || 'This shade'} is a strong starting shade for your profile. Use it close to the face first, then build around the supporting colours below.
                    </p>
                  </div>
                  <i style={{ background: result.leadColor?.[1] || '#B85C43' }}></i>
                </section>

                {/* Palette Grid */}
                <section className="colour-guide">
                  <div className="guide-head">
                    <div>
                      <span className="eyebrow">YOUR BEST COLOURS</span>
                      <h3>Colours that work with you.</h3>
                    </div>
                    <span className="guide-note">Start with the shades nearest your face.</span>
                  </div>
                  <div className="style-colour-grid">
                    {(result.bestColors || [
                      ['Terracotta', '#B85C43'],
                      ['Olive', '#68734A'],
                      ['Camel', '#B58A5A'],
                      ['Warm Ivory', '#F2E7D5'],
                      ['Chocolate', '#4A3028']
                    ]).map((x, i) => colourCard(x, i === 0))}
                  </div>
                </section>

                {/* Neutrals */}
                <section className="colour-guide">
                  <div className="guide-head">
                    <div>
                      <span className="eyebrow">EVERYDAY NEUTRALS</span>
                      <h3>Easy colours to build outfits around.</h3>
                    </div>
                  </div>
                  <div className="style-colour-grid compact">
                    {(result.neutrals || [
                      ['Cream', '#EDE3D3'],
                      ['Chocolate', '#4A3028'],
                      ['Soft Olive', '#7A8060']
                    ]).map((x) => colourCard(x))}
                  </div>
                </section>

                {/* Less colors */}
                <section className="colour-guide softer">
                  <div className="guide-head">
                    <div>
                      <span className="eyebrow">TRY LESS NEAR THE FACE</span>
                      <h3>Not forbidden — just lower priority.</h3>
                    </div>
                  </div>
                  <div className="style-colour-grid compact">
                    {(result.lessColors || [
                      ['Icy Blue', '#B9D4E8'],
                      ['Neon Pink', '#F20A7A'],
                      ['Cool Silver', '#B9BCC4']
                    ]).map((x) => colourCard(x))}
                  </div>
                  <p className="guide-disclaimer">
                    Colour analysis is a styling guide, not a rule. Lighting, fabric, contrast and personal taste can change how a shade looks on you.
                  </p>
                </section>

                {/* Curated matched products */}
                {matches.length > 0 && (
                  <section style={{ marginTop: '28px', borderTop: '1px solid var(--line)', paddingTop: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
                      <div>
                        <span className="eyebrow" style={{ color: 'var(--wine)' }}>From the edit</span>
                        <h3 style={{ margin: '2px 0 0', font: '400 20px Georgia, serif' }}>Pieces in your colours</h3>
                      </div>
                      <Link className="text-link" to={`/catalogue?colour_season=${encodeURIComponent(result.season)}`} style={{ fontSize: '11px' }}>
                        Shop all {result.season} <span>→</span>
                      </Link>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                      {matches.map(({ product: p, reason }) => (
                        <div
                          key={p.id}
                          style={{
                            background: '#faf7f5',
                            border: '1px solid var(--line)',
                            padding: '12px',
                            borderRadius: '2px',
                            display: 'flex',
                            flexDirection: 'column'
                          }}
                        >
                          <img
                            src={p.image_url || '/assets/editorial.jpg'}
                            alt={p.name}
                            style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '2px' }}
                          />
                          <div style={{ margin: '8px 0', flex: '1 1 auto' }}>
                            <small style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                              {p.color || result.season}
                            </small>
                            <h4 style={{ margin: '2px 0', fontSize: '13px', font: '400 14px Georgia, serif' }}>
                              {p.name}
                            </h4>
                            <strong style={{ fontSize: '12px', color: 'var(--ink)' }}>
                              {p.price_inr !== null ? `₹${Number(p.price_inr).toLocaleString('en-IN')}` : ''}
                            </strong>
                            <small style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: 'var(--muted)' }}>{reason}</small>
                          </div>
                          <Link
                            className="button button-dark"
                            style={{ padding: '8px 12px', fontSize: '11px', textTransform: 'uppercase', textAlign: 'center' }}
                            to={`/product/${encodeURIComponent(p.slug)}`}
                          >
                            View piece
                          </Link>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <div className="analysis-metrics" style={{ marginTop: '24px' }}>
                  <span>
                    <b>Lighting</b>
                    {result.lighting || 'Balanced daylight'}
                  </span>
                  <span>
                    <b>Quality</b>
                    {Math.round(result.quality || 92)}/100
                  </span>
                  <span>
                    <b>Method</b>
                    {result.method || 'On-device'}
                  </span>
                </div>

                <p className="privacy-note">
                  Everything runs in your browser. Face detection only finds where your face is (it doesn’t identify you). Skin is then picked out of the face with colour masks (avoiding eyes, brows and lips), measured in CIELAB and HSV, and corrected for the colour of the light. Your photo is never uploaded or stored; only the palette is saved, and only if you choose to.
                </p>

                <button
                  className="button button-dark full"
                  id="saveColour"
                  disabled={isSaving}
                  onClick={handleSave}
                  style={{ marginTop: '16px' }}
                >
                  Save to my colour profile
                </button>
                <p className="skin-status" id="saveStatus" aria-live="polite">
                  {saveStatus === 'SIGNIN_REQUIRED' ? (
                    <Link className="text-link" to="/login?next=/skin-tone">
                      Sign in to save your colour profile →
                    </Link>
                  ) : (
                    saveStatus
                  )}
                </p>
              </div>
            ) : null}
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
};
