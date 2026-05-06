import { redirect } from 'next/navigation';

export const metadata = {
  title: 'DoctaRx Pricing',
  description: 'View DoctaRx care plans, consultation access, and role-specific registration options.',
};

export default function PricingRedirectPage() {
  redirect('/#pricing');
}
