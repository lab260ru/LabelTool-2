/**
 * Audio player with a waveform built on wavesurfer.js v7.
 *
 * Features: play/pause, speed 0.5–2×, zoom, timecodes
 * with tabular figures, regions for segmentation/diarization (create by dragging,
 * move/resize, select), states "loading" / "network error" /
 * "presigned URL expired" (banner with "Refresh link").
 *
 * Waveform colors come from theme tokens: waveform — --accent-soft (lavender,
 * the "remaining" part of the tracks motif), progress — --accent (violet, "done"), cursor — --text.
 * The canvas does not understand tokens with color-mix(), so the values are resolved via
 * getComputedStyle on a probe element inside the current theme.
 *
 * Regions are controlled: the source of truth is the `regions` prop; user
 * edits (drag-create, move, resize) are lifted through callbacks.
 */
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'
import type { Region } from 'wavesurfer.js/dist/plugins/regions.js'
import { useTheme } from '../../theme'
import { Banner } from '../Banner/Banner'
import { Button } from '../Button/Button'
import { Spinner } from '../Spinner/Spinner'
import { formatTime } from './format'
import { IconPause, IconPlay, IconZoomIn } from './icons'
import './i18n'
import './audioplayer.css'

/** Playback speeds. */
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.5, 2] as const

/** A region on the waveform (segment/speaker turn) — a controlled model. */
export interface WaveRegion {
  id: string
  start: number
  end: number
  /** Base region color (hex/any CSS color); the alpha backdrop is built automatically. */
  color: string
  /** Label on the region (class label / speaker). */
  content?: string
}

/** Imperative interface for workspace hotkeys (Space, S…). */
export interface AudioPlayerHandle {
  playPause: () => void
  /** Current position, sec. */
  currentTime: () => number
  /** Duration, sec (0 — until decoded). */
  duration: () => number
  /** Play the region from start to end. */
  playRegion: (id: string) => void
}

export interface AudioPlayerProps {
  /** Audio URL (presigned S3 URL). */
  src: string | null
  /** Presigned URL lifetime (ISO): expired → "Refresh link" banner. */
  expiresAt?: string | null
  /** Request a fresh presigned URL (the parent updates src/expiresAt). */
  onRefreshUrl?: () => void
  /** Controlled list of regions. */
  regions?: WaveRegion[]
  /** Allow creating regions by dragging over the waveform. */
  regionsEnabled?: boolean
  /** Selected region (brighter backdrop). */
  activeRegionId?: string | null
  /** Color of the region draft while dragging (usually the color of the "armed" label). */
  createColor?: string
  /** The user created a region by dragging (coordinates are final). */
  onRegionCreate?: (region: { id: string; start: number; end: number }) => void
  /** The user moved/stretched a region. */
  onRegionChange?: (id: string, start: number, end: number) => void
  onRegionClick?: (id: string) => void
  ref?: Ref<AudioPlayerHandle>
  className?: string
}

type PlayerStatus = 'idle' | 'loading' | 'ready' | 'error'
type PlayerErrorKind = 'network' | 'expired'

const WAVE_HEIGHT = 96

/** Resolve a token to a concrete color (for the waveform canvas). */
function resolveToken(host: HTMLElement, token: string): string {
  const probe = document.createElement('i')
  probe.style.color = `var(${token})`
  host.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}

interface WaveColors {
  wave: string
  progress: string
  cursor: string
}

function resolveWaveColors(host: HTMLElement): WaveColors {
  return {
    wave: resolveToken(host, '--accent-soft'),
    progress: resolveToken(host, '--accent'),
    cursor: resolveToken(host, '--text'),
  }
}

/** Region backdrop: the label's base color with alpha (brighter for the selected one). */
function regionFill(color: string, active: boolean): string {
  return `color-mix(in srgb, ${color} ${active ? 44 : 24}%, transparent)`
}

function isExpired(expiresAt: string | null | undefined): boolean {
  return Boolean(expiresAt) && Date.parse(expiresAt as string) <= Date.now()
}

