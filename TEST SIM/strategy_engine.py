#!/usr/bin/env python3
# =====================
# PRODUCTION LOCK
# Version: 1.0
# Safe / Balanced / Aggressive scoring tuned and validated.
# Do NOT modify scoring weights without controlled test batch.
# =====================


import sys
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone, timedelta


# ===================== HELPERS =====================
def fmt(x, d=2):
    return f"{float(x):.{d}f}"

def weights_equal(w1, w2, tol=1e-4):
    return np.all(np.abs(w1 - w2) < tol)

# ===================== GLOBAL PARAMETERS =====================
LOOKBACK_DAYS = 180
MIN_WEIGHT = 7.5
ITERATIONS = 3000
RANDOM_SEED = 42
MIN_TP_PCT = 0.05  # minimum TP size in %
np.random.seed(RANDOM_SEED)

# ===================== STOPLOSS CONFIG =====================
STOPLOSS = -3.0   # percent, e.g. -3.0 means -3%
# ===================== CAPITAL & LEVERAGE =====================
START_CAPITAL = 100.0        # dollars
MARGIN_USAGE = 1.0           # 100% of capital per trade
LADDER_LEVERAGE = {
    "SAFE": 2.0,
    "BALANCED": 3.0,
    "AGGRESSIVE": 5.0,
}

# ===================== PSYCHOLOGICAL OPTIMIZATION =====================
PSYCH_TRADE_WINDOW = 20
PSYCH_WEIGHT = 0.35
LONG_TERM_WEIGHT = 0.65
DOMINANCE_MAX = 0.35
DOMINANCE_PENALTY_LAMBDA = 0.5

# ===================== TP LADDER DEFINITIONS =====================
TP_LADDERS = {
    "SAFE":       [0.85, 0.70, 0.55, 0.40, 0.25, 0.10],
    "BALANCED":   [0.80, 0.65, 0.50, 0.35, 0.20, 0.08],
    "AGGRESSIVE": [0.75, 0.63, 0.48, 0.34, 0.19, 0.07],
}

# ===================== PRESET WEIGHTING SCHEMES =====================
PRESET_WEIGHTS = {
    "FRONT": np.array([0.25, 0.22, 0.18, 0.15, 0.10, 0.10]),
    "MID":   np.array([0.15, 0.18, 0.22, 0.20, 0.15, 0.10]),
    "TAIL":  np.array([0.10, 0.10, 0.15, 0.20, 0.22, 0.23]),
}

LADDER_WEIGHT_CONSTRAINTS = {
    "SAFE": {
        "max_tail": 0.20,
        "min_front": 0.55,
        "max_tp6": 0.10,
        "min_tp6_hitrate": 0.08,
        "min_tp1": 0.15,   # NEW (15%)
    },
    "BALANCED": {
        "max_tail": 0.30,
        "min_front": 0.35,
        "max_tp6": 0.18,
        "min_tp6_hitrate": 0.06,
    },
    "AGGRESSIVE": {
        "max_tail": 0.45,
        "min_front": 0.20,
        "max_tp6": 0.30,
        "min_tp6_hitrate": 0.04,
    },
}


LADDER_REFINEMENT_PASSES = {
    "SAFE": 8,
    "BALANCED": 15,
    "AGGRESSIVE": 25,
}


LADDER_BASE_PRESET = {
    "SAFE": "FRONT",
    "BALANCED": "MID",
    "AGGRESSIVE": "TAIL",
}


LADDER_PREFERRED_PRESET = {
    "SAFE": "FRONT",
    "BALANCED": "MID",
    "AGGRESSIVE": "TAIL",
}

LADDER_DISPLAY_PRESETS = {
    "SAFE": ["FRONT"],
    "BALANCED": ["MID"],
    "AGGRESSIVE": ["TAIL"],
}

LADDER_COMPOUND_PRESET = {
    "SAFE": ["FRONT"],     # choose best of the two
    "BALANCED": ["MID"],
    "AGGRESSIVE": ["TAIL"],
}

LADDER_EVAL_PRESET = {
    "SAFE": ["FRONT"],
    "BALANCED": ["MID"],
    "AGGRESSIVE": ["TAIL"],
}


# ===================== ARGUMENT PARSING =====================
import argparse as _ap
_parser = _ap.ArgumentParser()
_parser.add_argument("csv", help="Path to trades CSV")
_parser.add_argument("--lookback_days", type=int, default=LOOKBACK_DAYS,
                     help="Lookback window in days (default 180)")
_parser.add_argument("--profile", default=None,
                     choices=["SAFE", "BALANCED", "AGGRESSIVE"],
                     help="Only optimise this profile (default: all three)")
_args = _parser.parse_args()

LOOKBACK_DAYS = _args.lookback_days   # override global with CLI value

# ===================== DATA INGESTION =====================
csv_path = Path(_args.csv)
df = pd.read_csv(csv_path)

df["timestamp"] = pd.to_datetime(df["exit_ts"].astype(str), utc=True, errors="coerce")
df = df.dropna(subset=["timestamp", "mfe_pct", "mae_pct", "pnl_pct"]).reset_index(drop=True)

