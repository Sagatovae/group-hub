import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'

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
export function NotificationSettings() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState<NotificationPermission | null>(() => supported() ? Notification.permission : null)
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone
  const canSubscribe = supported() && !!endpoint && (!ios || standalone)
  useEffect(() => {
    if (!supported()) return
    let active = true
    navigator.serviceWorker.ready.then(registration => registration.pushManager.getSubscription()).then(subscription => {
      if (active) setSubscribed(!!subscription)
    }).catch(() => {})
    return () => { active = false }
  }, [])
  const enable = async () => {
    setError(''); setBusy(true)
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
  return <>
    <button className={`icon-button notification-settings ${subscribed ? 'selected' : ''}`} aria-label="Настроить уведомления" title="Уведомления" onClick={() => { setError(''); dialog.current?.showModal() }}><Bell size={19}/>{subscribed && <span className="notification-enabled"/>}</button>
    <dialog ref={dialog} className="install-dialog" aria-labelledby="notifications-title" onCancel={event => { if (busy) event.preventDefault() }}>
      <div className="dialog-heading"><h2 id="notifications-title">Уведомления</h2><button className="icon-button" disabled={busy} onClick={() => dialog.current?.close()} aria-label="Закрыть окно"><X size={20}/></button></div>
      <p>Получайте уведомления о новых объявлениях и материалах по всем предметам, даже когда приложение закрыто.</p>
      {ios && !standalone ? <p className="install-note">На iPhone сначала добавьте сайт на экран «Домой» через меню «Поделиться» в Safari. Затем откройте приложение с главного экрана и включите уведомления. Нужна iOS 16.4 или новее.</p> : !supported() ? <p className="install-note">Этот браузер не поддерживает push-уведомления. Попробуйте актуальную версию браузера.</p> : !endpoint ? <p className="install-note">Уведомления доступны в опубликованном приложении с подключённой базой.</p> : <p className="install-note" role="status">{subscribed ? 'Уведомления на этом устройстве включены.' : permission === 'denied' ? 'Уведомления заблокированы. Разрешите их в настройках браузера или приложения.' : 'Подписка действует только для этого устройства. Её можно отключить в любой момент.'}</p>}
      {error && <p className="error-box" role="alert">{error}</p>}
      {(canSubscribe || subscribed) && <button className="button primary" disabled={busy} onClick={() => void (subscribed ? disable() : enable())}>{busy ? 'Сохраняем…' : subscribed ? 'Отключить уведомления' : 'Включить уведомления'}</button>}
    </dialog>
  </>
}
