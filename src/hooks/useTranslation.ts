import { useAppStore } from "../store/useAppStore";
import { translations, TranslationKey, SupportedLanguage } from "../utils/translations";

const SUPPORTED_LANGUAGES = Object.keys(translations) as SupportedLanguage[];

function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}

export function useTranslation() {
  const admin = useAppStore((state) => state.admin);

  // Validate at runtime before casting — falls back to "en" if unrecognized
  const rawLang = admin?.language ?? "en";
  const lang: SupportedLanguage = isSupportedLanguage(rawLang) ? rawLang : "en";

  const dict = translations[lang];

  const t = (key: TranslationKey): string => dict[key] ?? translations.en[key] ?? key;

  // Return the resolved, validated lang so callers always get a known-good value
  return { t, lang };
}