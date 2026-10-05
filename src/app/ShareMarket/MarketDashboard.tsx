'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import type { MarketRow, MarketSnapshot, TrendPayload } from '@/lib/sharemarket'
import styles from './sharemarket.module.css'

type Period = 'hour' | 'week' | 'month'
type Series = { name: string; values: (number | null)[]; color: string; width?: number }

const SERIES_COLORS = ['#4da3ff', '#2ecc71', '#ffb020', '#ff6b6b', '#c58bff', '#40e0d0', '#ff9f43', '#7bed9f', '#f78fb3', '#70a1ff']
const TEXT_COLUMNS = ['Ticker', 'Company', 'Exchange', 'Today Status']
const PERIODS: { key: Period; label: string }[] = [{ key: 'hour', label: 'Hourly' }, { key: 'week', label: 'Weekly' }, { key: 'month', label: 'Monthly' }]

const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Share market service unavailable')
  return response.json() as Promise<MarketSnapshot>
}

const isNumeric = (column: string) => !TEXT_COLUMNS.includes(column)
const cellValue = (row: MarketRow, column: string) => row[column as keyof MarketRow] as string | number | null

function formatCell(column: string, value: string | number | null) {
  if (value === null || value === undefined) return '—'
  if (typeof value !== 'number') return value
  return column.includes('%') ? `${value.toFixed(2)}%` : value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function aggregateTrend(trend: TrendPayload, period: Period, livePrice?: number) {
  if (period === 'hour') return { labels: trend.hourly?.dates ?? [], values: trend.hourly?.close ?? [] as (number | null)[] }
  const closes = trend.close.slice()
  if (livePrice != null && closes.length) closes[closes.length - 1] = livePrice
  const buckets: { label: string; value: number | null }[] = []
  const seen = new Map<string, number>()
  trend.dates.forEach((date, index) => {
    let key: string
    let label: string
    if (period === 'week') {
      const day = new Date(`${date}T00:00:00Z`)
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
      key = day.toISOString().slice(0, 10)
      label = `Wk ${key}`
    } else {
      key = date.slice(0, 7)
      label = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    }
    const existing = seen.get(key)
    if (existing === undefined) { seen.set(key, buckets.length); buckets.push({ label, value: closes[index] }) }
    else buckets[existing].value = closes[index]
  })
  return { labels: buckets.map((bucket) => bucket.label), values: buckets.map((bucket) => bucket.value) }
}

function scaler(min: number, max: number, low: number, high: number) {
  const span = (max - min) || 1
  return (value: number) => high - ((value - min) / span) * (high - low)
}

function pathFrom(values: (number | null)[], x: (index: number) => number, y: (value: number) => number) {
  let path = ''
  let pen = false
  values.forEach((value, index) => {
    if (value === null) { pen = false; return }
    path += `${pen ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)} `
    pen = true
  })
  return path.trim()
}

function LineChart({ series, labels, height = 260 }: { series: Series[]; labels: string[]; height?: number }) {
  const width = 900
  const pad = { l: 46, r: 12, t: 12, b: 22 }
  const shown = series.filter((item) => item.values.some((value) => value !== null))
  if (!shown.length) return null
  const flat = shown.flatMap((item) => item.values).filter((value): value is number => value !== null)
  const padding = (Math.max(...flat) - Math.min(...flat)) * 0.06 || 1
  const min = Math.min(...flat) - padding
  const max = Math.max(...flat) + padding
  const count = shown[0].values.length
  const x = (index: number) => pad.l + (index / Math.max(1, count - 1)) * (width - pad.l - pad.r)
  const y = scaler(min, max, pad.t, height - pad.b)
  return (
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} height={height} preserveAspectRatio="none">
      {[0, 1, 2, 3, 4].map((step) => {
        const value = min + (max - min) * step / 4
        return <g key={step}><line className={styles.gridLine} x1={pad.l} x2={width - pad.r} y1={y(value)} y2={y(value)} /><text x={4} y={y(value) + 3}>{value.toFixed(0)}</text></g>
      })}
      <line className={styles.axis} x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} />
      {Array.from(new Set([0, Math.floor(count / 2), count - 1])).map((index) => labels[index] && <text key={index} x={x(index)} y={height - 6} textAnchor="middle">{labels[index]}</text>)}
      {shown.map((item) => <path key={item.name} d={pathFrom(item.values, x, y)} fill="none" stroke={item.color} strokeWidth={item.width ?? 1.6} strokeLinejoin="round" />)}
    </svg>
  )
}

