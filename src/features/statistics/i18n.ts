/**
 * Statistics — i18n keys (namespace 'statistics', ru + en at once).
 * Registered at the feature-module level via registerFeatureI18n.
 */
import { registerFeatureI18n } from '../../i18n'

const ru = {
  title: 'Статистика',
  annotators: {
    heading: 'Разметчики',
    exportCsv: 'Экспорт CSV',
    exportDone_one: 'CSV сохранён: {{count}} строка',
    exportDone_few: 'CSV сохранён: {{count}} строки',
    exportDone_many: 'CSV сохранён: {{count}} строк',
    exportDone_other: 'CSV сохранён: {{count}} строки',
    exportEmpty: 'Нечего экспортировать: выборка пуста',
    empty: 'Нет данных по разметчикам',
    emptyHint: 'Измените фильтры или очистите поиск',
    loadError: 'Не удалось загрузить статистику разметчиков',
  },
  filters: {
    legend: 'Фильтры таблицы разметчиков',
    search: 'Поиск',
    searchPlaceholder: 'ФИО или логин…',
    student: 'Студент',
    group: 'Группа',
    allStudents: 'Все студенты',
    allGroups: 'Все группы',
    reset: 'Сбросить фильтры',
  },
  table: {
    fio: 'ФИО',
    login: 'Логин',
    group: 'Группа',
    tasksDone: 'Сдано задач',
    agreement: 'Согласие',
    consensus: 'В консенсусе',
    speed: 'Скорость',
    speedValue: '{{sec}} с/задача',
    lowAgreement: 'Согласие ниже 70%',
  },
  agreement: {
    heading: 'Метрики согласия',
    avgAgreement: 'Среднее согласие',
    avgConsensus: 'Консенсус-покрытие',
    project: 'Проект',
    colAgreement: 'Согласие',
    colConsensus: 'Покрытие',
  },
  progress: {
    heading: 'Прогресс проектов',
    fragments: '{{labeled}} из {{total}} фрагментов',
    aria: 'Прогресс проекта «{{name}}»',
  },
  charts: {
    weeklyHeading: 'Задач за неделю',
    weeklyHint: 'Сдано задач по дням за последние 7 дней — по текущей выборке разметчиков',
    weeklyAria: 'Столбчатая диаграмма «Задач за неделю»: {{summary}}',
    typesHeading: 'Распределение по типам задач',
    typesHint: 'Фрагменты по типам задач во всех проектах',
    typesAria: 'Распределение фрагментов по типам задач',
    typesValue: '{{n}} · {{pct}}%',
  },
  blocks: {
    loadError: 'Не удалось загрузить данные проектов',
  },
}

const en: typeof ru = {
  title: 'Statistics',
  annotators: {
    heading: 'Annotators',
    exportCsv: 'Export CSV',
    // _few/_many are unreachable in en (CLDR: one/other), but the structure mirrors ru (typeof ru)
    exportDone_one: 'CSV saved: {{count}} row',
    exportDone_few: 'CSV saved: {{count}} rows',
    exportDone_many: 'CSV saved: {{count}} rows',
    exportDone_other: 'CSV saved: {{count}} rows',
    exportEmpty: 'Nothing to export: selection is empty',
    empty: 'No annotator data',
    emptyHint: 'Adjust the filters or clear the search',
    loadError: 'Failed to load annotator statistics',
  },
  filters: {
    legend: 'Annotator table filters',
    search: 'Search',
    searchPlaceholder: 'Name or login…',
    student: 'Student',
    group: 'Group',
    allStudents: 'All students',
    allGroups: 'All groups',
    reset: 'Reset filters',
  },
  table: {
    fio: 'Full name',
    login: 'Login',
    group: 'Group',
    tasksDone: 'Tasks submitted',
    agreement: 'Agreement',
    consensus: 'In consensus',
    speed: 'Speed',
    speedValue: '{{sec}} s/task',
    lowAgreement: 'Agreement below 70%',
  },
  agreement: {
    heading: 'Agreement metrics',
    avgAgreement: 'Average agreement',
    avgConsensus: 'Consensus coverage',
    project: 'Project',
    colAgreement: 'Agreement',
    colConsensus: 'Coverage',
  },
  progress: {
    heading: 'Project progress',
    fragments: '{{labeled}} of {{total}} fragments',
    aria: 'Progress of project “{{name}}”',
  },
  charts: {
    weeklyHeading: 'Tasks over the week',
    weeklyHint: 'Tasks submitted per day over the last 7 days — for the current annotator selection',
    weeklyAria: 'Bar chart “Tasks over the week”: {{summary}}',
    typesHeading: 'Task type distribution',
    typesHint: 'Fragments by task type across all projects',
    typesAria: 'Distribution of fragments by task type',
    typesValue: '{{n}} · {{pct}}%',
  },
  blocks: {
    loadError: 'Failed to load project data',
  },
}

registerFeatureI18n('statistics', { ru, en })
