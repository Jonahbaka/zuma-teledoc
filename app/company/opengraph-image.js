import { ImageResponse } from 'next/og';

export const alt = 'DoctaRx — Care should stay connected.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function CompanyImage() {
  return new ImageResponse(<div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', padding: 64, background: '#0f172a', color: '#f8fafc', fontFamily: 'sans-serif' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 36, fontWeight: 700 }}>DoctaRx</span><span style={{ fontSize: 22, color: '#67e8f9' }}>CONNECTED CARE</span></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}><div style={{ fontSize: 82, fontWeight: 700, lineHeight: 1.06, letterSpacing: '-3px', maxWidth: 950 }}>Care should stay connected.</div><div style={{ fontSize: 30, lineHeight: 1.4, color: '#cbd5e1', maxWidth: 950 }}>Patient access. Provider workflows. The next care step.</div></div>
    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #334155', paddingTop: 24, fontSize: 24 }}><span>Explore the company</span><span style={{ color: '#67e8f9' }}>doctarx.com/company</span></div>
  </div>, size);
}
