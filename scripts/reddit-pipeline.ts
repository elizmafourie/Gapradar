/**
 * GapRadar Reddit Pipeline
 * Fetches recent posts from problem/side-project/business subreddits, filters for
 * pain-point signals and "I'd pay for" sentiment, and writes structured results to
 * <DATA_DIR>/reddit_posts.json.
 *
 * Usage: bun run scripts/reddit-pipeline.ts
 *
 * NOTE: Reddit blocks cloud/datacenter IP ranges. When run from a blocked IP
 * (HTTP 403), the pipeline falls back to curated seed data so the dashboard
 * has sample content to display. Run from a residential IP or with Reddit API
 * credentials for live data.
 */

import { resolve } from "node:path";
import { DATA_DIR } from "../src/config";

const USER_AGENT = "GapRadar/1.0 (research tool; contact@example.com)";
const OUTPUT_PATH = resolve(DATA_DIR, "reddit_posts.json");

// ---------- Configuration ----------

const SUBREDDITS = [
  "startups",
  "entrepreneur",
  "SideProject",
  "smallbusiness",
  "SaaS",
  "digitalnomad",
  "freelance",
  "SomebodyMakeThis",
  "AppIdeas",
  "Business_Ideas",
];

const FETCH_MODES: Array<{ sort: string; t?: string; limit: number }> = [
  { sort: "top", t: "week", limit: 25 },
  { sort: "new", limit: 25 },
];

const SIGNAL_PHRASES = [
  "i wish there was",
  "i'd pay for",
  "i would pay for",
  "someone should build",
  "someone needs to build",
  "frustrated with",
  "hate when",
  "looking for a tool",
  "any recommendations for",
  "does anyone know a",
  "does anyone know of",
  "there's no good",
  "there is no good",
  "why isn't there",
  "why is there no",
  "need a solution",
  "problem with",
  "so annoying",
  "waste of money",
  "overpriced",
  "alternatives to",
  "any alternative",
  "is there a tool",
  "is there an app",
  "how do you guys handle",
  "how do you solve",
  "what do you use for",
  "what are you using for",
  "what's your go-to",
  "pain point",
  "unmet need",
  "biggest challenge",
  "struggling with",
  "sick of",
  "tired of",
  "i hate it when",
  "so frustrating",
  "nobody has built",
  "why hasn't anyone",
  "need something that",
  "wish i could find",
  "wish there were",
  "wish someone would",
  "looking for a way to",
  "how can i automate",
  "is there a service",
  "who else struggles",
  "anybody else",
  "diy solution",
  "workaround for",
  "hacked together",
  "paid tool",
  "missing feature",
  "no way to",
];

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

interface RedditListingChild {
  data: {
    title: string;
    selftext: string;
    subreddit: string;
    score: number;
    num_comments: number;
    permalink: string;
    created_utc: number;
  };
}

interface RedditListing {
  data: {
    children: RedditListingChild[];
    after: string | null;
  };
}

// ---------- Seed data (fallback when Reddit blocks cloud IPs) ----------

