/**
 * LabelTool 2 i18n infrastructure: i18next + react-i18next,
 * ru is the primary language, en the second. Detection: stored choice → browser language.
 *
 * Contract for features: a feature's keys live in its own folder and are
 * registered via registerFeatureI18n(namespace, { ru, en }).
 */
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import commonEn from './common.en'
import commonRu from './common.ru'

export const SUPPORTED_LANGUAGES = ['ru', 'en'] as const
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number]

const STORAGE_KEY = 'lt2.lang'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ru: { common: commonRu },
      en: { common: commonEn },
    },
    fallbackLng: 'ru',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    nonExplicitSupportedLngs: true,
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React escapes on its own
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: STORAGE_KEY,
    },
    returnNull: false,
  })

/** Correct lang on <html>. */
function syncDocumentLanguage(lng: string) {
  document.documentElement.lang = lng.startsWith('ru') ? 'ru' : 'en'
}

syncDocumentLanguage(i18n.language || 'ru')
i18n.on('languageChanged', syncDocumentLanguage)

/** The current language, coerced to a supported one. */
export function currentLanguage(): AppLanguage {
  return i18n.language?.startsWith('en') ? 'en' : 'ru'
}

/** Switch the language (the choice is persisted by the detector in localStorage). */
export function changeLanguage(lng: AppLanguage): Promise<unknown> {
  return i18n.changeLanguage(lng)
}

/**
 * CONTRACT: registering a feature's translations.
 * Called at the feature module's top level before its components first render:
 *   registerFeatureI18n('upload', { ru, en })
 * Re-registering the same namespace is safe (deep-merge with overwrite —
 * supports HMR).
 */
export function registerFeatureI18n(
  namespace: string,
  resources: { ru: Record<string, unknown>; en: Record<string, unknown> },
): void {
  i18n.addResourceBundle('ru', namespace, resources.ru, true, true)
  i18n.addResourceBundle('en', namespace, resources.en, true, true)
}

export default i18n
