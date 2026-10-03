"""
NSE Continuous Uptrend Scanner
==============================

Scans the NIFTY 500 universe for stocks in a *structurally* continuous uptrend
over the last 6 months, using three independent, complementary filters:

    1. Consecutive Monthly Gains  -> trend persistence in the time domain
    2. Moving Average Alignment   -> trend persistence in the price domain
    3. Higher Highs / Higher Lows -> Dow-Theory market structure

Only stocks passing ALL filters are reported, together with risk metrics
(max drawdown, distance from 52-week high).

Usage
-----
    python nse_uptrend_scanner.py
    python nse_uptrend_scanner.py --months 6 --limit 100 --csv out.csv
    python nse_uptrend_scanner.py --min-monthly-return 1.0 --no-plotly

Requires: yfinance, pandas, numpy, tqdm, requests (plotly optional).
"""

from __future__ import annotations

import argparse
import io
import logging
import sys
import time
import warnings
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from tqdm import tqdm

warnings.filterwarnings("ignore", category=FutureWarning)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("nse-scanner")

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

NIFTY500_CSV_URLS = (
    "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
    "https://archives.nseindia.com/content/indices/ind_nifty500list.csv",
)

# BSE's public scrip master. Returns every listed equity with its group rating;
# we keep only the liquid, institutionally-traded groups by default.
BSE_SCRIP_LIST_URL = (
    "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
    "?Group=&Scripcode=&industry=&segment=Equity&status=Active"
)
# BSE group ratings by liquidity/compliance: A = most liquid large caps,
# B = mainstream, M/MT = SME. T/Z/X are trade-to-trade or penalty groups.
BSE_DEFAULT_GROUPS = ("A",)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# NSE blocks non-browser user agents; a realistic header set is required.
HTTP_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/csv,application/csv,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

BSE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.bseindia.com/",
}

# Offline fallback: liquid large/mid caps, used only when NSE is unreachable.
FALLBACK_TICKERS: tuple[str, ...] = (
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK", "ASIANPAINT", "MARUTI",
    "BAJFINANCE", "HCLTECH", "SUNPHARMA", "TITAN", "ULTRACEMCO", "WIPRO",
    "NESTLEIND", "ONGC", "NTPC", "POWERGRID", "TATAMOTORS", "TATASTEEL", "JSWSTEEL",
    "ADANIENT", "ADANIPORTS", "COALINDIA", "GRASIM", "HINDALCO", "DRREDDY",
    "CIPLA", "DIVISLAB", "BRITANNIA", "EICHERMOT", "HEROMOTOCO", "BAJAJ-AUTO",
    "M&M", "TECHM", "INDUSINDBK", "SBILIFE", "HDFCLIFE", "BPCL", "APOLLOHOSP",
    "TATACONSUM", "SHRIRAMFIN", "TRENT", "BEL", "DMART", "PIDILITIND", "SIEMENS",
    "LTIM", "VBL", "ZOMATO", "IRCTC", "CGPOWER", "POLYCAB", "PERSISTENT",
    "MAZDOCK", "HAL", "BSE", "SUZLON", "DIXON", "KAYNES", "AMBUJACEM",
)

TRADING_DAYS_PER_YEAR = 252
SMA_WINDOWS = (20, 50, 100)

# Symbol -> company name, populated from the NSE constituent CSV.
_NAME_CACHE: dict[str, str] = {}

# yfinance's price-repair pass (fixes bad splits / 100x currency glitches that are
# common in NSE feeds) depends on scipy + scikit-learn. Enable it only if both exist.
try:
    import scipy  # noqa: F401
    import sklearn  # noqa: F401
    REPAIR_PRICES = True
except ImportError:  # pragma: no cover
    REPAIR_PRICES = False


# --------------------------------------------------------------------------- #
# Result container
# --------------------------------------------------------------------------- #

