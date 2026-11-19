// gta6-trophy-rarity-forecast-01 — forecast Exophase GTA VI trophy earn rates.
//
// Idea: an earn rate is a ratio, rate = earners / players_tracked, and the two
// sides move on very different clocks. On launch night Exophase's page sat
// frozen for hours (638 players, every rate unchanged) and then one refresh
// revealed the flood: 3,868 players, almost every rate down. New players join
// far faster than they earn trophies, so a rate falls while the player count
// jumps, and only climbs back as players progress through the game.
//
// So instead of extrapolating the rate itself, this program extrapolates the
// two counts separately — players_tracked and earners per trophy — as power
// laws in log-time since the first read, and divides them at the target:
//   P(t)   = exp(aP + bP * ln(1 + h))
//   E_i(t) = exp(a_i + b_i * ln(1 + h))
//   rate_i(target) = 100 * E_i(target) / P(target)
// with h in hours since the case's first read. Slopes come from least squares
// over the case's distinct reads (consecutive identical reads are Exophase
// plateaus, not new information, so they are collapsed first). When the
// history is flat — every read identical, as on launch night — no slope is
// identified, so priors take over: players grow with slope ~1.06 (the
// launch-night refresh, 638 -> 3,868 players, implies that slope), and each
// trophy's earners grow slower, with a slope scaled by how common the trophy
// already is (a trophy everyone holds tracks players 1:1; a rare grind
// trophy barely moves). A trophy at 100% stays at 100%: every new player
// earns it on arrival.
//
// Quantiles are logit-normal around the median: sigma combines a random-walk
// term that grows with the horizon (0.40 * sqrt(days)), a refresh-shock term
// that is large on short horizons and vanishes over days
// (0.70 * exp(-days)), and the per-trophy fit residual. The spread is honest
// about the one thing the practice cases prove: a refresh the model has not
// seen yet can move every rate at once. The median itself is damped toward
// the last displayed rate when the history is rich — a fitted power law
// keeps the early steep climb going past the target, but real earn rates
// saturate — while a flat history stands undamped on the structural prior.
//
// Pure Node 22 standard library. No network, no randomness, no clock reads:
// the same case always produces the same bytes.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Standard-normal quantiles at the case's levels.
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

// logit of a percent, clamped to the range the page can print.
function logit(pct) {
  const p = clamp(pct, 0.01, 99.99) / 100;
  return Math.log(p / (1 - p));
}

function invLogit(l) {
  return 100 / (1 + Math.exp(-l));
}

// Ordinary least squares of ys on xs. Returns null when the fit is
// unidentified (fewer than two points, or no spread in xs).
function ols(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx < 1e-12) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (a + b * xs[i]);
    ss += r * r;
  }
  return { a, b, resid: Math.sqrt(ss / Math.max(1, n - 2)) };
}

