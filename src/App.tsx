import { NotificationSettings } from './NotificationSettings'
import { InstallApp } from './InstallApp'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowDown, ArrowUp, ArrowUpDown, ArrowRight, Bell, BookOpen, CalendarDays, Check, ChevronRight, Clock3, File, FolderOpen, Link as LinkIcon, LoaderCircle, Menu, MoreHorizontal, Pencil, Pin, Plus, RefreshCw, Search, Trash2, Upload, WifiOff, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { addSubject, deleteMaterial, localFileUrl, isLocal, persistLocal, readData, removeFiles, saveMaterial, saveSection, saveSubject, saveSubjectOrder, setMaterialPinned, uploadFile } from './lib/storage'
import { AUTHORS, type Author, type Attachment, type HubData, type Material, type Page, type Section, type Subject } from './lib/types'
import { formatDate, formatSize, matchesQuery, safeUrl, sortMaterials, moveSubject, normalizeData, isImageAttachment } from './lib/utils'

type Modal = { kind: 'material'; material?: Material } | { kind: 'subject'; subject?: Subject } | { kind: 'section'; section?: Section } | { kind: 'delete'; material: Material } | null
const empty: HubData = { subjects: [], sections: [], materials: [] }
const navItems: { page: Page; name: string; icon: typeof Bell }[] = [
  { page: 'recent', name: 'Последнее', icon: Clock3 },
  { page: 'home', name: 'Объявления', icon: Bell }, { page: 'subjects', name: 'Предметы', icon: BookOpen },
]
function readRoute(): { page: Page; subjectId: string | null; sectionId: string } {
  const route = location.hash.slice(1).split('/')
  if (route[0] === 'subject' && route[1]) return { page: 'subject', subjectId: route[1], sectionId: route[2] || 'all' }
  return { page: ['home', 'subjects', 'recent'].includes(route[0]) ? route[0] as Page : 'home', subjectId: null, sectionId: 'all' }
}

