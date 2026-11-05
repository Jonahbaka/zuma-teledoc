import Link from 'next/link';
import { ArrowUpRight, CalendarDays, ClipboardList, MessagesSquare, Video } from 'lucide-react';
import GrowthShell, { primaryLink, secondaryLink } from '@/components/growth/GrowthShell';
import PublicShare from '@/components/growth/PublicShare';
import WorkflowPlanner from '@/components/growth/WorkflowPlanner';
import { publicMetadata } from '@/lib/seo/metadata.cjs';

const title = 'Connected virtual care for providers';
const description = 'Explore DoctaRx appointment, video, messaging and care coordination workflows. Start provider onboarding or discuss a focused pilot for your clinic.';
export const metadata = publicMetadata({ title, description, path: '/for-providers' });
const capabilities = [
  { icon: CalendarDays, title: 'Make the next step clear', text: 'Manage appointments and give patients a place to return for their visit and follow-up.' },
  { icon: Video, title: 'Bring care into the conversation', text: 'Use video visits with microphone and camera controls, reconnect handling and supported multi-person sessions.' },
  { icon: MessagesSquare, title: 'Keep the conversation connected', text: 'Work with patient messaging and visit context inside the care workflow, with access tied to the care relationship.' },
  { icon: ClipboardList, title: 'Carry the plan forward', text: 'Coordinate records, prescriptions and referral workflows where available for your market, role and organization.' },
];

export default function ProvidersPage() {
  return <GrowthShell title={title} description={description} path="/for-providers" eyebrow="For clinicians & clinic teams">
    <section className="grid gap-10 pb-12 pt-5 md:grid-cols-[1.3fr_1fr] md:items-center md:pb-20">
      <div>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">Give every visit a clearer path forward.</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">Appointments, video, messaging and care coordination in one connected platform. Explore a focused DoctaRx workflow with your team, then measure what changes.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="#join" className={primaryLink}>Start provider onboarding <ArrowUpRight size={18} aria-hidden="true" /></Link><Link href="/contact" className={secondaryLink}>Discuss a clinic pilot</Link></div>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">Provider activation requires credential review. Features and care availability depend on your location, role and configuration.</p>
      </div>
      <aside aria-label="Example care workflow" className="rounded-3xl border border-border bg-muted/40 p-7 md:p-9">
        <p className="text-xs font-bold uppercase tracking-widest text-foreground">A connected workflow</p>
        <ol className="mt-6 space-y-6">
          {['Book the appointment', 'Connect for the visit', 'Document the care plan', 'Coordinate the next step'].map((step, index) => <li key={step} className="flex items-center gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">0{index + 1}</span><span className="font-semibold">{step}</span></li>)}
        </ol>
        <p className="mt-7 border-t border-border pt-5 text-sm leading-6 text-muted-foreground">Choose a workflow with your team. Review local requirements and service availability before using it for patient care.</p>
      </aside>
    </section>
    <section aria-labelledby="provider-capabilities"><h2 id="provider-capabilities" className="text-3xl font-bold">Built around the work between visits.</h2><div className="mt-7 grid gap-5 sm:grid-cols-2">
      {capabilities.map(({ icon: Icon, title: heading, text }) => <article key={heading} className="rounded-2xl border border-border p-6 md:p-8"><Icon size={26} className="text-primary" aria-hidden="true" /><h3 className="mt-5 text-xl font-semibold">{heading}</h3><p className="mt-3 leading-7 text-muted-foreground">{text}</p></article>)}
    </div></section>
    <section aria-labelledby="provider-voice" className="mt-10 rounded-2xl border border-border p-6 md:p-8"><h2 id="provider-voice" className="text-2xl font-semibold">Live voice, with a practical path to evaluation.</h2><p className="mt-3 max-w-4xl leading-7 text-muted-foreground">DoctaRx includes live voice with speech-to-text and text-to-speech fallback paths. Clinical use requires validation of the selected provider connection, language, consent and encounter access. Start an evaluation with fictional scenarios; your care team remains responsible for clinical decisions.</p><Link href="/contact" className="mt-4 inline-block py-2 font-semibold text-primary underline underline-offset-4">Discuss a voice evaluation</Link></section>
    <WorkflowPlanner />
    <section id="join" aria-labelledby="provider-join" className="mb-14 scroll-mt-8"><h2 id="provider-join" className="text-3xl font-bold">Start with the right onboarding path.</h2><p className="mt-4 max-w-3xl leading-7 text-muted-foreground">Create an account for the relevant market, submit your credentials and complete the applicable activation steps. Registration does not authorize practice across borders.</p><div className="mt-6 flex flex-wrap gap-3"><Link href="/provider/register" className={primaryLink}>US provider registration</Link><Link href="/ng/provider/register" className={secondaryLink}>Nigeria provider registration</Link><Link href="/partners" className={secondaryLink}>Other countries &amp; organizations</Link></div><p className="mt-5 text-sm"><Link href="/provider/login" className="underline underline-offset-4">Already registered? Provider sign in</Link></p></section>
    <PublicShare destination="providers" />
  </GrowthShell>;
}
