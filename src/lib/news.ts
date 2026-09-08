import { XMLParser } from 'fast-xml-parser'

export type NewsSource = 'Thatstamil / Oneindia' | 'BBC தமிழ்' | 'Dailythanthi' | 'The Hindu தமிழ்' | 'Dinamani' | 'Maalai Malar' | 'Puthiya Thalaimurai' | 'News18 தமிழ்'

export type NewsStory = {
  id: string
  source: NewsSource
  category: string
  title: string
  summary: string
  url: string
  imageUrl?: string
  publishedAt: string
}

export type SourceStatus = { name: NewsSource; ok: boolean; count: number; error?: string }

type SourceConfig = { name: NewsSource; feed?: string; page: string; domain: string }

const sources: SourceConfig[] = [
  { name: 'Thatstamil / Oneindia', feed: 'https://tamil.oneindia.com/rss/feeds/oneindia-tamil-fb.xml', page: 'https://tamil.oneindia.com/', domain: 'tamil.oneindia.com' },
  { name: 'BBC தமிழ்', feed: 'https://feeds.bbci.co.uk/tamil/rss.xml', page: 'https://www.bbc.com/tamil', domain: 'www.bbc.com' },
  { name: 'Dailythanthi', page: 'https://www.dailythanthi.com/', domain: 'www.dailythanthi.com' },
  { name: 'The Hindu தமிழ்', page: 'https://www.hindutamil.in/', domain: 'www.hindutamil.in' },
  { name: 'Dinamani', page: 'https://www.dinamani.com/', domain: 'www.dinamani.com' },
  { name: 'Maalai Malar', page: 'https://www.maalaimalar.com/', domain: 'www.maalaimalar.com' },
  { name: 'Puthiya Thalaimurai', page: 'https://www.puthiyathalaimurai.com/', domain: 'www.puthiyathalaimurai.com' },
  { name: 'News18 தமிழ்', page: 'https://tamil.news18.com/', domain: 'tamil.news18.com' },
]

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const decodeHtmlEntities = (str: string): string => str.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
const text = (value: unknown) => typeof value === 'string' ? decodeHtmlEntities(value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()) : ''
const astrologyPattern = /astrolog|horoscope|zodiac|rasi-?pal[an]?|rasipalan|peyarchi|jothid|sani|rahu|ketu|spirtual|spiritual|aanmeegam|ஆன்மீக|ஜோதிட|ஜாதக|ராசி\s*பலன்|நட்சத்திர\s*பலன்|பெயர்ச்சி|சனி|ராகு|கேது/i

function isAstrologyStory(title: string, category: string, url: string) {
  return astrologyPattern.test(`${title} ${category} ${url}`)
}

function imageUrl(value: unknown, baseUrl: string) {
  const markup = typeof value === 'string' ? value : ''
  const match = markup.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/i)
  if (!match?.[1]) return undefined
  try {
    return new URL(decodeHtmlEntities(match[1]), baseUrl).href
  } catch {
    return undefined
  }
}

function rssImageUrl(item: Record<string, unknown>, baseUrl: string) {
  const enclosure = item.enclosure as Record<string, unknown> | undefined
  const media = item['media:content'] as Record<string, unknown> | undefined
  const candidate = enclosure?.['@_url'] ?? media?.['@_url']
  if (typeof candidate === 'string') {
    try {
      return new URL(decodeHtmlEntities(candidate), baseUrl).href
    } catch {
      return undefined
    }
  }
  return imageUrl(item.description ?? item.summary, baseUrl)
}

function mapCategory(value: string, title = '') {
  const category = `${value} ${title}`.toLowerCase()
  if (/(politic|government|minister|cm-|chief-minister|mla|assembly|election|party|bjp|congress|dmk|admk|tvk|தேர்தல்|அரசியல்|அமைச்சர்|முதல்வர்|சட்டசபை|எம்எல்ஏ|கட்சி|ஆட்சி|அரசு)/i.test(category)) return 'அரசியல்'
  if (category.includes('sport')) return 'விளையாட்டு'
  if (category.includes('business')) return 'வர்த்தகம்'
  if (category.includes('cinema') || category.includes('television')) return 'சினிமா'
  if (category.includes('world') || category.includes('international')) return 'உலகம்'
  if (category.includes('india')) return 'இந்தியா'
  return 'தமிழ்நாடு'
}

