#!/usr/bin/env node
/**
 * i18n completeness check — CI-friendly: `node scripts/i18n-check.mjs`.
 *
 * What it does:
 *  1. Collects all ru/en dictionaries: common (src/i18n) + all registerFeatureI18n modules
 *     (src/features/<f>/i18n.ts, src/components/audio/i18n.ts, src/components/showcase/Showcase.tsx,
 *     src/features/export/i18n.ts — registered from index.tsx).
 *  2. Compares ru↔en key sets (plural forms _one/_few/_many/_other collapse into a family).
 *  3. Checks completeness of plural families: ru — _one/_few/_many, en — _one/_other.
 *  4. Looks for empty values and {{placeholder}} mismatches between languages.
 *  5. Looks for keys with identical ru=en text (except known-common ones: LabelTool 2, JSONL, CSV…).
 *
 * Exit: code 0 — no discrepancies; code 1 — there are some (list in stdout).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')

/* ---------------------------------------------------------------- sources */

/** Dictionary files: { file, namespace, ruVar, enVar } */
function collectSources() {
  const sources = [
    { file: 'src/i18n/common.ru.ts', namespace: 'common', ruVar: 'commonRu', enVar: null },
    { file: 'src/i18n/common.en.ts', namespace: 'common', ruVar: null, enVar: 'commonEn' },
  ]
  const featureDirs = readdirSync(join(root, 'src/features'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join('src/features', d.name, 'i18n.ts'))
  const extra = ['src/components/audio/i18n.ts', 'src/components/showcase/Showcase.tsx']
  for (const rel of [...featureDirs, ...extra]) {
    if (!existsSync(join(root, rel))) continue
    const ns = rel.includes('components/audio')
      ? 'audio'
      : rel.includes('showcase')
        ? 'showcase'
        : rel.split('/')[2]
    sources.push({ file: rel, namespace: ns, ruVar: 'ru', enVar: 'en' })
  }
  return sources
}

/* ------------------------------------------------- literal extraction/eval */

/**
 * Extracts the object literal `const <name>(: type)? = { … }` from the source —
 * brace-matching that accounts for strings ('…', "…", `…`) and comments.
 */
function extractObjectLiteral(source, varName, file) {
  const decl = new RegExp(`(?:export\\s+)?const\\s+${varName}\\s*(?::[^=]+)?=\\s*\\{`)
  const m = decl.exec(source)
  if (!m) return null
  const start = m.index + m[0].length - 1 // position of '{'
  let depth = 0
  let i = start
  let mode = null // null | "'" | '"' | '`' | '//' | '/*'
  for (; i < source.length; i++) {
    const ch = source[i]
    const two = source.slice(i, i + 2)
    if (mode === null) {
      if (ch === "'" || ch === '"' || ch === '`') mode = ch
      else if (two === '//') mode = '//'
      else if (two === '/*') mode = '/*'
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return source.slice(start, i + 1)
      }
    } else if (mode === '//') {
      if (ch === '\n') mode = null
    } else if (mode === '/*') {
      if (two === '*/') { mode = null; i++ }
    } else {
      // string literal
      if (ch === '\\') i++
      else if (ch === mode) mode = null
    }
  }
  throw new Error(`${file}: failed to match braces for const ${varName}`)
}

function evalObject(literal, file, varName) {
  try {
    return new Function(`return (${literal})`)()
  } catch (e) {
    throw new Error(`${file}: const ${varName} does not evaluate as JS: ${e.message}`)
  }
}

/* --------------------------------------------------------------- flatten */

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object') flatten(v, path, out)
    else out.set(path, String(v ?? ''))
  }
  return out
}

const PLURAL_SUFFIX = /_(one|few|many|other)$/

/** 'files_one' → { family: 'files_#plural', form: 'one' }; ordinary key — form: null */
function canonical(key) {
  const m = PLURAL_SUFFIX.exec(key)
  return m ? { family: key.replace(PLURAL_SUFFIX, '_#plural'), form: m[1] } : { family: key, form: null }
}

function placeholders(value) {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',')
}

/* -------------------------------------------------------------- allowlist */

/** Known-common values for ru/en — a match is not treated as an error. */
const EQUAL_ALLOWLIST = new Set([
  'LabelTool 2',
  'Side-by-Side',
  'JSONL', 'CSV', 'NeMo manifest', 'Praat TextGrid', 'CoNLL', 'SRT / VTT', 'NER',
  'filename', 'filename_a', 'filename_b', 'task_type', 'orig_trb',
  '↑ CSV: filename → text',
  'i.petrov',
  'S',
  'A',
  'B',
  '16 px',
])
/** Values with no letters outside {{placeholders}} (—, ·, {{n}} · {{pct}}% …) are also skipped. */
const NO_LETTERS = /^[^A-Za-zА-Яа-яЁё]*$/
const stripPlaceholders = (v) => v.replace(/\{\{\w+\}\}/g, '')

