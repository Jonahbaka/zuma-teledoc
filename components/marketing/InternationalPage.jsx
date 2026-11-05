import Link from 'next/link';
import PublicShare from '@/components/growth/PublicShare';
import content from '@/lib/seo/international-content.cjs';
import { LANGUAGE_PATHS } from '@/lib/seo/public-seo-config.cjs';
import { pageGraph, serializeJsonLd } from '@/lib/seo/metadata.cjs';

export default function InternationalPage({ language = 'en' }) {
  const copy = content[language];
  return (
    <main lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageGraph({
        title: copy.title, description: copy.description, path: LANGUAGE_PATHS[language], language,
      })) }} />
      <div className="mx-auto max-w-5xl px-6 py-12 md:py-20">
        <Link href="/" className="text-xl font-bold underline underline-offset-4">DoctaRx</Link>
        <nav aria-label={copy.language} className="my-8 flex flex-wrap gap-4">
          {Object.entries(content).map(([locale, entry]) => (
            <Link key={locale} href={LANGUAGE_PATHS[locale]} hrefLang={locale} lang={locale}
              aria-current={locale === language ? 'page' : undefined}
              className="rounded-full border border-current px-4 py-2 underline underline-offset-4 aria-[current=page]:font-bold">
              {entry.label}
            </Link>
          ))}
        </nav>
        <h1 className="max-w-4xl text-4xl font-bold leading-tight md:text-6xl">{copy.title}</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8">{copy.intro}</p>
        <section aria-labelledby="choose-region" className="my-10 rounded-2xl border border-border p-6">
          <h2 id="choose-region" className="text-2xl font-semibold">{copy.choose}</h2>
          <div className="my-5 flex flex-wrap gap-4">
            <Link href="/" hrefLang="en-US" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">{copy.us}</Link>
            <Link href="/ng" hrefLang="en-NG" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">{copy.ng}</Link>
          </div>
          <p className="max-w-3xl leading-7">{copy.availability}</p>
        </section>
        <div className="grid gap-8 md:grid-cols-2">
          {copy.sections.map(([heading, body]) => (
            <section key={heading}><h2 className="mb-3 text-2xl font-semibold">{heading}</h2><p className="leading-7">{body}</p></section>
          ))}
        </div>
        <aside className="mt-10 rounded-2xl bg-muted p-6"><p>{copy.emergency}</p></aside>
        <section className="mt-10">
          <h2 className="text-2xl font-semibold">{copy.help}</h2>
          <div className="mt-4 flex flex-wrap gap-6">
            <Link href="/contact" hrefLang="en" className="underline underline-offset-4">{copy.contact}</Link>
            <Link href="/blog" hrefLang="en" className="underline underline-offset-4">{copy.guides}</Link>
            <Link href="/privacy" hrefLang="en" className="underline underline-offset-4">{copy.privacy}</Link>
          </div>
        </section>
        <div className="mt-10"><PublicShare destination={{ en: 'international', es: 'internationalEs', fr: 'internationalFr', pt: 'internationalPt', ar: 'internationalAr' }[language]} /></div>
      </div>
    </main>
  );
}
