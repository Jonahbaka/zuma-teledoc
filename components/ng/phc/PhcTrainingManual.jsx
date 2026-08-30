'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Info,
  ShieldCheck,
  Stethoscope,
  UserRound,
  Video,
  WifiOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ROLE_COPY = {
  phc_nurse: {
    label: 'PHC nurse',
    summary: 'Prepare the patient, record a complete intake, and hand off a safe, readable case.',
    steps: ['Confirm the patient and consent', 'Record the complaint and observations', 'Review the queue handoff before dispatch'],
  },
  remote_clinician: {
    label: 'remote clinician',
    summary: 'Claim the right case, consult with context, sign the core note, and close the loop.',
    steps: ['Review the assigned queue item', 'Conduct the consultation and document the plan', 'Sign the core note before completion or referral'],
  },
  clinical_supervisor: {
    label: 'clinical supervisor',
    summary: 'Coach safe clinical documentation and verify that supervised practice is complete.',
    steps: ['Observe the workflow', 'Use teach-back to check understanding', 'Record the learner outcome in the local training log'],
  },
  facility_admin: {
    label: 'facility administrator',
    summary: 'Coordinate orientation, access, and completion evidence for your facility team.',
    steps: ['Confirm the correct programme and facility', 'Assign a qualified assessor', 'Review completion evidence without opening unnecessary PHI'],
  },
  programme_admin: {
    label: 'programme administrator',
    summary: 'Keep programme onboarding consistent and review readiness at aggregate level.',
    steps: ['Confirm role and scope', 'Schedule supervised practice', 'Review readiness trends and follow up gaps'],
  },
};

const CHECKS = [
  'I can select the correct programme and facility context before opening a patient record.',
  'I can explain consent, privacy, and the minimum necessary rule to a patient or colleague.',
  'I can record observations with the correct unit and recognise when a value needs re-checking.',
  'I can hand off or claim a queue item without bypassing assignment or role controls.',
  'I know that a clinician must sign the core note before an encounter is completed.',
  'I can create a follow-up or referral and state who owns the next action.',
  'I can use offline capture safely and sync only after confirming the device and context.',
];

