# -*- coding: utf-8 -*-
"""
Builds a clean trades table from chart data (ISO timestamps).
Rules:
- Entry: Buy/Sell Entry Signal -> execution at Next-Bar-Open
- Exit:  (1) if 'Exit Signal' present -> exit at Next-Bar-Open
         (2) otherwise at the next entry (buy or sell) -> exit at Next-Bar-Open
- After exit, a new entry can occur at the same Next-Open.
Computes: pnl_pct, mfe_pct, mae_pct, mfe_25/50/75, drawdown_after_mfe_pct, exit_vs_mfe_gap_pct,
bars_in_trade, volatility_pct.
"""

import argparse
from dataclasses import dataclass
from typing import Optional, List, Tuple

import numpy as np
import pandas as pd


# ------------------------------------------------------------
# Utilities
# ------------------------------------------------------------

def _is_signal_present(val) -> bool:
    """True if an entry counts as a set signal."""
    if pd.isna(val):
        return False
    if isinstance(val, str):
        return val.strip() != ""
    # numerisch/nichtleer
    return True


def parse_iso_utc(s: pd.Series) -> pd.Series:
    """
    Robust against mixed timezones: forces UTC.
    """
    ts = pd.to_datetime(s, utc=True, errors="coerce")
    # Missing/invalid timestamps are filtered later via dropna
    return ts


def split_date_time_utc(ts: pd.Timestamp) -> Tuple[str, str]:
    """
    Splits a UTC timestamp into (YYYY-MM-DD, HH:MM:SSZ).
    """
    if pd.isna(ts):
        return "", ""
    t = ts.tz_convert("UTC")
    return t.strftime("%Y-%m-%d"), t.strftime("%H:%M:%SZ")


def safe_std_logret(prices: np.ndarray) -> float:
    """
    Std dev of log returns in %; no warnings for very short trades.
    """
    if prices.size < 3:
        # Fewer than 2 returns -> defined as 0.0 (too few samples)
        return 0.0
    rets = np.diff(np.log(prices))
    if rets.size < 2:
        return 0.0
    return float(np.std(rets, ddof=1) * 100.0)


@dataclass
class Trade:
    entry_ts: pd.Timestamp
    entry_price: float
    side: str  # "long" | "short"
    exit_ts: pd.Timestamp
    exit_price: float
    pnl_pct: float
    mfe_pct: float
    mae_pct: float
    mfe_25pct: float
    mfe_50pct: float
    mfe_75pct: float
    drawdown_after_mfe_pct: float
    exit_vs_mfe_gap_pct: float
    bars_in_trade: int
    volatility_pct: float


# ------------------------------------------------------------
# Validate and normalise core data
# ------------------------------------------------------------

def ensure_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    """
    Expects columns (at minimum):
      - time: 'time' (ISO) or 'ts' (ISO)
      - 'open','high','low','close'
      - 'Buy Entry Signal','Sell Entry Signal','Exit Signal' (any non-empty value = signal)
    Returns DataFrame with columns:
      ts (datetime64[ns, UTC]), open, high, low, close, buy_sig, sell_sig, exit_sig
      sorted by ts
    """
    cols = {c.lower(): c for c in df.columns}
    time_col = cols.get("time") or cols.get("ts")
    need = ["open", "high", "low", "close"]
    miss = [c for c in need if c not in cols]
    if time_col is None or miss:
        raise ValueError(f"Missing columns. Time='{time_col}' | Missing OHLC={miss}")

    out = pd.DataFrame({
        "ts": parse_iso_utc(df[time_col]),
        "open": df[cols["open"]].astype(float),
        "high": df[cols["high"]].astype(float),
        "low":  df[cols["low"]].astype(float),
        "close":df[cols["close"]].astype(float),
    })

    # Signals (optional, otherwise NA → False)
    def col_or_none(name: str) -> Optional[pd.Series]:
        key = name.lower()
        if key in cols:
            return df[cols[key]]
        return None

    out["buy_sig"] = col_or_none("Buy Entry Signal")
    out["sell_sig"] = col_or_none("Sell Entry Signal")
    out["exit_sig"] = col_or_none("Exit Signal")

    out = out.dropna(subset=["ts"]).sort_values("ts").reset_index(drop=True)
    return out


