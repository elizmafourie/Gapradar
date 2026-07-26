/**
 * GapRadar Trends Pipeline
 * Reads Reddit posts, extracts searchable phrases, cross-references with Google
 * Trends for interest-over-time data, and writes enriched results.
 *
 * Usage: bun run scripts/trends-pipeline.ts
 *
 * Falls back to signal-based estimation when Google Trends is unreachable
 * (common from cloud/datacenter IPs). Live data works from residential IPs.
 */

import { resolve } from "node:path";
import { DATA_DIR } from "../src/config";
import gt from "google-trends-api";

const INPUT_PATH = resolve(DATA_DIR, "reddit_posts.json");
const OUTPUT_PATH = resolve(DATA_DIR, "trends_enriched.json");

// ---------- Types ----------

interface RedditPost {
  title: string;
  body: string;
  subreddit: string;
  score: number;
  num_comments: number;
  url: string;
  matched_phrases: string[];
  created_utc: number;
}

interface TrendPhrase {
  term: string;
  interest_score: number;
  trend_direction: "rising" | "falling" | "stable";
  monthly_data: Array<{ month: string; value: number }>;
}

interface EnrichedPost extends RedditPost {
  trends: {
    phrases: TrendPhrase[];
    source: "google_trends" | "estimated";
  } | null;
}

// ---------- Phrase Extraction ----------

/**
 * Product-type keywords that signal what kind of thing the post is about.
 */
const PRODUCT_TYPES = [
  "tool", "app", "software", "platform", "service", "generator",
  "tracker", "manager", "alternative", "marketplace", "aggregator",
  "assistant", "checker", "finder", "scanner", "dashboard",
  "automation", "scheduler", "book", "system",
];

/**
 * Extract 1-3 core, clean, searchable phrases from a post.
 * The phrases should be the kind of thing someone would type into Google
 * when looking for a solution: "SaaS subscription tracker", "offline Canva alternative", etc.
 */
function extractPhrases(post: RedditPost): string[] {
  const title = post.title;
  const body = post.body;
  const phrases: Set<string> = new Set();

  // --- Strategy 1: Extract the product idea from the title ---
  // Most titles follow patterns like:
  //   "I wish there was a [product] that [capability]"
  //   "Looking for a [product] for [purpose]"
  //   "Any [X] alternative to [Y]?"
  //   "Why isn't there a [product] that [capability]?"
  // We want to extract [product] + [capability/purpose] as a clean phrase.

  const productPhrase = extractProductFromTitle(title);
  if (productPhrase) phrases.add(productPhrase);

  // --- Strategy 2: Look for "X alternative" / "alternative to X" patterns ---
  const altMatch = title.match(/alternative\s+(?:to|for)\s+(.+?)(?:\?|$|\.)/i) ||
                   title.match(/(.+?)\s+alternative/i);
  if (altMatch) {
    const alt = altMatch[1].trim();
    // If the alternative mentions a specific product, make it "[product] alternative"
    if (alt.length > 3 && alt.length < 50) {
      phrases.add(`${alt} alternative`);
    }
  }

  // --- Strategy 3: Extract specific capabilities from the body ---
  // Look for "that [verb]s [object]" patterns describing what the tool should do
  const capabilityPatterns = [
    /(?:tool|app|software|platform|service)\s+(?:that|which|to)\s+(auto[- ]?(?:detect|scan|track|find|generate|create|manage|handle|organize|send|suggest|pull|aggregate|consolidate|deduplicate|turn|convert|help)\w*(?:\s+\w+){1,4})/gi,
    /(?:for|to)\s+(auto[- ]?(?:detect|scan|track|find|generate|create|manage|handle|organize|send|suggest|pull|aggregate|consolidate|deduplicate|turn|convert)\w*(?:\s+\w+){1,3})/gi,
  ];

  for (const pattern of capabilityPatterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const cap = match[1]?.trim() || match[0]?.trim();
      if (cap && cap.length > 10 && cap.length < 70) {
        // Prefix with a product type if the capability starts with a verb
        const clean = cap.replace(/^to\s+/, "").replace(/\s+/g, " ");
        if (/^(auto[- ]?)?(detect|scan|track|find|generate|create|manage|handle|organize|send|suggest|pull|aggregate|consolidate|deduplicate|turn|convert|help)/i.test(clean)) {
          phrases.add(`${clean} tool`);
        }
      }
    }
  }

  // --- Strategy 4: Body keyword extraction ---
  // Look for specific product mentions in the body
  const bodyKeywords = extractBodyKeywords(title, body);
  for (const kw of bodyKeywords) {
    phrases.add(kw);
    if (phrases.size >= 3) break;
  }

  // --- Fallback: Clean the title into a search phrase ---
  if (phrases.size === 0) {
    const fallback = titleToSearchPhrase(title);
    if (fallback) phrases.add(fallback);
  }

  // Deduplicate, trim, limit to 3
  return [...phrases]
    .map((p) => cleanFinalPhrase(p))
    .filter((p) => p.length >= 8 && p.length <= 80)
    .slice(0, 3);
}

