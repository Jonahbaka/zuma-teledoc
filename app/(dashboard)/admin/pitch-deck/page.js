'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

export default function PitchDeckPage() {
  const containerRef = useRef(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const totalSlides = 10;

  // Track current slide via scroll position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const idx = Math.round(el.scrollTop / el.clientHeight);
      setCurrentSlide(idx);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const handleNextSlide = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
    }
  };

  const goToSlide = (idx) => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: idx * containerRef.current.clientHeight, behavior: 'smooth' });
    }
  };

  // ═══ ELEGANT TEXT-BASED PDF — Inter font, refined design ═══
  const handleDownloadPDF = useCallback(async () => {
    setIsGenerating(true);
    try {
      const { default: jsPDF } = await import('jspdf');

      // Load Inter font files
      const [regBuf, boldBuf] = await Promise.all([
        fetch('/fonts/Inter-Regular.ttf').then(r => r.arrayBuffer()),
        fetch('/fonts/Inter-Bold.ttf').then(r => r.arrayBuffer()),
      ]);
      const toB64 = (buf) => {
        const b = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return btoa(s);
      };

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });

      // Register Inter fonts
      pdf.addFileToVFS('Inter-Regular.ttf', toB64(regBuf));
      pdf.addFont('Inter-Regular.ttf', 'Inter', 'normal');
      pdf.addFileToVFS('Inter-Bold.ttf', toB64(boldBuf));
      pdf.addFont('Inter-Bold.ttf', 'Inter', 'bold');

      // ── Color Palette ──
      const BG  = [5, 7, 10];
      const BG2 = [8, 12, 18];
      const W   = [255, 255, 255];
      const W90 = [230, 230, 230];
      const S2  = [226, 232, 240];
      const S3  = [203, 213, 225];
      const S4  = [148, 163, 184];
      const S5  = [100, 116, 139];
      const S6  = [71, 85, 105];
      const S7  = [51, 65, 85];
      const S8  = [30, 41, 59];
      const S9  = [15, 23, 42];
      const B3  = [147, 197, 253];
      const B4  = [96, 165, 250];
      const B5  = [59, 130, 246];
      const B6  = [37, 99, 235];
      const B9  = [30, 58, 138];
      const P4  = [192, 132, 252];
      const P5  = [168, 85, 247];
      const E4  = [52, 211, 153];
      const E5  = [16, 185, 129];
      const O5  = [249, 115, 22];
      const R4  = [248, 113, 113];
      const R5  = [239, 68, 68];

      // ── Helpers ──
      const M = 80; // margin
      const tc = (c) => pdf.setTextColor(...c);
      const fc = (c) => pdf.setFillColor(...c);
      const dc = (c) => pdf.setDrawColor(...c);
      const ft = (s, sz) => { pdf.setFontSize(sz); pdf.setFont('Inter', s); };
      const wrap = (t, w) => pdf.splitTextToSize(t, w);

      // Background with subtle radial gradient simulation
      const bg = () => {
        fc(BG); pdf.rect(0, 0, 1280, 720, 'F');
        // Subtle dark blue glow top-left
        fc([8, 15, 35]); pdf.circle(200, 150, 300, 'F');
        fc(BG); pdf.setGState(new pdf.GState({ opacity: 0.7 }));
        pdf.circle(200, 150, 300, 'F');
        pdf.setGState(new pdf.GState({ opacity: 1 }));
      };

      // Simple clean background (fallback if GState causes issues)
      const bgSimple = () => {
        fc(BG); pdf.rect(0, 0, 1280, 720, 'F');
      };

      // Top accent bar (gradient simulated with segments)
      const topBar = () => {
        const colors = [[59, 130, 246], [99, 102, 241], [139, 92, 246], [168, 85, 247]];
        colors.forEach((c, i) => {
          fc(c); pdf.rect(i * 320, 0, 322, 3, 'F');
        });
      };

      // Page number footer
      const footer = (num) => {
        ft('normal', 10); tc(S6);
        pdf.text(`${num} / ${totalSlides}`, 1200, 700, { align: 'center' });
        dc(S8); pdf.line(M, 680, 1200, 680);
      };

      // Section label with colored dot
      const label = (t, c, y) => {
        const ly = y || 65;
        fc(c); pdf.circle(M, ly - 3, 4, 'F');
        ft('bold', 11); tc(c);
        pdf.text(t.toUpperCase(), M + 14, ly);
      };

      // Slide headline
      const title = (t, y, mw) => {
        ft('bold', 44); tc(W);
        const ln = wrap(t, mw || 900);
        pdf.text(ln, M, y || 110);
        return (y || 110) + ln.length * 52;
      };

      // Elegant card with subtle shadow
      const card = (x, y, w, h, accent) => {
        // Shadow
        fc([3, 5, 8]); pdf.roundedRect(x + 2, y + 2, w, h, 12, 12, 'F');
        // Card body
        fc(S9); pdf.roundedRect(x, y, w, h, 12, 12, 'F');
        dc([40, 52, 72]); pdf.setLineWidth(0.5); pdf.roundedRect(x, y, w, h, 12, 12, 'S'); pdf.setLineWidth(1);
        // Accent left bar
        if (accent) { fc(accent); pdf.roundedRect(x, y + 8, 3, h - 16, 2, 2, 'F'); }
      };

      // Glass card (lighter)
      const glass = (x, y, w, h) => {
        fc(S8); pdf.roundedRect(x, y, w, h, 12, 12, 'F');
        dc([45, 55, 75]); pdf.setLineWidth(0.5); pdf.roundedRect(x, y, w, h, 12, 12, 'S'); pdf.setLineWidth(1);
      };

      const newSlide = () => pdf.addPage([1280, 720], 'landscape');

      // ═══════════════════════════════════════════════════
      // SLIDE 1: TITLE
      // ═══════════════════════════════════════════════════
      bgSimple(); topBar();
      // Subtle decorative circles
      fc([15, 25, 50]); pdf.circle(1100, 600, 200, 'F');
      fc([10, 18, 38]); pdf.circle(1100, 600, 200, 'F');
      // Logo
      fc(B6); pdf.roundedRect(590, 120, 100, 100, 24, 24, 'F');
      fc([80, 140, 255]); pdf.roundedRect(594, 124, 92, 92, 20, 20, 'F');
      fc(W); pdf.circle(640, 170, 26, 'F');
      // Title
      ft('bold', 60); tc(W); pdf.text('DoctaRx', 640, 300, { align: 'center' });
      // Tagline
      ft('normal', 22); tc(B4); pdf.text('Doctor-Led Telehealth, Supercharged by AI', 640, 345, { align: 'center' });
      // Subtitle
      ft('normal', 15); tc(S4); pdf.text('Making Healthcare Accessible, Affordable, and Intelligent', 640, 385, { align: 'center' });
      // Badge row
      const badges = ['DOCTOR-LED', 'HIPAA COMPLIANT', 'AI-ENHANCED'];
      let bx = 640 - 180;
      badges.forEach((b, i) => {
        ft('bold', 9); tc(S5);
        if (i > 0) { tc(S7); pdf.text('\u2022', bx - 12, 430); }
        pdf.text(b, bx, 430);
        bx += pdf.getTextWidth(b) + 28;
      });
      // Founder pill
      glass(460, 480, 360, 70);
      dc(S7); pdf.line(640, 492, 640, 538);
      ft('normal', 9); tc(S5); pdf.text('FOUNDER', 490, 505); pdf.text('ROUND', 670, 505);
      ft('bold', 14); tc(W); pdf.text('Jonah Baka', 490, 528); pdf.text('Seed \u2014 Feb 2026', 670, 528);
      footer(1);

      // ═══════════════════════════════════════════════════
      // SLIDE 2: THE PROBLEM
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      label('The Problem', R5);
      const y2 = title('Healthcare is broken \u2014 and 83 Million Americans know it.', 110);
      const cY2 = y2 + 20;
      const stats = [
        { n: '83M', d: 'Americans lack adequate healthcare access, primarily in rural and underserved areas.', c: R5 },
        { n: '$4.5T', d: 'US Annual Spending. Yet outcomes rank 37th globally due to massive systemic inefficiency.', c: O5 },
        { n: '24 Days', d: 'Average wait time for a new patient appointment. Urgent needs often go unmet for weeks.', c: B5 },
      ];
      stats.forEach((s, i) => {
        const cx = M + i * 380;
        card(cx, cY2, 360, 150, s.c);
        ft('bold', 36); tc(W); pdf.text(s.n, cx + 24, cY2 + 48);
        dc(s.c); pdf.setLineWidth(0.5); pdf.line(cx + 24, cY2 + 60, cx + 120, cY2 + 60); pdf.setLineWidth(1);
        ft('normal', 12); tc(S4); pdf.text(wrap(s.d, 310), cx + 24, cY2 + 82);
      });
      const pY = cY2 + 180;
      ft('bold', 12); tc(S5); pdf.text('PAIN POINTS', M, pY);
      const pains = [
        'Provider burnout and administrative overload',
        'No price transparency or upfront costs',
        'Fragmented medical records and EMR silos',
        'Insurance complexity and billing denials'
      ];
      pains.forEach((p, i) => {
        const px = M + (i % 2) * 560; const py = pY + 28 + Math.floor(i / 2) * 32;
        ft('bold', 13); tc(R4); pdf.text('\u2715', px, py);
        ft('normal', 13); tc(S3); pdf.text(p, px + 22, py);
      });
      footer(2);

      // ═══════════════════════════════════════════════════
      // SLIDE 3: OUR SOLUTION
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      label('Our Solution', P5);
      title('Doctor-first telehealth, enhanced by AI built for scale.', 110);
      const sols = [
        { t: 'Instant Access', d: 'See a board-certified doctor in minutes, not weeks. Licensed providers available via video and chat with AI-assisted triage.', ic: B5 },
        { t: 'AI-Assisted Workflows', d: 'Automated SOAP note drafting, smart triage routing, and predictive health insights. Doctors make every final decision.', ic: P5 },
        { t: 'Transparent Pricing', d: 'Subscriptions from $19.99/mo. No surprise bills. Real-time insurance eligibility checks at the point of care.', ic: E5 },
        { t: 'FHIR-Native Security', d: 'End-to-end encryption, SOC 2 compliant, and seamless interoperability with existing health systems.', ic: B5 },
      ];
      sols.forEach((s, i) => {
        const sx = M + (i % 2) * 570; const sy = 210 + Math.floor(i / 2) * 190;
        glass(sx, sy, 550, 170);
        // Icon circle
        fc(s.ic); pdf.circle(sx + 30, sy + 38, 12, 'F');
        ft('bold', 11); tc(W); pdf.text((i + 1).toString(), sx + 27, sy + 42);
        ft('bold', 18); tc(W); pdf.text(s.t, sx + 52, sy + 42);
        ft('normal', 13); tc(S4); pdf.text(wrap(s.d, 490), sx + 28, sy + 72);
      });
      footer(3);

      // ═══════════════════════════════════════════════════
      // SLIDE 4: THE PRODUCT
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      label('The Product', E5);
      title('A Full-Stack Clinical Platform', 110);
      const prods = [
        { n: 'Video Consultations', d: 'HD video with AI clinical scribing', c: B5 },
        { n: 'E-Prescribing', d: 'Direct-to-pharmacy integration', c: B5 },
        { n: 'AI-Powered Triage', d: 'Smart symptom and acuity routing', c: B5 },
        { n: 'Insurance Wallet', d: 'OCR card scanning and eligibility', c: P5 },
        { n: 'Clinical Records', d: 'FHIR-native internal EHR', c: P5 },
        { n: 'Provider Dashboard', d: 'Unified revenue and schedule mgmt', c: P5 },
        { n: 'Predictive Analytics', d: 'ML insights for patient outcomes', c: E5 },
        { n: 'Payment Processing', d: 'Stripe billing and automated claims', c: E5 },
        { n: 'OpenClaw AI', d: 'Core AI Ops automation layer', c: [96, 165, 250] },
      ];
      prods.forEach((p, i) => {
        const px = M + (i % 3) * 380; const py = 185 + Math.floor(i / 3) * 105;
        card(px, py, 360, 85, p.c);
        ft('bold', 14); tc(i === 8 ? B4 : W); pdf.text(p.n, px + 18, py + 35);
        ft('normal', 11); tc(S4); pdf.text(p.d, px + 18, py + 58);
      });
      footer(4);

      // ═══════════════════════════════════════════════════
      // SLIDE 5: MARKET OPPORTUNITY
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      label('Market Opportunity', O5);
      title('Telehealth is Inevitable.', 110);
      // Bar chart
      const bB = 550; const bW = 160; const bG = 24; const bX = M;
      // TAM bar
      card(bX, bB - 300, bW, 300); fc(S9); pdf.roundedRect(bX, bB - 300, bW, 300, 12, 12, 'F');
      dc([30, 40, 60]); pdf.setLineWidth(0.5); pdf.roundedRect(bX, bB - 300, bW, 300, 12, 12, 'S'); pdf.setLineWidth(1);
      ft('bold', 10); tc(S5); pdf.text('TAM', bX + 18, bB - 262);
      ft('bold', 24); tc(W); pdf.text('$460B', bX + 18, bB - 232);
      ft('normal', 10); tc(S4); pdf.text('US Healthcare Svc', bX + 18, bB - 210);
      // SAM bar
      const s2x = bX + bW + bG;
      fc(B9); pdf.roundedRect(s2x, bB - 220, bW, 220, 12, 12, 'F');
      dc([40, 68, 158]); pdf.setLineWidth(0.5); pdf.roundedRect(s2x, bB - 220, bW, 220, 12, 12, 'S'); pdf.setLineWidth(1);
      ft('bold', 10); tc(B3); pdf.text('SAM', s2x + 18, bB - 185);
      ft('bold', 24); tc(W); pdf.text('$83B', s2x + 18, bB - 155);
      ft('normal', 10); tc(B4); pdf.text('Telehealth 2030', s2x + 18, bB - 133);
      // SOM bar
      const s3x = bX + 2 * (bW + bG);
      fc(B6); pdf.roundedRect(s3x, bB - 110, bW, 110, 12, 12, 'F');
      ft('bold', 10); tc(W); pdf.text('SOM', s3x + 18, bB - 80);
      ft('bold', 24); tc(W); pdf.text('$830M', s3x + 18, bB - 50);
      ft('normal', 10); tc([200, 220, 255]); pdf.text('1% Capture Plan', s3x + 18, bB - 28);

      // Tailwind cards
      const tws = [
        { h: '\u2191 48.1% CAGR', t: 'AI in Healthcare growth (2024\u20132030)', c: E5 },
        { h: '124K Deficit', t: 'Projected physician shortage by 2034', c: B4 },
        { h: 'CMS Expanded', t: 'Permanent reimbursement for virtual visits', c: P4 },
      ];
      tws.forEach((tw, i) => {
        const ty = 210 + i * 85;
        glass(620, ty, 580, 65);
        fc(tw.c); pdf.circle(644, ty + 32, 5, 'F');
        ft('bold', 14); tc(tw.c); pdf.text(tw.h, 660, ty + 37);
        ft('normal', 13); tc(S3); pdf.text(tw.t, 660 + pdf.getTextWidth(tw.h) + 10, ty + 37);
      });
      footer(5);

      // ═══════════════════════════════════════════════════
      // SLIDE 6: BUSINESS MODEL
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      label('Business Model', B5);
      title('High Margin, Recurring Revenue', 110);
      const revs = [
        { n: 'Patient Subscriptions', m: '85% Margin', p: '$19.99 \u2013 $79.99', d: 'Monthly recurring revenue (B2C)', mc: E5 },
        { n: 'Provider Platform', m: '90% Margin', p: '$99 \u2013 $499', d: 'SaaS fees for practitioners', mc: E5 },
        { n: 'Consultation Fees', m: '35% Margin', p: '$49 \u2013 $129', d: 'Per-visit fees for non-subscribers', mc: B5 },
      ];
      revs.forEach((r, i) => {
        const rx = M + i * 380;
        card(rx, 185, 360, 155);
        ft('bold', 15); tc(W); pdf.text(r.n, rx + 22, 215);
        // Margin badge
        fc([...r.mc.map(c => Math.round(c * 0.2))]); pdf.roundedRect(rx + 240, 200, 90, 22, 6, 6, 'F');
        ft('bold', 9); tc(r.mc); pdf.text(r.m, rx + 252, 215);
        ft('bold', 24); tc(W); pdf.text(r.p, rx + 22, 260);
        ft('normal', 11); tc(S5); pdf.text(r.d, rx + 22, 288);
      });
      // Enterprise
      card(M, 365, 360, 155);
      ft('bold', 15); tc(W); pdf.text('Enterprise', M + 22, 395);
      fc([34, 17, 49]); pdf.roundedRect(M + 240, 380, 90, 22, 6, 6, 'F');
      ft('bold', 9); tc(P5); pdf.text('75% Margin', M + 252, 395);
      ft('bold', 24); tc(W); pdf.text('$2,000+', M + 22, 440);
      ft('normal', 11); tc(S5); pdf.text('White-label and employer deals', M + 22, 468);
      // LTV/CAC
      glass(M + 380, 365, 740, 155);
      ft('normal', 11); tc(S5); pdf.text('Target LTV/CAC', M + 480, 420);
      ft('bold', 32); tc(W); pdf.text('5 : 1', M + 480, 462);
      dc(S7); pdf.line(M + 680, 385, M + 680, 500);
      ft('normal', 11); tc(S5); pdf.text('Blended Gross Margin', M + 740, 420);
      ft('bold', 32); tc(W); pdf.text('70%+', M + 740, 462);
      footer(6);

      // ═══════════════════════════════════════════════════
      // SLIDE 7: FINANCIAL PROJECTIONS
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      label('Financial Projections', E5);
      title('Path to $120M ARR', 110);
      // Table
      const tX = M; const tY = 175; const tW2 = 1120; const cW = tW2 / 6; const rH = 44;
      // Header row
      fc(S8); pdf.roundedRect(tX, tY, tW2, rH, 10, 10, 'F');
      ft('bold', 12); tc(S4);
      ['Metric', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'].forEach((h, i) => pdf.text(h, tX + i * cW + 22, tY + 28));
      // Data rows
      const tRows = [
        { l: 'Patients', v: ['500', '5,000', '25,000', '75,000', '200,000'] },
        { l: 'Providers', v: ['25', '100', '400', '1,200', '3,000'] },
        { l: 'Revenue', v: ['$120K', '$1.8M', '$12M', '$45M', '$120M'], hi: true },
        { l: 'Gross Margin', v: ['65%', '70%', '75%', '78%', '80%'] },
        { l: 'Net Income', v: ['($360K)', '($600K)', '$3M', '$18M', '$60M'], cm: [R4, R4, E4, E4, E4] },
      ];
      tRows.forEach((r, ri) => {
        const rY = tY + rH + ri * rH;
        if (ri % 2 === 0) { fc([10, 15, 28]); pdf.rect(tX, rY, tW2, rH, 'F'); }
        dc([25, 35, 55]); pdf.setLineWidth(0.3); pdf.line(tX, rY + rH, tX + tW2, rY + rH); pdf.setLineWidth(1);
        ft(r.hi ? 'bold' : 'normal', 13); tc(r.hi ? B4 : W); pdf.text(r.l, tX + 22, rY + 28);
        r.v.forEach((v, vi) => { tc(r.cm ? r.cm[vi] : (r.hi ? B4 : S3)); pdf.text(v, tX + (vi + 1) * cW + 22, rY + 28); });
      });
      // Summary boxes
      const sY = tY + rH + tRows.length * rH + 35;
      [{ l: 'BREAK-EVEN', v: 'Month 18', c: E5 }, { l: 'YEAR 5 ARR', v: '$120M', c: B5 }, { l: 'EST. VALUATION (10X)', v: '$1.2B', c: P5 }].forEach((s, i) => {
        const sx = M + i * 380;
        glass(sx, sY, 360, 75);
        fc(s.c); pdf.circle(sx + 18, sY + 37, 4, 'F');
        ft('normal', 10); tc(S5); pdf.text(s.l, sx + 30, sY + 30);
        ft('bold', 22); tc(W); pdf.text(s.v, sx + 30, sY + 58);
      });
      footer(7);

      // ═══════════════════════════════════════════════════
      // SLIDE 8: THE TEAM
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      label('The Team', P5);
      title('Human Leadership, AI-Amplified Execution', 110);
      // Founder card
      card(M, 200, 520, 260);
      fc(S8); pdf.roundedRect(M + 24, 224, 90, 90, 18, 18, 'F');
      ft('bold', 30); tc(S5); pdf.text('JB', M + 46, 280);
      ft('bold', 22); tc(W); pdf.text('Jonah Baka', M + 134, 250);
      // Title badge
      fc([15, 30, 60]); pdf.roundedRect(M + 134, 260, 130, 22, 6, 6, 'F');
      ft('bold', 9); tc(B4); pdf.text('FOUNDER & CEO', M + 146, 275);
      ft('normal', 12); tc(S4);
      pdf.text(wrap('Full-stack engineer and product leader with deep expertise in Healthcare Architecture. Built the entire DoctaRx platform from the ground up, integrating proprietary AI triage and OpenClaw automation layers.', 370), M + 134, 305);
      // Key Hires card
      glass(M + 540, 200, 580, 260);
      ft('bold', 18); tc(W); pdf.text('Key Hires in Progress', M + 570, 240);
      dc(S7); pdf.line(M + 570, 252, M + 850, 252);
      const hires = ['Chief Medical Officer (Clinical Oversight)', 'VP Engineering (Platform Scaling)', 'Compliance Officer (HIPAA/SOC 2)', 'Head of Growth (Marketing and BD)'];
      hires.forEach((h, i) => {
        const hy = 290 + i * 38;
        fc(B5); pdf.circle(M + 575, hy - 4, 5, 'F');
        ft('bold', 10); tc(W); pdf.text((i + 1).toString(), M + 572, hy);
        ft('normal', 14); tc(S3); pdf.text(h, M + 592, hy);
      });
      footer(8);

      // ═══════════════════════════════════════════════════
      // SLIDE 9: THE ASK
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      // Decorative circle
      fc([10, 20, 45]); pdf.circle(640, 350, 280, 'F');
      fc(BG); pdf.circle(640, 350, 280, 'F');
      // Content
      ft('bold', 11); tc(B5); pdf.text('THE ASK', 640, 80, { align: 'center' });
      dc(B5); pdf.setLineWidth(0.5); pdf.line(600, 88, 680, 88); pdf.setLineWidth(1);
      ft('bold', 64); tc(W); pdf.text('$2,500,000', 640, 185, { align: 'center' });
      ft('normal', 20); tc(S4); pdf.text('Seed Round  |  $10M Pre-Money Valuation', 640, 225, { align: 'center' });
      // Funds allocation
      const funds = [
        { p: '40%', l: 'ENG & PRODUCT', d: 'Core engineering and OpenClaw AI dev', c: B5 },
        { p: '25%', l: 'GROWTH', d: 'Provider and patient acquisition', c: P5 },
        { p: '15%', l: 'COMPLIANCE', d: 'SOC 2, state licensing and legal', c: E5 },
        { p: '20%', l: 'OPS & RESERVE', d: '18-month runway buffer', c: O5 },
      ];
      funds.forEach((f, i) => {
        const fx = 160 + i * 250;
        card(fx, 280, 230, 155, f.c);
        ft('bold', 28); tc(W); pdf.text(f.p, fx + 20, 322);
        ft('bold', 9); tc(S5); pdf.text(f.l, fx + 20, 348);
        ft('normal', 11); tc(S4); pdf.text(wrap(f.d, 190), fx + 20, 375);
      });
      // Target metrics
      glass(380, 475, 240, 65);
      ft('normal', 9); tc(S5); pdf.text('TARGET RUNWAY', 410, 500);
      ft('bold', 16); tc(W); pdf.text('18 Months', 410, 524);
      glass(660, 475, 240, 65);
      ft('normal', 9); tc(S5); pdf.text('TARGET ARR (M18)', 690, 500);
      ft('bold', 16); tc(W); pdf.text('$1.8 Million', 690, 524);
      footer(9);

      // ═══════════════════════════════════════════════════
      // SLIDE 10: CONTACT
      // ═══════════════════════════════════════════════════
      newSlide(); bgSimple(); topBar();
      // Decorative elements
      fc([10, 18, 38]); pdf.circle(640, 360, 250, 'F');
      // Logo
      fc(B6); pdf.roundedRect(600, 130, 80, 80, 18, 18, 'F');
      fc([80, 140, 255]); pdf.roundedRect(604, 134, 72, 72, 14, 14, 'F');
      fc(W); pdf.circle(640, 170, 20, 'F');
      // Text
      ft('bold', 44); tc(W); pdf.text("Let's Build the Future", 640, 285, { align: 'center' });
      ft('normal', 18); tc(S4); pdf.text('Healthcare, Reimagined.', 640, 325, { align: 'center' });
      // Separator
      dc(S7); pdf.line(560, 355, 720, 355);
      // Contact
      ft('bold', 22); tc(W); pdf.text('jonah.baka@doctarx.com', 640, 400, { align: 'center' });
      ft('normal', 14); tc(B4); pdf.text('linkedin.com/in/jonah-baka', 640, 435, { align: 'center' });
      ft('normal', 14); tc(S5); pdf.text('doctarx.com', 640, 465, { align: 'center' });
      // Footer
      ft('normal', 9); tc(S6); pdf.text('CONFIDENTIAL  \u00A9  2026 DOCTARX INC.', 640, 620, { align: 'center' });
      footer(10);

      pdf.save(`DoctaRx-Pitch-Deck-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

        .pitch-deck {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background-color: #05070a;
          color: #e2e8f0;
          scroll-snap-type: y mandatory;
          overflow-y: scroll;
          height: 100vh;
          scroll-behavior: smooth;
        }
        .pitch-deck::-webkit-scrollbar { width: 0; }

        .pitch-deck section {
          height: 100vh;
          scroll-snap-align: start;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 4rem 5rem;
          position: relative;
          overflow: hidden;
        }

        .pitch-deck section::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #3b82f6, #6366f1, #8b5cf6, #a855f7);
        }

        .gradient-text {
          background: linear-gradient(135deg, #60a5fa, #a78bfa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .glass {
          background: rgba(30, 41, 59, 0.5);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 1rem;
          transition: all 0.3s ease;
        }
        .glass:hover {
          background: rgba(30, 41, 59, 0.7);
          border-color: rgba(255, 255, 255, 0.15);
          transform: translateY(-2px);
        }

        .stat-card {
          padding: 1.75rem;
          border-radius: 1rem;
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(51, 65, 85, 0.6);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }
        .stat-card::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(96,165,250,0.3), transparent);
        }
        .stat-card:hover {
          border-color: rgba(96, 165, 250, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(0,0,0,0.3);
        }

        .section-label {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .section-label .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .section-label span {
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }

        .slide-title {
          font-size: 3.25rem;
          font-weight: 800;
          line-height: 1.15;
          margin-bottom: 3rem;
          max-width: 52rem;
          letter-spacing: -0.02em;
        }

        .bg-glow {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          opacity: 0.15;
          pointer-events: none;
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
          <div className="bg-glow" style={{width:600,height:600,top:'10%',left:'20%',background:'radial-gradient(circle,rgba(59,130,246,0.15),transparent)'}} />
          <div className="bg-glow" style={{width:500,height:500,bottom:'10%',right:'15%',background:'radial-gradient(circle,rgba(168,85,247,0.1),transparent)'}} />
          <div className="w-28 h-28 bg-gradient-to-tr from-blue-600 via-indigo-500 to-purple-600 rounded-3xl mb-8 flex items-center justify-center shadow-2xl shadow-blue-500/25 relative">
            <div className="w-14 h-14 bg-white rounded-full" />
          </div>
          <h1 className="text-7xl font-extrabold mb-4 tracking-tight">DoctaRx</h1>
          <p className="text-2xl text-blue-400 font-light mb-6 max-w-2xl tracking-wide">Doctor-Led Telehealth, Supercharged by AI</p>
          <p className="text-base text-slate-400 mb-12 max-w-xl">Making Healthcare Accessible, Affordable, and Intelligent</p>
          <div className="flex gap-6 text-xs font-bold tracking-[0.25em] uppercase text-slate-500">
            <span>Doctor-Led</span>
            <span className="text-slate-700">&bull;</span>
            <span>HIPAA Compliant</span>
            <span className="text-slate-700">&bull;</span>
            <span>AI-Enhanced</span>
          </div>
          <div className="mt-16 glass px-8 py-5 rounded-2xl flex gap-10 items-center">
            <div className="text-left">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Founder</p>
              <p className="text-sm font-semibold">Jonah Baka</p>
            </div>
            <div className="w-px h-8 bg-slate-700" />
            <div className="text-left">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Round</p>
              <p className="text-sm font-semibold">Seed &mdash; Feb 2026</p>
            </div>
          </div>
        </section>

        {/* SLIDE 2: THE PROBLEM */}
        <section>
          <div className="bg-glow" style={{width:500,height:500,top:'-10%',right:'5%',background:'radial-gradient(circle,rgba(239,68,68,0.08),transparent)'}} />
          <div className="section-label">
            <div className="dot bg-red-500" />
            <span className="text-red-500">The Problem</span>
          </div>
          <h3 className="slide-title">Healthcare is broken&mdash;and <span className="gradient-text">83 Million</span> Americans know it.</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { n: '83M', d: 'Americans lack adequate healthcare access, primarily in rural and underserved areas.' },
              { n: '$4.5T', d: 'US Annual Spending. Yet outcomes rank 37th globally due to massive systemic inefficiency.' },
              { n: '24 Days', d: 'Average wait time for a new patient appointment. Urgent needs often go unmet for weeks.' },
            ].map((s, i) => (
              <div key={i} className="stat-card">
                <p className="text-4xl font-extrabold text-white mb-1">{s.n}</p>
                <div className="w-12 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 mb-3 rounded" />
                <p className="text-slate-400 text-sm leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-2 gap-3 text-slate-300 text-sm">
            {['Provider burnout & administrative overload', 'No price transparency or upfront costs', 'Fragmented medical records & EMR silos', 'Insurance complexity & billing denials'].map((p, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-red-500 font-bold">&times;</span> {p}
              </div>
            ))}
          </div>
        </section>

        {/* SLIDE 3: THE SOLUTION */}
        <section>
          <div className="bg-glow" style={{width:600,height:600,bottom:'-20%',left:'30%',background:'radial-gradient(circle,rgba(168,85,247,0.08),transparent)'}} />
          <div className="section-label">
            <div className="dot bg-purple-500" />
            <span className="text-purple-500">Our Solution</span>
          </div>
          <h3 className="slide-title">Doctor-first telehealth, enhanced by AI built for <span className="gradient-text">scale</span>.</h3>

          <div className="grid grid-cols-2 gap-6">
            {[
              { t: 'Instant Access', d: 'See a board-certified doctor in minutes, not weeks. Licensed providers available via video/chat with AI-assisted triage.', c: 'from-blue-500 to-blue-600' },
              { t: 'AI-Assisted Workflows', d: 'Automated SOAP note drafting, smart triage routing, and predictive health insights. Doctors make every final decision.', c: 'from-purple-500 to-purple-600' },
              { t: 'Transparent Pricing', d: 'Subscriptions from $19.99/mo. No surprise bills. Real-time insurance eligibility checks at the point of care.', c: 'from-emerald-500 to-emerald-600' },
              { t: 'FHIR-Native Security', d: 'End-to-end encryption, SOC 2 compliant, and seamless interoperability with existing health systems.', c: 'from-blue-500 to-indigo-600' },
            ].map((s, i) => (
              <div key={i} className="glass p-7 rounded-2xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.c} flex items-center justify-center text-white text-xs font-bold`}>{i + 1}</div>
                  <h4 className="text-lg font-bold text-white">{s.t}</h4>
                </div>
                <p className="text-slate-400 leading-relaxed text-sm">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* SLIDE 4: THE PRODUCT */}
        <section>
          <div className="section-label">
            <div className="dot bg-emerald-500" />
            <span className="text-emerald-500">The Product</span>
          </div>
          <h3 className="slide-title">A Full-Stack Clinical Platform</h3>

          <div className="grid grid-cols-3 gap-4">
            {[
              { n: 'Video Consultations', d: 'HD video with AI clinical scribing', c: 'border-l-blue-500' },
              { n: 'E-Prescribing', d: 'Direct-to-pharmacy integration', c: 'border-l-blue-500' },
              { n: 'AI-Powered Triage', d: 'Smart symptom & acuity routing', c: 'border-l-blue-500' },
              { n: 'Insurance Wallet', d: 'OCR card scanning & eligibility', c: 'border-l-purple-500' },
              { n: 'Clinical Records', d: 'FHIR-native internal EHR', c: 'border-l-purple-500' },
              { n: 'Provider Dashboard', d: 'Unified revenue & schedule mgmt', c: 'border-l-purple-500' },
              { n: 'Predictive Analytics', d: 'ML insights for patient outcomes', c: 'border-l-emerald-500' },
              { n: 'Payment Processing', d: 'Stripe billing & automated claims', c: 'border-l-emerald-500' },
              { n: 'OpenClaw AI', d: 'Core AI Ops automation layer', c: 'border-l-emerald-500', special: true },
            ].map((p, i) => (
              <div key={i} className={`stat-card border-l-4 ${p.c} ${p.special ? 'bg-slate-800/80' : ''}`}>
                <h5 className={`font-bold ${p.special ? 'text-blue-400' : 'text-white'}`}>{p.n}</h5>
                <p className="text-xs text-slate-400 mt-1">{p.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* SLIDE 5: MARKET OPPORTUNITY */}
        <section>
          <div className="bg-glow" style={{width:400,height:400,top:'20%',left:'5%',background:'radial-gradient(circle,rgba(249,115,22,0.08),transparent)'}} />
          <div className="section-label">
            <div className="dot bg-orange-500" />
            <span className="text-orange-500">Market Opportunity</span>
          </div>
          <h3 className="slide-title">Telehealth is <span className="gradient-text">Inevitable</span>.</h3>

          <div className="flex gap-12 items-end">
            <div className="flex-1">
              <div className="relative h-64 flex items-end gap-4">
                <div className="flex-1 bg-slate-800/80 rounded-t-xl p-4 flex flex-col justify-end border border-slate-700/50 border-b-0">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">TAM</p>
                  <p className="text-2xl font-extrabold">$460B</p>
                  <p className="text-[10px] text-slate-400">US Healthcare Svc</p>
                </div>
                <div className="flex-1 bg-blue-900/60 rounded-t-xl p-4 flex flex-col justify-end h-3/4 border border-blue-800/30 border-b-0">
                  <p className="text-[10px] text-blue-300 uppercase tracking-wider">SAM</p>
                  <p className="text-2xl font-extrabold">$83B</p>
                  <p className="text-[10px] text-blue-400">Telehealth 2030</p>
                </div>
                <div className="flex-1 bg-gradient-to-t from-blue-600 to-purple-600 rounded-t-xl p-4 flex flex-col justify-end h-1/4">
                  <p className="text-[10px] text-white uppercase tracking-wider">SOM</p>
                  <p className="text-2xl font-extrabold">$830M</p>
                  <p className="text-[10px] text-white/70">1% Capture Plan</p>
                </div>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-1 gap-4">
              {[
                { h: '\u2191 48.1% CAGR', t: 'AI in Healthcare growth (2024\u20132030)', c: 'text-emerald-400' },
                { h: '124K Deficit', t: 'Projected physician shortage by 2034', c: 'text-blue-400' },
                { h: 'CMS Expanded', t: 'Permanent reimbursement for virtual visits', c: 'text-purple-400' },
              ].map((tw, i) => (
                <div key={i} className="glass p-5 rounded-xl text-sm flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${tw.c.replace('text-', 'bg-')}`} />
                  <span className={`${tw.c} font-bold`}>{tw.h}</span>
                  <span className="text-slate-300">&mdash; {tw.t}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SLIDE 6: BUSINESS MODEL */}
        <section>
          <div className="section-label">
            <div className="dot bg-blue-500" />
            <span className="text-blue-500">Business Model</span>
          </div>
          <h3 className="slide-title">High Margin, Recurring Revenue</h3>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            {[
              { n: 'Patient Subscriptions', m: '85% Margin', p: '$19.99 - $79.99', d: 'Monthly recurring revenue (B2C)', mc: 'text-emerald-500 bg-emerald-500/10' },
              { n: 'Provider Platform', m: '90% Margin', p: '$99 - $499', d: 'SaaS fees for practitioners', mc: 'text-emerald-500 bg-emerald-500/10' },
              { n: 'Consultation Fees', m: '35% Margin', p: '$49 - $129', d: 'Per-visit fees for non-subscribers', mc: 'text-blue-500 bg-blue-500/10' },
            ].map((r, i) => (
              <div key={i} className="stat-card">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="font-bold text-sm">{r.n}</h4>
                  <span className={`${r.mc} text-[10px] font-bold px-2.5 py-1 rounded-full`}>{r.m}</span>
                </div>
                <p className="text-2xl font-extrabold">{r.p}</p>
                <p className="text-xs text-slate-500 mt-1">{r.d}</p>
              </div>
            ))}
            <div className="stat-card">
              <div className="flex justify-between items-start mb-4">
                <h4 className="font-bold text-sm">Enterprise</h4>
                <span className="text-purple-500 bg-purple-500/10 text-[10px] font-bold px-2.5 py-1 rounded-full">75% Margin</span>
              </div>
              <p className="text-2xl font-extrabold">$2,000+</p>
              <p className="text-xs text-slate-500 mt-1">White-label &amp; employer deals</p>
            </div>
            <div className="stat-card col-span-2 flex items-center justify-around bg-blue-950/30 border-blue-500/20">
              <div className="text-center">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Target LTV/CAC</p>
                <p className="text-3xl font-extrabold mt-1">5 : 1</p>
              </div>
              <div className="w-px h-12 bg-slate-700" />
              <div className="text-center">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Blended Gross Margin</p>
                <p className="text-3xl font-extrabold mt-1">70%+</p>
              </div>
            </div>
          </div>
        </section>

        {/* SLIDE 7: FINANCIAL PROJECTIONS */}
        <section>
          <div className="section-label">
            <div className="dot bg-emerald-500" />
            <span className="text-emerald-500">Financial Projections</span>
          </div>
          <h3 className="slide-title">Path to <span className="gradient-text">$120M ARR</span></h3>

          <div className="overflow-hidden rounded-xl glass">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/80 text-slate-400">
                <tr>
                  {['Metric', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'].map((h, i) => (
                    <th key={i} className="p-4 text-xs font-bold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {[
                  { l: 'Patients', v: ['500', '5,000', '25,000', '75,000', '200,000'] },
                  { l: 'Providers', v: ['25', '100', '400', '1,200', '3,000'] },
                  { l: 'Revenue', v: ['$120K', '$1.8M', '$12M', '$45M', '$120M'], hi: true },
                  { l: 'Gross Margin', v: ['65%', '70%', '75%', '78%', '80%'] },
                  { l: 'Net Income', v: ['($360K)', '($600K)', '$3M', '$18M', '$60M'], cm: ['text-red-400', 'text-red-400', 'text-emerald-400', 'text-emerald-400', 'text-emerald-400'] },
                ].map((r, ri) => (
                  <tr key={ri} className={r.hi ? 'bg-blue-500/5' : ri % 2 === 0 ? 'bg-slate-900/30' : ''}>
                    <td className={`p-4 ${r.hi ? 'font-bold text-blue-400' : 'font-semibold'}`}>{r.l}</td>
                    {r.v.map((v, vi) => (
                      <td key={vi} className={`p-4 ${r.cm ? r.cm[vi] : r.hi ? 'text-blue-400 font-semibold' : 'text-slate-300'}`}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-6">
            {[
              { l: 'Break-Even', v: 'Month 18', c: 'bg-emerald-500' },
              { l: 'Year 5 ARR', v: '$120M', c: 'bg-blue-500' },
              { l: 'Est. Valuation (10x)', v: '$1.2B', c: 'bg-purple-500' },
            ].map((s, i) => (
              <div key={i} className="text-center p-5 glass rounded-xl flex items-center gap-3 justify-center">
                <div className={`w-2.5 h-2.5 rounded-full ${s.c}`} />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{s.l}</p>
                  <p className="text-xl font-extrabold">{s.v}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SLIDE 8: THE TEAM */}
        <section>
          <div className="section-label">
            <div className="dot bg-purple-500" />
            <span className="text-purple-500">The Team</span>
          </div>
          <h3 className="slide-title">Human Leadership, AI-Amplified Execution</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="stat-card flex gap-6 items-start">
              <div className="w-24 h-24 bg-gradient-to-br from-slate-800 to-slate-700 rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden border border-slate-600/30">
                <span className="text-3xl font-bold text-slate-400">JB</span>
              </div>
              <div>
                <h4 className="text-2xl font-extrabold">Jonah Baka</h4>
                <span className="inline-block bg-blue-500/10 text-blue-400 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider mt-1 mb-3">Founder &amp; CEO</span>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Full-stack engineer and product leader with deep expertise in Healthcare Architecture. Built the entire DoctaRx platform from the ground up, integrating proprietary AI triage and OpenClaw automation layers.
                </p>
              </div>
            </div>
            <div className="glass p-7 rounded-2xl">
              <h4 className="text-lg font-bold mb-2">Key Hires in Progress</h4>
              <div className="w-16 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 mb-5 rounded" />
              <ul className="space-y-4 text-sm text-slate-300">
                {['Chief Medical Officer (Clinical Oversight)', 'VP Engineering (Platform Scaling)', 'Compliance Officer (HIPAA/SOC 2)', 'Head of Growth (Marketing and BD)'].map((h, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="w-6 h-6 bg-blue-500 rounded-lg flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">{i + 1}</span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* SLIDE 9: THE ASK */}
        <section className="items-center text-center">
          <div className="bg-glow" style={{width:700,height:700,top:'5%',left:'25%',background:'radial-gradient(circle,rgba(59,130,246,0.06),transparent)'}} />
          <div className="section-label justify-center">
            <div className="dot bg-blue-500" />
            <span className="text-blue-500">The Ask</span>
          </div>
          <h3 className="text-7xl font-extrabold mb-2 tracking-tight">$2,500,000</h3>
          <div className="w-20 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 mx-auto mb-4 rounded" />
          <p className="text-xl text-slate-400 mb-12">Seed Round &nbsp;|&nbsp; $10M Pre-Money Valuation</p>

          <div className="max-w-4xl w-full grid grid-cols-4 gap-4">
            {[
              { p: '40%', l: 'Eng & Product', d: 'Core engineering & OpenClaw AI dev', c: 'border-l-blue-500' },
              { p: '25%', l: 'Growth', d: 'Provider & patient acquisition', c: 'border-l-purple-500' },
              { p: '15%', l: 'Compliance', d: 'SOC 2, state licensing & legal', c: 'border-l-emerald-500' },
              { p: '20%', l: 'Ops & Reserve', d: '18-month runway buffer', c: 'border-l-orange-500' },
            ].map((f, i) => (
              <div key={i} className={`stat-card border-l-4 ${f.c} text-left`}>
                <p className="text-3xl font-extrabold text-white mb-1">{f.p}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-bold">{f.l}</p>
                <p className="text-xs text-slate-400">{f.d}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 flex gap-8">
            <div className="glass p-5 rounded-xl text-left">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Target Runway</p>
              <p className="text-lg font-extrabold">18 Months</p>
            </div>
            <div className="glass p-5 rounded-xl text-left">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Target ARR (M18)</p>
              <p className="text-lg font-extrabold">$1.8 Million</p>
            </div>
          </div>
        </section>

        {/* SLIDE 10: CONTACT */}
        <section className="items-center text-center">
          <div className="bg-glow" style={{width:600,height:600,top:'15%',left:'25%',background:'radial-gradient(circle,rgba(99,102,241,0.08),transparent)'}} />
          <div className="w-20 h-20 bg-gradient-to-tr from-blue-600 via-indigo-500 to-purple-600 rounded-2xl mb-8 flex items-center justify-center shadow-2xl shadow-blue-500/20">
            <div className="w-10 h-10 bg-white rounded-full" />
          </div>
          <h2 className="text-5xl font-extrabold mb-3 tracking-tight">Let&apos;s Build the Future</h2>
          <p className="text-lg text-slate-400 mb-10">Healthcare, Reimagined.</p>

          <div className="w-16 h-px bg-slate-700 mb-10" />

          <div className="space-y-4">
            <a href="mailto:jonah.baka@doctarx.com" className="block text-2xl font-bold hover:text-blue-400 transition-colors">jonah.baka@doctarx.com</a>
            <a href="https://www.linkedin.com/in/jonah-baka-b74666102" target="_blank" rel="noopener noreferrer" className="block text-slate-400 hover:text-blue-400 transition-colors text-sm">linkedin.com/in/jonah-baka</a>
            <a href="https://doctarx.com" target="_blank" rel="noopener noreferrer" className="block text-slate-500 hover:text-white transition-colors text-sm">doctarx.com</a>
          </div>

          <p className="mt-24 text-[10px] text-slate-600 tracking-[0.3em] uppercase">Confidential &copy; 2026 DoctaRx Inc.</p>
        </section>

        {/* LOADING OVERLAY */}
        {isGenerating && (
          <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-lg font-bold text-white">Generating PDF...</p>
            <p className="text-sm text-slate-500 mt-1">Embedding fonts and rendering slides</p>
          </div>
        )}

        {/* SLIDE DOTS */}
        <div className="fixed right-6 top-1/2 -translate-y-1/2 z-[100] flex flex-col gap-2 no-print">
          {Array.from({ length: totalSlides }).map((_, i) => (
            <button
              key={i}
              onClick={() => goToSlide(i)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                i === currentSlide ? 'bg-blue-500 scale-150' : 'bg-slate-600 hover:bg-slate-400'
              }`}
              title={`Slide ${i + 1}`}
            />
          ))}
        </div>

        {/* CONTROLS */}
        <div className="fixed bottom-5 right-5 z-[100] flex gap-2 no-print">
          <button
            onClick={handleDownloadPDF}
            disabled={isGenerating}
            className="glass px-5 py-2.5 rounded-full text-xs font-bold hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-wait flex items-center gap-2"
          >
            {isGenerating ? 'Generating...' : 'Download PDF'}
          </button>
          <button onClick={handleNextSlide} className="glass px-5 py-2.5 rounded-full text-xs font-bold hover:bg-slate-700 transition">
            Next
          </button>
        </div>

      </div>
    </>
  );
}
