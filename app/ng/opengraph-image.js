import { ImageResponse } from 'next/og';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default function NigeriaOpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(140deg, #f7fbf8 0%, #edfdf5 44%, #ecfccb 100%)',
          color: '#052e16',
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
              'radial-gradient(circle at 16% 18%, rgba(16, 185, 129, 0.18), transparent 30%), radial-gradient(circle at 86% 14%, rgba(245, 158, 11, 0.18), transparent 26%), radial-gradient(circle at 78% 78%, rgba(14, 165, 233, 0.12), transparent 28%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '-120px',
            bottom: '-140px',
            width: '420px',
            height: '420px',
            borderRadius: '999px',
            border: '1px solid rgba(16,185,129,0.12)',
            background: 'rgba(255,255,255,0.32)',
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
                  color: '#047857',
                  border: '1px solid rgba(16,185,129,0.12)',
                }}
              >
                Nigeria Telehealth
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '78px', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.05em', color: '#052e16' }}>DoctaRx Nigeria</div>
                <div style={{ fontSize: '54px', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.04em', color: '#14532d' }}>
                  Online doctor care, prescriptions, and pharmacy access built for Nigeria.
                </div>
              </div>

              <div style={{ fontSize: '30px', lineHeight: 1.45, color: '#365314', maxWidth: '760px' }}>
                Book consultations, upload prescriptions, compare pharmacy availability, and pay with trusted local rails.
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                minWidth: '330px',
                padding: '24px',
                borderRadius: '32px',
                background: 'rgba(5, 46, 22, 0.92)',
                color: '#f7fee7',
                boxShadow: '0 28px 60px rgba(5, 46, 22, 0.16)',
              }}
            >
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#bbf7d0' }}>
                Care Journey
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'Online doctor consultation',
                  'Prescription review and upload',
                  'Pharmacy confirmation and fulfillment',
                ].map((item) => (
                  <div
                    key={item}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      borderRadius: '20px',
                      background: 'rgba(255,255,255,0.08)',
                      fontSize: '24px',
                    }}
                  >
                    <div style={{ width: '10px', height: '10px', borderRadius: '999px', background: '#f59e0b' }} />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            {['Online doctor', 'Prescription upload', 'Transfer, card, USSD', 'Fulfillment tracking'].map((item) => (
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
                  border: '1px solid rgba(22,101,52,0.14)',
                  color: '#14532d',
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
