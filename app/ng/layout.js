'use client';

import { AuthProvider } from '@/components/providers/AuthProvider';

export default function NigeriaLayout({ children }) {
  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {/* Mobile-native viewport fixes */}
      <style jsx global>{`
        /* iOS safe areas */
        .ng-safe-top { padding-top: env(safe-area-inset-top, 0px); }
        .ng-safe-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }

        /* Prevent iOS zoom on input focus (font-size < 16px triggers zoom) */
        .ng-layout input, .ng-layout select, .ng-layout textarea {
          font-size: 16px !important;
        }

        /* Smooth scrolling */
        .ng-layout { -webkit-overflow-scrolling: touch; }

        /* Remove tap highlight on mobile */
        .ng-layout * { -webkit-tap-highlight-color: transparent; }

        /* Native-feel buttons */
        .ng-layout button, .ng-layout a {
          -webkit-touch-callout: none;
          touch-action: manipulation;
        }

        /* Bottom nav safe area */
        .ng-bottom-nav {
          padding-bottom: max(12px, env(safe-area-inset-bottom, 12px));
        }

        /* Full-bleed mobile cards */
        @media (max-width: 640px) {
          .ng-layout .ng-card {
            border-radius: 0;
            border-left: none;
            border-right: none;
          }
        }

        /* Hide scrollbar but keep scrollable */
        .ng-hide-scrollbar::-webkit-scrollbar { display: none; }
        .ng-hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

        /* Pull-to-refresh feel */
        .ng-layout { overscroll-behavior-y: contain; }
      `}</style>

      <AuthProvider>
        <div className="ng-layout ng-safe-top ng-safe-bottom">
          {children}
        </div>
      </AuthProvider>
    </div>
  );
}
