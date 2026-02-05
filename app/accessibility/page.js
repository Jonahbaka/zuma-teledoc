'use client';

import Link from 'next/link';
import { ArrowLeft, Accessibility } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AccessibilityPage() {
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
              <Accessibility className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-purple-900 font-serif">Accessibility Statement</h1>
          </div>

          <p className="text-sm text-gray-500 mb-8">Last updated: January 2025</p>

          <div className="prose prose-lg max-w-none space-y-6 text-gray-700">
            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Our Commitment</h2>
              <p>
                Docta. is committed to ensuring digital accessibility for people with disabilities. We are continually improving the user experience for everyone and applying the relevant accessibility standards to achieve these goals.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Accessibility Standards</h2>
              <p>
                We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA standards. These guidelines explain how to make web content more accessible for people with disabilities.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Accessibility Features</h2>
              <p>Our platform includes the following accessibility features:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Keyboard navigation support throughout the platform</li>
                <li>Screen reader compatibility</li>
                <li>Alternative text for images and icons</li>
                <li>High contrast mode options</li>
                <li>Adjustable text sizing</li>
                <li>Clear and consistent navigation</li>
                <li>Form labels and error messages</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Ongoing Efforts</h2>
              <p>
                We regularly review our platform to identify and fix accessibility issues. Our development process includes accessibility testing, and we welcome feedback from users about accessibility concerns.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Feedback</h2>
              <p>
                If you encounter any accessibility barriers on our platform, please contact us at{' '}
                <a href="mailto:info@doctarx.com" className="text-purple-600 hover:underline">
                  info@doctarx.com
                </a>
                . We will make every effort to address your concerns and improve accessibility.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-purple-800 mb-4">Third-Party Content</h2>
              <p>
                Some content on our platform may be provided by third parties. While we strive to ensure all content is accessible, we may not have full control over third-party content accessibility.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

