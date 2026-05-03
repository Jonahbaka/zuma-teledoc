'use client';

import { Clock, Globe, Lock, Zap, AlertCircle } from 'lucide-react';

const GATE_CONFIGS = {
  nigeria_pending: {
    icon: Clock,
    iconColor: 'text-amber-500',
    iconBg: 'bg-amber-500/10',
    badge: 'Coming to Nigeria',
    badgeBg: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    title: 'Not Yet Available in Nigeria',
    message: 'This feature is not yet available in Nigeria. DoctaRx Nigeria is preparing this capability for future rollout.',
    cta: null,
  },
  subscription_required: {
    icon: Zap,
    iconColor: 'text-green-500',
    iconBg: 'bg-green-500/10',
    badge: 'Subscription Required',
    badgeBg: 'bg-green-500/10 text-green-600 border-green-500/20',
    title: 'Upgrade Your Plan',
    message: 'This feature requires an active subscription plan.',
    cta: { label: 'View Plans', href: '/ng/pricing' },
  },
  admin_only: {
    icon: Lock,
    iconColor: 'text-blue-500',
    iconBg: 'bg-blue-500/10',
    badge: 'Admin Only',
    badgeBg: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    title: 'Admin Access Required',
    message: 'This section is restricted to DoctaRx administrators.',
    cta: null,
  },
  provider_only: {
    icon: Lock,
    iconColor: 'text-purple-500',
    iconBg: 'bg-purple-500/10',
    badge: 'Providers Only',
    badgeBg: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    title: 'Provider Access Required',
    message: 'This feature is available to registered and verified healthcare providers only.',
    cta: { label: 'Register as Provider', href: '/ng/provider/auth/register' },
  },
  pharmacy_only: {
    icon: Lock,
    iconColor: 'text-teal-500',
    iconBg: 'bg-teal-500/10',
    badge: 'Pharmacies Only',
    badgeBg: 'bg-teal-500/10 text-teal-600 border-teal-500/20',
    title: 'Pharmacy Access Required',
    message: 'This feature is only available to registered pharmacy partners.',
    cta: { label: 'Open Pharmacy Portal', href: '/ng/pharmacy' },
  },
  corporate_only: {
    icon: Globe,
    iconColor: 'text-indigo-500',
    iconBg: 'bg-indigo-500/10',
    badge: 'Corporate Plan',
    badgeBg: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
    title: 'Organization Account Required',
    message: 'This feature is available to corporate and organization accounts.',
    cta: { label: 'Register Organization', href: '/ng/organization/register' },
  },
  us_only: {
    icon: AlertCircle,
    iconColor: 'text-slate-500',
    iconBg: 'bg-slate-500/10',
    badge: 'US Only',
    badgeBg: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
    title: 'Not Available in Nigeria',
    message: 'This feature is currently only available in the United States. DoctaRx Nigeria is preparing this capability for future rollout.',
    cta: null,
  },
  plan_restricted: {
    icon: Zap,
    iconColor: 'text-orange-500',
    iconBg: 'bg-orange-500/10',
    badge: 'Plan Restricted',
    badgeBg: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    title: 'Plan Upgrade Required',
    message: 'This feature requires an upgraded subscription plan.',
    cta: { label: 'Upgrade Plan', href: '/ng/pricing' },
  },
};

/**
 * FeatureGate — wraps content with a professional gate overlay.
 *
 * Props:
 *   type: keyof GATE_CONFIGS  (default: 'nigeria_pending')
 *   available: boolean — if true, renders children normally
 *   compact: boolean — renders a small inline badge instead of full overlay
 *   children: content to render when available
 */
export function FeatureGate({ type = 'nigeria_pending', available = false, compact = false, children }) {
  if (available) return <>{children}</>;

  const config = GATE_CONFIGS[type] || GATE_CONFIGS.nigeria_pending;
  const Icon = config.icon;

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${config.badgeBg}`}>
        <Icon size={10} />
        {config.badge}
      </span>
    );
  }

  return (
    <div className="relative min-h-[280px] w-full rounded-2xl border border-border bg-card/50 overflow-hidden">
      {/* Blurred children hint */}
      {children && (
        <div className="absolute inset-0 opacity-10 pointer-events-none select-none blur-sm scale-[0.98]">
          {children}
        </div>
      )}

      {/* Gate overlay */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full min-h-[280px] p-8 text-center gap-5">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${config.badgeBg}`}>
          <Icon size={11} />
          {config.badge}
        </span>

        <div className={`w-16 h-16 rounded-2xl ${config.iconBg} flex items-center justify-center`}>
          <Icon size={32} className={config.iconColor} />
        </div>

        <div className="space-y-2 max-w-sm">
          <h3 className="text-lg font-bold text-foreground">{config.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{config.message}</p>
        </div>

        {config.cta && (
          <a
            href={config.cta.href}
            className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-green-900/20"
          >
            {config.cta.label}
          </a>
        )}
      </div>
    </div>
  );
}

/** Inline coming-soon notice for buttons/menu items */
export function ComingSoonBadge({ label = 'Coming Soon', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20 ${className}`}>
      <Clock size={8} />
      {label}
    </span>
  );
}

export default FeatureGate;
