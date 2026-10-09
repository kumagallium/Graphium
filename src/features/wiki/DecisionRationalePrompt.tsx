// 判断の理由を 1 行で書くパネル（判断・規則・観察の frame, PR 2）。
//
// 取り込み完了トーストの「理由を書く」/ 知見ページの「構造」節から開く。
// 理由が null の判断知見ごとに、タイトル・行動の引用・1 行入力を並べる。
// 送信しても LLM は通さない（人の文をそのまま追記先ノートと知見の rationale に入れる。
// 書き込みの実体は呼び出し側 onSubmit）。閉じても未送信の行は何も書かれない。
// 配置（モーダル / サイド）は呼び出し側で決める。この部品は幅いっぱいのカード。

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { DIALOG_LAYER } from "../../ui/z-layers";

export type DecisionRationaleItem = {
  wikiId: string;
  title: string;
  /** decisionFrame.action（原文の引用として表示する） */
  action: string;
  targetNoteId: string;
  targetNoteTitle: string;
};

export type DecisionRationalePromptProps = {
  items: DecisionRationaleItem[];
  /** 理由を書き込む。失敗時は reject する（行にエラーを出し、再送信できる）。 */
  onSubmit: (wikiId: string, rationale: string) => Promise<void>;
  onClose: () => void;
  /** すでに記入済みの wikiId（story / 再表示用）。 */
  initialDoneIds?: string[];
};

type RowStatus = "idle" | "submitting" | "done" | "failed";

export function DecisionRationalePrompt({
  items,
  onSubmit,
  onClose,
  initialDoneIds = [],
}: DecisionRationalePromptProps) {
  const t = useT();
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, RowStatus>>(() =>
    Object.fromEntries(initialDoneIds.map((id) => [id, "done" as RowStatus])),
  );
  const [emptyId, setEmptyId] = useState<string | null>(null);

  const submit = async (wikiId: string) => {
    const text = (drafts[wikiId] ?? "").trim();
    if (!text) {
      setEmptyId(wikiId);
      return;
    }
    setEmptyId(null);
    setStatus((s) => ({ ...s, [wikiId]: "submitting" }));
    try {
      await onSubmit(wikiId, text);
      setStatus((s) => ({ ...s, [wikiId]: "done" }));
    } catch (err) {
      console.error("Decision rationale submit failed:", err);
      setStatus((s) => ({ ...s, [wikiId]: "failed" }));
    }
  };

  return (
    <div
      role="dialog"
      aria-label={t("decisionPrompt.title")}
      style={{
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        boxShadow: "var(--shadow-2)",
        padding: 16,
        maxWidth: 520,
        width: "100%",
        color: "var(--ink)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{t("decisionPrompt.title")}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("decisionPrompt.close")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", padding: 4 }}
        >
          <X size={16} />
        </button>
      </div>
      <p style={{ margin: "8px 0 12px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
        {t("decisionPrompt.description")}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {items.map((item) => {
          const st = status[item.wikiId] ?? "idle";
          const busy = st === "submitting";
          const done = st === "done";
          return (
            <li
              key={item.wikiId}
              style={{ borderTop: "1px solid var(--rule)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{item.title}</div>
              <blockquote
                style={{
                  margin: 0,
                  paddingLeft: 10,
                  borderLeft: "2px solid var(--rule)",
                  fontSize: 12,
                  color: "var(--ink-3)",
                  lineHeight: 1.6,
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                }}
              >
                <span style={{ marginRight: 6 }}>{t("decisionPrompt.actionQuote")}:</span>
                {item.action}
              </blockquote>
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {t("decisionPrompt.targetNote", { title: item.targetNoteTitle })}
              </div>
              {done ? (
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--forest)" }}>
                  <Check size={14} />
                  {t("decisionPrompt.done")}
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit(item.wikiId);
                  }}
                  style={{ display: "flex", gap: 8 }}
                >
                  <input
                    type="text"
                    value={drafts[item.wikiId] ?? ""}
                    disabled={busy}
                    placeholder={t("decisionPrompt.placeholder")}
                    aria-label={`${t("decisionPrompt.placeholder")}: ${item.title}`}
                    {...compositionHandlers}
                    onKeyDown={(e) => {
                      // IME 変換確定の Enter は暗黙送信（form submit）させない。isComposing だけでは
                      // WKWebView の compositionend → keydown(13) 順を取りこぼすため共通ガードで判定する。
                      if (e.key === "Enter" && isImeKey(e)) e.preventDefault();
                    }}
                    onChange={(e) => {
                      setDrafts((d) => ({ ...d, [item.wikiId]: e.target.value }));
                      if (emptyId === item.wikiId) setEmptyId(null);
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      padding: "6px 8px",
                      border: "1px solid var(--rule)",
                      borderRadius: 6,
                      background: "var(--paper)",
                      color: "var(--ink)",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      padding: "6px 12px",
                      border: "none",
                      borderRadius: 6,
                      background: "var(--forest)",
                      color: "#fff",
                      cursor: busy ? "default" : "pointer",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy && <Loader2 size={12} className="animate-spin" />}
                    {busy ? t("decisionPrompt.submitting") : t("decisionPrompt.submit")}
                  </button>
                </form>
              )}
              {emptyId === item.wikiId && (
                <div role="alert" style={{ fontSize: 11, color: "var(--color-warning, #b45309)" }}>
                  {t("decisionPrompt.empty")}
                </div>
              )}
              {st === "failed" && (
                <div role="alert" style={{ fontSize: 11, color: "var(--color-error, #991b1b)" }}>
                  {t("decisionPrompt.failed")}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 中央ダイアログ版（DeleteConfirmDialog / MergeTopicsDialog と同じ骨格）。
 * 背景クリックと Esc で閉じる。閉じても未送信の行は何も書かれない。
 * トースト（z-[9999]）は DIALOG_LAYER より上なので、パネルを閉じなくても進捗は見える。
 */
export function DecisionRationaleDialog(props: DecisionRationalePromptProps) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-popover rounded-xl shadow-lg mx-4 w-full max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DecisionRationalePrompt {...props} />
      </div>
    </div>
  );
}
