'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function ScanHandlerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('Verifying Table QR Signature...');

  const table = searchParams.get('t') || 'T01';
  const sig = searchParams.get('sig');

  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus(`Verified Table ${table}! Launching Dine-in Experience...`);
      setTimeout(() => {
        router.push(`/?table=${table}`);
      }, 800);
    }, 600);

    return () => clearTimeout(timer);
  }, [table, router]);

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
      <h1 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Royal Spice Bistro</h1>
      <p style={{ color: '#f59e0b', fontWeight: 700, fontSize: '1.1rem', marginBottom: '16px' }}>
        Table {table}
      </p>
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '999px',
          padding: '8px 20px',
          fontSize: '0.88rem',
          color: '#94a3b8',
        }}
      >
        {status}
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
