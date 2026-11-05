import Link from 'next/link';
import { notFound } from 'next/navigation';
import guides from '@/lib/seo/guides.cjs';
import { SITE_URL } from '@/lib/seo/public-seo-config.cjs';
import { publicMetadata, pageGraph, serializeJsonLd } from '@/lib/seo/metadata.cjs';
export const dynamicParams = false;
export function generateStaticParams() { return guides.map(({ slug }) => ({ slug })); }
function getGuide(slug) { const guide = guides.find(item => item.slug === slug); if (!guide) notFound(); return guide; }
export async function generateMetadata({ params }) {
  const guide = getGuide((await params).slug);
  return publicMetadata({ ...guide, path: '/blog/' + guide.slug });
}
export default async function Page({ params }) {
  const guide = getGuide((await params).slug);
  const path = '/blog/' + guide.slug;
  const graph = pageGraph({ ...guide, path, breadcrumbs: [['DoctaRx', '/'], ['Guides', '/blog'], [guide.title, path]] });
  graph['@graph'].push({ '@type': 'Article', '@id': SITE_URL + path + '#article',
    headline: guide.title, description: guide.description, inLanguage: 'en',
    mainEntityOfPage: { '@id': SITE_URL + path + '#webpage' },
    author: { '@id': SITE_URL + '/#organization' }, publisher: { '@id': SITE_URL + '/#organization' },
    image: SITE_URL + '/opengraph-image',
  });
  return <main className="mx-auto max-w-3xl px-6 py-16">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }} />
    <nav aria-label="Breadcrumb" className="flex flex-wrap gap-3">
      <Link href="/" className="underline">DoctaRx</Link><span aria-hidden="true">/</span><Link href="/blog" className="underline">Guides</Link>
    </nav>
    <article>
      <h1 className="mt-8 text-4xl font-bold leading-tight">{guide.title}</h1>
      <p className="mt-4 text-sm">By DoctaRx · Product guide</p>
      <p className="mt-6 text-lg leading-8">{guide.description}</p>
      {guide.sections.map(([heading, body]) => <section key={heading} className="mt-8">
        <h2 className="text-2xl font-semibold">{heading}</h2><p className="mt-3 leading-8">{body}</p>
      </section>)}
      <aside className="mt-8 rounded-2xl bg-muted p-6 leading-7">This guide explains product use. It is not clinical advice or clinician-reviewed treatment guidance. DoctaRx is not an emergency service.</aside>
    </article>
    <nav aria-label="More help" className="mt-8 flex flex-wrap gap-6">
      <Link href={guide.href} className="underline underline-offset-4">{guide.next}</Link>
      <Link href="/blog" className="underline underline-offset-4">All guides</Link>
    </nav>
  </main>;
}