@dataclass
class ScanConfig:
    """Tunable thresholds for the scan."""
    months: int = 6
    min_monthly_return_pct: float = 0.0   # each month must beat this (%)
    max_drawdown_pct: float = 100.0       # reject if drawdown worse than this (%)
    min_avg_volume: float = 50_000        # liquidity floor (shares/day)
    limit: int | None = None              # cap universe size (for quick runs)
    batch_size: int = 60
    require_higher_highs: bool = True
    lookback_days: int = 400              # enough history for 100-SMA + 52w high
    exchanges: tuple[str, ...] = ("NSE",)  # any of "NSE", "BSE"
    bse_groups: tuple[str, ...] = BSE_DEFAULT_GROUPS
    prefer_nse: bool = True               # drop the .BO twin of a dual-listed name
    history_points: int = 130             # daily closes kept for the trend chart
    rejection_reasons: dict[str, int] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# 1. Universe
# --------------------------------------------------------------------------- #

def get_nse_tickers(timeout: int = 15) -> list[str]:
    """
    Fetch the NIFTY 500 constituent list from NSE archives.

    Falls back to a curated liquid-stock list if NSE is unreachable
    (corporate proxies / rate limits / weekend maintenance).
    Returns yfinance-compatible symbols (".NS" suffix) and populates the
    module-level company-name cache as a side effect.
    """
    symbols: list[str] = []
    for url in NIFTY500_CSV_URLS:
        try:
            resp = requests.get(url, headers=HTTP_HEADERS, timeout=timeout)
            resp.raise_for_status()
            frame = pd.read_csv(io.StringIO(resp.text))
            if "Symbol" not in frame.columns:
                raise ValueError(f"unexpected columns: {list(frame.columns)}")
            symbols = frame["Symbol"].dropna().astype(str).str.strip().tolist()
            # The NSE file ships company names - cache them so we never depend on
            # Yahoo's frequently rate-limited /quoteSummary endpoint.
            if "Company Name" in frame.columns:
                for sym, name in zip(symbols, frame["Company Name"].astype(str)):
                    _NAME_CACHE[f"{sym.replace(' ', '')}.NS"] = name.strip()
            log.info("Fetched %d NIFTY 500 constituents from NSE.", len(symbols))
            break
        except Exception as exc:  # network, HTTP, parse errors
            log.warning("Ticker source failed (%s): %s", url.split("/")[2], exc)

    if not symbols:
        log.warning("Falling back to built-in list of %d liquid NSE names.",
                    len(FALLBACK_TICKERS))
        symbols = list(FALLBACK_TICKERS)

    # yfinance uses '-' where NSE uses '&' in a few symbols (e.g. M&M -> M&M.NS is fine),
    # but spaces and stray characters must go.
    cleaned = sorted({s.replace(" ", "") for s in symbols if s})
    return [f"{s}.NS" for s in cleaned]


def get_bse_tickers(groups: Sequence[str] = BSE_DEFAULT_GROUPS,
                    timeout: int = 25) -> list[str]:
    """
    Fetch active BSE equities from the BSE scrip master, filtered by group.

    Yahoo indexes BSE stocks by their *alphabetic* scrip_id plus ".BO"
    (e.g. "TCS.BO") - NOT by the numeric scrip code, which returns no data.
    Group "A" is the liquid, institutionally-traded tier; T/Z/X are
    trade-to-trade or surveillance groups and are excluded by default.
    """
    try:
        resp = requests.get(BSE_SCRIP_LIST_URL, headers=BSE_HEADERS, timeout=timeout)
        resp.raise_for_status()
        frame = pd.DataFrame(resp.json())
    except Exception as exc:
        log.warning("BSE scrip list unavailable: %s", exc)
        return []

    if frame.empty or "scrip_id" not in frame.columns:
        log.warning("BSE scrip list had an unexpected shape; skipping BSE.")
        return []

    if groups:
        wanted = {g.upper() for g in groups}
        frame = frame[frame["GROUP"].astype(str).str.strip().str.upper().isin(wanted)]

    frame = frame[frame["scrip_id"].notna()]
    tickers: list[str] = []
    for _, row in frame.iterrows():
        symbol = str(row["scrip_id"]).strip().replace(" ", "")
        if not symbol:
            continue
        ticker = f"{symbol}.BO"
        tickers.append(ticker)
        # BSE names carry suffixes like "-$" for corporate-action flags; strip them.
        name = str(row.get("Issuer_Name") or row.get("Scrip_Name") or symbol).strip()
        _NAME_CACHE[ticker] = name.rstrip("-$ ").strip()

    log.info("Fetched %d BSE equities (groups: %s).", len(tickers), ", ".join(groups))
    return sorted(set(tickers))


