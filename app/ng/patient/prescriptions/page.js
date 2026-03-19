'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

export default function PrescriptionsPage() {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState(null); // 'image' | 'text'
  const [prescriptionText, setPrescriptionText] = useState('');
  const [uploadResult, setUploadResult] = useState(null);

  useEffect(() => {
    loadPrescriptions();
  }, []);

  async function loadPrescriptions() {
    try {
      const res = await api.get('/api/ng/patient/prescriptions');
      setPrescriptions(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      // Upload image first
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await api.post('/api/ng/patient/prescriptions/upload', {
        imageUrl: URL.createObjectURL(file), // In production, upload to S3/GCS first
      });
      setUploadResult(uploadRes.data);
      loadPrescriptions();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  async function handleTextSubmit() {
    if (!prescriptionText.trim()) return;
    setUploading(true);
    try {
      const res = await api.post('/api/ng/patient/prescriptions/text', {
        text: prescriptionText,
      });
      setUploadResult(res.data);
      setPrescriptionText('');
      setUploadMode(null);
      loadPrescriptions();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  const statusColors = {
    uploaded: 'bg-yellow-100 text-yellow-700',
    parsing: 'bg-blue-100 text-blue-700',
    parsed: 'bg-green-100 text-green-700',
    verified: 'bg-green-200 text-green-800',
    rejected: 'bg-red-100 text-red-700',
    expired: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/ng" className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Rx</span>
            </Link>
            <h1 className="font-bold text-gray-900">My Prescriptions</h1>
          </div>
          <Link href="/ng/patient/search" className="text-sm text-green-600">Search Drugs</Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Upload Section */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="font-bold text-gray-900 mb-4">Upload Prescription</h2>

          {!uploadMode && (
            <div className="grid md:grid-cols-2 gap-4">
              <button onClick={() => setUploadMode('image')}
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-500 transition-colors">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="font-medium text-gray-900">Upload Image</p>
                <p className="text-sm text-gray-500 mt-1">Take a photo or upload a scan</p>
              </button>

              <button onClick={() => setUploadMode('text')}
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-500 transition-colors">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="font-medium text-gray-900">Type Prescription</p>
                <p className="text-sm text-gray-500 mt-1">Enter drug names and dosages</p>
              </button>
            </div>
          )}

          {uploadMode === 'image' && (
            <div>
              <input type="file" accept="image/*" capture="environment" onChange={handleImageUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-green-50 file:text-green-700 file:font-medium hover:file:bg-green-100" />
              <button onClick={() => setUploadMode(null)} className="text-sm text-gray-500 mt-2">Cancel</button>
              {uploading && <p className="text-sm text-green-600 mt-2">Parsing prescription...</p>}
            </div>
          )}

          {uploadMode === 'text' && (
            <div>
              <textarea value={prescriptionText} onChange={e => setPrescriptionText(e.target.value)}
                placeholder={`Enter your prescription details, e.g.:\n\nAmoxicillin 500mg - 1 capsule 3 times daily for 7 days\nParacetamol 500mg - 2 tablets as needed\nOmeprazole 20mg - 1 capsule daily`}
                rows={6}
                className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500 text-sm" />
              <div className="flex gap-2 mt-2">
                <button onClick={handleTextSubmit} disabled={uploading || !prescriptionText.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm disabled:opacity-50">
                  {uploading ? 'Parsing...' : 'Submit'}
                </button>
                <button onClick={() => { setUploadMode(null); setPrescriptionText(''); }}
                  className="px-4 py-2 border rounded-lg text-sm text-gray-600">Cancel</button>
              </div>
            </div>
          )}

          {/* Upload Result */}
          {uploadResult && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-medium text-green-800 mb-2">Prescription Parsed!</h3>
              <p className="text-sm text-green-700 mb-2">
                Confidence: {(uploadResult.confidence * 100).toFixed(0)}%
                {uploadResult.requiresVerification && ' — Requires pharmacist verification'}
              </p>
              <div className="space-y-1">
                {uploadResult.items?.map((item, i) => (
                  <p key={i} className="text-sm text-green-700">
                    {item.drug_name} {item.dosage || ''} — {item.frequency || ''} {item.duration || ''}
                    {item.catalogMatch && <span className="text-green-600"> (matched)</span>}
                  </p>
                ))}
              </div>
              <Link href={`/ng/patient/search`}
                className="inline-block mt-3 text-sm bg-green-600 text-white px-4 py-2 rounded-lg">
                Find Pharmacies
              </Link>
            </div>
          )}
        </div>

        {/* Prescription History */}
        <h2 className="font-bold text-gray-900 mb-4">Prescription History</h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full" />
          </div>
        ) : prescriptions.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-500">
            No prescriptions uploaded yet
          </div>
        ) : (
          <div className="space-y-3">
            {prescriptions.map(rx => (
              <div key={rx.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {rx.prescriber_name || 'Prescription'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(rx.created_at).toLocaleDateString()}
                      {rx.items?.length > 0 && ` — ${rx.items.length} item(s)`}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[rx.status] || 'bg-gray-100'}`}>
                    {rx.status}
                  </span>
                </div>
                {rx.is_controlled_substance && (
                  <p className="text-xs text-red-500 mt-1">Contains controlled substance</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
