import React, { useState } from 'react';
import VisitorCard from './VisitorCard';

export default function VisitorCheckIn({ networkInfo, onGoToAdmin }) {
  // Check-In Form State
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [needsEmployeeId, setNeedsEmployeeId] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // On-Spot Registration Form State
  const [regName, setRegName] = useState('');
  const [regEmployeeId, setRegEmployeeId] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState(null);

  // Common Success State
  const [successVisitor, setSuccessVisitor] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const resetForm = () => {
    setName('');
    setEmployeeId('');
    setNeedsEmployeeId(false);
    setError(null);

    setRegName('');
    setRegEmployeeId('');
    setRegEmail('');
    setRegError(null);

    setSuccessVisitor(null);
    setSuccessMessage('');
  };

  const handleCheckIn = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (needsEmployeeId && !employeeId.trim()) {
      setError('Please enter your Employee ID.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 1. Look up visitor by name (+ employeeId if required)
      const lookupRes = await fetch('/api/visitors/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          employeeId: employeeId.trim() || undefined
        })
      });
      
      const lookupData = await lookupRes.json();

      if (lookupData.requiresEmployeeId) {
        setNeedsEmployeeId(true);
        setLoading(false);
        return;
      }

      if (!lookupRes.ok) {
        throw new Error(lookupData.error || 'Lookup failed.');
      }

      // 2. Check in the found visitor
      const checkinRes = await fetch(`/api/visitors/${lookupData.id}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const checkinData = await checkinRes.json();

      if (!checkinRes.ok) {
        throw new Error(checkinData.error || 'Check-in failed.');
      }

      // Check-in success
      setSuccessMessage('Check-In Successful');
      setSuccessVisitor(checkinData.visitor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!regName.trim()) {
      setRegError('Please enter your full name.');
      return;
    }
    if (!regEmployeeId.trim()) {
      setRegError('Please enter your Employee ID.');
      return;
    }
    if (!regEmail.trim()) {
      setRegError('Please enter your email.');
      return;
    }

    try {
      setRegLoading(true);
      setRegError(null);

      const res = await fetch('/api/visitors/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          employeeId: regEmployeeId.trim(),
          email: regEmail.trim()
        })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Registration failed.');
      }

      // Registration success
      setSuccessMessage('Registration Successful');
      setSuccessVisitor(data);
    } catch (err) {
      setRegError(err.message);
    } finally {
      setRegLoading(false);
    }
  };

  const handleNameChange = (val) => {
    setName(val);
    setError(null);
    if (needsEmployeeId) {
      setNeedsEmployeeId(false);
      setEmployeeId('');
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '0.9rem 1.1rem',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: 'white',
    fontSize: '1rem',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  // If successfully checked in or registered, show the badge card inline
  if (successVisitor) {
    return (
      <VisitorCard 
        visitor={successVisitor} 
        networkInfo={networkInfo} 
        onBack={resetForm}
        onPrintSuccess={resetForm}
        successMessage={successMessage}
      />
    );
  }

  return (
    <div className="reg-page">
      {/* Background grid + glows */}
      <div className="display-glow-bl" />
      <div className="display-glow-tr" />

      {/* Central Check-In card */}
      <div className="reg-card">
        {/* Branding */}
        <div className="reg-header">
          <div className="reg-logo">✦</div>
          <h1 className="reg-title">Event Check-In</h1>
          <p className="reg-subtitle">Enter your name to check in and generate your pass</p>
        </div>

        <form onSubmit={handleCheckIn} className="reg-form">
          <div className="reg-field">
            <label className="reg-label">Full Name</label>
            <input
              type="text"
              placeholder="e.g. Arjun Sharma"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              style={inputStyle}
              disabled={loading}
              autoFocus
            />
          </div>

          {needsEmployeeId && (
            <div className="reg-field reg-field--slide">
              <div className="reg-duplicate-notice">
                <span className="reg-duplicate-icon">⚠</span>
                Multiple registrations found with this name. Please enter your Employee ID.
              </div>
              <label className="reg-label">Employee ID</label>
              <input
                type="text"
                placeholder="e.g. EMP-003"
                value={employeeId}
                onChange={e => { setEmployeeId(e.target.value); setError(null); }}
                style={inputStyle}
                disabled={loading}
                autoFocus
              />
            </div>
          )}

          {error && <div className="reg-error">⚠ {error}</div>}

          <button type="submit" className="reg-btn" disabled={loading}>
            {loading
              ? <><span className="reg-btn-spinner" /> Checking In…</>
              : '→ Check In & Get Pass'}
          </button>
        </form>
      </div>

      {/* Central On-Spot Registration card */}
      <div className="reg-card">
        {/* Branding */}
        <div className="reg-header">
          <div className="reg-logo">✦</div>
          <h1 className="reg-title">On-Spot Registration</h1>
          <p className="reg-subtitle">Register to generate your event QR pass instantly</p>
        </div>

        <form onSubmit={handleRegister} className="reg-form">
          <div className="reg-field">
            <label className="reg-label">Full Name</label>
            <input
              type="text"
              placeholder="e.g. Sneha Reddy"
              value={regName}
              onChange={e => { setRegName(e.target.value); setRegError(null); }}
              style={inputStyle}
              disabled={regLoading}
            />
          </div>

          <div className="reg-field">
            <label className="reg-label">Employee ID</label>
            <input
              type="text"
              placeholder="e.g. EMP-011"
              value={regEmployeeId}
              onChange={e => { setRegEmployeeId(e.target.value); setRegError(null); }}
              style={inputStyle}
              disabled={regLoading}
            />
          </div>

          <div className="reg-field">
            <label className="reg-label">Email Address</label>
            <input
              type="email"
              placeholder="e.g. sneha@company.com"
              value={regEmail}
              onChange={e => { setRegEmail(e.target.value); setRegError(null); }}
              style={inputStyle}
              disabled={regLoading}
            />
          </div>

          {regError && <div className="reg-error">⚠ {regError}</div>}

          <button type="submit" className="reg-btn" disabled={regLoading}>
            {regLoading
              ? <><span className="reg-btn-spinner" /> Registering…</>
              : '✦ Register & Get QR Pass'}
          </button>

          <p className="reg-note">
            Your details will be saved instantly and your QR pass will be generated immediately.
          </p>
        </form>
      </div>

      {/* Admin link (scrollable at bottom) */}
      <button
        className="reg-admin-link"
        onClick={onGoToAdmin}
        type="button"
      >
        🔐 Admin Console
      </button>
    </div>
  );
}
