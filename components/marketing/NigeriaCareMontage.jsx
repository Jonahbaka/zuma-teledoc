import Image from 'next/image';
import { cn } from '@/lib/utils';

const STORY_MEDIA = {
  consultation: {
    eyebrow: 'Online consultation',
    title: 'Start with a doctor visit that feels local, calm, and immediate.',
    body: 'Patients can open a consultation, talk to a clinician, and move directly into the next care step without jumping between tools.',
    badge: 'Doctor access',
    src: '/marketing/ng/doctor-video-call.jpg',
    alt: 'Doctor speaking to a patient through a mobile video consultation setup.',
    objectPosition: 'object-center',
  },
  prescription: {
    eyebrow: 'Prescription follow-through',
    title: 'Keep clinical review and medication instructions visible after the call.',
    body: 'The homepage now shows the prescription journey as part of care delivery instead of reducing it to generic feature cards.',
    badge: 'Prescription support',
    src: '/marketing/ng/doctor-phone-notes.jpg',
    alt: 'Doctor documenting care instructions while speaking with a patient on the phone.',
    objectPosition: 'object-center',
  },
  family: {
    eyebrow: 'Care at home',
    title: 'Families can stay connected to care plans from the same patient account.',
    body: 'Support, follow-up, and home access remain readable for patients managing care beyond the consultation itself.',
    badge: 'Care continuity',
    src: '/marketing/ng/family-care-tablet.jpg',
    alt: 'Parent and child reviewing care information together from home on a tablet and laptop.',
    objectPosition: 'object-center',
  },
  pharmacy: {
    eyebrow: 'Pharmacy handoff',
    title: 'Move from prescription confirmation to fulfillment with fewer dead ends.',
    body: 'Partner pharmacy support, medication pickup, and delivery coordination are framed as part of the same trusted journey.',
    badge: 'Pharmacy coordination',
    src: '/marketing/ng/pharmacy-handoff.jpg',
    alt: 'Pharmacy counter handoff showing medication support and fulfillment coordination.',
    objectPosition: 'object-center',
  },
};

function StoryImageCard({ variant, className, sizes }) {
  const card = STORY_MEDIA[variant];

  return (
    <article
      className={cn(
        'group relative isolate overflow-hidden rounded-[1.8rem] border border-white/12 bg-[linear-gradient(160deg,rgba(3,36,28,0.96),rgba(15,23,42,0.94))] shadow-[0_26px_70px_rgba(15,23,42,0.28)]',
        className
      )}
    >
      <div className="absolute inset-0">
        <Image
          src={card.src}
          alt={card.alt}
          fill
          sizes={sizes}
          className={cn('object-cover transition-transform duration-700 group-hover:scale-[1.03]', card.objectPosition)}
        />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.16),rgba(2,6,23,0.34)_38%,rgba(2,6,23,0.9))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_34%),radial-gradient(circle_at_82%_12%,rgba(245,158,11,0.18),transparent_24%)]" />

      <div className="relative flex h-full flex-col justify-between p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="rounded-full border border-white/14 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/92 backdrop-blur-md">
            {card.eyebrow}
          </div>
          <div className="rounded-full border border-emerald-400/18 bg-slate-950/55 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-100 backdrop-blur-md">
            {card.badge}
          </div>
        </div>

        <div className="max-w-md space-y-3">
          <h3 className="text-xl leading-tight text-white sm:text-2xl">{card.title}</h3>
          <p className="max-w-sm text-sm leading-6 text-slate-200/92">{card.body}</p>
        </div>
      </div>
    </article>
  );
}

export default function NigeriaCareMontage({ compact = false }) {
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-1 sm:grid-cols-2' : 'md:grid-cols-[1.08fr_0.92fr]')}>
      <StoryImageCard
        variant="consultation"
        className={cn(compact ? 'min-h-[17.5rem] sm:col-span-2' : 'min-h-[20rem] md:min-h-[27rem]')}
        sizes={compact ? '(min-width: 640px) 100vw, 100vw' : '(min-width: 768px) 58vw, 100vw'}
      />
      <div className="grid gap-4">
        <StoryImageCard variant="prescription" className="min-h-[15rem]" sizes="(min-width: 768px) 28vw, 100vw" />
        <StoryImageCard variant="pharmacy" className="min-h-[15rem]" sizes="(min-width: 768px) 28vw, 100vw" />
      </div>
    </div>
  );
}

export function NigeriaStoryCards({ compact = false }) {
  const cards = ['consultation', 'prescription', 'pharmacy'];

  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'md:grid-cols-3')}>
      {cards.map((variant, index) => (
        <StoryImageCard
          key={variant}
          variant={variant}
          className={cn(
            'min-h-[18rem]',
            !compact && index === 1 && 'md:-translate-y-2',
            !compact && index === 2 && 'md:translate-y-2'
          )}
          sizes={compact ? '100vw' : '(min-width: 768px) 31vw, 100vw'}
        />
      ))}
    </div>
  );
}

export function NigeriaSupportSpotlight() {
  return (
    <StoryImageCard
      variant="family"
      className="min-h-[22rem]"
      sizes="(min-width: 1024px) 40vw, 100vw"
    />
  );
}
