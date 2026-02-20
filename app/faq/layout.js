export const metadata = {
  title: 'FAQ - Frequently Asked Questions About DoctaRx Telehealth',
  description: 'Find answers to common questions about DoctaRx telehealth appointments, insurance coverage, prescriptions, video consultations, and HIPAA-compliant care.',
  keywords: 'telehealth FAQ, DoctaRx questions, online doctor FAQ, telemedicine help, HIPAA compliant telehealth questions',
  alternates: {
    canonical: 'https://doctarx.com/faq',
  },
  openGraph: {
    title: 'FAQ - DoctaRx Telehealth Platform',
    description: 'Answers to common questions about telehealth appointments, insurance, prescriptions, and more.',
    url: 'https://doctarx.com/faq',
  },
};

// FAQ Schema JSON-LD for rich search results
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How do I book an appointment?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "You can book an appointment by logging into your account, clicking \"Book Appointment,\" selecting a provider, choosing an available time slot, and confirming your booking. You'll receive a confirmation email with details about your appointment."
      }
    },
    {
      "@type": "Question",
      "name": "Do you accept insurance?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "We accept most major insurance plans. You can check your insurance coverage during the booking process. We also offer self-pay options and subscription plans for those without insurance."
      }
    },
    {
      "@type": "Question",
      "name": "How do video consultations work?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Video consultations are conducted through our secure, HIPAA-compliant platform. At your appointment time, simply click \"Join Visit\" from your appointment details. Make sure you have a stable internet connection and a device with a camera and microphone."
      }
    },
    {
      "@type": "Question",
      "name": "Can I get prescriptions through DoctaRx?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes, our licensed providers can prescribe medications when appropriate. Prescriptions are sent electronically to your preferred pharmacy. Controlled substances may have additional restrictions based on state regulations."
      }
    },
    {
      "@type": "Question",
      "name": "Is my health information secure?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Absolutely. We use AES-256-GCM encryption, HIPAA-compliant data storage, and strict access controls. All health information is encrypted both in transit and at rest. We maintain comprehensive audit logs and security measures to protect your data."
      }
    },
    {
      "@type": "Question",
      "name": "What if I need to cancel or reschedule?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "You can cancel or reschedule appointments up to 24 hours before your scheduled time through your account dashboard. Late cancellations may be subject to fees as outlined in our cancellation policy."
      }
    },
    {
      "@type": "Question",
      "name": "What is Docta Gold?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Docta Gold is our monthly subscription plan that provides unlimited video visits, priority scheduling, 24/7 provider access, and additional benefits. It's perfect for individuals and families who want comprehensive telehealth coverage."
      }
    },
    {
      "@type": "Question",
      "name": "How do I access my medical records?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "You can access your medical records anytime through your account dashboard under \"Health Records.\" All records are encrypted and stored securely. You can also request a copy of your records or export them for your personal use."
      }
    }
  ]
};

export default function FAQLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {children}
    </>
  );
}
