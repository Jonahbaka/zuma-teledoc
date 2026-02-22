'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Stethoscope, TrendingUp, Users, Globe, DollarSign, Shield,
  Zap, Target, BarChart3, ChevronRight, ChevronLeft, ArrowRight,
  Heart, Brain, Building2, Rocket, Award, CheckCircle2,
  Smartphone, Lock, Clock, Star, Sparkles, PieChart,
  LineChart, Briefcase, FileText, Download, Loader2
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const SLIDES = [
  'cover', 'problem', 'solution', 'product', 'market',
  'business_model', 'traction', 'financials', 'competition',
  'team', 'go_to_market', 'the_ask', 'appendix'
];

// ═══ PDF-safe icon replacement ═══
// html2canvas has known issues rendering SVG elements — these simple HTML
// shapes ensure reliable rendering in the downloaded PDF.
function PdfIcon({ size = 16, color = '#9ca3af', shape = 'square', style = {} }) {
  return (
    <span style={{
      display: 'inline-block',
      width: `${size}px`,
      height: `${size}px`,
      minWidth: `${size}px`,
      borderRadius: shape === 'circle' ? '50%' : '4px',
      backgroundColor: color,
      flexShrink: 0,
      verticalAlign: 'middle',
      ...style,
    }} />
  );
}

