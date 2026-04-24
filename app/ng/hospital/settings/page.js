'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, Settings, Activity, Shield, CheckCircle,
  AlertCircle, Clock, Zap, Globe, TestTube, FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';

const INTEGRATION_STATUS = {
  active: { label: 'Active', color: 'text-green-600', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  pending: { label: 'Pending Setup', color: 'text-amber-600', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  sandbox: { label: 'Sandbox', color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  unavailable: { label: 'Not Available', color: 'text-muted-foreground', bg: 'bg-accent', border: 'border-border' },
};

export default function HospitalSettings() {
  const [hospital, setHospital] = useState(null);
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const hospitalId = localStorage.getItem('ng_hospital_id');
    if (!token || !hospitalId) { setLoading(false); return; }
    Promise.all([
      fetch(`/api/ng/hospitals/${hospitalId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch(`/api/ng/hospitals/${hospitalId}/integrations`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([h, i]) => {
      setHospital(h.hospital);
      setIntegrations(i.integrations || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const integrationsConfig = [
    {
      key: 'nhia_nhis',
      label: 'NHIA / NHIS',
      desc: 'National Health Insurance Authority — insurance eligibility verification and claims',
      icon: Shield,
      status: 'pending',
      capabilities: ['Eligibility check', 'Claims submission', 'Pre-authorization'],
    },
    {
      key: 'fhir_r4',
      label: 'FHIR R4 — Health Data Exchange',
      desc: 'HL7 FHIR R4 bidirectional exchange: referrals, records, medications, lab results',
      icon: Globe,
      status: 'sandbox',
      capabilities: ['Patient', 'Practitioner', 'MedicationRequest', 'Encounter', 'DiagnosticReport', 'Referral'],
    },
    {
      key: 'lab_systems',
      label: 'Laboratory Systems',
      desc: 'Bi-directional lab order and result integration',
      icon: TestTube,
      status: 'unavailable',
      capabilities: ['Lab orders', 'Result delivery', 'Critical value alerts'],
    },
    {
      key: 'whatsapp_dispense',
      label: 'WhatsApp Dispense',
      desc: 'WhatsApp Business API for prescription routing and patient notifications',
      icon: Zap,
      status: 'pending',
      capabilities: ['Prescription routing', 'Patient notifications', 'Dispense confirmation'],
    },
    {
      key: 'emr',
      label: 'EMR / EHR System',
      desc: 'Connect your existing Electronic Medical Records system',
      icon: FileText,
      status: 'pending',
      capabilities: ['Patient records sync', 'Encounter notes', 'Medication history'],
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-4xl mx-auto px-6 py-8 space-y-8">

        <div className="flex items-center gap-3">
          <Link href="/ng/hospital/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Facility Settings & Integrations</h1>
            <p className="text-muted-foreground text-sm">Profile, interoperability and system connections</p>
          </div>
        </div>

        {/* Facility profile card */}
        {hospital && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
            <h3 className="font-bold text-foreground flex items-center gap-2"><Settings size={16} className="text-purple-500" /> Facility Profile</h3>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div><p className="text-muted-foreground text-xs">Facility Name</p><p className="font-medium text-foreground">{hospital.name}</p></div>
              <div><p className="text-muted-foreground text-xs">Type</p><p className="font-medium text-foreground capitalize">{hospital.facility_type?.replace(/_/g, ' ')}</p></div>
              <div><p className="text-muted-foreground text-xs">Location</p><p className="font-medium text-foreground">{hospital.city}, {hospital.state}</p></div>
              <div><p className="text-muted-foreground text-xs">Contact</p><p className="font-medium text-foreground">{hospital.contact_name}</p></div>
              {hospital.nhis_code && <div><p className="text-muted-foreground text-xs">NHIS Code</p><p className="font-medium text-foreground">{hospital.nhis_code}</p></div>}
              {hospital.cac_number && <div><p className="text-muted-foreground text-xs">CAC Number</p><p className="font-medium text-foreground">{hospital.cac_number}</p></div>}
            </div>
          </div>
        )}

        {/* Integrations */}
        <div>
          <h2 className="text-lg font-bold text-foreground mb-2">Interoperability & Integrations</h2>
          <p className="text-muted-foreground text-sm mb-5">Connect your facility to external health systems, insurers, and data exchange networks.</p>
          <div className="space-y-4">
            {integrationsConfig.map((intg) => {
              const Icon = intg.icon;
              const statusCfg = INTEGRATION_STATUS[intg.status];
              const liveIntg = integrations.find(i => i.integration_type === intg.key);
              const effectiveStatus = liveIntg?.status || intg.status;
              const cfg = INTEGRATION_STATUS[effectiveStatus] || statusCfg;

              return (
                <div key={intg.key} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center shrink-0">
                        <Icon size={18} className="text-purple-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-foreground text-sm">{intg.label}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                            {cfg.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{intg.desc}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {intg.capabilities.map(c => (
                            <span key={c} className="text-[10px] bg-accent text-muted-foreground px-2 py-0.5 rounded-full">{c}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {effectiveStatus === 'active' ? (
                        <Button size="sm" variant="outline" className="text-xs h-7">Configure</Button>
                      ) : effectiveStatus === 'sandbox' ? (
                        <Button size="sm" variant="outline" className="text-xs h-7 text-blue-500 border-blue-500/30">Test Connection</Button>
                      ) : (
                        <Button size="sm" variant="outline" className="text-xs h-7 text-muted-foreground" disabled>
                          {effectiveStatus === 'unavailable' ? 'Coming Soon' : 'Request Setup'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {liveIntg?.last_sync_at && (
                    <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                      <Clock size={10} /> Last sync: {new Date(liveIntg.last_sync_at).toLocaleString('en-NG')}
                    </p>
                  )}
                  {liveIntg?.error_message && (
                    <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                      <AlertCircle size={10} /> {liveIntg.error_message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* FHIR status note */}
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5 text-sm">
          <h3 className="font-bold text-foreground mb-2 flex items-center gap-2"><Globe size={15} className="text-blue-500" /> FHIR R4 Interoperability — Status</h3>
          <p className="text-muted-foreground">DoctaRx Nigeria is preparing FHIR R4 infrastructure for Patient, Practitioner, Organization, MedicationRequest, Encounter, DiagnosticReport, Observation and Referral resources. SMART on FHIR OAuth 2.0 authorization is in sandbox. Live bidirectional exchange is not yet available. Contact <strong className="text-foreground">enterprise@doctarx.com</strong> to join the pilot programme.</p>
        </div>

      </div>
    </div>
  );
}
