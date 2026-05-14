// Synthesis モード説明モーダル（Phase 5.4）
// バナーの synthesisMode バッジをクリックすると開き、選択中モードの説明・形・
// 他モードへの俯瞰・学習材料（docs/inference-types）へのリンクを提示する。

import { ExternalLink } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@ui/modal";
import { Button } from "@ui/button";
import type { SynthesisMode } from "../../lib/document-types";
import { useT } from "../../i18n";

const ALL_MODES: SynthesisMode[] = ["deductive", "abductive", "analogical", "dialectic"];

type Props = {
  open: boolean;
  /** 表示時に強調するモード。null のときはモーダルを開かない */
  mode: SynthesisMode | null;
  onClose: () => void;
};

export function SynthesisModeModal({ open, mode, onClose }: Props) {
  const t = useT();
  if (!mode) return null;

  const docsBase = t("synthesisMode.modal.docsUrl" as any);
  const docsUrl = `${docsBase}#${mode}`;

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        {t("synthesisMode.modal.title" as any)}: {t(`wikiTypes.synthesisMode.${mode}` as any)}
      </ModalHeader>
      <ModalBody className="w-[min(560px,92vw)] space-y-4">
        {/* 選択中モードの中核説明 */}
        <section>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-1)",
              marginBottom: 6,
            }}
          >
            {t(`synthesisMode.modal.tagline.${mode}` as any)}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--ink-2)", margin: 0 }}>
            {t(`synthesisMode.modal.description.${mode}` as any)}
          </p>
        </section>

        {/* 形（shape） */}
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--ink-3)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {t("synthesisMode.modal.shapeLabel" as any)}
          </div>
          <blockquote
            style={{
              fontSize: 12.5,
              lineHeight: 1.65,
              color: "var(--ink-2)",
              fontFamily: "var(--mono)",
              background: "var(--paper)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--radius)",
              padding: "10px 12px",
              margin: 0,
            }}
          >
            {t(`synthesisMode.modal.shape.${mode}` as any)}
          </blockquote>
        </section>

        {/* 他モードの俯瞰 */}
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--ink-3)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {t("synthesisMode.modal.otherModes" as any)}
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {ALL_MODES.filter((m) => m !== mode).map((m) => (
              <li
                key={m}
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  color: "var(--ink-2)",
                  display: "flex",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 600, minWidth: 88 }}>
                  {t(`wikiTypes.synthesisMode.${m}` as any)}
                </span>
                <span>{t(`synthesisMode.modal.tagline.${m}` as any)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* induction が無いことの注記 */}
        <p
          style={{
            fontSize: 11.5,
            lineHeight: 1.6,
            color: "var(--ink-4)",
            margin: 0,
            borderLeft: "2px solid var(--rule)",
            paddingLeft: 10,
          }}
        >
          {t("synthesisMode.modal.inductionNote" as any)}
        </p>

        {/* 学習材料へのリンク */}
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12.5,
            color: "var(--ink-1)",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          {t("synthesisMode.modal.learnMore" as any)}
          <ExternalLink size={12} />
        </a>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("synthesisMode.modal.close" as any)}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
