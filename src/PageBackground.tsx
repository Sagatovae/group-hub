import { Bell, BookOpen, CalendarDays, Clock3, FileText, FolderOpen, Paperclip, Pencil, Sparkles } from 'lucide-react'
import type { Page } from './lib/types'

const scenes = {
  home: [Bell, Paperclip, Sparkles, FileText],
  subjects: [BookOpen, Pencil, FolderOpen, Sparkles],
  subject: [FileText, Paperclip, Pencil, BookOpen],
  recent: [Clock3, Sparkles, FileText, FolderOpen],
  deadlines: [CalendarDays, Clock3, Pencil, Sparkles],
}
export function PageBackground({ page, subjectId, color }: { page: Page; subjectId: string | null; color?: string }) {
  const offset = [...(subjectId || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4
  const icons = scenes[page]
  return <div key={`${page}-${subjectId}`} className={`page-background scene-${page} tone-${color || 'sage'}`} aria-hidden="true">
    <span className="ambient-glow glow-one"/><span className="ambient-glow glow-two"/>
    <span className="ambient-orbit"/><span className="ambient-grid"/>
    {icons.map((_, index) => { const Icon = icons[(index + offset) % icons.length]; return <span key={index} className={`ambient-symbol symbol-${index}`}><Icon strokeWidth={.8}/></span> })}
  </div>
}
