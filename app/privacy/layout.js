export const metadata = {
  title: 'Privacy Policy - How DoctaRx Protects Your Health Data',
  description: 'DoctaRx privacy policy detailing how we protect your health information with HIPAA-compliant AES-256-GCM encryption, audit logging, and strict access controls.',
  keywords: 'DoctaRx privacy policy, HIPAA privacy, telehealth data protection, health data security, patient privacy',
  alternates: {
    canonical: 'https://doctarx.com/privacy',
  },
  openGraph: {
    title: 'Privacy Policy - DoctaRx',
    description: 'How DoctaRx protects your health information with HIPAA-compliant encryption and security.',
    url: 'https://doctarx.com/privacy',
  },
};

export default function PrivacyLayout({ children }) {
  return children;
}
