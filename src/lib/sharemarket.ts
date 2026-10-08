import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

export const DISPLAY_COLUMNS = [
  'Ticker', 'Exchange', 'Company', 'Price', 'Today %', 'Today Status',
  'Months Up', '6M Return %', 'Avg Monthly %', 'Worst Month %',
] as const

export type TrendPayload = {
  dates: string[]
  close: (number | null)[]
  sma20: (number | null)[]
  sma50: (number | null)[]
  sma100: (number | null)[]
  rebased: (number | null)[]
  months: string[]
  monthly_returns: number[]
  hourly?: { dates: string[]; close: number[] }
}

export type MarketRow = {
  Ticker: string
  Exchange: 'NSE' | 'BSE'
  Company: string
  Price: number
  'Today %': number | null
  'Today Status': string
  'Months Up': number
  '6M Return %': number
  'Avg Monthly %': number
  'Worst Month %': number
  'Max Drawdown %': number
  Trend: TrendPayload
}

export type MarketSnapshot = {
  status: 'idle' | 'running' | 'ok' | 'error'
  rows: MarketRow[]
  columns: string[]
  rejections: Record<string, number>
  error: string | null
  last_run: string | null
  next_run: string | null
  duration_sec: number | null
  universe_size: number
  analyzed: number
  run_count: number
  live_updated: string | null
  live_error: string | null
  match_count: number
  by_exchange: Record<string, number>
  median_return: number | null
  median_drawdown: number | null
  universe: string
  months: number
  scan_interval_minutes: number
  live_interval_seconds: number
}

type Bar = { date: string; close: number; high: number; low: number; volume: number }
type Rejections = Record<'insufficient_history' | 'illiquid' | 'monthly_gains' | 'ma_alignment' | 'market_structure' | 'drawdown', number>

type ChartResult = {
  meta?: {
    gmtoffset?: number
    longName?: string
    shortName?: string
    regularMarketPrice?: number
    previousClose?: number
    chartPreviousClose?: number
  }
  timestamp?: number[]
  indicators?: {
    quote?: { high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[]
    adjclose?: { adjclose?: (number | null)[] }[]
  }
}

const MONTHS = 6
const MIN_MONTHLY_RETURN_PCT = -1
const MIN_AVG_VOLUME = 50_000
const RESULT_LIMIT_PER_EXCHANGE = 10
const CACHE_VERSION = 3
const HISTORY_POINTS = 130
const SMA_WINDOWS = [20, 50, 100] as const
const CONCURRENCY = 12
const SCAN_INTERVAL_MINUTES = Number(process.env.SHARE_MARKET_SCAN_MINUTES) || 30
const LIVE_INTERVAL_SECONDS = 30
const ERROR_RETRY_MS = 5 * 60_000
const MIN_MANUAL_RESCAN_MS = 2 * 60_000
const UNIVERSE_LIMIT = Number(process.env.SHARE_MARKET_LIMIT) || 500
const EXCHANGES = parseExchanges(process.env.SHARE_MARKET_EXCHANGES || 'NSE,BSE')
const CACHE_FILE = path.join(os.tmpdir(), 'arathamizh-sharemarket.json')

const NIFTY500_CSV_URLS = [
  'https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv',
  'https://archives.nseindia.com/content/indices/ind_nifty500list.csv',
]
const BSE_SCRIP_LIST_URL = 'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const NSE_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'text/csv,application/csv,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/' }
const BSE_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.bseindia.com/' }
const YAHOO_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' }

// Used only when NSE's constituent list is unreachable.
const FALLBACK_TICKERS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'HINDUNILVR', 'ITC',
  'SBIN', 'BHARTIARTL', 'KOTAKBANK', 'LT', 'AXISBANK', 'ASIANPAINT', 'MARUTI',
  'BAJFINANCE', 'HCLTECH', 'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'WIPRO',
  'NESTLEIND', 'ONGC', 'NTPC', 'POWERGRID', 'TATAMOTORS', 'TATASTEEL', 'JSWSTEEL',
  'ADANIENT', 'ADANIPORTS', 'COALINDIA', 'GRASIM', 'HINDALCO', 'DRREDDY',
  'CIPLA', 'DIVISLAB', 'BRITANNIA', 'EICHERMOT', 'HEROMOTOCO', 'BAJAJ-AUTO',
  'M&M', 'TECHM', 'INDUSINDBK', 'SBILIFE', 'HDFCLIFE', 'BPCL', 'APOLLOHOSP',
  'TATACONSUM', 'SHRIRAMFIN', 'TRENT', 'BEL', 'DMART', 'PIDILITIND', 'SIEMENS',
  'LTIM', 'VBL', 'ZOMATO', 'IRCTC', 'CGPOWER', 'POLYCAB', 'PERSISTENT',
  'MAZDOCK', 'HAL', 'BSE', 'SUZLON', 'DIXON', 'KAYNES', 'AMBUJACEM',
]

