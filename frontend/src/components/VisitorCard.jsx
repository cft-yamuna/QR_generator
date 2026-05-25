import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import html2canvas from 'html2canvas';

export default function VisitorCard({ visitor, networkInfo, onBack, onPrintSuccess, successMessage }) {
  const [screenQrUrl, setScreenQrUrl] = useState('');
  const [printQrUrl,  setPrintQrUrl]  = useState(''); // pure-black QR for badge bitmap

  const [printerIp, setPrinterIp]     = useState(localStorage.getItem('visitor_printer_ip')   || '');
  const [printerPort, setPrinterPort] = useState(localStorage.getItem('visitor_printer_port') || '9100');
  const [showSettings, setShowSettings] = useState(false);
  const [printStatus, setPrintStatus]   = useState('idle');
  const [printError, setPrintError]     = useState('');

  // Ref to the hidden badge div that html2canvas will capture
  const badgeRef = useRef(null);

  const localIp      = networkInfo?.localIp      || 'localhost';
  const frontendPort = networkInfo?.frontendPort  || '5173';
  const qrUrl = `https://${localIp}:${frontendPort}/verify/${visitor.id}`;

  // ── Generate QR codes ──────────────────────────────────────────────────────
  useEffect(() => {
    // Screen QR — dark teal on white, decorative
    QRCode.toDataURL(qrUrl, { width: 180, margin: 1,
      color: { dark: '#0B0E14', light: '#FFFFFF' } })
      .then(url => setScreenQrUrl(url))
      .catch(err => console.error('Screen QR error:', err));

    // Print QR — pure black on white, maximum contrast for thermal paper
    QRCode.toDataURL(qrUrl, { width: 168, margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' } })
      .then(url => setPrintQrUrl(url))
      .catch(err => console.error('Print QR error:', err));
  }, [visitor.id, qrUrl]);

  // ── Printer settings helper ────────────────────────────────────────────────
  const savePrinterSettings = (ip, port) => {
    localStorage.setItem('visitor_printer_ip',   ip);
    localStorage.setItem('visitor_printer_port', port);
    setPrinterIp(ip);
    setPrinterPort(port);
  };

  // ── Sunmi bitmap print: capture badge div → base64 → Android bridge ────────
  const captureBadgeBitmap = async () => {
    if (!badgeRef.current) throw new Error('Badge element not mounted.');
    if (!printQrUrl)       throw new Error('QR code not ready yet.');

    // html2canvas renders the badge div at exactly its CSS pixel dimensions.
    // The badge is styled at 400 × 160 px which maps 1:1 to Sunmi printer dots.
    const canvas = await html2canvas(badgeRef.current, {
      scale:           1,          // 1 CSS px = 1 printer dot
      useCORS:         true,       // allow data: URIs (QR image)
      allowTaint:      false,
      backgroundColor: '#ffffff',  // ensure opaque white — thermal printers need no alpha
      logging:         false,
      onclone: (clonedDoc) => {
        // html2canvas renders the cloned element. Since the live element has
        // opacity: 0 to hide it from the user, we must force opacity to 1 on
        // the cloned version so it compiles to a visible image rather than a transparent blank.
        const clonedBadge = clonedDoc.getElementById('print-badge-capture-div');
        if (clonedBadge) {
          clonedBadge.style.opacity = '1';
        }
      }
    });

    // Strip the data: prefix — Kotlin only wants the raw base64 payload
    return canvas.toDataURL('image/png').split(',')[1];
  };

  // ── Sunmi bitmap print: html2canvas → base64 → Kotlin → real callback ─────

  /**
   * Wraps the fire-and-forget Android.printBitmapAndCut() bridge call in a
   * Promise that resolves/rejects only when Kotlin calls back via
   * window.__onPrintDone(success, errorMessage).
   *
   * A 12-second timeout rejects if the callback never fires — this happens
   * when the old APK is still installed (the method doesn't exist yet) or
   * when the printer service is unreachable.
   */
  const printWithCallback = (base64Png) => new Promise((resolve, reject) => {
    const TIMEOUT_MS = 12_000;

    const cleanup = () => { delete window.__onPrintDone; };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(
        'No response from printer after 12 s. ' +
        'Make sure the latest APK is installed on the Sunmi device.'
      ));
    }, TIMEOUT_MS);

    // Kotlin calls this function via evaluateJavascript() on the UI thread
    window.__onPrintDone = (success, errMsg) => {
      clearTimeout(timer);
      cleanup();
      if (success) resolve();
      else reject(new Error(errMsg || 'Print failed — check Sunmi logcat for details.'));
    };

    // Fire the bridge call AFTER the callback is registered
    window.Android.printBitmapAndCut(base64Png);
  });

  // ── Print button handler ───────────────────────────────────────────────────
  const handlePrintAction = async () => {
    if (typeof window !== 'undefined' && window.Android) {
      setPrintStatus('printing');
      setPrintError('');
      try {
        // 1. Allow the QR <img> (set via printQrUrl state) to fully paint into
        //    the hidden badge div before html2canvas takes its snapshot.
        //    Without this delay the image element may still be blank when captured.
        await new Promise(resolve => setTimeout(resolve, 500));

        // 2. Render the hidden HTML/CSS badge div to a 576-px-wide bitmap
        const base64Png = await captureBadgeBitmap();

        // 3. Send to Kotlin and WAIT for the real result callback.
        //    Only resolves when Kotlin calls window.__onPrintDone(true,'').
        //    Rejects (with message) if Kotlin reports an error or 12 s pass.
        await printWithCallback(base64Png);

        setPrintStatus('success');
        setTimeout(() => { if (onPrintSuccess) onPrintSuccess(); }, 1500);
      } catch (err) {
        setPrintStatus('error');
        setPrintError(err.message || 'Error generating or sending badge bitmap.');
      }
    } else if (printerIp.trim()) {
      // Network / ESC-POS print (non-Sunmi fallback)
      setPrintStatus('printing');
      setPrintError('');
      try {
        const response = await fetch(`/api/visitors/${visitor.id}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ printerIp: printerIp.trim(), printerPort: parseInt(printerPort, 10) })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to send print job to network printer.');
        setPrintStatus('success');
        setTimeout(() => { if (onPrintSuccess) onPrintSuccess(); }, 1500);
      } catch (err) {
        setPrintStatus('error');
        setPrintError(err.message || 'Printer communication error.');
      }
    } else {
      setPrintStatus('error');
      setPrintError('Native print is not supported on this browser/device, and no LAN printer IP is configured.');
    }
  };

  const initials = visitor.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="reg-page screen-only">
      <div className="display-glow-bl screen-only" />
      <div className="display-glow-tr screen-only" />

      {/*
        ── BADGE CAPTURE DIV ───────────────────────────────────────────────────
        Rendered invisible in-viewport (NOT off-screen) so Android WebView fully
        composites the QR <img> before html2canvas snapshots it.

        Off-screen (left:-9999px) causes WebView to skip painting images that
        are outside the visible viewport — the QR renders blank in the capture.
        opacity:0 + pointerEvents:none keeps it invisible but composited.

        Dimensions: 400 × 160 px
          400 px = safe Sunmi printable width with margin room on sticker rolls
          160 px = comfortable badge height for two text lines + QR

        Layout: CSS flexbox — name/ID on the left, QR on the right.
      */}
      <div
        id="print-badge-capture-div"
        ref={badgeRef}
        aria-hidden="true"
        style={{
          position:        'fixed',
          left:            '0px',
          top:             '0px',
          opacity:         0,
          pointerEvents:   'none',
          zIndex:          -1,
          width:           '400px',
          height:          '160px',
          display:         'flex',
          flexDirection:   'row',
          alignItems:      'center',
          justifyContent:  'space-between',
          backgroundColor: '#ffffff',
          padding:         '0 28px',
          boxSizing:       'border-box',
          fontFamily:      'Arial, Helvetica, sans-serif',
          overflow:        'hidden',
        }}
      >
        {/* Left column: name + employee ID */}
        <div style={{ flex: 1, paddingRight: '12px', overflow: 'hidden' }}>
          <div style={{
            fontSize:     '36px',
            fontWeight:   'bold',
            color:        '#000000',
            lineHeight:   '1.2',
            whiteSpace:   'nowrap',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
          }}>
            {visitor.name}
          </div>
          <div style={{
            fontSize:   '22px',
            color:      '#222222',
            marginTop:  '6px',
            whiteSpace: 'nowrap',
            overflow:   'hidden',
          }}>
            {visitor.employeeId || ''}
          </div>
        </div>

        {/* Right column: QR code */}
        {printQrUrl && (
          <img
            src={printQrUrl}
            alt="badge QR"
            style={{
              width:      '128px',
              height:     '128px',
              flexShrink: 0,
              display:    'block',
            }}
          />
        )}
      </div>

      {/* ── VISIBLE CARD UI ─────────────────────────────────────────────── */}
      <div className="container screen-only" style={{ maxWidth: '480px', padding: '1.5rem', zIndex: 10 }}>
        <div className="nav-header screen-only" style={{ justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <button onClick={onBack} className="btn-link"
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            ← Cancel
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>ID: {visitor.id}</span>
        </div>

        {successMessage && (
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <span style={{ fontSize: '2.5rem', color: 'var(--success)' }}>✓</span>
            <h2 style={{ margin: '0.5rem 0 0.25rem 0', color: 'var(--text-primary)', fontWeight: 700 }}>{successMessage}</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Please print your event badge below</p>
          </div>
        )}

        <div className="card ticket-card screen-only" style={{ padding: '2rem 1.5rem' }}>
          <div className="user-avatar">{initials}</div>
          <h2 className="user-name">{visitor.name}</h2>

          <div style={{ textAlign: 'left', margin: '1rem 0 1.5rem 0' }}>
            <div className="user-meta-item">
              <span className="label">Employee ID</span>
              <span className="value">{visitor.employeeId || 'N/A'}</span>
            </div>
            {visitor.email && (
              <div className="user-meta-item">
                <span className="label">Email Address</span>
                <span className="value" style={{ wordBreak: 'break-all' }}>{visitor.email}</span>
              </div>
            )}
            <div className="user-meta-item">
              <span className="label">Check-In Status</span>
              <span className="value" style={{ color: 'var(--success)', fontWeight: 600 }}>Checked In</span>
            </div>
          </div>

          <div className="qr-box" style={{ margin: '1rem auto' }}>
            {screenQrUrl
              ? <img src={screenQrUrl} alt="QR Code" style={{ display: 'block', width: '180px', height: '180px' }} />
              : <div className="spinner" style={{ width: '20px', height: '20px' }} />}
          </div>

          {printStatus === 'printing' && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              <div className="spinner" style={{ width: '20px', height: '20px', display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Rendering badge…
            </div>
          )}
          {printStatus === 'success' && (
            <div style={{ color: 'var(--success)', fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem' }}>
              ✓ Print job sent! Returning to home…
            </div>
          )}
          {printStatus === 'error' && (
            <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem', padding: '0.5rem',
              background: 'rgba(239,68,68,0.08)', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.2)' }}>
              ⚠ {printError}
            </div>
          )}

          <button onClick={handlePrintAction} className="btn btn-primary" style={{ height: '48px' }}
            disabled={printStatus === 'printing' || printStatus === 'success'}>
            {window.Android
              ? 'Print Badge (Sunmi)'
              : printerIp.trim()
                ? 'Print Badge (LAN)'
                : 'Print Badge'}
          </button>

          <div style={{ marginTop: '1.25rem', textAlign: 'left' }}>
            <button onClick={() => setShowSettings(!showSettings)} className="btn-link"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', display: 'block', margin: '0 auto' }}>
              ⚙ {showSettings ? 'Hide Printer Settings' : 'Configure LAN Printer'}
            </button>
            {showSettings && (
              <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'rgba(255,255,255,0.02)',
                borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    Printer IP Address
                  </label>
                  <input type="text" placeholder="e.g. 192.168.0.100" value={printerIp}
                    onChange={(e) => savePrinterSettings(e.target.value, printerPort)}
                    style={{ width: '100%', padding: '0.5rem', background: '#0B0E14', border: '1px solid var(--border-color)',
                      borderRadius: '6px', color: 'white', fontSize: '0.85rem' }} />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block', marginTop: '0.25rem' }}>
                    Enter IP to print via network printer when not on Sunmi device.
                  </small>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Port</label>
                  <input type="number" value={printerPort}
                    onChange={(e) => savePrinterSettings(printerIp, e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', background: '#0B0E14', border: '1px solid var(--border-color)',
                      borderRadius: '6px', color: 'white', fontSize: '0.85rem' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
