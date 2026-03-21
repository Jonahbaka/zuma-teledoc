import {
  LayoutDashboard,
  Calendar,
  Users,
  MessageSquare,
  Bell,
  User,
  Receipt,
  BrainCircuit,
  Video,
  Eye,
  Pill,
  ListOrdered,
  Share2,
  Building2,
  BarChart3,
  ClipboardList,
} from 'lucide-react';

export function getProviderNavigation(prefix = '/provider') {
  return [
    { name: 'Dashboard', href: `${prefix}/dashboard`, icon: LayoutDashboard },
    { name: 'Triage Queue', href: `${prefix}/triage-queue`, icon: ListOrdered },
    { name: 'External eRx', href: `${prefix}/prescriptions`, icon: Pill },
    { name: 'Instant Call', href: `${prefix}/call`, icon: Video },
    { name: 'Medical Imaging', href: `${prefix}/imaging`, icon: Eye },
    { name: 'AI Triage Results', href: `${prefix}/triage`, icon: BrainCircuit },
    { name: 'Schedule', href: `${prefix}/schedule`, icon: Calendar },
    { name: 'Patients', href: `${prefix}/patients`, icon: Users },
    { name: 'Visit Notes', href: `${prefix}/visits`, icon: ClipboardList },
    { name: 'Claims', href: `${prefix}/claims`, icon: Receipt },
    { name: 'Smart Referrals', href: `${prefix}/referrals`, icon: Share2 },
    { name: 'Hospital Network', href: `${prefix}/hospital-network`, icon: Building2 },
    { name: 'Outcomes Analytics', href: `${prefix}/analytics`, icon: BarChart3 },
    { name: 'Messages', href: `${prefix}/messages`, icon: MessageSquare },
    { name: 'Notifications', href: `${prefix}/notifications`, icon: Bell },
    { name: 'Profile', href: `${prefix}/profile`, icon: User },
  ];
}
