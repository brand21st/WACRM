/**
 * Tiny in-process pool. Used to cap overlapping Meta media downloads
 * and to fan inbound webhook messages out so one slow voice note
 * cannot stall every other customer in the same POST.
 */

export function createSemaphore(max: number) {
  const limit = Math.max(1, Math.floor(max))
  let used = 0
  const waiters: Array<() => void> = []

  async function acquire() {
    if (used < limit) {
      used += 1
      return
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
  }

  function release() {
    const next = waiters.shift()
    if (next) {
      next()
      return
    }
    used = Math.max(0, used - 1)
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length))
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const i = next
        next += 1
        if (i >= items.length) return
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}
