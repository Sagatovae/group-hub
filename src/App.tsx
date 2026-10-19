import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowRight, Bell, BookOpen, Bookmark, CalendarDays, Check, ChevronRight, CircleHelp, File, FolderOpen, GraduationCap, Link as LinkIcon, LoaderCircle, LogIn, LogOut, Menu, MoreHorizontal, Pencil, Pin, Plus, Search, Trash2, Upload, WifiOff, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { addSubject, deleteMaterial, demoFileUrl, isDemo, persistDemo, readData, removeFiles, saveMaterial, saveSection, supabase, uploadFile } from './lib/storage'
import type { Attachment, HubData, Material, Page, Section, Subject } from './lib/types'
import { formatDate, formatSize, matchesQuery, safeUrl, sortMaterials, upcomingDeadlines } from './lib/utils'

type Modal = { kind: 'material'; material?: Material } | { kind: 'subject' } | { kind: 'section'; section?: Section } | { kind: 'login' } | { kind: 'delete'; material: Material } | { kind: 'help' } | null
const empty: HubData = { subjects: [], sections: [], materials: [] }
const navItems: { page: Page; name: string; icon: typeof Bell }[] = [
  { page: 'home', name: 'Объявления', icon: Bell }, { page: 'subjects', name: 'Предметы', icon: BookOpen },
  { page: 'files', name: 'Все файлы', icon: FolderOpen }, { page: 'saved', name: 'Избранное', icon: Bookmark },
]
function readSaved(): string[] { try { const value: unknown = JSON.parse(localStorage.getItem('group-hub-saved') || '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [] } catch { return [] } }
function readRoute(): { page: Page; subjectId: string | null } {
  const route = location.hash.slice(1).split('/')
  if (route[0] === 'subject' && route[1]) return { page: 'subject', subjectId: route[1] }
  return { page: ['home', 'subjects', 'files', 'saved'].includes(route[0]) ? route[0] as Page : 'home', subjectId: null }
}

function AttachmentLink({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true, objectUrl: string | null = null
    if (attachment.url.startsWith('demo-file:')) {
      demoFileUrl(attachment.url.slice(10)).then(value => { objectUrl = value; if (active) setUrl(value); else if (value) URL.revokeObjectURL(value) }).catch(() => setUrl(null))
    } else setUrl(safeUrl(attachment.url))
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [attachment.url])
  return <a className={`attachment ${!url ? 'disabled' : ''}`} href={url || undefined} target="_blank" rel="noopener noreferrer" download={attachment.url.startsWith('demo-file:') ? attachment.name : undefined} aria-disabled={!url}>
    <span className="file-icon"><File size={19} /></span><span><strong>{attachment.name}</strong><small>{url ? formatSize(attachment.size) : 'Файл недоступен'}</small></span><ArrowDownToLine size={17} />
  </a>
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      if (e.key === 'Tab') {
        const elements = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')
        if (!elements?.length) return
        const first = elements[0], last = elements[elements.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handler)
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = previousOverflow; previous?.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={ref}><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Закрыть окно"><X size={20} /></button></div>{children}</div></div>
}

export default function App() {
  const [data, setData] = useState<HubData>(empty)
  const [route, setRoute] = useState(readRoute)
  const [sectionId, setSectionId] = useState('all')
  const [query, setQuery] = useState('')
  const [semester, setSemester] = useState('all')
  const [loading, setLoading] = useState(true)
  const [cached, setCached] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [saved, setSaved] = useState(readSaved)
  const [admin, setAdmin] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState(false)
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  const { page, subjectId } = route
  const subject = data.subjects.find(s => s.id === subjectId)
  const sections = data.sections.filter(s => s.subject_id === subjectId).sort((a,b) => a.position-b.position)
  const editable = admin && !cached
  const currentRequest = useRef(0)
  const load = async () => {
    const request = ++currentRequest.current
    setLoading(true); setError('')
    try { const result = await readData(); if (request === currentRequest.current) { setData(result.data); setCached(result.cached) } }
    catch (e) { if (request === currentRequest.current) setError((e as Error).message) }
    finally { if (request === currentRequest.current) setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    const handler = () => { setRoute(readRoute()); setSectionId('all'); setQuery(''); setMenuOpen(false) }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  useEffect(() => {
    if (!supabase) return
    let active = true
    let revision = 0
    const client = supabase
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      const check = ++revision
      setSignedIn(!!session); setAdmin(false)
      if (session) {
        void client.from('administrators').select('user_id').eq('user_id', session.user.id).maybeSingle().then(({ data: row }) => {
          if (active && check === revision) setAdmin(!!row)
        })
      }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 5000); return () => clearTimeout(id) }, [toast])

  const navigate = (next: Page, id?: string) => { location.hash = next === 'subject' ? `subject/${id}` : next; setMenuOpen(false) }
  const changeData = async (next: HubData) => { if (isDemo) await persistDemo(next); setData(next) }
  const toggleSaved = (id: string) => {
    const next = saved.includes(id) ? saved.filter(s => s !== id) : [...saved, id]
    setSaved(next)
    try { localStorage.setItem('group-hub-saved', JSON.stringify(next)) } catch { setToast('Избранное изменено, но браузер не разрешил сохранить его после закрытия.') }
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); setModal(null) } catch (e) { setError((e as Error).message || 'Не удалось выполнить действие.') } finally { setBusy(false) }
  }
  const openModal = (next: Modal) => { setError(''); setModal(next) }
  const closeModal = () => { if (!busy) { setModal(null); setError('') } }
  const deadlines = upcomingDeadlines(data.materials)
  const subjectName = (id: string | null) => data.subjects.find(s => s.id === id)?.name || 'Для всей группы'
  const sectionName = (id: string | null) => data.sections.find(s => s.id === id)?.name || 'Объявление'
  const visible = sortMaterials(data.materials.filter(m => {
    if (page === 'home' && m.subject_id !== null) return false
    if (page === 'subject' && (m.subject_id !== subjectId || sectionId !== 'all' && m.section_id !== sectionId)) return false
    if (page === 'saved' && !saved.includes(m.id)) return false
    if (page === 'files' && !m.attachments.length) return false
    return matchesQuery(m, query)
  }))
  const filteredSubjects = data.subjects.filter(s => (semester === 'all' || s.semester === Number(semester)) && `${s.name} ${s.teacher}`.toLowerCase().includes(query.toLowerCase().trim()))

  const materialCard = (m: Material) => <article className={`material-card ${m.pinned ? 'pinned' : ''}`} key={m.id}>
    <div className="card-topline"><span className={`badge ${m.pinned ? 'important' : ''}`}>{m.pinned ? <Pin size={12} /> : <BookOpen size={12} />}{m.pinned ? 'Закреплено' : sectionName(m.section_id)}</span><span className="card-date">{formatDate(m.created_at)}</span><button className={`icon-button bookmark-button ${saved.includes(m.id) ? 'selected' : ''}`} onClick={() => toggleSaved(m.id)} aria-label={saved.includes(m.id) ? `Убрать из избранного: ${m.title}` : `В избранное: ${m.title}`} aria-pressed={saved.includes(m.id)}><Bookmark size={18} fill={saved.includes(m.id) ? 'currentColor' : 'none'} /></button></div>
    <h3>{m.title}</h3><p className="material-body">{m.body}</p>
    {!!m.attachments.length && <div className="attachments">{m.attachments.map(a => <AttachmentLink attachment={a} key={a.id} />)}</div>}
    <div className="card-footer"><span className="author-avatar">С</span><span>Староста группы</span>{m.subject_id && <button className="subject-link" onClick={() => navigate('subject', m.subject_id!)}>{subjectName(m.subject_id)}<ChevronRight size={13}/></button>}{m.deadline && <span className="deadline-badge"><CalendarDays size={13} />До {formatDate(m.deadline)}</span>}{editable && <div className="card-actions"><button className="icon-button" onClick={() => openModal({ kind: 'material', material: m })} aria-label={`Редактировать: ${m.title}`}><Pencil size={15}/></button><button className="icon-button danger-text" onClick={() => openModal({ kind: 'delete', material: m })} aria-label={`Удалить: ${m.title}`}><Trash2 size={15}/></button></div>}</div>
  </article>

  return <div className="app-shell">
    {menuOpen && <button className="sidebar-scrim" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href="#home"><span className="brand-mark">Г<span>●</span></span><span>группа<span className="brand-dot">.</span></span></a>
      <div className="group-switch"><span className="group-avatar"><GraduationCap size={20}/></span><div><strong>ИДБ-26-09</strong><small>Учебное пространство</small></div><span className="status-dot"/></div>
      <p className="nav-caption">ПРОСТРАНСТВО</p><nav aria-label="Главная навигация">{navItems.map(({ page: p, name, icon: Icon }) => <button key={p} className={`nav-item ${page === p ? 'active' : ''}`} onClick={() => navigate(p)}><Icon size={19}/><span>{name}</span>{p === 'saved' && saved.length > 0 && <span className="nav-count">{saved.length}</span>}</button>)}</nav>
      <div className="subject-nav-heading"><p className="nav-caption">МОИ ПРЕДМЕТЫ</p>{editable && <button className="icon-button" onClick={() => openModal({ kind: 'subject' })} aria-label="Добавить предмет"><Plus size={15}/></button>}</div>
      <nav className="subjects-nav" aria-label="Предметы">{data.subjects.slice(0,8).map(s => <button key={s.id} className={`nav-item small ${subjectId === s.id ? 'active' : ''}`} onClick={() => navigate('subject',s.id)}><span className={`subject-dot ${s.color}`}/><span>{s.name}</span></button>)}{!data.subjects.length && <span className="sidebar-empty">Предметов пока нет</span>}</nav>
      <div className="sidebar-bottom"><div className="study-note"><BookOpen size={21}/><strong>Всё нужное — под рукой</strong><p>Учитесь вместе.<br/>Не теряйте важное.</p></div><button className="help-link" onClick={() => openModal({ kind: 'help' })}><CircleHelp size={17}/>Как это работает<ArrowRight size={15}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Открыть меню" onClick={() => setMenuOpen(true)}><Menu size={22}/></button><span>Пространство группы</span><ChevronRight size={14}/><strong>{page === 'subject' ? subject?.name || 'Предмет' : navItems.find(n => n.page === page)?.name}</strong></div><div className="header-controls"><span className={`mode-pill ${isDemo ? '' : 'live'}`}><span/>{isDemo ? 'Демоверсия' : 'Онлайн'}</span>{isDemo ? <button className={`button ${admin ? 'subtle' : 'outline'} compact`} onClick={() => { setAdmin(!admin); setToast(admin ? 'Режим просмотра' : 'Деморедактор: изменения сохраняются в этом браузере') }}>{admin ? <Check size={15}/> : <Pencil size={15}/>}{admin ? 'Редактор включён' : 'Попробовать редактор'}</button> : signedIn ? <button className="button outline compact" onClick={() => void supabase!.auth.signOut().then(({error}) => { if(error) setToast('Не удалось выйти. Проверьте интернет.') })}><LogOut size={15}/>Выйти</button> : <button className="button outline compact" onClick={() => openModal({ kind: 'login' })}><LogIn size={15}/>Вход старосты</button>}</div></header>
      <main>
        {isDemo && <div className="demo-banner"><span><span className="tiny-dot"/>Это демоверсия. Материалы — примеры, изменения видны только в этом браузере.</span><button onClick={() => openModal({kind:'help'})}>Подробнее<ArrowRight size={13}/></button></div>}
        {cached && <div className="notice"><WifiOff size={18}/>Показана сохранённая копия материалов. Редактирование временно недоступно.<button className="text-button" onClick={() => void load()}>Обновить</button></div>}
        {needRefresh && <div className="notice">Доступна новая версия сайта.<button className="text-button" onClick={() => void updateServiceWorker(true)}>Обновить приложение</button></div>}
        {error && !modal && <div className="error-box" role="alert">{error}<button className="text-button" onClick={() => void load()}>Повторить</button></div>}
        <div className="page-heading"><div><div className="eyebrow">{page === 'subject' ? `ПРЕДМЕТ · ${subject?.semester || 1} СЕМЕСТР` : 'УЧЕБНОЕ ПРОСТРАНСТВО'}</div><h1>{page === 'home' ? 'На связи, группа' : page === 'subject' ? subject?.name || 'Предмет не найден' : page === 'subjects' ? 'Наши предметы' : page === 'files' ? 'Все файлы' : 'Избранное'}{page === 'home' && <span className="heading-asterisk">✳</span>}</h1><p>{page === 'home' ? 'Важные новости и материалы, чтобы ничего не пропустить.' : page === 'subject' ? subject?.teacher || 'Выберите предмет в меню' : page === 'subjects' ? 'Лекции, задания и полезные материалы — у каждого предмета своё место.' : page === 'files' ? 'Все вложения группы и предметов в одном месте.' : 'Материалы, которые вы сохранили на этом устройстве.'}</p></div>{editable && <button className="button primary" onClick={() => openModal(page === 'subjects' ? {kind:'subject'} : {kind:'material'})}><Plus size={18}/>{page === 'subjects' ? 'Добавить предмет' : 'Добавить блок'}</button>}</div>
        {loading ? <div className="loading"><LoaderCircle className="spin" size={24}/>Загружаем пространство…</div> : <>
        {page === 'home' && <div className="stats-grid"><button onClick={() => navigate('subjects')}><span className="stat-icon sage"><BookOpen size={21}/></span><span><strong>{data.subjects.length}</strong><small>предмета в пространстве</small></span><ArrowRight size={17}/></button><button onClick={() => navigate('files')}><span className="stat-icon peach"><FolderOpen size={21}/></span><span><strong>{data.materials.reduce((n,m)=>n+m.attachments.length,0)}</strong><small>файлов и полезных ссылок</small></span><ArrowRight size={17}/></button><div><span className="stat-icon lavender"><CalendarDays size={21}/></span><span><strong>{deadlines.length}</strong><small>предстоящих дедлайна</small></span></div></div>}
        {page === 'subjects' ? <><div className="content-toolbar"><label className="search-input"><Search size={17}/><input aria-label="Поиск предметов" placeholder="Найти предмет…" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Семестр" value={semester} onChange={e=>setSemester(e.target.value)}><option value="all">Все семестры</option>{[...new Set(data.subjects.map(s=>s.semester))].sort((a,b)=>a-b).map(s=><option key={s} value={s}>{s} семестр</option>)}</select></div><div className="subject-grid">{filteredSubjects.map((s,i)=><button className="subject-card" key={s.id} onClick={()=>navigate('subject',s.id)}><div className={`subject-cover ${s.color}`}><span className="subject-symbol">{['∑','</>','φ','Aa'][i%4]}</span><span className="semester-pill">{s.semester} семестр</span></div><div className="subject-card-content"><h3>{s.name}</h3><p>{s.teacher || 'Преподаватель не указан'}</p><div><span>{data.materials.filter(m=>m.subject_id===s.id).length} материалов</span><ArrowRight size={18}/></div></div></button>)}</div>{!filteredSubjects.length && <div className="empty-state"><BookOpen size={32}/><h3>Предметов пока нет</h3><p>{query ? 'Попробуйте изменить запрос.' : 'Староста может добавить первый предмет.'}</p></div>}</> : <div className={page === 'home' ? 'content-columns' : ''}><section className="feed">
          {page === 'subject' && <div className="section-tabs" role="tablist" aria-label="Разделы предмета"><button role="tab" aria-selected={sectionId==='all'} className={sectionId==='all'?'active':''} onClick={()=>setSectionId('all')}>Все материалы</button>{sections.map(s=><button role="tab" aria-selected={sectionId===s.id} className={sectionId===s.id?'active':''} key={s.id} onClick={()=>setSectionId(s.id)}>{s.name}</button>)}{editable && subject && <button aria-label="Добавить раздел" onClick={()=>openModal({kind:'section'})}><Plus size={17}/></button>}</div>}
          <div className="feed-heading"><div><h2>{page === 'home' ? 'Объявления группы' : page === 'subject' ? sections.find(s=>s.id===sectionId)?.name || 'Все материалы' : page === 'files' ? 'Файлы и ссылки' : 'Сохранённые блоки'}</h2><span className="count-chip">{visible.length}</span>{editable && page==='subject' && sectionId!=='all' && <button className="icon-button" aria-label="Переименовать раздел" onClick={()=>openModal({kind:'section',section:sections.find(s=>s.id===sectionId)})}><Pencil size={15}/></button>}</div><span className="sort-label">Сначала новые<MoreHorizontal size={18}/></span></div>
          <label className="search-input feed-search"><Search size={17}/><input aria-label="Поиск материалов" placeholder="Поиск по материалам и файлам…" value={query} onChange={e=>setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="Очистить поиск" onClick={()=>setQuery('')}><X size={15}/></button>}</label>
          <div className="materials-list">{visible.map(materialCard)}</div>{!visible.length && <div className="empty-state"><FolderOpen size={34}/><h3>{query ? 'Ничего не нашлось' : 'Здесь пока пусто'}</h3><p>{query ? 'Попробуйте другой запрос.' : page === 'saved' ? 'Нажмите на закладку у нужного блока — он появится здесь.' : 'Когда староста добавит материалы, они появятся здесь.'}</p>{editable && page!=='saved' && <button className="button outline" onClick={()=>openModal({kind:'material'})}><Plus size={16}/>Добавить первый блок</button>}</div>}
        </section>{page === 'home' && <aside className="right-column"><section className="deadlines-panel"><div className="panel-heading"><h2>Ближайшие дедлайны</h2><CalendarDays size={18}/></div>{deadlines.slice(0,4).map(m=><button className="deadline-item" key={m.id} onClick={()=>navigate(m.subject_id ? 'subject' : 'home',m.subject_id || undefined)}><span className="date-tile"><strong>{new Date(`${m.deadline}T12:00:00`).getDate()}</strong><small>{new Intl.DateTimeFormat('ru',{month:'short'}).format(new Date(`${m.deadline}T12:00:00`))}</small></span><span><strong>{m.title}</strong><small>{subjectName(m.subject_id)}</small></span></button>)}{!deadlines.length && <p className="muted panel-empty">Пока без срочных заданий. Можно выдохнуть.</p>}<div className="panel-footnote"><span className="tiny-dot"/>Дедлайны из учебных материалов</div></section><section className="quick-subjects"><div className="panel-heading"><h2>Быстрый переход</h2><button className="icon-button" aria-label="Все предметы" onClick={()=>navigate('subjects')}><ArrowRight size={17}/></button></div>{data.subjects.slice(0,4).map(s=><button key={s.id} onClick={()=>navigate('subject',s.id)}><span className={`mini-subject ${s.color}`}><BookOpen size={16}/></span><span>{s.name}</span><ChevronRight size={15}/></button>)}</section><div className="little-note"><span>✳</span><p>Большие дела начинаются<br/>с маленького конспекта.</p></div></aside>}</div>}
        </>}
        <footer className="page-footer"><span>Группа. Место, где учиться проще.</span><span>Сделано для своих <span className="footer-spark">✳</span></span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
    {modal && <Dialog title={modal.kind==='material' ? modal.material ? 'Редактировать блок' : 'Новый блок' : modal.kind==='subject' ? 'Новый предмет' : modal.kind==='section' ? modal.section ? 'Название раздела' : 'Новый раздел' : modal.kind==='login' ? 'Вход для старосты' : modal.kind==='delete' ? 'Удалить блок?' : 'Ваше учебное пространство'} close={closeModal}>
      {error && <div className="error-box" role="alert">{error}</div>}
      {modal.kind==='material' && <MaterialForm initial={modal.material} data={data} subjectId={page==='subject'?subjectId:null} sectionId={sectionId} busy={busy} cancel={closeModal} submit={(material, files)=>void run(async()=>{
        const uploaded: Attachment[] = []
        try {
          for(const file of files) uploaded.push(await uploadFile(file))
          const complete = {...material, attachments:[...material.attachments,...uploaded]}
          await saveMaterial(complete)
          await changeData({...data,materials:[complete,...data.materials.filter(m=>m.id!==complete.id)]})
        } catch(e) { try { await removeFiles(uploaded) } catch { /* Preserve the original error. */ } throw e }
        const removed = modal.material?.attachments.filter(a=>!material.attachments.some(b=>a.id===b.id)) || []
        try { await removeFiles(removed); setToast(isDemo?'Блок сохранён в этом браузере':'Блок опубликован') } catch(e) { setToast((e as Error).message) }
      })}/>}
      {modal.kind==='subject' && <SubjectForm busy={busy} cancel={closeModal} submit={s=>void run(async()=>{
        const newSections = ['Лекции','Семинары','Домашние задания','Лабораторные','Прочее'].map((name,position)=>({id:crypto.randomUUID(),subject_id:s.id,name,position}))
        await addSubject(s,newSections); await changeData({...data,subjects:[...data.subjects,s],sections:[...data.sections,...newSections]}); navigate('subject',s.id); setToast('Предмет добавлен')
      })}/>}
      {modal.kind==='section' && <form onSubmit={e=>{e.preventDefault(); const form=new FormData(e.currentTarget); const name=String(form.get('name')).trim(); if(!name) return; void run(async()=>{ if(!subjectId) return; const s: Section={id:modal.section?.id || crypto.randomUUID(),subject_id:subjectId,name,position:modal.section?.position ?? sections.length}; await saveSection(s); await changeData({...data,sections:[...data.sections.filter(x=>x.id!==s.id),s]}); setToast('Раздел сохранён') }) }}><label className="field">Название<input name="name" required maxLength={60} defaultValue={modal.section?.name} placeholder="Например, подготовка к экзамену"/></label><FormActions busy={busy} cancel={closeModal}/></form>}
      {modal.kind==='login' && <form onSubmit={e=>{e.preventDefault(); const f=new FormData(e.currentTarget); void run(async()=>{const {error}=await supabase!.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))}); if(error) throw new Error('Не удалось войти. Проверьте почту и пароль.'); setToast('Вход выполнен. Права редактирования назначает владелец проекта.')})}}><p className="form-note">Учётную запись старосты создаёт владелец сайта. Студентам для просмотра вход не нужен.</p><label className="field">Почта<input name="email" type="email" autoComplete="username" required/></label><label className="field">Пароль<input name="password" type="password" autoComplete="current-password" required/></label><FormActions busy={busy} cancel={closeModal} label="Войти"/></form>}
      {modal.kind==='delete' && <><p className="form-note">Блок «{modal.material.title}» и загруженные в него файлы будут удалены. Внешние файлы по ссылкам останутся в облаке.</p><div className="form-actions"><button className="button outline" disabled={busy} onClick={closeModal}>Отмена</button><button className="button danger" disabled={busy} onClick={()=>void run(async()=>{await deleteMaterial(modal.material.id); await changeData({...data,materials:data.materials.filter(m=>m.id!==modal.material.id)}); try{await removeFiles(modal.material.attachments);setToast('Блок удалён')}catch{setToast('Блок удалён, но файлы нужно убрать из хранилища вручную.')} })}>{busy?<LoaderCircle className="spin" size={17}/>:<Trash2 size={17}/>}Удалить блок</button></div></>}
      {modal.kind==='help' && <div className="help-content"><div className="help-illustration"><GraduationCap size={44}/></div><p>Объявления — для новостей всей группы. В предметах находятся лекции, домашние задания, лабораторные и другие разделы.</p><p>Закладка у блока добавляет его в избранное на этом устройстве. Загруженные файлы и внешние ссылки открываются из блока.</p>{isDemo?<div className="notice stacked"><strong>Сейчас открыт деморежим</strong><span>Редактор доступен без пароля. Его изменения и файлы сохраняются только в вашем браузере. Для совместной работы нужно подключить Supabase по инструкции в README проекта.</span></div>:<p>Редактировать материалы могут только назначенные старосты. Материалы этого пространства доступны всем по ссылке.</p>}<p>После установки PWA сохранённые тексты можно читать без интернета. Для открытия файлов и внешних ссылок обычно нужно подключение.</p><button className="button primary" onClick={closeModal}>Понятно<Check size={16}/></button></div>}
    </Dialog>}
  </div>
}

