import { NextResponse } from 'next/server'

const allowedHosts = new Set([
  'tamil.oneindia.com',
  'www.bbc.com',
  'www.dailythanthi.com',
  'www.hindutamil.in',
  'www.dinamani.com',
  'www.maalaimalar.com',
  'www.puthiyathalaimurai.com',
  'tamil.news18.com',
  'www.dinamalar.com',
])

const decode = (value: string) => value
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/##\s*\$\{article\.altText\}/gi, '')
  .replace(/\s+/g, ' ')
  .trim()

const stripMarkup = (value: string) => decode(value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' '))
const limitBrief = (value: string) => value.length > 500 ? `${value.slice(0, 500).trim()}...` : value

function matchMeta(html: string, property: string) {
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'))
  return match ? decode(match[1]) : ''
}

function extractParagraphs(html: string) {
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0]
    ?? html.match(/<(?:main|section|div)[^>]+(?:article|story|content|body|description)[^>]*>[\s\S]*?<\/(?:main|section|div)>/i)?.[0]
    ?? html
  const paragraphs = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripMarkup(match[1]))
    .filter((paragraph) => paragraph.length > 40)
  if (paragraphs.length) return [...new Set(paragraphs)].slice(0, 40)

  const textBlocks = [...article.matchAll(/<(?:div|span)\b[^>]*>([\s\S]*?)<\/(?:div|span)>/gi)]
    .map((match) => stripMarkup(match[1]))
    .filter((block) => block.length > 70 && block.length < 1200)
  return [...new Set(textBlocks)].slice(0, 40)
}

function extractStructuredBody(html: string) {
  const bodies: string[] = []
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1].trim()) as Record<string, unknown> | Array<Record<string, unknown>>
      const entries = Array.isArray(value) ? value : [value]
      for (const entry of entries) {
        if (typeof entry.articleBody === 'string') bodies.push(stripMarkup(entry.articleBody))
      }
    } catch {
      // Ignore malformed structured data and continue with HTML extraction.
    }
  }
  return bodies.flatMap((body) => body.split(/\n+|(?<=[.!?।])\s+/)).filter((paragraph) => paragraph.length > 40).slice(0, 40)
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('url')
  if (!target) return NextResponse.json({ error: 'Article URL is required.' }, { status: 400 })

  let articleUrl: URL
  try {
    articleUrl = new URL(target)
  } catch {
    return NextResponse.json({ error: 'Invalid article URL.' }, { status: 400 })
  }
  if (!allowedHosts.has(articleUrl.hostname)) return NextResponse.json({ error: 'Source is not allowed.' }, { status: 403 })

  try {
    const response = await fetch(articleUrl, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; TamilNewsReader/1.0)' }, cache: 'no-store' })
    if (!response.ok) throw new Error(`Article returned ${response.status}`)
    const html = await response.text()
    const title = matchMeta(html, 'og:title') || stripMarkup(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    const description = matchMeta(html, 'og:description') || matchMeta(html, 'description')
    const paragraphs = [...new Set([...extractParagraphs(html), ...extractStructuredBody(html)])].slice(0, 40)
    const extractedBrief = paragraphs.slice(0, 2).join(' ')
    const briefContent = limitBrief(extractedBrief || description || 'இந்த செய்தியின் சுருக்கமான உள்ளடக்கம் தற்போது கிடைக்கவில்லை.')
    const briefParagraphCount = extractedBrief ? Math.min(2, paragraphs.length) : 0
    return NextResponse.json({ title, description, briefContent, briefParagraphCount, paragraphs, url: articleUrl.href, source: articleUrl.hostname })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Article could not be loaded.' }, { status: 502 })
  }
}
