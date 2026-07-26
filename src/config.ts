import { resolve } from "node:path";

/**
 * GapRadar shared configuration.
 *
 * SITE_ROOT is derived from this file's location (src/config.ts → one level up).
 * DATA_DIR defaults to <SITE_ROOT>/data but can be overridden by the
 * GAPRADAR_DATA_DIR environment variable.
 */
export const SITE_ROOT = resolve(import.meta.dir!, "..");
export const DATA_DIR = process.env.GAPRADAR_DATA_DIR || resolve(SITE_ROOT, "data");