function RolePath({ role }) {
  const copy = ROLE_COPY[role] || ROLE_COPY.remote_clinician;
  return (
    <Card className="border-emerald-200 bg-emerald-50/70">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          <CardTitle className="text-lg">Your supervised pathway: {copy.label}</CardTitle>
        </div>
        <CardDescription className="text-emerald-950/80">{copy.summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 md:grid-cols-3">
          {copy.steps.map((step, index) => (
            <li key={step} className="flex gap-3 rounded-xl border border-emerald-200 bg-white p-3 text-sm text-slate-800">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export default function PhcTrainingManual({ programmeRole, standalone = false }) {
  const [checked, setChecked] = useState(() => new Set());
  const completed = checked.size;
  const progress = Math.round((completed / CHECKS.length) * 100);
  const roleCopy = useMemo(() => ROLE_COPY[programmeRole] || ROLE_COPY.remote_clinician, [programmeRole]);

  function toggleCheck(index) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <main className={standalone ? 'min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8' : ''}>
      <div className="mx-auto max-w-[1480px] space-y-6">
        <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-950 via-teal-900 to-slate-900 p-6 text-white shadow-lg sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Badge className="border-emerald-300/30 bg-emerald-400/15 text-emerald-100">Training & assessment</Badge>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">PHC field guide for nurses and doctors</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50/85 sm:text-base">
                A practical, teach-back friendly guide for the DoctaRx Nigeria PHC workspace. Use it during orientation, supervised practice, and refresher training. It supports local clinical SOPs; it never replaces them.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs text-emerald-100/90">
                <span className="rounded-full border border-white/15 px-3 py-1">Current role: {roleCopy.label}</span>
                <span className="rounded-full border border-white/15 px-3 py-1">No real patient data in training</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => window.print()} className="gap-2">
                <BookOpenCheck className="h-4 w-4" aria-hidden="true" /> Print / save guide
              </Button>
              {standalone && (
                <a href="/ng/phc" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/25 px-4 text-sm font-semibold text-white hover:bg-white/10">
                  Return to workspace <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Workflow demonstrations">
          <Card className="overflow-hidden">
            <Image src="/images/training/phc-scope-consent.png" alt="Nurse confirming programme scope, patient identity, and consent before opening a record" width={1536} height={1024} className="h-48 w-full object-cover" />
            <CardHeader className="pb-3"><CardTitle className="text-base">Start with scope and consent</CardTitle><CardDescription>Confirm the programme, facility, identity, and consent before opening a record.</CardDescription></CardHeader>
          </Card>
          <Card className="overflow-hidden">
            <Image src="/images/training/phc-nurse-intake.png" alt="Nurse recording a patient's intake and blood pressure in a primary care clinic" width={1536} height={1024} className="h-48 w-full object-cover" priority />
            <CardHeader className="pb-3"><CardTitle className="text-base">1. Intake with dignity</CardTitle><CardDescription>Confirm identity, consent, complaint, and observations before handoff.</CardDescription></CardHeader>
          </Card>
          <Card className="overflow-hidden">
            <Image src="/images/training/phc-nurse-handoff.png" alt="Nurse completing a structured intake and handing a case to a clinician queue" width={1536} height={1024} className="h-48 w-full object-cover" />
            <CardHeader className="pb-3"><CardTitle className="text-base">Handoff with context</CardTitle><CardDescription>Use the structured queue so the next clinician knows what needs attention.</CardDescription></CardHeader>
          </Card>
          <Card className="overflow-hidden">
            <Image src="/images/training/phc-remote-consult.png" alt="Doctor conducting a remote consultation with a nurse and patient" width={1536} height={1024} className="h-48 w-full object-cover" />
            <CardHeader className="pb-3"><CardTitle className="text-base">2. Consult with context</CardTitle><CardDescription>Assigned clinicians review the queue, consult, document, and sign.</CardDescription></CardHeader>
          </Card>
          <Card className="overflow-hidden">
            <Image src="/images/training/phc-followup-referral.png" alt="Care team arranging a follow-up and referral and receiving an outcome" width={1536} height={1024} className="h-48 w-full object-cover" />
            <CardHeader className="pb-3"><CardTitle className="text-base">Close the loop</CardTitle><CardDescription>Make the next owner visible through a follow-up or referral outcome.</CardDescription></CardHeader>
          </Card>
          <Card className="overflow-hidden">
            <Image src="/images/training/phc-offline-sync.png" alt="Secure tablet records synchronising to a locked clinical server" width={1536} height={1024} className="h-48 w-full object-cover" />
            <CardHeader className="pb-3"><CardTitle className="text-base">3. Sync safely</CardTitle><CardDescription>Offline records stay encrypted and are synced only to the correct scope.</CardDescription></CardHeader>
          </Card>
          <Card className="overflow-hidden">
            <Image src="/images/training/phc-escalation.png" alt="Clinicians recognising a danger sign and escalating through a facility pathway" width={1536} height={1024} className="h-48 w-full object-cover" />
            <CardHeader className="pb-3"><CardTitle className="text-base">Escalate early</CardTitle><CardDescription>Use local emergency and safeguarding pathways when danger signs appear.</CardDescription></CardHeader>
          </Card>
          <Card className="overflow-hidden">
            <Image src="/images/training/phc-assessment.png" alt="Clinical supervisor guiding a nurse and doctor through a privacy-safe teach-back assessment" width={1536} height={1024} className="h-48 w-full object-cover" />
            <CardHeader className="pb-3"><CardTitle className="text-base">Assess with teach-back</CardTitle><CardDescription>Supervisors observe, ask the learner to explain, and record the official result locally.</CardDescription></CardHeader>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-emerald-700" aria-hidden="true" /> The five-minute safe start</CardTitle>
                <CardDescription>Use this sequence at the beginning of every supervised practice case.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['Confirm scope', 'Read the programme and facility badge. Do not work from a copied or shared account.'],
                    ['Confirm the person', 'Use the minimum necessary identifiers, confirm consent, and protect the conversation.'],
                    ['Capture clearly', 'Record observations with units, re-check surprising values, and avoid unnecessary free text.'],
                    ['Close the loop', 'Assign or claim the queue item, sign the core note, and name the next action.'],
                    ['Escalate early', 'Use the local emergency pathway for danger signs; the workspace is not an emergency service.'],
                  ].map(([title, body], index) => (
                    <li key={title} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{index + 1}</span>
                      <div><p className="font-semibold">{title}</p><p className="mt-1 text-sm leading-5 text-slate-600">{body}</p></div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
            <RolePath role={programmeRole} />
          </div>

          <Card className="border-slate-300">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" /> Teach-back checklist</CardTitle>
                  <CardDescription>Complete with a qualified assessor. This checklist is local to this browser and contains no PHI.</CardDescription>
                </div>
                <Badge variant={progress === 100 ? 'success' : 'secondary'}>{progress}%</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {CHECKS.map((label, index) => (
                <label key={label} className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 text-sm leading-5 hover:bg-slate-50">
                  <input type="checkbox" checked={checked.has(index)} onChange={() => toggleCheck(index)} className="mt-1 h-4 w-4 accent-emerald-700" />
                  <span className={checked.has(index) ? 'text-slate-500 line-through' : 'text-slate-800'}>{label}</span>
                </label>
              ))}
              <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950">
                <p className="font-semibold">Assessor handoff</p>
                <p className="mt-1 leading-5">When the learner can explain each item, the supervisor or facility training lead records the outcome in the approved local training register. Never type a patient name or identifier into this checklist.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card><CardContent className="pt-6"><ShieldCheck className="h-6 w-6 text-emerald-700" aria-hidden="true" /><h3 className="mt-3 font-semibold">Privacy first</h3><p className="mt-1 text-sm leading-5 text-slate-600">Use your own login, stay inside your assigned scope, and use break-glass only for a documented emergency.</p></CardContent></Card>
          <Card><CardContent className="pt-6"><Video className="h-6 w-6 text-blue-700" aria-hidden="true" /><h3 className="mt-3 font-semibold">Human sign-off</h3><p className="mt-1 text-sm leading-5 text-slate-600">AI suggestions are optional and review-only. A qualified clinician owns the final assessment, note, and plan.</p></CardContent></Card>
          <Card><CardContent className="pt-6"><WifiOff className="h-6 w-6 text-amber-700" aria-hidden="true" /><h3 className="mt-3 font-semibold">Offline means queued</h3><p className="mt-1 text-sm leading-5 text-slate-600">If offline, keep the device secure, finish the minimum necessary record, and sync when the correct facility context returns.</p></CardContent></Card>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <p className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>For emergencies, safeguarding concerns, or local clinical policy questions, follow your facility escalation process.</span></p>
          {standalone && <a className="inline-flex items-center gap-1 font-semibold underline" href="/ng/phc">Open PHC workspace <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>}
        </div>
      </div>
    </main>
  );
}
