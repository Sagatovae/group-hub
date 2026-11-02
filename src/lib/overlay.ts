import { useEffect, useRef } from 'react'

// PWA/Android Back dismisses a viewer instead of leaving the current page.
export function useOverlayBack(open: boolean, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  const active = useRef(false)
  const overlayToken = useRef<string | null>(null)
  useEffect(() => {
    if (!open) return
    active.current = true
    const token = overlayToken.current ||= crypto.randomUUID()
    if (history.state?.hubOverlay !== token) history.pushState({ ...history.state, hubOverlay: token }, '', location.href)
    const onPop = () => { if (history.state?.hubOverlay !== token) close.current() }
    window.addEventListener('popstate', onPop)
    return () => {
      active.current = false
      window.removeEventListener('popstate', onPop)
      // Strict Mode immediately replays effects; only unwind a real close.
      queueMicrotask(() => { if (!active.current && history.state?.hubOverlay === token) history.back() })
    }
  }, [open])
}