def get_tickers(limit: int | None = None, timeout: int = 15,
                exchanges: Sequence[str] = ("NSE",),
                bse_groups: Sequence[str] = BSE_DEFAULT_GROUPS,
                prefer_nse: bool = True) -> list[str]:
    """
    Build the scan universe across the requested exchanges.

    Most large Indian companies are dual-listed on NSE and BSE. When both are
    requested, `prefer_nse` drops the ".BO" twin of any symbol already present
    as ".NS" - NSE carries far deeper Yahoo history and higher volume, so the
    duplicate would only waste a download slot and double-count the result.
    """
    wanted = [e.strip().upper() for e in exchanges]
    nse_tickers: list[str] = []
    bse_tickers: list[str] = []

    if "NSE" in wanted:
        nse_tickers = get_nse_tickers(timeout=timeout)
    if "BSE" in wanted:
        bse_tickers = get_bse_tickers(groups=bse_groups, timeout=max(timeout, 25))
        if not bse_tickers and nse_tickers:
            bse_tickers = [f"{ticker[:-3]}.BO" for ticker in nse_tickers]
            log.warning("Using NSE symbols as a BSE Yahoo fallback (%d candidates).",
                        len(bse_tickers))
        if prefer_nse and "NSE" in wanted:
            nse_roots = {t[:-3] for t in nse_tickers}       # strip ".NS"
            before = len(bse_tickers)
            bse_tickers = [t for t in bse_tickers if t[:-3] not in nse_roots]
            log.info("Dropped %d BSE duplicates of NSE listings.", before - len(bse_tickers))

    if limit:
        nse_tickers = nse_tickers[:limit]
        bse_tickers = bse_tickers[:limit]
    tickers = nse_tickers + bse_tickers

    if not tickers:
        log.warning("No exchange returned tickers; using built-in NSE fallback.")
        tickers = [f"{s}.NS" for s in FALLBACK_TICKERS]

    return sorted(set(tickers))


# --------------------------------------------------------------------------- #
# 2. Data retrieval
# --------------------------------------------------------------------------- #

def _download_batch(batch: Sequence[str], period_days: int,
                    retries: int = 3) -> pd.DataFrame | None:
    """Download one batch with exponential backoff on rate limits/transient errors."""
    for attempt in range(1, retries + 1):
        try:
            data = yf.download(
                list(batch),
                period=f"{period_days}d",
                interval="1d",
                group_by="ticker",
                auto_adjust=True,      # adjust for splits/bonuses - critical in India
                actions=False,
                threads=True,
                progress=False,
                repair=REPAIR_PRICES,
            )
            if data is None or data.empty:
                raise ValueError("empty response")
            return data
        except Exception as exc:
            wait = 2 ** attempt          # 2s, 4s, 8s - respects Yahoo throttling
            if attempt == retries:
                log.error("Batch failed permanently (%d tickers): %s", len(batch), exc)
                return None
            log.warning("Batch error (%s); retrying in %ds ...", exc, wait)
            time.sleep(wait)
    return None


def download_data(tickers: Sequence[str], config: ScanConfig) -> dict[str, pd.DataFrame]:
    """
    Bulk-download OHLCV history in batches, returning {ticker: DataFrame}.

    Batching keeps each HTTP request small enough to avoid Yahoo's rate limiter
    while still being far faster than per-ticker requests.
    """
    frames: dict[str, pd.DataFrame] = {}
    batches = [tickers[i:i + config.batch_size]
               for i in range(0, len(tickers), config.batch_size)]

    for batch in tqdm(batches, desc="Downloading OHLCV", unit="batch"):
        raw = _download_batch(batch, config.lookback_days)
        if raw is None:
            continue

        for ticker in batch:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if ticker not in raw.columns.get_level_values(0):
                        continue
                    df = raw[ticker].copy()
                else:  # single-ticker batch -> flat columns
                    df = raw.copy()

                df = df.dropna(subset=["Close"])
                if df.empty:
                    continue
                frames[ticker] = df
            except Exception as exc:
                log.debug("Skipping %s: %s", ticker, exc)

        time.sleep(0.4)  # gentle pacing between batches

    log.info("Usable price histories: %d / %d tickers.", len(frames), len(tickers))
    return frames


