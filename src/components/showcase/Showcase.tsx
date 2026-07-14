import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { registerFeatureI18n } from '../../i18n'
import {
  Banner,
  Button,
  Card,
  Checkbox,
  ClassChip,
  DataTable,
  DragDropZone,
  EmptyState,
  KeyValueChips,
  Logo,
  Modal,
  SectionDivider,
  Select,
  Spinner,
  StatusBadge,
  Stepper,
  Tabs,
  TextArea,
  TextField,
  TrackProgress,
  useToast,
} from '../index'
import type { DataTableColumn, KeyValuePair } from '../index'
import './showcase.css'

/**
 * Component showcase /showcase (dev builds only):
 * all components from src/components in all states + typography.
 * Theme tokens only, coral ≤10% of the area.
 */

const ru = {
  title: 'Витрина компонентов',
  intro: 'Общая UI-библиотека LabelTool 2: все компоненты и их состояния. Стили — только токены темы.',
  typography: {
    heading: 'Типографика',
    h1: 'Заголовок H1 — Sora 28/34',
    h2: 'Заголовок H2 — Sora 20/26',
    body: 'Основной текст — Manrope 14/22. Используется в описаниях, формах и таблицах; кириллица набирается Manrope, латиница заголовков — Sora.',
    caption: 'Подпись 12/16 — вторичные подписи, подсказки и легенды.',
    dataLabel: 'Данные — табличные цифры (tabular-nums): имена файлов, таймкоды, размеры',
    dataSample: 'interview_001.wav · 00:12:44.500 · 128,4 МБ',
  },
  logo: {
    heading: 'Логотип',
    horizontal: 'Горизонтальный (основная версия)',
    mark: 'Только знак',
    onDark: 'На тёмной подложке',
  },
  buttons: {
    heading: 'Кнопки',
    primary: 'Новый проект',
    secondary: 'Импорт аудио',
    normal: 'Обычные (primary / secondary / danger)',
    disabled: 'Недоступные (disabled)',
    extra: 'Маленький размер (sm) и состояние загрузки',
    small: 'Маленькая',
    loading: 'Сохраняем',
  },
  chips: {
    heading: 'Метки классов (ClassChip)',
    presets: 'Предустановленные классы',
    custom: 'Произвольный цвет класса и чип с удалением',
    customLabel: 'вокал',
    removed: 'Метка «{{label}}» убрана',
  },
  badges: { heading: 'Бейджи статусов (StatusBadge)' },
  cards: {
    heading: 'Карточки (Card)',
    title: 'Заголовок карточки',
    body: 'Содержимое карточки: скруглённая панель на токене --surface, в шапке — заголовок и действия.',
    plain: 'Карточка без шапки, padding="lg".',
  },
  stepper: {
    heading: 'Степпер (Stepper)',
    hint: 'Пройден / активен / будущий; по пройденному шагу можно кликнуть и вернуться.',
    s1: 'Файлы',
    s2: 'Параметры',
    s3: 'Метаданные',
    s4: 'Подтверждение',
  },
  track: {
    heading: 'Прогресс «дорожка» (TrackProgress)',
    q: 'Четверть',
    default: 'С подписью значения',
    full: 'Завершён',
    dense: 'Без подписи, 8 сегментов',
  },
  divider: {
    heading: 'Разделитель разделов (SectionDivider)',
    two: '2 сегмента: виолет + лаванда',
    three: '3 сегмента: виолет + коралл (точечно) + лаванда',
  },
  dropzone: {
    heading: 'Зона загрузки (DragDropZone)',
    hint: 'MP3 · WAV · FLAC · OGG · до 200 МБ на файл',
    files: 'Выбрано файлов: {{count}}',
    disabled: 'Недоступная зона',
  },
  table: {
    heading: 'Таблица данных (DataTable)',
    hint: 'Сортировка по клику на заголовок, фильтр-поиск, пагинация по 5 строк.',
    colName: 'Файл',
    colDuration: 'Длительность',
    colSize: 'Размер, МБ',
    colStatus: 'Статус',
  },
  toast: {
    heading: 'Уведомления (Toast)',
    info: 'Информация',
    ok: 'Успех',
    warn: 'Внимание',
    error: 'Ошибка',
    message: 'Пример всплывающего уведомления.',
  },
  modal: {
    heading: 'Модальное окно (Modal)',
    open: 'Открыть модальное окно',
    title: 'Пример модального окна',
    body: 'Фокус заперт внутри окна, Esc и клик по подложке закрывают его. Кнопки действий — в футере.',
    done: 'Действие подтверждено',
  },
  tabs: {
    heading: 'Вкладки (Tabs)',
    label: 'Пример вкладок',
    files: 'Файлы',
    manifest: 'Манифест CSV/JSONL',
    settings: 'Настройки',
    panel: 'Содержимое вкладки «{{tab}}». Стрелки ←/→ переключают вкладки с клавиатуры; третья вкладка недоступна.',
  },
  forms: {
    heading: 'Поля форм',
    stateNormal: 'Обычное',
    stateDisabled: 'Недоступное',
    stateError: 'С ошибкой',
    name: 'Название проекта',
    placeholder: 'Введите название',
    hint: 'Отображается в списке проектов',
    error: 'Обязательное поле',
    disabledValue: 'Радиоархив 2024',
    instruction: 'Инструкция разметчику',
    instructionPlaceholder: 'Опишите правила разметки…',
    instructionValue: 'Размечайте паузы длиннее 300 мс как «тишина».',
    taskType: 'Тип задачи',
    checkbox: 'Пропускать уже размеченные фрагменты',
    checkboxHint: 'Фрагменты с готовой разметкой не попадут в выдачу',
    checkboxDisabled: 'Недоступный чекбокс',
    checkboxDisabledChecked: 'Недоступный отмеченный',
  },
  banner: {
    heading: 'Баннеры (Banner)',
    warning: 'Часть файлов не прошла проверку — исправьте ошибки и повторите загрузку.',
    info: 'Подсказка: метаданные key=value применяются ко всей пачке файлов.',
  },
  empty: {
    heading: 'Пустое состояние (EmptyState)',
    title: 'Пока нет проектов',
    description: 'Создайте первый проект, чтобы загрузить аудио и раздать задачи разметчикам.',
    compact: 'Компактный вариант (для таблиц)',
    compactTitle: 'Ничего не найдено',
  },
  spinner: {
    heading: 'Спиннер (Spinner)',
    s16: '16 px',
    s24: '24 px (по умолчанию)',
    s36: '36 px + ARIA-подпись',
  },
  kv: {
    heading: 'Метаданные key-value (KeyValueChips)',
    hint: 'Интерактивный: добавляйте и убирайте пары — они применяются ко всей пачке.',
  },
}

