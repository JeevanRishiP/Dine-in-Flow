'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { buildSignedQrTokenFromSearch, openSignedTableSession } from '../lib/guest-session';

function ScanHandlerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('Verifying Table QR Signature...');
  const [error, setError] = useState<string | null>(null);
  const [tableLabel, setTableLabel] = useState('Table');

  useEffect(() => {
    let active = true;
    async function verifyScan() {
      const qrToken = buildSignedQrTokenFromSearch(new URLSearchParams(searchParams.toString()));
      if (!qrToken) {
        if (!active) return;
        setError('Invalid or unsigned table QR code. Please scan the physical QR code placed on your table.');
        setStatus('QR verification failed');
        return;
      }

      const res = await openSignedTableSession(qrToken, 2);
      if (!active) return;
      if (!res.ok) {
        setError(res.error);
        setStatus('QR verification failed');
        return;
      }

      const label = res.session.tableNumber ? `Table ${res.session.tableNumber}` : 'Verified Table';
      setTableLabel(label);
      setStatus(`Verified ${label}! Launching Dine-in Experience...`);
      setTimeout(() => {
        if (active) router.push('/');
      }, 600);
    }

    verifyScan();
    return () => {
      active = false;
    };
  }, [searchParams, router]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '72px',
          height: '72px',
          borderRadius: '20px',
          background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '36px',
          marginBottom: '20px',
          boxShadow: '0 8px 30px rgba(245, 158, 11, 0.4)',
        }}
      >
        👑
      </div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Dine-in Ordering</h1>
      <p style={{ color: error ? '#ef4444' : '#f59e0b', fontWeight: 700, fontSize: '1.1rem', marginBottom: '16px' }}>
        {tableLabel}
      </p>
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.06)',
          border: error ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '999px',
          padding: '8px 20px',
          fontSize: '0.88rem',
          color: error ? '#fca5a5' : '#94a3b8',
          maxWidth: '380px',
        }}
      >
        {error || status}
      </div>
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center' }}>Loading QR session...</div>}>
      <ScanHandlerContent />
    </Suspense>
  );
}
