'use client';

import Link from 'next/link';
import { ArrowLeft, Shield, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HIPAANoticePage() {
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
            <h1 className="text-4xl font-bold text-purple-900 font-serif">HIPAA Notice of Privacy Practices</h1>
          </div>

          <p className="text-sm text-gray-500 mb-8">Last updated: January 2025</p>

          <div className="prose prose-lg max-w-none space-y-6 text-gray-700">
            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">This Notice Describes How Medical Information About You May Be Used and Disclosed</h2>
              <p>
                This notice describes how DoctaRx and our healthcare providers may use and disclose your protected health information (PHI) to carry out treatment, payment, or healthcare operations, and for other purposes that are permitted or required by law.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Your Rights</h2>
              <p>You have the following rights regarding your PHI:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Right to Access:</strong> You can request to see or get an electronic or paper copy of your medical record.</li>
                <li><strong>Right to Amend:</strong> You can ask us to correct health information that you think is incorrect or incomplete.</li>
                <li><strong>Right to an Accounting:</strong> You can ask for a list of the times we've shared your health information.</li>
                <li><strong>Right to Request Restrictions:</strong> You can ask us not to use or share certain health information.</li>
                <li><strong>Right to Request Confidential Communications:</strong> You can ask us to contact you in a specific way.</li>
                <li><strong>Right to File a Complaint:</strong> You can file a complaint if you feel your rights are violated.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">How We Use and Share Your Information</h2>
              <p>We may use and share your information as follows:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>For Treatment:</strong> We can use your PHI to provide, coordinate, or manage your healthcare.</li>
                <li><strong>For Payment:</strong> We can use and share your PHI to bill and get payment from health plans or other entities.</li>
                <li><strong>For Healthcare Operations:</strong> We can use and share your PHI to run our practice and improve your care.</li>
                <li><strong>As Required by Law:</strong> We will share information about you if state or federal laws require it.</li>
                <li><strong>To Prevent Harm:</strong> We may use and share your PHI when necessary to prevent a serious threat to your health and safety.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Our Responsibilities</h2>
              <p>
                We are required by law to maintain the privacy and security of your protected health information. We will let you know promptly if a breach occurs that may have compromised the privacy or security of your information.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Security Measures</h2>
              <p>
                We use industry-standard and next-generation security measures to protect your PHI, including:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>256-bit SSL encryption for all data transmission</li>
                <li>Encrypted storage of all health records (AES-256-GCM)</li>
                <li>Secure authentication and access controls with multi-factor authentication</li>
                <li>Regular security audits and monitoring</li>
                <li>HIPAA-compliant data centers</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">AI Agent Security — NVIDIA NemoClaw</h2>
              <p>
                DoctaRx uses AI-powered clinical decision support agents to assist providers and patients. To ensure the highest standard of data safety, all AI agents operate within the <strong>NVIDIA NemoClaw OpenShell</strong> secure sandbox environment:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Sandboxed Execution:</strong> Every AI agent runs in a strictly isolated OpenShell container. Agents cannot access data outside their permitted scope.</li>
                <li><strong>Read-Only Patient Data:</strong> AI agents have read-only access to clinical data — they cannot modify, copy, or exfiltrate patient records.</li>
                <li><strong>No Unauthorized Egress:</strong> Network egress is denied by default. Only approved, allowlisted services (such as our encrypted database) can be reached from within the sandbox.</li>
                <li><strong>Automatic PII Scrubbing:</strong> A Privacy Router middleware automatically detects and redacts personally identifiable information (SSN, phone, email, MRN, date of birth, addresses) before any data reaches external AI providers.</li>
                <li><strong>Full Audit Trail:</strong> Every agent action, data access, and intent declaration is logged to a tamper-evident audit trail retained for the HIPAA-required minimum of 7 years.</li>
                <li><strong>Compliance-First Governance:</strong> Agent actions pass through a governance pipeline — The Guardian (compliance agent) can veto any action that poses a risk to patient privacy.</li>
              </ul>
              <p className="mt-4">
                This architecture ensures that your health data is never exposed to uncontrolled AI processing. NemoClaw provides defense-in-depth security that exceeds industry standards for healthcare AI deployments.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Changes to This Notice</h2>
              <p>
                We can change the terms of this notice, and the changes will apply to all information we have about you. The new notice will be available on our website and in our office.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Contact Information</h2>
              <p>
                If you have questions about this notice or want to exercise your rights, please contact our Privacy Officer at{' '}
                <a href="mailto:info@doctarx.com" className="text-purple-600 hover:underline">
                  info@doctarx.com
                </a>
                {' '}or file a complaint with the U.S. Department of Health and Human Services.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

