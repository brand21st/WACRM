'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  drawWhatsAppBars,
  barsThatFit,
} from '@/lib/inbox/voice-waveform'
import { voiceBarsFromTimeDomain } from '@/lib/calls/wave-analyser'

const MIN_PEAK = 0.12

function fitCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pxW = Math.floor(width * dpr)
  const pxH = Math.floor(height * dpr)
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { width, height, ctx }
}

function cssColor(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

export function CallLiveWave({
  analyser,
  className,
}: {
  analyser: AnalyserNode | null
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const samples = new Uint8Array(analyser?.fftSize ?? 256)
    let raf = 0
    let displayed: number[] = []

    const paint = () => {
      const fitted = fitCanvas(canvas)
      if (fitted) {
        const barCount = barsThatFit(fitted.width)
        if (displayed.length !== barCount) {
          displayed = new Array(barCount).fill(MIN_PEAK)
        }

        let target = displayed
        if (analyser) {
          try {
            analyser.getByteTimeDomainData(samples)
            target = voiceBarsFromTimeDomain(samples, barCount)
          } catch {
            target = displayed.map(() => MIN_PEAK)
          }
        } else {
          target = displayed.map(() => MIN_PEAK)
        }

        for (let i = 0; i < barCount; i++) {
          const next = target[i] ?? MIN_PEAK
          displayed[i] += (next - displayed[i]) * 0.42
        }

        fitted.ctx.clearRect(0, 0, fitted.width, fitted.height)
        const barColor = cssColor(canvas, '--wave-bar', '#10b981')
        drawWhatsAppBars(fitted.ctx, {
          width: fitted.width,
          height: fitted.height,
          peaks: displayed,
          progress: 1,
          color: barColor,
          playedColor: barColor,
        })
      }
      raf = requestAnimationFrame(paint)
    }

    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        'mt-3 h-8 w-full [--wave-bar:#10b981]',
        className,
      )}
      aria-hidden
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}
