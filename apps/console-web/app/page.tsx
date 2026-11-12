'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  getConsoleAuthState,
  loginStaffRemote,
  verifyStaffMfaRemote,
  logoutStaffRemote,
  isAuthStateExpired,
  type StaffSessionUser,
} from './lib/auth-client';

export default function CommonLoginPage() {
  const router = useRouter();

  const [orgSlug, setOrgSlug] = useState(
    () => process.env['NEXT_PUBLIC_DEFAULT_ORG_SLUG'] || '',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loginStep, setLoginStep] = useState<'CREDENTIALS' | 'MFA'>('CREDENTIALS');
  const [preMfaToken, setPreMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeSessionUser, setActiveSessionUser] = useState<StaffSessionUser | null>(null);

  useEffect(() => {
    const existing = getConsoleAuthState();
    if (existing && !isAuthStateExpired(existing, 0)) {
      setActiveSessionUser(existing.user);
    }
  }, []);

  const routeForRole = (role: string) => {
    if (role.toUpperCase() === 'OWNER') {
      router.push('/owner');
    } else {
      router.push('/staff');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (loginStep === 'CREDENTIALS') {
      const result = await loginStaffRemote({ orgSlug, email, password });
      setLoading(false);
      if (!result.ok) {
        setError(result.error || 'Invalid credentials. Please check workspace, email, and password.');
        return;
      }
      if (result.requiresMfa && result.preMfaToken) {
        setPreMfaToken(result.preMfaToken);
        setMfaCode('');
        setLoginStep('MFA');
        return;
      }
      if (result.session) {
        routeForRole(result.session.user.role);
      }
      return;
    }

    const mfaRes = await verifyStaffMfaRemote({
      preMfaToken,
      code: mfaCode,
      orgSlug,
      email,
    });
    setLoading(false);
    if (!mfaRes.ok || !mfaRes.session) {
      setError(mfaRes.error || 'Invalid authenticator or recovery code.');
      return;
    }
    routeForRole(mfaRes.session.user.role);
  };

  const handleSignOutExisting = async () => {
    await logoutStaffRemote();
    setActiveSessionUser(null);
    setEmail('');
    setPassword('');
    setPreMfaToken('');
    setMfaCode('');
    setLoginStep('CREDENTIALS');
    setError('');
  };

  const handleContinueSession = () => {
    if (!activeSessionUser) return;
    routeForRole(activeSessionUser.role);
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
              <span style={{ fontSize: '28px' }}>
                {activeSessionUser.avatar || (activeSessionUser.role === 'OWNER' ? '👔' : '👤')}
              </span>
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
            {loginStep === 'CREDENTIALS' ? (
              <>
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
                    Organization Workspace Slug
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="organization"
                    placeholder="e.g. royal-spice-bistro"
                    value={orgSlug}
                    onChange={(e) => setOrgSlug(e.target.value)}
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
                    Staff Email
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="staff@restaurant.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                    Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showSecret ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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
                      title={showSecret ? 'Hide Password' : 'Show Password'}
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
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                  Enter the 6-digit authenticator code (or recovery code) for <strong>{email}</strong>.
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
                    Authenticator Code
                  </label>
                  <input
                    type="text"
                    required
                    minLength={6}
                    maxLength={32}
                    autoFocus
                    placeholder="6-digit TOTP code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="form-input"
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      fontSize: '1rem',
                      letterSpacing: '2px',
                      textAlign: 'center',
                      borderRadius: '10px',
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLoginStep('CREDENTIALS');
                    setPreMfaToken('');
                    setMfaCode('');
                    setError('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: 0,
                  }}
                >
                  ← Back to credentials
                </button>
              </>
            )}

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
              <span>
                {loading
                  ? 'Authenticating...'
                  : loginStep === 'MFA'
                  ? 'Verify MFA & Sign In'
                  : 'Sign In to Station'}
              </span>
              <span>→</span>
            </button>
          </form>
        </div>

        {/* Security & Multi-tenant Note */}
        <div style={{ marginTop: '20px', fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>
          🔒 Multi-tenant JWT & MFA authentication enforced · Server-validated station RBAC and outlet isolation active.
        </div>
      </div>
    </div>
  );
}
