"""
NSE Uptrend Scanner - Web Dashboard
===================================

A browser-based front end for `nse_uptrend_scanner.py` that keeps results fresh
by re-running the scan on a background schedule.

Architecture
-----------------
    Background thread  ->  runs the (slow, ~5 min) scan on a fixed interval
    In-memory store    ->  thread-safe snapshot of the latest results
    JSON cache on disk ->  survives restarts, so the UI is never empty
    Flask + JSON API   ->  browser polls /api/results and re-renders

The scan NEVER runs inside a request handler, so the UI stays responsive even
while a 500-ticker download is in flight.

Usage
-----
    python app.py
    python app.py --interval 30 --port 8000
    python app.py --limit 100 --interval 15      # fast demo mode

Then open http://127.0.0.1:8766
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf
from flask import Flask, jsonify, render_template, request

import nse_uptrend_scanner as scanner

log = logging.getLogger("nse-web")

CACHE_FILE = Path(__file__).with_name("scan_cache.json")
RESULTS_CSV = Path(__file__).with_name("uptrend_results.csv")
DISPLAY_COLUMNS = [
    "Ticker", "Exchange", "Company", "Price", "Today %", "Today Status",
    "6M Return %", "Avg Monthly %", "Worst Month %",
]
# Sent to the browser per row for charting, on top of DISPLAY_COLUMNS.
PAYLOAD_COLUMNS = DISPLAY_COLUMNS + ["Trend"]


# --------------------------------------------------------------------------- #
# State
# --------------------------------------------------------------------------- #

@dataclass
class ScanState:
    """Thread-safe snapshot of the most recent scan."""
    status: str = "idle"                     # idle | running | ok | error
    rows: list[dict[str, Any]] = field(default_factory=list)
    rejections: dict[str, int] = field(default_factory=dict)
    error: str | None = None
    last_run: str | None = None              # ISO-8601 UTC
    next_run: str | None = None
    duration_sec: float | None = None
    universe_size: int = 0
    analyzed: int = 0
    run_count: int = 0
    live_updated: str | None = None
    live_error: str | None = None

    def _median(self, column: str) -> float | None:
        """Median of a numeric column, tolerant of rows missing that key."""
        values = [r[column] for r in self.rows if isinstance(r.get(column), (int, float))]
        return round(pd.Series(values).median(), 2) if values else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "rows": self.rows,
            "columns": DISPLAY_COLUMNS,
            "rejections": self.rejections,
            "error": self.error,
            "last_run": self.last_run,
            "next_run": self.next_run,
            "duration_sec": self.duration_sec,
            "universe_size": self.universe_size,
            "analyzed": self.analyzed,
            "run_count": self.run_count,
            "live_updated": self.live_updated,
            "live_error": self.live_error,
            "match_count": len(self.rows),
            "by_exchange": {
                ex: sum(1 for r in self.rows if r.get("Exchange") == ex)
                for ex in sorted({r.get("Exchange", "NSE") for r in self.rows})
            },
            "median_return": self._median("6M Return %"),
            "median_drawdown": self._median("Max Drawdown %"),
        }


_state = ScanState()
_state_lock = threading.Lock()
_scan_lock = threading.Lock()      # guarantees only one scan runs at a time
_wake_event = threading.Event()    # lets "Refresh now" interrupt the sleep
_live_wake_event = threading.Event()


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #

def load_cache(months: int | None = None) -> None:
    """Restore the last successful scan so a fresh start isn't a blank page."""
    if not CACHE_FILE.exists():
        return
    try:
        payload = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        rows = payload.get("rows", [])
        cached_months = payload.get("months")
        if months is not None and cached_months != months:
            log.info("Cache uses %s months; current scan requires %d months.", cached_months, months)
            return
        # A cache written by an older build lacks Exchange/Trend, which would
        # render an inconsistent table and no charts. Drop it and rescan.
        if rows and not all("Exchange" in r and "Trend" in r for r in rows):
            log.info("Cache predates the current schema; ignoring it.")
            return
        for row in rows:
            row.setdefault("Today %", None)
            row.setdefault("Today Status", "Pending")
        with _state_lock:
            _state.rows = rows
            _state.rejections = payload.get("rejections", {})
            _state.last_run = payload.get("last_run")
            _state.universe_size = payload.get("universe_size", 0)
            _state.analyzed = payload.get("analyzed", 0)
            _state.duration_sec = payload.get("duration_sec")
            _state.live_updated = payload.get("live_updated")
            _state.status = "ok" if _state.rows or _state.rejections else "idle"
        log.info("Restored cached scan from %s (%d rows).",
                 _state.last_run, len(_state.rows))
    except Exception as exc:
        log.warning("Could not read cache: %s", exc)