function AttachmentLink({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const image = isImageAttachment(attachment) && !imageFailed
  useEffect(() => {
    let active = true, objectUrl: string | null = null
    setImageFailed(false)
    if (attachment.url.startsWith('local-file:')) {
      localFileUrl(attachment.url.slice(11)).then(value => { objectUrl = value; if (active) setUrl(value); else if (value) URL.revokeObjectURL(value) }).catch(() => setUrl(null))
    } else setUrl(safeUrl(attachment.url))
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [attachment.url])
  return <a className={`attachment ${image ? 'image-attachment' : ''} ${!url ? 'disabled' : ''}`} href={url || undefined} target="_blank" rel="noopener noreferrer" download={attachment.url.startsWith('local-file:') ? attachment.name : undefined} aria-disabled={!url}>
    {image && url && <img src={url} alt={attachment.name} loading="lazy" decoding="async" onError={() => setImageFailed(true)} />}
    <span className="attachment-caption"><span className="file-icon"><File size={19} /></span><span><strong>{attachment.name}</strong><small>{url ? formatSize(attachment.size) : 'Файл недоступен'}</small></span><ArrowDownToLine size={17} /></span>
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
  const [sectionId, setSectionId] = useState(() => readRoute().sectionId)
  const [query, setQuery] = useState('')
  const [semester, setSemester] = useState('all')
  const [loading, setLoading] = useState(true)
  const [cached, setCached] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [orderBusy, setOrderBusy] = useState(false)
  const [pinningId, setPinningId] = useState<string | null>(null)
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  const { page, subjectId } = route
  const subject = data.subjects.find(s => s.id === subjectId)
  const sections = data.sections.filter(s => s.subject_id === subjectId).sort((a,b) => a.position-b.position)
  const editable = !cached && !loading
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
    const handler = () => { const next = readRoute(); setRoute(next); setSectionId(next.sectionId); setQuery(''); setMenuOpen(false) }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 5000); return () => clearTimeout(id) }, [toast])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  const navigate = (next: Page, id?: string, nextSection?: string) => { location.hash = next === 'subject' ? `subject/${id}${nextSection ? `/${nextSection}` : ''}` : next; setMenuOpen(false) }
  const changeData = async (next: HubData) => { const normalized = normalizeData(next); if (isLocal) await persistLocal(normalized); setData(normalized) }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); setModal(null) } catch (e) { setError((e as Error).message || 'Не удалось выполнить действие.') } finally { setBusy(false) }
  }
  const openModal = (next: Modal) => { setError(''); setModal(next) }
  const closeModal = () => { if (!busy) { setModal(null); setError('') } }
  const reorder = async (id: string, direction: -1 | 1, visibleIds?: string[]) => {
    if (orderBusy || pinningId || busy) return
    const subjects = moveSubject(data.subjects, id, direction, visibleIds)
    if (subjects === data.subjects) return
    setOrderBusy(true)
    try { await saveSubjectOrder(subjects); await changeData({...data,subjects}); setToast('Порядок предметов сохранён') }
    catch (e) { setError((e as Error).message) }
    finally { setOrderBusy(false) }
  }
  const togglePin = async (material: Material) => {
    if (pinningId || orderBusy || busy) return
    setPinningId(material.id)
    try {
      const updated = await setMaterialPinned(material.id,!material.pinned) || {...material,pinned:!material.pinned}
      await changeData({...data,materials:data.materials.map(m=>m.id===material.id?updated:m)})
      setToast(updated.pinned?'Объявление закреплено':'Объявление откреплено')
    } catch (e) { setError((e as Error).message) }
    finally { setPinningId(null) }
  }
  const subjectName = (id: string | null) => data.subjects.find(s => s.id === id)?.name || 'Для всей группы'
  const sectionName = (id: string | null) => data.sections.find(s => s.id === id)?.name || 'Объявление'
  const filteredMaterials = data.materials.filter(m => {
    if (page === 'home' && m.subject_id !== null) return false
    if (page === 'subject' && (m.subject_id !== subjectId || sectionId !== 'all' && m.section_id !== sectionId)) return false
    const metadata = page === 'recent' ? `${subjectName(m.subject_id)} ${sectionName(m.section_id)}` : ''
    return matchesQuery({...m, body:`${m.body} ${metadata}`}, query)
  })
  const visible = page === 'recent'
    ? filteredMaterials.sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at) || b.id.localeCompare(a.id))
    : sortMaterials(filteredMaterials)
  const filteredSubjects = data.subjects.filter(s => (semester === 'all' || s.semester === Number(semester)) && `${s.name} ${s.teacher}`.toLowerCase().includes(query.toLowerCase().trim()))

  const materialCard = (m: Material) => <article className={`material-card ${m.pinned ? 'pinned' : ''}`} key={m.id}>
    <div className="card-topline"><span className={`badge ${m.pinned ? 'important' : ''}`}>{m.pinned ? <Pin size={12} /> : <BookOpen size={12} />}{m.pinned ? 'Закреплено' : sectionName(m.section_id)}</span><span className="card-date">{formatDate(m.created_at)}</span></div>
    <h3>{m.title}</h3><p className="material-body">{m.body}</p>
    {!!m.attachments.length && <div className="attachments">{m.attachments.map(a => <AttachmentLink attachment={a} key={a.id} />)}</div>}
    <div className="card-footer"><span className={m.author ? 'author-label' : ''}>{m.author || 'Материал группы'}</span>{(m.subject_id || page === 'recent') && <button className="subject-link" onClick={() => m.subject_id ? navigate('subject', m.subject_id, m.section_id || undefined) : navigate('home')}>{m.subject_id ? `${subjectName(m.subject_id)}${page === 'recent' ? ` · ${sectionName(m.section_id)}` : ''}` : 'Объявления группы'}<ChevronRight size={13}/></button>}{m.deadline && <span className="deadline-badge"><CalendarDays size={13} />До {formatDate(m.deadline)}</span>}{editable && <div className="card-actions">{m.subject_id === null && <button className={`icon-button ${m.pinned?'selected':''}`} disabled={!!pinningId || orderBusy} onClick={() => void togglePin(m)} aria-pressed={m.pinned} aria-label={`${m.pinned?'Открепить':'Закрепить'}: ${m.title}`}><Pin size={15}/></button>}<button className="icon-button" onClick={() => openModal({ kind: 'material', material: m })} aria-label={`Редактировать: ${m.title}`}><Pencil size={15}/></button><button className="icon-button danger-text" onClick={() => openModal({ kind: 'delete', material: m })} aria-label={`Удалить: ${m.title}`}><Trash2 size={15}/></button></div>}</div>
  </article>

  return <div className="app-shell">
    {menuOpen && <button className="sidebar-scrim" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
    <aside id="subject-navigation" aria-label="Навигация по предметам" className={`sidebar ${menuOpen ? 'open' : ''}`}><button className="icon-button mobile-sheet-close" onClick={() => setMenuOpen(false)} aria-label="Закрыть список предметов"><X size={20}/></button>
      <a className="brand group-brand" href="#home">ИДБ-2<span className="brand-accent">6</span>-0<span className="brand-accent">9</span></a>

      <p className="nav-caption">ПРОСТРАНСТВО</p><nav aria-label="Главная навигация">{navItems.map(({ page: p, name, icon: Icon }) => <button key={p} className={`nav-item ${page === p ? 'active' : ''}`} onClick={() => navigate(p)}><Icon size={19}/><span>{name}</span></button>)}</nav>
      <div className="subject-nav-heading"><p className="nav-caption">ПРЕДМЕТЫ</p>{editable && <div className="sidebar-subject-actions">{data.subjects.length>1 && <button className={`icon-button ${reordering?'selected':''}`} onClick={()=>setReordering(!reordering)} aria-label="Изменить порядок предметов" aria-pressed={reordering}><ArrowUpDown size={15}/></button>}<button className="icon-button" onClick={()=>openModal({kind:'subject'})} aria-label="Добавить предмет"><Plus size={15}/></button></div>}</div>
      <nav className="subjects-nav" aria-label="Предметы">{data.subjects.map((s,i) => <div className="subject-nav-row" key={s.id}><button className={`nav-item small ${subjectId===s.id?'active':''}`} onClick={()=>navigate('subject',s.id)}><span className={`subject-dot ${s.color}`}/><span>{s.name}</span></button>{editable && reordering && <OrderControls subject={s} disabled={orderBusy || !!pinningId} first={i===0} last={i===data.subjects.length-1} move={direction=>void reorder(s.id,direction)}/>}</div>)}{!data.subjects.length && <span className="sidebar-empty">Предметов пока нет</span>}</nav>

    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>Пространство группы</span><ChevronRight size={14}/><strong>{page === 'subject' ? subject?.name || 'Предмет' : navItems.find(n => n.page === page)?.name}</strong></div><div className="header-controls"><NotificationSettings/><InstallApp/><span className={`mode-pill ${isLocal ? '' : 'live'}`}><span/>{isLocal ? 'Локально' : 'Онлайн'}</span></div></header>
      <main>
        {isLocal && <div className="demo-banner"><span><span className="tiny-dot"/>Материалы сохраняются в этом браузере. Для общего доступа подключите базу данных.</span></div>}
        {cached && <div className="notice"><WifiOff size={18}/>Показана сохранённая копия материалов. Редактирование временно недоступно.<button className="text-button" onClick={() => void load()}>Обновить</button></div>}
        {needRefresh && <div className="notice">Доступна новая версия сайта.<button className="text-button" onClick={() => void updateServiceWorker(true)}>Обновить приложение</button></div>}
        {error && !modal && <div className="error-box" role="alert">{error}<button className="text-button" onClick={() => void load()}>Повторить</button></div>}
        {page !== 'home' && <div className="page-heading"><div><div className="eyebrow">{page === 'subject' ? `ПРЕДМЕТ · ${subject?.semester || 1} СЕМЕСТР` : 'УЧЕБНОЕ ПРОСТРАНСТВО'}</div><h1>{page === 'subject' ? subject?.name || 'Предмет не найден' : page === 'recent' ? 'Последние публикации' : 'Наши предметы'}</h1><p>{page === 'subject' ? subject?.teacher || 'Выберите предмет в меню' : page === 'recent' ? 'Объявления и материалы по всем предметам — от новых к старым.' : 'Лекции, задания и полезные материалы — у каждого предмета своё место.'}</p></div>{editable && <div className="page-actions">{page==='subject' && subject && <button className="button outline" onClick={()=>openModal({kind:'subject',subject})}><Pencil size={16}/>Редактировать предмет</button>}<button className="button primary" onClick={() => openModal(page === 'subjects' ? {kind:'subject'} : {kind:'material'})}><Plus size={18}/>{page === 'subjects' ? 'Добавить предмет' : 'Добавить блок'}</button></div>}</div>}
        {loading ? <div className="loading"><LoaderCircle className="spin" size={24}/>Загружаем пространство…</div> : <>

        {page === 'subjects' ? <>
          <div className="content-toolbar"><label className="search-input"><Search size={17}/><input aria-label="Поиск предметов" placeholder="Найти предмет…" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Семестр" value={semester} onChange={e=>setSemester(e.target.value)}><option value="all">Все семестры</option>{[...new Set(data.subjects.map(s=>s.semester))].sort((a,b)=>a-b).map(s=><option key={s} value={s}>{s} семестр</option>)}</select>{editable && data.subjects.length>1 && <button className={`button ${reordering?'subtle':'outline'}`} onClick={()=>setReordering(!reordering)} aria-pressed={reordering}><ArrowUpDown size={16}/>{reordering?'Готово':'Порядок'}</button>}</div>
          <div className="subject-grid">{filteredSubjects.map((s,i)=><article className="subject-card" key={s.id}>
            <button className="subject-card-main" onClick={()=>navigate('subject',s.id)}><div className={`subject-cover ${s.color}`}><span className="subject-symbol">{['∑','</>','φ','Aa'][i%4]}</span><span className="semester-pill">{s.semester} семестр</span></div><div className="subject-card-content"><h3>{s.name}</h3><p>{s.teacher || 'Преподаватель не указан'}</p><div><span>{data.materials.filter(m=>m.subject_id===s.id).length} материалов</span><ArrowRight size={18}/></div></div></button>
            {editable && <div className="subject-card-actions"><button className="button outline" onClick={()=>openModal({kind:'subject',subject:s})} aria-label={`Редактировать предмет: ${s.name}`}><Pencil size={14}/>Редактировать</button>{reordering && <OrderControls subject={s} disabled={orderBusy || !!pinningId} first={i===0} last={i===filteredSubjects.length-1} move={direction=>void reorder(s.id,direction,filteredSubjects.map(x=>x.id))}/>}</div>}
          </article>)}</div>
          {!filteredSubjects.length && <div className="empty-state"><BookOpen size={32}/><h3>Предметов пока нет</h3><p>{query ? 'Попробуйте изменить запрос.' : 'Добавьте первый предмет, чтобы разместить учебные материалы.'}</p></div>}
        </> : <div><section className={`feed ${page === 'recent' ? 'recent-feed' : ''}`}>
          {page === 'subject' && <div className="section-tabs" role="tablist" aria-label="Разделы предмета"><button role="tab" aria-selected={sectionId==='all'} className={sectionId==='all'?'active':''} onClick={()=>setSectionId('all')}>Все материалы</button>{sections.map(s=><button role="tab" aria-selected={sectionId===s.id} className={sectionId===s.id?'active':''} key={s.id} onClick={()=>setSectionId(s.id)}>{s.name}</button>)}{editable && subject && <button aria-label="Добавить раздел" onClick={()=>openModal({kind:'section'})}><Plus size={17}/></button>}</div>}
          <div className="feed-heading"><div><h2>{page === 'home' ? 'Объявления группы' : page === 'recent' ? 'Лента группы' : page === 'subject' ? sections.find(s=>s.id===sectionId)?.name || 'Все материалы' : 'Все материалы'}</h2><span className="count-chip">{visible.length}</span>{editable && page==='subject' && sectionId!=='all' && <button className="icon-button" aria-label="Переименовать раздел" onClick={()=>openModal({kind:'section',section:sections.find(s=>s.id===sectionId)})}><Pencil size={15}/></button>}</div>{page === 'home' && editable ? <button className="button primary" onClick={() => openModal({kind:'material'})}><Plus size={18}/>Добавить блок</button> : <span className="sort-label">Сначала новые{page === 'recent' ? <button className="icon-button" onClick={() => void load()} aria-label="Обновить ленту" title="Обновить ленту"><RefreshCw size={17}/></button> : <MoreHorizontal size={18}/>}</span>}</div>
          <label className="search-input feed-search"><Search size={17}/><input aria-label="Поиск материалов" placeholder={page === 'recent' ? 'Поиск по материалам, предметам и файлам…' : 'Поиск по материалам и файлам…'} value={query} onChange={e=>setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="Очистить поиск" onClick={()=>setQuery('')}><X size={15}/></button>}</label>
          <div className="materials-list">{visible.map(materialCard)}</div>{!visible.length && <div className="empty-state"><FolderOpen size={34}/><h3>{query ? 'Ничего не нашлось' : 'Здесь пока пусто'}</h3><p>{query ? 'Попробуйте другой запрос.' : 'Добавьте первый блок с объявлением, файлами или ссылками.'}</p>{editable && <button className="button outline" onClick={()=>openModal({kind:'material'})}><Plus size={16}/>Добавить первый блок</button>}</div>}
        </section></div>}
        </>}
        <footer className="page-footer"><span>ИДБ-2<span className="brand-accent">6</span>-0<span className="brand-accent">9</span></span><span>Сделано для своих <span className="footer-spark">✳</span></span></footer>
      </main>
    </div>
    <nav className="mobile-nav-island" aria-label="Мобильная навигация">
      <button className={page === 'recent' && !menuOpen ? 'active' : ''} aria-current={page === 'recent' ? 'page' : undefined} onClick={() => navigate('recent')}><Clock3 size={21}/><span>Последнее</span></button>
      <button className={page === 'home' && !menuOpen ? 'active' : ''} aria-current={page === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><Bell size={21}/><span>Объявления</span></button>
      <button className={(page === 'subjects' || page === 'subject') && !menuOpen ? 'active' : ''} aria-current={page === 'subjects' || page === 'subject' ? 'page' : undefined} onClick={() => navigate('subjects')}><BookOpen size={21}/><span>Предметы</span></button>
      <button className={menuOpen ? 'active' : ''} aria-expanded={menuOpen} aria-controls="subject-navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={21}/><span>Список</span></button>
    </nav>
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
    {modal && <Dialog title={modal.kind==='material' ? modal.material ? 'Редактировать блок' : 'Новый блок' : modal.kind==='subject' ? modal.subject ? 'Редактировать предмет' : 'Новый предмет' : modal.kind==='section' ? modal.section ? 'Название раздела' : 'Новый раздел' : 'Удалить блок?'} close={closeModal}>
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
        try { await removeFiles(removed); setToast(isLocal?'Блок сохранён в этом браузере':'Блок опубликован') } catch(e) { setToast((e as Error).message) }
      })}/>}
      {modal.kind==='subject' && <SubjectForm initial={modal.subject} nextPosition={Math.max(-1,...data.subjects.map(s=>s.position))+1} busy={busy} cancel={closeModal} submit={s=>void run(async()=>{
        if (modal.subject) {
          const updated = await saveSubject(s)
          await changeData({...data,subjects:data.subjects.map(item=>item.id===s.id?updated:item)})
          setToast('Предмет обновлён')
        } else {
          const newSections = ['Лекции','Семинары','Домашние задания','Лабораторные','Прочее'].map((name,position)=>({id:crypto.randomUUID(),subject_id:s.id,name,position}))
          const created = await addSubject(s,newSections)
          await changeData({...data,subjects:[...data.subjects,created],sections:[...data.sections,...newSections]})
          navigate('subject',s.id); setToast('Предмет добавлен')
        }
      })}/>}
      {modal.kind==='section' && <form onSubmit={e=>{e.preventDefault(); const form=new FormData(e.currentTarget); const name=String(form.get('name')).trim(); if(!name) return; void run(async()=>{ if(!subjectId) return; const s: Section={id:modal.section?.id || crypto.randomUUID(),subject_id:subjectId,name,position:modal.section?.position ?? sections.length}; await saveSection(s); await changeData({...data,sections:[...data.sections.filter(x=>x.id!==s.id),s]}); setToast('Раздел сохранён') }) }}><label className="field">Название<input name="name" required maxLength={60} defaultValue={modal.section?.name} placeholder="Например, подготовка к экзамену"/></label><FormActions busy={busy} cancel={closeModal}/></form>}

      {modal.kind==='delete' && <><p className="form-note">Блок «{modal.material.title}» и загруженные в него файлы будут удалены. Внешние файлы по ссылкам останутся в облаке.</p><div className="form-actions"><button className="button outline" disabled={busy} onClick={closeModal}>Отмена</button><button className="button danger" disabled={busy} onClick={()=>void run(async()=>{await deleteMaterial(modal.material.id); await changeData({...data,materials:data.materials.filter(m=>m.id!==modal.material.id)}); try{await removeFiles(modal.material.attachments);setToast('Блок удалён')}catch{setToast('Блок удалён, но файлы нужно убрать из хранилища вручную.')} })}>{busy?<LoaderCircle className="spin" size={17}/>:<Trash2 size={17}/>}Удалить блок</button></div></>}

    </Dialog>}
  </div>
}

