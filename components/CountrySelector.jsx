'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const COUNTRIES = [
  {
    code: 'US',
    name: 'United States',
    flag: '\u{1F1FA}\u{1F1F8}',
    description: 'Telehealth, insurance, e-prescribing',
    path: '/',
  },
  {
    code: 'NG',
    name: 'Nigeria',
    flag: '\u{1F1F3}\u{1F1EC}',
    description: 'Pharmacy network, drug delivery, Paystack',
    path: '/ng',
  },
];

export default function CountrySelector() {
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if user already selected a country this session
    if (typeof window !== 'undefined') {
      const selected = sessionStorage.getItem('selectedCountry');
      if (!selected) {
        setShow(true);
      }
    }
  }, []);

  function selectCountry(country) {
    sessionStorage.setItem('selectedCountry', country.code);
    setShow(false);
    if (country.code === 'NG') {
      router.push('/ng');
    }
    // US stays on current page (/)
  }

  function dismiss() {
    sessionStorage.setItem('selectedCountry', 'US');
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-700 px-6 py-5 text-white">
          <h2 className="text-xl font-bold">Select Your Country</h2>
          <p className="text-sm text-white/80 mt-1">
            Choose your location to get the right experience
          </p>
        </div>

        {/* Country Options */}
        <div className="p-4 space-y-3">
          {COUNTRIES.map((country) => (
            <button
              key={country.code}
              onClick={() => selectCountry(country)}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 dark:border-slate-700 hover:border-purple-500 dark:hover:border-purple-500 transition-all text-left group"
            >
              <span className="text-4xl">{country.flag}</span>
              <div className="flex-1">
                <div className="font-semibold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400">
                  {country.name}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {country.description}
                </div>
              </div>
              <svg className="w-5 h-5 text-gray-400 group-hover:text-purple-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-4 pt-1">
          <button
            onClick={dismiss}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-2"
          >
            Continue with United States
          </button>
        </div>
      </div>
    </div>
  );
}
