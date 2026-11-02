import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'

// Scrolling, a second finger and nested controls must never activate a hold.
export function useLongPress(onHold?: () => void, ignoreControls = false) {
  const callback = useRef(onHold)
  callback.current = onHold
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const origin = useRef<{ x: number; y: number; id: number } | null>(null)
  const held = useRef(false)
  const clear = () => { clearTimeout(timer.current); timer.current = undefined; origin.current = null }
  useEffect(() => {
    window.addEventListener('scroll', clear, true)
    window.addEventListener('blur', clear)
    return () => { clear(); window.removeEventListener('scroll', clear, true); window.removeEventListener('blur', clear) }
  }, [])
  const eligible = (target: EventTarget | null, current: EventTarget | null) => !ignoreControls || !(target instanceof Element) || !target.closest('button,a,input,textarea,select,[role="button"]') || target === current
  const activate = () => { held.current = true; clear(); callback.current?.() }
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      clear(); held.current = false
      if (!callback.current || !event.isPrimary || event.button !== 0 || !eligible(event.target, event.currentTarget)) return
      origin.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
      timer.current = setTimeout(activate, 520)
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const start = origin.current
      if (start && (start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)) clear()
    },
    onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear,
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      if (held.current) { event.preventDefault(); event.stopPropagation(); held.current = false }
    },
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      if (callback.current && eligible(event.target, event.currentTarget)) {
        event.preventDefault(); event.stopPropagation()
        if (!held.current) activate()
      }
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (callback.current && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) {
        event.preventDefault(); activate()
      }
    },
  }
}

export const HoldButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { onHold?: () => void }>(function HoldButton({ onHold, onKeyDown, className = '', ...props }, ref) {
  const hold = useLongPress(props.disabled ? undefined : onHold)
  return <button {...props} {...hold} ref={ref} className={`${className} ${onHold ? 'hold-target' : ''}`} onKeyDown={event => { hold.onKeyDown(event); if (!event.defaultPrevented) onKeyDown?.(event) }}/>
})
