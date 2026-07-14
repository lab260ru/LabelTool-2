/**
 * i18n keys for the «Dataset export» feature (namespace 'export').
 * Registered in src/features/export/index.tsx via registerFeatureI18n.
 */

export const ru = {
  title: 'Экспорт датасета',
  toProject: 'К проекту',
  projectChip: 'Проект',

  types: {
    legend: 'Типы задач',
    empty: 'Выберите хотя бы один тип задач',
  },

  format: {
    legend: 'Формат',
  },
  formats: {
    jsonl: {
      name: 'JSONL',
      desc: 'универсальный, по строке на фрагмент',
      purpose: 'универсальный обмен',
    },
    csv: {
      name: 'CSV',
      desc: 'таблица для быстрого анализа',
      purpose: 'аналитика',
    },
    nemo: {
      name: 'NeMo manifest',
      desc: 'обучение ASR в NVIDIA NeMo',
      purpose: 'ASR-пайплайн',
    },
    textgrid: {
      name: 'Praat TextGrid',
      desc: 'сегменты и выравнивание',
      purpose: 'академическая/фонетика',
    },
    conll: {
      name: 'CoNLL',
      desc: 'NER-разметка по токенам',
      purpose: 'NER',
    },
    srt_vtt: {
      name: 'SRT / VTT',
      desc: 'субтитры с таймкодами',
      purpose: 'субтитры',
    },
  },

  options: {
    legend: 'Опции',
    consensus: 'Только консенсус (эталонные версии)',
    consensusHint: 'эталон по большинству из K сданных результатов (консенсус проекта)',
    all: 'Все версии разметки от всех разметчиков',
    allHint: 'выгрузить все версии',
    meta: 'Включить метаданные фрагментов',
    metaHint: 'добавить key-value метаданные',
  },

  submit: 'Сформировать датасет',

  history: {
    title: 'Экспорты',
    making: 'Формируется… {{pct}}% · {{size}}',
    cancel: 'Отменить формирование',
    download: 'Скачать',
    empty: 'Выгрузок пока нет',
    emptyHint: 'Сформируйте первый датасет — он появится в этом списке.',
  },

  toasts: {
    done: 'Экспорт готов: {{name}}',
    cancelled: 'Формирование отменено',
    startFailed: 'Не удалось запустить экспорт',
    cancelFailed: 'Не удалось отменить формирование',
    pollFailed: 'Не удалось получить статус формирования',
    downloadFailed: 'Не удалось скачать файл',
  },

  errors: {
    projectNotFound: 'Проект не найден',
    projectNotFoundHint: 'Проверьте адрес или вернитесь к списку проектов.',
    toProjects: 'К проектам',
  },

  units: {
    b: 'Б',
    kb: 'КБ',
    mb: 'МБ',
    gb: 'ГБ',
    tb: 'ТБ',
  },
}

/** English dictionary — the same structure as ru (ru and en at once). */
export const en: typeof ru = {
  title: 'Dataset export',
  toProject: 'To project',
  projectChip: 'Project',

  types: {
    legend: 'Task types',
    empty: 'Select at least one task type',
  },

  format: {
    legend: 'Format',
  },
  formats: {
    jsonl: {
      name: 'JSONL',
      desc: 'universal, one row per fragment',
      purpose: 'universal interchange',
    },
    csv: {
      name: 'CSV',
      desc: 'a table for quick analysis',
      purpose: 'analytics',
    },
    nemo: {
      name: 'NeMo manifest',
      desc: 'ASR training in NVIDIA NeMo',
      purpose: 'ASR pipeline',
    },
    textgrid: {
      name: 'Praat TextGrid',
      desc: 'segments and alignment',
      purpose: 'academia/phonetics',
    },
    conll: {
      name: 'CoNLL',
      desc: 'token-level NER annotation',
      purpose: 'NER',
    },
    srt_vtt: {
      name: 'SRT / VTT',
      desc: 'subtitles with timecodes',
      purpose: 'subtitles',
    },
  },

  options: {
    legend: 'Options',
    consensus: 'Consensus only (reference versions)',
    consensusHint: 'reference built by majority of the K submitted results (project consensus)',
    all: 'All versions by all annotators',
    allHint: 'export every version',
    meta: 'Include fragment metadata',
    metaHint: 'add key-value metadata',
  },

  submit: 'Build dataset',

  history: {
    title: 'Exports',
    making: 'Building… {{pct}}% · {{size}}',
    cancel: 'Cancel the build',
    download: 'Download',
    empty: 'No exports yet',
    emptyHint: 'Build your first dataset — it will appear in this list.',
  },

  toasts: {
    done: 'Export is ready: {{name}}',
    cancelled: 'Build cancelled',
    startFailed: 'Failed to start the export',
    cancelFailed: 'Failed to cancel the build',
    pollFailed: 'Failed to fetch the build status',
    downloadFailed: 'Failed to download the file',
  },

  errors: {
    projectNotFound: 'Project not found',
    projectNotFoundHint: 'Check the address or go back to the project list.',
    toProjects: 'To projects',
  },

  units: {
    b: 'B',
    kb: 'KB',
    mb: 'MB',
    gb: 'GB',
    tb: 'TB',
  },
}
