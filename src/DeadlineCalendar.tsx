import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import type { HubData, Material } from './lib/types'
import { calendarDays, dayKey, materialDeadline, monthStart, parseDay } from './lib/deadlines'

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const fullDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })
const monthTitle = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

export function DeadlineCalendar({ data, renderMaterial }: { data: HubData; renderMaterial: (material: Material) => ReactNode }) {
  const [today, setToday] = useState(() => dayKey(new Date()))
  const [selected, setSelected] = useState(today)
  const [month, setMonth] = useState(() => monthStart(new Date()))
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    const sync = () => setToday(dayKey(new Date()))
    const interval = setInterval(sync, 60000)
    document.addEventListener('visibilitychange', sync)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', sync) }
  }, [])

  const events = new Map<string, Material[]>()
  for (const material of data.materials) {
    const key = materialDeadline(material, data.sections)
    if (key) events.set(key, [...(events.get(key) || []), material])
  }
  const days = calendarDays(month)
  const selectedEvents = (events.get(selected) || []).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const monthPrefix = dayKey(month).slice(0, 7)
  const monthCount = [...events].reduce((sum, [key, items]) => sum + (key.startsWith(monthPrefix) ? items.length : 0), 0)
  const nearest = [...events.keys()].filter(key => key >= today).sort()[0]
  const choose = (date: Date) => { setSelected(dayKey(date)); setMonth(monthStart(date)) }
  const shiftMonth = (offset: number) => {
    const next = monthStart(month)
    next.setMonth(next.getMonth() + offset)
    setMonth(next)
    // Keep one tabbable day in the visible grid after changing months.
    setSelected(dayKey(next))
  }
  const onDayKey = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const next = new Date(date)
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (event.key in offsets) next.setDate(next.getDate() + offsets[event.key])
    else if (event.key === 'Home') next.setDate(next.getDate() - (next.getDay() + 6) % 7)
    else if (event.key === 'End') next.setDate(next.getDate() + 6 - (next.getDay() + 6) % 7)
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const day = next.getDate()
      next.setDate(1)
      next.setMonth(next.getMonth() + (event.key === 'PageUp' ? -1 : 1))
      const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(day, last))
    } else return
    event.preventDefault()
    choose(next)
    requestAnimationFrame(() => buttons.current.get(dayKey(next))?.focus())
  }

  return <div className="deadline-layout">
    <section className="deadline-calendar" aria-label="Календарь дедлайнов">
      <div className="calendar-toolbar"><h2 id="calendar-month">{monthTitle.format(month)}</h2><div><button className="icon-button" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц"><ChevronLeft size={19}/></button><button className="icon-button" onClick={() => shiftMonth(1)} aria-label="Следующий месяц"><ChevronRight size={19}/></button></div></div>
      <div className="calendar-grid" role="grid" aria-labelledby="calendar-month">
        <div className="calendar-weekdays" role="row">{weekdays.map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
        {Array.from({ length: 6 }, (_, week) => <div className="calendar-week" role="row" key={week}>
          {days.slice(week * 7, week * 7 + 7).map(date => {
            const key = dayKey(date), items = events.get(key) || []
            const currentMonth = date.getMonth() === month.getMonth()
            return <div role="gridcell" aria-selected={selected === key} key={key}><button
              ref={node => { if (node) buttons.current.set(key, node); else buttons.current.delete(key) }}
              className={`calendar-day ${currentMonth ? '' : 'other-month'} ${key === today ? 'is-today' : ''} ${key === selected ? 'is-selected' : ''}`}
              tabIndex={key === selected ? 0 : -1} onClick={() => choose(date)} onKeyDown={event => onDayKey(event, date)}
              aria-current={key === today ? 'date' : undefined} aria-label={`${fullDate.format(date)}. Событий: ${items.length}`}>
              <span>{date.getDate()}</span><span className="calendar-dots" aria-hidden="true">{items.slice(0, 3).map(material => <i key={material.id} className={`event-dot dot-${data.subjects.find(subject => subject.id === material.subject_id)?.color || 'sage'}`}/>)}</span>
            </button></div>
          })}
        </div>)}
      </div>
      <div className="calendar-actions"><button className="button outline" onClick={() => choose(parseDay(today)!)}>Сегодня</button>{nearest && <button className="button subtle" onClick={() => choose(parseDay(nearest)!)}>К ближайшему</button>}</div>
      <div className="calendar-note"><span className="calendar-legend-dot"/><span>Точки — материалы и объявления с дедлайном.<br/>Событий в этом месяце: {monthCount}.</span></div>
    </section>
    <section className="deadline-day-events" aria-labelledby="selected-day-title">
      <div className="deadline-day-heading"><div><span className="eyebrow">ВЫБРАННЫЙ ДЕНЬ</span><h2 id="selected-day-title">{fullDate.format(parseDay(selected)!)}</h2></div><span className="count-chip" aria-label={`Событий: ${selectedEvents.length}`}>{selectedEvents.length}</span></div>
      <div className="materials-list" key={selected}>{selectedEvents.map(renderMaterial)}</div>
      {!selectedEvents.length && <div className="empty-state"><CalendarDays size={32}/><h3>На этот день дедлайнов нет</h3><p>Выберите дату с точками. Чтобы добавить событие, укажите дедлайн при создании или редактировании блока.</p>{nearest && nearest !== selected && <button className="button outline" onClick={() => choose(parseDay(nearest)!)}>Ближайший дедлайн</button>}</div>}
    </section>
  </div>
}