def get_company_names(tickers: Iterable[str]) -> dict[str, str]:
    """
    Resolve company names: exchange-sourced cache first (NSE CSV / BSE scrip
    master), then a best-effort yfinance lookup, finally the bare symbol.
    Names are cosmetic - never fail the report over them.
    """
    names: dict[str, str] = {}
    for ticker in tickers:
        if ticker in _NAME_CACHE:
            names[ticker] = _NAME_CACHE[ticker]
            continue
        label = ticker.rsplit(".", 1)[0]
        try:
            info = yf.Ticker(ticker).get_info()
            label = info.get("longName") or info.get("shortName") or label
        except Exception:
            pass
        _NAME_CACHE[ticker] = label
        names[ticker] = label
    return names


def exchange_of(ticker: str) -> str:
    """Map a yfinance suffix back to its exchange label."""
    return "BSE" if ticker.upper().endswith(".BO") else "NSE"


def parse_exchanges(raw: str) -> tuple[str, ...]:
    """Parse a 'NSE,BSE' style string into a validated, de-duplicated tuple."""
    wanted = [e.strip().upper() for e in str(raw).split(",") if e.strip()]
    valid = [e for e in dict.fromkeys(wanted) if e in {"NSE", "BSE"}]
    if not valid:
        raise ValueError(f"No valid exchanges in {raw!r}; use NSE, BSE or NSE,BSE")
    return tuple(valid)


# --------------------------------------------------------------------------- #
# 3. Analysis primitives
# --------------------------------------------------------------------------- #

def _month_end_frame(df: pd.DataFrame, months: int) -> pd.DataFrame:
    """
    Resample daily bars into the last `months` completed-or-current calendar months.

    'ME' = month-end bins. We keep last close, and the month's true high/low,
    which is what the market-structure filter needs.
    """
    monthly = df.resample("ME").agg({"Close": "last", "High": "max", "Low": "min"})
    monthly = monthly.dropna()
    return monthly.tail(months)


def compute_max_drawdown(close: pd.Series) -> float:
    """
    Max drawdown = min( P_t / running_max(P_t) - 1 ), expressed in %.

    Measures the worst peak-to-trough loss an investor would have endured,
    i.e. the pain-tolerance cost of holding the trend.
    """
    running_peak = close.cummax()
    drawdown = close / running_peak - 1.0
    return float(drawdown.min() * 100.0)


def _passes_monthly_gains(monthly: pd.DataFrame, config: ScanConfig) -> tuple[bool, np.ndarray]:
    """Filter 1: month-over-month close return must be positive for every month."""
    # pct_change on month-end closes; first value is NaN, so we anchor on the
    # close of the month preceding the window (handled by the caller passing months+1).
    returns = monthly["Close"].pct_change().dropna().to_numpy() * 100.0
    ok = returns.size >= config.months and bool(
        np.all(returns[-config.months:] > config.min_monthly_return_pct)
    )
    return ok, returns[-config.months:]


def _passes_ma_alignment(df: pd.DataFrame) -> bool:
    """
    Filter 2: bullish stacked SMAs -> Price > SMA20 > SMA50 > SMA100.

    A rising price with compressed/inverted SMAs signals a bounce, not a trend;
    stacking guarantees each shorter horizon outperforms the longer one.
    """
    close = df["Close"]
    if len(close) < max(SMA_WINDOWS):
        return False
    sma = {w: close.rolling(w).mean().iloc[-1] for w in SMA_WINDOWS}
    if any(pd.isna(v) for v in sma.values()):
        return False
    price = float(close.iloc[-1])
    return price > sma[20] > sma[50] > sma[100]


