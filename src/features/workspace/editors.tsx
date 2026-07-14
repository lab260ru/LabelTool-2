/**
 * Workspace center zone by task type:
 * transcription · verification · classification · segmentation/diarization ·
 * MOS rating (1–5 scale). All editors are controlled: the state (Draft)
 * is held by TaskWorkspace.
 */
import { useTranslation } from 'react-i18next'
import type { LabelClass, MosScale, MosScore, SbsPreference } from '../../api/types'
import { MOS_SCORES } from '../../api/types'
import { Banner, Button, Card, ClassChip, Select, TextArea } from '../../components'
import { formatTime } from '../../components/audio'
import { IconPlay } from '../../components/audio/icons'
import { IconX } from '../../components/icons'
import type { RegionDraft, VerificationChoice } from './lib'

// ── Class/speaker chip-button (wrapper over ClassChip) ──────────────────────

interface ChipToggleProps {
  options: LabelClass[]
  selectedIdx: number | null
  onPick: (idx: number) => void
  /** ARIA label of the group. */
  label: string
  /** Show 1–9 hotkey hints. */
  withDigits?: boolean
}

function ChipToggleGroup({ options, selectedIdx, onPick, label, withDigits = true }: ChipToggleProps) {
  return (
    <div className="ws-chips" role="group" aria-label={label}>
      {options.map((option, i) => (
        <button
          key={option.name}
          type="button"
          className={`ws-chipbtn${i === selectedIdx ? ' ws-chipbtn--active' : ''}`}
          aria-pressed={i === selectedIdx}
          onClick={() => onPick(i)}
        >
          <ClassChip label={option.name} color={option.color} />
          {withDigits && i < 9 && (
            <kbd className="ws-kbd" aria-hidden="true">
              {i + 1}
            </kbd>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Transcription ────────────────────────────────────────────────────────────

export function TranscriptionEditor({
  text,
  onChange,
}: {
  text: string
  onChange: (text: string) => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <Card>
      <TextArea
        label={t('tr.label')}
        hint={t('tr.hint')}
        rows={7}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    </Card>
  )
}

// ── Verification ─────────────────────────────────────────────────────────────

export function VerificationEditor({
  text,
  author,
  choice,
  corrected,
  onChoice,
  onCorrected,
}: {
  text: string
  author: string | null
  choice: VerificationChoice | null
  corrected: string
  onChoice: (choice: VerificationChoice) => void
  onCorrected: (text: string) => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <Card title={t('ver.prompt')}>
      <blockquote className="ws-verify-text">{text}</blockquote>
      {author && <p className="ws-verify-author lt-caption">{t('ver.author', { fio: author })}</p>}
      <div className="ws-verify-actions" role="group" aria-label={t('ver.prompt')}>
        <Button
          variant={choice === 'yes' ? 'primary' : 'secondary'}
          aria-pressed={choice === 'yes'}
          onClick={() => onChoice('yes')}
        >
          {t('ver.yes')}
        </Button>
        <Button
          variant={choice === 'no' ? 'danger' : 'secondary'}
          aria-pressed={choice === 'no'}
          onClick={() => onChoice('no')}
        >
          {t('ver.no')}
        </Button>
        <Button
          variant={choice === 'fix' ? 'primary' : 'secondary'}
          aria-pressed={choice === 'fix'}
          onClick={() => onChoice('fix')}
        >
          {t('ver.fix')}
        </Button>
      </div>
      {choice === 'fix' && (
        <TextArea
          label={t('ver.fixLabel')}
          rows={5}
          value={corrected}
          onChange={(e) => onCorrected(e.target.value)}
        />
      )}
    </Card>
  )
}

// ── Classification ───────────────────────────────────────────────────────────

export function ClassificationEditor({
  labels,
  selected,
  onSelect,
}: {
  labels: LabelClass[]
  selected: string | null
  onSelect: (name: string) => void
}) {
  const { t } = useTranslation('workspace')
  if (labels.length === 0) {
    return (
      <Card title={t('cls.prompt')}>
        <Banner kind="warning">{t('cls.noLabels')}</Banner>
      </Card>
    )
  }
  const selectedIdx = labels.findIndex((l) => l.name === selected)
  return (
    <Card title={t('cls.prompt')}>
      <p className="ws-muted lt-caption">{t('cls.hint')}</p>
      <ChipToggleGroup
        options={labels}
        selectedIdx={selectedIdx === -1 ? null : selectedIdx}
        onPick={(i) => onSelect(labels[i].name)}
        label={t('cls.prompt')}
      />
    </Card>
  )
}

// ── MOS rating (configurable project scales, each 1–5) ───────────────────────

/**
 * A card per project scale: title — the scale name, 5 buttons
 * "N — label" (label from the scale's labels or a localized default).
 * The active scale is the first unrated one: highlighted (aria-current), the
 * 1–5 hotkeys act on it (key hints are visible only on the active one).
 * data-mos-scale — the focus target after rating via a hotkey.
 */
export function MosEditor({
  scales,
  scores,
  activeName,
  onRate,
}: {
  scales: MosScale[]
  scores: Record<string, MosScore>
  activeName: string | null
  onRate: (scale: string, score: MosScore) => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <div className="ws-mos-scales" role="group" aria-label={t('mos.prompt')}>
      <p className="ws-muted lt-caption ws-mos-scales__hint">{t('mos.hint')}</p>
      {scales.map((scale) => {
        const active = scale.name === activeName
        const score = scores[scale.name] ?? null
        return (
          <Card
            key={scale.name}
            title={scale.name}
            className={`ws-mos-card${active ? ' ws-mos-card--active' : ''}`}
          >
            <div
              className="ws-mos"
              role="group"
              aria-label={scale.name}
              aria-current={active ? 'true' : undefined}
              tabIndex={-1}
              data-mos-scale={scale.name}
            >
              {MOS_SCORES.map((value) => {
                const label = scale.labels?.[`${value}`] ?? t(`mos.scale.${value}`)
                return (
                  <button
                    key={value}
                    type="button"
                    className={`ws-mosbtn${value === score ? ' ws-mosbtn--active' : ''}`}
                    aria-pressed={value === score}
                    aria-label={`${value} — ${label}`}
                    onClick={() => onRate(scale.name, value)}
                  >
                    <span className="ws-mosbtn__score lt-data">{value}</span>
                    <span className="ws-mosbtn__label">{label}</span>
                    {active && (
                      <kbd className="ws-kbd" aria-hidden="true">
                        {value}
                      </kbd>
                    )}
                  </button>
                )
              })}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── Side-by-Side: preference scale (5 buttons in a row) ──────────────────────

/**
 * 5-point preference scale IN TERMS OF THE SHOWN order (without system names
 * — blind comparison): -2 "Variant 1 is much better" … +2 "Variant 2 is much
 * better". Hotkeys 1–5 map to the buttons left to right.
 */
const SBS_OPTIONS: { pref: SbsPreference; key: string }[] = [
  { pref: -2, key: 'sbs.much1' },
  { pref: -1, key: 'sbs.slight1' },
  { pref: 0, key: 'sbs.equal' },
  { pref: 1, key: 'sbs.slight2' },
  { pref: 2, key: 'sbs.much2' },
]

export function SbsScale({
  value,
  onSelect,
}: {
  value: SbsPreference | null
  onSelect: (pref: SbsPreference) => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <Card title={t('sbs.prompt')}>
      <p className="ws-muted lt-caption">{t('sbs.hint')}</p>
      <div className="ws-sbs-scale" role="group" aria-label={t('sbs.prompt')}>
        {SBS_OPTIONS.map(({ pref, key }, i) => (
          <button
            key={pref}
            type="button"
            className={`ws-sbsbtn${pref === value ? ' ws-sbsbtn--active' : ''}`}
            aria-pressed={pref === value}
            onClick={() => onSelect(pref)}
          >
            <span className="ws-sbsbtn__label">{t(key)}</span>
            <kbd className="ws-kbd" aria-hidden="true">
              {i + 1}
            </kbd>
          </button>
        ))}
      </div>
    </Card>
  )
}

// ── Segmentation / diarization ───────────────────────────────────────────────

export interface RegionsEditorProps {
  mode: 'segmentation' | 'diarization'
  /** Classes (label_list) or speakers "Speaker 1..N". */
  options: LabelClass[]
  segments: RegionDraft[]
  activeId: string | null
  armedIdx: number
  onArm: (idx: number) => void
  onSelect: (id: string) => void
  onSetLabel: (id: string, labelIdx: number) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onPlaySegment: (id: string) => void
}

export function RegionsEditor({
  mode,
  options,
  segments,
  activeId,
  armedIdx,
  onArm,
  onSelect,
  onSetLabel,
  onRemove,
  onAdd,
  onPlaySegment,
}: RegionsEditorProps) {
  const { t } = useTranslation('workspace')
  const paletteLabel = t(mode === 'diarization' ? 'seg.speakers' : 'seg.labels')
  const columnLabel = t(mode === 'diarization' ? 'seg.colSpeaker' : 'seg.colLabel')
  const ordered = [...segments].sort((a, b) => a.start - b.start)

  return (
    <Card title={t('seg.listTitle')}>
      <div className="ws-seg-toolbar">
        <div className="ws-seg-palette">
          <span className="ws-muted lt-caption">{paletteLabel}</span>
          <ChipToggleGroup
            options={options}
            selectedIdx={armedIdx}
            onPick={onArm}
            label={paletteLabel}
          />
        </div>
        {/* kbd — in the rightIcon slot: inside lt-btn__label the button's flex-gap doesn't apply */}
        <Button
          variant="secondary"
          size="sm"
          onClick={onAdd}
          rightIcon={
            <kbd className="ws-kbd" aria-hidden="true">
              S
            </kbd>
          }
        >
          {t('seg.add')}
        </Button>
      </div>

      {ordered.length === 0 ? (
        <p className="ws-muted">{t('seg.empty')}</p>
      ) : (
        <ul className="ws-seg-list">
          {ordered.map((segment, i) => {
            const option = options[segment.labelIdx]
            const active = segment.id === activeId
            return (
              <li key={segment.id} className={`ws-seg-row${active ? ' ws-seg-row--active' : ''}`}>
                <button
                  type="button"
                  className="ws-seg-pick"
                  aria-pressed={active}
                  aria-label={t('seg.select', { n: i + 1 })}
                  onClick={() => onSelect(segment.id)}
                >
                  <span
                    className="ws-seg-dot"
                    style={{ background: option?.color }}
                    aria-hidden="true"
                  />
                  <span className="lt-data">{i + 1}</span>
                </button>

                <Select
                  className="ws-seg-select"
                  aria-label={columnLabel}
                  value={String(segment.labelIdx)}
                  onChange={(e) => onSetLabel(segment.id, Number(e.target.value))}
                >
                  {options.map((o, idx) => (
                    <option key={o.name} value={idx}>
                      {o.name}
                    </option>
                  ))}
                </Select>

                <span className="ws-seg-time lt-data">
                  {formatTime(segment.start)} – {formatTime(segment.end)}
                </span>

                <span className="ws-seg-actions">
                  <button
                    type="button"
                    className="ws-iconbtn"
                    aria-label={t('seg.play')}
                    onClick={() => onPlaySegment(segment.id)}
                  >
                    <IconPlay size={14} />
                  </button>
                  <button
                    type="button"
                    className="ws-iconbtn ws-iconbtn--danger"
                    aria-label={t('seg.remove')}
                    onClick={() => onRemove(segment.id)}
                  >
                    <IconX size={14} />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