function FormActions({busy,cancel,label='Сохранить'}:{busy:boolean;cancel:()=>void;label?:string}) { return <div className="form-actions"><button type="button" className="button outline" disabled={busy} onClick={cancel}>Отмена</button><button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}{busy?'Сохраняем…':label}</button></div> }

function OrderControls({subject,disabled,first,last,move}:{subject:Subject;disabled:boolean;first:boolean;last:boolean;move:(direction:-1|1)=>void}) {
  return <div className="order-controls"><button className="icon-button" disabled={disabled||first} aria-label={`Выше: ${subject.name}`} onClick={()=>move(-1)}><ArrowUp size={15}/></button><button className="icon-button" disabled={disabled||last} aria-label={`Ниже: ${subject.name}`} onClick={()=>move(1)}><ArrowDown size={15}/></button></div>
}

function SubjectForm({initial,nextPosition,busy,cancel,submit}:{initial?:Subject;nextPosition:number;busy:boolean;cancel:()=>void;submit:(s:Subject)=>void}) {
  return <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const name=String(f.get('name')).trim();if(!name)return;submit({id:initial?.id||crypto.randomUUID(),name,teacher:String(f.get('teacher')).trim(),semester:Number(f.get('semester')),color:String(f.get('color')),position:initial?.position??nextPosition})}}>
    <label className="field">Название предмета<input name="name" placeholder="Например, высшая математика" required maxLength={120} defaultValue={initial?.name}/></label><label className="field">Преподаватель<input name="teacher" maxLength={120} placeholder="Необязательно" defaultValue={initial?.teacher}/></label>
    <div className="form-row"><label className="field">Семестр<input name="semester" type="number" min="1" max="12" defaultValue={initial?.semester||1} required/></label><label className="field">Цвет<select name="color" defaultValue={initial?.color||'sage'}><option value="sage">Зелёный</option><option value="blue">Голубой</option><option value="peach">Персиковый</option><option value="lavender">Сиреневый</option></select></label></div>
    {!initial && <p className="form-note">Разделы «Лекции», «Семинары», «Домашние задания», «Лабораторные» и «Прочее» появятся автоматически.</p>}<FormActions busy={busy} cancel={cancel} label={initial?'Сохранить изменения':'Создать предмет'}/>
  </form>
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
  const onSubmit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault(); const f=new FormData(e.currentTarget);const title=String(f.get('title')).trim(); if(!title)return;if(linkUrl.trim()||linkName.trim()){setValidation('Нажмите «Добавить ссылку» или очистите поля ссылки перед сохранением.');return}submit({id:initial?.id||crypto.randomUUID(),subject_id:selectedSubject||null,section_id:selectedSubject?selectedSection:null,title,body:String(f.get('body')).trim(),deadline:initial?.deadline??null,author:(String(f.get('author'))||null) as Author|null,pinned:f.get('pinned')==='on',created_at:initial?.created_at||new Date().toISOString(),attachments},files)}
  return <form onSubmit={onSubmit}>
    {validation&&<div className="error-box" role="alert">{validation}</div>}
    <div className="form-row"><label className="field">Где опубликовать<select value={selectedSubject} onChange={e=>{setSelectedSubject(e.target.value);setSelectedSection('')}}><option value="">Объявления группы</option>{data.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{selectedSubject&&<label className="field">Раздел<select value={selectedSection} required onChange={e=>setSelectedSection(e.target.value)}><option value="" disabled>Выберите раздел</option>{availableSections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}</div>
    <label className="field">Заголовок<input name="title" required maxLength={180} defaultValue={initial?.title} placeholder="Например, лабораторная № 2"/></label><label className="field">Описание<textarea name="body" rows={5} maxLength={20000} defaultValue={initial?.body} placeholder="Задание, пояснения и всё, что важно знать группе"/></label>
    <div className="form-row"><label className="field">Автор<select name="author" defaultValue={initial?.author||''}><option value="">Без подписи</option>{AUTHORS.map(author=><option key={author} value={author}>{author}</option>)}</select></label><label className="checkbox-field"><input name="pinned" type="checkbox" defaultChecked={initial?.pinned}/>Закрепить блок</label></div>
    <div className="form-divider"/><h3 className="form-subheading">Файлы и ссылки</h3><p className="form-note">Загружайте файлы и картинки или добавляйте ссылки на облако.</p>
    <label className="upload-zone"><Upload size={20}/><span>Выбрать файлы и картинки</span><input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip,.png,.jpg,.jpeg,.webp,.gif,.avif" onChange={e=>{const picked=Array.from(e.target.files||[]);setFiles([...files,...picked]);setValidation('');e.target.value=''}} disabled={busy}/></label>
    {files.map((f,i)=><div className="attachment-row" key={`${f.name}-${i}`}><File size={16}/><span>{f.name}<small>{formatSize(f.size)}</small></span><button type="button" className="icon-button" aria-label={`Убрать файл ${f.name}`} onClick={()=>setFiles(files.filter((_,n)=>n!==i))}><X size={16}/></button></div>)}
    {attachments.map(a=><div className="attachment-row" key={a.id}><LinkIcon size={16}/><span>{a.name}</span><button type="button" className="icon-button" aria-label={`Убрать вложение ${a.name}`} onClick={()=>setAttachments(attachments.filter(x=>x.id!==a.id))}><X size={16}/></button></div>)}
    <div className="link-fields"><label className="field">Название ссылки<input value={linkName} onChange={e=>setLinkName(e.target.value)} placeholder="Например, шаблон отчёта" maxLength={180}/></label><label className="field">Ссылка<input value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="https://…"/></label><button className="button outline" type="button" onClick={addLink} disabled={busy}><LinkIcon size={16}/>Добавить ссылку</button></div><FormActions busy={busy} cancel={cancel} label={initial?'Сохранить изменения':'Опубликовать блок'}/>
  </form>
}