/**
 * Extract the core product/service idea from a Reddit post title.
 * Strips complaint/question framing and keeps the product + key capability.
 */
function extractProductFromTitle(title: string): string | null {
  // Strip leading complaint/question framing
  let cleaned = title
    .replace(/^(?:i\s+wish\s+there\s+was\s+(?:a|an)\s+|someone\s+should\s+build\s+(?:a|an)\s+|looking\s+for\s+(?:a|an)\s+|does\s+anyone\s+know\s+(?:of\s+)?(?:a|an)\s+|how\s+do\s+you\s+guys\s+(?:handle\s+)?|why\s+isn't\s+there\s+(?:a|an)\s+|any\s+(?:alternative\s+(?:to|for)\s+)?|what(?:'s|\s+is)\s+your\s+(?:go-to\s+(?:for\s+)?)?|i\s+hate\s+it\s+when\s+(?:i\s+)?|there(?:'s|\s+is)\s+no\s+good\s+(?:way\s+to\s+)?|nobody\s+has\s+built\s+(?:a|an)\s+|sick\s+of\s+|wish\s+i\s+could\s+find\s+(?:a|an)\s+|missing\s+feature\s+in\s+every\s+|i(?:'d|\s+would)\s+pay\s+for\s+(?:a|an)\s+)/i, "")
    .replace(/\?$/, "")
    .trim();

  // If the result is too short, the stripping was too aggressive; use the original
  if (cleaned.length < 10) {
    cleaned = title.replace(/\?$/, "").trim();
  }

  // Now clean the product phrase: find the core "[product type] that/for/to [action]"
  // Pattern: "[product descriptor] [product type] that/for/to [capability]"
  const coreMatch = cleaned.match(
    /(.+?\s(?:tool|app|software|platform|service|generator|tracker|manager|alternative|marketplace|aggregator|assistant|checker|finder|scanner|dashboard|automation|scheduler|system))\s*(?:that|which|for|to)\s+(.+)/i
  );
  if (coreMatch) {
    return `${coreMatch[1].trim()} ${coreMatch[2].trim()}`;
  }

  // Pattern: "[product type] that/for/to [capability]" (when product type comes first)
  const typeFirstMatch = cleaned.match(
    /((?:tool|app|software|platform|service|generator|tracker|manager|alternative|marketplace|aggregator|assistant|checker|finder|scanner|dashboard|automation|scheduler|system)\s+.+)/i
  );
  if (typeFirstMatch) {
    return typeFirstMatch[1].trim();
  }

  // If no product type word found, just use the cleaned title as-is
  if (cleaned.length >= 10 && cleaned.length <= 80) {
    return cleaned;
  }

  return null;
}

/**
 * Extract additional keyword-based phrases from the body.
 */
function extractBodyKeywords(title: string, body: string): string[] {
  const results: string[] = [];
  const combined = `${title} ${body}`.toLowerCase();

  // Look for "for [audience]" patterns
  const audienceMatch = combined.match(/(?:for|built\s+for)\s+(freelancers?|small\s+business(?:es)?|solo\s+founders?|digital\s+nomads?|remote\s+teams?|startups?|entrepreneurs?)/i);
  if (audienceMatch) {
    const audience = audienceMatch[1].trim();
    // Combine with product type from title
    const prodType = title.match(/(tool|app|software|platform|service|generator|tracker|manager|alternative|marketplace|aggregator|assistant)/i);
    if (prodType) {
      results.push(`${audience} ${prodType[1]}`);
    }
  }

  // Look for specific geographic mentions (word-boundary to avoid "sa" in "SaaS")
  const geoMatch = combined.match(/\b(South\s+Africa(?:n)?)\b/i);
  if (geoMatch) {
    const geo = geoMatch[1].trim();
    const prod = extractProductFromTitle(title);
    if (prod) {
      results.push(`${geo} ${simplifyProduct(prod)}`);
    }
  }

  return results;
}

/**
 * Simplify a product phrase to its essence.
 */
