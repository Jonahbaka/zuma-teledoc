'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, Settings, Shield, CheckCircle, AlertCircle,
  Clock, Zap, Globe, TestTube, FileText, Building2,
  Mail, Phone, MapPin, Hash, Users, ChevronDown,
  ChevronUp, ArrowRight, ExternalLink, Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';

// ─── Status config ────────────────────────────────────────────────────────────

const INTEGRATION_STATUS = {
  active:      { label: 'Active',          color: 'text-green-600',          bg: 'bg-green-500/10',  border: 'border-green-500/20'  },
  pending:     { label: 'Pending Setup',   color: 'text-amber-600',          bg: 'bg-amber-500/10',  border: 'border-amber-500/20'  },
  sandbox:     { label: 'Sandbox / Beta',  color: 'text-blue-600',           bg: 'bg-blue-500/10',   border: 'border-blue-500/20'   },
  unavailable: { label: 'Coming Soon',     color: 'text-muted-foreground',   bg: 'bg-accent',        border: 'border-border'        },
};

const VERIFY_STATUS = {
  pending:      { label: 'Under Review',  color: 'text-amber-600',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20',  icon: Clock },
  under_review: { label: 'Under Review',  color: 'text-blue-600',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   icon: Clock },
  verified:     { label: 'Verified',      color: 'text-green-600',  bg: 'bg-green-500/10',  border: 'border-green-500/20',  icon: CheckCircle },
  suspended:    { label: 'Suspended',     color: 'text-red-600',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    icon: AlertCircle },
};

// ─── Onboarding steps (shown when status !== 'verified') ─────────────────────

const ONBOARDING_STEPS = [
  {
    step: 1,
    title: 'Complete facility registration',
    desc: 'Submit your facility name, type, address, contact person, and licence details through the registration form.',
    action: { label: 'Go to Registration', href: '/ng/hospital/register' },
    doneWhen: (h) => !!h,
  },
  {
    step: 2,
    title: 'Verification by DoctaRx team',
    desc: 'Our team reviews your CAC number, NHIS code, facility licence and contact details. This typically takes 2–5 business days. You will receive an email notification when approved.',
    action: null,
    doneWhen: (h) => h?.status === 'verified',
  },
  {
    step: 3,
    title: 'Add clinical and administrative staff',
    desc: 'Once verified, add your doctors, nurses, pharmacists, and admin staff. Each doctor will receive a secure invite to create their provider profile.',
    action: { label: 'Manage Staff', href: '/ng/hospital/staff' },
    doneWhen: (h) => h?.status === 'verified' && (h?.staff_count || 0) > 0,
  },
  {
    step: 4,
    title: 'Configure your integrations',
    desc: 'Connect NHIA/NHIS for insurance verification, request FHIR R4 data exchange setup, and enable WhatsApp-assisted prescription dispensing for your patients.',
    action: null,
    doneWhen: () => false, // always show — ongoing configuration
  },
  {
    step: 5,
    title: 'Go live',
    desc: 'Your facility will be listed on DoctaRx Nigeria and patients will be able to book appointments, receive digital prescriptions, and access your services.',
    action: { label: 'View Dashboard', href: '/ng/hospital/dashboard' },
    doneWhen: (h) => h?.status === 'verified',
  },
];

// ─── Integration cards config ─────────────────────────────────────────────────

const INTEGRATIONS = [
  {
    key: 'nhia_nhis',
    label: 'NHIA / NHIS Insurance',
    shortDesc: 'Verify patient insurance eligibility and submit claims to the National Health Insurance Authority.',
    fullDesc: `Connect your facility to NHIA to verify patient NHIS coverage in real time, submit claims digitally, and receive pre-authorization responses. Required for treating NHIS-enrolled patients without paper forms.`,
    setupSteps: [
      'Email enterprise@doctarx.com with subject "NHIA Integration Request — [Facility Name]"',
      'Provide your NHIS provider code and facility registration number',
      'Our team contacts NHIA on your behalf to enable API access',
      'Test eligibility checks in sandbox before going live',
    ],
    icon: Shield,
    iconColor: 'text-purple-500',
    iconBg: 'bg-purple-500/10',
    defaultStatus: 'pending',
    capabilities: ['Eligibility verification', 'Claims submission', 'Pre-authorization', 'Capitation tracking'],
    contactAction: 'mailto:enterprise@doctarx.com?subject=NHIA%20Integration%20Request&body=Facility%20Name%3A%0ANHIS%20Code%3A%0ACAC%20Number%3A',
    ctaLabel: 'Request NHIA Setup',
  },
  {
    key: 'fhir_r4',
    label: 'FHIR R4 — Health Data Exchange',
    shortDesc: 'Bidirectional health data exchange: referrals, patient records, medications, lab results, and encounter summaries.',
    fullDesc: `HL7 FHIR R4 enables your facility to send and receive structured health data with other participating hospitals, labs, and healthcare providers on the DoctaRx network. Currently in sandbox — live exchange is being piloted with select facilities.

Supported FHIR resources: Patient, Practitioner, Organization, MedicationRequest, Encounter, DiagnosticReport, Observation, ServiceRequest (Referral).

SMART on FHIR OAuth 2.0 authorization is in sandbox. No live bidirectional exchange yet.`,
    setupSteps: [
      'Contact enterprise@doctarx.com to join the FHIR R4 pilot programme',
      'Provide your FHIR endpoint URL (if you have an existing FHIR server)',
      'DoctaRx provisions a sandbox FHIR endpoint for your facility',
      'Test resource exchange — Patient, Encounter, MedicationRequest',
      'Sign data sharing agreement (NDPA compliant)',
      'Go live on bidirectional exchange',
    ],
    icon: Globe,
    iconColor: 'text-blue-500',
    iconBg: 'bg-blue-500/10',
    defaultStatus: 'sandbox',
    capabilities: ['Patient resource', 'Practitioner resource', 'MedicationRequest', 'Encounter', 'DiagnosticReport', 'Referral (ServiceRequest)'],
    contactAction: 'mailto:enterprise@doctarx.com?subject=FHIR%20R4%20Pilot%20Programme&body=Facility%20Name%3A%0AExisting%20FHIR%20Server%3A%0AContact%20Person%3A',
    ctaLabel: 'Join FHIR Pilot',
  },
  {
    key: 'whatsapp_dispense',
    label: 'WhatsApp Dispense',
    shortDesc: 'Route digital prescriptions to your pharmacy via WhatsApp. Patients receive pickup/delivery notifications automatically.',
    fullDesc: `WhatsApp-assisted dispensing allows providers to route prescriptions directly to your in-house pharmacy. Patients receive a WhatsApp message with their prescription reference, pickup instructions, and status updates.

The dispensing queue is managed within your DoctaRx pharmacy dashboard. No additional hardware required — works on any smartphone.`,
    setupSteps: [
      'Ensure your facility has a registered WhatsApp Business number',
      'Email enterprise@doctarx.com with your WhatsApp Business number',
      'DoctaRx links your number to the dispense notification system',
      'Test with a sample prescription routing flow',
      'Enable for your in-house pharmacy',
    ],
    icon: Zap,
    iconColor: 'text-green-500',
    iconBg: 'bg-green-500/10',
    defaultStatus: 'pending',
    capabilities: ['Prescription routing', 'Patient pickup notifications', 'Dispense confirmation', 'Delivery status'],
    contactAction: 'mailto:enterprise@doctarx.com?subject=WhatsApp%20Dispense%20Setup&body=Facility%20Name%3A%0AWhatsApp%20Business%20Number%3A',
    ctaLabel: 'Request WhatsApp Setup',
  },
  {
    key: 'lab_systems',
    label: 'Laboratory Integration',
    shortDesc: 'Connect your lab system for digital test orders, result delivery, and critical value alerts.',
    fullDesc: `Laboratory integration enables providers to order tests digitally, track sample status, and receive results electronically within the patient record. Critical values trigger automatic provider alerts.

Integration adapters are being developed for common Nigerian laboratory information systems (LIS). Contact us if you run an in-house lab.`,
    setupSteps: [
      'Contact enterprise@doctarx.com with your LIS software name',
      'DoctaRx assesses integration compatibility',
      'Custom adapter development (if needed)',
      'Pilot testing with selected test orders',
    ],
    icon: TestTube,
    iconColor: 'text-amber-500',
    iconBg: 'bg-amber-500/10',
    defaultStatus: 'unavailable',
    capabilities: ['Lab order transmission', 'Result delivery', 'Critical value alerts', 'Sample tracking'],
    contactAction: 'mailto:enterprise@doctarx.com?subject=Lab%20Integration%20Interest&body=Facility%20Name%3A%0ALIS%20Software%3A',
    ctaLabel: 'Express Interest',
  },
  {
    key: 'emr',
    label: 'EMR / EHR System',
    shortDesc: 'Sync your existing Electronic Medical Records system with DoctaRx for unified patient history.',
    fullDesc: `If your facility already uses an EMR/EHR, DoctaRx can establish a sync layer to avoid duplicate data entry. Patient demographics, encounter notes, medication history, and documents can be surfaced within the DoctaRx portal.

Supported via FHIR R4 export from your EMR or via custom API adapter.`,
    setupSteps: [
      'Email enterprise@doctarx.com with your EMR software name and version',
      'DoctaRx reviews integration options (FHIR export, HL7 v2, custom API)',
      'Integration scoping call with your IT team',
      'Phased rollout starting with patient demographics',
    ],
    icon: FileText,
    iconColor: 'text-indigo-500',
    iconBg: 'bg-indigo-500/10',
    defaultStatus: 'pending',
    capabilities: ['Patient demographics sync', 'Encounter notes', 'Medication history', 'Document exchange'],
    contactAction: 'mailto:enterprise@doctarx.com?subject=EMR%20Integration%20Request&body=Facility%20Name%3A%0AEMR%20Software%3A%0AEMR%20Version%3A',
    ctaLabel: 'Request EMR Integration',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function HospitalSettings() {
  const [hospital, setHospital] = useState(null);
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const hospitalId = localStorage.getItem('ng_hospital_id');
    if (!token || !hospitalId) { setNotFound(true); setLoading(false); return; }

    Promise.all([
      fetch(`/api/ng/hospitals/${hospitalId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch(`/api/ng/hospitals/${hospitalId}/integrations`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({ integrations: [] })),
    ]).then(([h, i]) => {
      if (!h.hospital) { setNotFound(true); return; }
      setHospital(h.hospital);
      setIntegrations(i.integrations || []);
    }).catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key) => setExpanded(e => ({ ...e, [key]: !e[key] }));

  const liveStatus = (key, defaultStatus) => {
    const live = integrations.find(i => i.integration_type === key);
    return live?.status || defaultStatus;
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── Not logged in / no hospital ──
  if (notFound) return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-2xl mx-auto px-6 py-16 text-center space-y-6">
        <div className="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mx-auto">
          <Building2 size={28} className="text-purple-500" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">No Hospital Account Found</h1>
        <p className="text-muted-foreground text-sm">You need to register your facility before accessing settings and integrations.</p>
        <Link href="/ng/hospital/register">
          <Button className="bg-purple-600 hover:bg-purple-500 text-white px-8 h-11 rounded-2xl font-bold">
            Register Your Facility <ArrowRight size={16} className="ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  );

  const vStatus = VERIFY_STATUS[hospital?.status] || VERIFY_STATUS.pending;
  const VIcon = vStatus.icon;
  const isVerified = hospital?.status === 'verified';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/ng/hospital/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <ChevronLeft size={16} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Settings & Integrations</h1>
            <p className="text-muted-foreground text-sm">{hospital?.name}</p>
          </div>
        </div>

        {/* ── Verification status banner ── */}
        <div className={`rounded-2xl p-5 border flex items-start gap-4 ${vStatus.bg} ${vStatus.border}`}>
          <VIcon size={22} className={`${vStatus.color} shrink-0 mt-0.5`} />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`font-bold text-sm ${vStatus.color}`}>Facility Status: {vStatus.label}</p>
            </div>
            {hospital?.status === 'pending' || hospital?.status === 'under_review' ? (
              <p className="text-sm text-muted-foreground mt-1">
                Your registration is being reviewed by the DoctaRx team. This typically takes <strong className="text-foreground">2–5 business days</strong>. You will receive an email at <strong className="text-foreground">{hospital?.contact_email || 'your registered email'}</strong> once approved.
              </p>
            ) : hospital?.status === 'verified' ? (
              <p className="text-sm text-muted-foreground mt-1">Your facility is verified and live on DoctaRx Nigeria. You can now onboard staff and configure integrations.</p>
            ) : hospital?.status === 'suspended' ? (
              <p className="text-sm text-muted-foreground mt-1">Your account has been suspended. Contact <a href="mailto:support@doctarx.com" className="text-purple-500 underline">support@doctarx.com</a> for assistance.</p>
            ) : null}
          </div>
        </div>

        {/* ── Onboarding Checklist ── */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-gradient-to-r from-purple-500/5 to-transparent">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <CheckCircle size={18} className="text-purple-500" /> Hospital Onboarding Checklist
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Follow these steps to fully activate your facility on DoctaRx Nigeria</p>
          </div>
          <div className="divide-y divide-border">
            {ONBOARDING_STEPS.map((s) => {
              const done = s.doneWhen(hospital);
              return (
                <div key={s.step} className={`px-6 py-4 flex items-start gap-4 ${done ? 'opacity-60' : ''}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs ${done ? 'bg-green-500 text-white' : 'bg-accent text-muted-foreground border border-border'}`}>
                    {done ? <CheckCircle size={14} /> : s.step}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{s.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.desc}</p>
                    {s.action && !done && (
                      <Link href={s.action.href} className="inline-flex items-center gap-1 text-xs text-purple-500 font-medium mt-2 hover:underline">
                        {s.action.label} <ArrowRight size={12} />
                      </Link>
                    )}
                  </div>
                  {done && <CheckCircle size={16} className="text-green-500 shrink-0 mt-1" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Facility Profile ── */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <Settings size={16} className="text-purple-500" /> Facility Profile
            </h2>
            <a href="mailto:support@doctarx.com?subject=Update%20Facility%20Profile" className="text-xs text-purple-500 hover:underline flex items-center gap-1">
              Request Update <ExternalLink size={11} />
            </a>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: Building2, label: 'Facility Name', value: hospital?.name },
              { icon: Building2, label: 'Type', value: hospital?.facility_type?.replace(/_/g, ' '), capitalize: true },
              { icon: MapPin,    label: 'Location', value: [hospital?.address_line1, hospital?.city, hospital?.state].filter(Boolean).join(', ') },
              { icon: Users,     label: 'Contact Person', value: hospital?.contact_name },
              { icon: Phone,     label: 'Contact Phone', value: hospital?.contact_phone },
              { icon: Mail,      label: 'Contact Email', value: hospital?.contact_email },
              { icon: Hash,      label: 'NHIS Code', value: hospital?.nhis_code || 'Not provided' },
              { icon: Hash,      label: 'CAC / RC Number', value: hospital?.cac_number || 'Not provided' },
              { icon: Hash,      label: 'Bed Capacity', value: hospital?.bed_count ? `${hospital.bed_count} beds` : 'Not specified' },
            ].map(({ icon: Icon, label, value, capitalize }) => (
              <div key={label} className="flex items-start gap-2.5">
                <Icon size={14} className="text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
                  <p className={`text-sm font-medium text-foreground ${capitalize ? 'capitalize' : ''}`}>{value || '—'}</p>
                </div>
              </div>
            ))}
          </div>
          {hospital?.departments?.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-2">Departments</p>
              <div className="flex flex-wrap gap-1.5">
                {hospital.departments.map(d => (
                  <span key={d} className="text-xs bg-purple-500/10 text-purple-600 border border-purple-500/20 px-2.5 py-1 rounded-full">{d}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Integrations ── */}
        <div>
          <h2 className="text-lg font-bold text-foreground mb-1">Integrations & Interoperability</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Connect your facility to insurance networks, health data exchange, and digital dispensing systems. Each integration includes step-by-step setup instructions.
          </p>

          <div className="space-y-3">
            {INTEGRATIONS.map((intg) => {
              const Icon = intg.icon;
              const effectiveStatus = liveStatus(intg.key, intg.defaultStatus);
              const cfg = INTEGRATION_STATUS[effectiveStatus] || INTEGRATION_STATUS.pending;
              const liveIntg = integrations.find(i => i.integration_type === intg.key);
              const isExpanded = expanded[intg.key];

              return (
                <div key={intg.key} className="bg-card border border-border rounded-2xl overflow-hidden transition-all">
                  {/* Card header — always visible */}
                  <button onClick={() => toggle(intg.key)} className="w-full px-5 py-4 flex items-center gap-4 hover:bg-accent/30 transition-colors text-left">
                    <div className={`w-10 h-10 ${intg.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                      <Icon size={18} className={intg.iconColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-foreground text-sm">{intg.label}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{intg.shortDesc}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Live CTA — functional mailto */}
                      {effectiveStatus !== 'active' && (
                        <a href={intg.contactAction} onClick={e => e.stopPropagation()}
                          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                            effectiveStatus === 'unavailable'
                              ? 'border-border text-muted-foreground hover:bg-accent'
                              : 'border-purple-500/30 text-purple-500 hover:bg-purple-500/10'
                          }`}>
                          {intg.ctaLabel}
                        </a>
                      )}
                      {effectiveStatus === 'active' && (
                        <span className="text-xs px-3 py-1.5 rounded-lg border border-green-500/30 text-green-600 bg-green-500/10 font-medium">
                          Connected
                        </span>
                      )}
                      {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border px-5 py-5 space-y-5 bg-accent/20">
                      {/* Full description */}
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{intg.fullDesc}</p>

                      {/* Capabilities */}
                      <div>
                        <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">Capabilities</p>
                        <div className="flex flex-wrap gap-1.5">
                          {intg.capabilities.map(c => (
                            <span key={c} className="text-xs bg-background border border-border text-muted-foreground px-2.5 py-1 rounded-full">{c}</span>
                          ))}
                        </div>
                      </div>

                      {/* Setup steps */}
                      <div>
                        <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-3">How to Set Up</p>
                        <div className="space-y-2">
                          {intg.setupSteps.map((step, idx) => (
                            <div key={idx} className="flex items-start gap-3">
                              <div className="w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-[10px] font-bold text-purple-500">{idx + 1}</span>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Last sync / error from live data */}
                      {liveIntg?.last_sync_at && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock size={11} /> Last sync: {new Date(liveIntg.last_sync_at).toLocaleString('en-NG')}
                        </p>
                      )}
                      {liveIntg?.error_message && (
                        <p className="text-xs text-red-500 flex items-center gap-1.5">
                          <AlertCircle size={11} /> {liveIntg.error_message}
                        </p>
                      )}

                      {/* CTA */}
                      <div className="flex gap-2 pt-1">
                        <a href={intg.contactAction}
                          className={`inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl font-medium transition-colors ${
                            effectiveStatus === 'unavailable'
                              ? 'bg-accent text-muted-foreground'
                              : 'bg-purple-600 hover:bg-purple-500 text-white'
                          }`}>
                          <Mail size={14} /> {intg.ctaLabel}
                        </a>
                        {effectiveStatus === 'sandbox' && (
                          <a href="mailto:enterprise@doctarx.com"
                            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-blue-500/30 text-blue-500 hover:bg-blue-500/10 font-medium transition-colors">
                            <ExternalLink size={14} /> Contact Pilot Team
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── NDPA / compliance note ── */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 flex gap-3">
          <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold text-foreground mb-1">Data Protection Notice</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              All integrations are implemented in compliance with the <strong className="text-foreground">Nigeria Data Protection Act (NDPA) 2023</strong>. Patient data shared through FHIR R4 or EMR integrations is encrypted in transit (TLS 1.3) and at rest. A data processing agreement is required before any live integration goes active. Contact <a href="mailto:compliance@doctarx.com" className="text-purple-500 underline">compliance@doctarx.com</a> for DPA documentation.
            </p>
          </div>
        </div>

        {/* ── Help ── */}
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-bold text-foreground text-sm">Need help with onboarding?</p>
            <p className="text-xs text-muted-foreground mt-0.5">Our hospital success team is available Mon–Fri, 8am–6pm WAT.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a href="mailto:hospitals@doctarx.com" className="inline-flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-xl font-medium transition-colors">
              <Mail size={13} /> Email Support
            </a>
            <a href="tel:+2348000000000" className="inline-flex items-center gap-1.5 text-xs border border-border text-foreground px-4 py-2 rounded-xl font-medium hover:bg-accent transition-colors">
              <Phone size={13} /> Call Us
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}