type State = {
  status: MarketSnapshot['status']
  rows: MarketRow[]
  rejections: Record<string, number>
  error: string | null
  lastRun: string | null
  lastAttempt: number
  durationSec: number | null
  universeSize: number
  analyzed: number
  runCount: number
  liveUpdated: string | null
  liveError: string | null
  liveCheckedAt: number
  cacheLoaded: boolean
  scan: Promise<void> | null
  live: Promise<void> | null
}

// Kept on globalThis so dev hot-reloads don't drop the scan state.
const store = globalThis as typeof globalThis & { __shareMarketState?: State }
const state: State = store.__shareMarketState ??= {
  status: 'idle', rows: [], rejections: {}, error: null, lastRun: null, lastAttempt: 0,
  durationSec: null, universeSize: 0, analyzed: 0, runCount: 0, liveUpdated: null,
  liveError: null, liveCheckedAt: 0, cacheLoaded: false, scan: null, live: null,
}

function parseExchanges(raw: string): ('NSE' | 'BSE')[] {
  const wanted = raw.split(',').map((value) => value.trim().toUpperCase())
  const valid = Array.from(new Set(wanted)).filter((value): value is 'NSE' | 'BSE' => value === 'NSE' || value === 'BSE')
  return valid.length ? valid : ['NSE']
}

const round2 = (value: number) => Math.round(value * 100) / 100
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const exchangeOf = (ticker: string): 'NSE' | 'BSE' => (ticker.toUpperCase().endsWith('.BO') ? 'BSE' : 'NSE')
const rootOf = (ticker: string) => ticker.slice(0, ticker.lastIndexOf('.'))
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function mapPool<T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

async function fetchWithTimeout(url: string, headers: Record<string, string>, timeoutMs: number) {
  return fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { cell += '"'; index++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { cells.push(cell.trim()); cell = '' }
    else cell += char
  }
  cells.push(cell.trim())
  return cells
}

async function getNseTickers(names: Map<string, string>): Promise<string[]> {
  for (const url of NIFTY500_CSV_URLS) {
    try {
      const response = await fetchWithTimeout(url, NSE_HEADERS, 15_000)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const [header, ...lines] = (await response.text()).split(/\r?\n/).filter(Boolean).map(parseCsvLine)
      const symbolIndex = header.indexOf('Symbol')
      const nameIndex = header.indexOf('Company Name')
      if (symbolIndex < 0) throw new Error('unexpected NSE CSV columns')
      const symbols = lines.map((cells) => {
        const symbol = (cells[symbolIndex] ?? '').replace(/\s/g, '')
        if (symbol && nameIndex >= 0 && cells[nameIndex]) names.set(`${symbol}.NS`, cells[nameIndex])
        return symbol
      }).filter(Boolean)
      if (symbols.length) return Array.from(new Set(symbols)).sort().map((symbol) => `${symbol}.NS`)
    } catch (error) {
      console.warn(`ShareMarket: NSE list failed (${new URL(url).hostname}): ${errorMessage(error)}`)
    }
  }
  return [...FALLBACK_TICKERS].sort().map((symbol) => `${symbol}.NS`)
}

