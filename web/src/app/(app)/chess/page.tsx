import { requireUser } from '@/lib/auth'
import { ChessAnalyzer } from './analyzer'

export default async function ChessPage() {
  await requireUser()
  return <ChessAnalyzer />
}
