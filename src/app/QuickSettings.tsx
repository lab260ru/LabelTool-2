import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconGlobe, IconMoon, IconSun } from '../components/icons'
import { changeLanguage, currentLanguage } from '../i18n'
import type { AppLanguage } from '../i18n'
import { useTheme } from '../theme'

/**
 * Quick settings in the rail footer: language (behind the globe button — clicking
 * it opens the RU/EN choice BELOW it) and theme (sun/moon). Labels are shown as a
 * tooltip on hover; the language choice closes on Escape and on an outside click.
 */
export function QuickSettings() {
  const { t } = useTranslation('common')
  const { theme, toggleTheme } = useTheme()
  const lang = currentLanguage()

  const [langOpen, setLangOpen] = useState(false)
  const langRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!langOpen) return
    function onPointerDown(e: PointerEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setLangOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [langOpen])

  function selectLanguage(next: AppLanguage) {
    void changeLanguage(next)
    setLangOpen(false)
  }

  const themeLabel = theme === 'light' ? t('top.themeDark') : t('top.themeLight')

  return (
    <>
      {/* Globe; clicking it opens the language choice BELOW it */}
      <div className="lt-sidebar__langwrap" ref={langRef}>
        <button
          type="button"
          className={`lt-sidebar__item lt-sidebar__globe${langOpen ? ' lt-sidebar__globe--open' : ''}`}
          onClick={() => setLangOpen((v) => !v)}
          aria-expanded={langOpen}
          aria-controls="lt-lang-choice"
          aria-label={t('top.language')}
        >
          <IconGlobe size={17} className="lt-sidebar__icon" />
          <span className="lt-sidebar__tip" aria-hidden="true">
            {t('top.language')}
          </span>
        </button>
        {langOpen && (
          <div
            className="lt-sidebar__lang"
            role="group"
            aria-label={t('top.language')}
            id="lt-lang-choice"
          >
            <button
              type="button"
              className={`lt-sidebar__langbtn${lang === 'ru' ? ' lt-sidebar__langbtn--active' : ''}`}
              aria-pressed={lang === 'ru'}
              onClick={() => selectLanguage('ru')}
              lang="ru"
            >
              RU
            </button>
            <button
              type="button"
              className={`lt-sidebar__langbtn${lang === 'en' ? ' lt-sidebar__langbtn--active' : ''}`}
              aria-pressed={lang === 'en'}
              onClick={() => selectLanguage('en')}
              lang="en"
            >
              EN
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="lt-sidebar__item lt-sidebar__theme"
        onClick={toggleTheme}
        aria-label={t('top.themeToggle')}
      >
        {theme === 'light' ? (
          <IconMoon size={17} className="lt-sidebar__icon" />
        ) : (
          <IconSun size={17} className="lt-sidebar__icon" />
        )}
        <span className="lt-sidebar__tip" aria-hidden="true">
          {themeLabel}
        </span>
      </button>
    </>
  )
}
