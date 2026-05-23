import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export default function VisitorCard({ visitor, networkInfo, onBack, onPrintSuccess, successMessage }) {
  const [screenQrUrl, setScreenQrUrl] = useState('');

  const [printerIp, setPrinterIp]     = useState(localStorage.getItem('visitor_printer_ip')   || '');
  const [printerPort, setPrinterPort] = useState(localStorage.getItem('visitor_printer_port') || '9100');
  const [showSettings, setShowSettings] = useState(false);
  const [printStatus, setPrintStatus]   = useState('idle');
  const [printError, setPrintError]     = useState('');

  const localIp      = networkInfo?.localIp      || 'localhost';
  const frontendPort = networkInfo?.frontendPort  || '5173';
  const qrUrl = `https://${localIp}:${frontendPort}/verify/${visitor.id}`;

  // ── Generate QR codes ──────────────────────────────────────────────────────
  useEffect(() => {
    QRCode.toDataURL(qrUrl, { width: 180, margin: 1,
      color: { dark: '#0B0E14', light: '#FFFFFF' } })
      .then(url => setScreenQrUrl(url))
      .catch(err => console.error('Screen QR error:', err));
  }, [visitor.id, qrUrl]);

  // ── Printer settings helper ────────────────────────────────────────────────
  const savePrinterSettings = (ip, port) => {
    localStorage.setItem('visitor_printer_ip',   ip);
    localStorage.setItem('visitor_printer_port', port);
    setPrinterIp(ip);
    setPrinterPort(port);
  };

  // ── Print button handler ───────────────────────────────────────────────────
  const handlePrintAction = async () => {
    if (typeof window !== 'undefined' && window.Android) {
      setPrintStatus('printing');
      setPrintError('');
      try {
        window.Android.printQR(qrUrl);
        window.Android.cutPaper();
        
        setPrintStatus('success');
        setTimeout(() => { if (onPrintSuccess) onPrintSuccess(); }, 1500);
      } catch (err) {
        setPrintStatus('error');
        setPrintError(err.message || 'Error communicating with native printer.');
      }
    } else if (printerIp.trim()) {
      // Network / ESC-POS print
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
              {printerIp.trim() ? 'Sending to printer…' : 'Preparing print…'}
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
