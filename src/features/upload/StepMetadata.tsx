/**
 * Step 3 — metadata: per-file orig_trb ASR drafts,
 * bulk matching "↑ CSV: filename → text", key-value metadata
 * for the whole batch (KeyValueChips), "Start upload →".
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, KeyValueChips, TextField } from '../../components'
import type { KeyValuePair } from '../../components'
import type { LocalFile } from './lib'

export interface StepMetadataProps {
  files: LocalFile[]
  /** Side-by-Side: ASR drafts do not apply — the orig_trb block is hidden (contract clause 4). */
  isSbs: boolean
  origTrb: Record<string, string>
  onOrigTrbChange: (clientId: string, value: string) => void
  onCsvFile: (file: File) => void
  pairs: KeyValuePair[]
  onPairsChange: (pairs: KeyValuePair[]) => void
  onBack: () => void
  onStart: () => void
}

export function StepMetadata(props: StepMetadataProps) {
  const { t } = useTranslation('upload')
  const csvInputRef = useRef<HTMLInputElement>(null)

  return (
    <Card padding="lg" className="lt-upload__panel">
      {/* Side-by-Side: ASR drafts do not apply — the orig_trb block is hidden entirely */}
      {!props.isSbs && (
        <>
          <div className="lt-upload__subhead">
            <h2 className="lt-upload__subtitle">{t('step3.asrTitle')}</h2>
            <span className="lt-caption lt-upload__note">{t('step3.asrNote')}</span>
            <span className="lt-upload__spacer" />
            <Button variant="secondary" size="sm" onClick={() => csvInputRef.current?.click()}>
              {t('step3.csvButton')}
            </Button>
            <input
              ref={csvInputRef}
              type="file"
              hidden
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) props.onCsvFile(file)
                e.target.value = ''
              }}
            />
          </div>

          <div className="lt-upload__asr-rows">
            {props.files.map((file) => (
              <div key={file.clientId} className="lt-upload__asr-row">
                <span className="lt-data lt-upload__asr-name" title={file.filename}>
                  {file.filename}
                </span>
                <TextField
                  className="lt-upload__asr-field"
                  placeholder={t('step3.asrPlaceholder')}
                  aria-label={t('step3.asrAria', { name: file.filename })}
                  value={props.origTrb[file.clientId] ?? ''}
                  onChange={(e) => props.onOrigTrbChange(file.clientId, e.target.value)}
                />
              </div>
            ))}
          </div>

          <hr className="lt-upload__hr" />
        </>
      )}

      <div className="lt-upload__subhead">
        <h2 className="lt-upload__subtitle">{t('step3.kvTitle')}</h2>
        <span className="lt-caption lt-upload__note">{t('step3.kvNote')}</span>
      </div>
      <KeyValueChips pairs={props.pairs} onChange={props.onPairsChange} />

      <div className="lt-upload__actions">
        <Button variant="secondary" onClick={props.onBack}>
          {t('back')}
        </Button>
        <Button onClick={props.onStart}>{t('step3.start')}</Button>
      </div>
    </Card>
  )
}