// Last non-null rate of trophy i across the distinct reads, or null.
function lastKnownRate(distinct, i) {
  for (let j = distinct.length - 1; j >= 0; j--) {
    const r = distinct[j].h.rates[i];
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

function forecastCase(c) {
  const trophies = c.trophies || [];
  const history = c.history || [];
  const horizonDays = (c.horizon_minutes || 0) / 1440;

  // No history at all: say 1% with a wide band rather than crashing.
  if (history.length === 0) {
    return {
      trophies: trophies.map((t) => ({
        id: t.id,
        q: Z.map((z) => +clamp(invLogit(logit(1) + z * 1.5), 0.01, 99.99).toFixed(4)),
      })),
    };
  }

  const t0 = new Date(history[0].slot || history[0].at).getTime();
  const tTargetRaw = new Date(c.target).getTime();
  // Trust the case's target clock; if it is unusable, fall back to the
  // horizon so a bad timestamp can never poison the forecast with NaNs.
  const hTarget = Number.isFinite(tTargetRaw)
    ? Math.max(0, (tTargetRaw - t0) / 3600000)
    : (c.horizon_minutes || 0) / 60;
  const xTarget = Math.log1p(hTarget);

  // Collapse consecutive identical reads: a frozen Exophase page repeated
  // every 30 minutes is one observation, not many.
  const distinct = [];
  for (const h of history) {
    const key = h.players_tracked + "|" + (h.rates || []).join(",");
    if (distinct.length === 0 || distinct[distinct.length - 1].key !== key) {
      distinct.push({ key, h });
    }
  }
  const xs = distinct.map(({ h }) =>
    Math.log1p(Math.max(0, (new Date(h.slot || h.at).getTime() - t0) / 3600000)),
  );

  // --- players_tracked at the target -------------------------------------
  const fitP = ols(xs, distinct.map(({ h }) => Math.log(Math.max(1, h.players_tracked))));
  // Launch-night prior: the 638 -> 3,868 refresh over ~4.7 h implies a
  // log-time slope of about 1.06. Used only when the history is flat.
  const betaP = fitP ? clamp(fitP.b, 0.1, 2.5) : 1.06;
  const aP = fitP ? fitP.a : Math.log(Math.max(1, distinct[0].h.players_tracked)) - betaP * xs[0];
  const playersTarget = Math.exp(aP + betaP * xTarget);
  const xLast = xs[xs.length - 1];

  // --- per-trophy earners at the target ----------------------------------
  const rows = [];
  for (let i = 0; i < trophies.length; i++) {
    const rLast = lastKnownRate(distinct, i);
    let earnersTarget;
    let sigFit = 0.45; // prior residual when no fit is identified

    if (rLast !== null && rLast >= 99.99) {
      // Held by (nearly) everyone: every new player earns it on arrival.
      earnersTarget = playersTarget;
      sigFit = 0.15;
    } else {
      // Points where this trophy had earners, deduplicated.
      const pts = [];
      for (let j = 0; j < distinct.length; j++) {
        const r = distinct[j].h.rates[i];
        if (r !== null && r !== undefined && r > 0) {
          pts.push({ x: xs[j], y: Math.log((r * distinct[j].h.players_tracked) / 100) });
        }
      }
      const u = [];
      for (const p of pts) {
        if (u.length === 0 || Math.abs(u[u.length - 1].y - p.y) > 1e-9) u.push(p);
      }
      const fitE = u.length >= 2 ? ols(u.map((p) => p.x), u.map((p) => p.y)) : null;
      if (fitE) {
        const g = clamp(fitE.b, 0, 3);
        earnersTarget = Math.exp(fitE.a + g * xTarget);
        sigFit = clamp(fitE.resid, 0.1, 1.2);
      } else {
        // Flat history: earners grow slower than players, and slower still
        // for rarer trophies — a new player has had less time to earn them.
        const anchor = u.length > 0 ? u[u.length - 1] : null;
        const earnersAnchor = anchor ? Math.exp(anchor.y) : 0.5;
        const xAnchor = anchor ? anchor.x : xLast;
        const common = clamp(rLast === null ? 0 : rLast, 0, 100) / 100;
        const gamma = betaP * (0.3 + 0.6 * common);
        earnersTarget = earnersAnchor * Math.exp(gamma * (xTarget - xAnchor));
      }
      earnersTarget = clamp(earnersTarget, 0, playersTarget);
    }

    const median = clamp((100 * earnersTarget) / playersTarget, 0.01, 99.99);

    // Damp the extrapolated move toward the last displayed rate. A power
    // law fitted on the history keeps the early steep climb going past the
    // target, but real earn rates saturate as players finish content, so
    // the honest median sits between the trend and persistence. The weight
    // on the trend grows with how much the history actually says: when the
    // history is flat (one distinct read — launch night) there is no trend
    // to damp and the structural forecast stands on its own (w = 1); with
    // a rich history the trend gets w = 0.6. The 100% trophy is exempt:
    // every new player earns it, so it stays at 100%.
    let damped = median;
    if (rLast !== null && rLast < 99.99) {
      const nDistinct = distinct.length;
      const w = 0.6 + 0.4 * Math.exp(-(nDistinct - 1) / 3);
      damped = clamp(
        invLogit(w * logit(median) + (1 - w) * logit(rLast)),
        0.01,
        99.99,
      );
    }

    // --- spread on the logit scale ---------------------------------------
    const sigTrend = 0.4 * Math.sqrt(horizonDays);
    const sigRefresh = 0.7 * Math.exp(-horizonDays);
    const sigma = clamp(
      Math.sqrt(sigTrend * sigTrend + sigRefresh * sigRefresh + sigFit * sigFit),
      0.3,
      2.2,
    );
    const m = logit(damped);
    const q = Z.map((z) => +clamp(invLogit(m + z * sigma), 0.01, 99.99).toFixed(4));
    // Rounding can only tie neighbours, never invert them; enforce it anyway.
    for (let k = 1; k < q.length; k++) {
      if (q[k] < q[k - 1]) q[k] = q[k - 1];
    }
    rows.push({ id: trophies[i].id, q });
  }
  return { trophies: rows };
}

// Fallback when a case cannot be forecast at all: persistence with the
// house baseline's spread, so the case stays valid instead of crashing.
function fallbackCase(c) {
  const trophies = c.trophies || [];
  const history = c.history || [];
  const last = history.length > 0 ? history[history.length - 1] : null;
  const dDays = (c.horizon_minutes || 0) / 1440;
  const sig = 0.5 * Math.sqrt(dDays);
  return {
    trophies: trophies.map((t, i) => {
      const r = last && last.rates && last.rates[i] != null ? last.rates[i] : 1;
      const q = Z.map((z) => +clamp(invLogit(logit(r) + z * sig), 0.01, 99.99).toFixed(4));
      for (let k = 1; k < q.length; k++) {
        if (q[k] < q[k - 1]) q[k] = q[k - 1];
      }
      return { id: t.id, q };
    }),
  };
}

function main() {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outputDir, { recursive: true });
  const files = readdirSync(inputDir)
    .filter((f) => f.endsWith(".in"))
    .sort();
  for (const file of files) {
    const c = JSON.parse(readFileSync(join(inputDir, file), "utf8"));
    let out;
    try {
      out = forecastCase(c);
    } catch {
      out = fallbackCase(c);
    }
    const id = file.replace(/\.in$/, "");
    // A forecast with a non-finite number would be an invalid case; fall
    // back to persistence instead of writing it.
    let valid = out && Array.isArray(out.trophies) && out.trophies.length === (c.trophies || []).length;
    if (valid) {
      for (const row of out.trophies) {
        if (!row || !Array.isArray(row.q) || row.q.length !== 5) { valid = false; break; }
        for (const q of row.q) {
          if (!Number.isFinite(q) || q < 0 || q > 100) { valid = false; break; }
        }
        if (!valid) break;
      }
    }
    if (!valid) out = fallbackCase(c);
    writeFileSync(join(outputDir, id + ".out"), JSON.stringify(out) + "\n", "utf8");
  }
}

main();
