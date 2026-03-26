// Crucible デザインシステム — Modal シェル
// MASTER.md 準拠: rounded-xl, shadow-lg, オーバーレイ bg-black/40
// 既存の settings/modal.tsx や ai-assistant/modal.tsx を統一するための基盤

import { forwardRef, type HTMLAttributes, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

type ModalProps = {
  /** モーダルの開閉状態 */
  open: boolean;
  /** 閉じるコールバック（Escape キー・オーバーレイクリックでも呼ばれる） */
  onClose: () => void;
  children: React.ReactNode;
};

function Modal({ open, onClose, children }: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* オーバーレイ */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      {/* コンテンツ */}
      <div className="relative bg-background border border-border rounded-xl shadow-lg max-h-[85vh] overflow-y-auto">
        {children}
      </div>
    </div>,
    document.body,
  );
}

// モーダルヘッダー
type ModalHeaderProps = HTMLAttributes<HTMLDivElement> & {
  onClose?: () => void;
};

const ModalHeader = forwardRef<HTMLDivElement, ModalHeaderProps>(
  ({ className, children, onClose, ...props }, ref) => (
    <div
      className={cn("flex items-center justify-between px-6 py-4 border-b border-border", className)}
      ref={ref}
      {...props}
    >
      <h2 className="text-sm font-semibold text-foreground">{children}</h2>
      {onClose && (
        <IconButton size="sm" aria-label="閉じる" onClick={onClose}>
          <X />
        </IconButton>
      )}
    </div>
  ),
);
ModalHeader.displayName = "ModalHeader";

// モーダルボディ
const ModalBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn("px-6 py-4", className)} ref={ref} {...props} />
  ),
);
ModalBody.displayName = "ModalBody";

// モーダルフッター
const ModalFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      className={cn("flex items-center justify-end gap-3 px-6 py-4 border-t border-border", className)}
      ref={ref}
      {...props}
    />
  ),
);
ModalFooter.displayName = "ModalFooter";

export { Modal, ModalHeader, ModalBody, ModalFooter };
