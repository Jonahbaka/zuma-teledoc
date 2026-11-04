import Image from 'next/image';
import { FileText, Package, Users, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

const VISUAL_SLOTS = {
  hero: {
    src: '/marketing/us/hero-image-container.png',
    alt: 'Board-certified doctor working from a laptop in a calm, modern telehealth office.',
  },
  step1: {
    src: '/marketing/us/step-1-img.png',
    alt: 'Patient at home holding up a smartphone during a telehealth consultation.',
    icon: Video,
  },
  step2: {
    src: '/marketing/us/step-2-img.png',
    alt: 'Close-up of a smartphone displaying a digital prescription after a telehealth visit.',
    icon: FileText,
  },
  step3: {
    src: '/marketing/us/step-3-img.png',
    alt: 'Prescription delivery arriving at a patient home after a virtual consultation.',
    icon: Package,
  },
  family: {
    src: '/marketing/us/mobile-app-img.png',
    alt: 'Family at home using a tablet for a pediatric telehealth follow-up.',
    icon: Users,
  },
};

const JOURNEY_STEPS = [
  {
    id: 'consultation',
    step: '1. Instant consultations',
    title: 'Join a doctor visit from the couch, office, or kitchen table.',
    body: 'Patients can speak with licensed clinicians over secure video without losing time to commutes or waiting rooms.',
    slot: VISUAL_SLOTS.step1,
    caption: 'At-home visit',
  },
  {
    id: 'prescription',
    step: '2. Digital prescriptions',
    title: 'Keep prescriptions and post-visit instructions on the same device.',
    body: 'Medication details stay clear after the consultation so patients can revisit the next step without hunting through email or paper handouts.',
    slot: VISUAL_SLOTS.step2,
    caption: 'Digital Rx',
  },
  {
    id: 'fulfillment',
    step: '3. Pharmacy and labs',
    title: 'Move straight into pharmacy delivery or follow-up testing.',
    body: 'Prescription routing, delivery coordination, and lab follow-through stay visible after the appointment instead of disappearing into a handoff.',
    slot: VISUAL_SLOTS.step3,
    caption: 'Home follow-through',
  },
];

function VisualSurface({ slot, className, sizes, overlay = false, priority = false, caption, captionTone = 'light' }) {
  const Icon = slot.icon;

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-[1.7rem] border border-slate-200/80 bg-slate-100 shadow-[0_22px_55px_rgba(15,23,42,0.12)]',
        className
      )}
    >
      <Image
        src={slot.src}
        alt={slot.alt}
        fill
        priority={priority}
        sizes={sizes}
        className="object-cover object-center"
      />
      {overlay ? (
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.02),rgba(15,23,42,0.1)_45%,rgba(15,23,42,0.6))]" />
      ) : null}
      {caption ? (
        <div className="absolute inset-x-0 top-0 p-4 sm:p-5">
          <div
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] backdrop-blur-md',
              captionTone === 'dark'
                ? 'border-white/14 bg-slate-950/55 text-slate-100'
                : 'border-white/80 bg-white/92 text-slate-700'
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {caption}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function USCareMontage({ compact = false }) {
  return (
    <div className="relative">
      <VisualSurface
        slot={VISUAL_SLOTS.hero}
        priority
        overlay
        caption="Board-certified care"
        captionTone="dark"
        className={cn(compact ? 'aspect-[4/5] min-h-[21rem]' : 'aspect-[4/5] min-h-[30rem]')}
        sizes={compact ? '(min-width: 640px) 88vw, 100vw' : '(min-width: 1280px) 46vw, 100vw'}
      />

      {!compact ? (
        <div className="absolute -bottom-5 left-5 sm:left-6">
          <div className="flex items-center gap-3 rounded-[1.4rem] border border-slate-200/80 bg-white/95 px-4 py-3 shadow-[0_20px_40px_rgba(15,23,42,0.16)] backdrop-blur-xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Next available specialist</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">In 2 minutes</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function USStoryCards({ compact = false }) {
  return (
    <div className={cn('grid gap-8', compact ? 'grid-cols-1' : 'md:grid-cols-3')}>
      {JOURNEY_STEPS.map((card) => (
        <article key={card.id} className="space-y-5">
          <VisualSurface
            slot={card.slot}
            caption={card.caption}
            className="aspect-square"
            sizes={compact ? '100vw' : '(min-width: 768px) 31vw, 100vw'}
          />
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">{card.step}</div>
            <h3 className="text-2xl leading-tight text-foreground">{card.title}</h3>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base">{card.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function USFamilySpotlight() {
  return (
    <VisualSurface
      slot={VISUAL_SLOTS.family}
      overlay
      caption="Family-ready follow-up"
      captionTone="dark"
      className="aspect-[4/5] min-h-[22rem]"
      sizes="(min-width: 1024px) 40vw, 100vw"
    />
  );
}