end_ts = df["timestamp"].max()
data_window = df[
    df["timestamp"] >= end_ts - timedelta(days=LOOKBACK_DAYS)
].reset_index(drop=True)


# ===================== WEIGHT SAMPLER =====================
def sample_weights(n):
    samples = []
    while len(samples) < n:
        w = np.random.dirichlet(np.ones(6))
        if np.all(w >= MIN_WEIGHT / 100):
            samples.append(w)
    return np.array(samples)


# ===================== BACKTEST (single) =====================
def backtest(data, tps, weights, sl):
    """Single weight-set backtest — kept for compatibility."""
    mfe = data["mfe_pct"].values
    mae = data["mae_pct"].values
    real_exit = data["pnl_pct"].values

    pnl = np.zeros(len(data))

    for i in range(len(data)):
        if mfe[i] < tps[0]:
            pnl[i] = max(mae[i], sl)
            continue

        trade_pnl = 0.0
        remaining = 1.0

        for tp, w in zip(tps, weights):
            if mfe[i] >= tp:
                trade_pnl += w * tp
                remaining -= w
            else:
                break

        if remaining > 0:
            trade_pnl += remaining * max(0.0, real_exit[i])

        pnl[i] = trade_pnl

    return pnl


# ===================== GPU DEVICE SETUP =====================
try:
    import torch as _torch
    _DEVICE = _torch.device("cuda") if _torch.cuda.is_available() else _torch.device("cpu")
    _USE_GPU = _DEVICE.type == "cuda"
    if _USE_GPU:
        print(f"  [GPU] Using {_torch.cuda.get_device_name(0)} for batch scoring")
    else:
        print("  [GPU] CUDA not available — using CPU")
except ImportError:
    _torch  = None
    _DEVICE = None
    _USE_GPU = False
    print("  [GPU] PyTorch not installed — using CPU")


# ===================== VECTORIZED BATCH BACKTEST =====================
def backtest_batch(data, tps, weight_matrix, sl):
    """
    Score thousands of weight sets simultaneously.
    Uses GPU (CUDA) if available, falls back to CPU NumPy automatically.

    weight_matrix : (N_candidates, 6) array — each row is one weight set
    Returns       : (N_candidates,) NumPy array of total PnL scores
    """
    mfe       = data["mfe_pct"].values
    mae       = data["mae_pct"].values
    real_exit = data["pnl_pct"].values
    tps_arr   = np.array(tps, dtype=np.float32)

    if _USE_GPU:
        # Move everything to GPU
        mfe_t    = _torch.tensor(mfe,          dtype=_torch.float32, device=_DEVICE)
        mae_t    = _torch.tensor(mae,          dtype=_torch.float32, device=_DEVICE)
        exit_t   = _torch.tensor(real_exit,    dtype=_torch.float32, device=_DEVICE)
        tps_t    = _torch.tensor(tps_arr,      dtype=_torch.float32, device=_DEVICE)
        wmat_t   = _torch.tensor(weight_matrix.astype(np.float32), device=_DEVICE)

        # tp_hit[t, k] = True if trade t reached TP k  →  (T, 6)
        tp_hit = mfe_t[:, None] >= tps_t[None, :]

        # trades that never reached TP1
        missed = ~tp_hit[:, 0]                                        # (T,)

        # TP contributions + remainder  →  (T, N)
        tp_contrib = (tp_hit.float() * tps_t[None, :]) @ wmat_t.T
        remaining  = _torch.clamp(1.0 - (tp_hit.float() @ wmat_t.T), min=0.0)
        rem_exit   = _torch.clamp(exit_t, min=0.0)
        pnl_matrix = tp_contrib + remaining * rem_exit[:, None]

        # Override missed-TP1 trades
        sl_pnl = _torch.clamp(
            _torch.tensor(mae, dtype=_torch.float32, device=_DEVICE),
            min=float(sl)
        )
        pnl_matrix[missed] = sl_pnl[missed, None].expand_as(pnl_matrix[missed])

        # Sum across trades → (N,) and return as NumPy
        return pnl_matrix.sum(dim=0).cpu().numpy()

    else:
        # CPU NumPy path
        tp_hit       = mfe[:, None] >= tps_arr[None, :]
        missed_first = ~tp_hit[:, 0]
        tp_contrib   = (tp_hit * tps_arr[None, :]) @ weight_matrix.T
        remaining    = np.maximum(1.0 - (tp_hit @ weight_matrix.T), 0.0)
        rem_exit     = np.maximum(real_exit, 0.0)
        pnl_matrix   = tp_contrib + remaining * rem_exit[:, None]
        sl_pnl       = np.maximum(mae, sl)
        pnl_matrix[missed_first, :] = sl_pnl[missed_first, None]
        return pnl_matrix.sum(axis=0)


