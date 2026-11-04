import { AFRICAN_GEMINI_LIVE_LANGUAGES, DOCUMENTED_GEMINI_LIVE_LANGUAGES } from '@/shared/voiceLanguageCatalog.cjs';
import styles from './MarketHomepage.module.css';

export default function VoiceLanguageCoverage() {
  return <div className={styles.voiceIntroCopy}>
    <p>Across Africa and beyond. A language voice experience built around the way people speak, wherever patients and providers connect.</p>
    <ul className={styles.languageList} aria-label="African language voice choices">{AFRICAN_GEMINI_LIVE_LANGUAGES.map(language => <li key={language.code}>{language.name}</li>)}</ul>
    <p className={styles.globalLanguageNote}>Plus English, French, Portuguese, Spanish and more.</p>
    <details className={styles.moreLanguages}>
      <summary>Explore more languages</summary>
      <ul className={styles.languageList} aria-label="More language voice choices">{DOCUMENTED_GEMINI_LIVE_LANGUAGES.filter(language => !language.african).map(language => <li key={language.code}>{language.name}</li>)}</ul>
    </details>
  </div>;
}
