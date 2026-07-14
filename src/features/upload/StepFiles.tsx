/**
 * Step 1 — files, two tabs:
 *  - "Files": DragDropZone (files AND folder), client-side validation before upload,
 *    yellow banner for name conflicts, list with status badges and a summary line;
 *  - "Manifest CSV/JSONL": manifest upload, preview of the first rows,
 *    column mapping (filename / task_type / orig_trb / metadata) via selects.
 */
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Banner,
  Button,
  Card,
  DragDropZone,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
} from '../../components'
import { IconX } from '../../components/icons'
import type { ManifestPreview } from '../../api/types'
import type { ColumnTarget, FileValidity, LocalFile, SbsFileStatus } from './lib'
import {
  MANIFEST_ACCEPT,
  UPLOAD_ACCEPT,
  buildMapping,
  columnTargetsFor,
  formatBytes,
  formatDuration,
  sbsPairKey,
  sbsStatuses,
  validityOf,
} from './lib'
import { IconMusicNote } from './local-icons'

export interface ManifestState {
  preview: ManifestPreview
  targets: Record<string, ColumnTarget>
}

export interface StepFilesProps {
  tab: string
  onTabChange: (id: string) => void
  /** Project type — Side-by-Side: client-side assembly of _a/_b pairs. */
  isSbs: boolean
  files: LocalFile[]
  existingNames: ReadonlySet<string>
  onAddFiles: (files: File[]) => void
  onRemoveFile: (clientId: string) => void
  onNext: () => void
  manifest: ManifestState | null
  manifestLoading: boolean
  importing: boolean
  onManifestFile: (files: File[]) => void
  onTargetChange: (column: string, target: ColumnTarget) => void
  onImport: () => void
}

const BADGE_KIND: Record<FileValidity, 'ok' | 'warn' | 'error'> = {
  ready: 'ok',
  duplicate: 'warn',
  unsupported: 'error',
  too_large: 'error',
}

/** SBS: badge color by pair status. */
const SBS_BADGE_KIND: Record<SbsFileStatus, 'ok' | 'warn' | 'error'> = {
  paired: 'ok',
  unpaired: 'warn',
  unsupported: 'error',
  too_large: 'error',
}

const PREVIEW_ROWS = 20

