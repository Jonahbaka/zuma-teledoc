import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ArrowUpRight, CalendarDays, ClipboardList, MessagesSquare, Video } from 'lucide-react';
import GrowthShell, { primaryLink, secondaryLink } from '@/components/growth/GrowthShell';
import PublicShare from '@/components/growth/PublicShare';
import WorkflowPlanner from '@/components/growth/WorkflowPlanner';
import { publicMetadata } from '@/lib/seo/metadata.cjs';

const title = 'Connected virtual care for providers';
const description = 'Explore DoctaRx appointment, video, messaging and care coordination workflows. Start provider onboarding or discuss a focused pilot for your clinic.';
export const metadata = publicMetadata({ title, description, path: '/for-providers' });
const careStory = [
  { image: '/marketing/doctarx/virtual-care-hero-v1.webp', alt: 'Illustrative clinician preparing for a virtual visit at her laptop.', width: 1536, height: 1024, label: 'Before the visit', title: 'A clear place to start.', text: 'Manage appointments and give patients a place to return for their visit and follow-up.', detail: 'Appointments & patient messaging' },
  { image: '/marketing/doctarx/connected-care-v1.webp', alt: 'Illustrative patient talking with her care team from home on a laptop.', width: 1280, height: 853, label: 'During the visit', title: 'People at the centre.', text: 'Connect over video with microphone and camera controls, reconnect handling and supported multi-person sessions.', detail: 'Video & shared conversations' },
  { image: '/marketing/doctarx/clinical-team-v1.webp', alt: 'Illustrative care team reviewing a tablet together in a clinic.', width: 1280, height: 853, label: 'After the visit', title: 'Keep the next step connected.', text: 'Coordinate records, prescriptions and referral workflows where available for your market, role and organization.', detail: 'Records & care coordination' },
];
const workflow = [
  { icon: CalendarDays, label: 'Book the appointment' },
  { icon: Video, label: 'Connect for the visit' },
  { icon: ClipboardList, label: 'Document the care plan' },
  { icon: MessagesSquare, label: 'Coordinate the next step' },
];