const en: typeof ru = {
  title: 'Component showcase',
  intro: 'LabelTool 2 shared UI library: every component and its states. Styling uses theme tokens only.',
  typography: {
    heading: 'Typography',
    h1: 'Heading H1 — Sora 28/34',
    h2: 'Heading H2 — Sora 20/26',
    body: 'Body text — Manrope 14/22. Used in descriptions, forms and tables; Cyrillic falls back to Manrope, Latin headings render in Sora.',
    caption: 'Caption 12/16 — secondary labels, hints and legends.',
    dataLabel: 'Data — tabular numerals (tabular-nums): file names, timecodes, sizes',
    dataSample: 'interview_001.wav · 00:12:44.500 · 128.4 MB',
  },
  logo: {
    heading: 'Logo',
    horizontal: 'Horizontal (primary version)',
    mark: 'Mark only',
    onDark: 'On a dark background',
  },
  buttons: {
    heading: 'Buttons',
    primary: 'New project',
    secondary: 'Import audio',
    normal: 'Default (primary / secondary / danger)',
    disabled: 'Disabled',
    extra: 'Small size (sm) and loading state',
    small: 'Small',
    loading: 'Saving',
  },
  chips: {
    heading: 'Class chips (ClassChip)',
    presets: 'Preset classes',
    custom: 'Custom class color and removable chip',
    customLabel: 'vocals',
    removed: 'Chip "{{label}}" removed',
  },
  badges: { heading: 'Status badges (StatusBadge)' },
  cards: {
    heading: 'Cards (Card)',
    title: 'Card title',
    body: 'Card content: a rounded panel on the --surface token with a title and actions in the header.',
    plain: 'Card without a header, padding="lg".',
  },
  stepper: {
    heading: 'Stepper',
    hint: 'Done / active / future; click a completed step to go back.',
    s1: 'Files',
    s2: 'Parameters',
    s3: 'Metadata',
    s4: 'Confirmation',
  },
  track: {
    heading: 'Track progress (TrackProgress)',
    q: 'Quarter',
    default: 'With value label',
    full: 'Complete',
    dense: 'No label, 8 segments',
  },
  divider: {
    heading: 'Section divider (SectionDivider)',
    two: '2 segments: violet + lavender',
    three: '3 segments: violet + coral (accent) + lavender',
  },
  dropzone: {
    heading: 'Drag-and-drop zone (DragDropZone)',
    hint: 'MP3 · WAV · FLAC · OGG · up to 200 MB per file',
    files: 'Files selected: {{count}}',
    disabled: 'Disabled zone',
  },
  table: {
    heading: 'Data table (DataTable)',
    hint: 'Click a header to sort, search filter, pagination by 5 rows.',
    colName: 'File',
    colDuration: 'Duration',
    colSize: 'Size, MB',
    colStatus: 'Status',
  },
  toast: {
    heading: 'Toasts',
    info: 'Info',
    ok: 'Success',
    warn: 'Warning',
    error: 'Error',
    message: 'An example toast notification.',
  },
  modal: {
    heading: 'Modal',
    open: 'Open modal',
    title: 'Example modal',
    body: 'Focus is trapped inside; Esc or a click on the overlay closes it. Action buttons live in the footer.',
    done: 'Action confirmed',
  },
  tabs: {
    heading: 'Tabs',
    label: 'Example tabs',
    files: 'Files',
    manifest: 'Manifest CSV/JSONL',
    settings: 'Settings',
    panel: 'Content of the "{{tab}}" tab. Use ←/→ to switch tabs from the keyboard; the third tab is disabled.',
  },
  forms: {
    heading: 'Form fields',
    stateNormal: 'Default',
    stateDisabled: 'Disabled',
    stateError: 'With error',
    name: 'Project name',
    placeholder: 'Enter a name',
    hint: 'Shown in the project list',
    error: 'Required field',
    disabledValue: 'Radio archive 2024',
    instruction: 'Labeling instruction',
    instructionPlaceholder: 'Describe the labeling rules…',
    instructionValue: 'Label pauses longer than 300 ms as "silence".',
    taskType: 'Task type',
    checkbox: 'Skip already labeled fragments',
    checkboxHint: 'Fragments with existing labels will not be served',
    checkboxDisabled: 'Disabled checkbox',
    checkboxDisabledChecked: 'Disabled checked',
  },
  banner: {
    heading: 'Banners',
    warning: 'Some files failed validation — fix the errors and retry the upload.',
    info: 'Hint: key=value metadata applies to the whole batch of files.',
  },
  empty: {
    heading: 'Empty state (EmptyState)',
    title: 'No projects yet',
    description: 'Create your first project to upload audio and assign tasks to annotators.',
    compact: 'Compact variant (for tables)',
    compactTitle: 'Nothing found',
  },
  spinner: {
    heading: 'Spinner',
    s16: '16 px',
    s24: '24 px (default)',
    s36: '36 px + ARIA label',
  },
  kv: {
    heading: 'Key-value metadata (KeyValueChips)',
    hint: 'Interactive: add and remove pairs — they apply to the whole batch.',
  },
}

