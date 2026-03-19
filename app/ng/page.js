'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function NigeriaLanding() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">Rx</span>
              </div>
              <span className="text-xl font-bold text-gray-900">ZumaRx</span>
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Nigeria</span>
            </div>
            <nav className="hidden md:flex items-center space-x-6">
              <Link href="/ng/patient/search" className="text-gray-600 hover:text-green-600 text-sm font-medium">
                Find Medications
              </Link>
              <Link href="/ng/pharmacy/onboarding" className="text-gray-600 hover:text-green-600 text-sm font-medium">
                For Pharmacies
              </Link>
              <Link href="/ng/auth/login" className="text-gray-600 hover:text-green-600 text-sm font-medium">
                Login
              </Link>
              <Link href="/ng/auth/register" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
                Get Started
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-br from-green-50 via-white to-emerald-50 py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              Your Medications,{' '}
              <span className="text-green-600">Delivered</span>
            </h1>
            <p className="text-lg text-gray-600 mb-8">
              Search medications, compare pharmacy prices, upload prescriptions,
              and get your drugs delivered to your doorstep across Nigeria.
            </p>

            {/* Search Bar */}
            <div className="max-w-xl mx-auto">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (searchQuery.trim()) {
                    window.location.href = `/ng/patient/search?q=${encodeURIComponent(searchQuery)}`;
                  }
                }}
                className="flex gap-2"
              >
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for medications (e.g., Amoxicillin, Paracetamol)"
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                  />
                </div>
                <button
                  type="submit"
                  className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
                >
                  Search
                </button>
              </form>
              <p className="text-sm text-gray-500 mt-2">
                Or <Link href="/ng/patient/prescriptions" className="text-green-600 underline">upload a prescription</Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-center mb-12 text-gray-900">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: '1', title: 'Search or Upload', desc: 'Search for drugs or upload your prescription image' },
              { step: '2', title: 'Compare Prices', desc: 'See prices from pharmacies near you and pick the best deal' },
              { step: '3', title: 'Pay Securely', desc: 'Pay with card, bank transfer, or USSD — your choice' },
              { step: '4', title: 'Get Delivered', desc: 'Track your delivery in real-time right to your door' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For Pharmacies */}
      <section className="py-16 bg-green-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="md:flex md:items-center md:justify-between">
            <div className="md:w-1/2">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Grow Your Pharmacy Business
              </h2>
              <p className="text-gray-600 mb-6">
                Join Nigeria&apos;s digital pharmacy network. Get more customers,
                manage inventory, and receive payments — all in one platform.
              </p>
              <ul className="space-y-3 mb-6">
                {[
                  'Reach thousands of patients online',
                  'Inventory management & analytics',
                  'Automatic settlements to your bank',
                  'PCN-compliant platform',
                  'Plans from ₦20,000/month',
                ].map((item, i) => (
                  <li key={i} className="flex items-center text-sm text-gray-700">
                    <svg className="w-5 h-5 text-green-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/ng/pharmacy/onboarding"
                className="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
              >
                Register Your Pharmacy
              </Link>
            </div>
            <div className="md:w-1/2 mt-8 md:mt-0 md:pl-12">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Subscription Plans</h3>
                {[
                  { tier: 'Basic', price: '₦20,000', features: ['Up to 100 products', 'Order management', 'Basic analytics'] },
                  { tier: 'Standard', price: '₦50,000', features: ['Up to 500 products', 'Delivery integration', 'Priority support'] },
                  { tier: 'Premium', price: '₦100,000', features: ['Unlimited products', 'API access', 'Dedicated account manager'] },
                ].map((plan) => (
                  <div key={plan.tier} className="border border-gray-200 rounded-lg p-4 mb-3 last:mb-0">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium text-gray-900">{plan.tier}</span>
                      <span className="text-green-600 font-semibold">{plan.price}/mo</span>
                    </div>
                    <ul className="text-xs text-gray-500 space-y-1">
                      {plan.features.map((f, i) => <li key={i}>• {f}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">Rx</span>
                </div>
                <span className="text-white font-bold">ZumaRx Nigeria</span>
              </div>
              <p className="text-sm">
                Nigeria&apos;s digital pharmacy network. Connecting patients with
                licensed pharmacies for safe, affordable medication delivery.
              </p>
            </div>
            <div>
              <h4 className="text-white font-medium mb-3">Patients</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/ng/patient/search" className="hover:text-white">Search Drugs</Link></li>
                <li><Link href="/ng/patient/prescriptions" className="hover:text-white">Upload Prescription</Link></li>
                <li><Link href="/ng/patient/orders" className="hover:text-white">Track Orders</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-medium mb-3">Pharmacies</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/ng/pharmacy/onboarding" className="hover:text-white">Register</Link></li>
                <li><Link href="/ng/pharmacy/dashboard" className="hover:text-white">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-medium mb-3">Compliance</h4>
              <ul className="space-y-2 text-sm">
                <li><span>PCN Registered Platform</span></li>
                <li><span>NDPA Compliant</span></li>
                <li><span>NAFDAC Approved Drugs Only</span></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm">
            <p>&copy; {new Date().getFullYear()} ZumaRx (DoctaRx Nigeria). All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