def backtest_batch_compounded(data, tps, weight_matrix, sl, leverage):
    """
    Compute compounded equity for each candidate weight set.
    Uses GPU if available, falls back to CPU automatically.
    Returns (N,) NumPy array of final equity values.
    """
    mfe       = data["mfe_pct"].values
    mae       = data["mae_pct"].values
    real_exit = data["pnl_pct"].values
    tps_arr   = np.array(tps, dtype=np.float32)

    if _USE_GPU:
        mfe_t  = _torch.tensor(mfe,       dtype=_torch.float32, device=_DEVICE)
        mae_t  = _torch.tensor(mae,       dtype=_torch.float32, device=_DEVICE)
        exit_t = _torch.tensor(real_exit, dtype=_torch.float32, device=_DEVICE)
        tps_t  = _torch.tensor(tps_arr,   dtype=_torch.float32, device=_DEVICE)
        wmat_t = _torch.tensor(weight_matrix.astype(np.float32), device=_DEVICE)

        tp_hit    = mfe_t[:, None] >= tps_t[None, :]
        missed    = ~tp_hit[:, 0]
        tp_contrib = (tp_hit.float() * tps_t[None, :]) @ wmat_t.T
        remaining  = _torch.clamp(1.0 - (tp_hit.float() @ wmat_t.T), min=0.0)
        pnl_matrix = tp_contrib + remaining * _torch.clamp(exit_t, min=0.0)[:, None]
        sl_pnl = _torch.clamp(mae_t, min=float(sl))
        pnl_matrix[missed] = sl_pnl[missed, None].expand_as(pnl_matrix[missed])

        scaled = _torch.clamp(pnl_matrix * leverage / 100.0, min=-1.0)
        equity = _torch.prod(1.0 + scaled, dim=0) * START_CAPITAL
        return equity.cpu().numpy()

    else:
        tp_hit     = mfe[:, None] >= tps_arr[None, :]
        missed     = ~tp_hit[:, 0]
        tp_contrib = (tp_hit * tps_arr[None, :]) @ weight_matrix.T
        remaining  = np.maximum(1.0 - (tp_hit @ weight_matrix.T), 0.0)
        pnl_matrix = tp_contrib + remaining * np.maximum(real_exit, 0.0)[:, None]
        pnl_matrix[missed, :] = np.maximum(mae[missed, None], sl)
        scaled = np.maximum(pnl_matrix * leverage / 100.0, -1.0)
        return np.prod(1.0 + scaled, axis=0) * START_CAPITAL


# ===================== PROFILE ZONE CONSTRAINTS =====================
# Each profile defines which TPs should be the "dominant band"
# and hard min/max weight boundaries per slot.
#
# Safe       → front-heavy  : TP1-TP3 carry most weight
# Balanced   → mid-heavy    : TP2-TP4 carry most weight
# Aggressive → top-heavy    : TP3-TP5 carry most weight

PROFILE_ZONES = {
    "SAFE": {
        "dominant": [0, 1, 2],        # TP1-TP3 indices
        "min_dominant_share": 0.60,   # at least 60% in dominant band
        "max_tp6": 0.10,
        "min_each": 0.075,            # MIN_WEIGHT / 100
        "max_each": 0.40,
        "descending_12": True,        # w[0] >= w[1] >= w[2]
    },
    "BALANCED": {
        "dominant": [1, 2, 3],        # TP2-TP4 indices
        "min_dominant_share": 0.52,
        "max_tp6": 0.18,
        "min_each": 0.075,
        "max_each": 0.38,
        "descending_12": False,
    },
    "AGGRESSIVE": {
        "dominant": [2, 3, 4],        # TP3-TP5 indices
        "min_dominant_share": 0.50,
        "max_tp6": 0.11,
        "min_each": 0.075,
        "max_each": 0.38,
        "descending_12": False,
    },
}


def generate_candidates_for_profile(ladder_name, n_candidates, tp6_hitrate):
    """
    Generate a large batch of valid weight candidates for a given profile
    using the profile zone constraints.  Returns (M, 6) array where M <= n_candidates.
    """
    zone    = PROFILE_ZONES[ladder_name]
    min_w   = zone["min_each"]
    max_w   = zone["max_each"]
    dom     = zone["dominant"]
    min_dom = zone["min_dominant_share"]
    max_tp6 = zone["max_tp6"]
    desc12  = zone["descending_12"]

    # Also respect legacy valid_weights constraints for backward compat
    legacy_c = LADDER_WEIGHT_CONSTRAINTS[ladder_name]

    valid = []
    batch = 50_000   # generate in large batches for speed

    while len(valid) < n_candidates:
        # Sample from Dirichlet — naturally sums to 1
        raw = np.random.dirichlet(np.ones(6), size=batch)

        # Apply min/max per slot
        mask = np.all(raw >= min_w, axis=1) & np.all(raw <= max_w, axis=1)

        # Dominant band share
        dom_share = raw[:, dom].sum(axis=1)
        mask &= dom_share >= min_dom

        # TP6 cap
        mask &= raw[:, 5] <= max_tp6

        # TP6 hitrate guard
        if tp6_hitrate < legacy_c.get("min_tp6_hitrate", 0) and max_tp6 > 0.12:
            mask &= raw[:, 5] <= 0.12

        # Descending structure for SAFE (w0 >= w1 >= w2)
        if desc12:
            mask &= (raw[:, 0] >= raw[:, 1]) & (raw[:, 1] >= raw[:, 2])

        # Legacy min_front check
        if "min_front" in legacy_c:
            front = raw[:, 0] + raw[:, 1] + raw[:, 2]
            mask &= front >= legacy_c["min_front"]

        # Legacy min_tp1
        if "min_tp1" in legacy_c:
            mask &= raw[:, 0] >= legacy_c["min_tp1"]

        valid.append(raw[mask])

        if sum(len(v) for v in valid) >= n_candidates * 3:
            break

    candidates = np.vstack(valid)
    # Renormalize to exact sum=1 (Dirichlet already does this but after masking rows may drift)
    candidates = candidates / candidates.sum(axis=1, keepdims=True)
    # Shuffle and take first n_candidates
    idx = np.random.permutation(len(candidates))[:n_candidates]
    return candidates[idx]


