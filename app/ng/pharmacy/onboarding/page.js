'use client';

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT',
  'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi',
  'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
  'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

const STEPS = [
  { id: 1, name: 'Pharmacy Info', icon: '1' },
  { id: 2, name: 'License & Pharmacist', icon: '2' },
  { id: 3, name: 'Bank Details', icon: '3' },
  { id: 4, name: 'Review & Submit', icon: '4' },
];

export default function PharmacyOnboarding() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', whatsapp: '',
    addressLine1: '', addressLine2: '', city: '', state: '', lga: '', postalCode: '',
    pcnLicenseNumber: '', pcnLicenseExpiry: '',
    superintendentName: '', superintendentPcnNumber: '',
    superintendentPhone: '', superintendentEmail: '',
    bankName: '', bankAccountNumber: '', bankAccountName: '', bankCode: '',
  });

  const updateForm = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      await api.post('/api/ng/pharmacy/register', form);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Registration Submitted!</h2>
          <p className="text-gray-600 mb-6">
            Your pharmacy registration is under review. We&apos;ll verify your PCN license
            and superintendent credentials within 24-48 hours.
          </p>
          <Link href="/ng/pharmacy/dashboard" className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700">
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center">
          <Link href="/ng" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Rx</span>
            </div>
            <span className="font-bold text-gray-900">ZumaRx</span>
          </Link>
          <span className="ml-4 text-gray-500">Pharmacy Registration</span>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium
                ${step >= s.id ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {s.icon}
              </div>
              <span className={`ml-2 text-sm hidden sm:block ${step >= s.id ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
                {s.name}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`w-12 h-0.5 mx-3 ${step > s.id ? 'bg-green-600' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-6 md:p-8">
          {/* Step 1: Pharmacy Info */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Pharmacy Information</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pharmacy Name *</label>
                  <input type="text" value={form.name} onChange={e => updateForm('name', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" placeholder="e.g., HealthPlus Pharmacy" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                  <input type="tel" value={form.phone} onChange={e => updateForm('phone', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" placeholder="+234..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp (optional)</label>
                  <input type="tel" value={form.whatsapp} onChange={e => updateForm('whatsapp', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                  <input type="text" value={form.addressLine1} onChange={e => updateForm('addressLine1', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" placeholder="Street address" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                  <input type="text" value={form.city} onChange={e => updateForm('city', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State *</label>
                  <select value={form.state} onChange={e => updateForm('state', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500">
                    <option value="">Select State</option>
                    {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">LGA</label>
                  <input type="text" value={form.lga} onChange={e => updateForm('lga', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: License & Pharmacist */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-6">PCN License & Superintendent Pharmacist</h2>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-sm text-yellow-800">
                PCN registration is mandatory for all pharmacies operating in Nigeria.
                Your superintendent pharmacist must have a valid PCN license.
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PCN License Number *</label>
                  <input type="text" value={form.pcnLicenseNumber} onChange={e => updateForm('pcnLicenseNumber', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" placeholder="PCN-XXXX-XXXX" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">License Expiry Date *</label>
                  <input type="date" value={form.pcnLicenseExpiry} onChange={e => updateForm('pcnLicenseExpiry', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
                <div className="md:col-span-2 border-t pt-4 mt-2">
                  <h3 className="font-medium text-gray-900 mb-3">Superintendent Pharmacist</h3>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input type="text" value={form.superintendentName} onChange={e => updateForm('superintendentName', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PCN Number *</label>
                  <input type="text" value={form.superintendentPcnNumber} onChange={e => updateForm('superintendentPcnNumber', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input type="tel" value={form.superintendentPhone} onChange={e => updateForm('superintendentPhone', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={form.superintendentEmail} onChange={e => updateForm('superintendentEmail', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Bank Details */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Bank Details for Settlement</h2>
              <p className="text-sm text-gray-600 mb-6">
                We&apos;ll settle your earnings directly to this bank account (T+3 settlement).
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                  <select value={form.bankName} onChange={e => updateForm('bankName', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500">
                    <option value="">Select Bank</option>
                    {['Access Bank', 'Guaranty Trust Bank', 'First Bank', 'Zenith Bank', 'UBA',
                      'Fidelity Bank', 'Union Bank', 'Sterling Bank', 'Stanbic IBTC', 'Wema Bank',
                      'Polaris Bank', 'Keystone Bank', 'Ecobank', 'FCMB', 'Heritage Bank',
                      'Providus Bank', 'Jaiz Bank', 'Kuda Bank', 'OPay', 'PalmPay',
                    ].map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                  <input type="text" value={form.bankAccountNumber} onChange={e => updateForm('bankAccountNumber', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" maxLength={10} placeholder="10-digit NUBAN" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                  <input type="text" value={form.bankAccountName} onChange={e => updateForm('bankAccountName', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Review & Submit</h2>
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-2">Pharmacy</h3>
                  <p className="text-sm text-gray-600">{form.name}</p>
                  <p className="text-sm text-gray-600">{form.addressLine1}, {form.city}, {form.state}</p>
                  <p className="text-sm text-gray-600">{form.phone} | {form.email}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-2">PCN License</h3>
                  <p className="text-sm text-gray-600">License: {form.pcnLicenseNumber}</p>
                  <p className="text-sm text-gray-600">Superintendent: {form.superintendentName} ({form.superintendentPcnNumber})</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-2">Bank</h3>
                  <p className="text-sm text-gray-600">{form.bankName} - {form.bankAccountNumber}</p>
                  <p className="text-sm text-gray-600">{form.bankAccountName}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                  By submitting, you confirm that all information is accurate and your pharmacy
                  is PCN-registered. False information may result in account suspension.
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t">
            {step > 1 ? (
              <button onClick={() => setStep(s => s - 1)}
                className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                Back
              </button>
            ) : <div />}

            {step < 4 ? (
              <button onClick={() => setStep(s => s + 1)}
                className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700">
                Continue
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={loading}
                className="px-8 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">
                {loading ? 'Submitting...' : 'Submit Registration'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
