'use client';

import { AuthProvider } from '@/components/providers/AuthProvider';

export default function NigeriaLayout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <AuthProvider>
        {children}
      </AuthProvider>
    </div>
  );
}