def _passes_structure(monthly: pd.DataFrame) -> bool:
    """
    Filter 3: Dow-Theory market structure - strictly rising monthly lows,
    plus non-decreasing monthly highs (higher highs / higher lows).

    Rising lows prove every pullback is being bought at a higher level.
    """
    lows = monthly["Low"].to_numpy()
    highs = monthly["High"].to_numpy()
    higher_lows = bool(np.all(np.diff(lows) > 0))
    higher_highs = bool(np.all(np.diff(highs) > 0))
    return higher_lows and higher_highs


def build_trend_series(df: pd.DataFrame, monthly_window: pd.DataFrame,
                       monthly_returns: np.ndarray, points: int) -> dict[str, Any]:
    """
    Package the chart payload for one stock: a daily close line with its SMA
    overlays, a normalised (rebased to 100) series for cross-stock comparison,
    and the monthly return bars.

    Rebasing to 100 lets stocks priced at Rs.150 and Rs.23,000 share one axis -
    the chart then compares *relative* momentum rather than absolute rupees.
    """
    tail = df.tail(points)
    close = tail["Close"]
    smas = {w: df["Close"].rolling(w).mean().tail(points) for w in SMA_WINDOWS}
    base = float(close.iloc[0])

    def clean(series: pd.Series) -> list[float | None]:
        return [None if pd.isna(v) else round(float(v), 2) for v in series]

    return {
        "dates": [d.strftime("%Y-%m-%d") for d in tail.index],
        "close": clean(close),
        "sma20": clean(smas[20]),
        "sma50": clean(smas[50]),
        "sma100": clean(smas[100]),
        # Rebased index: (P_t / P_0) * 100
        "rebased": [None if pd.isna(v) else round(float(v) / base * 100.0, 2)
                    for v in close],
        "months": [d.strftime("%b %Y") for d in monthly_window.index],
        "monthly_returns": [round(float(v), 2) for v in monthly_returns],
    }


def analyze_trends(
    frames: dict[str, pd.DataFrame],
    config: ScanConfig,
    *,
    monthly_only: bool = False,
    limit: int | None = None,
) -> pd.DataFrame:
    """
    Apply the trend filters and build the metrics table for the survivors.

    Returns a DataFrame sorted by 6-month return (descending). Each row carries
    a "Trend" payload with the series needed to draw the chart. When
    ``monthly_only`` is true, monthly gains remain mandatory while moving-average
    alignment and market structure are recorded but do not reject a stock. This
    supports a broader "consistent monthly gainers" dashboard without weakening
    the strict CLI scanner.
    """
    rows: list[dict[str, object]] = []
    reasons: dict[str, int] = {
        "insufficient_history": 0, "illiquid": 0, "monthly_gains": 0,
        "ma_alignment": 0, "market_structure": 0, "drawdown": 0,
    }

    for ticker, df in tqdm(frames.items(), desc="Analyzing trends", unit="stock"):
        try:
            df = df.sort_index()
            if len(df) < max(max(SMA_WINDOWS), config.months * 21) + 5:
                reasons["insufficient_history"] += 1
                continue

            if "Volume" in df and float(df["Volume"].tail(60).mean() or 0) < config.min_avg_volume:
                reasons["illiquid"] += 1
                continue

            # months+1 buckets: the extra oldest month anchors the first MoM return.
            monthly_full = _month_end_frame(df, config.months + 1)
            if len(monthly_full) < config.months + 1:
                reasons["insufficient_history"] += 1
                continue
            monthly_window = monthly_full.tail(config.months)  # the 6 analysed months

            gains_ok, monthly_returns = _passes_monthly_gains(monthly_full, config)
            if not gains_ok:
                reasons["monthly_gains"] += 1
                continue

            if not _passes_ma_alignment(df):
                reasons["ma_alignment"] += 1
                if not monthly_only:
                    continue

            if config.require_higher_highs and not _passes_structure(monthly_window):
                reasons["market_structure"] += 1
                if not monthly_only:
                    continue

            # ---- metrics over the 6-month window -----------------------------
            window_start = monthly_full.index[-(config.months + 1)]
            window = df.loc[df.index > window_start]
            close = window["Close"]

            start_price = float(monthly_full["Close"].iloc[-(config.months + 1)])
            last_price = float(close.iloc[-1])
            total_return = (last_price / start_price - 1.0) * 100.0

            # Geometric mean monthly return: compounding-correct average.
            geo_avg = ((last_price / start_price) ** (1 / config.months) - 1.0) * 100.0

            max_dd = compute_max_drawdown(close)
            if max_dd < -abs(config.max_drawdown_pct):
                reasons["drawdown"] += 1
                continue

            high_52w = float(df["High"].tail(TRADING_DAYS_PER_YEAR).max())
            from_high = (last_price / high_52w - 1.0) * 100.0

            sma = {w: float(df["Close"].rolling(w).mean().iloc[-1]) for w in SMA_WINDOWS}

            rows.append({
                "Ticker": ticker,
                "Exchange": exchange_of(ticker),
                "Company": ticker.rsplit(".", 1)[0],
                "Price": round(last_price, 2),
                "6M Return %": round(total_return, 2),
                "Avg Monthly %": round(geo_avg, 2),
                "Worst Month %": round(float(monthly_returns.min()), 2),
                "vs 52W High %": round(from_high, 2),
                "Max Drawdown %": round(max_dd, 2),
                "SMA20": round(sma[20], 2),
                "SMA50": round(sma[50], 2),
                "SMA100": round(sma[100], 2),
                "Trend": build_trend_series(df, monthly_window, monthly_returns,
                                            config.history_points),
            })
        except Exception as exc:
            log.debug("Analysis failed for %s: %s", ticker, exc)

    config.rejection_reasons = reasons
    result = pd.DataFrame(rows)
    if not result.empty:
        result = result.sort_values("6M Return %", ascending=False).reset_index(drop=True)
        if limit is not None:
            result = result.head(limit)
        result.index += 1
    return result


