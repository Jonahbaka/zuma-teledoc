const { SITE_URL } = require('./public-seo-config.cjs');
function publicMetadata({ title, description, path, language = 'en', alternates }) {
  return {
    title: { absolute: title + ' | DoctaRx' }, description,
    alternates: { canonical: SITE_URL + path, ...(alternates ? { languages: alternates } : {}) },
    openGraph: { title, description, url: SITE_URL + path, siteName: 'DoctaRx', type: 'website',
      images: [{ url: SITE_URL + '/opengraph-image', width: 1200, height: 630, alt: 'DoctaRx' }] },
    twitter: { card: 'summary_large_image', title, description, images: [SITE_URL + '/opengraph-image'] },
  };
}
function serializeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function pageGraph({ title, description, path, language = 'en', breadcrumbs }) {
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': SITE_URL + path + '#webpage', url: SITE_URL + path, name: title,
      description, inLanguage: language, isPartOf: { '@id': SITE_URL + '/#website' },
      ...(breadcrumbs ? { breadcrumb: { '@id': SITE_URL + path + '#breadcrumbs' } } : {}) },
    ...(breadcrumbs ? [{ '@type': 'BreadcrumbList', '@id': SITE_URL + path + '#breadcrumbs',
      itemListElement: breadcrumbs.map(([name, route], index) => ({ '@type': 'ListItem', position: index + 1, name, item: SITE_URL + route })) }] : []),
  ] };
}
module.exports = { publicMetadata, serializeJsonLd, pageGraph };
