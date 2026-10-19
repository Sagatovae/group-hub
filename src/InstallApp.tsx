import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(false)
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)')
    const sync = () => setInstalled(media.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone)
    const available = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt) }
    const complete = () => { setInstalled(true); setPrompt(null); dialog.current?.close() }
    sync()
    media.addEventListener('change', sync)
    window.addEventListener('beforeinstallprompt', available)
    window.addEventListener('appinstalled', complete)
    return () => {
      media.removeEventListener('change', sync)
      window.removeEventListener('beforeinstallprompt', available)
      window.removeEventListener('appinstalled', complete)
    }
  }, [])

  const install = async () => {
    if (!prompt) { dialog.current?.showModal(); return }
    setBusy(true)
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
    } catch { dialog.current?.showModal() }
    finally { setPrompt(null); setBusy(false) }
  }

  if (installed) return null
  return <>
    <button className="button outline install-app" onClick={() => void install()} disabled={busy}><Download size={16}/><span>Установить</span></button>
    <dialog ref={dialog} className="install-dialog" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }} aria-labelledby="install-title">
      <div className="dialog-heading"><h2 id="install-title">Приложение ИДБ-26-09</h2><button className="icon-button" onClick={() => dialog.current?.close()} aria-label="Закрыть окно"><X size={20}/></button></div>
      <p>Добавьте приложение на главный экран — оно будет открываться в отдельном окне.</p>
      {ios ? <ol><li>Откройте сайт в Safari.</li><li>Нажмите «Поделиться» и выберите «На экран Домой» (возможно, в меню «Ещё»).</li><li>Если доступно, включите «Открывать как веб-приложение», затем нажмите «Добавить».</li></ol> : <ol><li>Откройте меню браузера.</li><li>Выберите «Установить приложение» или «Добавить на главный экран». На Mac в Safari — «Файл» → «Добавить в Dock».</li><li>Подтвердите установку. Если пункта нет, откройте сайт в Chrome или Edge.</li></ol>}
      <p className="install-note">Для загрузки новых материалов и сохранения изменений нужен интернет. Ранее загруженная копия доступна без сети; файлы и картинки могут потребовать подключения.</p>
      <button className="button primary" onClick={() => dialog.current?.close()}>Понятно</button>
    </dialog>
  </>
}
