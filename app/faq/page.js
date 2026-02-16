'use client';

import Link from 'next/link';
import { ArrowLeft, HelpCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

const faqs = [
  {
    question: 'How do I book an appointment?',
    answer: 'You can book an appointment by logging into your account, clicking "Book Appointment," selecting a provider, choosing an available time slot, and confirming your booking. You\'ll receive a confirmation email with details about your appointment.'
  },
  {
    question: 'Do you accept insurance?',
    answer: 'We accept most major insurance plans. You can check your insurance coverage during the booking process. We also offer self-pay options and subscription plans for those without insurance.'
  },
  {
    question: 'How do video consultations work?',
    answer: 'Video consultations are conducted through our secure, HIPAA-compliant platform. At your appointment time, simply click "Join Visit" from your appointment details. Make sure you have a stable internet connection and a device with a camera and microphone.'
  },
  {
    question: 'Can I get prescriptions through Docta?',
    answer: 'Yes, our licensed providers can prescribe medications when appropriate. Prescriptions are sent electronically to your preferred pharmacy. Controlled substances may have additional restrictions based on state regulations.'
  },
  {
    question: 'What if I need to cancel or reschedule?',
    answer: 'You can cancel or reschedule appointments up to 24 hours before your scheduled time through your account dashboard. Late cancellations may be subject to fees as outlined in our cancellation policy.'
  },
  {
    question: 'Is my health information secure?',
    answer: 'Absolutely. We use 256-bit SSL encryption, HIPAA-compliant data storage, and strict access controls. All health information is encrypted both in transit and at rest. We maintain comprehensive audit logs and security measures to protect your data.'
  },
  {
    question: 'What is Docta Gold?',
    answer: 'Docta Gold is our monthly subscription plan that provides unlimited video visits, priority scheduling, 24/7 provider access, and additional benefits. It\'s perfect for individuals and families who want comprehensive telehealth coverage.'
  },
  {
    question: 'How do I access my medical records?',
    answer: 'You can access your medical records anytime through your account dashboard under "Health Records." All records are encrypted and stored securely. You can also request a copy of your records or export them for your personal use.'
  }
];

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState(null);

  const toggleFAQ = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-purple-50 to-yellow-50">
      <div className="container mx-auto px-6 py-16 max-w-4xl">
        <Link href="/">
          <Button variant="ghost" className="mb-8">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>

        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
              <HelpCircle className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-purple-900 font-serif">Frequently Asked Questions</h1>
          </div>
          <p className="text-xl text-gray-600">
            Find answers to the most common questions about DoctaRx.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-100"
            >
              <button
                onClick={() => toggleFAQ(index)}
                className="w-full px-6 py-5 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <span className="font-semibold text-gray-900 pr-4">{faq.question}</span>
                <ChevronDown
                  className={`w-5 h-5 text-purple-600 flex-shrink-0 transition-transform ${
                    openIndex === index ? 'transform rotate-180' : ''
                  }`}
                />
              </button>
              {openIndex === index && (
                <div className="px-6 pb-5 text-gray-600 leading-relaxed">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 bg-white rounded-2xl shadow-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-purple-900 mb-4">Still have questions?</h2>
          <p className="text-gray-600 mb-6">
            Can't find what you're looking for? Email us at{' '}
            <a href="mailto:info@doctarx.com" className="text-purple-600 hover:underline font-medium">
              info@doctarx.com
            </a>
            {' '}or contact our support team.
          </p>
          <Link href="/contact">
            <Button className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white">
              Contact Support
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