def score_candidates(scores, weight_matrix, ladder_name):
    """
    Apply profile-aware structure bonus/penalty on top of raw PnL scores.
    Fully vectorized — operates on (N,) scores and (N,6) weights.
    Returns adjusted (N,) scores.
    """
    w = weight_matrix  # (N, 6)

    if ladder_name == "SAFE":
        # Reward front-heavy: TP1 and TP2 dominance
        structure = (
            1.0
            + w[:, 0] * 2.0          # strong TP1 reward
            + w[:, 1] * 0.8          # moderate TP2 reward
            - (w[:, 2] + w[:, 3]) * 1.2   # penalize mid overweight
        )

    elif ladder_name == "BALANCED":
        # Reward mid band TP2-TP4, penalize single dominance
        mid234    = w[:, 1] + w[:, 2] + w[:, 3]
        early12   = w[:, 0] + w[:, 1]
        dom_pen   = w.max(axis=1) * 0.25
        mid_diff  = np.abs(w[:, 2] - w[:, 3])
        structure = (
            1.0
            + mid234  * 0.6
            + early12 * 0.3
            + w[:, 1] * 0.4
            - dom_pen
            - mid_diff * 0.6
        )

    elif ladder_name == "AGGRESSIVE":
        # Reward TP3-TP5 band, penalize spikes and TP6 overweight
        mid_band  = w[:, 2] + w[:, 3] + w[:, 4]
        tp4_pen   = np.maximum(w[:, 3] - 0.25, 0.0) * 3.5
        tp5_pen   = np.maximum(w[:, 4] - 0.24, 0.0) * 3.0
        tp6_pen   = np.maximum(w[:, 5] - 0.13, 0.0) * 4.0
        dom_pen   = np.maximum(w.max(axis=1) - 0.28, 0.0) * 4.0
        structure = (
            1.0
            + mid_band  * 0.8
            + w[:, 1]   * 1.2
            + w[:, 0]   * 0.4
            - tp4_pen - tp5_pen - tp6_pen - dom_pen
        )

    else:
        structure = np.ones(len(scores))

    return scores * np.maximum(structure, 0.01)


def refine_single(data, tps, w_init, ladder_name, tp6_hitrate,
                  step=0.01, max_passes=20):
    """
    Local hill-climb refinement for a single candidate.
    Kept as final polish step after the global search finds a good region.
    """
    w = w_init.copy()
    pnl = backtest(data, tps, w, STOPLOSS)
    raw_score = pnl.sum()
    best_score = score_candidates(
        np.array([raw_score]), w[None, :], ladder_name
    )[0]

    for _ in range(max_passes):
        improved = False
        for i in range(len(w)):
            for direction in (+1, -1):
                w_try = w.copy()
                w_try[i] += direction * step
                others = [j for j in range(len(w)) if j != i]
                w_try[others] -= direction * step / len(others)

                if np.any(w_try < MIN_WEIGHT / 100):
                    continue
                if not valid_weights(w_try, ladder_name, tp6_hitrate):
                    continue

                w_try = np.clip(w_try, 0, None)
                w_try /= w_try.sum()

                pnl_try = backtest(data, tps, w_try, STOPLOSS)
                s = score_candidates(
                    np.array([pnl_try.sum()]), w_try[None, :], ladder_name
                )[0]

                if s > best_score:
                    w = w_try
                    best_score = s
                    improved = True
                    break
            if improved:
                break
        if not improved:
            break

    return w, best_score


# Legacy wrapper — keeps rest of file working unchanged
def refine_weights(data, tps, base_weights, stoploss, ladder_name,
                   tp6_hitrate, step=0.015, max_passes=15):
    return refine_single(data, tps, base_weights, ladder_name,
                         tp6_hitrate, step=step, max_passes=max_passes)


def compound_with_leverage(pnl_series, leverage, start_capital=START_CAPITAL):
    equity = float(start_capital)
    for trade_ret in pnl_series:
        equity *= (1.0 + (trade_ret / 100.0) * leverage)
        if equity <= 0:
            equity = 0.0
            break
    return equity




