import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BatteryCharging,
  CalendarCheck,
  ClipboardList,
  Cpu,
  FileText,
  ShieldAlert,
  Signal,
  Users,
} from 'lucide-react';

export const metadata = {
  title: 'FCT PHCB Facility Assessment | DoctaRx Nigeria',
  description:
    'DoctaRx and the FCT Primary Health Care Board assessed telemedicine readiness at four primary health '
    + 'care facilities in the Abuja Municipal Area Council. This page summarises the published assessment '
    + 'findings. It does not announce a pilot, an approval, or a deployment.',
};

const ASSESSMENT = {
  meetingDate: '27 August 2026',
  reportDate: '21 September 2026',
  scope: 'Four primary health care facilities in the Abuja Municipal Area Council, Abuja FCT',
  facilities: [
    {
      name: 'Garki Village PHC',
      readiness: 'Highest',
      finding:
        'Approximately 20 hours of grid power daily, an existing tablet and computer, and 19 staff — the '
        + 'strongest starting position of the four.',
      priorities: 'Backup power, security monitoring, workstation readiness, staff training',
    },
    {
      name: 'Gwagwa PHC',
      readiness: 'Moderate',
      finding:
        '19 staff across nine service delivery points, some personnel with basic computer skills, and '
        + 'health workers willing to adopt telemedicine.',
      priorities: 'Reliable backup power, perimeter fencing, practical training, supportive supervision',
    },
    {
      name: 'Karmo Sabo PHC',
      readiness: 'Low',
      finding:
        'About five hours of grid power daily with no alternative power source, three permanent staff and '
        + '10 volunteers, and no existing EMR or telemedicine tools.',
      priorities: 'Backup power, staffing support, workstation preparation, training',
    },
    {
      name: 'Pyakasa PHC',
      readiness: 'Lowest',
      finding:
        'About three hours of grid power daily, inadequate security arrangements, and no available '
        + 'internal space for the proposed work.',
      priorities: 'Backup power, stronger security, an external container workstation, staff training',
    },
  ],
};

const CROSS_CUTTING = [
  {
    icon: BatteryCharging,
    title: 'Power supply',
    body: 'Availability varies widely between the four facilities. Reliable alternative power is needed '
      + 'before technology-dependent services can run continuously.',
  },
  {
    icon: ShieldAlert,
    title: 'Infrastructure and security',
    body: 'Perimeter fencing and general security were identified as gaps at some facilities, with '
      + 'security monitoring and suitable workspace required where equipment will be deployed.',
  },
  {
    icon: Signal,
    title: 'Connectivity and equipment',
    body: 'Internet connectivity and essential digital equipment should be verified at each facility '
      + 'before any deployment.',
  },
  {
    icon: Users,
    title: 'Staff capacity',
    body: 'Training is required so healthcare workers can operate the tools, follow digital workflows, '
      + 'document encounters, protect patient information, and troubleshoot basic issues.',
  },
];

