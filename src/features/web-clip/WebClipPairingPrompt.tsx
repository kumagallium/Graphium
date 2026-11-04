// ブラウザ拡張機能からの「接続の申し込み」を許可するか尋ねるダイアログ。
//
// 拡張機能の「Graphium とつなぐ」で申し込みが sidecar に入る。ここで見張っていて、
// 届いたら番号を出して許可を求める。拡張機能の画面にも同じ番号が出ているので、
// 見比べて自分の拡張機能だと確かめてから許可してもらう（ほかの拡張機能の申し込み対策）。
// 閉じる（Esc・外側）は「断る」と同じ扱い — 曖昧なまま許可にしない。

import { useCallback, useEffect, useRef, useState } from "react";
import { Scissors } from "lucide-react";
import { useT } from "../../i18n";
import { Button } from "@ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@ui/modal";
import { decidePairRequest, fetchPairRequests, type ClipPairRequest } from "./api";

/** 申し込みを待つ間隔 */
export const PAIR_POLL_MS = 3000;
/** sidecar が見つからないときの間隔 */
export const PAIR_POLL_IDLE_MS = 60_000;

export type WebClipPairingPromptProps = {
  /** テスト・Storybook 用の差し替え */
  loadRequests?: () => Promise<ClipPairRequest[] | null>;
  decide?: (id: string, approve: boolean) => Promise<void>;
};

export function WebClipPairingPrompt({
  loadRequests = fetchPairRequests,
  decide = decidePairRequest,
}: WebClipPairingPromptProps) {
  const t = useT();
  const [request, setRequest] = useState<ClipPairRequest | null>(null);
  // 答えた申し込みは、sidecar の一覧から消えるまで出し直さない
  const answered = useRef(new Set<string>());

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      let list: ClipPairRequest[] | null = null;
      try {
        list = await loadRequests();
      } finally {
        running = false;
      }
      if (stopped) return;
      const next = list?.find((r) => !answered.current.has(r.id)) ?? null;
      // 出している申し込みがまだ待っていればそのまま（切れたら次へ）
      setRequest((cur) => (cur && list?.some((r) => r.id === cur.id) ? cur : next));
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, list === null ? PAIR_POLL_IDLE_MS : PAIR_POLL_MS);
    };
    // 拡張機能で押してから Graphium に切り替えたとき、待たせない
    const onFocus = () => {
      if (timer) clearTimeout(timer);
      void tick();
    };
    window.addEventListener("focus", onFocus);
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadRequests]);

  const answer = useCallback(
    async (approve: boolean) => {
      if (!request) return;
      answered.current.add(request.id);
      setRequest(null);
      try {
        await decide(request.id, approve);
      } catch (e) {
        console.warn("[web-clip] 接続の申し込みへの返事に失敗:", e);
      }
    },
    [request, decide],
  );

  return (
    <Modal open={!!request} onClose={() => void answer(false)} className="w-[min(420px,calc(100vw-32px))]">
      <ModalHeader>
        <span className="flex items-center gap-2">
          <Scissors size={14} />
          {t("webClip.pair.title")}
        </span>
      </ModalHeader>
      <ModalBody className="space-y-3 text-sm">
        <p>{t("webClip.pair.body")}</p>
        <div
          className="text-center text-3xl font-mono font-semibold tracking-[0.3em] py-2"
          data-testid="web-clip-pair-number"
        >
          {request?.number}
        </div>
        <p className="text-xs text-muted-foreground">{t("webClip.pair.note")}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={() => void answer(false)}>
          {t("webClip.pair.deny")}
        </Button>
        <Button onClick={() => void answer(true)}>{t("webClip.pair.approve")}</Button>
      </ModalFooter>
    </Modal>
  );
}
