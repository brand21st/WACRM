const LADDER = ['pending', 'sent', 'delivered', 'read', 'replied'] as const

function ladderLevel(s: string): number {
  return (LADDER as readonly string[]).indexOf(s)
}

export function isValidPostBusStatusTransition(
  current: string,
  incoming: string,
): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent' || current === 'sending'
  }
  if (current === 'failed') return false
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}
