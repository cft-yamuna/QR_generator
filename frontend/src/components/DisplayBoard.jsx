import React, { useState, useEffect, useRef } from 'react';

export default function DisplayBoard() {
  const [lastVisitor, setLastVisitor] = useState(null);
  const [animKey, setAnimKey] = useState(0); // changes on new guest to retrigger animation
  const lastIdRef = useRef(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/last-checkin');
        if (!res.ok) return;
        const data = await res.json();

        // data is null (no check-ins yet) or a visitor object
        const newId = data ? data.id + '_' + data.gateScannedAt : null;
        if (newId !== lastIdRef.current) {
          lastIdRef.current = newId;
          setLastVisitor(data);
          setAnimKey(k => k + 1); // retrigger entry animation
        }
      } catch (e) {
        // silently ignore network errors
      }
    };

    poll(); // immediate first call
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="display-board">
      {/* Deep grid background ambient glows */}
      <div className="display-glow-bl" />
      <div className="display-glow-tr" />

      {/* Flowing Waves SVG */}
      <svg className="waves-svg" viewBox="0 0 1000 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id="db-goldGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#f9e8a2" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#b8860b" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="db-blueGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="db-glowGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#082f49" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#1e40af" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d="M-100,550 C150,500 300,250 600,180 C750,140 900,100 1100,50 L1100,650 L-100,650 Z" fill="url(#db-glowGrad)" opacity="0.4" />
        <path d="M-100,600 C200,520 350,320 700,270 C850,240 950,160 1100,100 L1100,650 L-100,650 Z" fill="rgba(30, 64, 175, 0.25)" />

        <path d="M-50,540 Q250,380 500,420 T1050,120" fill="none" stroke="url(#db-blueGrad)" strokeWidth="3" opacity="0.6" />
        <path d="M-50,560 Q300,430 550,440 T1050,170" fill="none" stroke="url(#db-blueGrad)" strokeWidth="1.5" opacity="0.4" />

        <path d="M-50,490 Q200,430 450,280 T1050,60" fill="none" stroke="url(#db-goldGrad)" strokeWidth="4" />
        <path d="M-50,510 Q220,450 470,300 T1050,80" fill="none" stroke="url(#db-goldGrad)" strokeWidth="1.5" opacity="0.75" />
        <path d="M-50,470 Q180,410 430,260 T1050,40" fill="none" stroke="url(#db-goldGrad)" strokeWidth="1" opacity="0.4" />
      </svg>

      {/* Floating Sparkles */}
      <div className="sparkles-container">
        <span className="sparkle" style={{ left: '5%',  animationDelay: '0s',  animationDuration: '8s' }}></span>
        <span className="sparkle" style={{ left: '15%', animationDelay: '2s',  animationDuration: '10s' }}></span>
        <span className="sparkle" style={{ left: '28%', animationDelay: '4s',  animationDuration: '7s' }}></span>
        <span className="sparkle" style={{ left: '40%', animationDelay: '1s',  animationDuration: '9s' }}></span>
        <span className="sparkle" style={{ left: '55%', animationDelay: '5s',  animationDuration: '11s' }}></span>
        <span className="sparkle" style={{ left: '68%', animationDelay: '3s',  animationDuration: '8s' }}></span>
        <span className="sparkle" style={{ left: '80%', animationDelay: '6s',  animationDuration: '12s' }}></span>
        <span className="sparkle" style={{ left: '92%', animationDelay: '7s',  animationDuration: '9s' }}></span>
      </div>

      {/* Main Content */}
      {lastVisitor ? (
        // Active Guest Mode — re-animates on every new guest via animKey
        <div key={animKey} className="display-content">
          <p className="display-greeting-label">Welcome to the Event</p>

          <h1 className="welcome-text-serif display-hi-heading">
            Hi, <span className="gold-text-gradient">{lastVisitor.name}</span>
          </h1>

          <div className="info-paragraph display-info-para">
            <p>We are thrilled to gather industry leaders and creative minds under one roof.</p>
            <p>Today is about exploring the future of innovation, technology, and design.</p>
            <p>Prepare to engage in inspiring keynotes and networking sessions.</p>
            <p>Your presence adds immense value to our community and discussions.</p>
            <p>We hope you have an extraordinary and memorable experience with us.</p>
          </div>

          <div className="display-badge-label">
            <span className="display-badge-dot"></span>
            Just checked in
          </div>
        </div>
      ) : (
        // Standby Mode
        <div key="standby" className="display-content">
          <div className="display-standby-icon">✦</div>
          <h1 className="welcome-text-serif display-standby-heading">
            Welcome to the <span className="gold-text-gradient">Event</span>
          </h1>
          <p className="delighted-subtitle display-standby-sub">
            Please scan your QR badge at the entry gate
          </p>
        </div>
      )}
    </div>
  );
}
