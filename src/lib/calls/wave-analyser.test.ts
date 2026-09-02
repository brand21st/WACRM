import { describe, it, expect } from 'vitest'
import { CallWaveAnalyser, voiceBarsFromTimeDomain, voicePeakFromTimeDomain } from './wave-analyser'

describe('voicePeakFromTimeDomain', () => {
  it('stays at the quiet floor for a silent buffer', () => {
    const samples = new Uint8Array(32).fill(128)
    expect(voicePeakFromTimeDomain(samples)).toBe(0.12)
  })

  it('rises with louder samples', () => {
    const quiet = new Uint8Array(32).fill(128)
    const loud = new Uint8Array(32).fill(128)
    loud[4] = 255
    expect(voicePeakFromTimeDomain(loud)).toBeGreaterThan(voicePeakFromTimeDomain(quiet))
    expect(voicePeakFromTimeDomain(loud)).toBeLessThanOrEqual(1)
  })
})

describe('voiceBarsFromTimeDomain', () => {
  it('keeps bar count stable so the wave does not scroll', () => {
    const samples = new Uint8Array(64).fill(128)
    samples[2] = 200
    samples[50] = 240
    const bars = voiceBarsFromTimeDomain(samples, 8)
    expect(bars).toHaveLength(8)
    expect(voiceBarsFromTimeDomain(samples, 8)).toEqual(bars)
    expect(Math.max(...bars)).toBeGreaterThan(0.12)
  })
})

describe('CallWaveAnalyser', () => {
  it('stop is safe before prime in node', () => {
    const wave = new CallWaveAnalyser()
    expect(wave.node).toBeNull()
    expect(() => wave.stop()).not.toThrow()
    expect(() => wave.setLocalMuted(true)).not.toThrow()
  })
})