async function fetchFeed(source: SourceConfig): Promise<NewsStory[]> {
  if (!source.feed) throw new Error('No RSS feed configured')
  const response = await fetch(source.feed, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Feed returned ${response.status}`)
  const xml = await response.text()
  const parsed = parser.parse(xml) as Record<string, unknown>
  const rss = (parsed.rss as Record<string, unknown>) ?? (parsed.feed as Record<string, unknown>)
  if (!rss) throw new Error('Invalid feed format')
  const channel = (rss.channel as Record<string, unknown>) ?? rss
  const items = Array.isArray(channel.item) ? channel.item : [channel.item as Record<string, unknown>]
  const stories = (items.filter(Boolean) as Record<string, unknown>[]).slice(0, 12).map((item, index) => ({
    id: `${source.name}-feed-${index}-${item.link}`,
    source: source.name,
    category: mapCategory(text(item.category), text(item.title)),
    title: text(item.title),
    summary: text(item.description ?? item.summary),
    url: String(item.link ?? item.id ?? ''),
    imageUrl: rssImageUrl(item, source.page),
    publishedAt: new Date(String(item.pubDate ?? item.published ?? Date.now())).toISOString(),
  })).filter(story => story.url && story.title)
  if (!stories.length) throw new Error('No stories in feed')
  return stories
}

async function fetchPage(source: SourceConfig): Promise<NewsStory[]> {
  const response = await fetch(source.page, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; TamilNewsReader/1.0)' }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Page returned ${response.status}`)
  const html = await response.text()
  const stories: NewsStory[] = []
  const seen = new Set<string>()
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(html)) && stories.length < 12) {
    const rawUrl = match[1].trim()
    const title = text(match[2])
    if (!title || title.length < 18 || title.length > 220 || title.toLowerCase().includes('advertisement')) continue
    const url = new URL(rawUrl, source.page)
    if (url.hostname !== source.domain || seen.has(url.href) || !url.pathname || url.pathname === '/') continue
    seen.add(url.href)
    const nearbyMarkup = html.slice(Math.max(0, match.index - 500), Math.min(html.length, linkPattern.lastIndex + 500))
    stories.push({ id: `${source.name}-${stories.length}-${url.href}`, source: source.name, category: mapCategory(url.pathname, title), title, summary: 'மேலும் செய்தியை மூல இணையதளத்தில் படிக்கவும்.', url: url.href, imageUrl: imageUrl(match[2], source.page) ?? imageUrl(nearbyMarkup, source.page), publishedAt: new Date().toISOString() })
  }
  if (!stories.length) throw new Error('No readable headlines found')
  return stories
}

export async function getNews() {
  const results = await Promise.all(sources.map(async (source): Promise<{ stories: NewsStory[]; status: SourceStatus }> => {
    try {
      const stories = await fetchFeed(source).catch(() => fetchPage(source))
      return { stories, status: { name: source.name, ok: true, count: stories.length } }
    } catch (error) {
      return { stories: [], status: { name: source.name, ok: false, count: 0, error: error instanceof Error ? error.message : 'Unknown source error' } }
    }
  }))
  const stories = results.flatMap((result) => result.stories)
    .filter((story) => `${story.title} ${story.summary}`.length >= 120)
    .sort((firstStory, secondStory) => {
    const firstIsAstrology = isAstrologyStory(firstStory.title, firstStory.category, firstStory.url)
    const secondIsAstrology = isAstrologyStory(secondStory.title, secondStory.category, secondStory.url)
    if (firstIsAstrology !== secondIsAstrology) return firstIsAstrology ? 1 : -1
    return Date.parse(secondStory.publishedAt) - Date.parse(firstStory.publishedAt)
  })
  return { stories, sources: results.map((result) => result.status), fetchedAt: new Date().toISOString() }
}
