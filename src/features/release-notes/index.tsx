// リリースノート表示パネル
// GitHub Releases API からリリース一覧を取得してリリースごとに表示する。
// オフラインや API 失敗時は、ビルド時に生成された public/release_notes.json を
// フォールバックとしてコミット履歴を表示する。

import { useState, useEffect } from "react";

const REPO = "kumagallium/Graphium";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

interface CommitFallback {
  sha: string;
  message: string;
  date: string;
}

type Mode = "loading" | "releases" | "fallback" | "empty";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

// body の簡易レンダリング:
//   - `## xxx` → 小見出し
//   - `* xxx` / `- xxx` → 箇条書き
//   - その他 → 段落
//   - インライン: `[text](url)`, `#123`, `@user`, `**bold**`
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let idx = 0;
  const pattern =
    /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(#(\d+))|(@([A-Za-z0-9-]+))/;
  while (remaining.length > 0) {
    const m = pattern.exec(remaining);
    if (!m) {
      parts.push(remaining);
      break;
    }
    if (m.index > 0) parts.push(remaining.slice(0, m.index));
    const key = `${keyPrefix}-${idx++}`;
    if (m[1]) {
      parts.push(
        <a
          key={key}
          href={m[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      parts.push(
        <strong key={key} className="font-semibold">
          {m[5]}
        </strong>,
      );
    } else if (m[6]) {
      parts.push(
        <a
          key={key}
          href={`https://github.com/${REPO}/pull/${m[7]}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {m[6]}
        </a>,
      );
    } else if (m[8]) {
      parts.push(
        <a
          key={key}
          href={`https://github.com/${m[9]}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {m[8]}
        </a>,
      );
    }
    remaining = remaining.slice(m.index + m[0].length);
  }
  return parts;
}

function renderBody(body: string): React.ReactNode[] {
  const lines = body.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let blockIdx = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    const items = listBuffer;
    blocks.push(
      <ul key={`b-${blockIdx++}`} className="list-disc pl-5 space-y-1 my-2">
        {items.map((it, i) => (
          <li key={i} className="text-xs text-foreground leading-relaxed">
            {renderInline(it, `l-${blockIdx}-${i}`)}
          </li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*$/.test(line)) {
      flushList();
      continue;
    }
    const heading = /^##+\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      blocks.push(
        <div
          key={`b-${blockIdx++}`}
          className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-1"
        >
          {renderInline(heading[1], `h-${blockIdx}`)}
        </div>,
      );
      continue;
    }
    const bullet = /^\s*[*-]\s+(.*)$/.exec(line);
    if (bullet) {
      listBuffer.push(bullet[1]);
      continue;
    }
    flushList();
    blocks.push(
      <p
        key={`b-${blockIdx++}`}
        className="text-xs text-foreground leading-relaxed my-1.5"
      >
        {renderInline(line, `p-${blockIdx}`)}
      </p>,
    );
  }
  flushList();
  return blocks;
}

// --- フォールバック（バンドル済み commit 履歴）表示 ---

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

function parseCommit(commit: CommitFallback): ParsedCommit {
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

function FallbackCommitList({ commits }: { commits: ParsedCommit[] }) {
  const grouped = new Map<string, ParsedCommit[]>();
  for (const c of commits) {
    const list = grouped.get(c.date) || [];
    list.push(c);
    grouped.set(c.date, list);
  }
  return (
    <>
      {Array.from(grouped.entries()).map(([date, items]) => (
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
      ))}
    </>
  );
}

// --- メインパネル ---

export function ReleaseNotesPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [commits, setCommits] = useState<ParsedCommit[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(RELEASES_API, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (res.ok) {
          const data = (await res.json()) as GitHubRelease[];
          const published = data.filter((r) => !r.draft);
          if (!cancelled && published.length > 0) {
            setReleases(published);
            setMode("releases");
            return;
          }
        }
      } catch {
        // ネットワーク/rate limit → フォールバックへ
      }

      try {
        const res = await fetch(
          `${import.meta.env.BASE_URL}release_notes.json`,
        );
        if (!res.ok) throw new Error("fallback fetch failed");
        const data = (await res.json()) as CommitFallback[];
        if (!cancelled && data.length > 0) {
          setCommits(data.map(parseCommit));
          setMode("fallback");
          return;
        }
      } catch {
        // 空状態へ
      }
      if (!cancelled) setMode("empty");
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
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

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {mode === "loading" && (
            <p className="text-xs text-muted-foreground text-center py-8">
              読み込み中...
            </p>
          )}
          {mode === "empty" && (
            <p className="text-xs text-muted-foreground text-center py-8">
              リリースノートがありません
            </p>
          )}
          {mode === "fallback" && (
            <>
              <p className="text-[11px] text-muted-foreground mb-3">
                最新のリリース情報を取得できませんでした。直近のコミットログを表示しています。
              </p>
              <FallbackCommitList commits={commits} />
            </>
          )}
          {mode === "releases" &&
            releases.map((rel) => (
              <section key={rel.tag_name} className="mb-6 last:mb-2">
                <div className="flex items-baseline justify-between gap-2 mb-1.5 pb-1 border-b border-border">
                  <a
                    href={rel.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-foreground hover:underline"
                  >
                    {rel.name || rel.tag_name}
                    {rel.prerelease && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                        PRE
                      </span>
                    )}
                  </a>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {formatDate(rel.published_at)}
                  </span>
                </div>
                {rel.body ? (
                  <div>{renderBody(rel.body)}</div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    （説明なし）
                  </p>
                )}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
