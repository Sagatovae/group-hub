import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Bell, CheckCheck, FileText, X } from 'lucide-react'
import type { HubData, Material } from './lib/types'
import { formatDate } from './lib/utils'
import { deviceKey, isAppWindow } from './lib/reading'
import { LoadingDots } from './Loading'

const endpoint = import.meta.env.VITE_SUPABASE_URL ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-notifications` : ''
const supported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(decoded, char => char.charCodeAt(0))
}
async function save(action: 'subscribe' | 'unsubscribe', subscription: PushSubscription) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, subscription: subscription.toJSON() }) })
  if (!response.ok) throw new Error('Не удалось сохранить подписку. Проверьте интернет и повторите.')
}
const promptKey = `${deviceKey}notification-intro-v1`
function needsIntroduction() {
  if (!isAppWindow() || !supported() || !endpoint || Notification.permission === 'denied') return false
  try { return !localStorage.getItem(promptKey) } catch { return true }
}
function rememberIntroduction() { try { localStorage.setItem(promptKey, 'seen') } catch { /* Usable without browser storage. */ } }

export function NotificationSettings({ ready, data, read, onRead, onOpenMaterial, onOpenChange }: {
  ready: boolean; data: HubData; read: Set<string>; onRead: (ids: string[]) => void; onOpenMaterial: (material: Material) => void; onOpenChange: (open: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'intro' | 'inbox' | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [subscriptionChecked, setSubscriptionChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState<NotificationPermission | null>(() => supported() ? Notification.permission : null)
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = isAppWindow()
  const canSubscribe = supported() && !!endpoint && (!ios || standalone)
  useEffect(() => {
    if (ready && needsIntroduction() && (Notification.permission === 'default' || subscriptionChecked && !subscribed)) setMode('intro')
  }, [ready, subscriptionChecked, subscribed])
  useEffect(() => {
    onOpenChange(mode !== null)
    if (mode && !dialog.current?.open) dialog.current?.showModal()
    if (!mode) dialog.current?.close()
  }, [mode, onOpenChange])
  useEffect(() => {
    if (!supported()) return
    let active = true
    navigator.serviceWorker.ready.then(registration => registration.pushManager.getSubscription()).then(subscription => {
      if (active) {
        setSubscribed(!!subscription)
        if (subscription) rememberIntroduction()
        setSubscriptionChecked(true)
      }
    }).catch(() => {})
    return () => { active = false }
  }, [])
  const enable = async () => {
    setError(''); setBusy(true); rememberIntroduction()
    try {
      // Ask directly from the user's click, before network requests (required on iOS).
      const allowed = await Notification.requestPermission()
      setPermission(allowed)
      if (allowed !== 'granted') throw new Error(allowed === 'denied' ? 'Уведомления запрещены. Разрешите их в настройках браузера или приложения.' : 'Разрешение не выдано. Можно попробовать снова.')
      const config = await fetch(endpoint)
      if (!config.ok) throw new Error('Сервис уведомлений временно недоступен.')
      const { publicKey } = await config.json()
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      const created = !subscription
      subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(publicKey) })
      try { await save('subscribe', subscription) }
      catch (failure) { if (created) await subscription.unsubscribe().catch(() => {}); throw failure }
      setSubscribed(true)
      if (mode === 'intro') setMode(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось включить уведомления.') }
    finally { setBusy(false) }
  }
  const disable = async () => {
    setError(''); setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) { await save('unsubscribe', subscription); await subscription.unsubscribe() }
      setSubscribed(false)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось отключить уведомления.') }
    finally { setBusy(false) }
  }
  const latest = [...data.materials].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id)).slice(0, 40)
  const unread = data.materials.filter(material => !read.has(material.id)).length
  const close = () => {
    if (busy) return
    if (mode === 'intro') rememberIntroduction()
    setMode(null); setError('')
  }
  return <>
    <button className={`icon-button notification-settings ${subscribed ? 'selected' : ''}`} aria-label={`Уведомления${unread ? `, непрочитанных: ${unread}` : ''}`} title="Уведомления" onClick={() => { setError(''); setMode('inbox') }}><Bell size={19}/>{unread ? <span className="notification-count">{unread > 99 ? '99+' : unread}</span> : subscribed && <span className="notification-enabled"/>}</button>
    <dialog ref={dialog} className={`install-dialog notifications-dialog ${mode === 'intro' ? 'notification-intro' : ''}`} aria-labelledby="notifications-title" onClose={() => { setMode(null); setError('') }} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div className="dialog-heading"><h2 id="notifications-title">{mode === 'intro' ? 'Будьте в курсе' : 'Уведомления'}</h2><button className="icon-button" disabled={busy} onClick={close} aria-label="Закрыть окно"><X size={20}/></button></div>
      {mode === 'intro' ? <><div className="notification-intro-icon"><Bell size={34}/><span/></div><p>Разрешите уведомления, чтобы сразу узнавать о новых объявлениях, лекциях и заданиях.</p><p className="install-note">После нажатия «Включить» подтвердите разрешение в системном окне. Настройку можно изменить в любой момент.</p></> : <>
        <div className="notification-list-heading"><span>Последние публикации</span>{unread > 0 && <button className="text-button" onClick={() => onRead(data.materials.map(material => material.id))}><CheckCheck size={15}/>Прочитать все</button>}</div>
        <div className="notification-list">
          {latest.map(material => {
            const subject = data.subjects.find(item => item.id === material.subject_id)
            const section = data.sections.find(item => item.id === material.section_id)
            const isUnread = !read.has(material.id)
            return <button key={material.id} className={`notification-item ${isUnread ? 'is-unread' : ''}`} onClick={() => { close(); onOpenMaterial(material) }}>
              <span className="notification-item-icon">{subject ? <FileText size={18}/> : <Bell size={18}/>}</span>
              <span className="notification-item-copy"><small>{subject?.name || 'Объявления'}{section ? ` · ${section.name}` : ''}</small><strong>{material.title}</strong>{material.body && <span>{material.body}</span>}<small>{formatDate(material.created_at)}{material.attachments.length > 0 ? ` · Файлов: ${material.attachments.length}` : ''}</small></span>
              <span className="notification-item-end">{isUnread && <span className="unread-dot"/>}<ArrowUpRight size={15}/></span>
            </button>
          })}
          {!latest.length && <div className="notification-empty"><Bell size={28}/><p>Здесь появятся новые объявления и материалы.</p></div>}
        </div>
        <p className="install-note reading-note">Прочтение сохраняется на этом устройстве. Материал отмечается прочитанным при просмотре.</p>
      </>}
      <div className="push-preferences">
        {mode !== 'intro' && <h3>Push-уведомления</h3>}
        {ios && !standalone ? <p className="install-note">На iPhone сначала добавьте сайт на экран «Домой» через меню «Поделиться» в Safari. Затем откройте приложение с главного экрана и включите уведомления. Нужна iOS 16.4 или новее.</p> : !supported() ? <p className="install-note">Этот браузер не поддерживает push-уведомления.</p> : !endpoint ? <p className="install-note">Push-уведомления доступны при подключённой базе.</p> : <p className="install-note" role="status">{subscribed ? 'Уведомления на этом устройстве включены.' : permission === 'denied' ? 'Уведомления заблокированы. Разрешите их в настройках браузера или приложения.' : 'Новые публикации будут приходить, даже когда приложение закрыто.'}</p>}
        {error && <p className="error-box" role="alert">{error}</p>}
        <div className="notification-dialog-actions">
          {mode === 'intro' && <button className="button outline" disabled={busy} onClick={close}>Позже</button>}
          {(canSubscribe || subscribed) && <button className="button primary" aria-busy={busy} disabled={busy || permission === 'denied' && !subscribed} onClick={() => void (subscribed ? disable() : enable())}>{busy && <LoadingDots small/>}{busy ? 'Сохраняем…' : subscribed ? 'Отключить уведомления' : 'Включить уведомления'}</button>}
        </div>
      </div>
    </dialog>
  </>
}
