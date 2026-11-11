'use client';

import React, { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Customer Web Runtime Error:', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: '#0a0d14',
        color: '#f8fafc',
        textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          width: '64px',
          height: '64px',
          borderRadius: '16px',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px',
          marginBottom: '16px',
        }}
      >
        ⚠️
      </div>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px' }}>
        Something went wrong
      </h2>
      <p style={{ color: '#94a3b8', fontSize: '0.88rem', maxWidth: '380px', marginBottom: '24px', lineHeight: 1.5 }}>
        {error?.message || 'An unexpected error occurred while loading the dine-in experience.'}
      </p>
      <button
        onClick={() => reset()}
        style={{
          background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          color: '#000',
          fontWeight: 700,
          fontSize: '0.9rem',
          padding: '12px 24px',
          borderRadius: '9999px',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
        }}
      >
        Try Again 🔄
      </button>
    </div>
  );
}

