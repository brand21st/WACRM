export function playBase64Audio(base64: string, mimeType: string): Promise<void> {
  const src = `data:${mimeType};base64,${base64}`
  const audio = new Audio(src)
  return audio.play()
}