# ------------------------------------------------------------
# MFE/MAE and additional metrics for long/short
# ------------------------------------------------------------

def _mfe_mae_block(prices_high: np.ndarray, prices_low: np.ndarray,
                   entry: float, side: str) -> Tuple[float, float]:
    """
    MFE/MAE in % relativ zum Entry.
    For long:  MFE = max(high), MAE = min(low)
    For short: MFE = (Entry - min(low))/Entry, MAE = (Entry - max(high))/Entry (negative sign)
    """
    if prices_high.size == 0:
        return 0.0, 0.0

    if side == "long":
        max_fav = np.max(prices_high)
        min_adv = np.min(prices_low)
        mfe = (max_fav / entry - 1.0) * 100.0
        mae = (min_adv / entry - 1.0) * 100.0
    else:
        # short
        min_fav = np.min(prices_low)
        max_adv = np.max(prices_high)
        mfe = (1.0 - min_fav / entry) * 100.0
        mae = (1.0 - max_adv / entry) * 100.0
        mae = -abs(mae)  # als negatives Vorzeichen
    return float(mfe), float(mae)


def _mfe_progress(prices_high: np.ndarray, prices_low: np.ndarray,
                  entry: float, side: str, progress: float) -> float:
    """
    MFE bis zu einem Teil der Bars (progress in [0,1]).
    """
    n = prices_high.size
    if n == 0:
        return 0.0
    m = max(1, int(np.ceil(n * progress)))
    if side == "long":
        max_h = float(np.max(prices_high[:m]))
        return (max_h / entry - 1.0) * 100.0
    else:
        min_l = float(np.min(prices_low[:m]))
        return (1.0 - min_l / entry) * 100.0


def _drawdown_after_mfe(prices_high: np.ndarray, prices_low: np.ndarray,
                        entry: float, side: str) -> float:
    """
    Retracement (negativ) NACH Erreichen des MFE-Extrems, relativ zum Extrem.
    For long: extreme = Max(High); then minimum Low → (Low/HWM - 1)*100 (<=0)
    For short: extreme = Min(Low); then maximum High → (1 - High/LWM)*100 (<=0)
    """
    n = prices_high.size
    if n == 0:
        return 0.0

    if side == "long":
        hwm = float(np.max(prices_high))
        idx = int(np.argmax(prices_high))  # erste Stelle des MFE
        if idx < n - 1:
            min_after = float(np.min(prices_low[idx+1:]))
            retr = (min_after / hwm - 1.0) * 100.0
        else:
            retr = 0.0
    else:
        lwm = float(np.min(prices_low))
        idx = int(np.argmin(prices_low))
        if idx < n - 1:
            max_after = float(np.max(prices_high[idx+1:]))
            retr = (1.0 - max_after / lwm) * 100.0
        else:
            retr = 0.0
    return float(retr)  # typischerweise <= 0


# ------------------------------------------------------------
# Trades ableiten
# ------------------------------------------------------------

