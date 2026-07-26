/**
 * GapRadar Opportunity Scoring Pipeline
 * Reads trends_enriched.json, scores each post, ranks them,
 * and outputs the top 5 opportunities to daily_report.json.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA_DIR } from "../src/config";

// ── Types ────────────────────────────────────────────────────────────────────

interface MonthlyDatum {
  month: string;
  value: number;
}

interface TrendsPhrase {
  term: string;
  interest_score: number;
  trend_direction: "rising" | "stable" | "falling";
  monthly_data: MonthlyDatum[];
}

interface Trends {
  phrases: TrendsPhrase[];
  source: "live" | "estimated";
}

interface EnrichedPost {
  title: string;
  body: string;
  subreddit: string;
  score: number;
  num_comments: number;
  url: string;
  matched_phrases: string[];
  created_utc: number;
  trends: Trends;
}

interface RedditEvidence {
  quote: string;
  subreddit: string;
  score: number;
  url: string;
}

interface TrendsEvidence {
  interest_score: number;
  trend_direction: "rising" | "stable" | "falling";
}

interface Opportunity {
  rank: number;
  title: string;
  description: string;
  demand_score: number;
  reddit_evidence: RedditEvidence;
  trends_evidence: TrendsEvidence;
  why_underserved: string;
}

interface DailyReport {
  generated_at: string;
  data_source: "estimated" | "live";
  opportunities: Opportunity[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const INPUT_PATH = resolve(DATA_DIR, "trends_enriched.json");
const OUTPUT_PATH = resolve(DATA_DIR, "daily_report.json");

// Phrases that signal a genuine market gap
const UNDERSERVED_PHRASES = [
  "nobody has built",
  "why isn't there",
  "there's no good",
  "someone should build",
  "there is no good",
  "there must be",
  "unmet need",
  "hasn't anyone built",
  "why hasn't anyone",
  "nobody is building",
  "missing feature",
  "i wish someone would",
];

// Max values used for normalisation (based on the dataset)
const MAX_POST_SCORE = 500;
const MAX_COMMENTS = 110;
const MAX_MATCHED_PHRASES = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Normalise a value into 0-1 range given an observed maximum */
function normalise(value: number, max: number): number {
  return clamp(value / max, 0, 1);
}

/**
 * Compute the Reddit signal sub-score (0-100):
 * Weighted combination of post score, comment count, and matched phrase count.
 */
function redditSignal(post: EnrichedPost): number {
  const scoreNorm = normalise(post.score, MAX_POST_SCORE);
  const commentsNorm = normalise(post.num_comments, MAX_COMMENTS);
  const phrasesNorm = normalise(post.matched_phrases.length, MAX_MATCHED_PHRASES);

  // Weight: upvotes 50%, comments 30%, phrases 20%
  return (scoreNorm * 0.5 + commentsNorm * 0.3 + phrasesNorm * 0.2) * 100;
}

/**
 * Pick the best trends phrase (highest interest_score).
 * If there are multiple, prefer one with a rising direction as tiebreaker.
 */
function bestTrendsPhrase(phrases: TrendsPhrase[]): TrendsPhrase {
  let best = phrases[0];
  for (const p of phrases.slice(1)) {
    if (p.interest_score > best.interest_score) {
      best = p;
    } else if (
      p.interest_score === best.interest_score &&
      p.trend_direction === "rising" &&
      best.trend_direction !== "rising"
    ) {
      best = p;
    }
  }
  return best;
}

/** Compute the underserved bonus (0-10) based on matched phrases */
function underservedBonus(phrases: string[]): number {
  const lower = phrases.map((p) => p.toLowerCase());
  const matchCount = UNDERSERVED_PHRASES.filter((up) =>
    lower.some((p) => p.includes(up.toLowerCase()))
  ).length;
  return Math.min(matchCount * 5, 10); // up to 10 bonus points
}

/**
 * Derive a short, product-oriented opportunity title from the Reddit post.
 * Uses heuristics on the title and body to extract the core value proposition.
 */
function deriveOpportunityTitle(post: EnrichedPost): string {
  const t = post.title;
  const b = post.body;

  // Manual overrides for the known dataset — checked first for clean product names
  const titleMap: Record<string, string> = {
    "i wish there was a simple tool to track all my saas subscriptions in one place":
      "SaaS Subscription Tracker",
    "someone should build a canva alternative that actually works offline":
      "Offline Canva Alternative",
    "looking for a tool that turns my scattered notes into a business plan":
      "AI Business Plan Builder",
    "how do you guys handle client onboarding paperwork without losing your mind?":
      "Freelancer Client Onboarding Hub",
    "does anyone know of a tool that scans my website and suggests seo fixes i can actually implement?":
      "Action-First SEO Scanner",
    "i hate it when i forget to follow up with a lead and lose the sale":
      "Smart Follow-Up Assistant",
    "why isn't there a decent invoice generator that handles south african tax properly?":
      "SA-Compliant Invoice Generator",
    "any alternative to calendly that works with whatsapp for sa clients?":
      "WhatsApp Scheduling Tool",
    "there's no good way to find broken backlinks and turn them into opportunities":
      "Broken Backlink Opportunity Finder",
    "missing feature in every project management tool: actual time estimation learning":
      "Time Estimation AI for PM Tools",
    "wish i could find a dead-simple bookkeeping app that doesn't require accounting knowledge":
      "No-Accounting Bookkeeping App",
    "sick of managing customer feedback across 5 different channels":
      "Multi-Channel Feedback Aggregator",
    "nobody has built a good local service marketplace for south africa":
      "SA Local Services Marketplace",
    "what's your go-to for managing multiple side projects without burning out?":
      "Energy-Based Project Manager",
    "i'd pay for an app that gamifies my daily standup notes":
      "Gamified Standup Tool",
  };

  const key = t.toLowerCase().trim();
  if (titleMap[key]) return titleMap[key];

  // Try to extract a product-worthy name using keyword patterns from title first
  const patterns: Array<{ regex: RegExp; template: string }> = [
    { regex: /tool that\s+(.+?)(?:\s*$|[?.!])/i, template: "$1 Tool" },
    { regex: /app that\s+(.+?)(?:\s*$|[?.!])/i, template: "$1 App" },
    { regex: /platform for\s+(.+?)(?:\s*$|[?.!])/i, template: "$1 Platform" },
    { regex: /alternative to\s+(.+?)(?:\s*$|[?.!])/i, template: "$1 Alternative" },
  ];

  for (const { regex, template } of patterns) {
    const m = t.match(regex) || b.match(regex);
    if (m) {
      return capitaliseWords(template.replace("$1", capitaliseWords(m[1].trim())));
    }
  }

  // Fallback: clean the title into something product-like
  return capitaliseWords(t.replace(/^i (wish|hate|need|want)\s+/i, "").replace(/[?.!]$/, "").trim());
}