const SEED_POSTS: RedditPost[] = [
  {
    title: "I wish there was a simple tool to track all my SaaS subscriptions in one place",
    body: "I'm currently juggling 12 different SaaS tools and I keep losing track of renewal dates and how much I'm spending. I've tried spreadsheets but they're so annoying to maintain. I'd pay for something that auto-detects subscriptions from my bank feed and sends me reminders before renewals. Does anyone know of something like this that isn't overpriced enterprise software?",
    subreddit: "SaaS",
    score: 487,
    num_comments: 92,
    url: "https://www.reddit.com/r/SaaS/comments/example1",
    matched_phrases: ["i wish there was", "so annoying", "i'd pay for", "does anyone know of", "overpriced"],
    created_utc: 1750435200,
  },
  {
    title: "Someone should build a Canva alternative that actually works offline",
    body: "I'm a digital nomad and half the time I'm working from cafes with terrible wifi. Canva is great but it's useless without internet. I would pay for a desktop app that has the same templates and ease of use but works completely offline. Frustrated with having to plan my design work around internet availability.",
    subreddit: "digitalnomad",
    score: 312,
    num_comments: 67,
    url: "https://www.reddit.com/r/digitalnomad/comments/example2",
    matched_phrases: ["someone should build", "i would pay for", "frustrated with"],
    created_utc: 1750521600,
  },
  {
    title: "Looking for a tool that turns my scattered notes into a business plan",
    body: "I have hundreds of notes across Apple Notes, Notion, Google Keep, and random paper napkins. Is there a tool that can take all of these and help structure them into an actual business plan? I'm struggling with organizing my ideas and the biggest challenge is connecting related thoughts across different platforms. Need something that uses AI to cluster ideas and suggest structure.",
    subreddit: "startups",
    score: 256,
    num_comments: 43,
    url: "https://www.reddit.com/r/startups/comments/example3",
    matched_phrases: ["looking for a tool", "is there a tool", "struggling with", "biggest challenge", "need something that"],
    created_utc: 1750608000,
  },
  {
    title: "Why isn't there a decent invoice generator that handles South African tax properly?",
    body: "Every invoice tool I've tried either doesn't support VAT correctly for SA, or doesn't generate proper tax invoices that SARS accepts. QuickBooks is overpriced and Wave doesn't handle ZAR well. I'd pay R800+ for a once-off tool that just generates beautiful, SARS-compliant invoices. Any recommendations for something that actually works for SA freelancers?",
    subreddit: "freelance",
    score: 189,
    num_comments: 55,
    url: "https://www.reddit.com/r/freelance/comments/example4",
    matched_phrases: ["why isn't there", "i'd pay for", "overpriced", "any recommendations for"],
    created_utc: 1750694400,
  },
  {
    title: "There's no good way to find broken backlinks and turn them into opportunities",
    body: "I've been doing manual outreach for backlinks and it's painfully slow. There is no good tool that automatically finds broken links on relevant sites AND helps you create replacement content that site owners actually want to link to. I'm tired of the existing tools that just give you a list of dead links with no context. Anyone else struggling with this?",
    subreddit: "SideProject",
    score: 167,
    num_comments: 38,
    url: "https://www.reddit.com/r/SideProject/comments/example5",
    matched_phrases: ["there is no good", "tired of", "struggling with"],
    created_utc: 1750780800,
  },
  {
    title: "Sick of managing customer feedback across 5 different channels",
    body: "We get feature requests through email, Intercom, Twitter, Reddit, and our own forum. It's so frustrating trying to consolidate all of this. I wish someone would build a simple aggregator that pulls feedback from all channels, deduplicates similar requests, and lets us vote/prioritize. I'd easily pay $50/month for this. What do you use for this?",
    subreddit: "smallbusiness",
    score: 143,
    num_comments: 71,
    url: "https://www.reddit.com/r/smallbusiness/comments/example6",
    matched_phrases: ["sick of", "so frustrating", "i wish someone would", "i'd easily pay", "what do you use for"],
    created_utc: 1750867200,
  },
  {
    title: "Nobody has built a good local service marketplace for South Africa",
    body: "Facebook Marketplace is sketchy, Gumtree is dying, and TaskRabbit isn't available here. There's no good platform to find vetted plumbers, electricians, cleaners etc. with real reviews. Looking for a way to connect with reliable service providers without the spam and scammers. This is a huge unmet need in SA — someone needs to build a proper platform with ID verification.",
    subreddit: "Business_Ideas",
    score: 134,
    num_comments: 89,
    url: "https://www.reddit.com/r/Business_Ideas/comments/example7",
    matched_phrases: ["nobody has built", "there's no good", "unmet need", "someone needs to build", "looking for a way to"],
    created_utc: 1750953600,
  },
  {
    title: "I'd pay for an app that gamifies my daily standup notes",
    body: "I run a small remote team and our daily standups are getting stale. I'd pay for a tool that turns our async standup notes into a gamified experience — streaks, achievements, team stats. Is there an app that does this? All the standup bots I've tried are boring text-based affairs. There must be a more engaging way to do this.",
    subreddit: "AppIdeas",
    score: 98,
    num_comments: 34,
    url: "https://www.reddit.com/r/AppIdeas/comments/example8",
    matched_phrases: ["i'd pay for", "is there an app"],
    created_utc: 1751040000,
  },
  {
    title: "How do you guys handle client onboarding paperwork without losing your mind?",
    body: "Every new client means: proposal → contract → invoice → onboarding questionnaire → project setup in Notion/ClickUp. This is my biggest pain point right now. I've hacked together a system with Zapier, PandaDoc, and Google Forms but it breaks constantly. Is there a service that handles the entire client onboarding flow end-to-end? For freelancers specifically, not enterprise.",
    subreddit: "freelance",
    score: 231,
    num_comments: 102,
    url: "https://www.reddit.com/r/freelance/comments/example9",
    matched_phrases: ["how do you guys handle", "pain point", "hacked together", "is there a service"],
    created_utc: 1751126400,
  },
  {
    title: "Any alternative to Calendly that works with WhatsApp for SA clients?",
    body: "Most of my South African clients don't use email for scheduling — they want to book via WhatsApp. I can't find any scheduling tool that integrates properly with WhatsApp Business API for automated booking. Calendly and its alternatives all assume email-first communication. I would pay good money for a scheduling tool built for markets where WhatsApp is the primary business channel.",
    subreddit: "entrepreneur",
    score: 176,
    num_comments: 48,
    url: "https://www.reddit.com/r/entrepreneur/comments/example10",
    matched_phrases: ["any alternative", "alternatives to", "i would pay"],
    created_utc: 1751212800,
  },
  {
    title: "Does anyone know of a tool that scans my website and suggests SEO fixes I can actually implement?",
    body: "Ahrefs and Semrush give you 10,000 issues but I'm a solo founder — I need 5 actionable things I can fix this afternoon. All the SEO tools are built for agencies with teams. There's no good tool that prioritizes by impact-for-effort and explains it in plain English. I'm tired of paying $100+/month for tools I only use 5% of.",
    subreddit: "startups",
    score: 203,
    num_comments: 56,
    url: "https://www.reddit.com/r/startups/comments/example11",
    matched_phrases: ["does anyone know of", "there's no good", "tired of", "overpriced"],
    created_utc: 1751299200,
  },
  {
    title: "Missing feature in every project management tool: actual time estimation learning",
    body: "I've used Asana, Monday, ClickUp, Linear — none of them learn from my past estimates. I consistently underestimate by 40% and no tool tells me 'hey, you said this would take 2 days but similar tasks took you 3.5'. I'd pay for a PM tool that actually gets smarter about MY work patterns. Why hasn't anyone built this yet? It seems like an obvious use of ML.",
    subreddit: "SaaS",
    score: 156,
    num_comments: 67,
    url: "https://www.reddit.com/r/SaaS/comments/example12",
    matched_phrases: ["missing feature", "i'd pay for", "why hasn't anyone"],
    created_utc: 1751385600,
  },
  {
    title: "What's your go-to for managing multiple side projects without burning out?",
    body: "I'm running 3 side projects and my main job. I need something that helps me allocate energy, not just time. Time blocking doesn't work because some tasks are creative and I can't schedule creativity. Struggling with context switching and feeling guilty about projects I'm neglecting. What are you using for this kind of energy-based project management?",
    subreddit: "SideProject",
    score: 112,
    num_comments: 84,
    url: "https://www.reddit.com/r/SideProject/comments/example13",
    matched_phrases: ["what's your go-to", "struggling with", "what are you using for"],
    created_utc: 1751472000,
  },
  {
    title: "Wish I could find a dead-simple bookkeeping app that doesn't require accounting knowledge",
    body: "Every bookkeeping app assumes you know what double-entry accounting is. I just want to snap photos of receipts, categorize expenses, and see if I'm profitable this month. Xero and QuickBooks are overpriced and complicated. There must be a 'bookkeeping for dummies' app out there that handles the accounting complexity behind the scenes. Any recommendations?",
    subreddit: "smallbusiness",
    score: 145,
    num_comments: 61,
    url: "https://www.reddit.com/r/smallbusiness/comments/example14",
    matched_phrases: ["wish i could find", "overpriced", "any recommendations for"],
    created_utc: 1751558400,
  },
  {
    title: "I hate it when I forget to follow up with a lead and lose the sale",
    body: "CRM tools are either too complex (Salesforce) or too basic (spreadsheet). I need something that sits in my inbox, detects when I haven't replied to a lead in 3 days, and nudges me with a draft reply. So frustrating to lose deals just because I'm disorganized. I hate it when I see a lead went cold because I forgot to send that one follow-up. Looking for a tool that's basically a smart follow-up assistant.",
    subreddit: "entrepreneur",
    score: 198,
    num_comments: 45,
    url: "https://www.reddit.com/r/entrepreneur/comments/example15",
    matched_phrases: ["i hate it when", "so frustrating", "looking for a tool"],
    created_utc: 1751644800,
  },
];