export default function FctPhcbAssessmentPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="relative overflow-hidden border-b border-slate-200 bg-slate-950">
        <picture>
          <source srcSet="/media/ng/fct-assessment-hero.webp" type="image/webp" />
          <img
            src="/media/ng/fct-assessment-hero.png"
            alt=""
            width={1600}
            height={900}
            className="absolute inset-0 h-full w-full object-cover opacity-45"
            aria-hidden="true"
          />
        </picture>
        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
          <Badge className="border-amber-300/40 bg-amber-400/15 text-amber-100">
            Assessment findings — not a pilot announcement
          </Badge>
          <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            DoctaRx and the FCT Primary Health Care Board assessed four primary health care facilities
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200">
            On {ASSESSMENT.meetingDate}, the DoctaRx team met the FCT Primary Health Care Board technical
            team under the oversight of the Director, Planning, Research and Statistics. Following that
            discussion, DoctaRx and FCT PHCB staff carried out a two-day assessment of telemedicine tools
            and readiness at {ASSESSMENT.scope}.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            The assessment looked at facility readiness, infrastructure, human resources, power supply,
            service delivery points, existing digital and telemedicine resources, and security. This page
            summarises those published findings. The way forward is for DoctaRx and FCT PHCB to discuss and
            determine jointly.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl space-y-10 px-4 py-12 sm:px-6 lg:px-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-emerald-700" aria-hidden="true" />
              What the assessment covered
            </CardTitle>
            <CardDescription>
              The assessment was carried out by two teams of two assessors using interviews, direct
              observation, and a structured facility checklist.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
              {[
                'General readiness of each facility for telemedicine implementation',
                'Availability and reliability of electricity and alternative power',
                'Availability and composition of human resources',
                'Availability and functionality of service delivery points',
                'Existing electronic medical record and telemedicine equipment',
                'Digital literacy and readiness of healthcare workers',
                'Infrastructure, security, and other implementation gaps',
                'Findings and recommendations for addressing those gaps',
              ].map((objective) => (
                <li key={objective} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                  <span>{objective}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <section aria-labelledby="facility-readiness">
          <h2 id="facility-readiness" className="text-2xl font-semibold tracking-tight">
            Readiness observed at each facility
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Readiness levels and findings below are taken from the assessment report dated{' '}
            {ASSESSMENT.reportDate}. They describe the situation observed during the assessment, not a
            service level that has been agreed or delivered.
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Observed telemedicine readiness, supporting findings, and immediate priorities for the four
                assessed primary health care facilities
              </caption>
              <thead>
                <tr className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-3 pr-4 font-semibold">Facility</th>
                  <th scope="col" className="py-3 pr-4 font-semibold">Readiness</th>
                  <th scope="col" className="py-3 pr-4 font-semibold">Supporting findings</th>
                  <th scope="col" className="py-3 font-semibold">Immediate priorities</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {ASSESSMENT.facilities.map((facility) => (
                  <tr key={facility.name} className="align-top">
                    <th scope="row" className="py-4 pr-4 font-semibold text-slate-900">
                      {facility.name}
                    </th>
                    <td className="py-4 pr-4">
                      <Badge
                        variant="outline"
                        className={
                          facility.readiness === 'Highest'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : facility.readiness === 'Moderate'
                              ? 'border-amber-300 bg-amber-50 text-amber-800'
                              : 'border-rose-300 bg-rose-50 text-rose-800'
                        }
                      >
                        {facility.readiness}
                      </Badge>
                    </td>
                    <td className="py-4 pr-4 text-slate-700">{facility.finding}</td>
                    <td className="py-4 text-slate-700">{facility.priorities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Needs that cut across all four facilities</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              The assessment recorded several shared constraints. Addressing them is prerequisite work for
              any later technology deployment.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {CROSS_CUTTING.map((item) => (
              <Card key={item.title}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <item.icon className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                    {item.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-slate-700">{item.body}</CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
        <Card className="border-slate-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-emerald-700" aria-hidden="true" />
              Software DoctaRx is preparing
            </CardTitle>
            <CardDescription>
              These are product capabilities under development and verification. They are not services
              running at the four facilities, and they are not a statement about patient outcomes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
              {[
                'Nurse-assisted registration with identity matching, consent capture, and duplicate review',
                'Queue, vitals, and structured intake that keeps working through power and network interruptions',
                'Remote consultation with visible connection state and an audio or rescheduling fallback',
                'Longitudinal records with encounter ownership, sign-off, and amendments that never overwrite signed text',
                'Referral and escalation with an append-only status history for every handoff',
                'Aggregate programme reporting for national reporting systems, with no patient identifiers',
              ].map((capability) => (
                <li key={capability} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                  <span>{capability}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-amber-300 bg-amber-50/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <CalendarCheck className="h-5 w-5" aria-hidden="true" />
              What happens next
            </CardTitle>
            <CardDescription className="text-amber-900/80">
              The assessment report states that the way forward should be jointly discussed and determined
              by DoctaRx and FCT PHCB.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-amber-950">
            <p>Subject to that joint discussion, readiness work would include:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Confirming power, connectivity, security, and workspace arrangements per facility</li>
              <li>Hands-on training in digital documentation, data protection, and referral pathways</li>
              <li>Agreeing monitoring indicators for utilisation, functionality, uptake, and service quality</li>
              <li>Agreeing reporting arrangements and any approvals required before data sharing</li>
            </ul>
            <p className="font-medium">
              No pilot has been launched, no deployment has been approved, and no 12-month pilot has been
              executed. Any future arrangement would depend on decisions by DoctaRx and FCT PHCB.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-300 bg-slate-50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-slate-700" aria-hidden="true" />
              About this update
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-6 text-slate-700">
            <p>
              This page summarises a joint facility assessment. It is a draft prepared for review, and any
              statement attributed to the FCT Primary Health Care Board will only be published once the
              appropriate organisational approval is in place.
            </p>
            <p>
              No individual patient or staff member is named here. Facility observations are summarised
              from the assessment report rather than quoted verbatim.
            </p>
            <p className="flex flex-wrap gap-3 pt-1">
              <Link
                href="/ng"
                className="inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                DoctaRx Nigeria
              </Link>
              <Link
                href="/ng/phc/training"
                className="inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                PHC field guide
              </Link>
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
