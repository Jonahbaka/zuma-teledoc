import Image from 'next/image';
import { Video } from 'lucide-react';
import { cn } from '@/lib/utils';

const STORY_MEDIA = {
  consultation: {
    src: '/marketing/ng/doctor-video-call.jpg',
    alt: 'Doctor speaking to a patient through a mobile video consultation setup.',
    objectPosition: 'object-center',
  },
  prescription: {
    src: '/marketing/ng/doctor-phone-notes.jpg',
    alt: 'Doctor documenting care instructions while speaking with a patient on the phone.',
    objectPosition: 'object-center',
  },
  family: {
    src: '/marketing/ng/family-care-tablet.jpg',
    alt: 'Parent and child reviewing care information together from home on a tablet and laptop.',
    objectPosition: 'object-center',
  },
  pharmacy: {
    src: '/marketing/ng/pharmacy-handoff.jpg',
    alt: 'Pharmacy counter handoff showing medication support and fulfillment coordination.',
    objectPosition: 'object-center',
  },
};

const JOURNEY_STEPS = [
  {
    id: 'step-1-img',
    step: '1. Instant consultations',
    title: 'Start care with a secure online consultation.',
    body: 'Patients can begin with a doctor visit from home and keep the next step of care visible instead of getting pushed into separate flows.',
    media: STORY_MEDIA.consultation,
  },
  {
    id: 'step-2-img',
    step: '2. Digital prescriptions',
    title: 'Keep prescriptions and care instructions easy to follow.',
    body: 'Prescription review, medication guidance, and provider follow-through remain visible after the consultation.',
    media: STORY_MEDIA.prescription,
  },
  {
    id: 'step-3-img',
    step: '3. Pharmacy support',
    title: 'Move from review to pharmacy coordination with less friction.',
    body: 'Medicine search, partner pharmacy confirmation, and fulfillment updates stay connected to the same Nigeria-ready patient journey.',
    media: STORY_MEDIA.pharmacy,
  },
];

function MediaSurface({ media, className, sizes, overlay = false, priority = false, caption, captionTone = 'light' }) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-[1.7rem] border border-slate-200/80 bg-slate-100 shadow-[0_22px_55px_rgba(15,23,42,0.12)]',
        className
      )}
    >
      <Image
        src={media.src}
        alt={media.alt}
        fill
        priority={priority}
        sizes={sizes}
        className={cn('object-cover', media.objectPosition)}
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

export default function NigeriaCareMontage({ compact = false }) {
  return (
    <div className="relative">
      <MediaSurface
        media={STORY_MEDIA.consultation}
        priority
        overlay
        caption="hero-image-container"
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
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Connected care</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                Consultations, prescriptions, and pharmacy support stay in one flow.
              </div>
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
          <MediaSurface
            media={card.media}
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
    <MediaSurface
      media={STORY_MEDIA.family}
      overlay
      caption="mobile-app-img"
      captionTone="dark"
      className="aspect-[4/5] min-h-[22rem]"
      sizes="(min-width: 1024px) 40vw, 100vw"
    />
  );
}