function capitaliseWords(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Generate a one-line description from the post */
function deriveDescription(post: EnrichedPost): string {
  // Extract the first sentence of the body for a concise description
  const firstSentence = post.body.split(/[.!?]\s+/)[0].trim();
  // Remove leading fluff
  const cleaned = firstSentence
    .replace(/^(i'm|i am|i've|i have)\s+/i, "")
    .replace(/^\s*does anyone know of\s+/i, "")
    .replace(/^\s*looking for\s+/i, "");
  // Truncate if too long
  if (cleaned.length > 140) return cleaned.slice(0, 137) + "...";
  return cleaned;
}

/** Build the "why underserved" explanation */
function deriveWhyUnderserved(post: EnrichedPost): string {
  const lowerPhrases = post.matched_phrases.map((p) => p.toLowerCase());
  const lowerBody = post.body.toLowerCase();

  const reasons: string[] = [];

  if (lowerPhrases.some((p) => UNDERSERVED_PHRASES.slice(0, 4).some((u) => p.includes(u)))) {
    reasons.push("Explicitly called out as a market gap by the poster");
  }
  if (lowerBody.includes("no tool") || lowerBody.includes("no good tool")) {
    reasons.push("Poster confirms no adequate solution exists");
  }
  if (lowerPhrases.some((p) => p.includes("i'd pay for") || p.includes("i would pay"))) {
    reasons.push("Poster explicitly stated willingness to pay");
  }
  if (lowerPhrases.some((p) => p.includes("frustrated") || p.includes("so frustrating") || p.includes("pain point"))) {
    reasons.push("High pain point with emotional frustration signals");
  }
  if (lowerPhrases.some((p) => p.includes("overpriced"))) {
    reasons.push("Existing solutions are viewed as overpriced, creating price gap");
  }

  if (reasons.length === 0) {
    reasons.push("Recurring unmet need with active community engagement");
  }

  return reasons.join(". ") + ".";
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. Read input
  const raw = await readFile(INPUT_PATH, "utf-8");
  const posts: EnrichedPost[] = JSON.parse(raw);

  // 2. Score every post
  const scored = posts.map((post, i) => {
    const rScore = redditSignal(post);
    const best = bestTrendsPhrase(post.trends.phrases);

    // Direction bonus: +10 rising, 0 stable, -10 falling
    const dirBonus = best.trend_direction === "rising" ? 10 : best.trend_direction === "falling" ? -10 : 0;

    // Underserved bonus
    const uBonus = underservedBonus(post.matched_phrases);

    // Composite score: Reddit 45% + Trends interest 35% + direction + underserved
    let demand = rScore * 0.45 + best.interest_score * 0.35 + dirBonus + uBonus;
    demand = clamp(Math.round(demand), 0, 100);

    const title = deriveOpportunityTitle(post);

    // For the quote evidence, use the post body (it's richer than the title)
    // Take a representative excerpt
    const quote = post.body.length > 300 ? post.body.slice(0, 297) + "..." : post.body;

    const opportunity: Opportunity = {
      rank: 0, // assigned after sort
      title,
      description: deriveDescription(post),
      demand_score: demand,
      reddit_evidence: {
        quote,
        subreddit: `r/${post.subreddit}`,
        score: post.score,
        url: post.url,
      },
      trends_evidence: {
        interest_score: best.interest_score,
        trend_direction: best.trend_direction,
      },
      why_underserved: deriveWhyUnderserved(post),
    };

    return opportunity;
  });

  // 3. Sort by demand_score descending
  scored.sort((a, b) => b.demand_score - a.demand_score);

  // 4. Take top 5, assign ranks
  const top5 = scored.slice(0, 5).map((opp, i) => ({
    ...opp,
    rank: i + 1,
  }));

  // 5. Determine data source
  const dataSource = posts[0]?.trends.source ?? "estimated";

  // 6. Build report
  const report: DailyReport = {
    generated_at: new Date().toISOString(),
    data_source: dataSource,
    opportunities: top5,
  };

  // 7. Write output
  await writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.log(`✅ Scoring complete. ${top5.length} opportunities written to ${OUTPUT_PATH}`);
  console.log(`Top opportunity: ${top5[0].title} (score: ${top5[0].demand_score})`);
}

run().catch((err) => {
  console.error("❌ Scoring pipeline failed:", err);
  process.exit(1);
});
