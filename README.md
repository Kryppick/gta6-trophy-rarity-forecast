# gta6-trophy-rarity-forecast-01

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Kryppick/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Kryppick/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecasts every GTA VI PlayStation 5 trophy's earn rate on Exophase at 2026-11-26T00:00:00Z, as five quantiles per trophy, from the house's reads of the trophy page up to the deadline.

The model treats an earn rate as a ratio, not a number: it extrapolates players tracked and earners per trophy separately as power laws in log-time since the first read, then divides them at the target. That matters because on launch night Exophase's page sat frozen for hours and then one refresh revealed the player flood — new players join far faster than they earn trophies, so rates fall while the player count jumps. When the history is flat (no refresh seen yet), priors take over: players grow with a log-time slope of ~1.06 (the launch-night 638 → 3,868 refresh implies it) and each trophy's earners grow slower, slower still for rarer trophies. Spreads are logit-normal and widen with the horizon plus a refresh-shock term that is large on short horizons — the practice cases prove a refresh the model has not seen yet can move every rate at once.

Pure Node 22 standard library, offline, deterministic. On the practice cases it scores roughly 0.2–0.3 mean pinball loss on the logit scale under every plausible reading of the refresh answer, against the house baseline's ~1.51; on a synthetic final-like case with 120 reads over 2.5 days it scores ~0.28 against the baseline's ~1.70.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
