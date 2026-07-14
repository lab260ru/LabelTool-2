/**
 * Self-hosted fonts via @fontsource (no external CDNs).
 *
 * IMPORTANT — a deliberate decision about Cyrillic in headings:
 * Sora has NO Cyrillic glyphs (Google Fonts ships only
 * latin/latin-ext), whereas Manrope does have Cyrillic. Hence the heading stack is
 * 'Sora', 'Manrope', sans-serif: Latin and digits are rendered by Sora 600/700,
 * while Cyrillic headings fall back to Manrope 700. This is also recorded in the
 * comment on --font-heading in tokens.css. Do NOT "fix" this by adding
 * Sora Cyrillic — it does not exist.
 *
 * Weights: Sora 600/700 (H2/H1), Manrope 500/700 (text/accents).
 */

// Sora — only latin + latin-ext (no Cyrillic)
import '@fontsource/sora/latin-600.css'
import '@fontsource/sora/latin-ext-600.css'
import '@fontsource/sora/latin-700.css'
import '@fontsource/sora/latin-ext-700.css'

// Manrope — latin + Cyrillic (the primary UI language is ru)
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-ext-500.css'
import '@fontsource/manrope/cyrillic-500.css'
import '@fontsource/manrope/cyrillic-ext-500.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/manrope/latin-ext-700.css'
import '@fontsource/manrope/cyrillic-700.css'
import '@fontsource/manrope/cyrillic-ext-700.css'
