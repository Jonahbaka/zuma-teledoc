import ProviderPortalLayout from '@/components/provider/ProviderPortalLayout';

export default function ProviderLayout({ children }) {
  return <ProviderPortalLayout market="US">{children}</ProviderPortalLayout>;
}
