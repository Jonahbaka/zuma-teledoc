'use client';

import { useRef, useState, useCallback } from 'react';

export default function PitchDeckPage() {
  const containerRef = useRef(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleNextSlide = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
    }
  };

  // ═══ TEXT-BASED PDF — native jsPDF drawing, not html2canvas screenshots ═══
  const handleDownloadPDF = useCallback(async () => {
    setIsGenerating(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });

      // Color palette
      const BG = [5, 7, 10];
      const W = [255, 255, 255];
      const S3 = [203, 213, 225]; // slate-300
      const S4 = [148, 163, 184]; // slate-400
      const S5 = [100, 116, 139]; // slate-500
      const S6 = [71, 85, 105];
      const S7 = [51, 65, 85];
      const S8 = [30, 41, 59];
      const B4 = [96, 165, 250];  // blue-400
      const B5 = [59, 130, 246];
      const B6 = [37, 99, 235];
      const B9 = [30, 58, 138];
      const P5 = [168, 85, 247];  // purple-500
      const E4 = [52, 211, 153];  // emerald-400
      const E5 = [16, 185, 129];
      const O5 = [249, 115, 22];  // orange-500
      const R4 = [248, 113, 113]; // red-400
      const R5 = [239, 68, 68];

      // Helpers
      const bg = () => { pdf.setFillColor(...BG); pdf.rect(0, 0, 1280, 720, 'F'); };
      const tc = (c) => pdf.setTextColor(...c);
      const fc = (c) => pdf.setFillColor(...c);
      const dc = (c) => pdf.setDrawColor(...c);
      const ft = (s, sz) => { pdf.setFontSize(sz); pdf.setFont('helvetica', s); };
      const wrap = (t, w) => pdf.splitTextToSize(t, w);
      const box = (x, y, w, h, bl) => {
        fc([15, 23, 42]); pdf.roundedRect(x, y, w, h, 10, 10, 'F');
        dc(S7); pdf.roundedRect(x, y, w, h, 10, 10, 'S');
        if (bl) { fc(bl); pdf.rect(x, y + 6, 4, h - 12, 'F'); }
      };
      const glass = (x, y, w, h) => {
        fc(S8); pdf.roundedRect(x, y, w, h, 10, 10, 'F');
        dc(S7); pdf.roundedRect(x, y, w, h, 10, 10, 'S');
      };
      const label = (t, c, y) => { ft('bold', 11); tc(c); pdf.text(t.toUpperCase(), 64, y || 60); };
      const title = (t, y, mw) => {
        ft('bold', 42); tc(W);
        const ln = wrap(t, mw || 900);
        pdf.text(ln, 64, y || 100);
        return (y || 100) + ln.length * 50;
      };
      const newSlide = () => pdf.addPage([1280, 720], 'landscape');

      // ────────── SLIDE 1: TITLE ──────────
      bg();
      fc(B6); pdf.roundedRect(590, 130, 100, 100, 20, 20, 'F');
      fc(W); pdf.circle(640, 180, 28, 'F');
      ft('bold', 64); tc(W); pdf.text('DoctaRx', 640, 300, { align: 'center' });
      ft('normal', 22); tc(B4); pdf.text('Doctor-Led Telehealth, Supercharged by AI', 640, 345, { align: 'center' });
      ft('normal', 16); tc(S4); pdf.text('Making Healthcare Accessible, Affordable, and Intelligent', 640, 385, { align: 'center' });
      ft('bold', 11); tc(S5); pdf.text('DOCTOR-LED    \u2022    HIPAA COMPLIANT    \u2022    AI-ENHANCED', 640, 430, { align: 'center' });
      glass(480, 480, 320, 65);
      ft('normal', 9); tc(S5); pdf.text('FOUNDER', 525, 503); pdf.text('ROUND', 700, 503);
      ft('normal', 13); tc(W); pdf.text('Jonah Baka', 525, 525); pdf.text('Seed - Feb 2026', 700, 525);
      dc(S7); pdf.line(665, 492, 665, 535);

      // ────────── SLIDE 2: THE PROBLEM ──────────
      newSlide(); bg();
      label('The Problem', B5);
      const y2 = title('Healthcare is broken\u2014and 83 Million Americans know it.', 100);
      const cY2 = y2 + 15;
      const stats = [
        { n: '83M', d: 'Americans lack adequate healthcare access, primarily in rural and underserved areas.' },
        { n: '$4.5T', d: 'US Annual Spending. Yet outcomes rank 37th globally due to massive systemic inefficiency.' },
        { n: '24 Days', d: 'Average wait time for a new patient appointment. Urgent needs often go unmet for weeks.' },
      ];
      stats.forEach((s, i) => {
        const cx = 64 + i * 384;
        box(cx, cY2, 368, 140);
        ft('bold', 32); tc(W); pdf.text(s.n, cx + 24, cY2 + 40);
        ft('normal', 12); tc(S4); pdf.text(wrap(s.d, 320), cx + 24, cY2 + 68);
      });
      const pY = cY2 + 170;
      const pains = ['Provider burnout & administrative overload', 'No price transparency or upfront costs', 'Fragmented medical records & EMR silos', 'Insurance complexity & billing denials'];
      pains.forEach((p, i) => {
        const px = i < 2 ? 64 : 640; const py = pY + (i % 2) * 30;
        ft('bold', 14); tc(R5); pdf.text('\u2715', px, py);
        ft('normal', 13); tc(S3); pdf.text(p, px + 22, py);
      });

      // ────────── SLIDE 3: OUR SOLUTION ──────────
      newSlide(); bg();
      label('Our Solution', P5);
      title('Doctor-first telehealth, enhanced by AI built for scale.', 100);
      const sols = [
        { t: 'Instant Access', d: 'See a board-certified doctor in minutes, not weeks. Licensed providers available via video/chat with AI-assisted triage.' },
        { t: 'AI-Assisted Workflows', d: 'Automated SOAP note drafting, smart triage routing, and predictive health insights. Doctors make every final decision.' },
        { t: 'Transparent Pricing', d: 'Subscriptions from $19.99/mo. No surprise bills. Real-time insurance eligibility checks at the point of care.' },
        { t: 'FHIR-Native Security', d: 'End-to-end encryption, SOC 2 compliant, and seamless interoperability with existing health systems.' },
      ];
      sols.forEach((s, i) => {
        const sx = 64 + (i % 2) * 590; const sy = 200 + Math.floor(i / 2) * 190;
        glass(sx, sy, 570, 170);
        ft('bold', 18); tc(W); pdf.text(s.t, sx + 24, sy + 35);
        ft('normal', 13); tc(S4); pdf.text(wrap(s.d, 520), sx + 24, sy + 60);
      });

      // ────────── SLIDE 4: THE PRODUCT ──────────
      newSlide(); bg();
      label('The Product', E5);
      title('A Full-Stack Clinical Platform', 100);
      const prods = [
        { n: 'Video Consultations', d: 'HD video with AI clinical scribing', c: B5 },
        { n: 'E-Prescribing', d: 'Direct-to-pharmacy integration', c: B5 },
        { n: 'AI-Powered Triage', d: 'Smart symptom & acuity routing', c: B5 },
        { n: 'Insurance Wallet', d: 'OCR card scanning & eligibility', c: P5 },
        { n: 'Clinical Records', d: 'FHIR-native internal EHR', c: P5 },
        { n: 'Provider Dashboard', d: 'Unified revenue & schedule mgmt', c: P5 },
        { n: 'Predictive Analytics', d: 'ML insights for patient outcomes', c: E5 },
        { n: 'Payment Processing', d: 'Stripe billing & automated claims', c: E5 },
        { n: 'OpenClaw AI', d: 'Core AI Ops automation layer', c: E5 },
      ];
      prods.forEach((p, i) => {
        const px = 64 + (i % 3) * 390; const py = 170 + Math.floor(i / 3) * 100;
        box(px, py, 370, 80, p.c);
        ft('bold', 14); tc(i === 8 ? B4 : W); pdf.text(p.n, px + 20, py + 30);
        ft('normal', 11); tc(S4); pdf.text(p.d, px + 20, py + 52);
      });

      // ────────── SLIDE 5: MARKET OPPORTUNITY ──────────
      newSlide(); bg();
      label('Market Opportunity', O5);
      title('Telehealth is Inevitable.', 100);
      // Bars
      const bB = 530; const bW = 160; const bG = 30; const bX = 64;
      fc(S8); pdf.roundedRect(bX, bB - 280, bW, 280, 8, 8, 'F');
      ft('normal', 10); tc(S5); pdf.text('TAM', bX + 16, bB - 248);
      ft('bold', 22); tc(W); pdf.text('$460B', bX + 16, bB - 218);
      ft('normal', 9); tc(S4); pdf.text('US Healthcare Svc', bX + 16, bB - 198);

      fc(B9); pdf.roundedRect(bX + bW + bG, bB - 210, bW, 210, 8, 8, 'F');
      ft('normal', 10); tc([147, 197, 253]); pdf.text('SAM', bX + bW + bG + 16, bB - 178);
      ft('bold', 22); tc(W); pdf.text('$83B', bX + bW + bG + 16, bB - 148);
      ft('normal', 9); tc(B4); pdf.text('Telehealth 2030', bX + bW + bG + 16, bB - 128);

      fc(B6); pdf.roundedRect(bX + 2 * (bW + bG), bB - 100, bW, 100, 8, 8, 'F');
      ft('normal', 10); tc(W); pdf.text('SOM', bX + 2 * (bW + bG) + 16, bB - 73);
      ft('bold', 22); tc(W); pdf.text('$830M', bX + 2 * (bW + bG) + 16, bB - 43);
      ft('normal', 9); tc(W); pdf.text('1% Capture Plan', bX + 2 * (bW + bG) + 16, bB - 23);

      const tws = [
        { h: '\u2191 48.1% CAGR', t: ' - AI in Healthcare growth (2024-2030)', c: E5 },
        { h: '124K deficit', t: ' - Projected physician shortage by 2034', c: B4 },
        { h: 'CMS Expanded', t: ' - Permanent reimbursement for virtual visits', c: P5 },
      ];
      tws.forEach((tw, i) => {
        const ty = 200 + i * 80;
        glass(640, ty, 580, 60);
        ft('bold', 13); tc(tw.c); pdf.text(tw.h, 660, ty + 35);
        ft('normal', 13); tc(S3);
        pdf.text(tw.t, 660 + pdf.getTextWidth(tw.h), ty + 35);
      });

      // ────────── SLIDE 6: BUSINESS MODEL ──────────
      newSlide(); bg();
      label('Business Model', B5);
      title('High Margin, Recurring Revenue', 100);
      const revs = [
        { n: 'Patient Subs', m: '85% Margin', p: '$19.99 - $79.99', d: 'Monthly recurring revenue (B2C)', mc: E5 },
        { n: 'Provider Platform', m: '90% Margin', p: '$99 - $499', d: 'SaaS fees for practitioners', mc: E5 },
        { n: 'Consultation Fees', m: '35% Margin', p: '$49 - $129', d: 'Per-visit fees for non-subs', mc: B5 },
      ];
      revs.forEach((r, i) => {
        const rx = 64 + i * 390;
        box(rx, 170, 370, 150);
        ft('bold', 14); tc(W); pdf.text(r.n, rx + 20, 200);
        ft('bold', 9); tc(r.mc); pdf.text(r.m, rx + 250, 200);
        ft('bold', 22); tc(W); pdf.text(r.p, rx + 20, 240);
        ft('normal', 11); tc(S5); pdf.text(r.d, rx + 20, 265);
      });
      // Enterprise card
      box(64, 340, 370, 150);
      ft('bold', 14); tc(W); pdf.text('Enterprise', 84, 370);
      ft('bold', 9); tc(P5); pdf.text('75% Margin', 314, 370);
      ft('bold', 22); tc(W); pdf.text('$2,000+', 84, 410);
      ft('normal', 11); tc(S5); pdf.text('White-label & employer deals', 84, 435);
      // LTV/CAC summary
      box(454 + 30, 340, 730, 150);
      ft('normal', 11); tc(S4); pdf.text('Target LTV/CAC', 560, 390);
      ft('bold', 24); tc(W); pdf.text('5 : 1', 560, 425);
      dc(S7); pdf.line(730, 360, 730, 470);
      ft('normal', 11); tc(S4); pdf.text('Blended Gross Margin', 790, 390);
      ft('bold', 24); tc(W); pdf.text('70%+', 790, 425);

      // ────────── SLIDE 7: FINANCIAL PROJECTIONS ──────────
      newSlide(); bg();
      label('Financial Projections', E5);
      title('Path to $120M ARR', 100);
      const tX = 64; const tY = 160; const tW2 = 1152; const cW = tW2 / 6; const rH = 40;
      // Header
      fc(S8); pdf.roundedRect(tX, tY, tW2, rH, 8, 8, 'F');
      ft('bold', 12); tc(S4);
      ['Metric', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'].forEach((h, i) => pdf.text(h, tX + i * cW + 20, tY + 26));
      // Rows
      const tRows = [
        { l: 'Patients', v: ['500', '5,000', '25,000', '75,000', '200,000'] },
        { l: 'Providers', v: ['25', '100', '400', '1,200', '3,000'] },
        { l: 'Revenue', v: ['$120K', '$1.8M', '$12M', '$45M', '$120M'], hi: true },
        { l: 'Gross Margin', v: ['65%', '70%', '75%', '78%', '80%'] },
        { l: 'Net Income', v: ['($360K)', '($600K)', '$3M', '$18M', '$60M'], cm: [R4, R4, E4, E4, E4] },
      ];
      tRows.forEach((r, ri) => {
        const rY = tY + rH + ri * rH;
        dc(S8); pdf.line(tX, rY + rH, tX + tW2, rY + rH);
        ft(r.hi ? 'bold' : 'normal', 12); tc(r.hi ? B4 : W); pdf.text(r.l, tX + 20, rY + 26);
        r.v.forEach((v, vi) => { tc(r.cm ? r.cm[vi] : (r.hi ? B4 : S3)); pdf.text(v, tX + (vi + 1) * cW + 20, rY + 26); });
      });
      // Summary
      const sY = tY + rH + tRows.length * rH + 30;
      [{ l: 'BREAK-EVEN', v: 'Month 18' }, { l: 'YEAR 5 ARR', v: '$120M' }, { l: 'EST. VALUATION (10X)', v: '$1.2B' }].forEach((s, i) => {
        const sx = 64 + i * 390;
        glass(sx, sY, 370, 70);
        ft('normal', 10); tc(S5); pdf.text(s.l, sx + 185, sY + 25, { align: 'center' });
        ft('bold', 18); tc(W); pdf.text(s.v, sx + 185, sY + 52, { align: 'center' });
      });

      // ────────── SLIDE 8: THE TEAM ──────────
      newSlide(); bg();
      label('The Team', P5);
      title('Human Leadership, AI-Amplified Execution', 100);
      // Founder
      fc(S8); pdf.roundedRect(64, 190, 90, 90, 16, 16, 'F');
      ft('bold', 28); tc(S4); pdf.text('JB', 86, 245);
      ft('bold', 22); tc(W); pdf.text('Jonah Baka', 180, 220);
      ft('bold', 10); tc(B4); pdf.text('FOUNDER & CEO', 180, 240);
      ft('normal', 12); tc(S4);
      pdf.text(wrap('Full-stack engineer and product leader with deep expertise in Healthcare Architecture. Built the entire DoctaRx platform from the ground up, integrating proprietary AI triage and OpenClaw automation layers.', 400), 180, 268);
      // Key Hires
      glass(640, 190, 580, 230);
      ft('bold', 16); tc(W); pdf.text('Key Hires in Progress', 670, 225);
      ['Chief Medical Officer (Clinical Oversight)', 'VP Engineering (Platform Scaling)', 'Compliance Officer (HIPAA/SOC 2)', 'Head of Growth'].forEach((h, i) => {
        const hy = 265 + i * 35;
        fc(B5); pdf.circle(685, hy - 4, 4, 'F');
        ft('normal', 13); tc(S3); pdf.text(h, 700, hy);
      });

      // ────────── SLIDE 9: THE ASK ──────────
      newSlide(); bg();
      ft('bold', 11); tc(B5); pdf.text('THE ASK', 640, 100, { align: 'center' });
      ft('bold', 64); tc(W); pdf.text('$2,500,000', 640, 200, { align: 'center' });
      ft('normal', 22); tc(S4); pdf.text('Seed Round | $10M Pre-Money Valuation', 640, 250, { align: 'center' });
      const funds = [
        { p: '40%', l: 'ENG & PRODUCT', d: 'Core engineering & OpenClaw AI dev' },
        { p: '25%', l: 'GROWTH', d: 'Provider & patient acquisition' },
        { p: '15%', l: 'COMPLIANCE', d: 'SOC 2, state licensing & legal' },
        { p: '20%', l: 'OPS & RESERVE', d: '18-month runway buffer' },
      ];
      funds.forEach((f, i) => {
        const fx = 200 + i * 230;
        box(fx, 300, 210, 140);
        ft('bold', 22); tc(W); pdf.text(f.p, fx + 20, 340);
        ft('bold', 9); tc(S5); pdf.text(f.l, fx + 20, 365);
        ft('normal', 11); tc(S4); pdf.text(wrap(f.d, 170), fx + 20, 390);
      });
      glass(420, 480, 180, 60);
      ft('normal', 9); tc(S5); pdf.text('TARGET RUNWAY', 440, 505);
      ft('bold', 14); tc(W); pdf.text('18 Months', 440, 525);
      glass(680, 480, 180, 60);
      ft('normal', 9); tc(S5); pdf.text('TARGET ARR (M18)', 700, 505);
      ft('bold', 14); tc(W); pdf.text('$1.8 Million', 700, 525);

      // ────────── SLIDE 10: CONTACT ──────────
      newSlide(); bg();
      fc(B6); pdf.roundedRect(600, 140, 80, 80, 16, 16, 'F');
      fc(W); pdf.circle(640, 180, 22, 'F');
      ft('bold', 42); tc(W); pdf.text("Let's Build the Future", 640, 290, { align: 'center' });
      ft('normal', 18); tc(S4); pdf.text('Healthcare, Reimagined.', 640, 325, { align: 'center' });
      ft('bold', 22); tc(W); pdf.text('jonah.baka@doctarx.com', 640, 400, { align: 'center' });
      ft('normal', 14); tc(S4); pdf.text('linkedin.com/in/jonah-baka', 640, 435, { align: 'center' });
      ft('normal', 14); tc(S5); pdf.text('doctarx.com', 640, 465, { align: 'center' });
      ft('normal', 9); tc(S6); pdf.text('CONFIDENTIAL \u00A9 2026 DOCTARX INC.', 640, 600, { align: 'center' });

      pdf.save(`DoctaRx-Pitch-Deck-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap');
        .pitch-deck {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background-color: #05070a;
          color: #e2e8f0;
          scroll-snap-type: y mandatory;
          overflow-y: scroll;
          height: 100vh;
        }
        .pitch-deck section {
          height: 100vh;
          scroll-snap-align: start;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 4rem;
          position: relative;
          border-bottom: 1px solid #1e293b;
        }
        .gradient-text {
          background: linear-gradient(90deg, #60a5fa, #a78bfa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .glass {
          background: rgba(30, 41, 59, 0.4);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .stat-card {
          padding: 1.5rem;
          border-radius: 1rem;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid #334155;
        }
        @media print {
          .pitch-deck section { height: auto; scroll-snap-align: none; page-break-after: always; }
          .pitch-deck { overflow: visible; height: auto; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="pitch-deck" ref={containerRef}>

        {/* SLIDE 1: TITLE */}
        <section className="items-center text-center">
          <div className="w-32 h-32 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-3xl mb-8 flex items-center justify-center shadow-2xl shadow-blue-500/20">
            <div className="w-16 h-16 bg-white rounded-full"></div>
          </div>
          <h1 className="text-7xl font-bold mb-4">DoctaRx</h1>
          <p className="text-2xl text-blue-400 font-light mb-8 max-w-2xl">Doctor-Led Telehealth, Supercharged by AI</p>
          <p className="text-lg text-slate-400 mb-12">Making Healthcare Accessible, Affordable, and Intelligent</p>
          <div className="flex gap-4 text-sm font-semibold tracking-widest uppercase text-slate-500">
            <span>Doctor-Led</span>
            <span>&bull;</span>
            <span>HIPAA Compliant</span>
            <span>&bull;</span>
            <span>AI-Enhanced</span>
          </div>
          <div className="mt-16 glass px-6 py-4 rounded-full flex gap-8 items-center">
            <div>
              <p className="text-xs text-slate-500 uppercase">Founder</p>
              <p className="text-sm">Jonah Baka</p>
            </div>
            <div className="w-px h-8 bg-slate-700"></div>
            <div>
              <p className="text-xs text-slate-500 uppercase">Round</p>
              <p className="text-sm">Seed - Feb 2026</p>
            </div>
          </div>
        </section>

        {/* SLIDE 2: THE PROBLEM */}
        <section>
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-blue-500 mb-4">The Problem</h2>
          <h3 className="text-5xl font-bold mb-12 max-w-4xl leading-tight">Healthcare is broken&mdash;and <span className="gradient-text">83 Million</span> Americans know it.</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="stat-card">
              <p className="text-4xl font-bold text-white mb-2">83M</p>
              <p className="text-slate-400">Americans lack adequate healthcare access, primarily in rural and underserved areas.</p>
            </div>
            <div className="stat-card">
              <p className="text-4xl font-bold text-white mb-2">$4.5T</p>
              <p className="text-slate-400">US Annual Spending. Yet outcomes rank 37th globally due to massive systemic inefficiency.</p>
            </div>
            <div className="stat-card">
              <p className="text-4xl font-bold text-white mb-2">24 Days</p>
              <p className="text-slate-400">Average wait time for a new patient appointment. Urgent needs often go unmet for weeks.</p>
            </div>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-4 text-slate-300">
            <div className="flex items-center gap-3">
              <span className="text-red-500">&times;</span> Provider burnout &amp; administrative overload
            </div>
            <div className="flex items-center gap-3">
              <span className="text-red-500">&times;</span> No price transparency or upfront costs
            </div>
            <div className="flex items-center gap-3">
              <span className="text-red-500">&times;</span> Fragmented medical records &amp; EMR silos
            </div>
            <div className="flex items-center gap-3">
              <span className="text-red-500">&times;</span> Insurance complexity &amp; billing denials
            </div>
          </div>
        </section>

        {/* SLIDE 3: THE SOLUTION */}
        <section>
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-purple-500 mb-4">Our Solution</h2>
          <h3 className="text-5xl font-bold mb-12 max-w-4xl">Doctor-first telehealth, enhanced by AI built for <span className="gradient-text">scale</span>.</h3>

          <div className="grid grid-cols-2 gap-8">
            <div className="glass p-8 rounded-2xl">
              <h4 className="text-xl font-bold mb-2 text-white">Instant Access</h4>
              <p className="text-slate-400 leading-relaxed">See a board-certified doctor in minutes, not weeks. Licensed providers available via video/chat with AI-assisted triage.</p>
            </div>
            <div className="glass p-8 rounded-2xl">
              <h4 className="text-xl font-bold mb-2 text-white">AI-Assisted Workflows</h4>
              <p className="text-slate-400 leading-relaxed">Automated SOAP note drafting, smart triage routing, and predictive health insights. Doctors make every final decision.</p>
            </div>
            <div className="glass p-8 rounded-2xl">
              <h4 className="text-xl font-bold mb-2 text-white">Transparent Pricing</h4>
              <p className="text-slate-400 leading-relaxed">Subscriptions from $19.99/mo. No surprise bills. Real-time insurance eligibility checks at the point of care.</p>
            </div>
            <div className="glass p-8 rounded-2xl">
              <h4 className="text-xl font-bold mb-2 text-white">FHIR-Native Security</h4>
              <p className="text-slate-400 leading-relaxed">End-to-end encryption, SOC 2 compliant, and seamless interoperability with existing health systems.</p>
            </div>
          </div>
        </section>

        {/* SLIDE 4: THE PRODUCT */}
        <section>
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-emerald-500 mb-4">The Product</h2>
          <h3 className="text-5xl font-bold mb-12">A Full-Stack Clinical Platform</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="stat-card border-l-4 border-l-blue-500">
              <h5 className="font-bold text-white">Video Consultations</h5>
              <p className="text-xs text-slate-400 mt-1">HD video with AI clinical scribing</p>
            </div>
            <div className="stat-card border-l-4 border-l-blue-500">
              <h5 className="font-bold text-white">E-Prescribing</h5>
              <p className="text-xs text-slate-400 mt-1">Direct-to-pharmacy integration</p>
            </div>
            <div className="stat-card border-l-4 border-l-blue-500">
              <h5 className="font-bold text-white">AI-Powered Triage</h5>
              <p className="text-xs text-slate-400 mt-1">Smart symptom &amp; acuity routing</p>
            </div>
            <div className="stat-card border-l-4 border-l-purple-500">
              <h5 className="font-bold text-white">Insurance Wallet</h5>
              <p className="text-xs text-slate-400 mt-1">OCR card scanning &amp; eligibility</p>
            </div>
            <div className="stat-card border-l-4 border-l-purple-500">
              <h5 className="font-bold text-white">Clinical Records</h5>
              <p className="text-xs text-slate-400 mt-1">FHIR-native internal EHR</p>
            </div>
            <div className="stat-card border-l-4 border-l-purple-500">
              <h5 className="font-bold text-white">Provider Dashboard</h5>
              <p className="text-xs text-slate-400 mt-1">Unified revenue &amp; schedule mgmt</p>
            </div>
            <div className="stat-card border-l-4 border-l-emerald-500">
              <h5 className="font-bold text-white">Predictive Analytics</h5>
              <p className="text-xs text-slate-400 mt-1">ML insights for patient outcomes</p>
            </div>
            <div className="stat-card border-l-4 border-l-emerald-500">
              <h5 className="font-bold text-white">Payment Processing</h5>
              <p className="text-xs text-slate-400 mt-1">Stripe billing &amp; automated claims</p>
            </div>
            <div className="stat-card border-l-4 border-l-emerald-500 bg-slate-800">
              <h5 className="font-bold text-blue-400">OpenClaw AI</h5>
              <p className="text-xs text-slate-400 mt-1">Core AI Ops automation layer</p>
            </div>
          </div>
        </section>

        {/* SLIDE 5: MARKET OPPORTUNITY */}
        <section>
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-orange-500 mb-4">Market Opportunity</h2>
          <h3 className="text-5xl font-bold mb-12">Telehealth is <span className="gradient-text">Inevitable</span>.</h3>

          <div className="flex gap-12 items-end">
            <div className="flex-1">
              <div className="relative h-64 flex items-end gap-4">
                <div className="flex-1 bg-slate-800 rounded-t-xl p-4 flex flex-col justify-end">
                  <p className="text-xs text-slate-500 uppercase">TAM</p>
                  <p className="text-2xl font-bold">$460B</p>
                  <p className="text-[10px] text-slate-400">US Healthcare Svc</p>
                </div>
                <div className="flex-1 bg-blue-900 rounded-t-xl p-4 flex flex-col justify-end h-3/4">
                  <p className="text-xs text-blue-300 uppercase">SAM</p>
                  <p className="text-2xl font-bold">$83B</p>
                  <p className="text-[10px] text-blue-400">Telehealth 2030</p>
                </div>
                <div className="flex-1 bg-gradient-to-t from-blue-600 to-purple-600 rounded-t-xl p-4 flex flex-col justify-end h-1/4">
                  <p className="text-xs text-white uppercase">SOM</p>
                  <p className="text-2xl font-bold">$830M</p>
                  <p className="text-[10px] text-white/70">1% Capture Plan</p>
                </div>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-1 gap-4">
              <div className="glass p-4 rounded-xl text-sm">
                <span className="text-emerald-500 font-bold">&uarr; 48.1% CAGR</span> - AI in Healthcare growth (2024-2030)
              </div>
              <div className="glass p-4 rounded-xl text-sm">
                <span className="text-blue-400 font-bold">124K deficit</span> - Projected physician shortage by 2034
              </div>
              <div className="glass p-4 rounded-xl text-sm">
                <span className="text-purple-400 font-bold">CMS Expanded</span> - Permanent reimbursement for virtual visits
              </div>
            </div>
          </div>
        </section>

        {/* SLIDE 6: BUSINESS MODEL */}
        <section>
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-blue-500 mb-4">Business Model</h2>
          <h3 className="text-5xl font-bold mb-12">High Margin, Recurring Revenue</h3>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <div className="stat-card">
              <div className="flex justify-between items-start mb-4">
                <h4 className="font-bold">Patient Subs</h4>
                <span className="bg-emerald-500/10 text-emerald-500 text-[10px] px-2 py-1 rounded">85% Margin</span>
              </div>
              <p className="text-2xl font-bold">$19.99 - $79.99</p>
              <p className="text-xs text-slate-500 mt-1">Monthly recurring revenue (B2C)</p>
            </div>
            <div className="stat-card">
              <div className="flex justify-between items-start mb-4">
                <h4 className="font-bold">Provider Platform</h4>
                <span className="bg-emerald-500/10 text-emerald-500 text-[10px] px-2 py-1 rounded">90% Margin</span>
              </div>
              <p className="text-2xl font-bold">$99 - $499</p>
              <p className="text-xs text-slate-500 mt-1">SaaS fees for practitioners</p>
            </div>
            <div className="stat-card">
              <div className="flex justify-between items-start mb-4">
                <h4 className="font-bold">Consultation Fees</h4>
                <span className="bg-blue-500/10 text-blue-500 text-[10px] px-2 py-1 rounded">35% Margin</span>
              </div>
              <p className="text-2xl font-bold">$49 - $129</p>
              <p className="text-xs text-slate-500 mt-1">Per-visit fees for non-subs</p>
            </div>
            <div className="stat-card">
              <div className="flex justify-between items-start mb-4">
                <h4 className="font-bold">Enterprise</h4>
                <span className="bg-purple-500/10 text-purple-500 text-[10px] px-2 py-1 rounded">75% Margin</span>
              </div>
              <p className="text-2xl font-bold">$2,000+</p>
              <p className="text-xs text-slate-500 mt-1">White-label &amp; employer deals</p>
            </div>
            <div className="stat-card col-span-2 flex items-center justify-around bg-blue-900/20 border-blue-500/30">
              <div className="text-center">
                <p className="text-xs text-slate-400">Target LTV/CAC</p>
                <p className="text-2xl font-bold">5 : 1</p>
              </div>
              <div className="w-px h-10 bg-slate-700"></div>
              <div className="text-center">
                <p className="text-xs text-slate-400">Blended Gross Margin</p>
                <p className="text-2xl font-bold">70%+</p>
              </div>
            </div>
          </div>
        </section>

        {/* SLIDE 7: FINANCIAL PROJECTIONS */}
        <section>
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-emerald-500 mb-4">Financial Projections</h2>
          <h3 className="text-5xl font-bold mb-8">Path to <span className="gradient-text">$120M ARR</span></h3>

          <div className="overflow-hidden rounded-xl glass">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="p-4">Metric</th>
                  <th className="p-4">Year 1</th>
                  <th className="p-4">Year 2</th>
                  <th className="p-4">Year 3</th>
                  <th className="p-4">Year 4</th>
                  <th className="p-4">Year 5</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                <tr>
                  <td className="p-4 font-semibold">Patients</td>
                  <td className="p-4">500</td>
                  <td className="p-4">5,000</td>
                  <td className="p-4">25,000</td>
                  <td className="p-4">75,000</td>
                  <td className="p-4">200,000</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold">Providers</td>
                  <td className="p-4">25</td>
                  <td className="p-4">100</td>
                  <td className="p-4">400</td>
                  <td className="p-4">1,200</td>
                  <td className="p-4">3,000</td>
                </tr>
                <tr className="bg-blue-500/5">
                  <td className="p-4 font-bold text-blue-400">Revenue</td>
                  <td className="p-4">$120K</td>
                  <td className="p-4">$1.8M</td>
                  <td className="p-4">$12M</td>
                  <td className="p-4">$45M</td>
                  <td className="p-4">$120M</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold">Gross Margin</td>
                  <td className="p-4">65%</td>
                  <td className="p-4">70%</td>
                  <td className="p-4">75%</td>
                  <td className="p-4">78%</td>
                  <td className="p-4">80%</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold">Net Income</td>
                  <td className="p-4 text-red-400">($360K)</td>
                  <td className="p-4 text-red-400">($600K)</td>
                  <td className="p-4 text-emerald-400">$3M</td>
                  <td className="p-4 text-emerald-400">$18M</td>
                  <td className="p-4 text-emerald-400">$60M</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-8">
            <div className="text-center p-4 glass rounded-xl border-emerald-500/20">
              <p className="text-xs text-slate-500 uppercase">Break-Even</p>
              <p className="text-xl font-bold">Month 18</p>
            </div>
            <div className="text-center p-4 glass rounded-xl border-blue-500/20">
              <p className="text-xs text-slate-500 uppercase">Year 5 ARR</p>
              <p className="text-xl font-bold">$120M</p>
            </div>
            <div className="text-center p-4 glass rounded-xl border-purple-500/20">
              <p className="text-xs text-slate-500 uppercase">Est. Valuation (10x)</p>
              <p className="text-xl font-bold">$1.2B</p>
            </div>
          </div>
        </section>

        {/* SLIDE 8: THE TEAM */}
        <section>
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-purple-500 mb-4">The Team</h2>
          <h3 className="text-5xl font-bold mb-12">Human Leadership, AI-Amplified Execution</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="flex gap-6 items-start">
              <div className="w-24 h-24 bg-slate-800 rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden">
                <span className="text-3xl">JB</span>
              </div>
              <div>
                <h4 className="text-2xl font-bold">Jonah Baka</h4>
                <p className="text-blue-400 mb-4 font-semibold uppercase text-xs tracking-widest">Founder &amp; CEO</p>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Full-stack engineer and product leader with deep expertise in Healthcare Architecture. Built the entire DoctaRx platform from the ground up, integrating proprietary AI triage and OpenClaw automation layers.
                </p>
              </div>
            </div>
            <div className="glass p-8 rounded-2xl">
              <h4 className="text-lg font-bold mb-4">Key Hires in Progress</h4>
              <ul className="space-y-3 text-sm text-slate-300">
                <li className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-500 rounded-full"></span> Chief Medical Officer (Clinical Oversight)</li>
                <li className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-500 rounded-full"></span> VP Engineering (Platform Scaling)</li>
                <li className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-500 rounded-full"></span> Compliance Officer (HIPAA/SOC 2)</li>
                <li className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-500 rounded-full"></span> Head of Growth</li>
              </ul>
            </div>
          </div>
        </section>

        {/* SLIDE 9: THE ASK */}
        <section className="items-center text-center">
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-blue-500 mb-4">The Ask</h2>
          <h3 className="text-7xl font-bold mb-8">$2,500,000</h3>
          <p className="text-2xl text-slate-400 mb-12">Seed Round | $10M Pre-Money Valuation</p>

          <div className="max-w-4xl w-full grid grid-cols-4 gap-4">
            <div className="stat-card">
              <p className="text-2xl font-bold text-white mb-2">40%</p>
              <p className="text-[10px] text-slate-500 uppercase mb-2">Eng &amp; Product</p>
              <p className="text-xs text-slate-400">Core engineering &amp; OpenClaw AI dev</p>
            </div>
            <div className="stat-card">
              <p className="text-2xl font-bold text-white mb-2">25%</p>
              <p className="text-[10px] text-slate-500 uppercase mb-2">Growth</p>
              <p className="text-xs text-slate-400">Provider &amp; patient acquisition</p>
            </div>
            <div className="stat-card">
              <p className="text-2xl font-bold text-white mb-2">15%</p>
              <p className="text-[10px] text-slate-500 uppercase mb-2">Compliance</p>
              <p className="text-xs text-slate-400">SOC 2, state licensing &amp; legal</p>
            </div>
            <div className="stat-card">
              <p className="text-2xl font-bold text-white mb-2">20%</p>
              <p className="text-[10px] text-slate-500 uppercase mb-2">Ops &amp; Reserve</p>
              <p className="text-xs text-slate-400">18-month runway buffer</p>
            </div>
          </div>

          <div className="mt-16 flex gap-12 text-left">
            <div className="glass p-6 rounded-xl">
              <p className="text-xs text-slate-500 uppercase mb-1">Target Runway</p>
              <p className="text-lg font-bold">18 Months</p>
            </div>
            <div className="glass p-6 rounded-xl">
              <p className="text-xs text-slate-500 uppercase mb-1">Target ARR (M18)</p>
              <p className="text-lg font-bold">$1.8 Million</p>
            </div>
          </div>
        </section>

        {/* SLIDE 10: CONTACT */}
        <section className="items-center text-center">
          <div className="w-24 h-24 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-3xl mb-8 flex items-center justify-center">
            <div className="w-12 h-12 bg-white rounded-full"></div>
          </div>
          <h2 className="text-5xl font-bold mb-4">Let&apos;s Build the Future</h2>
          <p className="text-xl text-slate-400 mb-12">Healthcare, Reimagined.</p>

          <div className="space-y-4">
            <a href="mailto:jonah.baka@doctarx.com" className="block text-2xl font-semibold hover:text-blue-400 transition">jonah.baka@doctarx.com</a>
            <a href="https://www.linkedin.com/in/jonah-baka-b74666102" target="_blank" rel="noopener noreferrer" className="block text-slate-400 hover:text-white transition">linkedin.com/in/jonah-baka</a>
            <a href="https://doctarx.com" target="_blank" rel="noopener noreferrer" className="block text-slate-500 hover:text-white transition">doctarx.com</a>
          </div>

          <p className="mt-24 text-[10px] text-slate-600 tracking-widest uppercase">Confidential &copy; 2026 DoctaRx Inc.</p>
        </section>

        {/* CONTROLS */}
        {/* LOADING OVERLAY */}
        {isGenerating && (
          <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-lg font-semibold text-white">Generating PDF...</p>
            <p className="text-sm text-slate-500 mt-1">Rendering all 10 slides</p>
          </div>
        )}

        {/* CONTROLS */}
        <div className="fixed bottom-5 right-5 z-[100] flex gap-2 no-print">
          <button
            onClick={handleDownloadPDF}
            disabled={isGenerating}
            className="glass px-4 py-2 rounded-full text-xs font-bold hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-wait flex items-center gap-2"
          >
            {isGenerating ? 'Generating...' : 'Download PDF'}
          </button>
          <button onClick={handleNextSlide} className="glass px-4 py-2 rounded-full text-xs font-bold hover:bg-slate-700 transition">Next Slide</button>
        </div>

      </div>
    </>
  );
}
