'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Stethoscope, TrendingUp, Users, Globe, DollarSign, Shield,
  Zap, Target, BarChart3, ChevronRight, ChevronLeft, ArrowRight,
  Heart, Brain, Building2, Rocket, Award, CheckCircle2,
  Smartphone, Lock, Clock, Star, Sparkles, PieChart,
  LineChart, Briefcase, FileText, Download
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

// ═══ PRINT STYLES ═══
if (typeof window !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `
    @media print {
      body { margin: 0; padding: 0; background: white; }
      .pitch-slide { page-break-after: always; }
      button { display: none !important; }
      .slide-controls { display: none !important; }
      .slide-thumbnails { display: none !important; }
      .slide-presenter { height: auto !important; min-height: 11in; }
    }
  `;
  document.head.appendChild(style);
}

// ═══ PITCH DECK SLIDES ═══
const SLIDES = [
  'cover',
  'problem',
  'solution',
  'product',
  'market',
  'business_model',
  'traction',
  'financials',
  'competition',
  'team',
  'go_to_market',
  'the_ask',
  'appendix'
];

export default function PitchDeckPage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [financials, setFinancials] = useState(null);
  const [isPresenting, setIsPresenting] = useState(false);

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const apiCall = useCallback(async (endpoint) => {
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/financial${endpoint}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      return await res.json();
    } catch { return { success: false }; }
  }, []);

  useEffect(() => {
    loadFinancials();
  }, []);

  async function loadFinancials() {
    const res = await apiCall('/dashboard');
    if (res.success) setFinancials(res.data);
  }

  const nextSlide = () => setCurrentSlide(s => Math.min(s + 1, SLIDES.length - 1));
  const prevSlide = () => setCurrentSlide(s => Math.max(s - 1, 0));

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
      if (e.key === 'ArrowLeft') prevSlide();
      if (e.key === 'Escape') setIsPresenting(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const slide = SLIDES[currentSlide];
  const fmt = (n) => `$${(parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

  return (
    <div className={`min-h-screen bg-gray-950 text-white ${isPresenting ? 'fixed inset-0 z-50' : ''}`}>
      {/* Controls */}
      {!isPresenting && (
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-purple-400" />
              Investor Pitch Deck
            </h1>
            <p className="text-xs text-gray-500">Confidential — For qualified investors only</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{currentSlide + 1} / {SLIDES.length}</span>
            <button 
              onClick={() => {
                // Download the standalone pitch deck as HTML
                const link = document.createElement('a');
                link.href = '/pitch-deck';
                link.target = '_blank';
                link.download = `DoctaRx-Pitch-Deck-${new Date().toISOString().split('T')[0]}.html`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium flex items-center gap-2"
              title="Download Pitch Deck as HTML (print to PDF from your browser)"
            >
              <Download className="w-4 h-4" />
              Download Deck
            </button>
            <button onClick={() => setIsPresenting(true)} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium">
              Present Mode
            </button>
          </div>
        </div>
      )}

      {/* Slide Navigation */}
      <div className="flex">
        {/* Slide Thumbnails (sidebar, not in present mode) */}
        {!isPresenting && (
          <div className="w-48 border-r border-gray-800 p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-80px)]">
            {SLIDES.map((s, i) => (
              <button
                key={s}
                onClick={() => setCurrentSlide(i)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                  currentSlide === i
                    ? 'bg-purple-600/20 text-purple-300 border border-purple-600/40'
                    : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                }`}
              >
                <span className="text-gray-600 mr-2">{i + 1}.</span>
                {s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </button>
            ))}
          </div>
        )}

        {/* Main Slide Area */}
        <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-80px)] relative">
          {/* Nav arrows */}
          <button onClick={prevSlide} disabled={currentSlide === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-gray-800/50 hover:bg-gray-700/50 disabled:opacity-20 z-10">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={nextSlide} disabled={currentSlide === SLIDES.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-gray-800/50 hover:bg-gray-700/50 disabled:opacity-20 z-10">
            <ChevronRight className="w-5 h-5" />
          </button>

          {isPresenting && (
            <button onClick={() => setIsPresenting(false)} className="absolute top-4 right-4 px-3 py-1 rounded bg-gray-800/80 text-xs text-gray-400 hover:text-white z-20">
              ESC
            </button>
          )}

          {/* ═══════════════════════ SLIDES ═══════════════════════ */}
          <div className="w-full max-w-5xl mx-auto px-8 py-12">

            {/* COVER */}
            {slide === 'cover' && (
              <div className="text-center space-y-8">
                <div className="w-24 h-24 mx-auto rounded-2xl bg-gradient-to-br from-purple-600 via-blue-600 to-cyan-500 flex items-center justify-center shadow-2xl shadow-purple-900/50">
                  <Stethoscope className="w-12 h-12 text-white" />
                </div>
                <div>
                  <h1 className="text-6xl font-black tracking-tight bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                    DoctaRx
                  </h1>
                  <p className="text-xl text-gray-400 mt-4 max-w-2xl mx-auto">
                    The AI-Powered Telehealth Platform Making Healthcare Accessible, Affordable, and Intelligent
                  </p>
                </div>
                <div className="flex justify-center gap-6 text-sm text-gray-500">
                  <span className="flex items-center gap-1"><Shield className="w-4 h-4" /> HIPAA Compliant</span>
                  <span className="flex items-center gap-1"><Brain className="w-4 h-4" /> AI-Native</span>
                  <span className="flex items-center gap-1"><Globe className="w-4 h-4" /> Nationwide</span>
                </div>
                <p className="text-sm text-gray-600 mt-8">Confidential — February 2026 — Seed Round</p>
              </div>
            )}

            {/* PROBLEM */}
            {slide === 'problem' && (
              <div className="space-y-8">
                <SectionHeader icon={Heart} title="The Problem" subtitle="Healthcare is broken — and 83M Americans know it" color="red" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <ProblemCard number="83M" label="Americans lack adequate healthcare access" detail="Rural areas, underserved communities, working families" />
                  <ProblemCard number="$4.5T" label="US healthcare spending annually" detail="Yet outcomes rank 37th globally (WHO)" />
                  <ProblemCard number="24 days" label="Average wait for a new patient appointment" detail="Urgent needs go unmet for weeks" />
                </div>
                <div className="bg-red-900/10 border border-red-800/30 rounded-xl p-6 mt-6">
                  <h4 className="text-red-400 font-semibold mb-3">The Pain Points:</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      'Long wait times for appointments',
                      'Expensive out-of-pocket costs',
                      'Provider burnout & admin overload',
                      'Fragmented medical records',
                      'No price transparency',
                      'Insurance complexity & denials'
                    ].map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-gray-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" /> {p}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SOLUTION */}
            {slide === 'solution' && (
              <div className="space-y-8">
                <SectionHeader icon={Zap} title="Our Solution" subtitle="AI-first telehealth that works for patients AND providers" color="emerald" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { icon: Smartphone, title: 'Instant Access', desc: 'See a doctor in minutes, not weeks. Board-certified providers available 24/7 via video, chat, or phone.' },
                    { icon: Brain, title: 'AI-Powered Intelligence', desc: 'Smart triage, predictive health insights, AI-assisted clinical notes (SOAP), and intelligent prescription management.' },
                    { icon: DollarSign, title: 'Transparent Pricing', desc: 'Clear, upfront costs. Subscriptions from $19.99/mo. No surprise bills. Insurance accepted.' },
                    { icon: Lock, title: 'HIPAA-First Security', desc: 'End-to-end encryption, SOC 2 compliant, FHIR-native interoperability. Your data, your control.' }
                  ].map((s, i) => (
                    <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                      <s.icon className="w-8 h-8 text-emerald-400 mb-3" />
                      <h4 className="text-lg font-semibold text-white mb-2">{s.title}</h4>
                      <p className="text-sm text-gray-400">{s.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PRODUCT */}
            {slide === 'product' && (
              <div className="space-y-8">
                <SectionHeader icon={Sparkles} title="The Product" subtitle="Full-stack telehealth — built for scale" color="blue" />
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { title: 'Video Consultations', desc: 'HD video with AI-powered clinical notes' },
                    { title: 'E-Prescribing', desc: 'Send Rx directly to patient pharmacy' },
                    { title: 'AI Triage', desc: 'Smart symptom checker routes patients to care' },
                    { title: 'Insurance Wallet', desc: 'OCR card scanning, real-time eligibility' },
                    { title: 'Clinical Records', desc: 'FHIR-native EHR with provider interop' },
                    { title: 'Provider Dashboard', desc: 'Schedule, patients, revenue — all in one' },
                    { title: 'Predictive Analytics', desc: 'ML models for patient outcomes & churn' },
                    { title: 'Payment Processing', desc: 'Stripe-powered billing, auto-claims' },
                    { title: 'AI Agent Society', desc: '6 autonomous agents managing operations' }
                  ].map((f, i) => (
                    <div key={i} className="bg-gray-800/40 rounded-lg p-4 border border-gray-700/30">
                      <h5 className="text-sm font-semibold text-white mb-1">{f.title}</h5>
                      <p className="text-xs text-gray-500">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* MARKET */}
            {slide === 'market' && (
              <div className="space-y-8">
                <SectionHeader icon={Globe} title="Market Opportunity" subtitle="Telehealth is inevitable — we're building the platform that wins" color="cyan" />
                <div className="grid grid-cols-3 gap-6">
                  <MarketCircle label="TAM" amount="$460B" desc="US Healthcare Services Market" color="cyan" />
                  <MarketCircle label="SAM" amount="$83B" desc="US Telehealth Market (2030)" color="blue" />
                  <MarketCircle label="SOM" amount="$830M" desc="1% capture — achievable in 5 years" color="purple" />
                </div>
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 mt-4">
                  <h4 className="text-sm font-semibold text-gray-300 mb-3">Market Tailwinds</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      'Post-COVID permanent telehealth adoption',
                      'CMS expanded reimbursement for virtual visits',
                      'Provider shortage: 124K+ physician deficit by 2034',
                      'AI in healthcare CAGR: 48.1% (2024-2030)',
                      'Consumer demand for digital-first healthcare',
                      'Value-based care transition driving innovation'
                    ].map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-gray-400">
                        <CheckCircle2 className="w-4 h-4 text-cyan-500 mt-0.5 flex-shrink-0" /> {t}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* BUSINESS MODEL */}
            {slide === 'business_model' && (
              <div className="space-y-8">
                <SectionHeader icon={DollarSign} title="Business Model" subtitle="Multiple revenue streams — high margins, recurring revenue" color="emerald" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { stream: 'Patient Subscriptions', price: '$19.99 - $79.99/mo', margin: '85%', desc: 'Basic, Gold, Platinum tiers with increasing access and benefits' },
                    { stream: 'Provider Platform Fees', price: '$99 - $499/mo', margin: '90%', desc: 'SaaS fees for providers to practice on the platform' },
                    { stream: 'Consultation Fees', price: '$49 - $129/visit', margin: '30-40%', desc: 'Per-visit fees for non-subscribers, specialist consultations' },
                    { stream: 'Credentialing Services', price: '$99 - $199', margin: '80%', desc: 'One-time provider application, verification, licensing' },
                    { stream: 'Insurance Claims', price: 'Variable', margin: '15-25%', desc: 'Billing for insured visits, prior auth, claims processing' },
                    { stream: 'Enterprise / White-Label', price: '$2,000+/mo', margin: '70%', desc: 'Custom deployments for health systems, employers' }
                  ].map((r, i) => (
                    <div key={i} className="bg-gray-800/40 rounded-lg p-4 border border-gray-700/30">
                      <div className="flex items-center justify-between mb-1">
                        <h5 className="text-sm font-semibold text-white">{r.stream}</h5>
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-400">{r.margin} margin</span>
                      </div>
                      <p className="text-lg font-bold text-emerald-400">{r.price}</p>
                      <p className="text-xs text-gray-500 mt-1">{r.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-emerald-900/10 border border-emerald-800/30 rounded-xl p-4 text-center">
                  <p className="text-emerald-400 font-semibold">Blended Gross Margin Target: 70%+ &bull; LTV/CAC Ratio Target: 5:1+</p>
                </div>
              </div>
            )}

            {/* TRACTION */}
            {slide === 'traction' && (
              <div className="space-y-8">
                <SectionHeader icon={Rocket} title="Traction" subtitle="Built & shipping — key milestones achieved" color="amber" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <TractionCard label="Platform" value="Live" sub="Full-stack deployed" />
                  <TractionCard label="AI Agents" value="7" sub="Autonomous agents active" />
                  <TractionCard label="Features" value="50+" sub="Shipping weekly" />
                  <TractionCard label="Compliance" value="HIPAA" sub="SOC 2 in progress" />
                </div>
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                  <h4 className="text-sm font-semibold text-gray-300 mb-4">Technical Milestones</h4>
                  <div className="space-y-3">
                    {[
                      { milestone: 'Full telehealth platform with video, chat, scheduling', status: 'done' },
                      { milestone: 'E-prescribing integration (eRx)', status: 'done' },
                      { milestone: 'AI-powered triage & predictive analytics engine', status: 'done' },
                      { milestone: 'FHIR-native health data interoperability', status: 'done' },
                      { milestone: 'Stripe payment processing & subscription billing', status: 'done' },
                      { milestone: 'AI Agent Orchestrator — 7 autonomous agents', status: 'done' },
                      { milestone: 'CRM with automated outreach & web scraping', status: 'done' },
                      { milestone: 'Corporate financial system with real-time accounting', status: 'done' },
                      { milestone: 'Provider credentialing pipeline', status: 'done' },
                      { milestone: 'Insurance eligibility & claims processing', status: 'done' },
                    ].map((m, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        <span className="text-sm text-gray-300">{m.milestone}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* FINANCIALS */}
            {slide === 'financials' && (
              <div className="space-y-8">
                <SectionHeader icon={LineChart} title="Financial Projections" subtitle="Conservative base case — 5-year outlook" color="emerald" />
                {/* 5-Year Projection Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left py-3 font-medium">Metric</th>
                        <th className="text-right py-3 font-medium">Year 1</th>
                        <th className="text-right py-3 font-medium">Year 2</th>
                        <th className="text-right py-3 font-medium">Year 3</th>
                        <th className="text-right py-3 font-medium">Year 4</th>
                        <th className="text-right py-3 font-medium">Year 5</th>
                      </tr>
                    </thead>
                    <tbody>
                      <ProjectionRow label="Patients" values={['500', '5,000', '25,000', '75,000', '200,000']} />
                      <ProjectionRow label="Providers" values={['25', '100', '400', '1,200', '3,000']} />
                      <ProjectionRow label="Annual Revenue" values={['$120K', '$1.8M', '$12M', '$45M', '$120M']} highlight />
                      <ProjectionRow label="Gross Margin" values={['65%', '70%', '75%', '78%', '80%']} />
                      <ProjectionRow label="Monthly Burn" values={['$40K', '$120K', '$350K', '$800K', '$1.5M']} />
                      <ProjectionRow label="Net Income" values={['-$360K', '-$600K', '$3M', '$18M', '$60M']} />
                      <ProjectionRow label="Cash Position" values={['$640K', '$1.5M', '$5M', '$25M', '$90M']} highlight />
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30">
                    <p className="text-xs text-gray-500">Break-Even</p>
                    <p className="text-2xl font-bold text-emerald-400">Month 18</p>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30">
                    <p className="text-xs text-gray-500">Year 5 ARR</p>
                    <p className="text-2xl font-bold text-emerald-400">$120M</p>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30">
                    <p className="text-xs text-gray-500">Year 5 Valuation (10x ARR)</p>
                    <p className="text-2xl font-bold text-purple-400">$1.2B</p>
                  </div>
                </div>
                {/* Live Financials */}
                {financials && (
                  <div className="bg-gradient-to-r from-emerald-900/20 to-blue-900/20 rounded-xl border border-emerald-700/20 p-5">
                    <h4 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                      <Zap className="w-4 h-4" /> Live Financial Data (Real-Time)
                    </h4>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-gray-500">Cash on Hand</p>
                        <p className="text-lg font-bold text-white">{fmt(financials.cash?.total)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">MTD Revenue</p>
                        <p className="text-lg font-bold text-emerald-400">{fmt(financials.monthly?.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Stripe Processed</p>
                        <p className="text-lg font-bold text-purple-400">{fmt(financials.stripe?.total_processed)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Runway</p>
                        <p className="text-lg font-bold text-amber-400">{financials.monthly?.runway_months || '∞'} months</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* COMPETITION */}
            {slide === 'competition' && (
              <div className="space-y-8">
                <SectionHeader icon={Target} title="Competitive Landscape" subtitle="We win on AI depth, provider experience, and price" color="purple" />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left py-3">Feature</th>
                        <th className="text-center py-3 text-purple-400 font-bold">DoctaRx</th>
                        <th className="text-center py-3">Teladoc</th>
                        <th className="text-center py-3">Amwell</th>
                        <th className="text-center py-3">MDLive</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { feature: 'AI-Powered Triage', us: true, t: false, a: false, m: false },
                        { feature: 'AI Clinical Notes (SOAP)', us: true, t: false, a: false, m: false },
                        { feature: 'Predictive Analytics', us: true, t: true, a: false, m: false },
                        { feature: 'E-Prescribing', us: true, t: true, a: true, m: true },
                        { feature: 'FHIR Interoperability', us: true, t: true, a: true, m: false },
                        { feature: 'Sub-$20/mo Plan', us: true, t: false, a: false, m: false },
                        { feature: 'AI Agent Automation', us: true, t: false, a: false, m: false },
                        { feature: 'Provider CRM + Outreach', us: true, t: false, a: false, m: false },
                        { feature: 'Insurance Wallet (OCR)', us: true, t: false, a: true, m: false },
                        { feature: 'Real-Time Accounting', us: true, t: false, a: false, m: false },
                      ].map((row, i) => (
                        <tr key={i} className="border-b border-gray-800/30">
                          <td className="py-2 text-gray-400">{row.feature}</td>
                          <td className="py-2 text-center">{row.us ? <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" /> : <span className="text-gray-600">—</span>}</td>
                          <td className="py-2 text-center">{row.t ? <CheckCircle2 className="w-4 h-4 text-gray-500 inline" /> : <span className="text-gray-600">—</span>}</td>
                          <td className="py-2 text-center">{row.a ? <CheckCircle2 className="w-4 h-4 text-gray-500 inline" /> : <span className="text-gray-600">—</span>}</td>
                          <td className="py-2 text-center">{row.m ? <CheckCircle2 className="w-4 h-4 text-gray-500 inline" /> : <span className="text-gray-600">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-purple-900/10 border border-purple-700/30 rounded-xl p-5">
                  <h4 className="text-sm font-semibold text-purple-400 mb-2">Our Moat</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm text-gray-400">
                    <div className="flex items-start gap-2"><Shield className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" /> AI-native architecture (not bolted on)</div>
                    <div className="flex items-start gap-2"><Shield className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" /> Autonomous agent orchestration (7 agents)</div>
                    <div className="flex items-start gap-2"><Shield className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" /> Data flywheel: more patients → better AI</div>
                    <div className="flex items-start gap-2"><Shield className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" /> 10x lower operating cost via AI automation</div>
                  </div>
                </div>
              </div>
            )}

            {/* TEAM */}
            {slide === 'team' && (
              <div className="space-y-8">
                <SectionHeader icon={Users} title="Team" subtitle="Builder-operators with healthcare + AI expertise" color="blue" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <TeamCard
                    name="Founder & CEO"
                    role="Vision, Product, AI Architecture"
                    highlights={['Full-stack engineer', 'Healthcare domain expertise', 'AI/ML systems architect', 'Built platform from ground up']}
                  />
                  <TeamCard
                    name="AI Agent Society"
                    role="7 Autonomous AI Agents"
                    highlights={['The Compliance Officer', 'The Revenue Agent', 'The Debugger', 'The Care Agent', 'The Growth Scout', 'The Strategist', 'The Treasurer']}
                  />
                  <TeamCard
                    name="Advisory (Building)"
                    role="Key Positions"
                    highlights={['Medical Director (hiring)', 'VP Engineering (hiring)', 'Head of Sales (hiring)', 'Legal/Compliance (hiring)']}
                  />
                </div>
                <div className="bg-blue-900/10 border border-blue-700/30 rounded-xl p-5 text-center">
                  <p className="text-blue-400 text-sm">Lean team + AI agents = 10x output. Our agents handle operations that typically require 20+ employees.</p>
                </div>
              </div>
            )}

            {/* GO TO MARKET */}
            {slide === 'go_to_market' && (
              <div className="space-y-8">
                <SectionHeader icon={Rocket} title="Go-to-Market Strategy" subtitle="Three-phase launch — crawl, walk, run" color="orange" />
                <div className="space-y-6">
                  {[
                    {
                      phase: 'Phase 1: Crawl (Months 1-6)',
                      color: 'amber',
                      items: ['Onboard first 25 providers (partner hospitals, clinics)', 'Organic patient acquisition via SEO, content marketing', 'AI CRM outreach to provider directories', 'Social media presence & thought leadership', 'First 500 patients via free consultation offers']
                    },
                    {
                      phase: 'Phase 2: Walk (Months 7-18)',
                      color: 'blue',
                      items: ['Scale to 100 providers across 10 states', 'Launch referral program (provider + patient)', 'Insurance payer partnerships', 'Employer wellness program partnerships', 'Content marketing + patient education hub']
                    },
                    {
                      phase: 'Phase 3: Run (Months 19-36)',
                      color: 'emerald',
                      items: ['Nationwide expansion to 50 states', 'Enterprise & white-label deals', 'International expansion planning', 'AI marketplace for third-party health apps', 'IPO readiness preparation']
                    }
                  ].map((p, i) => (
                    <div key={i} className={`bg-gray-900/50 border border-gray-800 rounded-xl p-6`}>
                      <h4 className={`text-lg font-semibold text-${p.color}-400 mb-3`}>{p.phase}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {p.items.map((item, j) => (
                          <div key={j} className="flex items-center gap-2 text-sm text-gray-400">
                            <ArrowRight className={`w-3 h-3 text-${p.color}-500 flex-shrink-0`} /> {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* THE ASK */}
            {slide === 'the_ask' && (
              <div className="space-y-8">
                <SectionHeader icon={Target} title="The Ask" subtitle="Seed Round — Building the future of healthcare" color="purple" />
                <div className="text-center mb-8">
                  <p className="text-6xl font-black bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">$1,000,000</p>
                  <p className="text-xl text-gray-400 mt-2">Seed Round &bull; Pre-Money Valuation: $5M</p>
                </div>
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                  <h4 className="text-sm font-semibold text-gray-300 mb-4">Use of Funds</h4>
                  <div className="space-y-3">
                    {[
                      { label: 'Engineering & Product', pct: 40, amount: '$400K', desc: 'Full-time engineers, infrastructure scaling' },
                      { label: 'Sales & Marketing', pct: 25, amount: '$250K', desc: 'Provider acquisition, patient growth, brand' },
                      { label: 'Compliance & Legal', pct: 15, amount: '$150K', desc: 'SOC 2, state licensing, legal counsel' },
                      { label: 'Operations', pct: 10, amount: '$100K', desc: 'Cloud hosting, APIs, insurance, office' },
                      { label: 'Reserve', pct: 10, amount: '$100K', desc: 'Runway buffer, contingency' }
                    ].map((u, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-300">{u.label}</span>
                          <span className="text-gray-400">{u.amount} ({u.pct}%)</span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div className="bg-gradient-to-r from-purple-500 to-cyan-500 h-2 rounded-full" style={{ width: `${u.pct}%` }} />
                        </div>
                        <p className="text-xs text-gray-600">{u.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30">
                    <p className="text-xs text-gray-500">18-Month Runway</p>
                    <p className="text-lg font-bold text-emerald-400">Guaranteed</p>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30">
                    <p className="text-xs text-gray-500">Target ARR @ Month 18</p>
                    <p className="text-lg font-bold text-emerald-400">$1.8M</p>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30">
                    <p className="text-xs text-gray-500">Series A Ready</p>
                    <p className="text-lg font-bold text-purple-400">Month 18-24</p>
                  </div>
                </div>
              </div>
            )}

            {/* APPENDIX */}
            {slide === 'appendix' && (
              <div className="space-y-8">
                <SectionHeader icon={FileText} title="Appendix" subtitle="Additional details available upon request" color="gray" />
                <div className="grid grid-cols-2 gap-4">
                  {[
                    'Detailed financial model (3-statement)',
                    'Technical architecture documentation',
                    'HIPAA compliance audit report',
                    'Provider onboarding playbook',
                    'AI Agent orchestration whitepaper',
                    'Insurance payer integration roadmap',
                    'Market research & competitive analysis',
                    'Cap table & equity structure'
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 bg-gray-800/40 rounded-lg p-4 border border-gray-700/30">
                      <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="text-sm text-gray-400">{item}</span>
                    </div>
                  ))}
                </div>
                <div className="text-center mt-8 space-y-4">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-600 via-blue-600 to-cyan-500 flex items-center justify-center">
                    <Stethoscope className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">DoctaRx</h3>
                  <p className="text-gray-500">Healthcare, Reimagined.</p>
                  <p className="text-sm text-gray-600">info@doctarx.com &bull; doctarx.com</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="fixed bottom-0 left-0 right-0 h-1 bg-gray-800">
        <div className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all duration-300" style={{ width: `${((currentSlide + 1) / SLIDES.length) * 100}%` }} />
      </div>
    </div>
  );
}

// ═══ Reusable Components ═══

function SectionHeader({ icon: Icon, title, subtitle, color }) {
  const colors = { red: 'text-red-400', emerald: 'text-emerald-400', blue: 'text-blue-400', cyan: 'text-cyan-400', purple: 'text-purple-400', amber: 'text-amber-400', orange: 'text-orange-400', gray: 'text-gray-400' };
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Icon className={`w-6 h-6 ${colors[color]}`} />
        <h2 className="text-3xl font-bold text-white">{title}</h2>
      </div>
      <p className="text-gray-500 text-lg">{subtitle}</p>
    </div>
  );
}

function ProblemCard({ number, label, detail }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 text-center">
      <p className="text-4xl font-black text-red-400">{number}</p>
      <p className="text-sm text-gray-300 mt-2 font-medium">{label}</p>
      <p className="text-xs text-gray-500 mt-1">{detail}</p>
    </div>
  );
}

function MarketCircle({ label, amount, desc, color }) {
  const colors = { cyan: 'from-cyan-600 to-cyan-800 border-cyan-500', blue: 'from-blue-600 to-blue-800 border-blue-500', purple: 'from-purple-600 to-purple-800 border-purple-500' };
  return (
    <div className="text-center">
      <div className={`w-40 h-40 mx-auto rounded-full bg-gradient-to-br ${colors[color]} border-4 flex flex-col items-center justify-center`}>
        <p className="text-xs text-gray-300 font-semibold">{label}</p>
        <p className="text-2xl font-black text-white">{amount}</p>
      </div>
      <p className="text-sm text-gray-400 mt-3">{desc}</p>
    </div>
  );
}

function TractionCard({ label, value, sub }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5 text-center">
      <p className="text-3xl font-black text-amber-400">{value}</p>
      <p className="text-sm font-medium text-gray-300 mt-1">{label}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </div>
  );
}

function ProjectionRow({ label, values, highlight }) {
  return (
    <tr className={`border-b border-gray-800/30 ${highlight ? 'bg-emerald-900/5' : ''}`}>
      <td className={`py-2 ${highlight ? 'text-emerald-400 font-semibold' : 'text-gray-400'}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`py-2 text-right font-mono ${highlight ? 'text-emerald-400 font-semibold' : 'text-gray-300'}`}>{v}</td>
      ))}
    </tr>
  );
}

function TeamCard({ name, role, highlights }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 mx-auto mb-4 flex items-center justify-center">
        <Users className="w-8 h-8 text-white" />
      </div>
      <h4 className="text-lg font-semibold text-white text-center">{name}</h4>
      <p className="text-xs text-gray-500 text-center mb-3">{role}</p>
      <div className="space-y-1">
        {highlights.map((h, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
            <div className="w-1 h-1 rounded-full bg-blue-500" /> {h}
          </div>
        ))}
      </div>
    </div>
  );
}
