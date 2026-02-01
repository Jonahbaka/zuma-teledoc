'use client';

import { useState, useEffect } from 'react';
import { 
  Building2, Globe, CheckCircle, Clock, AlertCircle, 
  Link2, Shield, Server, ExternalLink, Plus
} from 'lucide-react';
import api from '@/lib/api';

// Mock connected organizations data
const connectedOrganizations = [
  {
    id: 'stanford-health',
    name: 'Stanford Health Care',
    type: 'hospital',
    ehr_system: 'epic',
    fhir_endpoint: 'https://interconnect.stanfordhealthcare.org/fhir/r4',
    status: 'active',
    last_sync: '2 minutes ago',
    capabilities: ['referrals', 'records', 'medications'],
    logo: '/stanford-logo.png'
  },
  {
    id: 'kaiser-norcal',
    name: 'Kaiser Permanente Northern California',
    type: 'hospital',
    ehr_system: 'epic',
    fhir_endpoint: 'https://healthy.kaiserpermanente.org/fhir/r4',
    status: 'active',
    last_sync: '5 minutes ago',
    capabilities: ['referrals', 'records'],
    logo: '/kaiser-logo.png'
  },
  {
    id: 'ucsf-medical',
    name: 'UCSF Medical Center',
    type: 'hospital',
    ehr_system: 'epic',
    fhir_endpoint: 'https://api.ucsf.edu/fhir/r4',
    status: 'active',
    last_sync: '15 minutes ago',
    capabilities: ['referrals', 'records', 'medications', 'labs'],
    logo: '/ucsf-logo.png'
  },
  {
    id: 'sutter-health',
    name: 'Sutter Health',
    type: 'hospital',
    ehr_system: 'cerner',
    fhir_endpoint: 'https://fhir.sutterhealth.org/r4',
    status: 'pending',
    last_sync: null,
    capabilities: ['referrals'],
    logo: '/sutter-logo.png'
  },
  {
    id: 'john-muir',
    name: 'John Muir Health',
    type: 'hospital',
    ehr_system: 'meditech',
    fhir_endpoint: null,
    status: 'pending',
    last_sync: null,
    capabilities: [],
    logo: '/johnmuir-logo.png'
  },
];

const capabilityLabels = {
  referrals: { label: 'Smart Referrals', color: 'bg-purple-100 text-purple-800' },
  records: { label: 'Health Records', color: 'bg-blue-100 text-blue-800' },
  medications: { label: 'Medications', color: 'bg-green-100 text-green-800' },
  labs: { label: 'Lab Results', color: 'bg-orange-100 text-orange-800' },
};

export default function HospitalNetworkPage() {
  const [organizations, setOrganizations] = useState(connectedOrganizations);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 className="h-7 w-7 text-purple-500" />
            Hospital Network
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Connected healthcare organizations for FHIR interoperability
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Request Connection
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {organizations.filter(o => o.status === 'active').length}
              </p>
              <p className="text-sm text-gray-500">Active Connections</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {organizations.filter(o => o.status === 'pending').length}
              </p>
              <p className="text-sm text-gray-500">Pending</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Server className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {organizations.filter(o => o.ehr_system === 'epic').length}
              </p>
              <p className="text-sm text-gray-500">Epic Systems</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Shield className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">SMART</p>
              <p className="text-sm text-gray-500">OAuth 2.0 Auth</p>
            </div>
          </div>
        </div>
      </div>

      {/* How FHIR Integration Works */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-4">How Hospital Integration Works</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-500 rounded-lg">
              <Link2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">FHIR R4 Protocol</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                We use the HL7 FHIR R4 standard - the same protocol used by Epic, Cerner, and all major EHRs.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-500 rounded-lg">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">SMART on FHIR Auth</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Secure OAuth 2.0 authentication ensures only authorized systems can exchange data.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-500 rounded-lg">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Bidirectional Exchange</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Send referrals out and receive care summaries back - true interoperability.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Connected Organizations */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">Connected Organizations</h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {organizations.map(org => (
            <div key={org.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-gray-500" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 dark:text-white">{org.name}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        org.status === 'active' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {org.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Server className="h-3 w-3" />
                        {org.ehr_system?.toUpperCase() || 'Unknown'}
                      </span>
                      {org.last_sync && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Synced {org.last_sync}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {org.capabilities.map(cap => (
                        <span 
                          key={cap} 
                          className={`px-2 py-0.5 text-xs rounded-full ${capabilityLabels[cap]?.color || 'bg-gray-100 text-gray-800'}`}
                        >
                          {capabilityLabels[cap]?.label || cap}
                        </span>
                      ))}
                    </div>
                    {org.fhir_endpoint && (
                      <div className="mt-2 text-xs text-gray-400 font-mono flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {org.fhir_endpoint}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {org.status === 'active' && (
                    <button className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" />
                      Test Connection
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FHIR Resources We Support */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Supported FHIR R4 Resources</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: 'Patient', desc: 'Demographics, identifiers' },
            { name: 'Encounter', desc: 'Visits, telehealth sessions' },
            { name: 'Observation', desc: 'Vitals, lab results' },
            { name: 'MedicationRequest', desc: 'Prescriptions' },
            { name: 'ServiceRequest', desc: 'Referrals' },
            { name: 'Consent', desc: 'Data sharing authorization' },
            { name: 'DiagnosticReport', desc: 'Labs, imaging' },
            { name: 'Condition', desc: 'Diagnoses (ICD-10)' },
          ].map(resource => (
            <div key={resource.name} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <p className="font-medium text-purple-600">{resource.name}</p>
              <p className="text-xs text-gray-500">{resource.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
