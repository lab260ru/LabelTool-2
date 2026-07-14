import { useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconUpload } from '../icons'
import './dragdropzone.css'

/**
 * Drag-and-drop zone: "Drop audio here · or choose
 * files · a folder". Highlight on drag-over, selection of files AND folders.
 * Format/size validation is on the feature side (the component returns File[]).
 *
 * A11y: the container is NOT an interactive element (nested
 * buttons inside role="button" — axe serious "nested-interactive"). Keyboard
 * access is provided by the inner "choose files" / "folder" buttons; a click on the free
 * area of the zone is only a mouse shortcut for the same command.
 */
export interface DragDropZoneProps {
  onFiles: (files: File[]) => void
  /** accept for the file picker dialog, e.g. ".mp3,.wav,.flac,.ogg". */
  accept?: string
  multiple?: boolean
  /** Zone title (defaults to common:dropzone.title). */
  title?: string
  /** Constraints line under the title ("MP3 · WAV · … up to 200 MB"). */
  hint?: ReactNode
  disabled?: boolean
  className?: string
}

export function DragDropZone({
  onFiles,
  accept,
  multiple = true,
  title,
  hint,
  disabled = false,
  className,
}: DragDropZoneProps) {
  const { t } = useTranslation('common')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  function emit(list: FileList | null) {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    emit(e.dataTransfer.files)
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!disabled) setDragOver(true)
  }

  const cls = [
    'lt-dropzone',
    dragOver ? 'lt-dropzone--over' : '',
    disabled ? 'lt-dropzone--disabled' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const zoneTitle = title ?? t('dropzone.title')

  return (
    <div
      className={cls}
      role="group"
      aria-label={zoneTitle}
      aria-disabled={disabled || undefined}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onClick={(e) => {
        // clicks on the inner buttons must not open the dialog twice
        if (e.target === e.currentTarget && !disabled) fileInputRef.current?.click()
      }}
    >
      <IconUpload size={28} className="lt-dropzone__icon" />
      <p className="lt-dropzone__title">{zoneTitle}</p>
      <p className="lt-dropzone__choose">
        {t('dropzone.or')}{' '}
        <button
          type="button"
          className="lt-dropzone__link"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('dropzone.chooseFiles')}
        </button>{' '}
        {t('dropzone.sep')}{' '}
        <button
          type="button"
          className="lt-dropzone__link"
          disabled={disabled}
          onClick={() => folderInputRef.current?.click()}
        >
          {t('dropzone.chooseFolder')}
        </button>
      </p>
      {hint && <p className="lt-dropzone__hint">{hint}</p>}

      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          emit(e.target.files)
          e.target.value = ''
        }}
      />
      {/* webkitdirectory: non-standard folder-selection attribute */}
      <input
        ref={folderInputRef}
        type="file"
        hidden
        multiple
        {...({ webkitdirectory: '' } as Record<string, string>)}
        onChange={(e) => {
          emit(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
