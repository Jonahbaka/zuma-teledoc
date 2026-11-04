'use strict';
// Public provider documentation, not DoctaRx activation or language validation.
// Keep browser choices, server admission and homepage names on one source.
const GEMINI_LIVE_MODEL = 'gemini-3.8-live';
const LANGUAGE_SOURCE = Object.freeze({
  url: 'https://aistudio.google.com/docs/live-api/capabilities#supported-languages',
  modelUrl: 'https://aistudio.google.com/docs/models/gemini-3.8-live',
  checkedAt: '2026-11-04',
  declaredLanguageCount: 99,
});
const AFRICAN_CODES = Object.freeze(['af', 'ak', 'am', 'ar', 'ha', 'rw', 'om', 'so', 'st', 'sw', 'tn', 'wo', 'yo', 'zu']);
const DOCUMENTED_ROWS = [
  ['af', 'Afrikaans'], ['ak', 'Akan'], ['sq', 'Albanian'], ['am', 'Amharic'], ['ar', 'Arabic'],
  ['hy', 'Armenian'], ['as', 'Assamese'], ['az', 'Azerbaijani'], ['eu', 'Basque'], ['be', 'Belarusian'],
  ['bn', 'Bengali'], ['bs', 'Bosnian'], ['bg', 'Bulgarian'], ['my', 'Burmese'], ['ca', 'Catalan'],
  ['ceb', 'Cebuano'], ['zh-Hans', 'Chinese (Simplified)'], ['zh-Hant', 'Chinese (Traditional)'],
  ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'], ['en', 'English'],
  ['et', 'Estonian'], ['fo', 'Faroese'], ['fil', 'Filipino'], ['fi', 'Finnish'], ['fr', 'French'],
  ['gl', 'Galician'], ['ka', 'Georgian'], ['de', 'German'], ['el', 'Greek'], ['gu', 'Gujarati'],
  ['ha', 'Hausa'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['hu', 'Hungarian'], ['is', 'Icelandic'],
  ['id', 'Indonesian'], ['ga', 'Irish'], ['it', 'Italian'], ['ja', 'Japanese'], ['kn', 'Kannada'],
  ['kk', 'Kazakh'], ['km', 'Khmer'], ['rw', 'Kinyarwanda'], ['ko', 'Korean'], ['ku', 'Kurdish'],
  ['ky', 'Kyrgyz'], ['lo', 'Lao'], ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['mk', 'Macedonian'],
  ['ms', 'Malay'], ['ml', 'Malayalam'], ['mt', 'Maltese'], ['mi', 'Maori'], ['mr', 'Marathi'],
  ['mn', 'Mongolian'], ['ne', 'Nepali'], ['no', 'Norwegian'], ['nb', 'Norwegian Bokmål'],
  ['or', 'Odia'], ['om', 'Oromo'], ['ps', 'Pashto'], ['fa', 'Persian'], ['pl', 'Polish'],
  ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'], ['pa', 'Punjabi'],
  ['qu', 'Quechua'], ['ro', 'Romanian'], ['rm', 'Romansh'], ['ru', 'Russian'], ['sr', 'Serbian'],
  ['sd', 'Sindhi'], ['si', 'Sinhala'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['so', 'Somali'],
  ['st', 'Southern Sotho'], ['es', 'Spanish'], ['sw', 'Swahili'], ['sv', 'Swedish'], ['tg', 'Tajik'],
  ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['tn', 'Tswana'], ['tr', 'Turkish'],
  ['tk', 'Turkmen'], ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['uz', 'Uzbek'], ['vi', 'Vietnamese'],
  ['cy', 'Welsh'], ['fy', 'Western Frisian'], ['wo', 'Wolof'], ['yo', 'Yoruba'], ['zu', 'Zulu'],
];
const DOCUMENTED_GEMINI_LIVE_LANGUAGES = Object.freeze(DOCUMENTED_ROWS.map(([code, name]) => Object.freeze({
  code, name, support: 'provider_documented', african: AFRICAN_CODES.includes(code),
  spokenQualityValidated: false, clinicalUseValidated: false,
})));
// Igbo remains an evaluation option from the earlier typed-input playground
// observation. It is absent from the checked Live table, so it must not be
// presented as provider-documented support or a verified spoken demonstration.
const IGBO_EVALUATION = Object.freeze({ code: 'ig', name: 'Igbo', support: 'experimental_observation', african: true,
  spokenQualityValidated: false, clinicalUseValidated: false });
const GEMINI_LIVE_LANGUAGE_CATALOG = Object.freeze([...DOCUMENTED_GEMINI_LIVE_LANGUAGES, IGBO_EVALUATION]);
const GEMINI_LIVE_LANGUAGES = Object.freeze(Object.fromEntries(GEMINI_LIVE_LANGUAGE_CATALOG.map(({ code, name }) => [code, name])));
const AFRICAN_GEMINI_LIVE_LANGUAGES = Object.freeze(DOCUMENTED_GEMINI_LIVE_LANGUAGES.filter(item => item.african));
module.exports = { GEMINI_LIVE_MODEL, LANGUAGE_SOURCE, DOCUMENTED_GEMINI_LIVE_LANGUAGES,
  GEMINI_LIVE_LANGUAGE_CATALOG, GEMINI_LIVE_LANGUAGES, AFRICAN_GEMINI_LIVE_LANGUAGES };
