'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import type { NewsStory, SourceStatus } from '@/lib/news'

type NewsResponse = { stories: NewsStory[]; sources: SourceStatus[]; fetchedAt: string }
type ArticleResponse = { title: string; description: string; briefContent: string; briefParagraphCount?: number; paragraphs: string[]; url: string; source?: string; error?: string }
const fetcher = async (url: string) => {
  const response = await fetch(url)
  const payload = await response.json() as NewsResponse
  if (!response.ok) throw new Error('News service unavailable')
  return payload
}
const articleFetcher = async (url: string) => {
  const response = await fetch(url)
  const payload = await response.json() as ArticleResponse
  if (!response.ok) throw new Error(payload.error || 'Article unavailable')
  return payload
}
const categories = ['அனைத்தும்', 'தமிழ்நாடு', 'இந்தியா', 'உலகம்', 'அரசியல்', 'சினிமா', 'விளையாட்டு', 'வர்த்தகம்']

export default function Home() {
  const [activeCategory, setActiveCategory] = useState('அனைத்தும்')
  const [query, setQuery] = useState('')
  const [selectedStory, setSelectedStory] = useState<NewsStory | null>(null)
  const { data, error, isLoading } = useSWR('/api/news', fetcher, { refreshInterval: 300000, revalidateOnFocus: false })
  const articleUrl = selectedStory ? `/api/article?url=${encodeURIComponent(selectedStory.url)}` : null
  const { data: article, error: articleError, isLoading: articleLoading } = useSWR(articleUrl, articleFetcher)
  const articleParagraphs = article?.paragraphs ?? []
  const hasArticleParagraphs = articleParagraphs.length > 0
  const today = new Intl.DateTimeFormat('ta-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())
  const tickerHeadline = data?.stories[0]?.title ?? 'புதிய செய்திகளை உங்களுக்காகத் தொகுத்து வழங்குகிறோம்'
  const filteredStories = useMemo(() => (data?.stories ?? []).filter((story) => {
    const matchesCategory = activeCategory === 'அனைத்தும்' || story.category === activeCategory
    const searchText = `${story.title} ${story.summary} ${story.source}`.toLowerCase()
    return matchesCategory && searchText.includes(query.toLowerCase())
  }), [activeCategory, query, data?.stories])
  return (
    
    <div className="news-shell">
      <div className="utility-bar">
                <span>வியாழன், 03 செப்டம்பர் 2026 · சென்னை பதிவு</span
                ><span>தமிழ்நாடு 31°C · உலகச் செய்திகளை தமிழில் வாசியுங்கள்</span>
            </div>
      <header className="header">
        <img className="brand-logo" src="/arathamizh-logo.webp" alt="அறத்தமிழ் செய்தித்தளம்" />
        <div className="header-spacer" aria-hidden="true" />
        <label className="search">
          <input aria-label="செய்திகளைத் தேடுக" value={query} name="q"  placeholder="செய்திகளைத் தேடுக"
          onChange={(event) => setQuery(event.target.value)} />
          <span aria-hidden="true" className="search-icon" />
        </label>
      </header>

      <nav className="categories" aria-label="செய்தி வகைகள்">{categories.map((category) => <button className={`category ${activeCategory === category ? 'active' : ''}`} key={category} onClick={() => setActiveCategory(category)}>{category === 'அனைத்தும்' ? 'முகப்பு' : category}</button>)}</nav>

      <div className="breaking-news"><span className="breaking-label">நேரலை</span><p>{tickerHeadline}</p></div>

      <main className="main">
        <aside className="ad-rail" aria-label="விளம்பரம்">
        <div>Advertisement</div><span>விளம்பரம்</span><div>Advertisement</div></aside>
        <div className="content-column">
        {selectedStory ? <section className="reader">
          <button className="back-button" onClick={() => setSelectedStory(null)}>← செய்திகளுக்குத் திரும்பு</button>
          <div className="reader-kicker">{selectedStory.category} · {article?.source || selectedStory.source}</div>
          <h5>{article?.title || selectedStory.title}</h5>{articleLoading ? <div className="empty">செய்தியின் கூடுதல் தகவல்களை ஏற்றுகிறது...

          </div> : articleError || article?.error ? 
          <div className="empty">இந்த செய்தியை இப்போது திறக்க முடியவில்லை.</div> : hasArticleParagraphs ? <>
          <p className="reader-summary">{article?.briefContent || article?.description || selectedStory.summary}</p><div className="reader-copy">{articleParagraphs.slice(article?.briefParagraphCount ?? 0).map((paragraph, index) => <p key={`${selectedStory.id}-${index}`}>{paragraph}</p>)}</div></> : <div className="empty">கூடுதல் செய்தி உள்ளடக்கம் கிடைக்கவில்லை.</div>}</section> : <section>
          {error ? <div className="empty">செய்தி சேவையை அணுக முடியவில்லை. சிறிது நேரத்தில் மீண்டும் முயற்சிக்கவும்.</div> : filteredStories.length ? <><div className="grid">{filteredStories.map((story) => <article className="card" key={story.id}>{story.imageUrl && <img className="card-image" src={story.imageUrl} alt="" />}<div className="card-content"><button className="story-title" onClick={() => setSelectedStory(story)}>{story.title}</button><div className="meta">{story.source} · {new Date(story.publishedAt).toLocaleString('ta-IN')}</div></div></article>)}</div></> : <div className="empty">{isLoading ? 'செய்திகளைப் பெறுகிறோம்...' : 'தேடலுக்கு பொருத்தமான செய்திகள் இல்லை.'}</div>}
        </section>}
        </div>
        <aside className="ad-rail"><div>Advertisement</div><span>விளம்பரம்</span><div>Advertisement</div></aside>
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
                <section className="footer-about"><img src="/Arathamizh-gold-logo.webp" alt="அறத்தமிழ் செய்திகள்" /><p>அங்கீகரிக்கப்பட்ட RSS மூலங்களிலிருந்து செய்தித் தலைப்புகளைத் தொகுத்து, வாசகர்களை அசல் வெளியீட்டிற்கே வழிநடத்தும் தமிழ் செய்தி வாசிப்பு தளம்.</p></section>
                <section><h2>பிரிவுகள்</h2><nav className="footer-sections" aria-label="அடிக்குறிப்பு பிரிவுகள்"><span>தமிழ்நாடு</span><span>இந்தியா</span><span>உலகம்</span><span>அரசியல்</span><span>சினிமா</span><span>விளையாட்டு</span></nav></section>
                <section><h2>வெளிப்படைத்தன்மை</h2><nav className="footer-links" aria-label="கொள்கை வழிசெலுத்தல்"><span>செய்தி மூலங்கள்</span><span>ஆதாரக் கொள்கை</span><span>எங்களைப் பற்றி</span></nav></section>
        </div>
        <div className="footer-bottom"><span>© 2026 அறத்தமிழ் செய்திகள் · மாதிரி முகப்புப் பதிப்பு</span><span>அசல் கட்டுரைகள் அந்தந்த வெளியீட்டாளர்களின் உரிமையில் உள்ளன.</span></div>
</footer>
    </div>
  )
}