export function StepFiles(props: StepFilesProps) {
  const { t, i18n } = useTranslation('upload')
  const locale = i18n.language?.startsWith('ru') ? 'ru-RU' : 'en-US'
  const units = { b: t('units.b'), kb: t('units.kb'), mb: t('units.mb'), gb: t('units.gb') }
  const nf = new Intl.NumberFormat(locale)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const tabs = [
    { id: 'files', label: t('step2.tabFiles') },
    { id: 'manifest', label: t('step2.tabManifest') },
  ]

  /* ── "Files" tab ────────────────────────────────────────────────────────── */

  // Side-by-Side: _a/_b pair statuses; a regular project — client-side validation.
  const sbsMap = props.isSbs ? sbsStatuses(props.files) : null
  const rows = props.files.map((file) => {
    if (sbsMap) {
      const status = sbsMap.get(file.clientId) ?? 'unpaired'
      return { file, badgeKind: SBS_BADGE_KIND[status], statusLabel: t(`step2.status.${status}`) }
    }
    const validity = validityOf(file, props.existingNames)
    return { file, badgeKind: BADGE_KIND[validity], statusLabel: t(`step2.status.${validity}`) }
  })
  const totalSize = props.files.reduce((sum, f) => sum + f.size, 0)

  let uploadableCount: number
  let summaryLine: string
  let banner: ReactNode = null
  if (sbsMap) {
    const pairs = props.files.filter(
      (f) => sbsMap.get(f.clientId) === 'paired' && sbsPairKey(f.filename)?.side === 'a',
    ).length
    const unpaired = [...sbsMap.values()].filter((s) => s === 'unpaired').length
    uploadableCount = pairs
    // sbs summary line: "N pairs · 2N files · size".
    summaryLine = [
      t('step2.pairs', { count: pairs }),
      t('step2.files', { count: pairs * 2 }),
      formatBytes(totalSize, locale, units),
    ].join(' · ')
    if (unpaired > 0) {
      banner = <Banner kind="warning">{t('step2.unpairedBanner', { count: unpaired })}</Banner>
    }
  } else {
    const conflictCount = props.files.filter(
      (f) => validityOf(f, props.existingNames) === 'duplicate',
    ).length
    uploadableCount = props.files.filter((f) => {
      const v = validityOf(f, props.existingNames)
      return v === 'ready' || v === 'duplicate'
    }).length
    summaryLine = [
      t('step2.files', { count: props.files.length }),
      formatBytes(totalSize, locale, units),
      ...(conflictCount > 0 ? [t('step2.conflicts', { count: conflictCount })] : []),
    ].join(' · ')
    if (conflictCount > 0) {
      banner = <Banner kind="warning">{t('step2.dupBanner', { count: conflictCount })}</Banner>
    }
  }

  const filesTab = (
    <div className="lt-upload__tabbody">
      {props.isSbs && <p className="lt-caption lt-upload__sbs-hint">{t('step2.sbsHint')}</p>}
      <DragDropZone
        accept={UPLOAD_ACCEPT}
        hint={props.isSbs ? t('step2.sbsDropHint') : t('step2.dropHint')}
        onFiles={props.onAddFiles}
      />

      {banner}

      {props.files.length > 0 ? (
        <Card padding="none" className="lt-upload__filelist">
          <ul className="lt-upload__frows" aria-label={t('step2.listLabel')}>
            {rows.map(({ file, badgeKind, statusLabel }) => (
              <li key={file.clientId} className="lt-upload__frow">
                <IconMusicNote size={14} className="lt-upload__ficon" />
                <span className="lt-data lt-upload__fname" title={file.filename}>
                  {file.filename}
                </span>
                <span className="lt-data lt-upload__fmeta lt-upload__fdur">
                  {formatDuration(file.duration)}
                </span>
                <span className="lt-data lt-upload__fmeta">
                  {formatBytes(file.size, locale, units)}
                </span>
                <StatusBadge
                  kind={badgeKind}
                  label={statusLabel}
                  className="lt-upload__fbadge"
                />
                <button
                  type="button"
                  className="lt-upload__fremove"
                  aria-label={t('step2.remove', { name: file.filename })}
                  onClick={() => props.onRemoveFile(file.clientId)}
                >
                  <IconX size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="lt-upload__ffooter">
            <span className="lt-caption lt-upload__fsummary">{summaryLine}</span>
            <span className="lt-upload__spacer" />
            <Button size="sm" disabled={uploadableCount === 0} onClick={props.onNext}>
              {t('step2.next')}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="lt-upload__actions">
          <Button disabled onClick={props.onNext}>
            {t('step2.next')}
          </Button>
        </div>
      )}
    </div>
  )

  /* ── "Manifest CSV/JSONL" tab ───────────────────────────────────────────── */

  const manifestTab = (
    <div className="lt-upload__tabbody">
      {props.manifestLoading ? (
        <Card padding="lg" className="lt-upload__mloading">
          <Spinner size={28} label={t('manifest.loading')} />
          <span className="lt-caption">{t('manifest.loading')}</span>
        </Card>
      ) : props.manifest === null ? (
        <DragDropZone
          accept={MANIFEST_ACCEPT}
          multiple={false}
          title={t('manifest.dropTitle')}
          hint={t('manifest.dropHint')}
          onFiles={props.onManifestFile}
        />
      ) : (
        <ManifestPanel
          manifest={props.manifest}
          importing={props.importing}
          isSbs={props.isSbs}
          nf={nf}
          onReplace={() => replaceInputRef.current?.click()}
          onTargetChange={props.onTargetChange}
          onImport={props.onImport}
        />
      )}
      <input
        ref={replaceInputRef}
        type="file"
        hidden
        accept={MANIFEST_ACCEPT}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            props.onManifestFile(Array.from(e.target.files))
          }
          e.target.value = ''
        }}
      />
    </div>
  )

  return (
    <div className="lt-upload__step2">
      <Tabs items={tabs} value={props.tab} onChange={props.onTabChange} label={t('step2.tabsLabel')} />
      {props.tab === 'manifest' ? manifestTab : filesTab}
    </div>
  )
}

