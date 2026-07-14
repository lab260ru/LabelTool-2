import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../api/client'
import type { S3Source } from '../../api/types'
import { Banner, Button, Checkbox, Modal, TextField, useToast } from '../../components'

/**
 * "Connect an S3 source" modal (the "Connecting S3 data" contract, item 4).
 * Fields: name, endpoint (prefilled http://minio:9000 — a UI hint, not a secret),
 * bucket, prefix (opt.), access_key, secret_key (password), region (opt.),
 * path_style (default on). "Test and connect" → POST create; the backend
 * checks the connection (list limit=1) — on error 400 detail='s3_connection_failed'
 * (the source is not created), shown human-readably. secret_key is entered only
 * on creation and is NEVER returned back.
 */
export interface S3ConnectModalProps {
  open: boolean
  projectId: number
  onClose: () => void
  onConnected: (source: S3Source) => void
}

/** Default endpoint from the app's S3 config (docker) — a hint, not a secret autofill. */
const DEFAULT_ENDPOINT = 'http://minio:9000'

export function S3ConnectModal({ open, projectId, onClose, onConnected }: S3ConnectModalProps) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const nameId = useId()

  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT)
  const [bucket, setBucket] = useState('')
  const [prefix, setPrefix] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [region, setRegion] = useState('')
  const [pathStyle, setPathStyle] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Reset the form to defaults on every open + focus the "Name" field.
  useEffect(() => {
    if (!open) return
    setName('')
    setEndpoint(DEFAULT_ENDPOINT)
    setBucket('')
    setPrefix('')
    setAccessKey('')
    setSecretKey('')
    setRegion('')
    setPathStyle(true)
    setFormError(null)
    document.getElementById(nameId)?.focus()
  }, [open, nameId])

  const valid =
    name.trim() !== '' &&
    endpoint.trim() !== '' &&
    bucket.trim() !== '' &&
    accessKey.trim() !== '' &&
    secretKey !== ''

  async function connect() {
    if (!valid) return
    setConnecting(true)
    setFormError(null)
    try {
      const source = await api.s3Sources.create(projectId, {
        name: name.trim(),
        endpoint_url: endpoint.trim(),
        bucket: bucket.trim(),
        prefix: prefix.trim(),
        access_key: accessKey.trim(),
        secret_key: secretKey,
        region: region.trim() === '' ? null : region.trim(),
        path_style: pathStyle,
      })
      toast({ kind: 'ok', message: t('s3.form.created') })
      onConnected(source)
      onClose()
    } catch (e) {
      // Connection check failure — shown human-readably at the form (not a toast).
      if (e instanceof ApiError && e.status === 400 && e.detail === 's3_connection_failed') {
        setFormError(t('s3.form.failed'))
      } else if (e instanceof ApiError && e.status === 400 && e.detail === 's3_fields_required') {
        setFormError(t('s3.form.fieldsRequired'))
      } else {
        setFormError(t('s3.form.error'))
      }
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('s3.form.title')}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={connecting}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={() => void connect()} loading={connecting} disabled={!valid}>
            {t('s3.form.submit')}
          </Button>
        </>
      }
    >
      <div className="ltp-s3form">
        {formError !== null && <Banner kind="warning">{formError}</Banner>}

        <TextField
          id={nameId}
          label={t('s3.form.name')}
          placeholder={t('s3.form.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={t('s3.form.endpoint')}
          placeholder={DEFAULT_ENDPOINT}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="ltp-s3form__row">
          <TextField
            label={t('s3.form.bucket')}
            placeholder={t('s3.form.bucketPlaceholder')}
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <TextField
            label={t('s3.form.prefix')}
            placeholder={t('s3.form.prefixPlaceholder')}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="ltp-s3form__row">
          <TextField
            label={t('s3.form.accessKey')}
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <TextField
            label={t('s3.form.secretKey')}
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            hint={t('s3.form.secretNote')}
            autoComplete="new-password"
          />
        </div>
        <div className="ltp-s3form__row">
          <TextField
            label={t('s3.form.region')}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="ltp-s3form__check">
            <Checkbox
              label={t('s3.form.pathStyle')}
              checked={pathStyle}
              onChange={(e) => setPathStyle(e.target.checked)}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
