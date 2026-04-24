import Image from 'next/image';
import { Activity, FileText, Package, Users, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

const VISUAL_SLOTS = {
  hero: {
    id: 'hero-image-container',
    src: '/marketing/ng/hero-image-container.png',
    alt: 'Smiling, professional Nigerian male doctor in a clean, modern medical office, wearing a white lab coat and stethoscope while looking at a laptop screen.',
    icon: Activity,
    title: 'Smiling Nigerian male doctor in a modern medical office.',
    detail: 'White lab coat, stethoscope, reassuring expression, and a laptop-based consultation setup.',
  },
  step1: {
    id: 'step-1-img',
    src: '/marketing/ng/step-1-img.png',
    alt: 'Young Nigerian woman sitting comfortably on a sofa in a modern, sunlit Lagos apartment while smiling through a smartphone video consultation with a doctor.',
    icon: Video,
    title: 'Young Nigerian woman on a sofa during a doctor video call.',
    detail: 'A modern, sunlit Lagos apartment scene with a smartphone consultation in progress.',
  },
  step2: {
    id: 'step-2-img',
    src: '/marketing/ng/step-2-img.png',
    alt: 'Close-up of a smartphone showing a telemedicine interface with a digital prescription for a Nigerian patient in a modern home setting.',
    icon: FileText,
    title: 'Smartphone prescription interface for a Nigerian patient.',
    detail: 'A close-up prescription screen in a modern Nigerian home setting.',
  },
  step3: {
    id: 'step-3-img',
    src: '/marketing/ng/step-3-img.png',
    alt: 'Professional delivery rider in a branded teal uniform handing a medical parcel to a Nigerian man at the entrance of a modern home.',
    icon: Package,
    title: 'Medical parcel handoff at the door of a modern home.',
    detail: 'A branded teal delivery rider handing medication to a Nigerian patient.',
  },
  family: {
    id: 'mobile-app-img',
    src: '/marketing/ng/mobile-app-img.png',
    alt: 'Nigerian father and his young daughter using a tablet in a bright living room while speaking to a kind Nigerian pediatrician on screen.',
    icon: Users,
    title: 'Nigerian father and daughter on a pediatric tablet visit.',
    detail: 'Bright living room setting with a kind Nigerian woman visible on the screen.',
  },
};

const JOURNEY_STEPS = [
  {
    id: 'step-1-img',
    step: '1. Instant consultations',
    title: 'Start care with a secure online consultation.',
    body: 'Patients can begin with a doctor visit from home and keep the next step of care visible instead of getting pushed into separate flows.',
    slot: VISUAL_SLOTS.step1,
  },
  {
    id: 'step-2-img',
    step: '2. Digital prescriptions',
    title: 'Keep prescriptions and care instructions easy to follow.',
    body: 'Prescription review, medication guidance, and provider follow-through remain visible after the consultation.',
    slot: VISUAL_SLOTS.step2,
  },
  {
    id: 'step-3-img',
    step: '3. Pharmacy support',
    title: 'Move from review to pharmacy coordination with less friction.',
    body: 'Medicine search, partner pharmacy confirmation, and fulfillment updates stay connected to the same Nigeria-ready patient journey.',
    slot: VISUAL_SLOTS.step3,
  },
];

function VisualIntentSurface({ slot, className, sizes, overlay = false, priority = false, caption, captionTone = 'light' }) {
  if (slot.src) {
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
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.16)_45%,rgba(15,23,42,0.72))]" />
        ) : null}
        {caption ? (
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <div
              className={cn(
                'inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] backdrop-blur-md',
                captionTone === 'dark'
                  ? 'border-white/14 bg-slate-950/50 text-slate-100'
                  : 'border-white/14 bg-white/90 text-slate-700'
              )}
            >
              {caption}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const Icon = slot.icon;

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-[1.7rem] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] shadow-[0_22px_55px_rgba(15,23,42,0.12)]',
        className
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(15,23,42,0.08),transparent_30%)]" />
      <div className="absolute -right-12 top-6 h-36 w-36 rounded-full bg-emerald-100/70 blur-3xl" />
      <div className="absolute -left-10 bottom-4 h-28 w-28 rounded-full bg-amber-100/60 blur-3xl" />

      <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] backdrop-blur-md',
              captionTone === 'dark'
                ? 'border-white/14 bg-slate-950/50 text-slate-100'
                : 'border-slate-200 bg-white/90 text-slate-700'
            )}
          >
            {caption}
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200 bg-white/90 text-emerald-700 shadow-sm">
            <Icon className="h-5 w-5" />
          </div>
        </div>

        <div className="max-w-md space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Exact visual intent</div>
          <h3 className="text-xl leading-tight text-slate-900 sm:text-2xl">{slot.title}</h3>
          <p className="text-sm leading-7 text-slate-600 sm:text-base">{slot.detail}</p>
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/92 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
            Awaiting the exact approved local asset for this slot.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NigeriaCareMontage({ compact = false }) {
  return (
    <div className="relative">
      <VisualIntentSurface
        slot={VISUAL_SLOTS.hero}
        priority
        overlay
        caption={VISUAL_SLOTS.hero.id}
        captionTone="dark"
        className={cn(compact ? 'aspect-[4/5] min-h-[21rem]' : 'aspect-[4/5] min-h-[30rem]')}
        sizes={compact ? '(min-width: 640px) 88vw, 100vw' : '(min-width: 1280px) 46vw, 100vw'}
      />

      {!compact ? (
        <div className="absolute -bottom-5 left-5 sm:left-6">
          <div className="flex items-center gap-3 rounded-[1.4rem] border border-slate-200/80 bg-white/95 px-4 py-3 shadow-[0_20px_40px_rgba(15,23,42,0.16)] backdrop-blur-xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Next Available Doctor</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">In 2 minutes</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function NigeriaStoryCards({ compact = false }) {
  return (
    <div className={cn('grid gap-8', compact ? 'grid-cols-1' : 'md:grid-cols-3')}>
      {JOURNEY_STEPS.map((card) => (
        <article key={card.id} className="space-y-5">
          <VisualIntentSurface
            slot={card.slot}
            caption={card.id}
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

export function NigeriaSupportSpotlight() {
  return (
    <VisualIntentSurface
      slot={VISUAL_SLOTS.family}
      overlay
      caption={VISUAL_SLOTS.family.id}
      captionTone="dark"
      className="aspect-[4/5] min-h-[22rem]"
      sizes="(min-width: 1024px) 40vw, 100vw"
    />
  );
}