def valid_weights(w, ladder_name, tp6_hitrate=None):
    c = LADDER_WEIGHT_CONSTRAINTS[ladder_name]

    tail = w[4] + w[5]
    tp6 = w[5]

    # ---- UNIVERSAL CONSTRAINTS ----
    if tail > c["max_tail"]:
        return False

    if tp6 > c["max_tp6"]:
        return False

    if tp6_hitrate is not None:
        if tp6_hitrate < c["min_tp6_hitrate"] and tp6 > 0.12:
            return False

    # ---- SAFE PROFILE RULES ----
    if ladder_name == "SAFE":

        # TP1 hard band
        if w[0] < 0.17 or w[0] > 0.26:
            return False

        # Early locking bias
        front12 = w[0] + w[1]
        if front12 < 0.35:
            return False

        # Optional descending structure
        if not (w[0] >= w[1] >= w[2]):
            return False
        
    if ladder_name == "AGGRESSIVE":
        if w[5] > 0.11:
            return False

    # ---- OTHER PROFILES ----
    else:
        front = w[0] + w[1] + w[2]
        if front < c["min_front"]:
            return False

    return True


import json

def json_block(obj):
    return (
        "<pre style='background:#020617;"
        "color:#e5e7eb;"
        "padding:12px;"
        "border-radius:8px;"
        "font-size:18px;"
        "overflow-x:auto;'>"
        + json.dumps(obj, indent=2)
        + "</pre>"
    )

def json_block_inline(payload):
    return (
        "<pre style='white-space: pre-wrap; word-break: break-word;'>"
        + json.dumps(payload, separators=(",", ":"))
        + "</pre>"
    )

def round_weights_exact_100(weights, decimals=2):
    """
    Round weights to fixed decimals while forcing exact sum = 1.00.
    Uses largest remainder method.
    """
    scale = 10 ** decimals

    # convert to scaled integers
    raw = np.array(weights) * scale
    floored = np.floor(raw)
    remainder = raw - floored

    total_floor = int(floored.sum())
    target_total = int(scale)  # 1.00 scaled

    diff = target_total - total_floor

    # distribute remaining units to largest remainders
    if diff > 0:
        idx = np.argsort(-remainder)
        for i in idx[:diff]:
            floored[i] += 1

    return (floored / scale).tolist()



def export_ladder_json(out_dir, ladder_name, payload):
    path = out_dir / f"{ladder_name.lower()}.json"

    text = (
        "{\n"
        f'  "tp": {payload["tp"]},\n'
        f'  "w":  {payload["w"]},\n'
        f'  "sl": {payload["sl"]},\n'
        f'  "be": {payload["be"]},\n'
        f'  "lev": {payload["lev"]}\n'
        "}\n"
    )

    try:
        path.write_text(text, encoding="utf-8")
        print(f"EXPORTED {path.name}")
    except PermissionError:
        alt = out_dir / f"{ladder_name.lower()}_new.json"
        alt.write_text(text, encoding="utf-8")
        print(f"[WARN] {path.name} locked — wrote {alt.name} instead")

def export_combined_profiles(out_dir, filename, profiles):
    """
    Updates or creates combined strategy JSON.
    Only overwrites:
        - profiles
    Leaves everything else intact.
    """

    path = out_dir / filename

    # Load existing file if present
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
    else:
        existing = {}

    # Update profiles block
    existing["profiles"] = profiles

    # REMOVE timestamp if it exists
    if "last_engine_run_utc" in existing:
        del existing["last_engine_run_utc"]

    # Write file
    path.write_text(
        json.dumps(existing, indent=2, sort_keys=True),
        encoding="utf-8"
    )

    print(f"UPDATED {path.name}")

def tp_continuation_stats(data, tps):
    """
    Returns list of dicts with:
    - hit_rate
    - continuation_rate
    """
    mfe = data["mfe_pct"].values[:, None]
    hits = mfe >= tps[None, :]

    stats = []

    for i in range(len(tps)):
        hit_rate = hits[:, i].mean()

        if i < len(tps) - 1:
            cont = (
                hits[:, i + 1][hits[:, i]].mean()
                if hits[:, i].any()
                else 0.0
            )
        else:
            cont = np.nan  # no continuation after last TP

        stats.append({
            "hit": hit_rate,
            "cont": cont
        })

    return stats




# ===================== PSYCHOLOGY =====================
def psychological_score(pnl):
    early = pnl[:PSYCH_TRADE_WINDOW]
    if len(early) == 0:
        return 0.0

    win_rate = (early > 0).mean()
    cum = early.cumsum()

    if np.any(cum > 0):
        t = np.argmax(cum > 0)
        time_score = 1.0 - t / PSYCH_TRADE_WINDOW
    else:
        time_score = 0.0

    return 0.6 * win_rate + 0.4 * time_score

def tp_contribution_share(data, tps, w):
    mfe = data["mfe_pct"].values[:, None]
    tp_hits = mfe >= tps[None, :]
    contrib = (tp_hits * w * tps).mean(axis=0)
    s = contrib.sum()
    return contrib / s if s > 0 else np.zeros_like(contrib)

