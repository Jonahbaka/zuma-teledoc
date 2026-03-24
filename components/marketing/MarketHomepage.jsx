'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, ChevronRight, Menu, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/utils';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import CountrySelector from '@/components/CountrySelector';
import { MARKET_HOME_DATA } from '@/components/marketing/marketHomeData';

const TONE_STYLES = {
  blue: {
    icon: 'text-cyan-600 dark:text-cyan-300',
    badge: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 border-cyan-500/20',
    panel: 'border-cyan-500/20 bg-cyan-500/10',
    gradient: 'from-cyan-500/18 via-blue-500/12 to-transparent',
    button: 'bg-cyan-600 hover:bg-cyan-500 text-white',
    shadow: 'shadow-[0_24px_60px_rgba(8,145,178,0.18)]',
  },
  emerald: {
    icon: 'text-emerald-600 dark:text-emerald-300',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 border-emerald-500/20',
    panel: 'border-emerald-500/20 bg-emerald-500/10',
    gradient: 'from-emerald-500/18 via-teal-500/12 to-transparent',
    button: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    shadow: 'shadow-[0_24px_60px_rgba(5,150,105,0.18)]',
  },
  violet: {
    icon: 'text-violet-600 dark:text-violet-300',
    badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-200 border-violet-500/20',
    panel: 'border-violet-500/20 bg-violet-500/10',
    gradient: 'from-violet-500/18 via-fuchsia-500/12 to-transparent',
    button: 'bg-violet-600 hover:bg-violet-500 text-white',
    shadow: 'shadow-[0_24px_60px_rgba(109,40,217,0.18)]',
  },
  amber: {
    icon: 'text-amber-600 dark:text-amber-300',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-200 border-amber-500/20',
    panel: 'border-amber-500/20 bg-amber-500/10',
    gradient: 'from-amber-500/18 via-orange-500/12 to-transparent',
    button: 'bg-amber-500 hover:bg-amber-400 text-slate-950',
    shadow: 'shadow-[0_24px_60px_rgba(245,158,11,0.18)]',
  },
  slate: {
    icon: 'text-slate-700 dark:text-slate-200',
    badge: 'bg-slate-500/10 text-slate-700 dark:text-slate-200 border-slate-500/20',
    panel: 'border-slate-500/20 bg-slate-500/10',
    gradient: 'from-slate-500/18 via-slate-400/12 to-transparent',
    button: 'bg-slate-900 hover:bg-slate-800 text-white',
    shadow: 'shadow-[0_24px_60px_rgba(15,23,42,0.2)]',
  },
};

function toneStyles(tone) {
  return TONE_STYLES[tone] || TONE_STYLES.blue;
}

