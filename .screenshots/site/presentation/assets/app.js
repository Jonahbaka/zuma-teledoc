/* DoctaRx Abuja Pilot — Presentation Microsite logic
   Renders synthetic demo data and runs a flicker-free, scene-based caption engine. */
(function () {
  'use strict';
  var D = window.DOCTARX_DEMO || {};
  var $ = function (sel) { return document.querySelector(sel); };
  var el = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  /* ---------------- Feature pillars ---------------- */
  var PILLARS = [
    { icon: '🎥', t: 'Video Consultation', p: 'Patients connect with doctors remotely; PHC officers assist where needed.', s: 'Remote doctor consultation support for selected PHCs and patients.' },
    { icon: '🔗', t: 'Care Coordination', p: 'Request → intake → review → prescription/referral → follow-up, all visible.', s: 'DoctaRx helps the system follow the patient journey from first request to follow-up.' },
    { icon: '🏥', t: 'Referral Tracking', p: 'Receiving hospital sees the summary; status moves pending → completed.', s: 'Referral tracking helps reduce lost follow-ups.' },
    { icon: '💊', t: 'Pharmacy Visibility', p: 'Pharmacy partner sees the prescription; availability can be confirmed.', s: 'Prescription visibility helps patients, doctors, and pharmacies coordinate better.' },
    { icon: '📈', t: 'Data & Forecasting', p: 'Aggregate trends: symptoms, facility load, medicine demand, response time.', s: 'Simple dashboards help decision-makers see trends early and plan better.' },
    { icon: '📋', t: 'NHMIS/DHIS2 Readiness', p: 'Aggregate reporting views aligned to national reporting needs.', s: 'DHIS2-ready aggregate reporting so pilot data is easier to review.' },
    { icon: '🩺', t: 'PHC Strengthening', p: 'PHC captures intake, requests review, tracks follow-up — never bypassed.', s: 'DoctaRx strengthens PHCs by connecting them to doctors, referrals, and reporting.' },
    { icon: '🛡️', t: 'Security & Confidentiality', p: 'Role-based access, aggregate reporting, no public exposure of records.', s: 'Sensitive patient details stay protected while aggregate indicators support planning.' },
    { icon: '📊', t: 'Ministry Oversight', p: 'Requests, consults, referrals, follow-up, response time, reporting readiness.', s: 'Simple visibility for decision-makers without exposing private details.' },
  ];
  var pg = $('#pillarsGrid');
  if (pg) PILLARS.forEach(function (x) {
    pg.appendChild(el('div', 'pillar',
      '<div class="pillar__icon">' + x.icon + '</div><h3>' + x.t + '</h3><p>' + x.p + '</p><p class="simple">“' + x.s + '”</p>'));
  });

  /* ---------------- Pilot workflow ---------------- */
  var FLOW = [
    'Patient request captured at the PHC or through DoctaRx.',
    'Nurse / PHC officer confirms basic intake.',
    'Doctor reviews the case and consults remotely where appropriate.',
    'Doctor documents consultation notes.',
    'Doctor issues a prescription or referral.',
    'Pharmacy sees prescription visibility where applicable.',
    'Hospital / referral officer receives the referral summary.',
    'Follow-up status is tracked.',
    'Ministry dashboard shows aggregate activity and pilot indicators.',
    'Reporting views support NHMIS/DHIS2-oriented review.',
    'Data analysis and forecasting views show trends for planning.',
  ];
  var pf = $('#pilotFlow');
  if (pf) FLOW.forEach(function (t) { pf.appendChild(el('li', null, t)); });

  /* ---------------- Video consultation chips ---------------- */
  var VC = ['Patient request', 'Doctor review', 'Video consultation', 'Prescription / referral', 'Follow-up'];
  var vcc = $('#videoConsultChips');
  if (vcc) VC.forEach(function (t, i) {
    vcc.appendChild(el('div', 'chip', '<span>' + (i + 1) + '</span>' + t));
    if (i < VC.length - 1) vcc.appendChild(el('div', 'chip-arrow', '→'));
  });

  /* ---------------- Metrics ---------------- */
  var m = D.metrics || {};
  var METRICS = [
    { v: m.patientRequests, l: 'Patient requests' },
    { v: m.completedConsultations, l: 'Completed consultations' },
    { v: m.videoConsultations, l: 'Video consultations' },
    { v: m.referralsCreated, l: 'Referrals created' },
    { v: m.referralsCompleted, l: 'Referrals completed' },
    { v: m.prescriptionsIssued, l: 'Prescriptions issued' },
    { v: m.followUpVisibility, l: 'Follow-up visibility', suffix: '%' },
    { v: m.avgResponseTimeMinutes, l: 'Avg response time', suffix: ' min' },
  ];
  var mg = $('#metricGrid');
  if (mg) METRICS.forEach(function (x) {
    mg.appendChild(el('div', 'metric',
      '<div class="metric__value">' + (x.v != null ? x.v : '—') + (x.suffix ? '<em>' + x.suffix + '</em>' : '') + '</div>' +
      '<div class="metric__label">' + x.l + '</div>'));
  });

  /* ---------------- Success indicators ---------------- */
  var INDICATORS = [
    { v: '21 / 34', l: 'Referral completion' },
    { v: m.followUpVisibility + '%', l: 'Patient follow-up visibility' },
    { v: m.completedConsultations, l: 'Completed consultations' },
    { v: m.videoConsultations, l: 'Video consultation usage' },
    { v: m.avgResponseTimeMinutes + ' min', l: 'Facility response time' },
    { v: m.prescriptionsIssued, l: 'Prescription visibility' },
    { v: m.reportingCompleteness + '%', l: 'Reporting completeness' },
    { v: 'Ready', l: 'DHIS2/NHMIS output readiness' },
  ];
  var ig = $('#indicatorsGrid');
  if (ig) INDICATORS.forEach(function (x) {
    ig.appendChild(el('div', 'metric',
      '<div class="metric__value">' + x.v + '</div><div class="metric__label">' + x.l + '</div>'));
  });

  /* ---------------- Symptom bars ---------------- */
  var sb = $('#symptomBars');
  if (sb && D.symptomCategories) {
    var max = Math.max.apply(null, D.symptomCategories.map(function (s) { return s.value; }));
    D.symptomCategories.forEach(function (s) {
      var row = el('div', 'bar-row');
      row.innerHTML = '<span>' + s.label + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(s.value / max * 100) + '%"></div></div>' +
        '<span class="bar-val">' + s.value + '</span>';
      sb.appendChild(row);
    });
  }

  /* ---------------- Tables ---------------- */
  function table(sel, head, rows) {
    var t = $(sel);
    if (!t) return;
    t.innerHTML = '<thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody>';
  }
  function statusClass(s) {
    s = (s || '').toLowerCase();
    if (/(completed|accepted|dispensed|delivered|ready|done)/.test(s)) return 'status--ok';
    if (/(pending|unavailable)/.test(s)) return 'status--pending';
    if (/(follow-up|in review|preparing)/.test(s)) return 'status--warn';
    return 'status--info';
  }
  function badge(s) { return '<span class="status ' + statusClass(s) + '">' + s + '</span>'; }

  table('#facilityTable', ['Facility', 'Type', 'Requests', 'Consults', 'Referrals', 'Resp.'],
    (D.facilities || []).map(function (f) {
      return '<tr><td>' + f.name + '</td><td>' + f.type + '</td><td>' + f.requests + '</td><td>' + f.consults + '</td><td>' + f.referrals + '</td><td>' + f.responseMin + ' min</td></tr>';
    }));

  table('#referralTable', ['ID', 'Patient', 'To', 'Priority', 'Status'],
    (D.referrals || []).map(function (r) {
      return '<tr><td>' + r.id + '</td><td>' + r.patient + '</td><td>' + r.to + '</td><td>' + r.priority + '</td><td>' + badge(r.status) + '</td></tr>';
    }));

  table('#prescriptionTable', ['ID', 'Patient', 'Medication', 'Pharmacy', 'Status'],
    (D.prescriptions || []).map(function (p) {
      return '<tr><td>' + p.id + '</td><td>' + p.patient + '</td><td>' + p.medication + '</td><td>' + p.pharmacy + '</td><td>' + badge(p.status) + '</td></tr>';
    }));

  table('#consultTable', ['ID', 'Patient', 'Facility', 'Doctor', 'Mode', 'Reason', 'Status'],
    (D.consultations || []).map(function (c) {
      var mode = c.mode === 'Video' ? '<span class="status status--info">🎥 Video</span>' : c.mode;
      return '<tr><td>' + c.id + '</td><td>' + c.patient + '</td><td>' + c.facility + '</td><td>' + c.doctor + '</td><td>' + mode + '</td><td>' + c.reason + '</td><td>' + badge(c.status) + '</td></tr>';
    }));

  table('#reportingTable', ['Indicator', 'Period', 'Value', 'Ready'],
    (D.reporting || []).map(function (r) {
      return '<tr><td>' + r.indicator + '</td><td>' + r.period + '</td><td>' + r.value + '</td><td>' + badge(r.ready ? 'Ready' : 'Pending') + '</td></tr>';
    }));

  var exportBtn = $('#exportReportBtn');
  if (exportBtn) exportBtn.addEventListener('click', function () {
    var rows = (D.reporting || []).map(function (r) { return [r.indicator, r.period, r.value, r.ready ? 'Ready' : 'Pending'].join(','); });
    var csv = 'Indicator,Period,Value,Status\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'DoctaRx_pilot_aggregate_report_DEMO.csv';
    a.click();
  });

  /* ---------------- Forecast chart (simple SVG line) ---------------- */
  (function () {
    var svg = $('#forecastChart');
    if (!svg || !D.forecast) return;
    var data = D.forecast.feverMalaria, labels = D.forecast.months;
    var W = 320, H = 160, pad = 26;
    var maxV = Math.max.apply(null, data) * 1.1;
    var pts = data.map(function (v, i) {
      var x = pad + i * (W - pad * 2) / (data.length - 1);
      var y = H - pad - (v / maxV) * (H - pad * 2);
      return [x, y];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - pad) + ' L' + pad + ' ' + (H - pad) + ' Z';
    var g = '<defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#3b82f6" stop-opacity="0.30"/><stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs>';
    g += '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="#e2e8f0"/>';
    g += '<path d="' + area + '" fill="url(#fg)"/>';
    g += '<path d="' + line + '" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    pts.forEach(function (p, i) {
      g += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2" fill="#2563eb"/>';
      g += '<text x="' + p[0].toFixed(1) + '" y="' + (H - 8) + '" font-size="9" fill="#64748b" text-anchor="middle">' + labels[i] + '</text>';
    });
    svg.innerHTML = g;
    var note = $('#forecastNote');
    if (note) note.textContent = D.forecast.note;
  })();

  /* ---------------- Roadmap ---------------- */
  var PHASES = [
    { n: 'Phase 1', t: 'Alignment', items: ['Ministry approval', 'Facility selection', 'Indicator agreement', 'Stakeholder workshop', 'Reporting fields agreed'] },
    { n: 'Phase 2', t: 'Configuration', items: ['Set up facilities', 'Set up user roles', 'Video consult workflow', 'Referral workflow', 'Reporting dashboard', 'Test sample cases'] },
    { n: 'Phase 3', t: 'Training', items: ['Train PHC staff', 'Train doctors', 'Train pharmacy / referral users', 'Train dashboard / reporting users'] },
    { n: 'Phase 4', t: 'Controlled Launch', items: ['Begin with selected facilities', 'Track consults, video, referrals, Rx, follow-ups', 'Bi-weekly progress notes'] },
    { n: 'Phase 5', t: 'Evaluation & Scale', items: ['Measure adoption & usage', 'Measure referral completion', 'Measure follow-up & dashboard value', 'Measure reporting readiness', 'Recommend improve or scale'] },
  ];
  var rm = $('#roadmap');
  if (rm) PHASES.forEach(function (p) {
    rm.appendChild(el('div', 'phase',
      '<span class="phase__num">' + p.n + '</span><h3>' + p.t + '</h3><ul>' +
      p.items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>'));
  });

  /* ---------------- FAQ ---------------- */
  var FAQ = [
    ['Does DoctaRx replace hospitals?', 'No. It supports existing facilities by improving coordination and visibility.'],
    ['Does DoctaRx replace doctors?', 'No. It helps doctors reach, document, refer, and follow patients more efficiently.'],
    ['How does video consultation help the pilot?', 'It allows selected PHCs and patients to connect with doctors remotely when appropriate, while keeping PHCs and hospitals part of the care pathway.'],
    ['What does government gain?', 'Better visibility of patient flow, referrals, follow-up, facility response time, video consultation usage, reporting readiness, and public-health trends.'],
    ['What does data forecasting mean here?', 'Simple aggregate trend visibility that can support planning — such as common symptoms, facility load, and medicine demand patterns.'],
    ['Is DoctaRx replacing DHIS2?', 'No. DoctaRx is not replacing government reporting systems. It can support NHMIS/DHIS2-ready aggregate reporting views for easier review.'],
    ['Why start with a pilot?', 'A pilot lets the Ministry test the workflow, measure results, and scale only after evidence.'],
    ['What is the decision needed?', 'Approval to define pilot modalities, select facilities, align indicators, and proceed with technical onboarding.'],
  ];
  var fl = $('#faqList');
  if (fl) FAQ.forEach(function (q) {
    var item = el('div', 'faq__item');
    item.innerHTML = '<button class="faq__q">' + q[0] + '</button><div class="faq__a"><p>' + q[1] + '</p></div>';
    item.querySelector('.faq__q').addEventListener('click', function () { item.classList.toggle('open'); });
    fl.appendChild(item);
  });

  /* ---------------- Supporting materials ---------------- */
  var MATERIALS = [
    { i: '📊', t: 'Presentation Deck', p: 'PowerPoint / PDF — presented live by Jonah Baka.', b: 'Live' },
    { i: '📄', t: 'Proposal Summary', p: 'Pilot scope, actors, indicators, and ask.', b: 'PDF' },
    { i: '🖥️', t: 'Technical Demo', p: 'Live DoctaRx Nigeria portal (demo accounts).', b: 'Link' },
    { i: '🎬', t: 'Pre-Presentation Video', p: 'The explainer above — care journey storyboard.', b: 'MP4' },
    { i: '🗺️', t: 'Pilot Roadmap', p: '5-phase timeline inside a 12-month plan.', b: 'PDF' },
    { i: '📋', t: 'Reporting Readiness Brief', p: 'NHMIS/DHIS2-oriented aggregate views.', b: 'PDF' },
  ];
  var mat = $('#materialsGrid');
  if (mat) MATERIALS.forEach(function (x) {
    mat.appendChild(el('div', 'material',
      '<div class="material__icon">' + x.i + '</div><div><span class="badge">' + x.b + '</span><h3>' + x.t + '</h3><p>' + x.p + '</p></div>'));
  });

  /* =====================================================================
     FLICKER-FREE, SCENE-BASED CAPTION ENGINE  (fixes bug #2)
     - Captions are driven by SCENE index, not by every timeupdate frame.
     - The DOM only updates when the scene index actually changes.
     - A single short, finite fade is applied on change (no infinite loops).
     - timeupdate is throttled; when no rendered video exists it auto-advances.
     ===================================================================== */
  var SCENES = [
    { t: 0, scene: 'Scene 1 — The patient journey begins', text: 'Across Abuja, patients begin their care journey at a Primary Healthcare Centre. DoctaRx is designed to connect that journey — from first request to follow-up.' },
    { t: 7, scene: 'Scene 2 — PHC intake', text: 'At the PHC, Nurse Grace records a simple intake for Amina. The patient is never bypassed — the PHC stays at the centre of care.' },
    { t: 14, scene: 'Scene 3 — Video consultation', text: 'When appropriate, Amina connects with Dr. Musa through a supported video consultation. The PHC officer can assist if needed.' },
    { t: 22, scene: 'Scene 4 — Doctor notes & decision', text: 'The doctor reviews the patient summary, documents notes, and decides on the next step — a prescription or a referral.' },
    { t: 30, scene: 'Scene 5 — Pharmacy visibility', text: 'Pharmacist Ada sees the prescription request and can confirm medicine availability — helping patients, doctors, and pharmacies coordinate.' },
    { t: 38, scene: 'Scene 6 — Referral follow-up', text: 'When a referral is needed, Mr. Bello at the General Hospital receives the summary, and the referral status is tracked to completion.' },
    { t: 46, scene: 'Scene 7 — Ministry dashboard', text: 'A Ministry official sees aggregate activity — requests, consultations, referrals, and follow-up — without exposing private patient details.' },
    { t: 54, scene: 'Scene 8 — Forecasting preview', text: 'Simple trend views show common symptoms and seasonal patterns, supporting planning for staffing and medicine supply.' },
    { t: 61, scene: 'Scene 9 — NHMIS/DHIS2-ready reporting', text: 'Activity is organised into aggregate, NHMIS/DHIS2-ready reporting views — supporting reporting readiness, not replacing government systems.' },
    { t: 68, scene: 'Scene 10 — The pilot roadmap', text: 'This is the care journey DoctaRx proposes to strengthen through a small, measurable Abuja pilot.' },
    { t: 73, scene: 'Handover to Jonah Baka', text: 'Jonah Baka will now present the pilot roadmap and partnership details.' },
  ];

  var sceneEl = $('#captionScene');
  var textEl = $('#captionText');
  var captionBox = sceneEl ? sceneEl.closest('.caption') : null;
  var video = $('#introVideo');
  var currentScene = -1;

  function applyScene(i) {
    if (i === currentScene || !sceneEl || !textEl) return;
    currentScene = i;
    var s = SCENES[i];
    // finite fade-out, swap text, fade-in — no looping animation
    if (captionBox) captionBox.classList.add('caption--changing');
    window.setTimeout(function () {
      sceneEl.textContent = s.scene;
      textEl.textContent = s.text;
      if (captionBox) captionBox.classList.remove('caption--changing');
    }, 180);
  }

  function sceneIndexForTime(t) {
    var idx = 0;
    for (var i = 0; i < SCENES.length; i++) { if (t >= SCENES[i].t) idx = i; }
    return idx;
  }

  // Throttle timeupdate to ~4 checks/sec and only touch DOM on scene change.
  var lastCheck = 0;
  function onTimeUpdate() {
    var now = Date.now();
    if (now - lastCheck < 250) return;
    lastCheck = now;
    applyScene(sceneIndexForTime(video.currentTime));
  }

  applyScene(0); // stable initial caption

  // Detect whether a rendered video actually loaded; if not, run a gentle
  // auto-advancing storyboard so the caption area is never empty/awkward.
  var hasVideo = false;
  var fallback = $('#videoFallback');
  var storyboardTimer = null;

  function startStoryboard() {
    if (storyboardTimer) return;
    var i = 0;
    storyboardTimer = window.setInterval(function () {
      i = (i + 1) % SCENES.length;
      applyScene(i);
    }, 6000); // calm, slow, stable cadence
  }
  function stopStoryboard() {
    if (storyboardTimer) { window.clearInterval(storyboardTimer); storyboardTimer = null; }
  }

  if (video) {
    video.addEventListener('loadeddata', function () {
      hasVideo = true;
      if (fallback) fallback.style.display = 'none';
      stopStoryboard();
    });
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', function () { if (hasVideo) stopStoryboard(); });
    video.addEventListener('error', startStoryboard);
    // If metadata never loads (no rendered file yet), fall back to storyboard.
    window.setTimeout(function () { if (!hasVideo) startStoryboard(); }, 2500);
  } else {
    startStoryboard();
  }

  /* ---------------- Replay / open buttons ---------------- */
  var replay = $('#replayBtn');
  if (replay) replay.addEventListener('click', function () {
    if (video && hasVideo) { video.currentTime = 0; video.play(); }
    else { currentScene = -1; applyScene(0); }
  });

  // Reflect demo label in console for transparency
  if (D.label) console.info('DoctaRx microsite —', D.label);
})();
