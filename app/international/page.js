import InternationalPage from '@/components/marketing/InternationalPage';
import content from '@/lib/seo/international-content.cjs';
import { INTERNATIONAL_ALTERNATES } from '@/lib/seo/public-seo-config.cjs';
import { publicMetadata } from '@/lib/seo/metadata.cjs';
export const metadata = publicMetadata({ ...content.en, path: '/international', alternates: INTERNATIONAL_ALTERNATES });
export default function Page() { return <InternationalPage />; }