function FormActions({busy,cancel,label='Сохранить'}:{busy:boolean;cancel:()=>void;label?:string}) { return <div className="form-actions"><button type="button" className="button outline" disabled={busy} onClick={cancel}>Отмена</button><button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}{busy?'Сохраняем…':label}</button></div> }

function SubjectForm({busy,cancel,submit}:{busy:boolean;cancel:()=>void;submit:(s:Subject)=>void}) {
  return <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const name=String(f.get('name')).trim();if(!name)return;submit({id:crypto.randomUUID(),name,teacher:String(f.get('teacher')).trim(),semester:Number(f.get('semester')),color:String(f.get('color'))})}}><label className="field">Название предмета<input name="name" placeholder="Например, высшая математика" required maxLength={120}/></label><label className="field">Преподаватель<input name="teacher" maxLength={120} placeholder="Необязательно"/></label><div className="form-row"><label className="field">Семестр<input name="semester" type="number" min="1" max="12" defaultValue="1" required/></label><label className="field">Цвет<select name="color"><option value="sage">Зелёный</option><option value="blue">Голубой</option><option value="peach">Персиковый</option><option value="lavender">Сиреневый</option></select></label></div><p className="form-note">Разделы «Лекции», «Семинары», «Домашние задания», «Лабораторные» и «Прочее» появятся автоматически.</p><FormActions busy={busy} cancel={cancel} label="Создать предмет"/></form>
}

