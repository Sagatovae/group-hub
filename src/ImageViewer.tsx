import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Share2, X } from 'lucide-react'
import type { Attachment } from './lib/types'
import { localFileUrl } from './lib/storage'
import { safeUrl } from './lib/utils'
import { useOverlayBack } from './lib/overlay'

export function ImageViewer({ images, initialIndex, close }: { images: Attachment[]; initialIndex: number; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(initialIndex)
  const [source, setSource] = useState<{ id: string; url: string | null } | null>(null)
  const [shareFile, setShareFile] = useState<{ id: string; file: File } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const swiped = useRef(false)
  const fingers = useRef(new Set<number>())
  const attachment = images[index]
  const url = source?.id === attachment.id ? source.url : null
  useOverlayBack(true, close)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!dialog.current?.open) dialog.current?.showModal()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  useEffect(() => {
    let active = true, objectUrl: string | null = null
    setLoaded(false); setError('')
    if (attachment.url.startsWith('local-file:')) {
      localFileUrl(attachment.url.slice(11)).then(value => { objectUrl = value; if (active) setSource({ id: attachment.id, url: value }); else if (value) URL.revokeObjectURL(value) }).catch(() => { if (active) setError('Изображение недоступно.') })
    } else setSource({ id: attachment.id, url: safeUrl(attachment.url) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [attachment.id, attachment.url])
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    fetch(url,{signal:controller.signal}).then(async response=>{
      if (!response.ok) return
      const blob=await response.blob()
      if (!controller.signal.aborted) setShareFile({id:attachment.id,file:new File([blob],attachment.name,{type:blob.type || attachment.mime_type || 'image/jpeg'})})
    }).catch(()=>{})
    return ()=>controller.abort()
  },[url,attachment.id,attachment.name,attachment.mime_type])
  const move = (direction: number) => { if (!busy) setIndex(value => Math.max(0, Math.min(images.length - 1, value + direction))) }
  const file = async () => {
    if (!url) throw new Error('Изображение недоступно.')
    const response = await fetch(url)
    if (!response.ok) throw new Error('Не удалось загрузить изображение.')
    return new File([await response.blob()], attachment.name, { type: response.headers.get('content-type') || attachment.mime_type || 'image/jpeg' })
  }
  const act = async (action: 'download' | 'share') => {
    setBusy(true); setError('')
    try {
      // Keep the native share call inside the tap gesture on mobile browsers.
      const prepared = shareFile?.id === attachment.id ? shareFile.file : null
      if (action === 'share' && prepared && navigator.canShare?.({files:[prepared]})) {
        await navigator.share({files:[prepared],title:attachment.name})
      } else if (action === 'share' && navigator.share && !attachment.url.startsWith('local-file:')) {
        await navigator.share({ title: attachment.name, url: url! })
      } else {
        const image = await file()
        if (action === 'share' && navigator.canShare?.({ files: [image] })) await navigator.share({ files: [image], title: attachment.name })
        else if (action === 'share') {
          if (attachment.url.startsWith('local-file:')) throw new Error('Браузер не поддерживает отправку файла. Скачайте фотографию и отправьте её вручную.')
          await navigator.clipboard.writeText(url!); setError('Ссылка на фотографию скопирована.')
        }
        else {
          const blobUrl = URL.createObjectURL(image), link = document.createElement('a')
          link.href = blobUrl; link.download = attachment.name; document.body.append(link); link.click(); link.remove()
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
        }
      }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : 'Не удалось выполнить действие.')
    } finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="image-viewer" aria-label={`Просмотр фотографий: ${index + 1} из ${images.length}`} onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }} onClose={close} onKeyDown={event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
    event.stopPropagation()
  }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="viewer-toolbar"><div className="viewer-caption"><strong>{attachment.name}</strong><span aria-live="polite">Фото {index + 1} из {images.length}</span></div><div className="viewer-actions"><button className="viewer-button" disabled={busy || !url} onClick={() => void act('download')} aria-label="Скачать фотографию"><Download size={21}/></button><button className="viewer-button" disabled={busy || !url} onClick={() => void act('share')} aria-label="Поделиться фотографией"><Share2 size={21}/></button><button className="viewer-button viewer-close" onClick={close} aria-label="Закрыть просмотр"><X size={25}/></button></div></div>
    <div className="viewer-stage" onClickCapture={event=>{if(swiped.current){event.preventDefault();event.stopPropagation();swiped.current=false}}} onClick={event => { if (event.target === event.currentTarget) close() }} onPointerDown={event => {
      swiped.current = false
      fingers.current.add(event.pointerId)
      start.current = fingers.current.size === 1 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null
    }} onPointerUp={event => {
      const from = start.current
      fingers.current.delete(event.pointerId); start.current = null
      if (from && from.id === event.pointerId && Math.abs(event.clientX - from.x) > 65 && Math.abs(event.clientY - from.y) < 65) { swiped.current=true; move(event.clientX < from.x ? 1 : -1) }
    }} onPointerCancel={event => { fingers.current.delete(event.pointerId); start.current = null }}>
      {url && <img key={attachment.id} className={loaded ? 'loaded' : ''} src={url} alt={attachment.name} draggable={false} onLoad={() => setLoaded(true)} onError={() => { setError('Не удалось открыть фотографию.'); setLoaded(true) }}/>} 
      {!loaded && !error && <span className="viewer-loading" role="status">Загружаем фотографию…</span>}
    </div>
    {images.length > 1 && <><button className="viewer-button viewer-prev" onClick={() => move(-1)} disabled={index === 0 || busy} aria-label="Предыдущая фотография"><ChevronLeft size={27}/></button><button className="viewer-button viewer-next" onClick={() => move(1)} disabled={index === images.length - 1 || busy} aria-label="Следующая фотография"><ChevronRight size={27}/></button><div className="viewer-pager">{index + 1} / {images.length}<span>Листайте свайпом или стрелками</span></div></>}
    {error && <div className="viewer-message" role="status">{error}</div>}
  </dialog>
}
