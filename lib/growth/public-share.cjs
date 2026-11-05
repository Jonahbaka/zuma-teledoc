// Deliberately independent of the browser URL, account state and caller text.
// Add destinations only after verifying they are public editorial pages.
const DESTINATIONS = Object.freeze({
  providers: Object.freeze({ title: 'DoctaRx for providers', url: 'https://doctarx.com/for-providers', text: 'Explore connected virtual care workflows for your practice with DoctaRx.' }),
  partners: Object.freeze({ title: 'Partner with DoctaRx', url: 'https://doctarx.com/partners', text: 'Explore a focused care-access pilot with DoctaRx.' }),
  international: Object.freeze({ title: 'Explore DoctaRx', url: 'https://doctarx.com/international', text: 'Explore DoctaRx and check care availability for your location.' }),
  internationalEs: Object.freeze({ title: 'Conoce DoctaRx', url: 'https://doctarx.com/international/es', text: 'Conoce DoctaRx y consulta la disponibilidad de atención en tu ubicación.' }),
  internationalFr: Object.freeze({ title: 'Découvrez DoctaRx', url: 'https://doctarx.com/international/fr', text: 'Découvrez DoctaRx et vérifiez les soins disponibles dans votre région.' }),
  internationalPt: Object.freeze({ title: 'Conheça a DoctaRx', url: 'https://doctarx.com/international/pt', text: 'Conheça a DoctaRx e consulte a disponibilidade de atendimento na sua região.' }),
  internationalAr: Object.freeze({ title: 'تعرّف على DoctaRx', url: 'https://doctarx.com/international/ar', text: 'تعرّف على DoctaRx وتحقق من توفر الرعاية في منطقتك.' }),
  company: Object.freeze({ title: 'About DoctaRx', url: 'https://doctarx.com/company', text: 'Learn about DoctaRx and its connected care platform.' }),
  press: Object.freeze({ title: 'DoctaRx press resources', url: 'https://doctarx.com/press', text: 'Explore the DoctaRx press resources and company information.' }),
});

function getPublicShare(destination) {
  if (typeof destination !== 'string' || !Object.hasOwn(DESTINATIONS, destination)) return null;
  const entry = DESTINATIONS[destination];
  return Object.freeze({
    ...entry,
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(entry.text + ' ' + entry.url),
    linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(entry.url),
  });
}

module.exports = { getPublicShare };
