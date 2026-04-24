'use client';

import Link from 'next/link';
import { ArrowLeft, Shield, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrivacyPolicyPage() {
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
              <Shield className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-purple-900 font-serif">Privacy Policy</h1>
          </div>

          <p className="text-sm text-gray-500 mb-8">Last updated: January 2025</p>

          <div className="prose prose-lg max-w-none space-y-6 text-gray-700">
            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">1. Introduction</h2>
              <p>
                DoctaRx ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our telehealth platform.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">2. Information We Collect</h2>
              <p>We collect information that you provide directly to us, including:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Personal identification information (name, email, phone number)</li>
                <li>Health information and medical records</li>
                <li>Payment and billing information</li>
                <li>Account credentials and authentication data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">3. How We Use Your Information</h2>
              <p>We use the information we collect to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide, maintain, and improve our services</li>
                <li>Process appointments and facilitate healthcare consultations</li>
                <li>Send you notifications and updates</li>
                <li>Comply with legal obligations and HIPAA requirements</li>
                <li>Detect and prevent fraud or abuse</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">4. HIPAA Compliance</h2>
              <p>
                As a covered entity under HIPAA, we maintain strict safeguards to protect your Protected Health Information (PHI). All health information is encrypted and stored securely. We only share PHI as permitted by law and with your explicit consent.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">5. Data Security</h2>
              <p>
                We implement industry-standard security measures including encryption, secure authentication, and regular security audits. Your data is protected with 256-bit SSL encryption and stored in HIPAA-compliant data centers.
              </p>
              <p className="mt-4">
                AI-assisted workflows on DoctaRx pass through privacy filtering, role-based access controls, and audit logging designed to minimize PHI exposure. Identifiable information is redacted before data is routed to external AI providers, and sensitive actions are recorded to a compliance audit trail.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">6. Your Rights</h2>
              <p>You have the right to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Access and receive a copy of your health information</li>
                <li>Request corrections to your information</li>
                <li>Request restrictions on how we use or disclose your information</li>
                <li>File a complaint if you believe your privacy rights have been violated</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">7. Contact Us</h2>
              <p>
                If you have questions about this Privacy Policy, please contact us at{' '}
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

