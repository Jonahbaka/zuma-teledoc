import { ImageResponse } from 'next/og';

export const alt = 'DoctaRx media kit — descriptions, brand assets and product imagery.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function PressImage() {
  return new ImageResponse(<div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', padding: 64, background: '#ecfeff', color: '#0f172a', fontFamily: 'sans-serif' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 36, fontWeight: 700 }}>DoctaRx</span><span style={{ fontSize: 22, color: '#155e75' }}>PRESS & COMPANY</span></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}><div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-3px' }}>The media kit.</div><div style={{ fontSize: 32, lineHeight: 1.4, color: '#334155', maxWidth: 900 }}>A clear introduction. Useful assets. A direct line to the team.</div></div>
    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #a5f3fc', paddingTop: 24, fontSize: 24 }}><span>Connected virtual care</span><span style={{ color: '#155e75' }}>doctarx.com/press</span></div>
  </div>, size);
}
