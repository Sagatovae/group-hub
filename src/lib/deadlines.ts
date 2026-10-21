import type { Material, Section } from './types'

export function dayKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(12, 0, 0, 0)
  return dayKey(date) === value ? date : null
}

export function isLectureSection(section?: Pick<Section, 'name'>): boolean {
  return /^(?:лекци|лекц\.?$|lectures?(?:\s|$))/iu.test(section?.name.normalize('NFKC').trim() || '')
}

export function materialDeadline(material: Material, sections: Section[]): string | null {
  const section = material.subject_id ? sections.find(item => item.id === material.section_id && item.subject_id === material.subject_id) : undefined
  if (!material.deadline || isLectureSection(section)) return null
  return parseDay(material.deadline) ? material.deadline : null
}

export function monthStart(date: Date): Date {
  const first = new Date(date)
  first.setDate(1)
  first.setHours(12, 0, 0, 0)
  return first
}

export function calendarDays(month: Date): Date[] {
  const first = monthStart(month)
  first.setDate(1 - (first.getDay() + 6) % 7)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first)
    date.setDate(first.getDate() + index)
    return date
  })
}