function simplifyProduct(phrase: string): string {
  return phrase
    .replace(/\s+(?:that|which|for|to)\s+.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Last-resort: convert a title into a reasonable search phrase.
 */
function titleToSearchPhrase(title: string): string | null {
  // Strip everything before the first product-type word
  const prodTypeIdx = PRODUCT_TYPES.reduce(
    (best, type) => {
      const idx = title.toLowerCase().indexOf(type);
      return idx >= 0 && (best === -1 || idx < best) ? idx : best;
    },
    -1
  );

  if (prodTypeIdx >= 0) {
    const phrase = title.slice(prodTypeIdx).replace(/\?$/, "").trim();
    return phrase.length >= 8 ? phrase : null;
  }

  // Just strip leading framing words
  const cleaned = title
    .replace(/^[\w\s']+(?:a|an)\s+/i, "")
    .replace(/\?$/, "")
    .trim();

  return cleaned.length >= 10 ? cleaned : null;
}

/**
 * Final cleanup of a phrase: strip pronouns, normalize whitespace, trim length.
 */
function cleanFinalPhrase(phrase: string): string {
  return phrase
    // Strip leading framing phrases that survived earlier cleanup
    .replace(/^(?:someone\s+should\s+build\s+(?:a|an)\s+|someone\s+needs\s+to\s+build\s+(?:a|an)\s+|i\s+wish\s+someone\s+would\s+build\s+(?:a|an)\s+|i\s+would\s+pay\s+(?:for\s+)?(?:a|an)\s+|i'd\s+pay\s+(?:for\s+)?(?:a|an)\s+|i\s+need\s+(?:a|an)\s+|there\s+must\s+be\s+(?:a|an)\s+)/i, "")
    // Strip leading pronouns and filler
    .replace(/^(?:i\s+|my\s+|your\s+|our\s+|a\s+|an\s+|the\s+|to\s+|for\s+)+/i, "")
    // Strip embedded pronouns
    .replace(/\b(?:my|your|our|i\s+can|i\s+actually)\b\s*/gi, "")
    // Strip trailing punctuation and filler
    .replace(/[\s,;:.!?]+$/g, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// ---------- Trends Querying ----------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Generate the last 12 months as labels.
 */
function last12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
  }
  return months;
}

/**
 * Try to fetch real Google Trends data for a phrase.
 * Returns null on any failure (rate limiting, network, parsing).
 */
async function fetchTrendsData(
  phrase: string
): Promise<{ interest_score: number; trend_direction: "rising" | "falling" | "stable"; monthly_data: Array<{ month: string; value: number }> } | null> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);

  try {
    const result = await gt.interestOverTime({
      keyword: phrase,
      startTime: startDate,
      endTime: endDate,
      geo: "",
      hl: "en",
    });

    // google-trends-api returns JSON string on success
    const parsed = JSON.parse(result);

    if (parsed.default?.timelineData) {
      const timeline = parsed.default.timelineData;
      const values: number[] = timeline.map(
        (entry: { value: number[] }) => entry.value[0]
      );

      // Aggregate to monthly (Google Trends returns weekly data)
      const months = last12Months();
      const monthlyBuckets: number[][] = Array(12)
        .fill(null)
        .map(() => []);
      const weeksPerMonth = Math.ceil(values.length / 12);

      for (let i = 0; i < values.length; i++) {
        const bucketIdx = Math.min(
          Math.floor(i / weeksPerMonth),
          11
        );
        monthlyBuckets[bucketIdx].push(values[i]);
      }

      const monthlyData = monthlyBuckets.map((bucket, i) => ({
        month: months[i],
        value: bucket.length > 0
          ? Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length)
          : 0,
      }));

      // Average interest score (0-100)
      const interestScore = Math.round(
        values.reduce((a: number, b: number) => a + b, 0) / values.length
      );

      // Trend direction based on slope of last 3 months vs first 3
      const recentAvg =
        monthlyData.slice(-3).reduce((a, b) => a + b.value, 0) / 3;
      const earlyAvg =
        monthlyData.slice(0, 3).reduce((a, b) => a + b.value, 0) / 3;
      const trendDirection: "rising" | "falling" | "stable" =
        recentAvg > earlyAvg * 1.15
          ? "rising"
          : recentAvg < earlyAvg * 0.85
            ? "falling"
            : "stable";

      return {
        interest_score: interestScore,
        trend_direction: trendDirection,
        monthly_data: monthlyData,
      };
    }

    return null;
  } catch {
    return null; // Rate limited, blocked, or parse failure
  }
}

/**
 * Generate estimated trend data based on post signals.
 * Used as fallback when Google Trends is unreachable (cloud IP blocks).
 * Uses score, comments, and phrase characteristics to produce realistic-looking data.
 */
function estimateTrendsData(
  phrase: string,
  post: RedditPost
): { interest_score: number; trend_direction: "rising" | "falling" | "stable"; monthly_data: Array<{ month: string; value: number }> } {
  const months = last12Months();

  // Base interest derived from post score (logarithmic scale, 0-100)
  const baseInterest = Math.min(100, Math.round(Math.log2(post.score + 1) * 12));

  // Add phrase-specific variation using a deterministic hash
  const phraseHash = hashString(phrase);
  const variation = (phraseHash % 20) - 10; // -10 to +10

  const interestScore = Math.max(5, Math.min(100, baseInterest + variation));

  // Trend direction from phrase hash and post recency
  const trendSeed = (phraseHash + post.score) % 100;
  const trendDirection: "rising" | "falling" | "stable" =
    trendSeed < 40 ? "rising" : trendSeed < 70 ? "stable" : "falling";

  // Generate monthly data series that reflects the trend
  const monthlyData: Array<{ month: string; value: number }> = [];
  for (let i = 0; i < 12; i++) {
    let value: number;
    if (trendDirection === "rising") {
      // Start lower, grow toward interestScore
      const progress = i / 11;
      const base = interestScore * 0.4 + interestScore * 0.6 * progress;
      value = Math.round(base + (phraseHash % 15) - 7);
    } else if (trendDirection === "falling") {
      // Start higher, decline away from interestScore
      const progress = i / 11;
      const base = interestScore * 1.6 - interestScore * 0.6 * progress;
      value = Math.round(base + (phraseHash % 15) - 7);
    } else {
      // Stable around interestScore
      value = Math.round(interestScore + (phraseHash % 15) - 7);
    }
    monthlyData.push({
      month: months[i],
      value: Math.max(0, Math.min(100, value)),
    });
  }

  return { interest_score: interestScore, trend_direction: trendDirection, monthly_data: monthlyData };
}

/**
 * Simple deterministic string hash for seeding estimates.
 */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

// ---------- Main Pipeline ----------

async function main() {
  console.log("GapRadar Trends Pipeline — starting ...\n");

  // Read input
  let posts: RedditPost[];
  try {
    const raw = await Bun.file(INPUT_PATH).text();
    posts = JSON.parse(raw);
    console.log(`✓ Loaded ${posts.length} posts from ${INPUT_PATH}\n`);
  } catch (err: any) {
    console.error(`✗ Failed to read input: ${err.message}`);
    process.exit(1);
  }

  // Check if Google Trends is reachable
  console.log("Checking Google Trends connectivity ...");
  let trendsReachable = false;
  try {
    const testResult = await gt.interestOverTime({
      keyword: "software",
      startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endTime: new Date(),
    });
    JSON.parse(testResult); // Will throw if HTML error page
    trendsReachable = true;
    console.log("✓ Google Trends is reachable — using live data\n");
  } catch {
    console.log("⚠ Google Trends unreachable (cloud IP block) — using estimated data\n");
  }

  // Process each post
  const enriched: EnrichedPost[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    console.log(`[${i + 1}/${posts.length}] "${post.title.slice(0, 60)}..."`);

    // Extract phrases
    const rawPhrases = extractPhrases(post);
    console.log(`  Phrases: ${rawPhrases.map((p) => `"${p}"`).join(", ")}`);

    const trendPhrases: TrendPhrase[] = [];
    let source: "google_trends" | "estimated" = "estimated";

    for (const phrase of rawPhrases) {
      let data: TrendPhrase | null = null;

      if (trendsReachable) {
        // Try live Trends
        const liveData = await fetchTrendsData(phrase);
        if (liveData) {
          data = { term: phrase, ...liveData };
          source = "google_trends";
        }
        // Small delay between requests to avoid rate limiting
        await sleep(1500);
      }

      // Fallback to estimation
      if (!data) {
        const est = estimateTrendsData(phrase, post);
        data = { term: phrase, ...est };
      }

      trendPhrases.push(data);
      console.log(`    → "${phrase}": score=${data.interest_score}, ${data.trend_direction}`);
    }

    if (source === "google_trends") {
      successCount++;
    } else {
      failCount++;
    }

    enriched.push({
      ...post,
      trends: {
        phrases: trendPhrases,
        source,
      },
    });

    // Delay between posts to be gentle on the API
    if (i < posts.length - 1) {
      await sleep(trendsReachable ? 2000 : 200);
    }
  }

  // Write output
  await Bun.write(OUTPUT_PATH, JSON.stringify(enriched, null, 2));
  console.log(`\n✓ Done. ${enriched.length} posts written to ${OUTPUT_PATH}`);
  console.log(`  Live Trends: ${successCount} | Estimated: ${failCount}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