function BarChart({ labels, values }: { labels: string[]; values: number[] }) {
  const width = 380
  const height = 240
  const pad = { l: 40, r: 10, t: 12, b: 40 }
  if (!values.length) return null
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const padding = (max - min) * 0.15 || 1
  const y = scaler(min - padding, max + padding, pad.t, height - pad.b)
  const barWidth = (width - pad.l - pad.r) / values.length
  return (
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} height={height} preserveAspectRatio="none">
      <line className={styles.axis} x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} />
      {values.map((value, index) => {
        const left = pad.l + index * barWidth + barWidth * 0.18
        const w = barWidth * 0.64
        const top = Math.min(y(value), y(0))
        const center = left + w / 2
        return (
          <g key={index}>
            <rect x={left} y={top} width={w} height={Math.max(1.5, Math.abs(y(value) - y(0)))} rx={2} fill={value >= 0 ? '#2ecc71' : '#ff6b6b'} />
            <text x={center} y={top - 4} textAnchor="middle">{value.toFixed(1)}</text>
            <text x={center} y={height - 22} textAnchor="middle" transform={`rotate(-40 ${center} ${height - 22})`}>{labels[index] ?? ''}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const clean = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (clean.length < 2) return <span>—</span>
  const min = Math.min(...clean)
  const span = (Math.max(...clean) - min) || 1
  const width = 112
  const height = 30
  const pad = 2
  const points = values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) return null
    const x = pad + index / Math.max(1, values.length - 1) * (width - pad * 2)
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).filter(Boolean).join(' ')
  return <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} aria-label="trend sparkline"><polyline points={points} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export default function MarketDashboard() {
  const { data, error, mutate } = useSWR('/api/sharemarket', fetcher, { refreshInterval: 30_000, revalidateOnFocus: false })
  const [sortKey, setSortKey] = useState('6M Return %')
  const [sortDesc, setSortDesc] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [period, setPeriod] = useState<Period>('hour')
  const [rescanning, setRescanning] = useState(false)
  const [notice, setNotice] = useState('')

  const rows = useMemo(() => (data?.rows ?? []).slice().sort((a, b) => {
    const left = cellValue(a, sortKey)
    const right = cellValue(b, sortKey)
    const order = isNumeric(sortKey) ? Number(left ?? 0) - Number(right ?? 0) : String(left).localeCompare(String(right))
    return sortDesc ? -order : order
  }), [data?.rows, sortKey, sortDesc])

  const selectedRow = rows.find((row) => row.Ticker === selected) ?? rows[0]
  const status = error ? 'offline' : data?.status ?? 'idle'
  const running = status === 'running' || rescanning

  const sortBy = (column: string) => {
    if (column === sortKey) setSortDesc(!sortDesc)
    else { setSortKey(column); setSortDesc(true) }
  }

  const rescan = async () => {
    setRescanning(true)
    setNotice('')
    try {
      const response = await fetch('/api/sharemarket', { method: 'POST' })
      const payload = await response.json() as { triggered: boolean; reason?: string; snapshot: MarketSnapshot }
      if (!payload.triggered && payload.reason) setNotice(payload.reason)
      await mutate(payload.snapshot, { revalidate: false })
    } catch {
      setNotice('Rescan failed. Please try again.')
    } finally {
      setRescanning(false)
    }
  }

  const comparative = useMemo(() => {
    const withTrend = rows.filter((row) => row.Trend?.close?.length)
    const series = withTrend.map((row, index) => {
      const points = aggregateTrend(row.Trend, period, row.Price)
      const first = points.values.find((value): value is number => value !== null && value > 0) ?? 1
      return {
        name: row.Ticker,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        values: hidden.has(row.Ticker) ? points.values.map(() => null) : points.values.map((value) => (value === null ? null : value / first * 100)),
      }
    })
    const labels = withTrend[0] ? aggregateTrend(withTrend[0].Trend, period, withTrend[0].Price).labels : []
    return { series, labels }
  }, [rows, period, hidden])

  const toggleHidden = (ticker: string) => setHidden((current) => {
    const next = new Set(current)
    if (next.has(ticker)) next.delete(ticker)
    else next.add(ticker)
    return next
  })

  const dotClass = status === 'running' ? styles.dotRunning : status === 'ok' ? styles.dotOk : status === 'error' || status === 'offline' ? styles.dotError : ''
  const statusText = { running: 'scanning…', error: 'scan failed', ok: 'up to date', idle: 'waiting', offline: 'server offline' }[status]
  const lastUpdated = data?.live_updated
    ? new Date(data.live_updated).toLocaleString('en-IN', { timeStyle: 'medium' })
    : data?.last_run ? new Date(data.last_run).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'
  const columns = data?.columns ?? []

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.back} href="/">← அறத்தமிழ்</a>
        <div>
          <h1>Share Market · Top 10 Consistent Monthly Gainers</h1>
          <div className={styles.sub}>{data?.universe ?? 'NSE + BSE'} · positive returns in each of the last {data?.months ?? 6} months</div>
        </div>
        <div className={styles.spacer} />
        <div className={styles.pill}><span className={`${styles.dot} ${dotClass}`} />{statusText}</div>
        <div className={styles.pill}>live refresh <strong>{data?.live_interval_seconds ?? 30} sec</strong></div>
        <button className={styles.button} onClick={rescan} disabled={running}>{running ? 'Scanning…' : 'Rescan market'}</button>
      </header>

      <main className={styles.main}>
        <div className={styles.cards}>
          <div className={styles.card}><div className={styles.label}>Companies</div><div className={styles.value}>{data?.match_count ?? '—'}</div></div>
          <div className={styles.card}><div className={styles.label}>By Exchange</div><div className={`${styles.value} ${styles.valueSmall}`}>{data && Object.keys(data.by_exchange).length ? Object.entries(data.by_exchange).map(([exchange, count]) => `${exchange} ${count}`).join('  ·  ') : '—'}</div></div>
          <div className={styles.card}><div className={styles.label}>Median Return</div><div className={styles.value}>{data?.median_return == null ? '—' : `${data.median_return.toFixed(2)}%`}</div></div>
          <div className={styles.card}><div className={styles.label}>Median Max DD</div><div className={styles.value}>{data?.median_drawdown == null ? '—' : `${data.median_drawdown.toFixed(2)}%`}</div></div>
          <div className={styles.card}><div className={styles.label}>Analyzed</div><div className={styles.value}>{data?.analyzed ? `${data.analyzed} / ${data.universe_size}` : '—'}</div></div>
          <div className={styles.card}><div className={styles.label}>Live Updated</div><div className={`${styles.value} ${styles.valueSmall}`}>{lastUpdated}</div></div>
        </div>

        {notice && <div className={styles.err}>{notice}</div>}
        {error && <div className={styles.err}>Share market service is unavailable. Please try again shortly.</div>}
        {data?.status === 'error' && data.error && <div className={styles.err}>Scan error: {data.error}</div>}

        {!rows.length ? (
          <div className={styles.empty}>{!data || running ? 'Scanning the market — the first run can take a minute or two.' : 'No stocks passed all filters in the latest scan.'}</div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>#</th>
                    {columns.map((column) => <th key={column} onClick={() => sortBy(column)}>{column}{column === sortKey ? (sortDesc ? ' ▼' : ' ▲') : ''}</th>)}
                    {PERIODS.map((item) => <th key={item.key} className={styles.sparkHead}>{item.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.Ticker} className={row.Ticker === selectedRow?.Ticker ? styles.selected : undefined} onClick={() => setSelected(row.Ticker)}>
                      <td className={styles.rank}>{index + 1}</td>
                      {columns.map((column) => {
                        const value = cellValue(row, column)
                        if (column === 'Exchange') return <td key={column}><span className={`${styles.tag} ${value === 'BSE' ? styles.tagBse : ''}`}>{value}</span></td>
                        if (column === 'Today Status') return <td key={column} className={value === 'Gain' ? styles.pos : value === 'Loss' ? styles.neg : ''}>{value}</td>
                        const tone = isNumeric(column) && column.includes('%') && typeof value === 'number' ? (value >= 0 ? styles.pos : styles.neg) : ''
                        return <td key={column} className={tone}>{formatCell(column, value)}</td>
                      })}
                      {PERIODS.map((item, periodIndex) => (
                        <td key={item.key} className={styles.sparkCell} onClick={(event) => { event.stopPropagation(); setSelected(row.Ticker); setPeriod(item.key) }}>
                          <Sparkline values={aggregateTrend(row.Trend, item.key, row.Price).values} color={SERIES_COLORS[periodIndex]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedRow?.Trend && (
              <div className={styles.charts}>
                <div className={styles.panel}>
                  <h2>{selectedRow.Company} ({selectedRow.Ticker}) — {selectedRow.Exchange}</h2>
                  <div className={styles.hint}>Daily close with 20 / 50 / 100-day SMA overlays.</div>
                  <LineChart height={240} labels={selectedRow.Trend.dates} series={[
                    { name: 'Close', values: selectedRow.Trend.close, color: '#4da3ff', width: 2 },
                    { name: 'SMA20', values: selectedRow.Trend.sma20, color: '#2ecc71' },
                    { name: 'SMA50', values: selectedRow.Trend.sma50, color: '#ffb020' },
                    { name: 'SMA100', values: selectedRow.Trend.sma100, color: '#ff6b6b' },
                  ]} />
                  <div className={styles.legend}>
                    {[['Close', '#4da3ff'], ['SMA 20', '#2ecc71'], ['SMA 50', '#ffb020'], ['SMA 100', '#ff6b6b']].map(([name, color]) => <span key={name} className={styles.legendItem}><i style={{ background: color }} />{name}</span>)}
                  </div>
                </div>
                <div className={styles.panel}>
                  <h2>Monthly returns</h2>
                  <div className={styles.hint}>Each of the last {data?.months ?? 6} months must close green for the stock to qualify.</div>
                  <BarChart labels={selectedRow.Trend.months} values={selectedRow.Trend.monthly_returns} />
                </div>
              </div>
            )}

            <div className={styles.panel}>
              <h2>Comparative trend — rebased to 100</h2>
              <div className={styles.hint}>Click a row trend graph to switch this chart to hourly, weekly, or monthly points. Click a legend entry to toggle a stock.</div>
              <div className={styles.controls}>
                {PERIODS.map((item) => <button key={item.key} className={period === item.key ? styles.active : ''} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
              </div>
              <LineChart height={280} labels={comparative.labels} series={comparative.series} />
              <div className={styles.legend}>
                {comparative.series.map((item) => <button key={item.name} className={`${styles.legendItem} ${hidden.has(item.name) ? styles.legendOff : ''}`} onClick={() => toggleHidden(item.name)}><i style={{ background: item.color }} />{item.name}</button>)}
              </div>
            </div>
          </>
        )}

        {data && Object.keys(data.rejections).length > 0 && (
          <div className={styles.rej}>Scan diagnostics — {Object.entries(data.rejections).map(([reason, count]) => <span key={reason}><b>{count}</b> {reason.replace(/_/g, ' ')}</span>)}</div>
        )}
      </main>

      <footer className={styles.footer}>
        Prices and Today Gain/Loss refresh every {data?.live_interval_seconds ?? 30} seconds. The full market selection refreshes every {data?.scan_interval_minutes ?? 30} minutes. Data via Yahoo Finance · informational use only, not investment advice.
      </footer>
    </div>
  )
}
