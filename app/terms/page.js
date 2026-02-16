'use client';

import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-purple-50 to-yellow-50">
      <div className="container mx-auto px-6 py-16 max-w-4xl">
        <Link href="/">
          <Button variant="ghost" className="mb-8">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>

        <div className="bg-white rounded-2xl shadow-lg p-8 md:p-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
              <FileText className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-purple-900 font-serif">Terms of Service</h1>
          </div>

          <p className="text-sm text-gray-500 mb-8">Last updated: January 2025</p>

          <div className="prose prose-lg max-w-none space-y-6 text-gray-700">
            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">1. Acceptance of Terms</h2>
              <p>
                By accessing and using DoctaRx, you accept and agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our platform.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">2. Description of Service</h2>
              <p>
                DoctaRx is a telehealth platform that connects patients with licensed healthcare providers for virtual consultations. We facilitate communication but do not provide medical services directly.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">3. User Accounts</h2>
              <p>You are responsible for:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Maintaining the confidentiality of your account credentials</li>
                <li>All activities that occur under your account</li>
                <li>Providing accurate and current information</li>
                <li>Notifying us immediately of any unauthorized use</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">4. Medical Disclaimer</h2>
              <p>
                DoctaRx is a technology platform that facilitates telehealth services. We do not provide medical advice, diagnosis, or treatment. All medical services are provided by licensed healthcare providers who are independent practitioners.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">5. Provider Services</h2>
              <p>
                Healthcare providers using our platform are independent practitioners. They are responsible for their own medical decisions, diagnoses, and treatments. DoctaRx does not endorse or guarantee the quality of services provided by any provider.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">6. Payment Terms</h2>
              <p>
                Payment for services is due at the time of booking or as otherwise specified. All fees are non-refundable except as required by law or as specified in our refund policy. Subscription fees are billed monthly and will auto-renew unless cancelled.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">7. Prohibited Uses</h2>
              <p>You agree not to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Use the service for any illegal purpose</li>
                <li>Impersonate any person or entity</li>
                <li>Interfere with or disrupt the service</li>
                <li>Attempt to gain unauthorized access to any part of the platform</li>
                <li>Share your account credentials with others</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">8. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by law, DoctaRx shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the platform.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">9. Contact Information</h2>
              <p>
                For questions about these Terms of Service, please contact us at{' '}
                <a href="mailto:info@doctarx.com" className="text-purple-600 hover:underline">
                  info@doctarx.com
                </a>
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