/* ── Manifest panel ──────────────────────────────────────────────────────── */

interface ManifestPanelProps {
  manifest: ManifestState
  importing: boolean
  isSbs: boolean
  nf: Intl.NumberFormat
  onReplace: () => void
  onTargetChange: (column: string, target: ColumnTarget) => void
  onImport: () => void
}

function ManifestPanel({
  manifest,
  importing,
  isSbs,
  nf,
  onReplace,
  onTargetChange,
  onImport,
}: ManifestPanelProps) {
  const { t } = useTranslation('upload')
  const { preview, targets } = manifest
  const mappingReady = buildMapping(preview.columns, targets, isSbs) !== null
  const targetOptions = columnTargetsFor(isSbs)

  const rowErrorLabel = (code: string | null): string =>
    code === null ? '' : t(`manifest.rowError.${code}`, { defaultValue: code })

  return (
    <Card padding="lg" className="lt-upload__mpanel">
      <div className="lt-upload__mhead">
        <span className="lt-data lt-upload__mchip">
          {preview.filename}
          <span className="lt-upload__mchip-note">
            · {t('manifest.rows', { count: preview.total_rows, formatted: nf.format(preview.total_rows) })}
          </span>
        </span>
        <Button variant="secondary" size="sm" onClick={onReplace}>
          {t('manifest.replace')}
        </Button>
        <span className="lt-upload__spacer" />
        <span className="lt-caption lt-upload__mvalid">
          {t('manifest.valid', { count: preview.valid_count, formatted: nf.format(preview.valid_count) })}
        </span>
        {preview.error_count > 0 && (
          <span className="lt-caption lt-upload__minvalid">
            {t('manifest.invalid', { count: preview.error_count, formatted: nf.format(preview.error_count) })}
          </span>
        )}
      </div>

      <div className="lt-upload__mmap">
        <span className="lt-caption lt-upload__mmap-label">{t('manifest.mappingLabel')}</span>
        {preview.columns.map((column) => (
          <span key={column} className="lt-upload__mmap-item">
            <span className="lt-data lt-upload__mmap-col">{column}</span>
            <span aria-hidden="true">→</span>
            <Select
              aria-label={t('manifest.columnTarget', { column })}
              value={targets[column] ?? 'skip'}
              onChange={(e) => onTargetChange(column, e.target.value as ColumnTarget)}
              className="lt-upload__mmap-select"
            >
              {targetOptions.map((target) => (
                <option key={target} value={target}>
                  {t(`manifest.target.${target}`)}
                </option>
              ))}
            </Select>
          </span>
        ))}
      </div>

      <div className="lt-upload__mtable-wrap" role="region" aria-label={t('manifest.previewLabel')} tabIndex={0}>
        <table className="lt-upload__mtable">
          <thead>
            <tr>
              {preview.columns.map((column) => (
                <th key={column} scope="col" className="lt-data">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, PREVIEW_ROWS).map((row) => {
              const firstEmpty = preview.columns.find((c) => !row.cells[c])
              return (
                <tr key={row.index} className={row.valid ? undefined : 'lt-upload__mrow--invalid'}>
                  {preview.columns.map((column) => (
                    <td key={column} className="lt-data">
                      {row.cells[column] ||
                        (!row.valid && column === firstEmpty ? (
                          <span className="lt-upload__mrow-err">— {rowErrorLabel(row.error)}</span>
                        ) : (
                          ''
                        ))}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="lt-upload__actions">
        <Button disabled={!mappingReady} loading={importing} onClick={onImport}>
          {t('manifest.import', {
            count: preview.valid_count,
            formatted: nf.format(preview.valid_count),
          })}
        </Button>
        {!mappingReady && (
          <span className="lt-caption lt-upload__mhint">
            {t(isSbs ? 'manifest.needPair' : 'manifest.needFilename')}
          </span>
        )}
      </div>
    </Card>
  )
}