export default function ProvidersPage() {
  return <GrowthShell title={title} description={description} path="/for-providers" eyebrow="For clinicians & clinic teams">
    <section className="grid gap-7 pb-12 pt-5 md:grid-cols-2 md:gap-x-10 md:gap-y-6 md:pb-16 lg:gap-x-14">
      <div className="md:col-start-1 md:row-start-1 md:self-end">
        <h1 className="max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">Give every visit a clearer path forward.</h1>
      </div>
      <figure className="relative mb-6 min-w-0 md:col-start-2 md:row-span-2 md:row-start-1 md:self-center">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-muted md:aspect-[4/5]">
          <Image src="/marketing/doctarx/virtual-care-hero-v1.webp" alt="Illustrative clinician listening during a virtual appointment at her laptop." fill priority sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1152px) 46vw, 520px" className="object-cover object-[53%_center]" />
        </div>
        <figcaption className="absolute -bottom-6 left-4 right-4 rounded-2xl border border-border bg-background p-4 shadow-lg sm:left-6 sm:right-6 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground"><Video size={22} aria-hidden="true" /></span>
            <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Illustrative workflow</p><p className="mt-1 text-sm font-semibold sm:text-base">One visit. A connected care journey.</p></div>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-xs font-medium text-muted-foreground sm:text-sm"><span>Appointment</span><ArrowRight size={13} aria-hidden="true" /><span>Visit</span><ArrowRight size={13} aria-hidden="true" /><span>Follow-up</span></p>
        </figcaption>
      </figure>
      <div className="md:col-start-1 md:row-start-2">
        <p className="max-w-2xl text-lg leading-8 text-muted-foreground">Appointments, video, messaging and care coordination in one connected platform. Explore a focused DoctaRx workflow with your team, then measure what changes.</p>
        <div className="mt-7 flex flex-wrap gap-3"><Link href="#join" className={primaryLink}>Start provider onboarding <ArrowUpRight size={18} aria-hidden="true" /></Link><Link href="/contact" className={secondaryLink}>Discuss a clinic pilot</Link></div>
        <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">Provider activation requires credential review. Features and care availability depend on your location, role and configuration.</p>
      </div>
    </section>
    <section aria-labelledby="provider-workflow" className="border-y border-border py-7 md:py-9">
        <h2 id="provider-workflow" className="text-sm font-bold uppercase tracking-widest text-foreground">A connected workflow</h2>
        <ol className="mt-6 grid grid-cols-2 gap-x-6 gap-y-7 md:grid-cols-4">
          {workflow.map(({ icon: Icon, label }, index) => <li key={label} className="relative"><div className="mb-3 flex items-center gap-3"><Icon size={21} className="text-primary" aria-hidden="true" /><span className="text-xs font-semibold text-muted-foreground" aria-hidden="true">0{index + 1}</span>{index < workflow.length - 1 && <ArrowRight className="ml-auto hidden text-muted-foreground md:block" size={17} aria-hidden="true" />}</div><p className="max-w-40 text-sm font-semibold leading-6 sm:text-base">{label}</p></li>)}
        </ol>
        <p className="mt-6 max-w-3xl text-sm leading-6 text-muted-foreground">Choose a workflow with your team. Review local requirements and service availability before using it for patient care.</p>
    </section>
    <section aria-labelledby="provider-capabilities" className="py-14 md:py-20"><div className="flex flex-wrap items-end justify-between gap-5"><h2 id="provider-capabilities" className="max-w-xl text-3xl font-bold leading-tight md:text-4xl">Built around the people<br className="hidden sm:block" /> behind every visit.</h2><p className="max-w-sm leading-7 text-muted-foreground">Support the conversation, the care team and the next step—with access tied to the care relationship.</p></div><div className="mt-8 grid gap-9 md:grid-cols-3 md:gap-6">
      {careStory.map(({ image, alt, width, height, label, title: heading, text, detail }) => <article key={heading}><div className="overflow-hidden rounded-2xl bg-muted"><Image src={image} alt={alt} width={width} height={height} sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1152px) 30vw, 340px" className="aspect-[4/3] w-full object-cover" /></div><div className="pt-5"><p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</p><h3 className="mt-2 text-2xl font-semibold leading-tight">{heading}</h3><p className="mt-3 leading-7 text-muted-foreground">{text}</p><p className="mt-4 border-t border-border pt-4 text-sm font-semibold">{detail}</p></div></article>)}
    </div></section>
    <section aria-labelledby="provider-voice" className="mt-10 rounded-2xl border border-border p-6 md:p-8"><h2 id="provider-voice" className="text-2xl font-semibold">Live voice, with a practical path to evaluation.</h2><p className="mt-3 max-w-4xl leading-7 text-muted-foreground">DoctaRx includes live voice with speech-to-text and text-to-speech fallback paths. Clinical use requires validation of the selected provider connection, language, consent and encounter access. Start an evaluation with fictional scenarios; your care team remains responsible for clinical decisions.</p><Link href="/contact" className="mt-4 inline-block py-2 font-semibold text-primary underline underline-offset-4">Discuss a voice evaluation</Link></section>
    <WorkflowPlanner />
    <section id="join" aria-labelledby="provider-join" className="mb-14 scroll-mt-8"><h2 id="provider-join" className="text-3xl font-bold">Start with the right onboarding path.</h2><p className="mt-4 max-w-3xl leading-7 text-muted-foreground">Create an account for the relevant market, submit your credentials and complete the applicable activation steps. Registration does not authorize practice across borders.</p><div className="mt-6 flex flex-wrap gap-3"><Link href="/provider/register" className={primaryLink}>US provider registration</Link><Link href="/ng/provider/register" className={secondaryLink}>Nigeria provider registration</Link><Link href="/partners" className={secondaryLink}>Other countries &amp; organizations</Link></div><p className="mt-5 text-sm"><Link href="/provider/login" className="underline underline-offset-4">Already registered? Provider sign in</Link></p></section>
    <PublicShare destination="providers" />
  </GrowthShell>;
}