async function getBseTickers(names: Map<string, string>): Promise<string[]> {
  type BseScrip = { scrip_id?: string | null; GROUP?: string | null; Issuer_Name?: string | null; Scrip_Name?: string | null }
  try {
    const response = await fetchWithTimeout(BSE_SCRIP_LIST_URL, BSE_HEADERS, 25_000)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const scrips = await response.json() as BseScrip[]
    const tickers = scrips
      .filter((scrip) => String(scrip.GROUP ?? '').trim().toUpperCase() === 'A' && scrip.scrip_id)
      .map((scrip) => {
        const ticker = `${String(scrip.scrip_id).replace(/\s/g, '')}.BO`
        const name = String(scrip.Issuer_Name || scrip.Scrip_Name || '').replace(/[-$\s]+$/, '').trim()
        if (name) names.set(ticker, name)
        return ticker
      })
    return Array.from(new Set(tickers)).sort()
  } catch (error) {
    console.warn(`ShareMarket: BSE list failed: ${errorMessage(error)}`)
    return []
  }
}

async function getTickers(names: Map<string, string>): Promise<string[]> {
  const nse = EXCHANGES.includes('NSE') ? await getNseTickers(names) : []
  let bse = EXCHANGES.includes('BSE') ? await getBseTickers(names) : []
  if (EXCHANGES.includes('BSE') && !bse.length && nse.length) bse = nse.map((ticker) => `${rootOf(ticker)}.BO`)
  const tickers = [...nse.slice(0, UNIVERSE_LIMIT), ...bse.slice(0, UNIVERSE_LIMIT)]
  return tickers.length ? tickers : FALLBACK_TICKERS.map((symbol) => `${symbol}.NS`)
}