def save_cache(months: int | None = None) -> None:
    try:
        with _state_lock:
            payload = {
                "rows": _state.rows,
                "rejections": _state.rejections,
                "last_run": _state.last_run,
                "universe_size": _state.universe_size,
                "analyzed": _state.analyzed,
                "duration_sec": _state.duration_sec,
                "live_updated": _state.live_updated,
                "months": months,
            }
        CACHE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception as exc:
        log.warning("Could not write cache: %s", exc)


# --------------------------------------------------------------------------- #
# Scan job
# --------------------------------------------------------------------------- #

def _initial_today_status(df: pd.DataFrame) -> tuple[float, float, str]:
    """Use the latest two daily closes until the first live quote refresh."""
    closes = df["Close"].dropna()
    price = float(closes.iloc[-1])
    change = (price / float(closes.iloc[-2]) - 1.0) * 100.0 if len(closes) > 1 else 0.0
    return round(price, 2), round(change, 2), "Gain" if change >= 0 else "Loss"


def _extract_intraday_quotes(
    raw: pd.DataFrame, tickers: list[str]
) -> dict[str, tuple[float, float, str]]:
    """Return latest price and session change from a yfinance intraday batch."""
    quotes: dict[str, tuple[float, float, str]] = {}
    for ticker in tickers:
        try:
            frame = raw[ticker] if isinstance(raw.columns, pd.MultiIndex) else raw
            close = frame["Close"].dropna()
            if close.empty:
                continue
            sessions = close.groupby(close.index.date).last()
            price = float(sessions.iloc[-1])
            previous = float(sessions.iloc[-2]) if len(sessions) > 1 else price
            change = (price / previous - 1.0) * 100.0
            quotes[ticker] = (
                round(price, 2),
                round(change, 2),
                "Gain" if change >= 0 else "Loss",
            )
        except (KeyError, IndexError, TypeError, ValueError):
            log.debug("No live quote available for %s.", ticker)
    return quotes


def _add_hourly_trends(rows: list[dict[str, Any]]) -> None:
    """Attach recent hourly closes used by the per-share dashboard chart."""
    tickers = [str(row["Ticker"]) for row in rows]
    if not tickers:
        return
    try:
        raw = yf.download(
            tickers,
            period="1mo",
            interval="1h",
            group_by="ticker",
            auto_adjust=True,
            actions=False,
            threads=True,
            progress=False,
            repair=False,
        )
    except Exception as exc:
        log.warning("Hourly trend refresh failed: %s", exc)
        return

    for row in rows:
        ticker = str(row["Ticker"])
        try:
            frame = raw[ticker] if isinstance(raw.columns, pd.MultiIndex) else raw
            closes = frame["Close"].dropna()
            trend = row.get("Trend")
            if closes.empty or not isinstance(trend, dict):
                continue
            trend["hourly"] = {
                "dates": [value.isoformat() for value in closes.index],
                "close": [round(float(value), 2) for value in closes],
            }
        except (KeyError, TypeError, ValueError):
            log.debug("No hourly trend available for %s.", ticker)

    hourly_by_root = {
        str(row["Ticker"]).rsplit(".", 1)[0]: row["Trend"]["hourly"]
        for row in rows
        if isinstance(row.get("Trend"), dict) and row["Trend"].get("hourly")
    }
    for row in rows:
        trend = row.get("Trend")
        root = str(row["Ticker"]).rsplit(".", 1)[0]
        if isinstance(trend, dict) and not trend.get("hourly") and root in hourly_by_root:
            trend["hourly"] = hourly_by_root[root]


