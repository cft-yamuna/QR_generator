import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function Scanner({ visitorId, onBack }) {
  const [state, setState] = useState(visitorId ? 'loading' : 'scan'); // 'scan' | 'loading' | 'success' | 'error'
  const [visitor, setVisitor] = useState(null);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(10);
  const [cameras, setCameras] = useState([]);
  const [activeCameraId, setActiveCameraId] = useState(null);
  const [activeFacingMode, setActiveFacingMode] = useState('environment');
  const [scannerRestartKey, setScannerRestartKey] = useState(0);
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
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
    if (isSwitchingCamera) return;

    const nextFacingMode = activeFacingMode === 'environment' ? 'user' : 'environment';
    console.log(`Switching camera facing mode to: ${nextFacingMode}`);
    setIsSwitchingCamera(true);

    try {
      const scanner = scannerRef.current;
      if (scanner) {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        await scanner.clear();
      }
    } catch (err) {
      console.warn("Could not stop camera before switching:", err);
    } finally {
      scannerRef.current = null;
      setActiveCameraId(null);
      setActiveFacingMode(nextFacingMode);
      setScannerRestartKey((key) => key + 1);
      setTimeout(() => setIsSwitchingCamera(false), 700);
    }
  };



  // html5-qrcode scanner initialization and lifecycle
  useEffect(() => {
    if (state !== 'scan') {
      // Clean up scanner if we transition out of scan state
      if (scannerRef.current) {
        const scanner = scannerRef.current;
        Promise.resolve()
          .then(async () => {
            if (scanner.isScanning) {
              await scanner.stop();
            }
            await scanner.clear();
          })
          .catch(err => console.error("Error stopping scanner:", err));
        scannerRef.current = null;
      }
      return;
    }

    const html5QrCode = new Html5Qrcode("reader");
    scannerRef.current = html5QrCode;

    const applyCameraZoom = async () => {
      try {
        const videoElement = document.querySelector('#reader video');
        if (videoElement && videoElement.srcObject) {
          const stream = videoElement.srcObject;
          const tracks = stream.getVideoTracks();
          if (tracks && tracks.length > 0) {
            const track = tracks[0];
            const capabilities = track.getCapabilities();
            console.log("Camera capabilities:", capabilities);
            if (capabilities.zoom) {
              const minZoom = capabilities.zoom.min || 1;
              const maxZoom = capabilities.zoom.max || 1;
              // Double scale camera zoom: target 2.0x
              const targetZoom = Math.min(2.0, maxZoom);
              console.log(`Setting zoom to: ${targetZoom} (min: ${minZoom}, max: ${maxZoom})`);
              await track.applyConstraints({
                advanced: [{ zoom: targetZoom }]
              });
            }
          }
        }
      } catch (err) {
        console.warn("Could not apply camera zoom:", err);
      }
    };

    const startCamera = async () => {
      // 1. Check if the app is run in an insecure context (HTTP on non-localhost), which blocks camera APIs on mobile
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!window.isSecureContext && !isLocal) {
        setError("Insecure Context: Camera access is blocked by mobile browsers on insecure HTTP connections. Please access via localhost on your PC, or serve over HTTPS (or use a tunnel like ngrok).");
        setState('error');
        return;
      }

      try {
        // 2. Use navigator.mediaDevices.enumerateDevices() to list all available video input devices.
        const devices = await navigator.mediaDevices.enumerateDevices();
        // 3. Filter only kind === 'videoinput'
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setCameras(videoDevices || []);

        // 7. Add console logs for: all detected camera labels
        const allLabels = videoDevices.map(d => d.label || 'no-label');
        console.log("All detected camera labels:", allLabels);
        console.log("All detected cameras raw:", videoDevices.map(d => ({ label: d.label, deviceId: d.deviceId })));

        const config = {
          fps: 15,
          qrbox: (width, height) => {
            // Keep the detection area aligned with the large visible viewfinder.
            const size = Math.min(width, height) * 0.92;
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

        // Determine which camera deviceId to use
        let selectedDeviceId = activeCameraId;
        let selectedLabel = '';

        if (!selectedDeviceId && videoDevices.length > 0) {
          // 4. Detect the most likely rear / front camera
          const rearCamera = videoDevices.find(device => {
            const label = (device.label || '').toLowerCase();
            return label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('facing 1') || label.includes('camera 2');
          });

          const frontCamera = videoDevices.find(device => {
            const label = (device.label || '').toLowerCase();
            return label.includes('front') || label.includes('user') || label.includes('facing 0') || label.includes('forward');
          });

          // 5. If multiple cameras exist: prefer the target camera, otherwise fallback to the first camera
          if (activeFacingMode === 'environment') {
            const matched = rearCamera || videoDevices[0];
            selectedDeviceId = matched.deviceId;
            selectedLabel = matched.label || '';
          } else {
            const matched = frontCamera || videoDevices[0];
            selectedDeviceId = matched.deviceId;
            selectedLabel = matched.label || '';
          }
        } else if (selectedDeviceId) {
          const matched = videoDevices.find(d => d.deviceId === selectedDeviceId);
          selectedLabel = matched ? (matched.label || '') : '';
        }

        // 7. Add console logs for: selected deviceId, selected camera label
        console.log("Selected deviceId:", selectedDeviceId);
        console.log("Selected camera label:", selectedLabel);

        // 6. Pass the selected camera using exact deviceId into the QR scanner library configuration
        if (selectedDeviceId) {
          console.log(`Starting camera with exact deviceId: ${selectedDeviceId} (${selectedLabel})`);
          try {
            await html5QrCode.start(
              { deviceId: { exact: selectedDeviceId } },
              config,
              successCallback,
              () => {}
            );
            await applyCameraZoom();
          } catch (exactErr) {
            console.warn("Failed to start with exact deviceId constraint, trying deviceId as string string", exactErr);
            try {
              await html5QrCode.start(selectedDeviceId, config, successCallback, () => {});
              await applyCameraZoom();
            } catch (stringErr) {
              console.warn("Failed to start with deviceId string, falling back to facingMode", stringErr);
              // Final fallback to keep Android and other browsers fully compatible
              await html5QrCode.start(
                { facingMode: { exact: activeFacingMode } },
                config,
                successCallback,
                () => {}
              );
              await applyCameraZoom();
            }
          }
        } else {
          // Fallback if no device list was available yet (e.g. before permissions are granted)
          console.log(`No device ID determined yet. Starting with facingMode: ${activeFacingMode}`);
          await html5QrCode.start(
            { facingMode: { exact: activeFacingMode } },
            config,
            successCallback,
            () => {}
          );
          await applyCameraZoom();
        }

        // Query devices again now that permission is granted so we get populated labels and full device list
        const refreshedDevices = await navigator.mediaDevices.enumerateDevices();
        const refreshedList = refreshedDevices.filter(d => d.kind === 'videoinput');
        setCameras(refreshedList || []);

        // If activeCameraId was not set (e.g. initial start on a fresh permission prompt),
        // we determine if there is a better matching camera in the newly resolved list and auto-promote to it.
        if (refreshedList && refreshedList.length > 0 && !activeCameraId) {
          const rearCamera = refreshedList.find(cam => {
            const label = (cam.label || '').toLowerCase();
            return label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('facing 1') || label.includes('camera 2');
          });

          const frontCamera = refreshedList.find(cam => {
            const label = (cam.label || '').toLowerCase();
            return label.includes('front') || label.includes('user') || label.includes('facing 0') || label.includes('forward');
          });

          if (activeFacingMode === 'environment') {
            if (rearCamera && rearCamera.deviceId !== selectedDeviceId) {
              console.log(`Auto-switching to detected rear camera: ${rearCamera.label}`);
              setActiveCameraId(rearCamera.deviceId);
            } else {
              setActiveCameraId(selectedDeviceId || refreshedList[0].deviceId);
            }
          } else {
            if (frontCamera && frontCamera.deviceId !== selectedDeviceId) {
              console.log(`Auto-switching to detected front camera: ${frontCamera.label}`);
              setActiveCameraId(frontCamera.deviceId);
            } else {
              setActiveCameraId(selectedDeviceId || refreshedList[0].deviceId);
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
        html5QrCode
          .stop()
          .then(() => html5QrCode.clear())
          .catch(err => console.error("Unmount cleanup failed:", err));
      } else if (html5QrCode) {
        Promise.resolve()
          .then(() => html5QrCode.clear())
          .catch(err => console.error("Unmount clear failed:", err));
      }
    };
  }, [state, activeCameraId, activeFacingMode, scannerRestartKey]);

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

  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const canSwitchCamera = cameras.length > 1 || isMobileDevice;

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

          <div id="reader" key={scannerRestartKey}></div>
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
          {canSwitchCamera && (
            <button
              onClick={handleSwitchCamera}
              className="camera-switch-btn"
              disabled={isSwitchingCamera}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>{isSwitchingCamera ? 'Switching...' : 'Switch Camera'}</span>
            </button>
          )}
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
