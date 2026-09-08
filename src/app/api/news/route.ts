import { NextResponse } from 'next/server'
import { getNews } from '@/lib/news'

export const revalidate = 300

export async function GET() {
  try {
    const data = await getNews()
    return NextResponse.json(data, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } })
  } catch {
    return NextResponse.json({ stories: [], sources: [], error: 'செய்திகளைப் பெற முடியவில்லை.' }, { status: 502 })
  }
}
