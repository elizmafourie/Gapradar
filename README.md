# GapRadar

A private, single-user research dashboard that scans Reddit for recurring complaints, unmet needs, and "I'd pay for this" requests, cross-references them with Google Trends data, and surfaces validated digital-product opportunities.

## Quick Start

```bash
bun install
bash scripts/run-daily.sh
```

This runs the full pipeline: Reddit scraping → Google Trends enrichment → opportunity scoring. Results appear in `data/daily_report.json`.

### Custom data directory

By default, all pipeline output goes to `./data/`. Override with:

```bash
export GAPRADAR_DATA_DIR=/path/to/custom/data
```

## Development

```bash
bun run dev       # Vite dev server with HMR
bun run build     # Production build
bun run publish   # Build and serve on port 3000
```

## Architecture

```
src/config.ts          — shared DATA_DIR / SITE_ROOT config
scripts/
  reddit-pipeline.ts   — fetch and filter Reddit posts
  trends-pipeline.ts   — cross-reference with Google Trends
  scoring-pipeline.ts  — score and rank opportunities
  run-daily.sh         — run all three pipelines in sequence
  scheduler.ts         — long-lived daily scheduler
data/                  — pipeline output (gitignored)
  reddit_posts.json
  trends_enriched.json
  daily_report.json
  saved_ideas.json
  pipeline.log
```
