import { notFound } from 'next/navigation';
import InternationalPage from '@/components/marketing/InternationalPage';
import content from '@/lib/seo/international-content.cjs';
import { LANGUAGE_PATHS, INTERNATIONAL_ALTERNATES } from '@/lib/seo/public-seo-config.cjs';
import { publicMetadata } from '@/lib/seo/metadata.cjs';
export const dynamicParams = false;
export function generateStaticParams() {
  return Object.keys(content).filter(language => language !== 'en').map(language => ({ language }));
}
function getCopy(language) {
  if (language === 'en' || !Object.hasOwn(content, language)) notFound();
  return content[language];
}
export async function generateMetadata({ params }) {
  const { language } = await params;
  const copy = getCopy(language);
  return publicMetadata({ ...copy, path: LANGUAGE_PATHS[language], language, alternates: INTERNATIONAL_ALTERNATES });
}
export default async function Page({ params }) {
  const { language } = await params;
  getCopy(language);
  return <InternationalPage language={language} />;
}