def _csv_result_rows(
    source: pd.DataFrame,
    frames: dict[str, pd.DataFrame],
    tickers: list[str],
) -> list[dict[str, Any]]:
    """Build NSE and BSE dashboard rows for companies selected by the CSV."""
    source_by_root = {
        str(row["Ticker"]).rsplit(".", 1)[0]: row
        for _, row in source.iterrows()
    }
    rows: list[dict[str, Any]] = []
    for ticker in tickers:
        root = ticker.rsplit(".", 1)[0]
        source_row = source_by_root.get(root)
        if source_row is None:
            continue
        counterpart = f"{root}.BO" if ticker.endswith(".NS") else f"{root}.NS"
        frame = frames.get(ticker)
        if frame is None:
            frame = frames.get(counterpart)
        if frame is None:
            continue
        close = frame["Close"].dropna()
        if len(close) < 2:
            continue
        tail = frame.sort_index().tail(130)
        tail_close = tail["Close"]
        monthly = frame.resample("ME").agg({"Close": "last"}).dropna().tail(7)
        monthly_returns = monthly["Close"].pct_change().dropna() * 100.0

        def clean(series: pd.Series) -> list[float | None]:
            return [None if pd.isna(value) else round(float(value), 2) for value in series]

        price, today_pct, today_status = _initial_today_status(frame)
        rows.append({
            "Ticker": ticker,
            "Exchange": scanner.exchange_of(ticker),
            "Company": str(source_row["Company"]),
            "Price": price,
            "Today %": today_pct,
            "Today Status": today_status,
            "6M Return %": round(float(source_row["6M Return %"]), 2),
            "Avg Monthly %": round(float(source_row["Avg Monthly %"]), 2),
            "Worst Month %": round(float(source_row["Worst Month %"]), 2),
            "Trend": {
                "dates": [value.strftime("%Y-%m-%d") for value in tail.index],
                "close": clean(tail_close),
                "sma20": clean(frame["Close"].rolling(20).mean().tail(130)),
                "sma50": clean(frame["Close"].rolling(50).mean().tail(130)),
                "sma100": clean(frame["Close"].rolling(100).mean().tail(130)),
                "months": [value.strftime("%b %Y") for value in monthly.index[1:]],
                "monthly_returns": [round(float(value), 2) for value in monthly_returns],
            },
        })
    rows.sort(key=lambda row: float(row["6M Return %"]), reverse=True)
    return rows


def refresh_live_quotes() -> None:
    """Refresh current price and session Gain/Loss for the displayed stocks."""
    with _state_lock:
        tickers = [str(row["Ticker"]) for row in _state.rows]
    if not tickers:
        return

    try:
        raw = yf.download(
            tickers,
            period="5d",
            interval="1m",
            group_by="ticker",
            auto_adjust=True,
            actions=False,
            threads=True,
            progress=False,
            repair=False,
        )
        if raw is None or raw.empty:
            raise RuntimeError("Yahoo returned no live quote data.")
        quotes = _extract_intraday_quotes(raw, tickers)
        if not quotes:
            raise RuntimeError("No displayed ticker returned a live quote.")

        updated = _utcnow_iso()
        with _state_lock:
            for row in _state.rows:
                quote = quotes.get(str(row["Ticker"]))
                if quote:
                    row["Price"], row["Today %"], row["Today Status"] = quote
            _state.live_updated = updated
            _state.live_error = None
        log.info("Live quotes refreshed: %d / %d.", len(quotes), len(tickers))
    except Exception as exc:
        with _state_lock:
            _state.live_error = str(exc)
        log.warning("Live quote refresh failed: %s", exc)