# --------------------------------------------------------------------------- #
# 4. Reporting
# --------------------------------------------------------------------------- #

def generate_report(result: pd.DataFrame, config: ScanConfig,
                    csv_path: str | None = None, use_plotly: bool = True,
                    resolve_names: bool = True) -> None:
    """Print a formatted console table, optionally save CSV and show Plotly output."""
    print("\n" + "=" * 104)
    print(f"  INDIAN MARKET CONTINUOUS UPTREND SCAN  |  {date.today():%d %b %Y}  "
          f"|  {'+'.join(config.exchanges)}  |  window: last {config.months} months")
    print("=" * 104)

    if result.empty:
        print("\nNo stocks satisfied all filters.")
        print("Rejection breakdown:", config.rejection_reasons)
        print("Tip: relax with --no-higher-highs or --min-monthly-return -1\n")
        return

    if resolve_names:
        log.info("Resolving company names for %d matches ...", len(result))
        names = get_company_names(result["Ticker"])
        result = result.copy()
        result["Company"] = result["Ticker"].map(names)

    display_cols = ["Ticker", "Exchange", "Company", "Price", "6M Return %",
                    "Avg Monthly %", "Worst Month %", "vs 52W High %", "Max Drawdown %"]

    with pd.option_context("display.max_rows", None, "display.width", 220,
                           "display.max_colwidth", 30):
        print("\n" + result[display_cols].to_string())

    print("\n" + "-" * 104)
    by_exch = result["Exchange"].value_counts().to_dict()
    print(f"Matches: {len(result)} {by_exch}   |   "
          f"Median 6M return: {result['6M Return %'].median():.2f}%   |   "
          f"Median max drawdown: {result['Max Drawdown %'].median():.2f}%")
    print(f"Rejections: {config.rejection_reasons}")
    print("-" * 104 + "\n")

    if csv_path:
        # The Trend payload is a nested dict - useful in the UI, noise in a CSV.
        result.drop(columns=["Trend"], errors="ignore").to_csv(csv_path, index=False)
        log.info("Saved report -> %s", csv_path)

    if use_plotly:
        _plotly_report(result, config, display_cols)


