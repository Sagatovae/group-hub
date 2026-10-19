import type { Attachment, HubData, Material, Subject } from './types.ts'

export function safeUrl(value: string): string | null {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null }
  catch { return null }
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value))
}
export function formatSize(bytes?: number): string {
  if (bytes === undefined) return 'Внешняя ссылка'
  return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1048576).toFixed(1)} МБ`
}
export function sortMaterials(materials: Material[]): Material[] {
  return [...materials].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at))
}
export function matchesQuery(material: Material, query: string): boolean {
  const text = [material.title, material.body, material.author || '', ...material.attachments.map(a => a.name)].join(' ').toLocaleLowerCase('ru')
  return text.includes(query.trim().toLocaleLowerCase('ru'))
}
export function normalizeData(data: HubData): HubData {
  return {
    ...data,
    subjects: data.subjects.map((s, index) => ({ ...s, position: s.position ?? index }))
      .sort((a,b) => a.position-b.position || a.name.localeCompare(b.name,'ru') || a.id.localeCompare(b.id)),
    materials: data.materials.map(m => ({ ...m, author: m.author ?? null })),
  }
}
export function moveSubject(subjects: Subject[], id: string, direction: -1 | 1, visibleIds = subjects.map(s => s.id)): Subject[] {
  const visibleIndex = visibleIds.indexOf(id)
  const neighbor = visibleIds[visibleIndex + direction]
  const from = subjects.findIndex(s => s.id === id), to = subjects.findIndex(s => s.id === neighbor)
  if (visibleIndex < 0 || from < 0 || to < 0) return subjects
  const next = [...subjects]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next.map((s, position) => ({ ...s, position }))
}
export function isImageAttachment(attachment: Attachment): boolean {
  return ['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(attachment.mime_type || '')
    || /\.(png|jpe?g|webp|gif|avif)$/i.test(attachment.name)
}
export function upcomingDeadlines(materials: Material[], now = new Date()): Material[] {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return materials.filter(m => m.deadline && m.deadline >= today).sort((a, b) => a.deadline!.localeCompare(b.deadline!))
}
