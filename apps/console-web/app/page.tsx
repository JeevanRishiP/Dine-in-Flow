'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  authenticateUser,
  getLoggedInUser,
  setLoggedInUser,
  clearLoggedInUser,
  isOwnerSessionActive,
  getStoredOwnerPassword,
  type StaffMember,
} from './lib/restaurant-db';

interface CredentialPreset {
  label: string;
  emoji: string;
  role: string;
  identifier: string;
  secret: string;
  badge: string;
}

export default function CommonLoginPage() {
  const router = useRouter();

  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeSessionUser, setActiveSessionUser] = useState<StaffMember | null>(null);

  // Check existing session on mount
  useEffect(() => {
    const existing = getLoggedInUser();
    if (existing) {
      setActiveSessionUser(existing);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = authenticateUser(identifier, secret);
    if (!result.success || !result.user) {
      setError(result.error || 'Invalid credentials. Please verify username and password/PIN.');
      setLoading(false);
      return;
    }

    const user = result.user;
    setLoggedInUser(user);

    if (user.role === 'OWNER') {
      router.push('/owner');
    } else {
      router.push('/staff');
    }
  };

  const handleSignOutExisting = () => {
    clearLoggedInUser();
    setActiveSessionUser(null);
    setIdentifier('');
    setSecret('');
    setError('');
  };

  const handleContinueSession = () => {
    if (!activeSessionUser) return;
    if (activeSessionUser.role === 'OWNER') {
      router.push('/owner');
    } else {
      router.push('/staff');
    }
  };

  const presets: CredentialPreset[] = [
    {
      label: 'Kitchen KDS',
      emoji: '🍳',
      role: 'KITCHEN',
      identifier: 'kitchen',
      secret: '2345',
      badge: 'PIN: 2345',
    },
    {
      label: 'Floor Captain',
      emoji: '🪑',
      role: 'CAPTAIN',
      identifier: 'captain',
      secret: '1234',
      badge: 'PIN: 1234',
    },
    {
      label: 'Cashier / POS',
      emoji: '💳',
      role: 'CASHIER',
      identifier: 'cashier',
      secret: '3456',
      badge: 'PIN: 3456',
    },
    {
      label: 'Table Waiter',
      emoji: '🤵',
      role: 'WAITER',
      identifier: 'waiter',
      secret: '7890',
      badge: 'PIN: 7890',
    },
    {
      label: 'Floor Manager',
      emoji: '📋',
      role: 'MANAGER',
      identifier: 'manager',
      secret: '5678',
      badge: 'PIN: 5678',
    },
    {
      label: 'Group Owner',
      emoji: '👑',
      role: 'OWNER',
      identifier: 'owner',
      secret: typeof window !== 'undefined' ? getStoredOwnerPassword() : 'ExecutiveSecure2026!',
      badge: 'Master Pass',
    },
  ];

  const applyPreset = (preset: CredentialPreset) => {
    setIdentifier(preset.identifier);
    setSecret(preset.secret);
    setError('');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'radial-gradient(circle at 50% 15%, #131d33 0%, #080c14 75%)',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: '480px', width: '100%', textAlign: 'center' }}>
        {/* Brand Logo & Heading */}
        <div
          style={{
            width: '64px',
            height: '64px',
            background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            margin: '0 auto 16px',
            boxShadow: '0 8px 30px rgba(6, 182, 212, 0.45)',
          }}
        >
          ⚡
        </div>

        <h1
          style={{
            fontSize: '1.9rem',
            fontWeight: 800,
            marginBottom: '6px',
            letterSpacing: '-0.02em',
          }}
        >
          DineFlow Restaurant Operations
        </h1>
        <p
          style={{
            color: '#94a3b8',
            fontSize: '0.92rem',
            marginBottom: '28px',
          }}
        >
          Unified Login for Restaurant Staff & Business Owners
        </p>

        {/* ACTIVE SESSION CARD (If user is currently logged in) */}
        {activeSessionUser && (
          <div
            style={{
              background: 'rgba(6, 182, 212, 0.1)',
              border: '1.5px solid rgba(6, 182, 212, 0.35)',
              borderRadius: '14px',
              padding: '18px 20px',
              marginBottom: '24px',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <span style={{ fontSize: '28px' }}>{activeSessionUser.avatar}</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#fff' }}>
                  {activeSessionUser.name}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                  Active Station: {activeSessionUser.role}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleContinueSession}
                className="btn-primary"
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Go to Station →
              </button>
              <button
                onClick={handleSignOutExisting}
                style={{
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#f87171',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        )}

        {/* LOGIN FORM CARD */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(20px)',
            border: '1.5px solid var(--border-card)',
            borderRadius: '16px',
            padding: '28px 24px',
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
            textAlign: 'left',
          }}
        >
          {error && (
            <div
              style={{
                background: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid var(--accent-rose)',
                color: '#fff',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                marginBottom: '18px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: '#cbd5e1',
                  marginBottom: '6px',
                }}
              >
                Username, Role, or Email
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                placeholder="e.g. kitchen, captain, cashier, waiter, or owner"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="form-input"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: '0.92rem',
                  borderRadius: '10px',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: '#cbd5e1',
                  marginBottom: '6px',
                }}
              >
                Password or 4-Digit PIN
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showSecret ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Enter password or 4-digit PIN"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  className="form-input"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    paddingRight: '42px',
                    fontSize: '0.92rem',
                    borderRadius: '10px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  title={showSecret ? 'Hide Secret' : 'Show Secret'}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '16px',
                  }}
                >
                  {showSecret ? '🙈' : '👁️'}
                </button>
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '6px' }}>
                Staff can log in with their 4-digit PIN or password assigned by the Owner.
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '0.95rem',
                fontWeight: 800,
                borderRadius: '10px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginTop: '4px',
              }}
            >
              <span>{loading ? 'Authenticating...' : 'Sign In to Station'}</span>
              <span>→</span>
            </button>
          </form>

          {/* QUICK-FILL TEST CREDENTIALS */}
          <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-light)', paddingTop: '20px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
              }}
            >
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Quick Credential Fill
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)' }}>Tap to populate</span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
              }}
            >
              {presets.map((preset) => (
                <button
                  key={preset.role}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: identifier.toLowerCase() === preset.identifier ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                    border: identifier.toLowerCase() === preset.identifier ? '1px solid var(--accent-cyan)' : '1px solid var(--border-light)',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '15px' }}>{preset.emoji}</span>
                    <span style={{ fontWeight: 700 }}>{preset.label}</span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      color: '#94a3b8',
                      fontFamily: 'monospace',
                      background: 'rgba(255, 255, 255, 0.06)',
                      padding: '2px 5px',
                      borderRadius: '4px',
                    }}
                  >
                    {preset.badge}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Security & Multi-tenant Note */}
        <div style={{ marginTop: '20px', fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>
          🔒 Multi-tenant station isolation enforced · Staff accounts require signing out before switching profiles · Executive owners have instant multi-station access.
        </div>
      </div>
    </div>
  );
}
