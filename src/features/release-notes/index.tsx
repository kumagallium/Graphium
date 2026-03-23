// リリースノート表示パネル
// public/release_notes.json を読み込んでコミット履歴をタイムライン表示する

import { useState, useEffect } from "react";

interface ReleaseNote {
  sha: string;
  message: string;
  date: string;
}

// コミットメッセージの [種別] を解析
const COMMIT_RE = /^\[(\w+)\]\s*([\s\S]+)/;
const TAG_LABELS: Record<string, string> = {
  feat: "NEW",
  fix: "FIX",
  mcp: "MCP",
  infra: "INFRA",
  docs: "DOCS",
  refactor: "OTHER",
  chore: "OTHER",
};

const TAG_COLORS: Record<string, string> = {
  feat: "bg-green-50 text-green-700 border-green-200",
  fix: "bg-amber-50 text-amber-700 border-amber-200",
  docs: "bg-stone-100 text-stone-600 border-stone-200",
};

interface ParsedCommit {
  tag: string;
  tagRaw: string;
  body: string;
  sha: string;
  date: string;
}

function parseCommit(commit: ReleaseNote): ParsedCommit {
  const m = COMMIT_RE.exec(commit.message);
  if (m) {
    const tagRaw = m[1].toLowerCase();
    return {
      tag: TAG_LABELS[tagRaw] || "OTHER",
      tagRaw,
      body: m[2].trim(),
      sha: commit.sha,
      date: commit.date,
    };
  }
  return {
    tag: "OTHER",
    tagRaw: "other",
    body: commit.message.trim(),
    sha: commit.sha,
    date: commit.date,
  };
}

export function ReleaseNotesPanel({ onClose }: { onClose: () => void }) {
  const [commits, setCommits] = useState<ParsedCommit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}release_notes.json`)
      .then((r) => r.json())
      .then((data: ReleaseNote[]) => setCommits(data.map(parseCommit)))
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, []);

  // 日付でグルーピング
  const grouped = new Map<string, ParsedCommit[]>();
  for (const c of commits) {
    const list = grouped.get(c.date) || [];
    list.push(c);
    grouped.set(c.date, list);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-foreground">
            Release Notes
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none transition-colors"
          >
            &times;
          </button>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              読み込み中...
            </p>
          ) : commits.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              リリースノートがありません
            </p>
          ) : (
            Array.from(grouped.entries()).map(([date, items]) => (
              <div key={date} className="mb-5">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 pb-1 border-b border-border">
                  {date}
                </div>
                <div className="space-y-1">
                  {items.map((item) => (
                    <div
                      key={item.sha}
                      className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                          TAG_COLORS[item.tagRaw] ||
                          "bg-stone-100 text-stone-500 border-stone-200"
                        }`}
                      >
                        {item.tag}
                      </span>
                      <span className="text-xs text-foreground leading-relaxed flex-1">
                        {item.body}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0 pt-0.5">
                        {item.sha}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
