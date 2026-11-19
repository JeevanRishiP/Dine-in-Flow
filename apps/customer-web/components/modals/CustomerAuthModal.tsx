'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { saveCustomerAuth, customerApiFetch } from '../../app/lib/guest-session';
import {
  formatNormalizedPhone,
  isValidPhoneNumber,
  isValidEmail,
  resolveCustomerAuthOrgId,
} from './auth-utils';

export interface AuthenticatedCustomerData {
  accessToken: string;
  customerId: string;
  phone?: string;
  email?: string | null;
  displayName?: string | null;
  loyaltyPoints?: number;
}

export interface CustomerAuthModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onAuthSuccess?: (data: AuthenticatedCustomerData, phone: string) => void | Promise<void>;
  orgId?: string;
  initialMode?: 'SIGNIN' | 'SIGNUP';
}

interface GoogleAccountsGlobal {
  accounts?: {
    id?: {
      initialize: (cfg: { client_id: string; callback: (resp: { credential?: string }) => void }) => void;
      prompt: () => void;
    };
  };
}

export const CustomerAuthModal: React.FC<CustomerAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  orgId: propOrgId,
  initialMode = 'SIGNIN',
}) => {
  const storeIsOpen = useOrderStore((s) => s.isAuthModalOpen);
  const storeSetIsOpen = useOrderStore((s) => s.setIsAuthModalOpen);
  const storeOrgId = useOrderStore((s) => s.activeOrgId);
  const pendingCouponCode = useOrderStore((s) => s.pendingCouponCode);

  const activeIsOpen = isOpen !== undefined ? isOpen : storeIsOpen;

  // Internal presentation & interaction state
  const [isClosing, setIsClosing] = useState(false);
  const [authMode, setAuthMode] = useState<'SIGNIN' | 'SIGNUP'>(initialMode);
  const [authStep, setAuthStep] = useState<'PHONE' | 'OTP'>('PHONE');
  const [customerPhoneInput, setCustomerPhoneInput] = useState('');
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authEmailLocked, setAuthEmailLocked] = useState(false);
  const [authDisplayNameInput, setAuthDisplayNameInput] = useState('');
  const [googlePreRegToken, setGooglePreRegToken] = useState<string | null>(null);
  const [authChannelLabel, setAuthChannelLabel] = useState<'WhatsApp' | 'SMS' | null>(null);
  const [customerOtpInput, setCustomerOtpInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authDevCode, setAuthDevCode] = useState<string | null>(null);
  const [authError, setAuthError] = useState('');

  // Dev Google picker state
  const [showDevGooglePicker, setShowDevGooglePicker] = useState(false);
  const [devGoogleEmailInput, setDevGoogleEmailInput] = useState('');
  const [devGoogleNameInput, setDevGoogleNameInput] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (activeIsOpen) {
      setIsClosing(false);
      setAuthMode(initialMode);
      setAuthStep('PHONE');
      setAuthError('');
      setAuthDevCode(null);
      setShowDevGooglePicker(false);
      if (initialMode === 'SIGNIN') {
        setAuthEmailLocked(false);
        setGooglePreRegToken(null);
      }
    }
  }, [activeIsOpen, initialMode]);

  const getTargetOrgId = useCallback((): string => {
    return propOrgId || resolveCustomerAuthOrgId(storeOrgId);
  }, [propOrgId, storeOrgId]);

  const handleClose = useCallback(() => {
    if (!activeIsOpen || isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      if (onClose) {
        onClose();
      } else {
        storeSetIsOpen(false);
      }
    }, 260);
  }, [activeIsOpen, isClosing, onClose, storeSetIsOpen]);

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthDevCode(null);
    setAuthChannelLabel(null);

    const targetOrgId = getTargetOrgId();
    if (!targetOrgId) {
      setAuthError('Select a hotel table first before signing in.');
      setAuthLoading(false);
      return;
    }

    const formattedPhone = formatNormalizedPhone(customerPhoneInput);
    if (!isValidPhoneNumber(formattedPhone)) {
      setAuthError('Enter a valid 10-digit mobile number.');
      setAuthLoading(false);
      return;
    }

    const emailTrimmed = authEmailInput.trim();
    if (authMode === 'SIGNUP' && !isValidEmail(emailTrimmed)) {
      setAuthError('Enter a valid email ID to link to your mobile number.');
      setAuthLoading(false);
      return;
    }

    try {
      const res = await customerApiFetch(
        '/api/v1/auth/customer/otp/request',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone: formattedPhone,
            mode: authMode,
            ...(authMode === 'SIGNUP' ? { email: emailTrimmed } : {}),
          }),
        },
        { orgIdOverride: targetOrgId },
      );

      const data = (await res.json().catch(() => ({}))) as {
        detail?: string;
        message?: string;
        channel?: string;
        devCode?: string;
      };

      if (!res.ok) {
        setAuthError(data.detail || data.message || 'Unable to send WhatsApp OTP code.');
        return;
      }

      if (data.channel === 'WHATSAPP') {
        setAuthChannelLabel('WhatsApp');
      } else {
        setAuthChannelLabel('SMS');
      }

      if (data.devCode) {
        setAuthDevCode(data.devCode);
        setCustomerOtpInput(data.devCode);
      } else {
        setCustomerOtpInput('');
      }

      setAuthStep('OTP');
    } catch {
      setAuthError('Network error requesting OTP.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    const targetOrgId = getTargetOrgId();
    if (!targetOrgId) {
      setAuthError('Select a hotel table first before verifying OTP.');
      setAuthLoading(false);
      return;
    }

    const formattedPhone = formatNormalizedPhone(customerPhoneInput);
    const enteredCode = customerOtpInput.trim();
    const emailTrimmed = authEmailInput.trim();

    try {
      const res = await customerApiFetch(
        '/api/v1/auth/customer/otp/verify',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone: formattedPhone,
            code: enteredCode,
            ...(authMode === 'SIGNUP' && emailTrimmed ? { email: emailTrimmed } : {}),
            ...(authDisplayNameInput.trim() ? { displayName: authDisplayNameInput.trim() } : {}),
            ...(googlePreRegToken ? { googlePreRegToken } : {}),
          }),
        },
        { orgIdOverride: targetOrgId },
      );

      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        customerId?: string;
        phone?: string;
        email?: string | null;
        displayName?: string | null;
        loyaltyPoints?: number;
        detail?: string;
        message?: string;
      };

      if (res.ok && data.accessToken && data.customerId) {
        const payload: AuthenticatedCustomerData = {
          accessToken: data.accessToken,
          customerId: data.customerId,
          phone: data.phone || formattedPhone,
          email: data.email,
          displayName: data.displayName,
          loyaltyPoints: data.loyaltyPoints,
        };

        saveCustomerAuth({ accessToken: payload.accessToken, customerId: payload.customerId });
        handleClose();

        if (onAuthSuccess) {
          await onAuthSuccess(payload, formattedPhone);
        }
        return;
      }

      setAuthError(data.detail || data.message || 'Invalid verification code. Please check and try again.');
    } catch {
      setAuthError('Network error connecting to authentication API.');
    } finally {
      setAuthLoading(false);
    }
  };

  const submitGoogleAuthPayload = async (payload: {
    idToken?: string;
    devMockEmail?: string;
    devMockName?: string;
  }) => {
    const targetOrgId = getTargetOrgId();
    if (!targetOrgId) {
      setAuthError('Select a hotel table first before signing in with Google.');
      return;
    }

    setAuthLoading(true);
    setAuthError('');

    try {
      const res = await customerApiFetch(
        '/api/v1/auth/customer/google',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        { orgIdOverride: targetOrgId },
      );

      const data = (await res.json().catch(() => ({}))) as {
        registered?: boolean;
        accessToken?: string;
        customerId?: string;
        phone?: string;
        email?: string;
        suggestedName?: string;
        googlePreRegToken?: string;
        detail?: string;
        message?: string;
      };

      if (!res.ok) {
        setAuthError(data.detail || data.message || 'Google sign-in failed.');
        return;
      }

      if (data.registered && data.accessToken && data.customerId) {
        const authData: AuthenticatedCustomerData = {
          accessToken: data.accessToken,
          customerId: data.customerId,
          phone: data.phone,
          email: data.email,
        };

        saveCustomerAuth({ accessToken: authData.accessToken, customerId: authData.customerId });
        handleClose();

        if (onAuthSuccess) {
          await onAuthSuccess(authData, data.phone || '');
        }
        return;
      }

      // Email is not registered -> route directly to registration to link mobile via WhatsApp OTP
      setAuthMode('SIGNUP');
      setAuthStep('PHONE');
      setAuthEmailInput(data.email || payload.devMockEmail || '');
      setAuthEmailLocked(true);
      setGooglePreRegToken(data.googlePreRegToken || null);
      if (data.suggestedName || payload.devMockName) {
        setAuthDisplayNameInput(data.suggestedName || payload.devMockName || '');
      }
      setShowDevGooglePicker(false);
      setAuthError(
        `${data.email || 'This Google email'} is not registered yet. Enter your mobile number to verify via WhatsApp OTP and complete sign up.`,
      );
    } catch {
      setAuthError('Network error during Google sign-in.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLoginClick = () => {
    setAuthError('');
    const googleClientId = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] || '';
    if (!googleClientId) {
      if (process.env.NODE_ENV !== 'production') {
        setShowDevGooglePicker((prev) => !prev);
      } else {
        setAuthError('Google Sign-In is not configured for this environment yet.');
      }
      return;
    }

    const startGisPrompt = () => {
      const googleGlobal = (window as unknown as { google?: GoogleAccountsGlobal }).google;
      if (!googleGlobal?.accounts?.id) {
        setAuthError('Google Identity Services could not initialize.');
        return;
      }
      googleGlobal.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp: { credential?: string }) => {
          if (resp.credential) {
            void submitGoogleAuthPayload({ idToken: resp.credential });
          } else {
            setAuthError('No Google credential returned.');
          }
        },
      });
      googleGlobal.accounts.id.prompt();
    };

    const existingGoogle = (window as unknown as { google?: GoogleAccountsGlobal }).google;
    if (existingGoogle?.accounts?.id) {
      startGisPrompt();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = startGisPrompt;
    script.onerror = () => setAuthError('Failed to load Google Sign-In script.');
    document.head.appendChild(script);
  };

  if (!activeIsOpen) return null;

  return (
    <div
      className={`bottom-auth-overlay ${isClosing ? 'closing' : ''}`}
      onClick={handleClose}
    >
      <div
        className={`bottom-auth-sheet ${isClosing ? 'closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h3 style={{ fontSize: '1.12rem', fontWeight: 800, color: '#fff', margin: 0 }}>
              {authStep === 'OTP'
                ? 'Verify WhatsApp OTP'
                : authMode === 'SIGNUP'
                ? 'Create Dining Account'
                : 'Sign In to Dining Account'}
            </h3>
            <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600 }}>
              💬 Mobile number verified via WhatsApp OTP · Session saved on device
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{ color: '#94a3b8', fontSize: '1.15rem', padding: '4px 8px', cursor: 'pointer', background: 'transparent', border: 'none' }}
            aria-label="Close authentication drawer"
          >
            ✕
          </button>
        </div>

        {pendingCouponCode && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#fbbf24',
              fontSize: '0.84rem',
              fontWeight: 700,
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>🏷️</span>
            <span>Log in or sign up to apply coupon <strong>{pendingCouponCode}</strong></span>
          </div>
        )}

        {authStep === 'PHONE' && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                background: 'rgba(255,255,255,0.04)',
                padding: '4px',
                borderRadius: '10px',
                marginBottom: '14px',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setAuthMode('SIGNIN');
                  setAuthError('');
                  setAuthEmailLocked(false);
                  setGooglePreRegToken(null);
                }}
                style={{
                  padding: '8px',
                  borderRadius: '8px',
                  border: 'none',
                  background: authMode === 'SIGNIN' ? 'rgba(245, 158, 11, 0.22)' : 'transparent',
                  color: authMode === 'SIGNIN' ? '#fbbf24' : '#94a3b8',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('SIGNUP');
                  setAuthError('');
                }}
                style={{
                  padding: '8px',
                  borderRadius: '8px',
                  border: 'none',
                  background: authMode === 'SIGNUP' ? 'rgba(245, 158, 11, 0.22)' : 'transparent',
                  color: authMode === 'SIGNUP' ? '#fbbf24' : '#94a3b8',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Sign Up (New)
              </button>
            </div>

            <form onSubmit={handleRequestOtp} style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '5px' }}>
                  Mobile Number (Primary ID)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: '8px',
                      color: '#94a3b8',
                      fontSize: '0.88rem',
                    }}
                  >
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="9876543210"
                    value={customerPhoneInput}
                    onChange={(e) => setCustomerPhoneInput(e.target.value.replace(/[^\d+]/g, ''))}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '0.92rem',
                    }}
                  />
                </div>
              </div>

              {authMode === 'SIGNUP' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '5px' }}>
                      Email ID (1 email per mobile number){authEmailLocked ? ' · Verified via Google' : ''}
                    </label>
                    <input
                      type="email"
                      required
                      readOnly={authEmailLocked}
                      placeholder="you@example.com"
                      value={authEmailInput}
                      onChange={(e) => setAuthEmailInput(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: authEmailLocked ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.06)',
                        border: authEmailLocked
                          ? '1px solid rgba(16, 185, 129, 0.45)'
                          : '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '5px' }}>
                      Full Name (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={authDisplayNameInput}
                      onChange={(e) => setAuthDisplayNameInput(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </>
              )}

              {authError && <div style={{ color: '#f87171', fontSize: '0.79rem', fontWeight: 600 }}>{authError}</div>}

              <button className="accordion-add-action-btn" type="submit" disabled={authLoading} style={{ marginTop: '2px' }}>
                {authLoading
                  ? 'Sending WhatsApp OTP...'
                  : authMode === 'SIGNUP'
                  ? 'Verify Mobile via WhatsApp OTP & Sign Up 📲'
                  : 'Send WhatsApp OTP Code 📲'}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '14px 0' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
              <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>OR</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
            </div>

            <button
              type="button"
              onClick={handleGoogleLoginClick}
              disabled={authLoading}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '10px',
                background: '#fff',
                color: '#111827',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <span>G</span>
              <span>Continue with Google</span>
            </button>

            {showDevGooglePicker && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '12px',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px dashed rgba(245, 158, 11, 0.4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '0.74rem', color: '#fbbf24', fontWeight: 700 }}>
                  Dev Google Sign-In Picker (NEXT_PUBLIC_GOOGLE_CLIENT_ID unset)
                </div>
                <input
                  type="email"
                  placeholder="Google email (e.g. diner@gmail.com)"
                  value={devGoogleEmailInput}
                  onChange={(e) => setDevGoogleEmailInput(e.target.value)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'rgba(0,0,0,0.35)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: '0.82rem',
                  }}
                />
                <input
                  type="text"
                  placeholder="Display name (optional)"
                  value={devGoogleNameInput}
                  onChange={(e) => setDevGoogleNameInput(e.target.value)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'rgba(0,0,0,0.35)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: '0.82rem',
                  }}
                />
                <button
                  type="button"
                  disabled={!devGoogleEmailInput.trim() || authLoading}
                  onClick={() =>
                    void submitGoogleAuthPayload({
                      devMockEmail: devGoogleEmailInput.trim(),
                      ...(devGoogleNameInput.trim() ? { devMockName: devGoogleNameInput.trim() } : {}),
                    })
                  }
                  className="accordion-add-action-btn"
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.8rem' }}
                >
                  Continue with this Google Email
                </button>
              </div>
            )}
          </>
        )}

        {authStep === 'OTP' && (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {authDevCode && (
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.18) 0%, rgba(217, 119, 6, 0.12) 100%)',
                  border: '1.5px solid rgba(245, 158, 11, 0.45)',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '0.74rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, marginBottom: '2px' }}>
                  Dev Preview OTP Code:
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#fbbf24', letterSpacing: '0.25em', margin: '2px 0' }}>
                  {authDevCode}
                </div>
              </div>
            )}

            <p style={{ fontSize: '0.82rem', color: '#cbd5e1', margin: 0 }}>
              Enter the 6-digit code sent via{' '}
              <strong style={{ color: '#34d399' }}>{authChannelLabel || 'WhatsApp'}</strong> to{' '}
              <strong>{formatNormalizedPhone(customerPhoneInput)}</strong>
              {authMode === 'SIGNUP' && authEmailInput ? ` (linking ${authEmailInput.trim()})` : ''}:
            </p>

            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit OTP"
              value={customerOtpInput}
              onChange={(e) => setCustomerOtpInput(e.target.value.replace(/\D/g, ''))}
              style={{
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '1.2rem',
                textAlign: 'center',
                letterSpacing: '0.2em',
              }}
            />

            {authError && <div style={{ color: '#f87171', fontSize: '0.79rem', fontWeight: 600 }}>{authError}</div>}

            <button className="accordion-add-action-btn" type="submit" disabled={authLoading}>
              {authLoading ? 'Verifying...' : authMode === 'SIGNUP' ? 'Verify & Complete Sign Up ✓' : 'Verify & Sign In ✓'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
              <button
                type="button"
                onClick={() => {
                  setAuthStep('PHONE');
                  setAuthDevCode(null);
                  setCustomerOtpInput('');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ← Back / Change number
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
