// PROV ドキュメント生成 hook
// 500ms デバウンスでリアルタイム再生成

import { useCallback, useEffect, useRef, useState } from "react";
import {
  generateProvDocument,
  type ProvDocument,
} from "../features/prov-generator";
import type { BlockLink } from "../features/block-link/link-types";
import type { DocumentProvenance } from "../features/document-provenance/types";

export function useProvGeneration(
  editorRef: React.RefObject<any>,
  labels: Map<string, string>,
  links: BlockLink[],
  documentProvenance?: DocumentProvenance | null,
) {
  const [provDoc, setProvDoc] = useState<ProvDocument | null>(null);
  const provTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generateProv = useCallback(() => {
    if (!editorRef.current) return;
    const blocks = editorRef.current.document;
    const doc = generateProvDocument({
      blocks,
      labels,
      links,
      documentProvenance: documentProvenance ?? undefined,
    });
    setProvDoc(doc);
  }, [editorRef, labels, links, documentProvenance]);

  // ラベル・リンク変更時に自動再生成
  useEffect(() => {
    if (provTimerRef.current) clearTimeout(provTimerRef.current);
    provTimerRef.current = setTimeout(generateProv, 500);
    return () => {
      if (provTimerRef.current) clearTimeout(provTimerRef.current);
    };
  }, [generateProv]);

  // エディタ内容変更時に呼ぶ（デバウンス再生成）
  const triggerRegeneration = useCallback(() => {
    if (provTimerRef.current) clearTimeout(provTimerRef.current);
    provTimerRef.current = setTimeout(generateProv, 500);
  }, [generateProv]);

  return { provDoc, generateProv, triggerRegeneration };
}