def run_scan(config: scanner.ScanConfig) -> None:
    """Execute one full scan and publish the result into the shared state."""
    if not _scan_lock.acquire(blocking=False):
        log.info("Scan already in progress; skipping duplicate trigger.")
        return

    started = time.perf_counter()
    try:
        with _state_lock:
            _state.status = "running"
            _state.error = None

        if RESULTS_CSV.exists():
            source = pd.read_csv(RESULTS_CSV).head(10)
            roots = source["Ticker"].astype(str).str.rsplit(".", n=1).str[0]
            tickers = [
                f"{root}.{suffix}"
                for root in roots
                for suffix in ("NS", "BO")
                if (suffix == "NS" and "NSE" in config.exchanges)
                or (suffix == "BO" and "BSE" in config.exchanges)
            ]
            log.info("Using %s (%d companies, %d exchange listings).",
                     RESULTS_CSV.name, len(source), len(tickers))
        else:
            source = None
            tickers = scanner.get_tickers(
                limit=config.limit, exchanges=config.exchanges,
                bse_groups=config.bse_groups, prefer_nse=config.prefer_nse,
            )
        with _state_lock:
            _state.universe_size = len(tickers)

        frames = scanner.download_data(tickers, config)
        if not frames:
            raise RuntimeError("No price data returned (network or rate limit).")

        if source is not None:
            rows = _csv_result_rows(source, frames, tickers)
            _add_hourly_trends(rows)
            config.rejection_reasons = {}
        else:
            result = scanner.analyze_trends(
                frames, config, monthly_only=True, limit=10
            )

        if source is None and not result.empty:
            names = scanner.get_company_names(result["Ticker"])
            result = result.copy()
            result["Company"] = result["Ticker"].map(names)
            initial_quotes = {
                ticker: _initial_today_status(frames[ticker])
                for ticker in result["Ticker"]
            }
            result["Price"] = result["Ticker"].map(lambda ticker: initial_quotes[ticker][0])
            result["Today %"] = result["Ticker"].map(lambda ticker: initial_quotes[ticker][1])
            result["Today Status"] = result["Ticker"].map(
                lambda ticker: initial_quotes[ticker][2]
            )
            rows = result[PAYLOAD_COLUMNS].to_dict(orient="records")
            _add_hourly_trends(rows)
        elif source is None:
            rows = []

        with _state_lock:
            _state.rows = rows
            _state.rejections = config.rejection_reasons
            _state.analyzed = len(frames)
            _state.duration_sec = round(time.perf_counter() - started, 1)
            _state.last_run = _utcnow_iso()
            _state.run_count += 1
            _state.status = "ok"
        save_cache(config.months)
        _live_wake_event.set()
        log.info("Scan complete: %d matches in %.1fs.", len(rows), _state.duration_sec)

    except Exception as exc:
        log.exception("Scan failed.")
        with _state_lock:
            _state.status = "error"
            _state.error = str(exc)
            _state.duration_sec = round(time.perf_counter() - started, 1)
    finally:
        _scan_lock.release()


def scheduler_loop(config: scanner.ScanConfig, interval_minutes: float) -> None:
    """
    Daemon loop: scan, then sleep until the next slot.

    `_wake_event` lets the /api/refresh endpoint cut the sleep short without
    spawning a second scan (run_scan itself is guarded by a non-blocking lock).
    """
    while True:
        run_scan(config)
        with _state_lock:
            _state.next_run = datetime.fromtimestamp(
                time.time() + interval_minutes * 60, tz=timezone.utc
            ).isoformat(timespec="seconds")
        _wake_event.wait(timeout=interval_minutes * 60)
        _wake_event.clear()


def live_quote_loop(interval_seconds: float = 30.0) -> None:
    """Refresh displayed prices without repeating the expensive universe scan."""
    while True:
        refresh_live_quotes()
        _live_wake_event.wait(timeout=interval_seconds)
        _live_wake_event.clear()


