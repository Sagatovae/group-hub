import { useEffect, useRef, type ReactNode } from 'react'

export function MaterialFrame({ id, unread, active, pinned, onRead, children }: {
  id: string; unread: boolean; active: boolean; pinned: boolean; onRead: (ids: string[]) => void; children: ReactNode
}) {
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!unread || !active || !card.current || !('IntersectionObserver' in window)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let visible = false
    const clear = () => { clearTimeout(timer); timer = undefined }
    const schedule = () => {
      clear()
      if (visible && document.visibilityState === 'visible') timer = setTimeout(() => onRead([id]), 1200)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRect.height >= Math.min(entry.boundingClientRect.height * .4, 160)
      schedule()
    }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) })
    observer.observe(card.current)
    document.addEventListener('visibilitychange', schedule)
    return () => { clear(); observer.disconnect(); document.removeEventListener('visibilitychange', schedule) }
  }, [id, unread, active, onRead])
  return <article ref={card} id={`material-${id}`} className={`material-card ${pinned ? 'pinned' : ''} ${unread ? 'unread-material' : ''}`}>{children}</article>
}
