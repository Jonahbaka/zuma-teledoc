'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function NigeriaLanding() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff' }}>
      {/* Header - sticky, native feel */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: '#ffffff', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '36px', height: '36px', background: '#16a34a', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontWeight: '700', fontSize: '14px' }}>Rx</span>
            </div>
            <span style={{ fontSize: '20px', fontWeight: '700', color: '#111827' }}>ZumaRx</span>
            <span style={{ fontSize: '10px', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '100px', fontWeight: '600' }}>Nigeria</span>
          </div>
          <Link href="/ng/auth/login" style={{ fontSize: '14px', fontWeight: '600', color: '#16a34a', textDecoration: 'none', padding: '8px 16px', borderRadius: '10px', border: '1.5px solid #16a34a' }}>
            Login
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section style={{ padding: '32px 16px 24px', maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '800', color: '#111827', lineHeight: '1.2', marginBottom: '12px' }}>
          Your Medications,{' '}
          <span style={{ color: '#16a34a' }}>Delivered</span>
        </h1>
        <p style={{ fontSize: '16px', color: '#6b7280', lineHeight: '1.5', marginBottom: '24px' }}>
          Search medications, compare pharmacy prices, and get your drugs delivered across Nigeria.
        </p>

        {/* Search */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (searchQuery.trim()) window.location.href = `/ng/patient/search?q=${encodeURIComponent(searchQuery)}`;
          }}
          style={{ display: 'flex', gap: '8px' }}
        >
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search medications..."
            style={{
              flex: 1, padding: '14px 16px', fontSize: '16px', borderRadius: '14px',
              border: '1.5px solid #e5e7eb', outline: 'none', color: '#111827', background: '#f9fafb',
            }}
          />
          <button type="submit" style={{ padding: '14px 20px', background: '#16a34a', color: '#fff', borderRadius: '14px', border: 'none', fontWeight: '600', fontSize: '15px', cursor: 'pointer' }}>
            Search
          </button>
        </form>
        <p style={{ fontSize: '13px', color: '#9ca3af', marginTop: '8px' }}>
          Or <Link href="/ng/patient/prescriptions" style={{ color: '#16a34a', textDecoration: 'underline' }}>upload a prescription</Link>
        </p>
      </section>

      {/* Quick Actions - app-like grid */}
      <section style={{ padding: '0 16px 24px', maxWidth: '640px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {[
            { href: '/ng/patient/search', icon: '\u{1F50D}', label: 'Search Drugs', desc: 'Find & compare prices' },
            { href: '/ng/patient/prescriptions', icon: '\u{1F4CB}', label: 'Upload Rx', desc: 'Photo or text' },
            { href: '/ng/patient/orders', icon: '\u{1F4E6}', label: 'My Orders', desc: 'Track deliveries' },
            { href: '/ng/pharmacy/onboarding', icon: '\u{1F3E5}', label: 'For Pharmacies', desc: 'Register & earn' },
          ].map((item) => (
            <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
              <div style={{
                background: '#ffffff', borderRadius: '16px', padding: '20px 16px', textAlign: 'center',
                border: '1.5px solid #f3f4f6', transition: 'box-shadow 0.2s',
              }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>{item.icon}</div>
                <div style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{item.label}</div>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{item.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section style={{ padding: '32px 16px', maxWidth: '640px', margin: '0 auto', background: '#f9fafb', borderRadius: '24px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: '700', textAlign: 'center', marginBottom: '24px', color: '#111827' }}>How It Works</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[
            { step: '1', title: 'Search or Upload', desc: 'Find drugs or snap your prescription' },
            { step: '2', title: 'Compare Prices', desc: 'See prices from pharmacies near you' },
            { step: '3', title: 'Pay Securely', desc: 'Card, bank transfer, or USSD' },
            { step: '4', title: 'Get Delivered', desc: 'Track your delivery in real-time' },
          ].map((item) => (
            <div key={item.step} style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#ffffff', borderRadius: '14px', padding: '16px' }}>
              <div style={{
                width: '40px', height: '40px', background: '#dcfce7', color: '#16a34a', borderRadius: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '16px', flexShrink: 0,
              }}>
                {item.step}
              </div>
              <div>
                <div style={{ fontWeight: '600', fontSize: '15px', color: '#111827' }}>{item.title}</div>
                <div style={{ fontSize: '13px', color: '#6b7280' }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* For Pharmacies CTA */}
      <section style={{ padding: '32px 16px', maxWidth: '640px', margin: '0 auto' }}>
        <div style={{ background: 'linear-gradient(135deg, #166534 0%, #16a34a 100%)', borderRadius: '20px', padding: '28px 24px', color: '#ffffff' }}>
          <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>Grow Your Pharmacy</h2>
          <p style={{ fontSize: '14px', opacity: 0.9, marginBottom: '16px', lineHeight: '1.5' }}>
            Join Nigeria&apos;s digital pharmacy network. Reach more patients, manage inventory, get paid.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px', fontSize: '13px' }}>
            {['Reach thousands of patients online', 'Inventory & analytics dashboard', 'Automatic bank settlements (T+3)', 'PCN-compliant platform', 'Plans from \u20A620,000/month'].map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#bbf7d0' }}>\u2713</span> {f}
              </div>
            ))}
          </div>
          <Link href="/ng/pharmacy/onboarding" style={{
            display: 'block', textAlign: 'center', background: '#ffffff', color: '#166534',
            padding: '14px', borderRadius: '12px', fontWeight: '600', fontSize: '15px', textDecoration: 'none',
          }}>
            Register Your Pharmacy
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: '#111827', color: '#9ca3af', padding: '32px 16px', marginTop: '16px' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <div style={{ width: '32px', height: '32px', background: '#16a34a', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontWeight: '700', fontSize: '12px' }}>Rx</span>
            </div>
            <span style={{ color: '#ffffff', fontWeight: '700' }}>ZumaRx Nigeria</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '13px', marginBottom: '16px' }}>
            <div>
              <div style={{ color: '#ffffff', fontWeight: '600', marginBottom: '8px' }}>Patients</div>
              <Link href="/ng/patient/search" style={{ color: '#9ca3af', textDecoration: 'none', display: 'block', marginBottom: '4px' }}>Search Drugs</Link>
              <Link href="/ng/patient/prescriptions" style={{ color: '#9ca3af', textDecoration: 'none', display: 'block', marginBottom: '4px' }}>Upload Prescription</Link>
              <Link href="/ng/patient/orders" style={{ color: '#9ca3af', textDecoration: 'none', display: 'block' }}>Track Orders</Link>
            </div>
            <div>
              <div style={{ color: '#ffffff', fontWeight: '600', marginBottom: '8px' }}>Compliance</div>
              <div>PCN Registered</div>
              <div>NDPA Compliant</div>
              <div>NAFDAC Approved Drugs</div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid #374151', paddingTop: '16px', textAlign: 'center', fontSize: '12px' }}>
            &copy; {new Date().getFullYear()} ZumaRx (DoctaRx Nigeria). All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