def dominance_penalty(contrib):
    excess = np.maximum(0, contrib - DOMINANCE_MAX)
    return DOMINANCE_PENALTY_LAMBDA * np.sum(excess**2)

# ===================== OPTIMIZATION =====================
results = {}

# If --profile passed, only run that one ladder (used when called in parallel)
_active_ladders = (
    {_args.profile: TP_LADDERS[_args.profile]}
    if _args.profile
    else TP_LADDERS
)

for ladder_name, hitrates in _active_ladders.items():
   
    # ---- build TP ladder ----
    tps = np.percentile(
            data_window["mfe_pct"].values,
        (1 - np.array(hitrates)) * 100
    )

    # ---- INITIALIZE RESULT ENTRY FIRST ----
    results[ladder_name] = {
        "TPS": tps,
        "PRESETS": {},
        "CONTINUATION": {}   # <-- initialize immediately
    }

    # ---- compute continuation stats ----
    mfe = data_window["mfe_pct"].values
    cont = {}

    for i in range(len(tps)):
        if i == len(tps) - 1:
            cont[f"TP{i+1}→END"] = 1.0
        else:
            hit_i = mfe >= tps[i]
            hit_next = mfe >= tps[i+1]
            cont[f"TP{i+1}→TP{i+2}"] = (
                hit_next[hit_i].mean() if hit_i.any() else 0.0
            )

    results[ladder_name]["CONTINUATION"] = cont


    tps = np.maximum(tps, MIN_TP_PCT)

    # ---- Dynamic TP1 minimum based on trade volatility ----
    # TP1 must be a meaningful distance from entry — at least X times the
    # median trade volatility so it sits above noise level.
    # Safe is closest (front-heavy, wants TP1 hit often),
    # Aggressive is furthest (top-heavy, only strong moves trigger TP1).
    TP1_VOL_MULTIPLIER = {
        "SAFE":       1.2,
        "BALANCED":   1.5,
        "AGGRESSIVE": 2.0,
    }
    TP1_HARD_FLOOR = {
        "SAFE":       0.3,
        "BALANCED":   0.4,
        "AGGRESSIVE": 0.5,
    }

    # Use volatility_pct from trades if available, else fall back to MFE std
    if "volatility_pct" in data_window.columns:
        median_vol = float(data_window["volatility_pct"].median())
    else:
        median_vol = float(data_window["mfe_pct"].std())

    vol_mult  = TP1_VOL_MULTIPLIER[ladder_name]
    hard_floor = TP1_HARD_FLOOR[ladder_name]
    tp1_min   = max(median_vol * vol_mult, hard_floor)

    if tps[0] < tp1_min:
        print(f"  [{ladder_name}] TP1 {tps[0]:.3f}% below minimum "
              f"({vol_mult}× vol={median_vol:.3f}% → min={tp1_min:.3f}%) "
              f"— adjusting TP1: {tps[0]:.3f}% → {tp1_min:.3f}%")
        tps[0] = tp1_min
    else:
        print(f"  [{ladder_name}] TP1 {tps[0]:.3f}% — OK "
              f"(min={tp1_min:.3f}%, {vol_mult}× vol={median_vol:.3f}%)")

    # Update stored TPS so HTML report, Parameters sheet and JSON all
    # reflect the adjusted TP1 value
    results[ladder_name]["TPS"] = tps.copy()

    # --- TP6 hitrate ---
    tp6_hitrate = (
        data_window["mfe_pct"] >= tps[5]
    ).mean()


    results[ladder_name]["PRESETS"] = {}

    # --------------------------------------------------
    # 1️⃣ Evaluate presets (for reference/reporting)
    # --------------------------------------------------

    for pname, pw in PRESET_WEIGHTS.items():
        pnl = backtest(data_window, tps, pw, STOPLOSS)

        results[ladder_name]["PRESETS"][pname] = {
            "fixed": pnl.sum(),
            "avg": pnl.mean(),
            "weights": pw,
        }

    # --------------------------------------------------
    # 2️⃣ Global search (vectorized batch) + local refinement
    # --------------------------------------------------

    base_preset  = LADDER_BASE_PRESET[ladder_name]
    base_weights = PRESET_WEIGHTS[base_preset]
    leverage     = LADDER_LEVERAGE[ladder_name]

    # --------------------------------------------------
    # Phase 0: Token-specific hit-rate bias
    # --------------------------------------------------
    # Compute actual TP hit rates from real trade data.
    # Use these to build a data-informed starting weight —
    # tokens that frequently hit TP3 get more weight there,
    # tokens that rarely reach TP5 get less.
    mfe_vals = data_window["mfe_pct"].values
    tp_hitrates = np.array([(mfe_vals >= tp).mean() for tp in tps])  # (6,)

    # Normalize hit rates into a probability weight vector
    # Then blend 50/50 with the profile preset so the profile
    # shape is respected but token behaviour nudges the starting point
    hr_sum = tp_hitrates.sum()
    if hr_sum > 1e-9:
        hr_weights = tp_hitrates / hr_sum
    else:
        hr_weights = np.ones(6) / 6.0

    # Blend: 50% hit-rate informed, 50% profile preset
    blended_start = 0.5 * hr_weights + 0.5 * base_weights
    blended_start = np.clip(blended_start, MIN_WEIGHT / 100, None)
    blended_start /= blended_start.sum()

    # Validate — if it violates profile constraints fall back to preset
    if not valid_weights(blended_start, ladder_name, tp6_hitrate):
        blended_start = base_weights.copy()

    print(f"  [{ladder_name}] TP hit rates: " +
          " | ".join(f"TP{i+1}={tp_hitrates[i]*100:.1f}%" for i in range(6)))
    print(f"  [{ladder_name}] Blended start: " +
          " | ".join(f"TP{i+1}={blended_start[i]*100:.1f}%" for i in range(6)))

    # --- Phase 1: generate large candidate pool and score in batch ---
    N_CANDIDATES = 50_000
    print(f"  [{ladder_name}] Generating {N_CANDIDATES:,} candidates...")

    candidates_batch = generate_candidates_for_profile(
        ladder_name, N_CANDIDATES, tp6_hitrate
    )

    # Always include presets + blended start as candidates
    preset_arr = np.array(list(PRESET_WEIGHTS.values()))
    candidates_batch = np.vstack([preset_arr, blended_start[None, :], candidates_batch])

    # Score all candidates at once (vectorized)
    raw_scores = backtest_batch(data_window, tps, candidates_batch, STOPLOSS)
    adj_scores = score_candidates(raw_scores, candidates_batch, ladder_name)

    # Pick top-K for local refinement
    TOP_K = 20
    top_idx = np.argpartition(adj_scores, -TOP_K)[-TOP_K:]
    top_candidates = candidates_batch[top_idx]

    print(f"  [{ladder_name}] Refining top {TOP_K} candidates...")

    # --- Phase 2: local hill-climb refinement on best candidates ---
    # Also always refine the blended start independently
    best_fixed = -1e9
    best_w = None

    for init_w in list(top_candidates) + [blended_start]:
        rw, rf = refine_single(
            data_window, tps, init_w, ladder_name, tp6_hitrate,
            step=0.01 if ladder_name == "SAFE" else 0.015,
            max_passes=25
        )
        if rf > best_fixed:
            best_fixed = rf
            best_w = rw

    # Fallback to preset if everything failed
    if best_w is None:
        best_w, best_fixed = refine_single(
            data_window, tps, base_weights, ladder_name, tp6_hitrate
        )

    results[ladder_name]["OPTIMIZED"] = {
        "fixed": best_fixed,
        "avg": best_fixed / len(data_window),
        "weights": best_w,
    }


    # ===================== LADDER SUMMARY (OPTIMIZED) =====================

    if "OPTIMIZED" not in results[ladder_name]:
        raise RuntimeError(f"No optimized result for ladder {ladder_name}")

    pdata = results[ladder_name]["OPTIMIZED"]

    pnl_series = backtest(
        data_window,
        results[ladder_name]["TPS"],
        pdata["weights"],
        STOPLOSS
    )

    leverage = LADDER_LEVERAGE[ladder_name]

    final_equity = compound_with_leverage(
        pnl_series,
        leverage=leverage
    )

    results[ladder_name]["SUMMARY"] = {
        "weights": pdata["weights"].copy(),
        "fixed": pnl_series.sum(),
        "avg": pnl_series.mean(),
        "final_equity": final_equity,
        "return_pct": (final_equity / START_CAPITAL - 1) * 100,
        "loss_rate": (pnl_series < 0).mean(),
        "leverage": leverage,
    }
    
    # ---- AUTO EXPORT (ENGINE FORMAT) ----

    rounded_weights = round_weights_exact_100(pdata["weights"], decimals=2)

    export_payload = {
        "tp": [round(float(x), 2) for x in results[ladder_name]["TPS"]],
        "w":  [round(float(x), 2) for x in pdata["weights"]],
        "sl": abs(int(STOPLOSS)),
        "be": 1,                  # BE is always on in this engine
        "lev": int(leverage),
    }

    export_ladder_json(csv_path.parent, ladder_name, export_payload)

