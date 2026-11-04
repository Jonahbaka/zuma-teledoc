import { ImageResponse } from 'next/og';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(140deg, #f8fbff 0%, #eef6ff 42%, #dbeafe 100%)',
          color: '#0f172a',
          padding: '48px',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 16% 18%, rgba(6, 182, 212, 0.18), transparent 28%), radial-gradient(circle at 86% 14%, rgba(59, 130, 246, 0.18), transparent 24%), radial-gradient(circle at 78% 78%, rgba(14, 165, 233, 0.16), transparent 26%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: '-120px',
            top: '-90px',
            width: '420px',
            height: '420px',
            borderRadius: '999px',
            border: '1px solid rgba(14, 165, 233, 0.14)',
            background: 'rgba(255,255,255,0.38)',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '700px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderRadius: '999px',
                  padding: '10px 18px',
                  fontSize: '24px',
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  background: 'rgba(255,255,255,0.72)',
                  color: '#0f766e',
                  border: '1px solid rgba(8,145,178,0.12)',
                }}
              >
                United States Telehealth
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '78px', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.05em' }}>DoctaRx</div>
                <div style={{ fontSize: '54px', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.04em', color: '#0f172a' }}>
                  Secure visits, connected records, and premium care coordination.
                </div>
              </div>

              <div style={{ fontSize: '30px', lineHeight: 1.45, color: '#334155', maxWidth: '760px' }}>
                HIPAA-ready workflows, insurance-aware booking, secure messaging, and e-prescribing without cross-market leakage.
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                minWidth: '310px',
                padding: '24px',
                borderRadius: '32px',
                background: 'rgba(15, 23, 42, 0.94)',
                color: '#f8fafc',
                boxShadow: '0 28px 60px rgba(15, 23, 42, 0.16)',
              }}
            >
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8' }}>
                Care Signals
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'Secure video visits',
                  'Insurance + self-pay ready',
                  'Prescription routing',
                ].map((item) => (
                  <div
                    key={item}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      borderRadius: '20px',
                      background: 'rgba(255,255,255,0.06)',
                      fontSize: '24px',
                    }}
                  >
                    <div style={{ width: '10px', height: '10px', borderRadius: '999px', background: '#22d3ee' }} />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            {['Patients', 'Providers', 'Pharmacies', 'Operations'].map((item) => (
              <div
                key={item}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: '999px',
                  padding: '12px 18px',
                  fontSize: '24px',
                  fontWeight: 700,
                  background: 'rgba(255,255,255,0.76)',
                  border: '1px solid rgba(148,163,184,0.18)',
                  color: '#0f172a',
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size
  );
}