// ═══ SLIDE CONTENT ═══
// pdfMode: replaces gradient text (bg-clip-text) with solid colors for html2canvas,
//          replaces SVG icons with PdfIcon, uses inline styles for critical elements.
function SlideContent({ slide, financials, pdfMode }) {
  const fmt = (n) => `$${(parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  const gradientText = pdfMode ? 'text-purple-400' : 'bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent';
  const gradientTextAlt = pdfMode ? 'text-cyan-400' : 'bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent';

  if (slide === 'cover') return (
    <div className="text-center space-y-8">
      <div className="w-24 h-24 mx-auto rounded-2xl bg-gradient-to-br from-purple-600 via-blue-600 to-cyan-500 flex items-center justify-center shadow-2xl shadow-purple-900/50">
        {pdfMode ? <PdfIcon size={48} color="#ffffff" shape="circle" /> : <Stethoscope className="w-12 h-12 text-white" />}
      </div>
      <div>
        {pdfMode ? (
          <h1 style={{ fontSize: '56px', fontWeight: 900, letterSpacing: '-0.025em', color: '#c084fc', lineHeight: 1.1, margin: 0 }}>
            DoctaRx
          </h1>
        ) : (
          <h1 className={`text-6xl font-black tracking-tight ${gradientText}`}>
            DoctaRx
          </h1>
        )}
        {pdfMode ? (
          <p style={{ fontSize: '18px', color: '#9ca3af', marginTop: '16px', lineHeight: 1.5 }}>
            Doctor-Led Telehealth, Supercharged by AI &mdash; Making Healthcare Accessible, Affordable, and Intelligent
          </p>
        ) : (
          <p className="text-xl text-gray-400 mt-4 max-w-2xl mx-auto">
            Doctor-Led Telehealth, Supercharged by AI &mdash; Making Healthcare Accessible, Affordable, and Intelligent
          </p>
        )}
      </div>
      <div className="flex justify-center gap-6 text-sm text-gray-500">
        <span className="flex items-center gap-1">{pdfMode ? <PdfIcon size={16} color="#9ca3af" shape="circle" /> : <Stethoscope className="w-4 h-4" />} Doctor-Led</span>
        <span className="flex items-center gap-1">{pdfMode ? <PdfIcon size={16} color="#9ca3af" shape="circle" /> : <Shield className="w-4 h-4" />} HIPAA Compliant</span>
        <span className="flex items-center gap-1">{pdfMode ? <PdfIcon size={16} color="#9ca3af" shape="circle" /> : <Brain className="w-4 h-4" />} AI-Enhanced</span>
        <span className="flex items-center gap-1">{pdfMode ? <PdfIcon size={16} color="#9ca3af" shape="circle" /> : <Globe className="w-4 h-4" />} Nationwide</span>
      </div>
      <p className="text-sm text-gray-600 mt-8">Confidential &mdash; February 2026 &mdash; Seed Round</p>
    </div>
  );

  if (slide === 'problem') return (
    <div className="space-y-8">
      <SectionHeader icon={Heart} title="The Problem" subtitle="Healthcare is broken &mdash; and 83 million Americans know it" color="red" pdfMode={pdfMode} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ProblemCard number="83M" label="Americans lack adequate healthcare access" detail="Rural areas, underserved communities, working families" />
        <ProblemCard number="$4.5T" label="US healthcare spending annually" detail="Yet outcomes rank 37th globally (WHO)" />
        <ProblemCard number="24 days" label="Average wait for a new patient appointment" detail="Urgent needs go unmet for weeks" />
      </div>
      <div className="bg-red-900/10 border border-red-800/30 rounded-xl p-6 mt-6">
        <h4 className="text-red-400 font-semibold mb-3">The Pain Points:</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {['Long wait times for appointments', 'Expensive out-of-pocket costs', 'Provider burnout and admin overload', 'Fragmented medical records', 'No price transparency', 'Insurance complexity and denials'].map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-gray-400">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" /> {p}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (slide === 'solution') return (
    <div className="space-y-8">
      <SectionHeader icon={Zap} title="Our Solution" subtitle="Doctor-first telehealth, enhanced by AI &mdash; built for patients and providers" color="emerald" pdfMode={pdfMode} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[
          { icon: Smartphone, title: 'Instant Access', desc: 'See a board-certified doctor in minutes, not weeks. Licensed providers available via video, chat, or phone with AI-assisted scheduling and triage.', color: '#34d399' },
          { icon: Brain, title: 'AI-Assisted Clinical Tools', desc: 'AI helps providers with SOAP note drafting, smart triage routing, predictive health insights, and prescription management. Doctors make every final decision.', color: '#34d399' },
          { icon: DollarSign, title: 'Transparent Pricing', desc: 'Clear, upfront costs. Subscriptions from $19.99 per month. No surprise bills. Insurance accepted.', color: '#34d399' },
          { icon: Lock, title: 'HIPAA-First Security', desc: 'End-to-end encryption, SOC 2 compliant, FHIR-native interoperability. Your data, your control.', color: '#34d399' }
        ].map((s, i) => (
          <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            {pdfMode ? <PdfIcon size={32} color={s.color} shape="circle" style={{ marginBottom: '12px' }} /> : <s.icon className="w-8 h-8 text-emerald-400 mb-3" />}
            <h4 className="text-lg font-semibold text-white mb-2">{s.title}</h4>
            <p className="text-sm text-gray-400">{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );

  if (slide === 'product') return (
    <div className="space-y-8">
      <SectionHeader icon={Sparkles} title="The Product" subtitle="Full-stack telehealth platform &mdash; built by humans, enhanced by AI" color="blue" pdfMode={pdfMode} />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { title: 'Video Consultations', desc: 'HD video with AI-assisted clinical notes' },
          { title: 'E-Prescribing', desc: 'Send prescriptions directly to patient pharmacy' },
          { title: 'AI-Powered Triage', desc: 'Smart symptom routing with provider review' },
          { title: 'Insurance Wallet', desc: 'OCR card scanning, real-time eligibility' },
          { title: 'Clinical Records', desc: 'FHIR-native EHR with provider interoperability' },
          { title: 'Provider Dashboard', desc: 'Schedule, patients, revenue in one place' },
          { title: 'Predictive Analytics', desc: 'ML insights for clinical outcomes and retention' },
          { title: 'Payment Processing', desc: 'Stripe-powered billing, automated claims' },
          { title: 'OpenClaw AI Platform', desc: 'AI assistant for ops, content, analytics, and workflows' }
        ].map((f, i) => (
          <div key={i} className="bg-gray-800/40 rounded-lg p-4 border border-gray-700/30">
            <h5 className="text-sm font-semibold text-white mb-1">{f.title}</h5>
            <p className="text-xs text-gray-500">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );

  if (slide === 'market') return (
    <div className="space-y-8">
      <SectionHeader icon={Globe} title="Market Opportunity" subtitle="Telehealth is inevitable &mdash; we are building the platform that wins" color="cyan" pdfMode={pdfMode} />
      <div className="grid grid-cols-3 gap-6">
        <MarketCircle label="TAM" amount="$460B" desc="US Healthcare Services Market" color="cyan" pdfMode={pdfMode} />
        <MarketCircle label="SAM" amount="$83B" desc="US Telehealth Market (2030)" color="blue" pdfMode={pdfMode} />
        <MarketCircle label="SOM" amount="$830M" desc="1% capture in 5 years" color="purple" pdfMode={pdfMode} />
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
              {pdfMode ? <PdfIcon size={16} color="#06b6d4" shape="circle" style={{ marginTop: '2px' }} /> : <CheckCircle2 className="w-4 h-4 text-cyan-500 mt-0.5 flex-shrink-0" />} {t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (slide === 'business_model') return (
    <div className="space-y-8">
      <SectionHeader icon={DollarSign} title="Business Model" subtitle="Multiple revenue streams with high margins and recurring revenue" color="emerald" pdfMode={pdfMode} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { stream: 'Patient Subscriptions', price: '$19.99 - $79.99/mo', margin: '85%', desc: 'Basic, Gold, Platinum tiers with increasing access and benefits' },
          { stream: 'Provider Platform Fees', price: '$99 - $499/mo', margin: '90%', desc: 'SaaS fees for providers to practice on the platform' },
          { stream: 'Consultation Fees', price: '$49 - $129/visit', margin: '30-40%', desc: 'Per-visit fees for non-subscribers, specialist consultations' },
          { stream: 'Credentialing Services', price: '$99 - $199', margin: '80%', desc: 'One-time provider application, verification, licensing' },
          { stream: 'Insurance Claims', price: 'Variable', margin: '15-25%', desc: 'Billing for insured visits, prior authorization, claims processing' },
          { stream: 'Enterprise / White-Label', price: '$2,000+/mo', margin: '70%', desc: 'Custom deployments for health systems and employers' }
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
        <p className="text-emerald-400 font-semibold">Blended Gross Margin Target: 70%+ | LTV/CAC Ratio Target: 5:1+</p>
      </div>
    </div>
  );

  if (slide === 'traction') return (
    <div className="space-y-8">
      <SectionHeader icon={Rocket} title="Traction" subtitle="Built and shipping &mdash; platform live, team growing" color="amber" pdfMode={pdfMode} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <TractionCard label="Platform" value="Live" sub="Full-stack deployed" />
        <TractionCard label="AI Tools" value="OpenClaw" sub="AI ops assistant live" />
        <TractionCard label="Features" value="50+" sub="Shipping weekly" />
        <TractionCard label="Compliance" value="HIPAA" sub="SOC 2 in progress" />
      </div>
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
        <h4 className="text-sm font-semibold text-gray-300 mb-4">Technical Milestones</h4>
        <div className="space-y-3">
          {[
            'Full telehealth platform with video, chat, scheduling',
            'E-prescribing integration',
            'AI-assisted triage and predictive analytics engine',
            'FHIR-native health data interoperability',
            'Stripe payment processing and subscription billing',
            'OpenClaw AI platform for intelligent workflow automation',
            'CRM with automated outreach and lead management',
            'Corporate financial system with real-time accounting',
            'Provider credentialing pipeline',
            'Insurance eligibility and claims processing',
          ].map((m, i) => (
            <div key={i} className="flex items-center gap-3">
              {pdfMode ? <PdfIcon size={16} color="#34d399" shape="circle" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
              <span className="text-sm text-gray-300">{m}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (slide === 'financials') return (
    <div className="space-y-8">
      <SectionHeader icon={LineChart} title="Financial Projections" subtitle="Conservative base case &mdash; 5-year outlook" color="emerald" pdfMode={pdfMode} />
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
        <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30"><p className="text-xs text-gray-500">Break-Even</p><p className="text-2xl font-bold text-emerald-400">Month 18</p></div>
        <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30"><p className="text-xs text-gray-500">Year 5 ARR</p><p className="text-2xl font-bold text-emerald-400">$120M</p></div>
        <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30"><p className="text-xs text-gray-500">Year 5 Valuation (10x ARR)</p><p className="text-2xl font-bold text-purple-400">$1.2B</p></div>
      </div>
      {financials && (
        <div className="bg-gradient-to-r from-emerald-900/20 to-blue-900/20 rounded-xl border border-emerald-700/20 p-5">
          <h4 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
            {pdfMode ? <PdfIcon size={16} color="#fbbf24" /> : <Zap className="w-4 h-4" />} Live Financial Data (Real-Time)
          </h4>
          <div className="grid grid-cols-4 gap-4">
            <div><p className="text-xs text-gray-500">Cash on Hand</p><p className="text-lg font-bold text-white">{fmt(financials.cash?.total)}</p></div>
            <div><p className="text-xs text-gray-500">MTD Revenue</p><p className="text-lg font-bold text-emerald-400">{fmt(financials.monthly?.revenue)}</p></div>
            <div><p className="text-xs text-gray-500">Stripe Processed</p><p className="text-lg font-bold text-purple-400">{fmt(financials.stripe?.total_processed)}</p></div>
            <div><p className="text-xs text-gray-500">Runway</p><p className="text-lg font-bold text-amber-400">{financials.monthly?.runway_months || 'N/A'} months</p></div>
          </div>
        </div>
      )}
    </div>
  );

  if (slide === 'competition') return (
    <div className="space-y-8">
      <SectionHeader icon={Target} title="Competitive Landscape" subtitle="We win on AI-assisted clinical depth, provider experience, and price" color="purple" pdfMode={pdfMode} />
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
              { feature: 'AI-Assisted Triage', us: true, t: false, a: false, m: false },
              { feature: 'AI Clinical Notes (SOAP)', us: true, t: false, a: false, m: false },
              { feature: 'Predictive Analytics', us: true, t: true, a: false, m: false },
              { feature: 'E-Prescribing', us: true, t: true, a: true, m: true },
              { feature: 'FHIR Interoperability', us: true, t: true, a: true, m: false },
              { feature: 'Sub-$20/mo Plan', us: true, t: false, a: false, m: false },
              { feature: 'AI Workflow Automation (OpenClaw)', us: true, t: false, a: false, m: false },
              { feature: 'Provider CRM + Outreach', us: true, t: false, a: false, m: false },
              { feature: 'Insurance Wallet (OCR)', us: true, t: false, a: true, m: false },
              { feature: 'Real-Time Financial Reporting', us: true, t: false, a: false, m: false },
            ].map((row, i) => (
              <tr key={i} className="border-b border-gray-800/30">
                <td className="py-2 text-gray-400">{row.feature}</td>
                <td className="py-2 text-center">{row.us ? (pdfMode ? <PdfIcon size={16} color="#34d399" shape="circle" style={{ margin: '0 auto' }} /> : <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />) : <span className="text-gray-600">&mdash;</span>}</td>
                <td className="py-2 text-center">{row.t ? (pdfMode ? <PdfIcon size={16} color="#6b7280" shape="circle" style={{ margin: '0 auto' }} /> : <CheckCircle2 className="w-4 h-4 text-gray-500 inline" />) : <span className="text-gray-600">&mdash;</span>}</td>
                <td className="py-2 text-center">{row.a ? (pdfMode ? <PdfIcon size={16} color="#6b7280" shape="circle" style={{ margin: '0 auto' }} /> : <CheckCircle2 className="w-4 h-4 text-gray-500 inline" />) : <span className="text-gray-600">&mdash;</span>}</td>
                <td className="py-2 text-center">{row.m ? (pdfMode ? <PdfIcon size={16} color="#6b7280" shape="circle" style={{ margin: '0 auto' }} /> : <CheckCircle2 className="w-4 h-4 text-gray-500 inline" />) : <span className="text-gray-600">&mdash;</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-purple-900/10 border border-purple-700/30 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-purple-400 mb-2">Our Moat</h4>
        <div className="grid grid-cols-2 gap-3 text-sm text-gray-400">
          {[
            'AI-enhanced clinical tools native to the platform',
            'OpenClaw AI platform powering operations, content, and analytics',
            'Data flywheel: more patients lead to smarter AI and better care',
            'AI-amplified team delivers 10x productivity over competitors'
          ].map((moatItem, i) => (
            <div key={i} className="flex items-start gap-2">
              {pdfMode ? <PdfIcon size={16} color="#c084fc" style={{ marginTop: '2px' }} /> : <Shield className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />} {moatItem}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (slide === 'team') return (
    <div className="space-y-8">
      <SectionHeader icon={Users} title="Team" subtitle="Experienced operators building the future of healthcare" color="blue" pdfMode={pdfMode} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <TeamCard name="Founder and CEO" role="Vision, Product, Architecture" highlights={['Full-stack engineer and product leader', 'Healthcare domain expertise', 'Built entire platform from ground up', 'AI and ML systems integration']} pdfMode={pdfMode} />
        <TeamCard name="Key Hires (In Progress)" role="Building the Core Team" highlights={['Chief Medical Officer for clinical oversight', 'VP Engineering for platform scaling', 'Head of Growth for acquisition', 'Compliance Officer for HIPAA and SOC 2']} pdfMode={pdfMode} />
        <TeamCard name="OpenClaw AI Platform" role="AI-Powered Operations Layer" highlights={['Automates CRM outreach and lead gen', 'AI-assisted content and social media', 'Financial reporting and analytics', 'Clinical workflow support tools']} pdfMode={pdfMode} />
      </div>
      <div className="bg-blue-900/10 border border-blue-700/30 rounded-xl p-5 text-center">
        <p className="text-blue-400 text-sm">Human leadership, AI-amplified execution. OpenClaw handles repetitive operations so the team can focus on patients, providers, and growth.</p>
      </div>
    </div>
  );

  if (slide === 'go_to_market') {
    const phaseColorMap = {
      amber: { heading: 'text-amber-400', arrow: 'text-amber-500', hex: '#f59e0b' },
      blue: { heading: 'text-blue-400', arrow: 'text-blue-500', hex: '#3b82f6' },
      emerald: { heading: 'text-emerald-400', arrow: 'text-emerald-500', hex: '#10b981' },
    };
    return (
      <div className="space-y-8">
        <SectionHeader icon={Rocket} title="Go-to-Market Strategy" subtitle="Three-phase launch: crawl, walk, run" color="orange" pdfMode={pdfMode} />
        <div className="space-y-4">
          {[
            { phase: 'Phase 1: Crawl (Months 1-6)', color: 'amber', items: ['Onboard first 25 providers (partner hospitals, clinics)', 'Organic patient acquisition via SEO and content marketing', 'CRM-powered outreach with AI-assisted lead generation', 'Social media presence and healthcare thought leadership', 'First 500 patients via free consultation offers'] },
            { phase: 'Phase 2: Walk (Months 7-18)', color: 'blue', items: ['Scale to 100 providers across 10 states', 'Launch referral program (provider + patient)', 'Insurance payer partnerships', 'Employer wellness program partnerships', 'Content marketing and patient education hub'] },
            { phase: 'Phase 3: Run (Months 19-36)', color: 'emerald', items: ['Nationwide expansion to 50 states', 'Enterprise and white-label deals', 'International expansion planning', 'Health app marketplace and API partnerships', 'IPO readiness preparation'] }
          ].map((p, i) => {
            const colors = phaseColorMap[p.color] || { heading: 'text-gray-400', arrow: 'text-gray-500', hex: '#9ca3af' };
            return (
              <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
                <h4 className={`text-base font-semibold ${colors.heading} mb-2`}>{p.phase}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {p.items.map((item, j) => (
                    <div key={j} className="flex items-center gap-2 text-sm text-gray-400">
                      {pdfMode ? <PdfIcon size={12} color={colors.hex} /> : <ArrowRight className={`w-3 h-3 ${colors.arrow} flex-shrink-0`} />} {item}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (slide === 'the_ask') return (
    <div className="space-y-8">
      <SectionHeader icon={Target} title="The Ask" subtitle="Seed Round &mdash; Building the future of healthcare" color="purple" pdfMode={pdfMode} />
      <div className="text-center mb-8">
        {pdfMode ? (
          <p style={{ fontSize: '56px', fontWeight: 900, color: '#22d3ee', lineHeight: 1.1, margin: 0 }}>$1,000,000</p>
        ) : (
          <p className={`text-6xl font-black ${gradientTextAlt}`}>$1,000,000</p>
        )}
        <p className="text-xl text-gray-400 mt-2">Seed Round | Pre-Money Valuation: $5M</p>
      </div>
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
        <h4 className="text-sm font-semibold text-gray-300 mb-4">Use of Funds</h4>
        <div className="space-y-3">
          {[
            { label: 'Engineering and Product', pct: 40, amount: '$400K', desc: 'Full-time engineers, infrastructure scaling, OpenClaw AI development' },
            { label: 'Sales and Marketing', pct: 25, amount: '$250K', desc: 'Provider acquisition, patient growth, brand building' },
            { label: 'Compliance and Legal', pct: 15, amount: '$150K', desc: 'SOC 2, state licensing, legal counsel' },
            { label: 'Operations and Team', pct: 10, amount: '$100K', desc: 'Key hires, cloud hosting, APIs, office' },
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
        <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30"><p className="text-xs text-gray-500">18-Month Runway</p><p className="text-lg font-bold text-emerald-400">Guaranteed</p></div>
        <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30"><p className="text-xs text-gray-500">Target ARR at Month 18</p><p className="text-lg font-bold text-emerald-400">$1.8M</p></div>
        <div className="bg-gray-800/40 rounded-lg p-4 text-center border border-gray-700/30"><p className="text-xs text-gray-500">Series A Ready</p><p className="text-lg font-bold text-purple-400">Month 18-24</p></div>
      </div>
    </div>
  );

  if (slide === 'appendix') return (
    <div className="space-y-8">
      <SectionHeader icon={FileText} title="Appendix" subtitle="Additional details available upon request" color="gray" pdfMode={pdfMode} />
      <div className="grid grid-cols-2 gap-4">
        {[
          'Detailed financial model (3-statement)', 'Technical architecture documentation',
          'HIPAA compliance audit report', 'Provider onboarding playbook',
          'OpenClaw AI platform whitepaper', 'Insurance payer integration roadmap',
          'Market research and competitive analysis', 'Cap table and equity structure'
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 bg-gray-800/40 rounded-lg p-4 border border-gray-700/30">
            {pdfMode ? <PdfIcon size={16} color="#6b7280" /> : <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />}
            <span className="text-sm text-gray-400">{item}</span>
          </div>
        ))}
      </div>
      <div className="text-center mt-8 space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-600 via-blue-600 to-cyan-500 flex items-center justify-center">
          {pdfMode ? <PdfIcon size={32} color="#ffffff" shape="circle" /> : <Stethoscope className="w-8 h-8 text-white" />}
        </div>
        {pdfMode ? (
          <h3 style={{ fontSize: '24px', fontWeight: 'bold', color: '#22d3ee', margin: 0 }}>DoctaRx</h3>
        ) : (
          <h3 className={`text-2xl font-bold ${gradientTextAlt}`}>DoctaRx</h3>
        )}
        <p className="text-gray-500">Healthcare, Reimagined.</p>
        <p className="text-sm text-gray-600">info@doctarx.com | doctarx.com</p>
      </div>
    </div>
  );

  return null;
}

// ═══ MAIN PAGE ═══
export default function PitchDeckPage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [financials, setFinancials] = useState(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    async function loadFinancials() {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
        const res = await fetch(`${API_URL}/financial/dashboard`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const data = await res.json();
        if (data.success) setFinancials(data.data);
      } catch {}
    }
    loadFinancials();
  }, []);

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

  // ═══ TRUE PDF DOWNLOAD — no print dialog ═══
  // Renders slides on-screen (behind loading overlay) so html2canvas gets proper styles.
  // All SVG icons are replaced with PdfIcon in pdfMode for reliable html2canvas rendering.
  const handleDownloadPDF = useCallback(async () => {
    setIsGenerating(true);

    // Brief delay to let React render the loading overlay + visible PDF container
    await new Promise(r => setTimeout(r, 400));

    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas')
      ]);

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });

      for (let i = 0; i < SLIDES.length; i++) {
        const slideEl = document.getElementById(`pdf-slide-${i}`);
        if (!slideEl) continue;

        const canvas = await html2canvas(slideEl, {
          scale: 2,
          backgroundColor: '#030712',
          useCORS: true,
          logging: false,
          width: 1280,
          height: 720,
          scrollX: 0,
          scrollY: 0,
          windowWidth: 1280,
          windowHeight: 720,
        });

        if (i > 0) pdf.addPage([1280, 720], 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 1280, 720);
      }

      pdf.save(`DoctaRx-Pitch-Deck-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      window.print();
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const slide = SLIDES[currentSlide];

  return (
    <div className={`min-h-screen bg-gray-950 text-white ${isPresenting ? 'fixed inset-0 z-50' : ''}`}>
      {/* Top Controls */}
      {!isPresenting && (
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-purple-400" />
              Investor Pitch Deck
            </h1>
            <p className="text-xs text-gray-500">Confidential &mdash; For qualified investors only</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{currentSlide + 1} / {SLIDES.length}</span>
            <button
              onClick={handleDownloadPDF}
              disabled={isGenerating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-wait rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isGenerating ? 'Generating PDF...' : 'Download PDF'}
            </button>
            <button onClick={() => setIsPresenting(true)} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition-colors">
              Present Mode
            </button>
          </div>
        </div>
      )}

      {/* Slide Navigation */}
      <div className="flex">
        {!isPresenting && (
          <div className="w-48 border-r border-gray-800 p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-80px)]">
            {SLIDES.map((s, i) => (
              <button key={s} onClick={() => setCurrentSlide(i)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                  currentSlide === i ? 'bg-purple-600/20 text-purple-300 border border-purple-600/40' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
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
          <button onClick={prevSlide} disabled={currentSlide === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-gray-800/50 hover:bg-gray-700/50 disabled:opacity-20 z-10">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={nextSlide} disabled={currentSlide === SLIDES.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-gray-800/50 hover:bg-gray-700/50 disabled:opacity-20 z-10">
            <ChevronRight className="w-5 h-5" />
          </button>
          {isPresenting && (
            <button onClick={() => setIsPresenting(false)} className="absolute top-4 right-4 px-3 py-1 rounded bg-gray-800/80 text-xs text-gray-400 hover:text-white z-20">ESC</button>
          )}
          <div className="w-full max-w-5xl mx-auto px-8 py-12">
            <SlideContent slide={slide} financials={financials} />
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="fixed bottom-0 left-0 right-0 h-1 bg-gray-800">
        <div className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all duration-300" style={{ width: `${((currentSlide + 1) / SLIDES.length) * 100}%` }} />
      </div>

      {/* ═══ LOADING OVERLAY — covers screen while PDF renders behind it ═══ */}
      {isGenerating && (
        <div className="fixed inset-0 z-[9998] bg-gray-950/95 flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 text-purple-400 animate-spin mb-4" />
          <p className="text-lg font-semibold text-white">Generating PDF...</p>
          <p className="text-sm text-gray-500 mt-1">Rendering all 13 slides</p>
        </div>
      )}

      {/* ═══ PDF RENDER — on-screen during generation (behind overlay), hidden otherwise ═══ */}
      <div
        style={{
          position: 'fixed',
          left: isGenerating ? '0' : '-20000px',
          top: isGenerating ? '0' : '-20000px',
          width: '1280px',
          zIndex: isGenerating ? 9997 : -1,
          opacity: isGenerating ? 1 : 0,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {SLIDES.map((s, i) => (
          <div
            key={s}
            id={`pdf-slide-${i}`}
            style={{
              width: '1280px',
              height: '720px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#030712',
              color: 'white',
              overflow: 'hidden',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '16px',
              lineHeight: '1.5',
            }}
          >
            <div style={{ width: '100%', maxWidth: '1024px', margin: '0 auto', padding: '48px' }}>
              <SlideContent slide={s} financials={financials} pdfMode />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ Reusable Components ═══

function SectionHeader({ icon: Icon, title, subtitle, color, pdfMode }) {
  const colors = { red: 'text-red-400', emerald: 'text-emerald-400', blue: 'text-blue-400', cyan: 'text-cyan-400', purple: 'text-purple-400', amber: 'text-amber-400', orange: 'text-orange-400', gray: 'text-gray-400' };
  const hexColors = { red: '#f87171', emerald: '#34d399', blue: '#60a5fa', cyan: '#22d3ee', purple: '#c084fc', amber: '#fbbf24', orange: '#fb923c', gray: '#9ca3af' };

  if (pdfMode) {
    return (
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
          <span style={{ display: 'inline-block', width: '24px', height: '24px', minWidth: '24px', borderRadius: '6px', backgroundColor: hexColors[color] || '#9ca3af' }} />
          <h2 style={{ fontSize: '26px', fontWeight: 'bold', color: '#ffffff', margin: 0, lineHeight: '1.3' }}>{title}</h2>
        </div>
        <p style={{ color: '#6b7280', fontSize: '15px', margin: 0, lineHeight: '1.4' }}>{subtitle}</p>
      </div>
    );
  }

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

function MarketCircle({ label, amount, desc, color, pdfMode }) {
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

function TeamCard({ name, role, highlights, pdfMode }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 mx-auto mb-4 flex items-center justify-center">
        {pdfMode ? <PdfIcon size={32} color="#ffffff" shape="circle" /> : <Users className="w-8 h-8 text-white" />}
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