# =========================================
# Combined JSON Export (All Profiles)
# =========================================

combined_profiles = {}

for ladder_name in results:
    s = results[ladder_name]["SUMMARY"]

    rounded_weights = round_weights_exact_100(s["weights"], decimals=2)

    combined_profiles[ladder_name.lower()] = {
        "tp": [round(float(x), 2) for x in results[ladder_name]["TPS"]],
        "w":  rounded_weights,
        "sl": abs(float(STOPLOSS)),
        "be": 1,
        "lev": int(s["leverage"]),
    }

export_combined_profiles(
    csv_path.parent,
    "strategy_profiles.json",
    combined_profiles
)


# ===================== HTML REPORT =====================
html = []
html.append("""
<style>
body {
    background:#0f1116;
    color:#e5e7eb;
    font-family: Inter, Arial, sans-serif;
    margin: 0;
    padding: 24px;
}

.container {
    max-width: 1100px;
    margin: auto;
}

h1 {
    margin-bottom: 32px;
}

h2 {
    margin-top: 48px;
    margin-bottom: 8px;
}

h3 {
    margin-top: 24px;
    margin-bottom: 8px;
    color: #cbd5f5;
}

.card {
    background: #111827;
    border: 1px solid #1f2937;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 24px;
}

table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 16px;
}

th, td {
    border: 1px solid #1f2937;
    padding: 6px 8px;
    text-align: right;
    font-size: 13px;
}

th {
    background: #1f2937;
    text-align: center;
    font-weight: 600;
}

td.label {
    text-align: left;
    font-weight: 500;
}

.badge {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 6px;
    margin-left: 6px;
}

.safe .badge.best { background: #14532d; }
.balanced .badge.best { background: #1e3a8a; }
.aggressive .badge.best { background: #7f1d1d; }


.badge.pref {
    background: #1e3a8a;
    color: #60a5fa;
}
/* Ladder color themes */
.safe {
    border-left: 4px solid #22c55e;   /* green */
}

.balanced {
    border-left: 4px solid #3b82f6;   /* blue */
}

.aggressive {
    border-left: 4px solid #ef4444;   /* red */
}

.safe h2, .safe h3 {
    color: #86efac;
}

.balanced h2, .balanced h3 {
    color: #93c5fd;
}

.aggressive h2, .aggressive h3 {
    color: #fca5a5;
}

</style>
""")
html.append("<div class='container'>")
html.append(f"<h1>Strategy Engine Report ({LOOKBACK_DAYS} D)</h1>")
html.append(f"<p><b>Stoploss:</b> {STOPLOSS}%</p>")

