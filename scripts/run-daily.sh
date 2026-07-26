#!/usr/bin/env bash
#
# GapRadar Daily Pipeline Runner
# Runs the three pipeline scripts in sequence. If any step fails, logs the error
# and continues with the next step.
#
# Usage: bash scripts/run-daily.sh

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$SITE_DIR/data/pipeline.log"

log() {
  echo "[$(date -Iseconds)] $1" | tee -a "$LOG_FILE"
}

log "============================================"
log "Daily pipeline run started"

# ── Step 1: Reddit pipeline ──────────────────────────────────────────────

log "Step 1/3: Running reddit-pipeline..."
cd "$SITE_DIR"
if bun run scripts/reddit-pipeline.ts >> "$LOG_FILE" 2>&1; then
  log "Step 1/3: reddit-pipeline completed successfully"
else
  log "Step 1/3: reddit-pipeline FAILED (exit code $?) — continuing anyway"
fi

# ── Step 2: Trends pipeline ──────────────────────────────────────────────

log "Step 2/3: Running trends-pipeline..."
cd "$SITE_DIR"
if bun run scripts/trends-pipeline.ts >> "$LOG_FILE" 2>&1; then
  log "Step 2/3: trends-pipeline completed successfully"
else
  log "Step 2/3: trends-pipeline FAILED (exit code $?) — continuing anyway"
fi

# ── Step 3: Scoring pipeline ─────────────────────────────────────────────

log "Step 3/3: Running scoring-pipeline..."
cd "$SITE_DIR"
if bun run scripts/scoring-pipeline.ts >> "$LOG_FILE" 2>&1; then
  log "Step 3/3: scoring-pipeline completed successfully"
else
  log "Step 3/3: scoring-pipeline FAILED (exit code $?)"
fi

log "Daily pipeline run finished"
log "============================================"
