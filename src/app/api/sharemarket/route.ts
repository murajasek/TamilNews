import { NextResponse } from 'next/server'
import { getMarketSnapshot, requestRescan } from '@/lib/sharemarket'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const noStore = { 'Cache-Control': 'no-store' }

export async function GET() {
  return NextResponse.json(await getMarketSnapshot(), { headers: noStore })
}

export async function POST() {
  const result = await requestRescan()
  return NextResponse.json(result, { status: result.triggered ? 200 : 409, headers: noStore })
}