def build_trades(df: pd.DataFrame) -> List[Trade]:
    """
    Baut Trades nach Regel:
      - Exit on Exit-Signal (Next-Open), otherwise at next Entry (Next-Open).
      - Danach kann am SELBEN Next-Open ein neuer Entry stattfinden.
    """
    ts = df["ts"].values
    o = df["open"].values
    h = df["high"].values
    l = df["low"].values
    c = df["close"].values

    buy = df["buy_sig"].values if "buy_sig" in df.columns else np.array([np.nan]*len(df))
    sell = df["sell_sig"].values if "sell_sig" in df.columns else np.array([np.nan]*len(df))
    ex = df["exit_sig"].values if "exit_sig" in df.columns else np.array([np.nan]*len(df))

    trades: List[Trade] = []
    active: Optional[dict] = None

    n = len(df)
    for i in range(n):
        # last bar cannot have a Next-Open → no execution there
        has_next = (i + 1 < n)
        buy_sig = _is_signal_present(buy[i])
        sell_sig = _is_signal_present(sell[i])
        exit_sig = _is_signal_present(ex[i])

        # 1) Exit?
        if active is not None and has_next and (exit_sig or buy_sig or sell_sig):
            # Exit am Next-Open
            exit_ts = ts[i + 1]
            exit_price = float(o[i + 1])

            # Segment (incl. exit bar) for metrics
            j = active["entry_idx"]
            k = i + 1  # bis inkl. Exit-Bar
            seg_high = h[j:k + 1]
            seg_low = l[j:k + 1]
            seg_close = c[j:k + 1]

            side = active["side"]
            entry_price = float(active["entry_price"])

            if side == "long":
                pnl = (exit_price / entry_price - 1.0) * 100.0
            else:
                pnl = (entry_price / exit_price - 1.0) * 100.0

            mfe, mae = _mfe_mae_block(seg_high, seg_low, entry_price, side)
            mfe25 = _mfe_progress(seg_high, seg_low, entry_price, side, 0.25)
            mfe50 = _mfe_progress(seg_high, seg_low, entry_price, side, 0.50)
            mfe75 = _mfe_progress(seg_high, seg_low, entry_price, side, 0.75)
            dd_after = _drawdown_after_mfe(seg_high, seg_low, entry_price, side)
            gap = mfe - pnl
            bars = int(k - j + 1)
            vol = safe_std_logret(seg_close)

            trades.append(Trade(
                entry_ts=pd.Timestamp(ts[j], tz="UTC"),
                entry_price=entry_price,
                side=side,
                exit_ts=pd.Timestamp(exit_ts, tz="UTC"),
                exit_price=float(exit_price),
                pnl_pct=float(pnl),
                mfe_pct=float(mfe),
                mae_pct=float(mae),
                mfe_25pct=float(mfe25),
                mfe_50pct=float(mfe50),
                mfe_75pct=float(mfe75),
                drawdown_after_mfe_pct=float(dd_after),
                exit_vs_mfe_gap_pct=float(gap),
                bars_in_trade=bars,
                volatility_pct=float(vol),
            ))
            active = None  # geschlossen

        # 2) Entry?
        if has_next and (buy_sig or sell_sig):
            side = "long" if buy_sig else "short"
            active = {
                "entry_idx": i + 1,
                "entry_ts": ts[i + 1],
                "entry_price": float(o[i + 1]),
                "side": side,
            }

    return trades


# ------------------------------------------------------------
# CLI & Export
# ------------------------------------------------------------

def trades_to_df(trades: List[Trade]) -> pd.DataFrame:
    rows = []
    for t in trades:
        ed, et = split_date_time_utc(t.entry_ts)
        xd, xt = split_date_time_utc(t.exit_ts)
        rows.append({
            "entry_date": ed,
            "entry_time": et,
            "entry_ts": t.entry_ts.isoformat(),
            "entry_price": t.entry_price,
            "side": t.side,
            "exit_date": xd,
            "exit_time": xt,
            "exit_ts": t.exit_ts.isoformat(),
            "exit_price": t.exit_price,
            "pnl_pct": t.pnl_pct,
            "mfe_pct": t.mfe_pct,
            "mae_pct": t.mae_pct,
            "mfe_25pct": t.mfe_25pct,
            "mfe_50pct": t.mfe_50pct,
            "mfe_75pct": t.mfe_75pct,
            "drawdown_after_mfe_pct": t.drawdown_after_mfe_pct,
            "exit_vs_mfe_gap_pct": t.exit_vs_mfe_gap_pct,
            "bars_in_trade": t.bars_in_trade,
            "volatility_pct": t.volatility_pct,
        })
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--signals", required=True, help="Pfad zur Chart-CSV (ISO-Zeit).")
    ap.add_argument("--out", default="", help="Ziel-CSV (optional).")
    args = ap.parse_args()

    raw = pd.read_csv(args.signals)
    df = ensure_ohlc(raw)

    trades = build_trades(df)
    out = trades_to_df(trades)

    if args.out.strip() == "":
        # default: <basename>_trades.csv
        base = args.signals.rsplit(".", 1)[0]
        out_path = f"{base}_trades.csv"
    else:
        out_path = args.out

    out.to_csv(out_path, index=False)
    print(f"✅ {len(out)} trades written → {out_path}")


if __name__ == "__main__":
    main()