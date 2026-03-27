import {
  BarChart3,
  Bell,
  BrainCircuit,
  Calendar,
  ClipboardList,
  Eye,
  LayoutDashboard,
  ListOrdered,
  MessageSquare,
  Pill,
  Receipt,
  Share2,
  User,
  Users,
  Video,
  Building2,
} from 'lucide-react';
import { normalizeProviderMarket } from '@/lib/providerPortal';

const PROVIDER_NAV_ITEMS = {
  dashboard: { href: 'dashboard', icon: LayoutDashboard, labels: { US: 'Dashboard', NG: 'Dashboard' } },
  triageQueue: { href: 'triage-queue', icon: ListOrdered, labels: { US: 'Triage Queue', NG: 'Triage Queue' } },
  prescriptions: { href: 'prescriptions', icon: Pill, labels: { US: 'External eRx', NG: 'Prescriptions' } },
  call: { href: 'call', icon: Video, labels: { US: 'Instant Call', NG: 'Instant Call' } },
  imaging: { href: 'imaging', icon: Eye, labels: { US: 'Medical Imaging', NG: 'Medical Imaging' } },
  triage: { href: 'triage', icon: BrainCircuit, labels: { US: 'AI Triage Results', NG: 'AI Triage Results' } },
  schedule: { href: 'schedule', icon: Calendar, labels: { US: 'Schedule', NG: 'Schedule' } },
  patients: { href: 'patients', icon: Users, labels: { US: 'Patients', NG: 'Patients' } },
  visits: { href: 'visits', icon: ClipboardList, labels: { US: 'Visit Notes', NG: 'Visit Notes' } },
  claims: { href: 'claims', icon: Receipt, labels: { US: 'Claims', NG: 'Claims' } },
  referrals: { href: 'referrals', icon: Share2, labels: { US: 'Smart Referrals', NG: 'Care Referrals' } },
  hospitalNetwork: { href: 'hospital-network', icon: Building2, labels: { US: 'Hospital Network', NG: 'Hospital Network' } },
  analytics: { href: 'analytics', icon: BarChart3, labels: { US: 'Outcomes Analytics', NG: 'Operational Analytics' } },
  messages: { href: 'messages', icon: MessageSquare, labels: { US: 'Messages', NG: 'Messages' } },
  notifications: { href: 'notifications', icon: Bell, labels: { US: 'Notifications', NG: 'Notifications' } },
  profile: { href: 'profile', icon: User, labels: { US: 'Profile', NG: 'Profile' } },
};

const PROVIDER_NAV_ORDER = {
  US: [
    'dashboard',
    'triageQueue',
    'prescriptions',
    'call',
    'imaging',
    'triage',
    'schedule',
    'patients',
    'visits',
    'claims',
    'referrals',
    'hospitalNetwork',
    'analytics',
    'messages',
    'notifications',
    'profile',
  ],
  NG: [
    'dashboard',
    'triageQueue',
    'patients',
    'schedule',
    'prescriptions',
    'call',
    'visits',
    'referrals',
    'imaging',
    'triage',
    'analytics',
    'messages',
    'notifications',
    'profile',
  ],
};

const PROVIDER_PORTAL_THEME = {
  US: {
    portalColor: 'from-purple-600 to-purple-800',
    portalLabel: 'Provider',
  },
  NG: {
    portalColor: 'from-emerald-600 to-teal-700',
    portalLabel: 'Nigeria Provider',
  },
};

function resolveMarket(market = 'US') {
  return normalizeProviderMarket(market) || 'US';
}

export function getProviderPortalTheme(market = 'US') {
  return PROVIDER_PORTAL_THEME[resolveMarket(market)] || PROVIDER_PORTAL_THEME.US;
}

export function getProviderNavigation(prefix = '/provider', market = 'US') {
  const resolvedMarket = resolveMarket(market);
  const order = PROVIDER_NAV_ORDER[resolvedMarket] || PROVIDER_NAV_ORDER.US;

  return order.map((key) => {
    const item = PROVIDER_NAV_ITEMS[key];
    return {
      name: item.labels[resolvedMarket] || item.labels.US,
      href: `${prefix}/${item.href}`,
      icon: item.icon,
    };
  });
}
