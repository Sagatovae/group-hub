import type { HubData } from './types.ts'

const offsetDate = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
export function createDemo(): HubData {
  const subjects = [
    { id: 'math', name: 'Высшая математика', teacher: 'Преподаватель не указан', semester: 1, color: 'sage' },
    { id: 'code', name: 'Программирование', teacher: 'Преподаватель не указан', semester: 1, color: 'blue' },
    { id: 'physics', name: 'Физика', teacher: 'Преподаватель не указан', semester: 1, color: 'peach' },
    { id: 'english', name: 'Иностранный язык', teacher: 'Преподаватель не указан', semester: 1, color: 'lavender' },
  ]
  const sections = subjects.flatMap(s => ['Лекции', 'Семинары', 'Домашние задания', 'Лабораторные', 'Прочее'].map((name, position) => ({ id: `${s.id}-${position}`, subject_id: s.id, name, position })))
  return { subjects, sections, materials: [
    { id: 'welcome', subject_id: null, section_id: null, title: 'Всё для учёбы теперь здесь', body: 'Объявления группы, материалы по предметам и ближайшие дедлайны — в одном месте. Открой предмет, чтобы найти нужную лекцию или задание.\n\nЭто пример объявления. В деморежиме можно попробовать редактирование: изменения сохраняются только в этом браузере.', deadline: null, pinned: true, created_at: new Date().toISOString(), attachments: [] },
    { id: 'lab', subject_id: 'code', section_id: 'code-3', title: 'Лабораторная № 2. Работа с массивами', body: 'Пример задания: реализовать сортировку массива и подготовить короткий отчёт. Здесь староста может разместить условие, шаблон и ссылки на материалы.', deadline: offsetDate(3), pinned: false, created_at: new Date(Date.now()-3600000).toISOString(), attachments: [] },
    { id: 'math-lecture', subject_id: 'math', section_id: 'math-0', title: 'Лекция № 3. Пределы и непрерывность', body: 'Основные определения, свойства пределов и примеры решения задач. Сохраните блок в избранное, чтобы быстро вернуться к нему.', deadline: null, pinned: false, created_at: new Date(Date.now()-86400000).toISOString(), attachments: [] },
    { id: 'physics-hw', subject_id: 'physics', section_id: 'physics-2', title: 'Домашнее задание. Кинематика', body: 'Пример блока домашней работы. Добавьте номера задач, требования к решению и файл с условием.', deadline: offsetDate(6), pinned: false, created_at: new Date(Date.now()-172800000).toISOString(), attachments: [] },
  ] }
}
