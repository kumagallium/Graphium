// AI アシスタントモーダル
// 引用ブロックの表示 + 質問入力 + 実行ボタン

import { useCallback, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@ui/modal";
import { Button } from "@ui/button";
import { Textarea } from "@ui/form-field";
import { useAiAssistant } from "./store";

type AiAssistantModalProps = {
  /** AI に質問を実行する */
  onSubmit: (question: string) => void;
};

export function AiAssistantModal({ onSubmit }: AiAssistantModalProps) {
  const { isOpen, quotedMarkdown, loading, error, close } = useAiAssistant();
  const [question, setQuestion] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = question.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }, [question, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd/Ctrl + Enter で実行
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleClose = useCallback(() => {
    if (loading) return; // 実行中は閉じない
    setQuestion("");
    close();
  }, [loading, close]);

  return (
    <Modal open={isOpen} onClose={handleClose}>
      <ModalHeader onClose={loading ? undefined : handleClose}>
        <span className="flex items-center gap-2">
          <Bot size={16} className="text-violet-500" />
          AI アシスタント
        </span>
      </ModalHeader>

      <ModalBody className="space-y-3 w-full max-w-xl">
        {/* 引用ブロック */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">
            引用
          </label>
          <div className="bg-muted/50 border border-border rounded-lg p-3 text-sm text-foreground/80 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
            {quotedMarkdown || "(引用なし)"}
          </div>
        </div>

        {/* 質問入力 */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">
            質問
          </label>
          <Textarea
            ref={textareaRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="この内容について質問を入力..."
            disabled={loading}
            autoFocus
            rows={3}
          />
          <div className="text-xs text-muted-foreground mt-1">
            Cmd+Enter で実行
          </div>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={handleClose} disabled={loading}>
          キャンセル
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={loading || !question.trim()}>
          {loading ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              実行中...
            </>
          ) : (
            "実行"
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