def _plotly_report(result: pd.DataFrame, config: ScanConfig,
                   display_cols: list[str]) -> None:
    """Render the summary table plus rebased trend lines for every match."""
    try:
        import plotly.graph_objects as go
        from plotly.subplots import make_subplots
    except ImportError:
        log.info("plotly not installed - skipping interactive charts.")
        return

    try:
        fig = go.Figure(data=[go.Table(
            header=dict(values=display_cols, fill_color="#12355b",
                        font=dict(color="white", size=12), align="left"),
            cells=dict(values=[result[c] for c in display_cols],
                       fill_color=[["#f4f7fb", "#ffffff"] * len(result)],
                       align="left"),
        )])
        fig.update_layout(title=f"Continuous Uptrend Stocks "
                                f"({config.months}M) - {date.today():%d %b %Y}")
        fig.show()

        # Comparative trend chart: every match rebased to 100 at window start,
        # so relative momentum is comparable regardless of share price.
        trend = make_subplots(specs=[[{"secondary_y": False}]])
        for _, row in result.iterrows():
            series = row.get("Trend")
            if not isinstance(series, dict):
                continue
            trend.add_trace(go.Scatter(
                x=series["dates"], y=series["rebased"], mode="lines",
                name=f"{row['Ticker']} ({row['Exchange']})",
                hovertemplate="%{x}<br>%{y:.1f}<extra>" + row["Ticker"] + "</extra>",
            ))
        trend.update_layout(
            title="Relative price trend (rebased to 100 at window start)",
            xaxis_title="Date", yaxis_title="Index (start = 100)",
            hovermode="x unified",
        )
        trend.show()
    except Exception as exc:
        log.warning("Plotly rendering failed: %s", exc)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="NSE/BSE continuous-uptrend stock scanner")
    p.add_argument("--exchanges", default="NSE",
                   help="comma-separated: NSE, BSE, or NSE,BSE (default NSE)")
    p.add_argument("--bse-groups", default=",".join(BSE_DEFAULT_GROUPS),
                   help="BSE groups to include, e.g. 'A' or 'A,B' (default A)")
    p.add_argument("--keep-bse-duplicates", action="store_true",
                   help="keep .BO twins of NSE-listed stocks instead of de-duplicating")
    p.add_argument("--months", type=int, default=6, help="lookback in months (default 6)")
    p.add_argument("--limit", type=int, default=None, help="cap universe size for a quick run")
    p.add_argument("--batch-size", type=int, default=60, help="tickers per download batch")
    p.add_argument("--min-monthly-return", type=float, default=0.0,
                   help="minimum required return for EACH month, in %% (default 0)")
    p.add_argument("--max-drawdown", type=float, default=100.0,
                   help="reject stocks whose 6M max drawdown exceeds this %%")
    p.add_argument("--min-volume", type=float, default=50_000,
                   help="minimum 60-day average volume")
    p.add_argument("--no-higher-highs", action="store_true",
                   help="disable the higher-highs/higher-lows structure filter")
    p.add_argument("--no-plotly", action="store_true", help="skip the interactive charts")
    p.add_argument("--no-names", action="store_true", help="skip company-name lookup")
    p.add_argument("--csv", type=str, default=None, help="path to save the results CSV")
    return p.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    config = ScanConfig(
        months=args.months,
        min_monthly_return_pct=args.min_monthly_return,
        max_drawdown_pct=args.max_drawdown,
        min_avg_volume=args.min_volume,
        limit=args.limit,
        batch_size=args.batch_size,
        require_higher_highs=not args.no_higher_highs,
        exchanges=parse_exchanges(args.exchanges),
        bse_groups=tuple(g.strip().upper() for g in args.bse_groups.split(",") if g.strip()),
        prefer_nse=not args.keep_bse_duplicates,
        # ~21 trading days/month + 100-day SMA warm-up + 52-week high need.
        lookback_days=max(400, args.months * 31 + 220),
    )

    tickers = get_tickers(limit=config.limit, exchanges=config.exchanges,
                          bse_groups=config.bse_groups, prefer_nse=config.prefer_nse)
    if not tickers:
        log.error("No tickers resolved; aborting.")
        return 1

    frames = download_data(tickers, config)
    if not frames:
        log.error("No price data downloaded; check network/rate limits.")
        return 1

    result = analyze_trends(frames, config)
    generate_report(result, config, csv_path=args.csv,
                    use_plotly=not args.no_plotly,
                    resolve_names=not args.no_names)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