export function AudioPlayer({
  src,
  expiresAt = null,
  onRefreshUrl,
  regions = [],
  regionsEnabled = false,
  activeRegionId = null,
  createColor,
  onRegionCreate,
  onRegionChange,
  onRegionClick,
  ref,
  className,
}: AudioPlayerProps) {
  const { t } = useTranslation('audio')
  const { t: tc } = useTranslation('common')
  const { theme } = useTheme()

  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsPluginRef = useRef<RegionsPlugin | null>(null)
  const regionMapRef = useRef(new Map<string, Region>())
  const regionContentRef = useRef(new Map<string, string>())
  /** true — regions are edited by the sync effect, do not raise events. */
  const syncingRef = useRef(false)
  const colorsRef = useRef<WaveColors | null>(null)
  const rateRef = useRef(1)

  const [status, setStatus] = useState<PlayerStatus>(src ? 'loading' : 'idle')
  const [errorKind, setErrorKind] = useState<PlayerErrorKind>('network')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)
  const [zoom, setZoom] = useState(0)
  const [reloadTick, setReloadTick] = useState(0)

  // Callbacks via ref, so wavesurfer is not recreated on every parent render.
  const cbRef = useRef({ onRegionCreate, onRegionChange, onRegionClick })
  useEffect(() => {
    cbRef.current = { onRegionCreate, onRegionChange, onRegionClick }
  })

  // ── Create wavesurfer for src (and forced reload on reloadTick) ────
  useEffect(() => {
    const host = containerRef.current
    if (!host) return
    if (!src) {
      setStatus('idle')
      return
    }
    // Proactive check: do not load a presigned link that is already known to be expired.
    if (isExpired(expiresAt)) {
      setStatus('error')
      setErrorKind('expired')
      return
    }

    setStatus('loading')
    setPlaying(false)
    setTime(0)
    setDuration(0)
    setZoom(0)

    const regionMap = regionMapRef.current
    const contentMap = regionContentRef.current
    const colors = resolveWaveColors(host)
    colorsRef.current = colors
    const regionsPlugin = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container: host,
      url: src,
      height: WAVE_HEIGHT,
      waveColor: colors.wave,
      progressColor: colors.progress,
      cursorColor: colors.cursor,
      cursorWidth: 2,
      // "Tracks" motif: waveform made of rounded segments
      barWidth: 3,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      dragToSeek: true,
      plugins: [regionsPlugin],
    })
    wsRef.current = ws
    regionsPluginRef.current = regionsPlugin

    ws.on('ready', (dur) => {
      if (wsRef.current !== ws) return
      setDuration(dur)
      setStatus('ready')
      ws.setPlaybackRate(rateRef.current, true)
    })
    ws.on('error', () => {
      if (wsRef.current !== ws) return
      setStatus('error')
      setErrorKind(isExpired(expiresAt) ? 'expired' : 'network')
    })
    ws.on('timeupdate', (current) => {
      if (wsRef.current === ws) setTime(current)
    })
    ws.on('play', () => {
      if (wsRef.current === ws) setPlaying(true)
    })
    ws.on('pause', () => {
      if (wsRef.current === ws) setPlaying(false)
    })
    ws.on('finish', () => {
      if (wsRef.current === ws) setPlaying(false)
    })

    regionsPlugin.on('region-created', (region) => {
      regionMapRef.current.set(region.id, region)
      if (syncingRef.current) return
      // Drag over the waveform: coordinates are final (saveRegion — at the end of the drag)
      cbRef.current.onRegionCreate?.({ id: region.id, start: region.start, end: region.end })
    })
    regionsPlugin.on('region-updated', (region) => {
      if (syncingRef.current) return
      cbRef.current.onRegionChange?.(region.id, region.start, region.end)
    })
    regionsPlugin.on('region-clicked', (region, e) => {
      e.stopPropagation()
      cbRef.current.onRegionClick?.(region.id)
    })
    regionsPlugin.on('region-removed', (region) => {
      if (regionMapRef.current.get(region.id) === region) {
        regionMapRef.current.delete(region.id)
        regionContentRef.current.delete(region.id)
      }
    })

    return () => {
      wsRef.current = null
      regionsPluginRef.current = null
      regionMap.clear()
      contentMap.clear()
      ws.destroy()
    }
  }, [src, expiresAt, reloadTick])

  // ── Recolor the waveform when the theme changes ────────────────────────────────────────
  useEffect(() => {
    const ws = wsRef.current
    const host = containerRef.current
    if (!ws || !host) return
    // ThemeProvider sets data-theme in ITS OWN effect (parent — after
    // children), so we read the tokens in a rAF once the attribute is already updated.
    const raf = requestAnimationFrame(() => {
      if (wsRef.current !== ws) return
      const colors = resolveWaveColors(host)
      colorsRef.current = colors
      ws.setOptions({
        waveColor: colors.wave,
        progressColor: colors.progress,
        cursorColor: colors.cursor,
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [theme])

  // ── Synchronize controlled regions ──────────────────────────────────
  useEffect(() => {
    const plugin = regionsPluginRef.current
    if (!plugin || status !== 'ready') return
    syncingRef.current = true
    try {
      const wanted = new Set(regions.map((r) => r.id))
      for (const [id, region] of [...regionMapRef.current]) {
        if (!wanted.has(id)) region.remove() // region-removed clears the maps
      }
      for (const r of regions) {
        const color = regionFill(r.color, r.id === activeRegionId)
        const existing = regionMapRef.current.get(r.id)
        if (existing) {
          if (
            existing.start !== r.start ||
            existing.end !== r.end ||
            existing.color !== color
          ) {
            existing.setOptions({ start: r.start, end: r.end, color })
          }
          const content = r.content ?? ''
          if (regionContentRef.current.get(r.id) !== content) {
            existing.setContent(content || undefined)
            regionContentRef.current.set(r.id, content)
          }
        } else {
          const created = plugin.addRegion({
            id: r.id,
            start: r.start,
            end: r.end,
            color,
            content: r.content,
            drag: true,
            resize: true,
          })
          regionMapRef.current.set(r.id, created)
          regionContentRef.current.set(r.id, r.content ?? '')
        }
      }
    } finally {
      syncingRef.current = false
    }
  }, [regions, activeRegionId, status])

  // ── Create regions by dragging ────────────────────────────────────────────
  useEffect(() => {
    const plugin = regionsPluginRef.current
    if (!plugin || status !== 'ready' || !regionsEnabled) return
    const base = createColor ?? colorsRef.current?.progress ?? 'currentColor'
    return plugin.enableDragSelection({ color: regionFill(base, false) })
  }, [regionsEnabled, status, createColor])

  useImperativeHandle(
    ref,
    () => ({
      playPause: () => {
        void wsRef.current?.playPause()
      },
      currentTime: () => wsRef.current?.getCurrentTime() ?? 0,
      duration: () => wsRef.current?.getDuration() ?? 0,
      playRegion: (id: string) => {
        regionMapRef.current.get(id)?.play(true)
      },
    }),
    [],
  )

  function changeRate(next: number) {
    setRate(next)
    rateRef.current = next
    wsRef.current?.setPlaybackRate(next, true)
  }

  function changeZoom(value: number) {
    setZoom(value)
    const ws = wsRef.current
    const host = containerRef.current
    if (!ws || !host || status !== 'ready') return
    const dur = ws.getDuration()
    if (dur <= 0 || host.clientWidth <= 0) return
    // 0 — the whole waveform; 100 — 32× zoom (logarithmic scale)
    const fitPxPerSec = host.clientWidth / dur
    ws.zoom(fitPxPerSec * 2 ** ((value / 100) * 5))
  }

  const cls = ['lt-audio', className ?? ''].filter(Boolean).join(' ')
  const ready = status === 'ready'

  return (
    <div className={cls}>
      <div className="lt-audio__stage">
        {/* Keyboard seek over the waveform: ←/→ ±1 s, Home/End — edges */}
        <div
          ref={containerRef}
          className="lt-audio__wave"
          role="slider"
          tabIndex={0}
          aria-label={t('wave')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
          onKeyDown={(e) => {
            const ws = wsRef.current
            if (!ws || !ready) return
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              ws.skip(1)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              ws.skip(-1)
            } else if (e.key === 'Home') {
              e.preventDefault()
              ws.setTime(0)
            } else if (e.key === 'End') {
              e.preventDefault()
              ws.setTime(ws.getDuration())
            }
          }}
        />
        {status === 'idle' && <p className="lt-audio__idle">{t('noAudio')}</p>}
        {status === 'loading' && (
          <div className="lt-audio__overlay">
            <Spinner size={28} label={t('loading')} />
          </div>
        )}
        {status === 'error' && (
          <div className="lt-audio__overlay lt-audio__overlay--error">
            <Banner
              kind="warning"
              className="lt-audio__banner"
              action={
                errorKind === 'expired' && onRefreshUrl ? (
                  <Button size="sm" variant="secondary" onClick={onRefreshUrl}>
                    {t('refreshUrl')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setReloadTick((n) => n + 1)}
                  >
                    {tc('actions.retry')}
                  </Button>
                )
              }
            >
              {t(errorKind === 'expired' ? 'errorExpired' : 'errorNetwork')}
            </Banner>
          </div>
        )}
      </div>

      <div className="lt-audio__controls">
        <button
          type="button"
          className="lt-audio__play"
          onClick={() => void wsRef.current?.playPause()}
          disabled={!ready}
          aria-label={playing ? t('pause') : t('play')}
        >
          {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </button>

        <span className="lt-audio__time lt-data" aria-label={t('time')}>
          {formatTime(time)}
          <span className="lt-audio__time-sep"> / </span>
          {formatTime(duration)}
        </span>

        <div className="lt-audio__rates" role="group" aria-label={t('rate')}>
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              type="button"
              className={`lt-audio__rate lt-data${r === rate ? ' lt-audio__rate--active' : ''}`}
              aria-pressed={r === rate}
              disabled={!ready}
              onClick={() => changeRate(r)}
            >
              {r}×
            </button>
          ))}
        </div>

        <label className="lt-audio__zoom">
          <IconZoomIn size={16} className="lt-audio__zoom-icon" />
          <input
            type="range"
            className="lt-audio__zoom-range"
            min={0}
            max={100}
            step={1}
            value={zoom}
            disabled={!ready}
            onChange={(e) => changeZoom(Number(e.target.value))}
            aria-label={t('zoom')}
          />
        </label>
      </div>
    </div>
  )
}