registerFeatureI18n('showcase', { ru, en })

/* ------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lt-showcase__section">
      <h2>{title}</h2>
      <SectionDivider segments={2} className="lt-showcase__divider" />
      {children}
    </section>
  )
}

function Demo({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="lt-showcase__demo">
      <div className="lt-showcase__demo-body">{children}</div>
      <span className="lt-caption lt-showcase__caption">{caption}</span>
    </div>
  )
}

/* --- Table demo data (data, not UI strings) ---------------------------- */

type DemoStatus = 'ok' | 'progress' | 'error' | 'queued'

interface DemoRow {
  id: number
  name: string
  duration: string
  size: number
  status: DemoStatus
}

const demoRows: DemoRow[] = [
  { id: 1, name: 'interview_001.wav', duration: '00:12:44', size: 128.4, status: 'ok' },
  { id: 2, name: 'interview_002.wav', duration: '00:08:03', size: 81.2, status: 'ok' },
  { id: 3, name: 'radio_news_morning.mp3', duration: '00:29:57', size: 41.1, status: 'progress' },
  { id: 4, name: 'podcast_ep12.flac', duration: '01:02:18', size: 402.7, status: 'queued' },
  { id: 5, name: 'street_ambience.ogg', duration: '00:03:31', size: 4.8, status: 'error' },
  { id: 6, name: 'call_center_0142.wav', duration: '00:05:56', size: 60.3, status: 'ok' },
  { id: 7, name: 'lecture_dsp_part1.mp3', duration: '01:28:40', size: 122.9, status: 'ok' },
  { id: 8, name: 'lecture_dsp_part2.mp3', duration: '01:14:05', size: 102.6, status: 'queued' },
  { id: 9, name: 'field_recording_07.wav', duration: '00:21:12', size: 213.5, status: 'progress' },
  { id: 10, name: 'jingle_pack_v2.flac', duration: '00:01:47', size: 11.4, status: 'ok' },
  { id: 11, name: 'voicemail_batch_3.mp3', duration: '00:00:42', size: 0.9, status: 'error' },
  { id: 12, name: 'audiobook_ch01.ogg', duration: '00:44:29', size: 63.7, status: 'ok' },
]

