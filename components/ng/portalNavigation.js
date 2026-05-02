import {
  BarChart3,
  Building2,
  Calendar,
  ClipboardList,
  CreditCard,
  FileText,
  Flag,
  LayoutDashboard,
  MessageSquare,
  Package,
  Pill,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  User,
  Users,
  Video,
  Wallet,
} from 'lucide-react';

export const nigeriaPatientNavigation = [
  { name: 'Dashboard', href: '/ng/patient', icon: LayoutDashboard },
  { name: 'Book Consultation', href: '/ng/patient/appointments/book', icon: Stethoscope },
  { name: 'Appointments', href: '/ng/patient/appointments', icon: Calendar },
  { name: 'Video Visits', href: '/ng/patient/call', icon: Video },
  { name: 'Prescriptions', href: '/ng/patient/prescriptions', icon: Pill },
  { name: 'Orders', href: '/ng/patient/orders', icon: Package },
  { name: 'Find Care', href: '/ng/patient/search', icon: Search },
  { name: 'Records', href: '/ng/patient/records', icon: FileText },
  { name: 'Messages', href: '/ng/patient/messages', icon: MessageSquare },
  { name: 'Profile', href: '/ng/patient/profile', icon: User },
];

export const nigeriaPharmacyNavigation = [
  { name: 'Dashboard', href: '/ng/pharmacy/dashboard', icon: LayoutDashboard },
  { name: 'Prescriptions', href: '/ng/pharmacy/prescriptions', icon: FileText },
  { name: 'Orders', href: '/ng/pharmacy/orders', icon: ClipboardList },
  { name: 'Inventory', href: '/ng/pharmacy/inventory', icon: Pill },
  { name: 'Wallet', href: '/ng/pharmacy/wallet', icon: Wallet },
  { name: 'Settings', href: '/ng/pharmacy/settings', icon: Settings },
];

export const nigeriaAdminNavigation = [
  { name: 'Dashboard', href: '/ng/admin', icon: LayoutDashboard },
  { name: 'Providers', href: '/ng/admin/providers', icon: Stethoscope },
  { name: 'Hospitals', href: '/ng/admin/hospitals', icon: Building2 },
  { name: 'Pharmacies', href: '/ng/admin/pharmacies', icon: Pill },
  { name: 'Organisations', href: '/ng/admin/organizations', icon: Users },
  { name: 'Subscriptions', href: '/ng/admin/subscriptions', icon: CreditCard },
  { name: 'Revenue', href: '/ng/admin/revenue', icon: Wallet },
  { name: 'Analytics', href: '/ng/admin/analytics', icon: BarChart3 },
  { name: 'Compliance', href: '/ng/admin/compliance', icon: ShieldCheck },
  { name: 'Feature Flags', href: '/ng/admin/features', icon: Flag },
];
