import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Server Function ────────────────────────────────────────────────────────

const getReport = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const raw = await readFile("/home/team/shared/daily_report.json", "utf-8");
    return JSON.parse(raw) as DailyReport;
  } catch {
    return null;
  }
});

// ── Route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  loader: () => getReport(),
  component: Dashboard,
});

// ── Components ─────────────────────────────────────────────────────────────

function TrendArrow({ direction }: { direction: string }) {
  switch (direction) {
    case "rising":
      return (
        <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L6.707 7.707a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          Rising
        </span>
      );
    case "falling":
      return (
        <span className="inline-flex items-center gap-1 text-red-500 font-semibold">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 112 0v11.586l2.293-2.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          Falling
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-amber-500 font-semibold">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4 10a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1z"
              clipRule="evenodd"
            />
          </svg>
          Stable
        </span>
      );
  }
}

function DemandGauge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "text-emerald-500 stroke-emerald-500"
      : score >= 40
        ? "text-amber-500 stroke-amber-500"
        : "text-red-500 stroke-red-500";

  const bgColor =
    score >= 70
      ? "stroke-gray-200"
      : score >= 40
        ? "stroke-gray-200"
        : "stroke-gray-200";

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="88" height="88" className="-rotate-90">
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          strokeWidth="6"
          className={bgColor}
        />
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          stroke="currentColor"
          className={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <span className={`absolute text-xl font-bold ${color}`}>{score}</span>
    </div>
  );
}

function OpportunityCard({
  opp,
}: {
  opp: Opportunity;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saved || saving) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/save-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: opp.title,
          description: opp.description,
          demand_score: opp.demand_score,
          reddit_url: opp.reddit_evidence.url,
          saved_at: new Date().toISOString(),
        }),
      });
      if (resp.ok) {
        setSaved(true);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const scoreColor =
    opp.demand_score >= 70
      ? "bg-emerald-50 border-emerald-200"
      : opp.demand_score >= 40
        ? "bg-amber-50 border-amber-200"
        : "bg-red-50 border-red-200";

  return (
    <div
      className={`bg-white rounded-xl shadow-md border ${scoreColor} overflow-hidden transition-shadow hover:shadow-lg`}
    >
      {/* Card Header */}
      <div className="p-5 pb-4">
        <div className="flex items-start gap-4">
          {/* Rank Badge + Gauge */}
          <div className="flex-shrink-0 flex flex-col items-center gap-1">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">
              Rank
            </span>
            <span className="text-2xl font-black text-gray-300">
              #{opp.rank}
            </span>
            <DemandGauge score={opp.demand_score} />
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Demand
            </span>
          </div>

          {/* Title + Description */}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 leading-tight mb-1">
              {opp.title}
            </h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              {opp.description}
            </p>
          </div>
        </div>
      </div>

      {/* Evidence Section */}
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 space-y-3">
        {/* Reddit Evidence */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
              Reddit Evidence
            </span>
            <span className="text-xs text-gray-400">·</span>
            <a
              href={opp.reddit_evidence.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              {opp.reddit_evidence.subreddit}
            </a>
            <span className="text-xs text-gray-400">
              ↑{opp.reddit_evidence.score}
            </span>
          </div>
          <blockquote className="text-xs text-gray-600 italic border-l-2 border-orange-300 pl-3 py-0.5 line-clamp-3">
            &ldquo;{opp.reddit_evidence.quote}&rdquo;
          </blockquote>
        </div>

        {/* Trends Evidence */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
            Trends
          </span>
          <span className="text-sm font-bold text-gray-700">
            Interest: {opp.trends_evidence.interest_score}/100
          </span>
          <TrendArrow direction={opp.trends_evidence.trend_direction} />
        </div>

        {/* Why Underserved */}
        <div>
          <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide">
            Why Underserved
          </span>
          <p className="text-xs text-gray-600 mt-0.5">
            {opp.why_underserved}
          </p>
        </div>
      </div>

      {/* Action */}
      <div className="px-5 py-3 bg-white border-t border-gray-100 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saved || saving}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            saved
              ? "bg-emerald-100 text-emerald-700 cursor-default"
              : saving
                ? "bg-gray-100 text-gray-400 cursor-wait"
                : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.97] shadow-sm"
          }`}
        >
          {saved ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Saved ✓
            </>
          ) : saving ? (
            "Saving…"
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Build This
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden animate-pulse">
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 flex flex-col items-center gap-2">
            <div className="h-3 w-8 bg-gray-200 rounded" />
            <div className="h-8 w-8 bg-gray-200 rounded-full" />
            <div className="h-16 w-16 bg-gray-200 rounded-full" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="h-5 w-3/4 bg-gray-200 rounded" />
            <div className="h-4 w-full bg-gray-100 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────

function Dashboard() {
  const report = Route.useLoaderData();

  if (!report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">GapRadar</h1>
          <p className="text-gray-500 mb-4">
            No report data found. Run the scoring pipeline to generate today's
            opportunities.
          </p>
          <code className="text-xs bg-gray-100 px-3 py-2 rounded-md text-gray-600">
            bun run scripts/scoring-pipeline.ts
          </code>
        </div>
      </div>
    );
  }

  const generatedDate = new Date(report.generated_at);
  const formattedDate = generatedDate.toLocaleDateString("en-ZA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const dataBadge =
    report.data_source === "live" ? (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Live Data
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Estimated
      </span>
    );

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 sm:px-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">
              GapRadar
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">{formattedDate}</p>
          </div>
          <div className="flex items-center gap-2">{dataBadge}</div>
        </div>
      </header>

      {/* Cards */}
      <main className="max-w-3xl mx-auto px-4 py-6 sm:px-6 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-500">
            Top {report.opportunities.length} opportunities ranked by demand
            score
          </p>
          <span className="text-xs text-gray-400">
            Generated {generatedDate.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {report.opportunities.map((opp) => (
          <OpportunityCard key={opp.rank} opp={opp} />
        ))}

        {/* Footer */}
        <footer className="text-center py-8 text-xs text-gray-400">
          GapRadar · Private Opportunity Dashboard ·{" "}
          {report.data_source === "live" ? "Live" : "Estimated"} data
        </footer>
      </main>
    </div>
  );
}