function MaterialForm({initial,data,subjectId,sectionId,busy,cancel,submit}:{initial?:Material;data:HubData;subjectId:string|null;sectionId:string;busy:boolean;cancel:()=>void;submit:(m:Material,files:File[])=>void}) {
  const [selectedSubject,setSelectedSubject]=useState(initial?.subject_id || subjectId || '')
  const [selectedSection,setSelectedSection]=useState(initial?.section_id || (sectionId==='all'?'':sectionId))
  const [attachments,setAttachments]=useState<Attachment[]>(initial?.attachments || [])
  const [files,setFiles]=useState<File[]>([])
  const [linkName,setLinkName]=useState('')
  const [linkUrl,setLinkUrl]=useState('')
  const [validation,setValidation]=useState('')
  const availableSections=data.sections.filter(s=>s.subject_id===selectedSubject).sort((a,b)=>a.position-b.position)
  const addLink=()=>{const url=safeUrl(linkUrl);if(!url){setValidation('Введите полную ссылку, которая начинается с https:// или http://.');return}setAttachments([...attachments,{id:crypto.randomUUID(),name:linkName.trim()||new URL(url).hostname,url}]);setLinkName('');setLinkUrl('');setValidation('')}
  const onSubmit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault(); const f=new FormData(e.currentTarget);const title=String(f.get('title')).trim(); if(!title)return;if(linkUrl.trim()||linkName.trim()){setValidation('Нажмите «Добавить ссылку» или очистите поля ссылки перед сохранением.');return}submit({id:initial?.id||crypto.randomUUID(),subject_id:selectedSubject||null,section_id:selectedSubject?selectedSection:null,title,body:String(f.get('body')).trim(),deadline:String(f.get('deadline'))||null,pinned:f.get('pinned')==='on',created_at:initial?.created_at||new Date().toISOString(),attachments},files)}
  return <form onSubmit={onSubmit}>
    {validation&&<div className="error-box" role="alert">{validation}</div>}
    <div className="form-row"><label className="field">Где опубликовать<select value={selectedSubject} onChange={e=>{setSelectedSubject(e.target.value);setSelectedSection('')}}><option value="">Объявления группы</option>{data.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{selectedSubject&&<label className="field">Раздел<select value={selectedSection} required onChange={e=>setSelectedSection(e.target.value)}><option value="" disabled>Выберите раздел</option>{availableSections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}</div>
    <label className="field">Заголовок<input name="title" required maxLength={180} defaultValue={initial?.title} placeholder="Например, лабораторная № 2"/></label><label className="field">Описание<textarea name="body" rows={5} maxLength={20000} defaultValue={initial?.body} placeholder="Задание, пояснения и всё, что важно знать группе"/></label>
    <div className="form-row"><label className="field">Сдать до<input name="deadline" type="date" defaultValue={initial?.deadline||''}/></label><label className="checkbox-field"><input name="pinned" type="checkbox" defaultChecked={initial?.pinned}/>Закрепить блок</label></div>
    <div className="form-divider"/><h3 className="form-subheading">Файлы и ссылки</h3><p className="form-note">До 10 МБ на файл. Большие материалы можно добавить ссылкой на облако.</p>
    <label className="upload-zone"><Upload size={20}/><span>Выбрать файлы</span><input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip,.png,.jpg,.jpeg,.webp" onChange={e=>{const picked=Array.from(e.target.files||[]);if(picked.some(f=>f.size>10*1024*1024)){setValidation('Один из файлов больше 10 МБ. Добавьте его ссылкой.');e.target.value='';return}setFiles([...files,...picked]);setValidation('');e.target.value=''}} disabled={busy}/></label>
    {files.map((f,i)=><div className="attachment-row" key={`${f.name}-${i}`}><File size={16}/><span>{f.name}<small>{formatSize(f.size)}</small></span><button type="button" className="icon-button" aria-label={`Убрать файл ${f.name}`} onClick={()=>setFiles(files.filter((_,n)=>n!==i))}><X size={16}/></button></div>)}
    {attachments.map(a=><div className="attachment-row" key={a.id}><LinkIcon size={16}/><span>{a.name}</span><button type="button" className="icon-button" aria-label={`Убрать вложение ${a.name}`} onClick={()=>setAttachments(attachments.filter(x=>x.id!==a.id))}><X size={16}/></button></div>)}
    <div className="link-fields"><label className="field">Название ссылки<input value={linkName} onChange={e=>setLinkName(e.target.value)} placeholder="Например, шаблон отчёта" maxLength={180}/></label><label className="field">Ссылка<input value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="https://…"/></label><button className="button outline" type="button" onClick={addLink} disabled={busy}><LinkIcon size={16}/>Добавить ссылку</button></div><FormActions busy={busy} cancel={cancel} label={initial?'Сохранить изменения':'Опубликовать блок'}/>
  </form>
}