const statusBadge: Record<DemoStatus, { kind: 'ok' | 'progress' | 'error' | 'neutral'; labelKey: string }> = {
  ok: { kind: 'ok', labelKey: 'status.ok' },
  progress: { kind: 'progress', labelKey: 'status.inProgress' },
  error: { kind: 'error', labelKey: 'status.error' },
  queued: { kind: 'neutral', labelKey: 'status.queued' },
}

/* ------------------------------------------------------------------------- */

export default function Showcase() {
  const { t } = useTranslation('showcase')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()

  const [step, setStep] = useState(2)
  const [modalOpen, setModalOpen] = useState(false)
  const [tab, setTab] = useState('files')
  const [checked, setChecked] = useState(true)
  const [customChip, setCustomChip] = useState(true)
  const [pairs, setPairs] = useState<KeyValuePair[]>([
    { key: 'source', value: 'radio' },
    { key: 'lang', value: 'ru' },
  ])

  const steps = [t('stepper.s1'), t('stepper.s2'), t('stepper.s3'), t('stepper.s4')]

  const tabItems = [
    { id: 'files', label: t('tabs.files') },
    { id: 'manifest', label: t('tabs.manifest') },
    { id: 'settings', label: t('tabs.settings'), disabled: true },
  ]
  const activeTabLabel = tabItems.find((i) => i.id === tab)?.label ?? ''

  const columns: DataTableColumn<DemoRow>[] = [
    { key: 'name', header: t('table.colName'), sortable: true, numeric: true },
    { key: 'duration', header: t('table.colDuration'), sortable: true, numeric: true, align: 'center', width: '140px' },
    {
      key: 'size',
      header: t('table.colSize'),
      sortable: true,
      numeric: true,
      align: 'center',
      width: '120px',
      sortValue: (row) => row.size,
      render: (row) => row.size.toFixed(1),
    },
    {
      key: 'status',
      header: t('table.colStatus'),
      align: 'center',
      sortable: true,
      width: '150px',
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge kind={statusBadge[row.status].kind} label={tc(statusBadge[row.status].labelKey)} />,
    },
  ]

  const toastKinds = ['info', 'ok', 'warn', 'error'] as const

  return (
    <div className="lt-page lt-showcase">
      <header>
        <h1>{t('title')}</h1>
        <p className="lt-showcase__intro">{t('intro')}</p>
        <SectionDivider className="lt-showcase__divider lt-showcase__divider--page" />
      </header>

      {/* --- Typography ------------------------------------------------- */}
      <Section title={t('typography.heading')}>
        <div className="lt-showcase__type">
          <h1>{t('typography.h1')}</h1>
          <h2>{t('typography.h2')}</h2>
          <p>{t('typography.body')}</p>
          <p className="lt-caption lt-showcase__caption">{t('typography.caption')}</p>
          <p className="lt-data">{t('typography.dataSample')}</p>
          <p className="lt-caption lt-showcase__caption">{t('typography.dataLabel')}</p>
        </div>
      </Section>

      {/* --- Logo ------------------------------------------------------------- */}
      <Section title={t('logo.heading')}>
        <div className="lt-showcase__row lt-showcase__row--top">
          <Demo caption={t('logo.horizontal')}>
            <Logo size={26} />
          </Demo>
          <Demo caption={t('logo.mark')}>
            <Logo variant="mark" size={26} />
          </Demo>
          <Demo caption={t('logo.onDark')}>
            <span className="lt-showcase__dark">
              <Logo size={26} onDark />
              <Logo variant="mark" size={26} onDark />
            </span>
          </Demo>
        </div>
      </Section>

      {/* --- Buttons ----------------------------------------------------------- */}
      <Section title={t('buttons.heading')}>
        <Demo caption={t('buttons.normal')}>
          <div className="lt-showcase__row">
            <Button>{t('buttons.primary')}</Button>
            <Button variant="secondary">{t('buttons.secondary')}</Button>
            <Button variant="danger">{tc('actions.delete')}</Button>
          </div>
        </Demo>
        <Demo caption={t('buttons.disabled')}>
          <div className="lt-showcase__row">
            <Button disabled>{t('buttons.primary')}</Button>
            <Button variant="secondary" disabled>
              {t('buttons.secondary')}
            </Button>
            <Button variant="danger" disabled>
              {tc('actions.delete')}
            </Button>
          </div>
        </Demo>
        <Demo caption={t('buttons.extra')}>
          <div className="lt-showcase__row">
            <Button size="sm">{t('buttons.small')}</Button>
            <Button size="sm" variant="secondary">
              {t('buttons.small')}
            </Button>
            <Button loading>{t('buttons.loading')}</Button>
          </div>
        </Demo>
      </Section>

      {/* --- Class labels ------------------------------------------------------- */}
      <Section title={t('chips.heading')}>
        <Demo caption={t('chips.presets')}>
          <div className="lt-showcase__row">
            <ClassChip variant="speech" label={tc('classes.speech')} />
            <ClassChip variant="music" label={tc('classes.music')} />
            <ClassChip variant="noise" label={tc('classes.noise')} />
            <ClassChip variant="silence" label={tc('classes.silence')} />
          </div>
        </Demo>
        <Demo caption={t('chips.custom')}>
          <div className="lt-showcase__row">
            <ClassChip color="#2a9d8f" label={t('chips.customLabel')} />
            {customChip ? (
              <ClassChip
                variant="noise"
                label={tc('classes.noise')}
                onRemove={() => {
                  setCustomChip(false)
                  toast({ kind: 'info', message: t('chips.removed', { label: tc('classes.noise') }) })
                }}
              />
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setCustomChip(true)}>
                {tc('actions.add')}
              </Button>
            )}
          </div>
        </Demo>
      </Section>

      {/* --- Status badges ------------------------------------------------------- */}
      <Section title={t('badges.heading')}>
        <div className="lt-showcase__row">
          <StatusBadge kind="ok" label={tc('status.ok')} />
          <StatusBadge kind="warn" label={tc('status.warning')} />
          <StatusBadge kind="error" label={tc('status.error')} />
          <StatusBadge kind="neutral" label={tc('status.neutral')} />
          <StatusBadge kind="progress" label={tc('status.inProgress')} />
        </div>
      </Section>

      {/* --- Cards ----------------------------------------------------------------- */}
      <Section title={t('cards.heading')}>
        <div className="lt-showcase__grid">
          <Card
            title={t('cards.title')}
            actions={
              <Button size="sm" variant="secondary">
                {tc('actions.open')}
              </Button>
            }
          >
            <p>{t('cards.body')}</p>
          </Card>
          <Card padding="lg">
            <p>{t('cards.plain')}</p>
          </Card>
        </div>
      </Section>

      {/* --- Stepper ----------------------------------------------------------------- */}
      <Section title={t('stepper.heading')}>
        <p className="lt-caption lt-showcase__caption lt-showcase__hint">{t('stepper.hint')}</p>
        <Stepper steps={steps} current={step} onStepClick={setStep} />
        <div className="lt-showcase__row lt-showcase__row--gap-top">
          <Button size="sm" variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
            {tc('actions.back')}
          </Button>
          <Button size="sm" disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>
            {tc('actions.next')}
          </Button>
        </div>
      </Section>

      {/* --- Progress "track" ----------------------------------------------------------- */}
      <Section title={t('track.heading')}>
        <div className="lt-showcase__stack">
          <Demo caption={t('track.q')}>
            <TrackProgress value={25} />
          </Demo>
          <Demo caption={t('track.default')}>
            <TrackProgress value={64} />
          </Demo>
          <Demo caption={t('track.full')}>
            <TrackProgress value={100} />
          </Demo>
          <Demo caption={t('track.dense')}>
            <TrackProgress value={40} segments={8} showLabel={false} />
          </Demo>
        </div>
      </Section>

      {/* --- Section divider --------------------------------------------------------------- */}
      <Section title={t('divider.heading')}>
        <div className="lt-showcase__stack">
          <Demo caption={t('divider.two')}>
            <SectionDivider segments={2} />
          </Demo>
          <Demo caption={t('divider.three')}>
            <SectionDivider segments={3} />
          </Demo>
        </div>
      </Section>

      {/* --- Upload zone ---------------------------------------------------------------------- */}
      <Section title={t('dropzone.heading')}>
        <div className="lt-showcase__grid">
          <DragDropZone
            accept=".mp3,.wav,.flac,.ogg"
            hint={t('dropzone.hint')}
            onFiles={(files) => toast({ kind: 'ok', message: t('dropzone.files', { count: files.length }) })}
          />
          <Demo caption={t('dropzone.disabled')}>
            <DragDropZone disabled hint={t('dropzone.hint')} onFiles={() => undefined} />
          </Demo>
        </div>
      </Section>

      {/* --- Data table -------------------------------------------------------------------------- */}
      <Section title={t('table.heading')}>
        <p className="lt-caption lt-showcase__caption lt-showcase__hint">{t('table.hint')}</p>
        <DataTable columns={columns} rows={demoRows} rowKey={(row) => row.id} filterable pageSize={5} />
      </Section>

      {/* --- Notifications ---------------------------------------------------------------------------- */}
      <Section title={t('toast.heading')}>
        <div className="lt-showcase__row">
          {toastKinds.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="secondary"
              onClick={() => toast({ kind, title: t(`toast.${kind}`), message: t('toast.message') })}
            >
              {t(`toast.${kind}`)}
            </Button>
          ))}
        </div>
      </Section>

      {/* --- Modal window --------------------------------------------------------------------------------- */}
      <Section title={t('modal.heading')}>
        <Button variant="secondary" onClick={() => setModalOpen(true)}>
          {t('modal.open')}
        </Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={t('modal.title')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                {tc('actions.cancel')}
              </Button>
              <Button
                onClick={() => {
                  setModalOpen(false)
                  toast({ kind: 'ok', message: t('modal.done') })
                }}
              >
                {tc('actions.confirm')}
              </Button>
            </>
          }
        >
          <p>{t('modal.body')}</p>
        </Modal>
      </Section>

      {/* --- Tabs --------------------------------------------------------------------------------------------- */}
      <Section title={t('tabs.heading')}>
        <Tabs items={tabItems} value={tab} onChange={setTab} label={t('tabs.label')} />
        <p className="lt-showcase__tab-panel">{t('tabs.panel', { tab: activeTabLabel })}</p>
      </Section>

      {/* --- Form fields ------------------------------------------------------------------------------------------- */}
      <Section title={t('forms.heading')}>
        <div className="lt-showcase__grid lt-showcase__grid--forms">
          <Demo caption={t('forms.stateNormal')}>
            <TextField label={t('forms.name')} placeholder={t('forms.placeholder')} hint={t('forms.hint')} />
          </Demo>
          <Demo caption={t('forms.stateDisabled')}>
            <TextField label={t('forms.name')} defaultValue={t('forms.disabledValue')} disabled />
          </Demo>
          <Demo caption={t('forms.stateError')}>
            <TextField label={t('forms.name')} defaultValue="" error={t('forms.error')} />
          </Demo>

          <Demo caption={t('forms.stateNormal')}>
            <TextArea
              label={t('forms.instruction')}
              placeholder={t('forms.instructionPlaceholder')}
              defaultValue={t('forms.instructionValue')}
            />
          </Demo>
          <Demo caption={t('forms.stateDisabled')}>
            <TextArea label={t('forms.instruction')} defaultValue={t('forms.instructionValue')} disabled />
          </Demo>
          <Demo caption={t('forms.stateError')}>
            <TextArea label={t('forms.instruction')} defaultValue="" error={t('forms.error')} />
          </Demo>

          <Demo caption={t('forms.stateNormal')}>
            <Select label={t('forms.taskType')} defaultValue="classification">
              <option value="transcription">{tc('taskTypes.transcription')}</option>
              <option value="verification">{tc('taskTypes.verification')}</option>
              <option value="classification">{tc('taskTypes.classification')}</option>
              <option value="segmentation">{tc('taskTypes.segmentation')}</option>
              <option value="diarization">{tc('taskTypes.diarization')}</option>
              <option value="mos">{tc('taskTypes.mos')}</option>
            </Select>
          </Demo>
          <Demo caption={t('forms.stateDisabled')}>
            <Select label={t('forms.taskType')} defaultValue="segmentation" disabled>
              <option value="segmentation">{tc('taskTypes.segmentation')}</option>
            </Select>
          </Demo>
          <Demo caption={t('forms.stateError')}>
            <Select label={t('forms.taskType')} defaultValue="" error={t('forms.error')}>
              <option value="" />
              <option value="transcription">{tc('taskTypes.transcription')}</option>
            </Select>
          </Demo>
        </div>

        <div className="lt-showcase__row lt-showcase__row--gap-top lt-showcase__row--top">
          <Checkbox
            label={t('forms.checkbox')}
            hint={t('forms.checkboxHint')}
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <Checkbox label={t('forms.checkboxDisabled')} disabled />
          <Checkbox label={t('forms.checkboxDisabledChecked')} disabled defaultChecked />
        </div>
      </Section>

      {/* --- Banners --------------------------------------------------------------------------------------------------- */}
      <Section title={t('banner.heading')}>
        <div className="lt-showcase__stack lt-showcase__stack--wide">
          <Banner
            kind="warning"
            action={
              <Button size="sm" variant="secondary">
                {tc('actions.retry')}
              </Button>
            }
          >
            {t('banner.warning')}
          </Banner>
          <Banner kind="info">{t('banner.info')}</Banner>
        </div>
      </Section>

      {/* --- Empty state ----------------------------------------------------------------------------------------------------- */}
      <Section title={t('empty.heading')}>
        <div className="lt-showcase__grid">
          <Card padding="lg">
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
              action={<Button size="sm">{tc('actions.create')}</Button>}
            />
          </Card>
          <Demo caption={t('empty.compact')}>
            <Card padding="lg">
              <EmptyState compact title={t('empty.compactTitle')} description={tc('table.emptyFilteredHint')} />
            </Card>
          </Demo>
        </div>
      </Section>

      {/* --- Spinner ------------------------------------------------------------------------------------------------------------- */}
      <Section title={t('spinner.heading')}>
        <div className="lt-showcase__row lt-showcase__row--top">
          <Demo caption={t('spinner.s16')}>
            <Spinner size={16} />
          </Demo>
          <Demo caption={t('spinner.s24')}>
            <Spinner />
          </Demo>
          <Demo caption={t('spinner.s36')}>
            <Spinner size={36} label={tc('loading')} />
          </Demo>
        </div>
      </Section>

      {/* --- Key-value metadata -------------------------------------------------------------------------------------------------------- */}
      <Section title={t('kv.heading')}>
        <p className="lt-caption lt-showcase__caption lt-showcase__hint">{t('kv.hint')}</p>
        <KeyValueChips pairs={pairs} onChange={setPairs} />
      </Section>
    </div>
  )
}
