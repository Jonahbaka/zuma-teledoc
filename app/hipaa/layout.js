export const metadata = {
  title: 'HIPAA Notice of Privacy Practices - DoctaRx',
  description: 'DoctaRx HIPAA Notice of Privacy Practices explaining how your protected health information (PHI) is used, disclosed, and safeguarded.',
  keywords: 'HIPAA notice, privacy practices, protected health information, PHI, DoctaRx HIPAA compliance',
  alternates: {
    canonical: 'https://doctarx.com/hipaa',
  },
  openGraph: {
    title: 'HIPAA Notice - DoctaRx',
    description: 'How DoctaRx uses, discloses, and safeguards your protected health information under HIPAA.',
    url: 'https://doctarx.com/hipaa',
  },
};

export default function HIPAALayout({ children }) {
  return children;
}
