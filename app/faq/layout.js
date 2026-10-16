import { doctarxFAQs } from '@/lib/faqData';

export const metadata = {
  title: 'DoctaRx | Frequently Asked Questions',
  description: 'Help with DoctaRx appointments, video visits, insurance details, pharmacy choices, memberships, and health records.',
  alternates: { canonical: 'https://doctarx.com/faq' },
  openGraph: { title: 'DoctaRx | Frequently Asked Questions', description: 'Find your next step with booking, visits, insurance, records, and pharmacy choices.', url: 'https://doctarx.com/faq' },
};

const faqJsonLd = {
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: doctarxFAQs.map(faq => ({ '@type': 'Question', name: faq.question, acceptedAnswer: { '@type': 'Answer', text: faq.answer } })),
};

export default function FAQLayout({ children }) {
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c') }} />{children}</>;
}
