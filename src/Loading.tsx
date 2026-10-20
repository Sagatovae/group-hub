import { useEffect, useState } from 'react'

export function LoadingDots({ label, small = false }: { label?: string; small?: boolean }) {
  return <span className={`loading-indicator ${small ? 'small' : ''}`} role={label ? 'status' : undefined} aria-label={label}>
    <span className="loading-dots" aria-hidden="true"><i/><i/><i/></span>{label && <span>{label}</span>}
  </span>
}

export function ContentLoading({ subjects }: { subjects: boolean }) {
  return <div className="content-loading" role="status" aria-label="Загружаем материалы" aria-busy="true">
    <LoadingDots label="Загружаем материалы…"/>
    <div className={subjects ? 'subject-grid loading-placeholders' : 'loading-placeholders'} aria-hidden="true">
      {[0, 1, 2].map(index => <div className={`loading-placeholder ${subjects ? 'subject-placeholder' : ''}`} key={index}>
        <span className="placeholder-line short"/><span className="placeholder-line title"/><span className="placeholder-line"/><span className="placeholder-line medium"/><span className="placeholder-file"/>
      </div>)}
    </div>
  </div>
}

export function useStartupScreen(loading: boolean) {
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => { if (!loading) setLoaded(true) }, [loading])
  useEffect(() => {
    if (!loaded) return
    const screen = document.getElementById('app-startup')
    if (!screen) { setReady(true); return }
    screen.classList.add('startup-finished')
    // Only the exit transition takes time; fast starts are never artificially held.
    const timer = setTimeout(() => {
      screen.remove()
      setReady(true)
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320)
    return () => clearTimeout(timer)
  }, [loaded])
  return ready
}
