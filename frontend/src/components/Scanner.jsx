import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function Scanner({ visitorId, onBack }) {
  const [state, setState] = useState(visitorId ? 'loading' : 'scan'); // 'scan' | 'loading' | 'success' | 'error'
  const [visitor, setVisitor] = useState(null);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(10);
  const [cameras, setCameras] = useState([]);
  const [activeCameraId, setActiveCameraId] = useState(null);
  const scannerRef = useRef(null);

  const updateCameraList = async () => {
    try {
      const list = await Html5Qrcode.getCameras();
      setCameras(list || []);
      return list;
    } catch (err) {
      console.warn("Could not list cameras:", err);
      return [];
    }
  };

  // Trigger check-in process
  const processCheckIn = async (id) => {
    setState('loading');
    try {
      const response = await fetch(`/api/visitors/${id}/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to verify ticket.');
      }

      const data = await response.json();
      setVisitor(data.visitor);
      setState('success');
      setCountdown(10);
    } catch (err) {
      setError(err.message || 'Network communication failed.');
      setState('error');
    }
  };

  // Handle direct verifyId on initial page load
  useEffect(() => {
    if (visitorId) {
      processCheckIn(visitorId);
    } else {
      setState('scan');
    }
  }, [visitorId]);

  const handleSwitchCamera = async () => {
    if (cameras.length <= 1) return;
    const currentIndex = cameras.findIndex(cam => cam.id === activeCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];
    if (nextCamera) {
      console.log(`Switching active camera to: ${nextCamera.label || nextCamera.id}`);
      setActiveCameraId(nextCamera.id);
    }
  };



  // html5-qrcode scanner initialization and lifecycle
  useEffect(() => {
    if (state !== 'scan') {
      // Clean up scanner if we transition out of scan state
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(err => console.error("Error stopping scanner:", err));
        }
        scannerRef.current = null;
      }
      return;
    }

    const html5QrCode = new Html5Qrcode("reader");
    scannerRef.current = html5QrCode;

    const startCamera = async () => {
      // 1. Check if the app is run in an insecure context (HTTP on non-localhost), which blocks camera APIs on mobile
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!window.isSecureContext && !isLocal) {
        setError("Insecure Context: Camera access is blocked by mobile browsers on insecure HTTP connections. Please access via localhost on your PC, or serve over HTTPS (or use a tunnel like ngrok).");
        setState('error');
        return;
      }

      try {
        const list = await updateCameraList();

        const config = {
          fps: 10,
          qrbox: (width, height) => {
            // Viewfinder is 80% of the smallest viewport dimension
            const size = Math.min(width, height) * 0.80;
            return { width: size, height: size };
          }
        };

        const successCallback = async (decodedText) => {
          // QR Code detected! Stop camera first
          try {
            if (html5QrCode.isScanning) {
              await html5QrCode.stop();
            }
          } catch (e) {
            console.error("Failed to stop camera on scan", e);
          }
          
          // Extract visitor ID if scanned content is a full verification URL
          let id = decodedText.trim();
          if (id.includes('/verify/')) {
            const parts = id.split('/verify/');
            if (parts.length > 1) {
              id = parts[1].split('?')[0].split('#')[0].trim();
            }
          }
          
          // Remove trailing slash if present
          if (id.endsWith('/')) {
            id = id.slice(0, -1).trim();
          }
          
          processCheckIn(id);
        };

        // Determine which camera to use
        let selectedCameraId = activeCameraId;

        // If no camera ID is set but we have cameras in list, select one
        if (!selectedCameraId && list && list.length > 0) {
          const backCamera = list.find(cam => {
            const label = cam.label.toLowerCase();
            return label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('facing 1') || label.includes('camera 2');
          });
          selectedCameraId = backCamera ? backCamera.id : list[0].id;
          setActiveCameraId(selectedCameraId);
        }

        // Start scanning
        if (selectedCameraId) {
          console.log(`Starting camera ID: ${selectedCameraId}`);
          await html5QrCode.start(selectedCameraId, config, successCallback, () => {});
          // Query camera list again now that permission is granted, so we get labels and all available cameras
          const refreshedList = await updateCameraList();
          if (refreshedList && refreshedList.length > 0 && !activeCameraId) {
            const backCamera = refreshedList.find(cam => {
              const label = cam.label.toLowerCase();
              return label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('facing 1') || label.includes('camera 2');
            });
            setActiveCameraId(backCamera ? backCamera.id : refreshedList[0].id);
          }
        } else {
          // No listed cameras yet (or permission not yet granted): attempt facingMode fallback
          console.log("No camera list returned, attempting facingMode: environment");
          try {
            await html5QrCode.start({ facingMode: "environment" }, config, successCallback, () => {});
            const refreshedList = await updateCameraList();
            if (refreshedList && refreshedList.length > 0) {
              const backCamera = refreshedList.find(cam => {
                const label = cam.label.toLowerCase();
                return label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('facing 1') || label.includes('camera 2');
              });
              setActiveCameraId(backCamera ? backCamera.id : refreshedList[0].id);
            }
          } catch (envErr) {
            console.warn("facingMode: environment failed, falling back to facingMode: user", envErr);
            await html5QrCode.start({ facingMode: "user" }, config, successCallback, () => {});
            const refreshedList = await updateCameraList();
            if (refreshedList && refreshedList.length > 0) {
              setActiveCameraId(refreshedList[0].id);
            }
          }
        }
      } catch (err) {
        console.error("Camera startup failed:", err);
        setError(`Camera error: ${err.message || err.toString() || 'Camera permission denied or camera not found.'}`);
        setState('error');
      }
    };

    // Tiny timeout to ensure DOM is fully ready
    const timer = setTimeout(() => {
      startCamera();
    }, 200);

    return () => {
      clearTimeout(timer);
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.error("Unmount cleanup failed:", err));
      }
    };
  }, [state, activeCameraId]);

  // Countdown timer for check-in detail visibility
  useEffect(() => {
    if (state !== 'success') return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state]);

  // Reset scanner when countdown hits 0
  useEffect(() => {
    if (state === 'success' && countdown === 0) {
      handleResetScanner();
    }
  }, [countdown, state]);



  // Error screen fallback auto-reset (5 seconds)
  useEffect(() => {
    if (state !== 'error') return;

    const timer = setTimeout(() => {
      handleResetScanner();
    }, 5000);

    return () => clearTimeout(timer);
  }, [state]);
  const handleResetScanner = () => {
    setVisitor(null);
    setError('');
    // Clean URL query path back to root /verify route so page reload starts scanner afresh
    if (window.location.pathname !== '/verify') {
      window.history.pushState({}, '', '/verify');
    }
    setState('scan');
  };

  return (
    <div className="scanner-fullscreen">
      {/* Premium background glows */}
      <div className="display-glow-bl" />
      <div className="display-glow-tr" />

      {/* Flowing Waves SVG */}
      <svg className="waves-svg" viewBox="0 0 1000 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sc-goldGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#f9e8a2" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#b8860b" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="sc-blueGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="sc-glowGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#082f49" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#1e40af" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M-100,550 C150,500 300,250 600,180 C750,140 900,100 1100,50 L1100,650 L-100,650 Z" fill="url(#sc-glowGrad)" opacity="0.4" />
        <path d="M-100,600 C200,520 350,320 700,270 C850,240 950,160 1100,100 L1100,650 L-100,650 Z" fill="rgba(30, 64, 175, 0.25)" />
        <path d="M-50,540 Q250,380 500,420 T1050,120" fill="none" stroke="url(#sc-blueGrad)" strokeWidth="3" opacity="0.6" />
        <path d="M-50,490 Q200,430 450,280 T1050,60" fill="none" stroke="url(#sc-goldGrad)" strokeWidth="4" />
        <path d="M-50,510 Q220,450 470,300 T1050,80" fill="none" stroke="url(#sc-goldGrad)" strokeWidth="1.5" opacity="0.75" />
      </svg>

      {/* Floating Sparkles */}
      <div className="sparkles-container">
        <span className="sparkle" style={{ left: '8%',  animationDelay: '0s',  animationDuration: '9s' }}></span>
        <span className="sparkle" style={{ left: '22%', animationDelay: '3s',  animationDuration: '11s' }}></span>
        <span className="sparkle" style={{ left: '40%', animationDelay: '1s',  animationDuration: '8s' }}></span>
        <span className="sparkle" style={{ left: '60%', animationDelay: '5s',  animationDuration: '10s' }}></span>
        <span className="sparkle" style={{ left: '78%', animationDelay: '2s',  animationDuration: '7s' }}></span>
        <span className="sparkle" style={{ left: '92%', animationDelay: '4s',  animationDuration: '12s' }}></span>
      </div>

      {/* Top status bar */}
      <div className="scanner-top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span className={`status-dot ${state === 'scan' ? 'pulse-green' : state === 'loading' ? 'pulse-orange' : 'pulse-gray'}`}></span>
          <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Gate Entry Portal</span>
        </div>
        <button onClick={onBack} className="scanner-back-btn" type="button">
          ← Back
        </button>
      </div>

      {/* STATE 1: CAMERA STREAM */}
      {state === 'scan' && (
        <div className="scanner-scan-layout">
          {/* Heading */}
          <h1 className="scanner-scan-heading">
            Please <span className="gold-text-gradient">Scan</span> the QR Code
          </h1>
          <p className="scanner-scan-sub">Hold the visitor's printed QR pass inside the viewfinder</p>

          <div className="scanner-camera-wrapper">
            <div id="reader"></div>
            {/* Viewfinder Overlay Frame */}
            <div className="scanner-viewfinder-overlay">
              <div className="viewfinder-box">
                <div className="corner top-left"></div>
                <div className="corner top-right"></div>
                <div className="corner bottom-left"></div>
                <div className="corner bottom-right"></div>
                <div className="scan-laser-line"></div>
              </div>
            </div>

            {/* Switch Camera Button */}
            {cameras.length > 1 && (
              <button
                onClick={handleSwitchCamera}
                className="camera-switch-btn"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                <span>Switch Camera</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* STATE 2: LOADING TRANSACTION */}
      {state === 'loading' && (
        <div className="scanner-card flex-center-col">
          <div className="spinner" style={{ marginBottom: '1.5rem', width: '48px', height: '48px', borderWidth: '4px' }}></div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 500 }}>Processing Ticket Verification</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>Verifying database registration...</p>
        </div>
      )}

      {/* STATE 3: SUCCESS FULLSCREEN PAGE */}
      {state === 'success' && visitor && (
        <div 
          className="success-screen" 
          onClick={handleResetScanner}
        >
          {/* Flowing Waves SVG */}
          <svg className="waves-svg" viewBox="0 0 1000 600" preserveAspectRatio="none">
            <defs>
              <linearGradient id="goldGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#d4af37" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#f9e8a2" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#b8860b" stopOpacity="0.6" />
              </linearGradient>
              <linearGradient id="blueGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.4" />
                <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.2" />
              </linearGradient>
              <linearGradient id="glowGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#082f49" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#1e40af" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
              </linearGradient>
            </defs>
            
            {/* Deep background mesh ribbons */}
            <path d="M-100,550 C150,500 300,250 600,180 C750,140 900,100 1100,50 L1100,650 L-100,650 Z" fill="url(#glowGrad)" opacity="0.4" />
            <path d="M-100,600 C200,520 350,320 700,270 C850,240 950,160 1100,100 L1100,650 L-100,650 Z" fill="rgba(30, 64, 175, 0.25)" />
            
            {/* Blue glowing curves */}
            <path d="M-50,540 Q250,380 500,420 T1050,120" fill="none" stroke="url(#blueGrad)" strokeWidth="3" opacity="0.6" />
            <path d="M-50,560 Q300,430 550,440 T1050,170" fill="none" stroke="url(#blueGrad)" strokeWidth="1.5" opacity="0.4" />
            
            {/* Luxury gold waves */}
            <path d="M-50,490 Q200,430 450,280 T1050,60" fill="none" stroke="url(#goldGrad)" strokeWidth="4" />
            <path d="M-50,510 Q220,450 470,300 T1050,80" fill="none" stroke="url(#goldGrad)" strokeWidth="1.5" opacity="0.75" />
            <path d="M-50,470 Q180,410 430,260 T1050,40" fill="none" stroke="url(#goldGrad)" strokeWidth="1" opacity="0.4" />
          </svg>

          {/* Floating Sparkles */}
          <div className="sparkles-container">
            <span className="sparkle" style={{ left: '15%', animationDelay: '0s', animationDuration: '8s' }}></span>
            <span className="sparkle" style={{ left: '30%', animationDelay: '2s', animationDuration: '10s' }}></span>
            <span className="sparkle" style={{ left: '45%', animationDelay: '4s', animationDuration: '7s' }}></span>
            <span className="sparkle" style={{ left: '60%', animationDelay: '1s', animationDuration: '9s' }}></span>
            <span className="sparkle" style={{ left: '75%', animationDelay: '5s', animationDuration: '11s' }}></span>
            <span className="sparkle" style={{ left: '90%', animationDelay: '3s', animationDuration: '8s' }}></span>
            <span className="sparkle" style={{ left: '20%', animationDelay: '6s', animationDuration: '12s' }}></span>
            <span className="sparkle" style={{ left: '80%', animationDelay: '7s', animationDuration: '9s' }}></span>
          </div>

          <h1 className="welcome-text-serif">
            “Welcome, <span className="gold-text-gradient">{visitor.name}</span>”
          </h1>
          <p className="delighted-subtitle">
            We're delighted to have you at the Event
          </p>

          <span className="dismiss-hint">
            Tap anywhere to scan next badge ({countdown}s)
          </span>
        </div>
      )}

      {/* STATE 4: SCAN OR VERIFICATION ERROR */}
      {state === 'error' && (
        <div className="scanner-card error-layout">
          <div className="error-banner">
            <div className="error-icon-badge">✗</div>
            <h2>{error.includes('Camera') || error.includes('Insecure') ? 'Camera Error' : 'Check-In Denied'}</h2>
            <p style={{ color: 'var(--danger)', fontWeight: 500, padding: '0 0.5rem', wordBreak: 'break-word', fontSize: '0.9rem' }}>{error}</p>
          </div>

          <div style={{ padding: '0 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
            {error.includes('Insecure') ? (
              <span>
                To scan QR codes from a mobile device, modern browsers require a secure connection (HTTPS). 
                Please connect via <strong>localhost</strong> on the PC running the server, or set up a secure HTTPS tunnel (e.g., using ngrok).
                <br /><br />
                <span style={{ display: 'block', padding: '0.75rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <strong>Are you testing on the host PC/laptop?</strong><br />
                  <a href={`http://localhost:${window.location.port}/verify`} style={{ color: 'var(--primary)', fontWeight: 'bold', display: 'inline-block', marginTop: '0.25rem' }}>
                    Click here to switch to localhost
                  </a>
                </span>
              </span>
            ) : error.includes('Camera') ? (
              <span>
                Please ensure you have granted camera permissions to this browser tab. 
                If the camera is in use by another application (like Zoom, Teams, or another tab), please close it and try again.
              </span>
            ) : (
              <span>
                This QR code may be invalid, checked in on another gate, or database connection is offline.
              </span>
            )}
          </div>

          <button onClick={handleResetScanner} className="btn btn-primary" style={{ marginTop: '2rem', backgroundColor: '#374151' }}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
