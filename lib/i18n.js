// Minimal i18n layer (no external deps).
// - Dictionary-based translations
// - Locale auto-detect (browser)
// - LocalStorage persistence

export const DEFAULT_LANG = 'en';
export const I18N_STORAGE_KEY = 'doctarx.lang';

export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Espanol' },
  { code: 'pt', label: 'Portugues' },
  { code: 'fr', label: 'Francais' },
  { code: 'hi', label: 'Hindi' }
];

// Keep keys stable; add as needed.
const DICT = {
  en: {
    'common.language': 'Language',
    'common.country': 'Country',
    'common.phone': 'Phone',
    'common.address': 'Address',
    'common.postalCode': 'Postal code',
    'common.state': 'State',
    'common.province': 'Province',
    'common.region': 'Region',
    'common.city': 'City',
    'common.continue': 'Continue',
    'common.back': 'Back',
    'signup.title': 'Global Sign Up',
    'signup.patient': 'Patient',
    'signup.provider': 'Provider'
  },
  es: {
    'common.language': 'Idioma',
    'common.country': 'Pais',
    'common.phone': 'Telefono',
    'common.address': 'Direccion',
    'common.postalCode': 'Codigo postal',
    'common.state': 'Estado',
    'common.province': 'Provincia',
    'common.region': 'Region',
    'common.city': 'Ciudad',
    'common.continue': 'Continuar',
    'common.back': 'Atras',
    'signup.title': 'Registro global',
    'signup.patient': 'Paciente',
    'signup.provider': 'Proveedor'
  },
  pt: {
    'common.language': 'Idioma',
    'common.country': 'Pais',
    'common.phone': 'Telefone',
    'common.address': 'Endereco',
    'common.postalCode': 'Codigo postal',
    'common.state': 'Estado',
    'common.province': 'Provincia',
    'common.region': 'Regiao',
    'common.city': 'Cidade',
    'common.continue': 'Continuar',
    'common.back': 'Voltar',
    'signup.title': 'Cadastro global',
    'signup.patient': 'Paciente',
    'signup.provider': 'Prestador'
  },
  fr: {
    'common.language': 'Langue',
    'common.country': 'Pays',
    'common.phone': 'Telephone',
    'common.address': 'Adresse',
    'common.postalCode': 'Code postal',
    'common.state': 'Etat',
    'common.province': 'Province',
    'common.region': 'Region',
    'common.city': 'Ville',
    'common.continue': 'Continuer',
    'common.back': 'Retour',
    'signup.title': 'Inscription mondiale',
    'signup.patient': 'Patient',
    'signup.provider': 'Prestataire'
  },
  hi: {
    'common.language': 'Bhasha',
    'common.country': 'Desh',
    'common.phone': 'Phone',
    'common.address': 'Pata',
    'common.postalCode': 'Postal code',
    'common.state': 'Rajya',
    'common.province': 'Province',
    'common.region': 'Kshetra',
    'common.city': 'Shahar',
    'common.continue': 'Jari rakhen',
    'common.back': 'Wapas',
    'signup.title': 'Global sign up',
    'signup.patient': 'Patient',
    'signup.provider': 'Provider'
  }
};

export function normalizeLang(lang) {
  const code = String(lang || '').toLowerCase().trim();
  if (!code) return DEFAULT_LANG;
  const short = code.split('-')[0];
  return SUPPORTED_LANGS.some(l => l.code === short) ? short : DEFAULT_LANG;
}

export function detectBrowserLang() {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const nav = window.navigator;
  const raw = (nav.languages && nav.languages[0]) || nav.language || DEFAULT_LANG;
  return normalizeLang(raw);
}

export function getStoredLang() {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(I18N_STORAGE_KEY);
    return v ? normalizeLang(v) : null;
  } catch {
    return null;
  }
}

export function storeLang(lang) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(I18N_STORAGE_KEY, normalizeLang(lang));
  } catch {
    // ignore
  }
}

export function t(lang, key, fallback) {
  const l = normalizeLang(lang);
  const value = DICT[l]?.[key] ?? DICT[DEFAULT_LANG]?.[key];
  if (value) return value;
  return fallback ?? key;
}

