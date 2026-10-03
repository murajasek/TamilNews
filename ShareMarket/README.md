# Share Market — Indian Market Continuous Uptrend Scanner (NSE + BSE)

Copied from PortfoliUp. Linked from the Tamil News home page footer (**ShareMarket**).

```bash
cd ShareMarket
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py      # http://127.0.0.1:8766
```

Scans the **NIFTY 500** and **BSE group-A** equities for stocks with positive
returns in each of the last 6 months. The browser dashboard displays the top 10
by six-month return, including a live Today Gain/Loss status and trend charts.
The CLI retains the stricter three-filter structural-uptrend model.

## Files

| File | Purpose |
|---|---|
| `nse_uptrend_scanner.py` | Scanning engine + CLI report |
| `app.py` | Flask dashboard, background scheduler, JSON API |
| `templates/index.html` | Single-page front end (no build step) |
| `scan_cache.json` | Auto-generated cache of the last successful scan |

## Install

```bash
pip install yfinance pandas numpy tqdm requests flask
pip install scipy scikit-learn plotly   # optional: price repair + Plotly table
```

## Web dashboard

```bash
python app.py                              # NSE + BSE, refresh every 30 min
python app.py --interval 15                # refresh every 15 minutes
python app.py --live-interval 30            # live prices every 30 seconds
python app.py --limit 100 --interval 5     # faster demo mode
python app.py --exchanges NSE              # NSE only
python app.py --host 0.0.0.0 --port 8000   # expose on the LAN
```

Open <http://127.0.0.1:8766>.

**How refreshing works.** One daemon thread performs the expensive full-universe
selection on the configured minute interval. A separate thread refreshes the 10
displayed prices and their Today Gain/Loss status every 30 seconds; the browser
polls `/api/results` on the same cadence. Scans never run inside a request
handler. Results are mirrored to `scan_cache.json`, so a restart can show the
previous scan immediately.

Dashboard features: Today % and Gain/Loss, live-update timestamp, on-demand
**Rescan market** (returns HTTP 409 if a scan is already running), sortable
columns, summary cards, per-exchange counts, exchange tags, and scan diagnostics.

### Charts

Three hand-rolled inline-SVG charts (no chart library, no CDN — the dashboard
works fully offline):

1. **Comparative trend** — shown below the table, every match on one axis, each
   series rebased to 100 at the start of the window. The chart updates with live
   prices and can be switched between daily, weekly, and monthly points. Rebasing
   lets a ₹961 stock and a ₹23,000 stock share an axis, so you compare *relative
   momentum* rather than rupees. Click a legend entry to toggle that line.
2. **Price + moving averages** — the selected stock's close with its 20/50/100-day
   SMAs for additional trend-strength context.
3. **Monthly returns** — bar chart of the six month-over-month returns.

Click any table row to load charts 2 and 3 for that stock.

### API

| Endpoint | Method | Description |
|---|---|---|
| `/api/results` | GET | Full snapshot: rows, columns, stats, timestamps |
| `/api/refresh` | POST | Trigger an out-of-band scan (409 if already running) |
| `/api/health` | GET | Status and last run time |

## CLI

```bash
python nse_uptrend_scanner.py
python nse_uptrend_scanner.py --exchanges NSE,BSE          # add BSE coverage
python nse_uptrend_scanner.py --bse-groups A,B             # widen the BSE universe
python nse_uptrend_scanner.py --keep-bse-duplicates        # don't drop dual-listed twins
python nse_uptrend_scanner.py --limit 60 --csv out.csv
python nse_uptrend_scanner.py --no-higher-highs --min-monthly-return -1   # relax
```

The CLI defaults to `NSE`; the dashboard defaults to `NSE,BSE`.

## Universe and de-duplication

| Source | Count |
|---|---|
| NIFTY 500 (`.NS`) | 501 |
| BSE group A (`.BO`) | 698 |
| Dual-listed, dropped | 477 |
| **Unique tickers scanned** | **722** |

477 BSE group-A names are already in the NIFTY 500. By default the `.BO` twin is
dropped (`prefer_nse`) because NSE has deeper history and higher volume on Yahoo —
without this you would count the same company twice. Pass
`--keep-bse-duplicates` to retain both.

BSE groups: **A** (liquid large caps, the default), **B** (~1828, mostly
illiquid), **X** (~1136). T and Z are trade-to-trade/surveillance and are always
excluded.

## Filter logic

A stock must pass **all three** filters:

1. **Consecutive monthly gains** — positive month-over-month close return in each
   of the last 6 months. Trend persistence in the *time* domain.
2. **Moving-average alignment** — `Price > SMA20 > SMA50 > SMA100`. Stacking (not
   merely "above the MAs") is what distinguishes a trend from a bounce.
3. **Higher highs & higher lows** — strictly rising monthly highs *and* lows
   (Dow-theory market structure). Rising lows prove each pullback is bought higher.

Plus a liquidity floor (60-day average volume) and an optional max-drawdown cap.

## Reported metrics

Ticker, company name, price, 6-month return, geometric-mean monthly return
(compounding-correct), worst month, % below the 52-week high, and maximum
drawdown — `min(P / cummax(P) − 1)`, the worst peak-to-trough loss endured.

## Notes

- yfinance requires the `.NS` suffix for NSE symbols; the tool adds it automatically.
- **BSE gotcha:** Yahoo indexes BSE stocks by the *alphabetic* `scrip_id` + `.BO`
  (e.g. `TCS.BO`), **not** the numeric scrip code — `500325.BO` returns zero rows.
  The tool maps codes to scrip IDs via the BSE scrip master.
- BSE history on Yahoo is patchy (e.g. `RELIANCE.BO` returns ~2 usable rows while
  `TCS.BO` returns ~396). The `insufficient_history` filter absorbs this; expect a
  few dozen such rejections in a combined run.
- Downloads are batched with exponential backoff to respect Yahoo rate limits, and
  use `auto_adjust=True` — essential for Indian splits and bonus issues.
- The constituent list is fetched live from NSE archives, with a mirror and a
  built-in fallback list if NSE is unreachable.
- Company names come from the NSE constituent CSV / BSE scrip master rather than
  yfinance's `quoteSummary`, which is faster and avoids environments where that
  endpoint is blocked.
- Six unbroken monthly gains is genuinely rare; a handful of matches out of 700+ is
  the expected outcome. Relax with `--no-higher-highs` or `--min-monthly-return -1`.
- Timing: NSE-only ≈225s; NSE+BSE (722 tickers) ≈530s.

*Informational use only — not investment advice.*
