import {
  BarChart3,
  Building2,
  Calendar,
  ClipboardList,
  HeartPulse,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Package,
  Pill,
  Search,
  Settings,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react';

export const nigeriaPatientNavigation = [
  { name: 'Dashboard', href: '/ng/patient', icon: LayoutDashboard },
  { name: 'Appointments', href: '/ng/patient/appointments', icon: Calendar },
  { name: 'Prescriptions', href: '/ng/patient/prescriptions', icon: Pill },
  { name: 'Orders', href: '/ng/patient/orders', icon: Package },
  { name: 'Find Care', href: '/ng/patient/search', icon: Search },
  { name: 'Records', href: '/ng/patient/records', icon: FileText },
  { name: 'Messages', href: '/ng/patient/messages', icon: MessageSquare },
  { name: 'Profile', href: '/ng/patient/profile', icon: User },
];

export const nigeriaPharmacyNavigation = [
  { name: 'Dashboard', href: '/ng/pharmacy/dashboard', icon: LayoutDashboard },
  { name: 'Orders', href: '/ng/pharmacy/orders', icon: ClipboardList },
  { name: 'Inventory', href: '/ng/pharmacy/inventory', icon: Pill },
  { name: 'Wallet', href: '/ng/pharmacy/wallet', icon: Wallet },
  { name: 'Settings', href: '/ng/pharmacy/settings', icon: Settings },
];

export const nigeriaAdminNavigation = [
  { name: 'Dashboard', href: '/ng/admin', icon: LayoutDashboard },
  { name: 'Public Health Programme', href: '/ng/admin/public-health-programme', icon: HeartPulse },
  { name: 'Pharmacies', href: '/ng/admin/pharmacies', icon: Building2 },
  { name: 'Analytics', href: '/ng/admin/analytics', icon: BarChart3 },
  { name: 'Compliance', href: '/ng/admin/compliance', icon: ShieldCheck },
  { name: 'Revenue', href: '/ng/admin/revenue', icon: Wallet },
];
