import Link from 'next/link';
import { ArrowUpRight, Building2, Globe2, Network, Users } from 'lucide-react';
import GrowthShell, { primaryLink, secondaryLink } from '@/components/growth/GrowthShell';
import PublicShare from '@/components/growth/PublicShare';
import { publicMetadata } from '@/lib/seo/metadata.cjs';

const title = 'Care access partnerships with DoctaRx';
const description = 'Explore a DoctaRx pilot for clinics, provider networks, employers and local care organizations. Define the workflow, clinical ownership and measures of success together.';
export const metadata = publicMetadata({ title, description, path: '/partners' });
const partners = [
  [Building2, 'Clinics & provider groups', 'Evaluate a specific appointment, visit or follow-up workflow with the team that delivers care.'],
  [Users, 'Employers & communities', 'Discuss a defined care-access need, the eligible population and the local providers required to support it.'],
  [Network, 'Care delivery partners', 'Explore how pharmacy, referral and care coordination workflows could fit your existing operations.'],
  [Globe2, 'Local market partners', 'Bring knowledge of local clinical practice, language, licensing, infrastructure and patient expectations.'],
];

export default function PartnersPage() {
  return <GrowthShell title={title} description={description} path="/partners" eyebrow="Partnerships & international enquiries">
    <section className="max-w-4xl pb-14 pt-5 md:pb-20"><h1 className="text-4xl font-bold leading-tight tracking-tight md:text-6xl">Build the next connection in care.</h1><p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">Bring a local care problem. We can explore a focused pilot with your clinicians, organization or network—and agree on what a useful result would look like.</p><div className="mt-8 flex flex-wrap gap-3"><Link href="/contact" className={primaryLink}>Start a partnership conversation <ArrowUpRight size={18} aria-hidden="true" /></Link><Link href="#pilot" className={secondaryLink}>See the pilot approach</Link></div><p className="mt-4 text-sm leading-6 text-muted-foreground">International enquiries are welcome. An enquiry does not mean a clinical service is available in that country.</p></section>
    <section aria-labelledby="partner-types"><h2 id="partner-types" className="text-3xl font-bold">Different organizations. A shared care journey.</h2><div className="mt-7 grid gap-5 sm:grid-cols-2">{partners.map(([Icon, heading, text]) => <article key={heading} className="rounded-2xl border border-border p-6 md:p-8"><Icon aria-hidden="true" size={26} className="text-primary" /><h3 className="mt-5 text-xl font-semibold">{heading}</h3><p className="mt-3 leading-7 text-muted-foreground">{text}</p></article>)}</div></section>
    <section id="pilot" aria-labelledby="partner-pilot" className="my-14 scroll-mt-8 rounded-3xl bg-muted/40 p-6 md:p-10"><h2 id="partner-pilot" className="text-3xl font-bold">One workflow. An accountable pilot.</h2><ol className="mt-8 grid gap-7 md:grid-cols-3">{[
      ['01', 'Define the starting point', 'Choose a care-access or administrative workflow, a named local owner and the people who will use it. Establish a baseline before promising improvement.'],
      ['02', 'Prepare the operating model', 'Agree on clinical responsibility, provider eligibility, consent, privacy, support and market-specific requirements. Use fictional data for initial evaluation.'],
      ['03', 'Measure before expanding', 'Compare agreed measures such as successful bookings, attendance, follow-up completion and staff effort. Expand only after the team reviews the results.'],
    ].map(([number, heading, text]) => <li key={number}><p className="text-sm font-bold text-foreground" aria-hidden="true">{number}</p><h3 className="mt-3 text-xl font-semibold">{heading}</h3><p className="mt-3 leading-7 text-muted-foreground">{text}</p></li>)}</ol></section>
    <section aria-labelledby="partner-brief" className="mb-14 grid gap-8 md:grid-cols-2"><div><h2 id="partner-brief" className="text-3xl font-bold">Tell us where the work starts.</h2><p className="mt-4 leading-7 text-muted-foreground">Use the existing contact form and select “Partnership Opportunity.” Include these details so the conversation can start with a concrete use case.</p><Link href="/contact" className={primaryLink + ' mt-6'}>Send a partnership enquiry</Link></div><div className="rounded-2xl border border-border p-6"><ul className="list-disc space-y-3 pl-5 leading-7"><li>Your organization, country and city.</li><li>The workflow you want to improve.</li><li>The team and population you expect to support.</li><li>Your proposed clinical or operational owner.</li><li>What success would look like and your timeframe.</li></ul><p className="mt-5 text-sm leading-6 text-muted-foreground">Send business contact information only. Do not include patient records, clinical histories or credential documents in a partnership enquiry.</p></div></section>
    <section aria-labelledby="partner-languages" className="mb-14"><h2 id="partner-languages" className="text-2xl font-semibold">An introduction your team can read and share.</h2><p className="mt-3 max-w-3xl leading-7 text-muted-foreground">Public introductions are available in English, Spanish, French, Portuguese and Arabic. Translated information does not imply clinical availability or validated voice performance in that language.</p><Link href="/international" className="mt-4 inline-block py-2 font-semibold text-primary underline underline-offset-4">Choose a language and explore current market information</Link></section>
    <PublicShare destination="partners" heading="Bring a local partner into the conversation." />
  </GrowthShell>;
}