# --------------------------------------------------------------------------- #
# Flask app
# --------------------------------------------------------------------------- #

def create_app(
    config: scanner.ScanConfig,
    interval_minutes: float,
    live_interval_seconds: float = 30.0,
) -> Flask:
    app = Flask(__name__)

    @app.route("/")
    def index():
        universe = " + ".join(config.exchanges)
        if config.limit:
            universe += f" (first {config.limit})"
        return render_template(
            "index.html",
            interval_minutes=interval_minutes,
            live_interval_seconds=live_interval_seconds,
            universe=universe,
            months=config.months,
        )

    @app.route("/api/results")
    def api_results():
        with _state_lock:
            return jsonify(_state.to_dict())

    @app.route("/api/refresh", methods=["POST"])
    def api_refresh():
        """Trigger an out-of-band scan by waking the scheduler thread."""
        if _scan_lock.locked():
            return jsonify({"triggered": False, "reason": "scan already running"}), 409
        _wake_event.set()
        return jsonify({"triggered": True})

    @app.route("/api/health")
    def api_health():
        with _state_lock:
            return jsonify({"status": _state.status, "last_run": _state.last_run})

    return app


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="NSE uptrend scanner web dashboard")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8766)
    p.add_argument("--interval", type=float, default=30.0,
                   help="minutes between automatic scans (default 30)")
    p.add_argument("--live-interval", type=float, default=30.0,
                   help="seconds between displayed quote refreshes (default 30)")
    p.add_argument("--exchanges", default="NSE,BSE",
                   help="comma-separated: NSE, BSE, or NSE,BSE (default NSE,BSE)")
    p.add_argument("--bse-groups", default=",".join(scanner.BSE_DEFAULT_GROUPS),
                   help="BSE groups to include, e.g. 'A' or 'A,B' (default A)")
    p.add_argument("--keep-bse-duplicates", action="store_true",
                   help="keep .BO twins of NSE-listed stocks")
    p.add_argument("--months", type=int, default=6,
                   help="consecutive positive monthly closes required (default 6)")
    p.add_argument("--limit", type=int, default=400,
                   help="cap each exchange universe for faster refreshes (default 400)")
    p.add_argument("--batch-size", type=int, default=60)
    p.add_argument("--min-monthly-return", type=float, default=-1.0,
                   help="minimum monthly return in percent (default -1)")
    p.add_argument("--max-drawdown", type=float, default=100.0)
    p.add_argument("--min-volume", type=float, default=50_000)
    p.add_argument("--no-higher-highs", action="store_true")
    p.add_argument("--debug", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.getLogger().setLevel(logging.INFO)

    config = scanner.ScanConfig(
        months=args.months,
        min_monthly_return_pct=args.min_monthly_return,
        max_drawdown_pct=args.max_drawdown,
        min_avg_volume=args.min_volume,
        limit=args.limit,
        batch_size=args.batch_size,
        require_higher_highs=not args.no_higher_highs,
        exchanges=scanner.parse_exchanges(args.exchanges),
        bse_groups=tuple(g.strip().upper() for g in args.bse_groups.split(",") if g.strip()),
        prefer_nse=False,
        lookback_days=max(400, args.months * 31 + 220),
    )

    load_cache(config.months)
    if _state.rows:
        refresh_live_quotes()
    app = create_app(config, args.interval, args.live_interval)

    # Flask's reloader runs main() twice; only the child process should schedule.
    if not args.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        threading.Thread(
            target=scheduler_loop, args=(config, args.interval), daemon=True
        ).start()
        threading.Thread(
            target=live_quote_loop, args=(args.live_interval,), daemon=True
        ).start()
        log.info("Scheduler started - refreshing every %.0f minute(s).", args.interval)
        log.info("Live quotes refresh every %.0f second(s).", args.live_interval)

    log.info("Dashboard -> http://%s:%d", args.host, args.port)
    app.run(host=args.host, port=args.port, debug=args.debug, threaded=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