async function fetchChart(ticker: string, query: string): Promise<ChartResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${query}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchWithTimeout(url, YAHOO_HEADERS, 15_000)
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`)
      if (!response.ok) return null
      const payload = await response.json() as { chart?: { result?: ChartResult[] | null } }
      return payload.chart?.result?.[0] ?? null
    } catch {
      if (attempt === 3) return null
      await sleep(500 * 2 ** attempt)
    }
  }
  return null
}

async function fetchDailyBars(ticker: string): Promise<{ bars: Bar[]; name?: string } | null> {
  const result = await fetchChart(ticker, 'range=2y&interval=1d&events=split%2Cdiv')
  const quote = result?.indicators?.quote?.[0]
  if (!result?.timestamp || !quote?.close) return null
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose
  const offset = result.meta?.gmtoffset ?? 0
  const byDate = new Map<string, Bar>()
  result.timestamp.forEach((timestamp, index) => {
    const close = quote.close?.[index]
    if (close == null || !Number.isFinite(close) || close <= 0) return
    // Scale OHLC by the adjusted-close ratio so splits/bonuses don't break trends.
    const factor = adjusted?.[index] ? adjusted[index]! / close : 1
    byDate.set(new Date((timestamp + offset) * 1000).toISOString().slice(0, 10), {
      date: new Date((timestamp + offset) * 1000).toISOString().slice(0, 10),
      close: close * factor,
      high: (quote.high?.[index] ?? close) * factor,
      low: (quote.low?.[index] ?? close) * factor,
      volume: quote.volume?.[index] ?? 0,
    })
  })
  const bars = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  return bars.length ? { bars, name: result.meta?.longName || result.meta?.shortName } : null
}

function rollingMean(values: number[], window: number): (number | null)[] {
  let sum = 0
  return values.map((value, index) => {
    sum += value
    if (index >= window) sum -= values[index - window]
    return index >= window - 1 ? sum / window : null
  })
}

function monthEndBuckets(bars: Bar[]) {
  const buckets: { key: string; close: number; high: number; low: number }[] = []
  for (const bar of bars) {
    const key = bar.date.slice(0, 7)
    const last = buckets[buckets.length - 1]
    if (last?.key === key) {
      last.close = bar.close
      last.high = Math.max(last.high, bar.high)
      last.low = Math.min(last.low, bar.low)
    } else buckets.push({ key, close: bar.close, high: bar.high, low: bar.low })
  }
  return buckets
}

const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const strictlyRising = (values: number[]) => values.every((value, index) => index === 0 || value > values[index - 1])

function analyze(ticker: string, bars: Bar[], reasons: Rejections): Omit<MarketRow, 'Company'> | null {
  if (bars.length < Math.max(100, MONTHS * 21) + 5) { reasons.insufficient_history++; return null }
  const recentVolume = bars.slice(-60)
  if (recentVolume.reduce((sum, bar) => sum + bar.volume, 0) / recentVolume.length < MIN_AVG_VOLUME) { reasons.illiquid++; return null }

  // MONTHS + 1 buckets: the oldest anchors the first month-over-month return.
  const monthlyFull = monthEndBuckets(bars).slice(-(MONTHS + 1))
  if (monthlyFull.length < MONTHS + 1) { reasons.insufficient_history++; return null }
  const monthlyWindow = monthlyFull.slice(1)
  const monthlyReturns = monthlyWindow.map((month, index) => (month.close / monthlyFull[index].close - 1) * 100)
  // Stocks missing a month are kept as fill-ins and ranked below consistent gainers.
  if (!monthlyReturns.every((value) => value > MIN_MONTHLY_RETURN_PCT)) reasons.monthly_gains++

  const closes = bars.map((bar) => bar.close)
  const smas = Object.fromEntries(SMA_WINDOWS.map((window) => [window, rollingMean(closes, window)])) as Record<20 | 50 | 100, (number | null)[]>
  const last = closes.length - 1
  const [sma20, sma50, sma100] = [smas[20][last], smas[50][last], smas[100][last]]
  if (!(sma20 !== null && sma50 !== null && sma100 !== null && closes[last] > sma20 && sma20 > sma50 && sma50 > sma100)) reasons.ma_alignment++
  if (!(strictlyRising(monthlyWindow.map((month) => month.low)) && strictlyRising(monthlyWindow.map((month) => month.high)))) reasons.market_structure++

  const windowCloses = bars.filter((bar) => bar.date.slice(0, 7) > monthlyFull[0].key).map((bar) => bar.close)
  const startPrice = monthlyFull[0].close
  const lastPrice = closes[last]
  let peak = -Infinity
  const maxDrawdown = Math.min(0, ...windowCloses.map((close) => { peak = Math.max(peak, close); return (close / peak - 1) * 100 }))
  const previousClose = closes[last - 1] ?? lastPrice
  const todayPct = (lastPrice / previousClose - 1) * 100

  const tailStart = Math.max(0, bars.length - HISTORY_POINTS)
  const tail = bars.slice(tailStart)
  const clean = (values: (number | null)[]) => values.slice(tailStart).map((value) => (value === null ? null : round2(value)))
  return {
    Ticker: ticker,
    Exchange: exchangeOf(ticker),
    Price: round2(lastPrice),
    'Today %': round2(todayPct),
    'Today Status': todayPct >= 0 ? 'Gain' : 'Loss',
    'Months Up': monthlyReturns.filter((value) => value > MIN_MONTHLY_RETURN_PCT).length,
    '6M Return %': round2((lastPrice / startPrice - 1) * 100),
    'Avg Monthly %': round2(((lastPrice / startPrice) ** (1 / MONTHS) - 1) * 100),
    'Worst Month %': round2(Math.min(...monthlyReturns)),
    'Max Drawdown %': round2(maxDrawdown),
    Trend: {
      dates: tail.map((bar) => bar.date),
      close: tail.map((bar) => round2(bar.close)),
      sma20: clean(smas[20]),
      sma50: clean(smas[50]),
      sma100: clean(smas[100]),
      rebased: tail.map((bar) => round2(bar.close / tail[0].close * 100)),
      months: monthlyWindow.map((month) => monthLabel(month.key)),
      monthly_returns: monthlyReturns.map(round2),
    },
  }
}

async function addHourlyTrends(rows: MarketRow[]) {
  await mapPool(rows, CONCURRENCY, async (row) => {
    const result = await fetchChart(row.Ticker, 'range=1mo&interval=1h')
    const closes = result?.indicators?.quote?.[0]?.close
    if (!result?.timestamp || !closes) return
    const points = result.timestamp
      .map((timestamp, index) => ({ date: new Date(timestamp * 1000).toISOString(), close: closes[index] }))
      .filter((point): point is { date: string; close: number } => point.close != null && Number.isFinite(point.close))
    if (points.length) row.Trend.hourly = { dates: points.map((point) => point.date), close: points.map((point) => round2(point.close)) }
  })
  // A dual-listed company can borrow its twin listing's hourly series.
  const byRoot = new Map(rows.filter((row) => row.Trend.hourly).map((row) => [rootOf(row.Ticker), row.Trend.hourly!]))
  for (const row of rows) row.Trend.hourly ??= byRoot.get(rootOf(row.Ticker))
}

async function saveCache() {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify({
      version: CACHE_VERSION, months: MONTHS, rows: state.rows, rejections: state.rejections, last_run: state.lastRun,
      universe_size: state.universeSize, analyzed: state.analyzed, duration_sec: state.durationSec,
      live_updated: state.liveUpdated,
    }), 'utf-8')
  } catch (error) {
    console.warn(`ShareMarket: could not write cache: ${errorMessage(error)}`)
  }
}

async function loadCache() {
  if (state.cacheLoaded) return
  state.cacheLoaded = true
  try {
    const payload = JSON.parse(await fs.readFile(CACHE_FILE, 'utf-8'))
    if (payload.version !== CACHE_VERSION || payload.months !== MONTHS || !Array.isArray(payload.rows)) return
    state.rows = payload.rows
    state.rejections = payload.rejections ?? {}
    state.lastRun = payload.last_run ?? null
    state.lastAttempt = state.lastRun ? Date.parse(state.lastRun) : 0
    state.universeSize = payload.universe_size ?? 0
    state.analyzed = payload.analyzed ?? 0
    state.durationSec = payload.duration_sec ?? null
    state.liveUpdated = payload.live_updated ?? null
    state.status = 'ok'
  } catch {
    // No cache yet.
  }
}

async function runScan() {
  const started = Date.now()
  state.lastAttempt = started
  state.status = 'running'
  state.error = null
  try {
    const names = new Map<string, string>()
    const tickers = await getTickers(names)
    state.universeSize = tickers.length
    const histories = await mapPool(tickers, CONCURRENCY, async (ticker) => ({ ticker, data: await fetchDailyBars(ticker) }))
    const usable = histories.filter((entry) => entry.data)
    if (!usable.length) throw new Error('No price data returned (network or rate limit).')

    const reasons: Rejections = { insufficient_history: 0, illiquid: 0, monthly_gains: 0, ma_alignment: 0, market_structure: 0, drawdown: 0 }
    const ranked: MarketRow[] = usable
      .map(({ ticker, data }) => {
        const row = analyze(ticker, data!.bars, reasons)
        return row && { ...row, Company: names.get(ticker) || data!.name || rootOf(ticker) }
      })
      .filter((row): row is MarketRow => row !== null)
      .sort((a, b) => b['Months Up'] - a['Months Up'] || b['6M Return %'] - a['6M Return %'])
    const consistent = ranked.filter((row) => row['Months Up'] === MONTHS)
    const rows = EXCHANGES.flatMap((exchange) => consistent.filter((row) => row.Exchange === exchange).slice(0, RESULT_LIMIT_PER_EXCHANGE))
    await addHourlyTrends(rows)

    state.rows = rows
    state.rejections = reasons
    state.analyzed = usable.length
    state.lastRun = new Date().toISOString()
    state.liveUpdated = state.lastRun
    state.liveCheckedAt = Date.now()
    state.runCount++
    state.status = 'ok'
  } catch (error) {
    console.error('ShareMarket scan failed:', error)
    state.status = 'error'
    state.error = errorMessage(error)
  } finally {
    state.durationSec = round2((Date.now() - started) / 1000)
  }
  if (state.status === 'ok') await saveCache()
}

async function refreshLiveQuotes() {
  const tickers = state.rows.map((row) => row.Ticker)
  try {
    const quotes = await mapPool(tickers, CONCURRENCY, async (ticker) => {
      const result = await fetchChart(ticker, 'range=1d&interval=1m')
      const closes = result?.indicators?.quote?.[0]?.close ?? []
      const intradayPrice = [...closes].reverse().find((value): value is number => value != null && Number.isFinite(value))
      return { ticker, meta: result?.meta, price: intradayPrice }
    })
    let updated = 0
    for (const { ticker, meta, price: intradayPrice } of quotes) {
      const price = intradayPrice ?? meta?.regularMarketPrice
      const previous = meta?.previousClose ?? meta?.chartPreviousClose
      const row = state.rows.find((candidate) => candidate.Ticker === ticker)
      if (!row || !price || !previous) continue
      const change = (price / previous - 1) * 100
      row.Price = round2(price)
      row['Today %'] = round2(change)
      row['Today Status'] = change >= 0 ? 'Gain' : 'Loss'
      updated++
    }
    if (!updated) throw new Error('No displayed ticker returned a live quote.')
    state.liveUpdated = new Date().toISOString()
    state.liveError = null
  } catch (error) {
    state.liveError = errorMessage(error)
  } finally {
    state.liveCheckedAt = Date.now()
  }
}

function startScan() {
  state.scan ??= runScan().finally(() => { state.scan = null })
  return state.scan
}

function scanDue() {
  if (!state.lastAttempt) return true
  return Date.now() - state.lastAttempt > (state.status === 'error' ? ERROR_RETRY_MS : SCAN_INTERVAL_MINUTES * 60_000)
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return round2(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2)
}

function snapshot(): MarketSnapshot {
  const byExchange: Record<string, number> = {}
  for (const row of state.rows) byExchange[row.Exchange] = (byExchange[row.Exchange] ?? 0) + 1
  return {
    status: state.scan ? 'running' : state.status,
    rows: state.rows,
    columns: [...DISPLAY_COLUMNS],
    rejections: state.rejections,
    error: state.error,
    last_run: state.lastRun,
    next_run: state.lastAttempt ? new Date(state.lastAttempt + SCAN_INTERVAL_MINUTES * 60_000).toISOString() : null,
    duration_sec: state.durationSec,
    universe_size: state.universeSize,
    analyzed: state.analyzed,
    run_count: state.runCount,
    live_updated: state.liveUpdated,
    live_error: state.liveError,
    match_count: state.rows.length,
    by_exchange: byExchange,
    median_return: median(state.rows.map((row) => row['6M Return %'])),
    median_drawdown: median(state.rows.map((row) => row['Max Drawdown %']).filter((value) => typeof value === 'number')),
    universe: `${EXCHANGES.join(' + ')} (first ${UNIVERSE_LIMIT} each)`,
    months: MONTHS,
    scan_interval_minutes: SCAN_INTERVAL_MINUTES,
    live_interval_seconds: LIVE_INTERVAL_SECONDS,
  }
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  await loadCache()
  if (scanDue()) {
    const scan = startScan()
    if (!state.rows.length) await scan
  } else if (state.scan && !state.rows.length) {
    await state.scan
  }
  if (state.rows.length && !state.scan && Date.now() - state.liveCheckedAt > LIVE_INTERVAL_SECONDS * 1000) {
    state.live ??= refreshLiveQuotes().finally(() => { state.live = null })
    await state.live
  }
  return snapshot()
}

export async function requestRescan(): Promise<{ triggered: boolean; reason?: string; snapshot: MarketSnapshot }> {
  await loadCache()
  if (state.scan) return { triggered: false, reason: 'scan already running', snapshot: snapshot() }
  if (Date.now() - state.lastAttempt < MIN_MANUAL_RESCAN_MS) {
    return { triggered: false, reason: 'scan ran recently; try again in a couple of minutes', snapshot: snapshot() }
  }
  await startScan()
  return { triggered: true, snapshot: snapshot() }
}