/* ------------------------------------------------------------------ main */

const problems = []
const namespaces = new Map() // ns → { ru: Map, en: Map, files: [] }

for (const src of collectSources()) {
  const abs = join(root, src.file)
  const text = readFileSync(abs, 'utf8')
  const entry = namespaces.get(src.namespace) ?? { ru: null, en: null, files: [] }
  entry.files.push(src.file)
  for (const [lang, varName] of [['ru', src.ruVar], ['en', src.enVar]]) {
    if (!varName) continue
    const literal = extractObjectLiteral(text, varName, src.file)
    if (literal === null) {
      problems.push(`[${src.namespace}] ${src.file}: const not found ${varName}`)
      continue
    }
    entry[lang] = flatten(evalObject(literal, src.file, varName))
  }
  namespaces.set(src.namespace, entry)
}

let equalCount = 0
for (const [ns, { ru, en, files }] of [...namespaces.entries()].sort()) {
  if (!ru || !en) {
    problems.push(`[${ns}] no ru/en dictionary pair (${files.join(', ')})`)
    continue
  }

  // 1. Key sets (plurals — by family)
  const famRu = new Map() // family → Set(forms)
  const famEn = new Map()
  for (const [map, fams] of [[ru, famRu], [en, famEn]]) {
    for (const key of map.keys()) {
      const { family, form } = canonical(key)
      if (!fams.has(family)) fams.set(family, new Set())
      if (form) fams.get(family).add(form)
    }
  }
  for (const family of famRu.keys()) {
    if (!famEn.has(family)) problems.push(`[${ns}] ключ есть в ru, нет в en: ${family}`)
  }
  for (const family of famEn.keys()) {
    if (!famRu.has(family)) problems.push(`[${ns}] ключ есть в en, нет в ru: ${family}`)
  }

  // 2. Completeness of plural families (ru: one/few/many; en: one/other)
  for (const [family, forms] of famRu) {
    if (!family.endsWith('_#plural')) continue
    for (const need of ['one', 'few', 'many']) {
      if (!forms.has(need)) problems.push(`[${ns}] ru: нет формы _${need} у ${family}`)
    }
  }
  for (const [family, forms] of famEn) {
    if (!family.endsWith('_#plural')) continue
    for (const need of ['one', 'other']) {
      if (!forms.has(need)) problems.push(`[${ns}] en: нет формы _${need} у ${family}`)
    }
  }

  // 3. Empty values
  for (const [lang, map] of [['ru', ru], ['en', en]]) {
    for (const [key, value] of map) {
      if (value.trim() === '') problems.push(`[${ns}] ${lang}: пустое значение у ${key}`)
    }
  }

  // 4. {{placeholder}} mismatch (for exact key pairs)
  for (const [key, ruVal] of ru) {
    if (!en.has(key)) continue
    const pRu = placeholders(ruVal)
    const pEn = placeholders(en.get(key))
    if (pRu !== pEn) {
      problems.push(`[${ns}] плейсхолдеры ru≠en у ${key}: {${pRu}} vs {${pEn}}`)
    }
  }

  // 5. Identical ru=en text (outside the allowlist)
  for (const [key, ruVal] of ru) {
    if (!en.has(key)) continue
    const enVal = en.get(key)
    if (ruVal === enVal && !EQUAL_ALLOWLIST.has(ruVal) && !NO_LETTERS.test(stripPlaceholders(ruVal))) {
      equalCount++
      problems.push(`[${ns}] ru=en (перевод не сделан?): ${key} = '${ruVal}'`)
    }
  }
}

/* ---------------------------------------------------------------- report */

const nsList = [...namespaces.keys()].sort().join(', ')
console.log(`i18n-check: namespaces (${namespaces.size}): ${nsList}`)
let totalKeys = 0
for (const { ru } of namespaces.values()) totalKeys += ru?.size ?? 0
console.log(`i18n-check: ключей ru всего: ${totalKeys}`)

if (problems.length === 0) {
  console.log('i18n-check: OK — 0 расхождений')
  process.exit(0)
} else {
  console.log(`i18n-check: расхождений — ${problems.length}${equalCount ? ` (из них ru=en: ${equalCount})` : ''}`)
  for (const p of problems) console.log('  · ' + p)
  process.exit(1)
}