function SectionHeading({ badge, title, subtitle, align = 'center' }) {
  const centered = align === 'center';

  return (
    <div className={cn('flex flex-col gap-4', centered ? 'items-center text-center' : 'items-start text-left')}>
      {badge ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-300">
          <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
          {badge}
        </span>
      ) : null}
      <h2 className="max-w-4xl text-3xl leading-tight text-foreground md:text-5xl">{title}</h2>
      {subtitle ? (
        <p className={cn('max-w-3xl text-base leading-7 text-muted-foreground md:text-lg', !centered && 'max-w-2xl')}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function TonePill({ tone, icon: Icon, children }) {
  const styles = toneStyles(tone);

  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold', styles.badge)}>
      {Icon ? <Icon className={cn('h-3.5 w-3.5', styles.icon)} /> : null}
      {children}
    </span>
  );
}

function MiniPreview({ variant, tone, labels }) {
  const styles = toneStyles(tone);

  if (variant === 'shield') {
    return (
      <div className={cn('relative h-36 overflow-hidden rounded-[1.35rem] border bg-gradient-to-br p-5', styles.panel, styles.shadow, styles.gradient)}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.5),transparent_45%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_45%)]" />
        <div className="relative mx-auto flex h-full max-w-[12rem] items-center justify-center">
          <div className="absolute h-28 w-28 rounded-full border border-white/70 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70" />
          <div className={cn('absolute h-20 w-20 rounded-full border', styles.panel)} />
          <div className={cn('absolute h-12 w-12 rounded-full border bg-background/90', styles.panel)} />
          <div className={cn('relative h-10 w-10 rounded-2xl border bg-background/95', styles.panel)} />
        </div>
      </div>
    );
  }

  if (variant === 'network') {
    return (
      <div className={cn('relative h-36 overflow-hidden rounded-[1.35rem] border bg-gradient-to-br p-5', styles.panel, styles.shadow, styles.gradient)}>
        <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/40 dark:border-white/10" />
        {['left-6 top-6', 'right-7 top-10', 'left-1/2 top-1/2', 'left-10 bottom-7', 'right-10 bottom-6'].map((position, index) => (
          <div
            key={position}
            className={cn(
              'absolute h-4 w-4 rounded-full border border-white/60 bg-white/90 shadow-sm dark:border-white/10 dark:bg-slate-900',
              position,
              index === 2 && 'h-5 w-5'
            )}
          />
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-px w-28 bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/20" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center rotate-90">
          <div className="h-px w-28 bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/20" />
        </div>
      </div>
    );
  }

  if (variant === 'wallet') {
    const walletLabels = labels || ['Insurance', 'Card', 'Transfer', 'USSD'];

    return (
      <div className={cn('relative h-36 overflow-hidden rounded-[1.35rem] border bg-gradient-to-br p-4', styles.panel, styles.shadow, styles.gradient)}>
        <div className="grid h-full grid-cols-2 gap-3">
          {walletLabels.map((label, index) => (
            <div
              key={label}
              className={cn(
                'rounded-2xl border bg-white/80 px-3 py-3 text-xs font-semibold text-slate-700 backdrop-blur-md dark:bg-slate-950/70 dark:text-slate-200',
                index % 2 === 0 ? 'translate-y-1' : '-translate-y-1'
              )}
            >
              {label}
              <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'delivery') {
    return (
      <div className={cn('relative h-36 overflow-hidden rounded-[1.35rem] border bg-gradient-to-br p-5', styles.panel, styles.shadow, styles.gradient)}>
        <div className="absolute inset-x-10 top-1/2 h-0.5 -translate-y-1/2 bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/20" />
        {['left-6 top-8', 'left-1/2 top-1/2', 'right-7 bottom-8'].map((position, index) => (
          <div
            key={position}
            className={cn(
              'absolute flex h-9 w-9 items-center justify-center rounded-2xl border bg-white/90 text-[10px] font-bold text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-950/80 dark:text-slate-100',
              position
            )}
          >
            {index + 1}
          </div>
        ))}
        <div className="absolute right-5 top-5 rounded-full border border-white/70 bg-white/85 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300">
          Live route
        </div>
      </div>
    );
  }

  if (variant === 'pharmacy') {
    return (
      <div className={cn('relative h-36 overflow-hidden rounded-[1.35rem] border bg-gradient-to-br p-4', styles.panel, styles.shadow, styles.gradient)}>
        <div className="space-y-2.5">
          {[62, 88, 54].map((width, index) => (
            <div key={width} className="rounded-2xl border border-white/70 bg-white/85 p-3 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/70">
              <div className="flex items-center justify-between gap-3">
                <div className="h-2 rounded-full bg-slate-300 dark:bg-slate-700" style={{ width: `${width}%` }} />
                <div className="h-2 w-10 rounded-full bg-slate-200 dark:bg-slate-800" />
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" style={{ width: `${48 + (index * 10)}%` }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'checkout') {
    return (
      <div className={cn('relative h-36 overflow-hidden rounded-[1.35rem] border bg-gradient-to-br p-5', styles.panel, styles.shadow, styles.gradient)}>
        <div className="rounded-[1.1rem] border border-white/70 bg-white/90 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/75">
          <div className="mb-4 flex items-center justify-between">
            <div className="h-3 w-24 rounded-full bg-slate-300 dark:bg-slate-700" />
            <div className="h-7 w-7 rounded-xl bg-slate-200 dark:bg-slate-800" />
          </div>
          <div className="space-y-2">
            {[70, 92, 58].map((width) => (
              <div key={width} className="h-2 rounded-full bg-slate-200 dark:bg-slate-800" style={{ width: `${width}%` }} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {['Card', 'Transfer', 'USSD'].map((label) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-center text-[10px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative h-36 overflow-hidden rounded-[1.35rem] border bg-gradient-to-br p-4', styles.panel, styles.shadow, styles.gradient)}>
      <div className="grid h-full grid-cols-[0.95fr_1.05fr] gap-3">
        <div className="space-y-3 rounded-[1.15rem] border border-white/70 bg-white/90 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/75">
          <div className="flex gap-1.5">
            <div className="h-2 w-2 rounded-full bg-rose-400/60" />
            <div className="h-2 w-2 rounded-full bg-amber-400/60" />
            <div className="h-2 w-2 rounded-full bg-emerald-400/60" />
          </div>
          {[82, 56, 74].map((width) => (
            <div key={width} className="h-2 rounded-full bg-slate-200 dark:bg-slate-800" style={{ width: `${width}%` }} />
          ))}
        </div>
        <div className="space-y-3">
          {[68, 88, 58].map((width, index) => (
            <div
              key={`${width}-${index}`}
              className={cn(
                'rounded-[1rem] border border-white/70 bg-white/85 p-3 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/70',
                index === 1 && 'translate-x-2'
              )}
            >
              <div className="h-2 rounded-full bg-slate-300 dark:bg-slate-700" style={{ width: `${width}%` }} />
              <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" style={{ width: `${50 + (index * 8)}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MenuPanel({ title, items }) {
  return (
    <div className="absolute right-0 top-full z-30 pt-3">
      <div className="w-72 rounded-[1.35rem] border border-white/60 bg-white/90 p-3 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/85">
        <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{title}</div>
        <div className="space-y-1">
          {items.map((item) => {
            const styles = toneStyles(item.tone);
            const Icon = item.icon;

            return (
              <Link key={item.label} href={item.href} className="group flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-accent">
                <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl border', styles.panel)}>
                  <Icon className={cn('h-5 w-5', styles.icon)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{item.label}</div>
                  <div className="text-xs leading-5 text-muted-foreground">{item.description}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HeroPreview({ content }) {
  const styles = toneStyles(content.hero.visualTone);

  return (
    <div className="relative">
      <div className={cn('absolute -left-10 top-10 h-44 w-44 rounded-full blur-3xl', content.code === 'US' ? 'bg-cyan-500/18' : 'bg-emerald-500/18')} />
      <div className={cn('absolute -right-8 bottom-4 h-44 w-44 rounded-full blur-3xl', content.code === 'US' ? 'bg-blue-500/16' : 'bg-amber-500/18')} />
      <div className="relative rounded-[2rem] border border-white/60 bg-white/85 p-4 shadow-[0_30px_80px_rgba(15,23,42,0.16)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/78 sm:p-6">
        <div className={cn('overflow-hidden rounded-[1.75rem] border bg-gradient-to-br p-4 sm:p-5', styles.panel, styles.gradient)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">{content.hero.visual.title}</div>
              <div className="mt-1 max-w-sm text-sm leading-6 text-foreground/90">{content.hero.visual.subtitle}</div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/70 bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-slate-700 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/75 dark:text-slate-200">
              <span className={cn('inline-flex h-2.5 w-2.5 rounded-full', content.code === 'US' ? 'bg-cyan-500' : 'bg-emerald-500')} />
              Live orchestration
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {content.hero.visual.chips.map((chip) => (
              <TonePill key={chip} tone={content.hero.visualTone}>
                {chip}
              </TonePill>
            ))}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
            <div className="rounded-[1.6rem] bg-slate-950 p-5 text-white shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Workflow Signal</div>
                <div className="flex gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-rose-400/65" />
                  <div className="h-2 w-2 rounded-full bg-amber-400/65" />
                  <div className="h-2 w-2 rounded-full bg-emerald-400/75" />
                </div>
              </div>
              <div className="mt-5 rounded-[1.35rem] border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-medium text-slate-300">{content.hero.visual.metric.value}</div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{content.hero.visual.metric.label}</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                {content.hero.visual.tiles.map((tile) => {
                  const tileTone = toneStyles(tile.tone);

                  return (
                    <div key={tile.title} className={cn('rounded-[1.2rem] border bg-white/5 p-4 backdrop-blur-xl', tileTone.panel)}>
                      <div className={cn('text-sm font-semibold', tileTone.icon)}>{tile.title}</div>
                      <p className="mt-2 text-xs leading-5 text-slate-300">{tile.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-white/70 bg-white/90 p-4 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/75">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">{content.hero.visual.railTitle}</div>
                    <div className="mt-2 text-sm leading-6 text-foreground/90">
                      The same design language scales across desktop, tablet, and mobile without collapsing into a stretched phone layout.
                    </div>
                  </div>
                  <div className={cn('hidden h-11 w-11 items-center justify-center rounded-2xl border sm:flex', styles.panel)}>
                    <Activity className={cn('h-5 w-5', styles.icon)} />
                  </div>
                </div>
              </div>

              {content.hero.visual.railItems.map((item, index) => (
                <div
                  key={item}
                  className={cn(
                    'rounded-[1.4rem] border border-white/70 bg-white/88 p-4 shadow-md backdrop-blur-xl transition-transform dark:border-white/10 dark:bg-slate-950/72',
                    index === 1 && 'sm:translate-x-4',
                    index === 2 && 'sm:translate-x-8'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('mt-0.5 flex h-8 w-8 items-center justify-center rounded-2xl border', styles.panel)}>
                      <span className="text-xs font-bold text-foreground">{index + 1}</span>
                    </div>
                    <p className="text-sm leading-6 text-foreground/90">{item}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {content.stats.slice(0, 2).map((stat) => {
            const Icon = stat.icon;

            return (
              <div
                key={stat.label}
                className="flex min-w-[12rem] flex-1 items-center gap-3 rounded-[1.2rem] border border-white/60 bg-white/90 px-4 py-3 text-sm shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/75"
              >
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl border', styles.panel)}>
                  <Icon className={cn('h-4.5 w-4.5', styles.icon)} />
                </div>
                <div>
                  <div className="font-semibold text-foreground">{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MarketHomepage({ market = 'US' }) {
  const content = MARKET_HOME_DATA[market] || MARKET_HOME_DATA.US;
  const primaryTone = toneStyles(content.hero.visualTone);
  const hasAlternateMarket = Boolean(content.otherMarket?.href && content.otherMarket?.label);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [getStartedOpen, setGetStartedOpen] = useState(false);
  const [emergencyBannerVisible, setEmergencyBannerVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 18);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground selection:bg-cyan-500/20">
      {content.showCountrySelector ? <CountrySelector /> : null}

      {emergencyBannerVisible ? (
        <div className="fixed inset-x-0 top-0 z-[70] border-b border-red-500/20 bg-red-950/92 text-white backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 py-3 text-center text-xs sm:text-sm">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500/20">
              <Activity className="h-4 w-4 text-red-300" />
            </div>
            <p className="leading-5">
              {content.banner.emergencyLabel} <strong>{content.banner.emergencyNumber}</strong> {content.banner.emergencyTail}
            </p>
            <button
              type="button"
              onClick={() => setEmergencyBannerVisible(false)}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10"
              aria-label="Dismiss emergency message"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <nav
        className={cn(
          'fixed inset-x-0 z-[60] border-b transition-all duration-300',
          emergencyBannerVisible ? 'top-14 sm:top-[49px]' : 'top-0',
          isScrolled
            ? 'border-white/70 bg-background/88 py-3 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/10'
            : 'border-transparent bg-background/70 py-4 backdrop-blur-xl'
        )}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href={content.code === 'US' ? '/' : '/ng'} className="flex items-center gap-3">
            <span className="rounded-2xl border border-slate-800 bg-slate-950/95 px-3 py-2 shadow-[0_0_28px_rgba(34,211,238,0.16)]">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold text-foreground">{content.name}</div>
              <div className="text-xs text-muted-foreground">Premium healthcare experience</div>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-6 xl:gap-8">
            {content.navLinks.map((link) => (
              <a key={link.href} href={link.href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex lg:hidden items-center gap-2">
            <ThemeToggle />
            {hasAlternateMarket ? (
              <Link href={content.otherMarket.href} className="rounded-full border border-border bg-background/80 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                {content.otherMarket.label}
              </Link>
            ) : null}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setLoginOpen((value) => !value);
                  setGetStartedOpen(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Portal
                <ChevronRight className={cn('h-4 w-4 transition-transform', loginOpen && 'rotate-90')} />
              </button>
              {loginOpen ? <MenuPanel title="Select Portal" items={content.loginItems} /> : null}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setGetStartedOpen((value) => !value);
                  setLoginOpen(false);
                }}
                className={cn('inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors', primaryTone.button)}
              >
                Get Started
                <ChevronRight className={cn('h-4 w-4 transition-transform', getStartedOpen && 'rotate-90')} />
              </button>
              {getStartedOpen ? <MenuPanel title="Choose Your Path" items={content.getStartedItems} /> : null}
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3">
            {hasAlternateMarket ? (
              <Link href={content.otherMarket.href} className="rounded-full border border-border bg-background/80 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                {content.otherMarket.label}
              </Link>
            ) : null}
            <ThemeToggle />

            <div className="relative" onMouseEnter={() => setLoginOpen(true)} onMouseLeave={() => setLoginOpen(false)}>
              <button type="button" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                Portal Login
                <ChevronRight className={cn('h-4 w-4 transition-transform', loginOpen && 'rotate-90')} />
              </button>
              {loginOpen ? <MenuPanel title="Select Portal" items={content.loginItems} /> : null}
            </div>

            <div className="relative" onMouseEnter={() => setGetStartedOpen(true)} onMouseLeave={() => setGetStartedOpen(false)}>
              <Button className={cn('rounded-full px-5', primaryTone.button)}>
                Get Started
                <ChevronRight className={cn('ml-2 h-4 w-4 transition-transform', getStartedOpen && 'rotate-90')} />
              </Button>
              {getStartedOpen ? <MenuPanel title="Choose Your Path" items={content.getStartedItems} /> : null}
            </div>
          </div>

          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              className="rounded-full border border-border bg-background/80 p-2.5 text-foreground transition-colors hover:bg-accent"
              aria-label="Toggle navigation"
              onClick={() => setMobileMenuOpen((value) => !value)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen ? (
          <div className="border-t border-white/60 bg-background/95 px-4 py-4 shadow-xl backdrop-blur-2xl dark:border-white/10 md:hidden">
            <div className="mx-auto max-w-7xl space-y-4">
              <div className="flex flex-col gap-2">
                {content.navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    {link.label}
                  </a>
                ))}
              </div>

              <div className="rounded-[1.4rem] border border-border bg-card/80 p-3">
                <div className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Portal Login</div>
                <div className="space-y-2">
                  {content.loginItems.map((item) => {
                    const Icon = item.icon;
                    const styles = toneStyles(item.tone);

                    return (
                      <Link key={item.label} href={item.href} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 rounded-2xl bg-background px-3 py-3">
                        <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl border', styles.panel)}>
                          <Icon className={cn('h-4.5 w-4.5', styles.icon)} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground">{item.label}</div>
                          <div className="text-xs text-muted-foreground">{item.description}</div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[1.4rem] border border-border bg-card/80 p-3">
                <div className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Get Started</div>
                <div className="space-y-2">
                  {content.getStartedItems.map((item) => {
                    const Icon = item.icon;
                    const styles = toneStyles(item.tone);

                    return (
                      <Link key={item.label} href={item.href} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 rounded-2xl bg-background px-3 py-3">
                        <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl border', styles.panel)}>
                          <Icon className={cn('h-4.5 w-4.5', styles.icon)} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-foreground">{item.label}</div>
                          <div className="text-xs text-muted-foreground">{item.description}</div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    );
                  })}
                </div>
              </div>

              {hasAlternateMarket ? (
                <Link href={content.otherMarket.href} onClick={() => setMobileMenuOpen(false)} className="block rounded-2xl border border-border bg-background/80 px-4 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-accent">
                  {content.otherMarket.label}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </nav>

      <main>
        <section
          className={cn(
            'relative overflow-hidden px-4 pb-16 sm:px-6 md:pb-20 xl:pb-24',
            emergencyBannerVisible ? 'pt-[10.5rem] sm:pt-[9.5rem] lg:pt-[10.5rem]' : 'pt-28 md:pt-32'
          )}
        >
          <div className={cn('absolute inset-0', content.code === 'US' ? 'bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_36%),radial-gradient(circle_at_85%_12%,rgba(59,130,246,0.10),transparent_30%),linear-gradient(180deg,rgba(248,250,252,1),rgba(255,255,255,0.88))] dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_32%),radial-gradient(circle_at_85%_12%,rgba(59,130,246,0.10),transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.92),rgba(2,6,23,0.75))]' : 'bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_36%),radial-gradient(circle_at_85%_12%,rgba(245,158,11,0.10),transparent_28%),linear-gradient(180deg,rgba(248,250,252,1),rgba(255,255,255,0.88))] dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_85%_12%,rgba(245,158,11,0.08),transparent_24%),linear-gradient(180deg,rgba(2,6,23,0.92),rgba(2,6,23,0.75))]')} />
          <div className="absolute inset-x-0 top-0 h-[32rem] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.74),transparent)] dark:bg-[linear-gradient(to_bottom,rgba(2,6,23,0.6),transparent)]" />
          <div className="relative mx-auto max-w-7xl">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] xl:gap-16">
              <div className="space-y-8">
                <TonePill tone={content.hero.visualTone} icon={Sparkles}>{content.hero.badge}</TonePill>
                <div className="space-y-5">
                  <h1 className="max-w-4xl text-5xl leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-[4.6rem] xl:text-[5.15rem]">
                    {content.hero.title}
                    <span className={cn('mt-2 block bg-clip-text text-transparent', content.code === 'US' ? 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 dark:from-cyan-300 dark:via-blue-300 dark:to-indigo-300' : 'bg-gradient-to-r from-emerald-600 via-teal-500 to-amber-500 dark:from-emerald-300 dark:via-teal-300 dark:to-amber-300')}>
                      {content.hero.highlight}
                    </span>
                  </h1>
                  <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">{content.hero.description}</p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Link href={content.hero.primaryCta.href} className={cn('inline-flex items-center justify-center rounded-full px-6 py-3.5 text-base font-semibold transition-colors sm:px-7', primaryTone.button)}>
                    {content.hero.primaryCta.label}
                    <ArrowRight className="ml-2 h-4.5 w-4.5" />
                  </Link>
                  <Link href={content.hero.secondaryCta.href} className="inline-flex items-center justify-center rounded-full border border-border bg-background/80 px-6 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-accent sm:px-7">
                    {content.hero.secondaryCta.label}
                  </Link>
                  <a href={content.hero.tertiaryCta.href} className="inline-flex items-center justify-center rounded-full px-2 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
                    {content.hero.tertiaryCta.label}
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </a>
                </div>
                <div className="flex flex-wrap gap-3">
                  {content.hero.trustItems.map((item) => (
                    <TonePill key={item.text} tone={content.hero.visualTone} icon={item.icon}>{item.text}</TonePill>
                  ))}
                </div>
              </div>
              <HeroPreview content={content} />
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {content.stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="rounded-[1.6rem] border border-white/70 bg-white/86 p-5 shadow-sm backdrop-blur-xl transition-transform hover:-translate-y-1 dark:border-white/10 dark:bg-slate-950/70">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-lg font-semibold text-foreground">{stat.value}</div>
                        <div className="text-sm leading-6 text-muted-foreground">{stat.label}</div>
                      </div>
                      <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl border', primaryTone.panel)}>
                        <Icon className={cn('h-5 w-5', primaryTone.icon)} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="features" className="px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-7xl space-y-12">
            <SectionHeading badge={content.featureSection.badge} title={content.featureSection.title} subtitle={content.featureSection.subtitle} />
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {content.features.map((feature, index) => {
                const styles = toneStyles(feature.tone);
                const Icon = feature.icon;
                const pointDot = feature.tone === 'emerald' ? 'bg-emerald-500' : feature.tone === 'violet' ? 'bg-violet-500' : feature.tone === 'amber' ? 'bg-amber-500' : 'bg-cyan-500';

                return (
                  <div
                    key={feature.title}
                    className="group rounded-[1.85rem] border border-white/70 bg-white/88 p-5 shadow-sm backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl dark:border-white/10 dark:bg-slate-950/72"
                    style={{ transitionDelay: `${index * 40}ms` }}
                  >
                    <MiniPreview variant={feature.preview} tone={feature.tone} labels={feature.previewLabels} />
                    <div className="mt-5 flex items-center gap-3">
                      <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl border', styles.panel)}>
                        <Icon className={cn('h-5 w-5', styles.icon)} />
                      </div>
                      <h3 className="text-xl leading-tight text-foreground">{feature.title}</h3>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{feature.description}</p>
                    <div className="mt-4 space-y-2">
                      {feature.points.map((point) => (
                        <div key={point} className="flex items-center gap-2 text-sm text-foreground/90">
                          <span className={cn('h-2 w-2 rounded-full', pointDot)} />
                          {point}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="workflow" className="border-y border-border/60 bg-card/40 px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-7xl space-y-12">
            <SectionHeading title={content.workflowSection.title} subtitle={content.workflowSection.subtitle} />
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {content.workflowSteps.map((step, index) => {
                const Icon = step.icon;
                const tone = toneStyles(index === 1 ? 'emerald' : index === 2 ? 'violet' : index === 3 ? 'amber' : content.hero.visualTone);

                return (
                  <div key={step.title} className="relative rounded-[1.8rem] border border-white/70 bg-white/88 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/72">
                    <div className="absolute right-6 top-6 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">0{index + 1}</div>
                    <div className={cn('flex h-14 w-14 items-center justify-center rounded-[1.25rem] border', tone.panel)}>
                      <Icon className={cn('h-6 w-6', tone.icon)} />
                    </div>
                    <h3 className="mt-5 text-2xl leading-tight text-foreground">{step.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{step.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id={content.audienceSection.id} className="px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-7xl space-y-12">
            <SectionHeading badge={content.audienceSection.badge} title={content.audienceSection.title} subtitle={content.audienceSection.subtitle} />
            <div className="grid gap-6 lg:grid-cols-3">
              {content.audienceCards.map((card) => {
                const Icon = card.icon;
                const styles = toneStyles(card.tone);

                return (
                  <div key={card.title} className="flex h-full flex-col rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/72">
                    <div className={cn('flex h-14 w-14 items-center justify-center rounded-[1.3rem] border', styles.panel)}>
                      <Icon className={cn('h-6 w-6', styles.icon)} />
                    </div>
                    <h3 className="mt-5 text-2xl text-foreground">{card.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{card.description}</p>
                    <div className="mt-5 space-y-3">
                      {card.bullets.map((bullet) => (
                        <div key={bullet} className="flex items-start gap-3">
                          <div className={cn('mt-1 flex h-5 w-5 items-center justify-center rounded-full border', styles.panel)}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          </div>
                          <span className="text-sm leading-6 text-foreground/90">{bullet}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-auto pt-6">
                      <Link href={card.ctaHref} className={cn('inline-flex items-center rounded-full px-4 py-2.5 text-sm font-semibold transition-colors', styles.button)}>
                        {card.ctaLabel}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-y border-border/60 bg-card/40 px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-7xl space-y-12">
            <SectionHeading title={content.pricingSection.title} subtitle={content.pricingSection.subtitle} />
            <div className="grid gap-6 lg:grid-cols-3">
              {content.plans.map((plan) => {
                const styles = toneStyles(plan.tone);

                return (
                  <div
                    key={`${plan.eyebrow}-${plan.title}`}
                    className={cn(
                      'relative flex h-full flex-col rounded-[2rem] border p-6 shadow-sm backdrop-blur-xl transition-transform hover:-translate-y-1 dark:bg-slate-950/75',
                      plan.featured ? cn('bg-white/96 dark:border-white/10', styles.panel, styles.shadow) : 'border-white/70 bg-white/88 dark:border-white/10'
                    )}
                  >
                    {plan.featured ? (
                      <div className={cn('absolute right-5 top-5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em]', styles.badge)}>
                        Most used
                      </div>
                    ) : null}
                    <div className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">{plan.eyebrow}</div>
                    <div className="mt-4 flex items-end gap-2">
                      <div className="text-5xl leading-none text-foreground">{plan.title}</div>
                      <div className="pb-1 text-sm text-muted-foreground">{plan.period}</div>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-muted-foreground">{plan.description}</p>
                    <div className="mt-6 space-y-3">
                      {plan.features.map((feature) => (
                        <div key={feature} className="flex items-start gap-3">
                          <Activity className={cn('mt-0.5 h-4.5 w-4.5 flex-shrink-0', styles.icon)} />
                          <span className="text-sm leading-6 text-foreground/90">{feature}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-auto pt-6">
                      <Link href={plan.ctaHref} className={cn('inline-flex w-full items-center justify-center rounded-full px-4 py-3 text-sm font-semibold transition-colors', plan.featured ? styles.button : 'border border-border bg-background/80 text-foreground hover:bg-accent')}>
                        {plan.ctaLabel}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-[1.8rem] border border-white/70 bg-white/88 px-6 py-5 text-sm leading-7 text-muted-foreground shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/72">
              {content.pricingSection.note}
            </div>
          </div>
        </section>

        <section id="security" className="px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-7xl">
            <div className="overflow-hidden rounded-[2.2rem] border border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_85%_0%,rgba(16,185,129,0.18),transparent_26%),linear-gradient(145deg,#020617,#0f172a_55%,#111827)] px-6 py-8 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:px-8 sm:py-10 md:px-10">
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-center">
                <div className="space-y-5">
                  <TonePill tone="emerald" icon={Activity}>{content.securitySection.badge}</TonePill>
                  <h2 className="max-w-3xl text-3xl leading-tight text-white md:text-4xl">{content.securitySection.title}</h2>
                  <p className="max-w-2xl text-base leading-7 text-slate-300 md:text-lg">{content.securitySection.description}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {content.securitySection.bullets.map((bullet) => (
                    <div key={bullet} className="rounded-[1.5rem] border border-white/10 bg-white/[0.06] px-4 py-4 text-sm leading-6 text-slate-200 backdrop-blur-xl">
                      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                        <Activity className="h-4.5 w-4.5 text-emerald-300" />
                      </div>
                      {bullet}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 pb-20 pt-4 sm:px-6 md:pb-24">
          <div className="mx-auto max-w-6xl">
            <div className={cn(
              'relative overflow-hidden rounded-[2.35rem] border px-6 py-10 text-center shadow-[0_30px_80px_rgba(15,23,42,0.22)] sm:px-8 md:px-10',
              content.code === 'US'
                ? 'border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(59,130,246,0.2),transparent_28%),linear-gradient(145deg,#020617,#0f172a_52%,#111827)]'
                : 'border-emerald-950 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.2),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(245,158,11,0.18),transparent_28%),linear-gradient(145deg,#03241c,#064e3b_50%,#111827)]'
            )}>
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_40%)]" />
              <div className="relative">
                <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-slate-200 backdrop-blur-xl">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
                  Ready For Care
                </div>
                <h2 className="mx-auto mt-5 max-w-4xl text-3xl leading-tight text-white md:text-5xl">
                  {content.cta.title}
                </h2>
                <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-slate-300 md:text-lg">
                  {content.cta.description}
                </p>
              </div>
              <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href={content.cta.primary.href} className={cn('inline-flex items-center justify-center rounded-full px-6 py-3.5 text-sm font-semibold transition-colors', primaryTone.button)}>
                  {content.cta.primary.label}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <Link href={content.cta.secondary.href} className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/8 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/14">
                  {content.cta.secondary.label}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