for ladder, r in results.items():
    preferred = LADDER_PREFERRED_PRESET.get(ladder)
    best_by_pnl = max(
        r["PRESETS"],
        key=lambda p: r["PRESETS"][p]["avg"]
    )

    ladder_class = ladder.lower()

    html.append(f"<div class='card {ladder_class}'>")
    html.append(f"<h2>{ladder} Ladder</h2>")


    # ---- TP LEVELS ----
    html.append("<h3>TP Levels</h3>")
    html.append("<table>")
    html.append("<tr><th>TP</th><th>Target (%)</th></tr>")
    for i, tp in enumerate(r["TPS"], start=1):
        html.append(
            f"<tr>"
            f"<td class='label'>TP{i}</td>"
            f"<td>{fmt(tp,2)}%</td>"
            f"</tr>"
        )
    html.append("</table>")

    # ---- TP CONTINUATION ----
    html.append("<table>")

    cont = r.get("CONTINUATION", {})

    if cont:
        html.append("<h3>TP Continuation Rates</h3>")
        html.append("<table>")
        html.append("<tr><th>From → To</th><th>Probability</th></tr>")

        for k, v in cont.items():
            html.append(
                f"<tr>"
                f"<td class='label'>{k}</td>"
                f"<td>{fmt(v * 100, 1)}%</td>"
                f"</tr>"
            )

        html.append("</table>")
    else:
        html.append("<p><i>No continuation data available</i></p>")

    # ---- OPTIMIZED WEIGHTS ----
    if "SUMMARY" not in r:
        raise RuntimeError(f"SUMMARY missing for {ladder}")

    s = r["SUMMARY"]
    pw = round_weights_exact_100(s["weights"], decimals=2)

    rounded_weights = round_weights_exact_100(s["weights"], decimals=2)

    html.append("<h3>Optimized Weights</h3>")
    html.append("<table>")
    html.append("<tr><th>TP</th><th>Weight (%)</th></tr>")

    for i, w in enumerate(rounded_weights, start=1):
        html.append(
            f"<tr>"
            f"<td class='label'>TP{i}</td>"
            f"<td>{w*100:.2f}%</td>"
            f"</tr>"
        )

    html.append("</table>")
    html.append("</div>") 

    """
    # ---- OPTIMIZED ----
    html.append("<h3>Optimized Weights</h3>")
    html.append("<table><tr><th>Mode</th>")
    for i in range(6):
        html.append(f"<th>TP{i+1}</th>")
    html.append("</tr>")

    w_be = r["OPT"][True]
    w_nb = r["OPT"][False]

    if weights_equal(w_be, w_nb):
        html.append("<tr><td>BE / NO-BE</td>")
        for x in w_be:
            html.append(f"<td>{fmt(x*100,2)}%</td>")
        html.append("</tr>")
    else:
        for be, w in [(True, w_be), (False, w_nb)]:
            html.append(f"<tr><td>{'BE' if be else 'NO-BE'}</td>")
            for x in w:
                html.append(f"<td>{fmt(x*100,2)}%</td>")
            html.append("</tr>")

    html.append("</table>")
    """
html.append("</div>")          # close container
html.append("</body></html>")
out = csv_path.with_suffix(".strategy_report.html")
out.write_text("\n".join(html), encoding="utf-8")
print(f"Report written to: {out}")

