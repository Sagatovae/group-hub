import { useCallback, useEffect, useState } from 'react'

// Reading belongs to this device, independently of push permission or subscription.
export const deviceKey = `group-hub:${import.meta.env.VITE_SUPABASE_URL || 'local'}:`
const readKey = `${deviceKey}read-materials-v1`
function readIds(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(readKey) || '[]')
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  } catch { return new Set() }
}
export function useReading() {
  const [read, setRead] = useState(readIds)
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === readKey || event.key === null) setRead(readIds()) }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const markRead = useCallback((ids: string[]) => {
    setRead(previous => {
      const next = new Set([...readIds(), ...previous, ...ids])
      if (next.size === previous.size && [...next].every(id => previous.has(id))) return previous
      try { localStorage.setItem(readKey, JSON.stringify([...next])) } catch { /* Keep reading state in memory if storage is unavailable. */ }
      return next
    })
  }, [])
  return { read, markRead }
}

export function isAppWindow() {
  return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some(mode => window.matchMedia(`(display-mode: ${mode})`).matches)
    || !!(navigator as Navigator & { standalone?: boolean }).standalone
    || document.referrer.startsWith('android-app://')
}