// ---------- Helpers ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(subreddit: string, sort: string, t?: string, limit = 25): string {
  const base = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`;
  if (t) return `${base}&t=${t}`;
  return base;
}

function matchSignals(title: string, body: string): string[] {
  const text = `${title} ${body}`.toLowerCase();
  const matched: string[] = [];
  for (const phrase of SIGNAL_PHRASES) {
    if (text.includes(phrase)) {
      matched.push(phrase);
    }
  }
  return matched;
}

function cleanText(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .trim();
}

// ---------- Main ----------

async function main() {
  console.log("GapRadar Reddit Pipeline — starting ...");
  console.log(`Scanning ${SUBREDDITS.length} subreddits, ${FETCH_MODES.length} modes each.\n`);

  const allResults: RedditPost[] = [];
  const seen = new Set<string>();
  let blockedCount = 0;
  let totalFetches = 0;
  let earlyBlock = false;

  for (const subreddit of SUBREDDITS) {
    if (earlyBlock) break;

    for (const mode of FETCH_MODES) {
      if (earlyBlock) break;

      const url = buildUrl(subreddit, mode.sort, mode.t, mode.limit);
      totalFetches++;
      console.log(`  → Fetching ${url}`);

      try {
        const resp = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
        });

        if (!resp.ok) {
          if (resp.status === 403) {
            blockedCount++;
            // If first 4+ fetches are all 403, the IP is blocked — skip the rest
            if (blockedCount >= 4 && allResults.length === 0) {
              console.warn("    ⚠  Reddit is blocking this IP range — falling back to seed data.");
              earlyBlock = true;
              continue;
            }
          }
          console.warn(`    ⚠  HTTP ${resp.status} — skipping`);
          await sleep(300);
          continue;
        }

        const json: RedditListing = await resp.json();

        if (!json?.data?.children) {
          console.warn("    ⚠  Unexpected response shape — skipping");
          await sleep(1500);
          continue;
        }

        let hitsThisFetch = 0;

        for (const child of json.data.children) {
          const d = child.data;
          if (!d?.title) continue;

          if (seen.has(d.permalink)) continue;
          seen.add(d.permalink);

          const title = cleanText(d.title);
          const body = cleanText(d.selftext || "");

          if (!body && title.length < 30) continue;

          const matched = matchSignals(title, body);
          if (matched.length === 0) continue;

          hitsThisFetch++;

          allResults.push({
            title,
            body: body.substring(0, 2000),
            subreddit: d.subreddit,
            score: d.score,
            num_comments: d.num_comments,
            url: `https://www.reddit.com${d.permalink}`,
            matched_phrases: matched,
            created_utc: d.created_utc,
          });
        }

        console.log(`    ✅  ${hitsThisFetch} signal hits (${json.data.children.length} fetched)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`    ⚠  Error: ${message}`);
      }

      await sleep(2000);
    }
  }

  // ---------- Fallback to seed data ----------
  if (earlyBlock || (blockedCount > 0 && allResults.length === 0)) {
    console.warn("\n⚠  Reddit is unreachable from this IP (cloud/datacenter restriction).");
    console.warn("   Using curated seed data instead. Run from a residential IP for live data.\n");

    allResults.push(...SEED_POSTS);
  }

  // Sort by score descending
  allResults.sort((a, b) => b.score - a.score);

  const outJson = JSON.stringify(allResults, null, 2);
  await Bun.write(OUTPUT_PATH, outJson);

  if (allResults.length <= SEED_POSTS.length && earlyBlock) {
    console.log(`✓ Done. ${allResults.length} seed posts saved to ${OUTPUT_PATH} (Reddit unreachable)`);
  } else {
    console.log(`\n✓ Done. ${allResults.length} candidate posts saved to ${OUTPUT_PATH}`);
  }
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
