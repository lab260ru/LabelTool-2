// i18n keys for the "Dashboard" feature (ru + en at once, hardcoding forbidden).
import { registerFeatureI18n } from '../../i18n'

const ru = {
  title: 'Дашборд',
  loadError: 'Не удалось загрузить сводку. Проверьте соединение и повторите.',
  summary: {
    projects: 'Проектов',
    users: 'Пользователей',
    fragments: 'Фрагментов',
    inProgress: 'в работе: {{value}}',
    labeled: 'Размечено',
    labeledOf: '{{labeled}} из {{total}} фрагментов',
  },
  zombie: {
    title: 'Задачи-зомби',
    hint: 'Взяты в работу больше {{hours}} ч назад и до сих пор не сданы.',
    empty: 'Зависших задач нет',
    emptyHint: 'Все взятые в работу задачи сдаются вовремя.',
    colFragment: 'Фрагмент',
    colProject: 'Проект',
    colType: 'Тип задачи',
    colTakenBy: 'Кем взята',
    colHours: 'Висит',
    hours: '{{hours}} ч',
  },
  annotators: {
    top: 'Топ-3 разметчиков',
    topHint: 'Больше всего сданных задач',
    outsiders: 'Аутсайдеры',
    outsidersHint: 'Меньше всего сданных задач',
    tasks_one: '{{count}} задача',
    tasks_few: '{{count}} задачи',
    tasks_many: '{{count}} задач',
    tasks_other: '{{count}} задач',
    agreement: 'согласие {{value}}%',
    noGroup: 'без группы',
  },
  quick: {
    title: 'Быстрые действия',
    newProject: 'Новый проект',
    project: 'Проект',
    import: 'Импорт аудио',
    export: 'Экспорт',
    noProjects: 'Сначала создайте проект',
  },
}

const en: typeof ru = {
  title: 'Dashboard',
  loadError: 'Failed to load the summary. Check your connection and retry.',
  summary: {
    projects: 'Projects',
    users: 'Users',
    fragments: 'Fragments',
    inProgress: 'in progress: {{value}}',
    labeled: 'Labeled',
    labeledOf: '{{labeled}} of {{total}} fragments',
  },
  zombie: {
    title: 'Zombie tasks',
    hint: 'Taken more than {{hours}} h ago and still not submitted.',
    empty: 'No stuck tasks',
    emptyHint: 'Every task taken is submitted on time.',
    colFragment: 'Fragment',
    colProject: 'Project',
    colType: 'Task type',
    colTakenBy: 'Taken by',
    colHours: 'Stuck for',
    hours: '{{hours}} h',
  },
  annotators: {
    top: 'Top 3 annotators',
    topHint: 'Most tasks submitted',
    outsiders: 'Bottom 3 annotators',
    outsidersHint: 'Fewest tasks submitted',
    tasks_one: '{{count}} task',
    tasks_few: '{{count}} tasks',
    tasks_many: '{{count}} tasks',
    tasks_other: '{{count}} tasks',
    agreement: 'agreement {{value}}%',
    noGroup: 'no group',
  },
  quick: {
    title: 'Quick actions',
    newProject: 'New project',
    project: 'Project',
    import: 'Import audio',
    export: 'Export',
    noProjects: 'Create a project first',
  },
}

registerFeatureI18n('dashboard', { ru, en })
