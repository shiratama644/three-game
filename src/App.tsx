import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
} from 'react'
import './App.css'
import { FpsGame, type GameInput } from './game/FpsGame'

interface StickState {
  x: number
  y: number
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const inputRef = useRef<GameInput>({
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    jump: false,
    slide: false,
  })
  const keysRef = useRef({
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false,
  })

  const [loading, setLoading] = useState(true)
  const [stick, setStick] = useState<StickState>({ x: 0, y: 0 })
  const [stickActive, setStickActive] = useState(false)
  const lookPointerRef = useRef({ x: 0, y: 0 })

  const readInput = useCallback((): GameInput => {
    const snapshot = { ...inputRef.current }
    inputRef.current.lookX = 0
    inputRef.current.lookY = 0
    inputRef.current.jump = false
    inputRef.current.slide = false
    return snapshot
  }, [])

  const updateKeyboardAxis = useCallback(() => {
    const keys = keysRef.current
    const moveX =
      (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0)
    const moveY = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0)
    inputRef.current.moveX = moveX
    inputRef.current.moveY = moveY
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code in keysRef.current) {
        keysRef.current[event.code as keyof typeof keysRef.current] = true
        updateKeyboardAxis()
        return
      }
      if (event.code === 'Space') {
        inputRef.current.jump = true
        event.preventDefault()
        return
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        inputRef.current.slide = true
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code in keysRef.current) {
        keysRef.current[event.code as keyof typeof keysRef.current] = false
        updateKeyboardAxis()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [updateKeyboardAxis])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const game = new FpsGame(canvas, readInput, setLoading)
    void game.initialize()

    const onCanvasClick = () => {
      void canvas.requestPointerLock()
    }

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) {
        return
      }
      inputRef.current.lookX += event.movementX
      inputRef.current.lookY += event.movementY
    }

    canvas.addEventListener('click', onCanvasClick)
    window.addEventListener('mousemove', onMouseMove)

    return () => {
      canvas.removeEventListener('click', onCanvasClick)
      window.removeEventListener('mousemove', onMouseMove)
      game.dispose()
    }
  }, [readInput])

  const stickHandlers = useMemo(() => {
    const clampStick = (x: number, y: number) => {
      const radius = Math.sqrt(x * x + y * y)
      if (radius <= 1) {
        return { x, y }
      }
      return { x: x / radius, y: y / radius }
    }

    const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)
      setStickActive(true)
    }

    const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const dx = (event.clientX - centerX) / (rect.width / 2)
      const dy = (event.clientY - centerY) / (rect.height / 2)
      const clamped = clampStick(dx, dy)
      setStick(clamped)
      inputRef.current.moveX = clamped.x
      inputRef.current.moveY = -clamped.y
    }

    const reset = () => {
      setStickActive(false)
      setStick({ x: 0, y: 0 })
      inputRef.current.moveX = 0
      inputRef.current.moveY = 0
    }

    const onPointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      reset()
    }

    const onPointerCancel: PointerEventHandler<HTMLDivElement> = (event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      reset()
    }

    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  }, [])

  const lookPadHandlers = useMemo(() => {
    const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      lookPointerRef.current.x = event.clientX
      lookPointerRef.current.y = event.clientY
    }

    const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        return
      }
      const dx = event.clientX - lookPointerRef.current.x
      const dy = event.clientY - lookPointerRef.current.y
      inputRef.current.lookX += dx
      inputRef.current.lookY += dy
      lookPointerRef.current.x = event.clientX
      lookPointerRef.current.y = event.clientY
    }

    const clearCapture: PointerEventHandler<HTMLDivElement> = (event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }

    return {
      onPointerDown,
      onPointerMove,
      onPointerUp: clearCapture,
      onPointerCancel: clearCapture,
    }
  }, [])

  return (
    <main className="app">
      <canvas ref={canvasRef} className="game-canvas" />

      {loading && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <p>Loading scene...</p>
        </div>
      )}

      <div className="hud">
        <div className="hint">WASD / タッチで移動・Spaceでジャンプ・Shiftでスライド</div>
      </div>

      <div className="mobile-overlay">
        <div className="look-pad" {...lookPadHandlers} />
        <div className="controls-left">
          <div className="stick-base" {...stickHandlers}>
            <div
              className={`stick-knob ${stickActive ? 'active' : ''}`}
              style={{
                transform: `translate(${stick.x * 28}px, ${stick.y * 28}px)`,
              }}
            />
          </div>
        </div>
        <div className="controls-right">
          <button
            type="button"
            className="action-button"
            onPointerDown={() => {
              inputRef.current.jump = true
            }}
          >
            Jump
          </button>
          <button
            type="button"
            className="action-button"
            onPointerDown={() => {
              inputRef.current.slide = true
            }}
          >
            Slide
          </button>
        </div>
      </div>
    </main>
  )
}

export default App
