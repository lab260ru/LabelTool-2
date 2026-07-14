/**
 * Audio player strings. The component is shared (src/components/audio), so
 * it lives in its own 'audio' namespace (following the 'showcase' example) and
 * registers it itself — any feature only needs to import AudioPlayer.
 */
import { registerFeatureI18n } from '../../i18n'

const ru = {
  wave: 'Волновая форма',
  loading: 'Загрузка аудио…',
  play: 'Воспроизвести',
  pause: 'Пауза',
  time: 'Позиция и длительность',
  rate: 'Скорость воспроизведения',
  zoom: 'Масштаб волновой формы',
  errorNetwork: 'Не удалось загрузить аудио — сетевая ошибка или файл недоступен.',
  errorExpired: 'Ссылка на аудио истекла.',
  refreshUrl: 'Обновить ссылку',
  noAudio: 'Аудио не выбрано',
}

const en: typeof ru = {
  wave: 'Waveform',
  loading: 'Loading audio…',
  play: 'Play',
  pause: 'Pause',
  time: 'Position and duration',
  rate: 'Playback speed',
  zoom: 'Waveform zoom',
  errorNetwork: 'Failed to load audio — network error or the file is unavailable.',
  errorExpired: 'The audio link has expired.',
  refreshUrl: 'Refresh link',
  noAudio: 'No audio selected',
}

registerFeatureI18n('audio', { ru, en })
