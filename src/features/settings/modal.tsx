// 設定モーダル
// AI エージェントの接続先 URL を設定する

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { loadSettings, saveSettings, getAgentUrl, type Settings } from "./store";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [agentUrl, setAgentUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [fromEnv, setFromEnv] = useState(false);

  // 現在の有効な URL を表示（localStorage → 環境変数の優先順）
  useEffect(() => {
    if (isOpen) {
      const settings = loadSettings();
      const effectiveUrl = getAgentUrl();
      setAgentUrl(effectiveUrl);
      // localStorage に値がなく環境変数から取得した場合
      setFromEnv(!settings.agentUrl && !!effectiveUrl);
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    const trimmed = agentUrl.trim();
    // 末尾スラッシュを除去
    const normalized = trimmed.replace(/\/+$/, "");
    const settings: Settings = { agentUrl: normalized };
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => onClose(), 600);
  }, [agentUrl, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 背景オーバーレイ */}
      <div className="absolute inset-0 bg-black/40" />

      {/* モーダル本体 */}
      <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <SettingsIcon size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-medium text-foreground">設定</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* コンテンツ */}
        <div className="px-4 py-4 space-y-4">
          {/* AI エージェント URL */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              AI エージェント URL
            </label>
            <input
              type="url"
              value={agentUrl}
              onChange={(e) => {
                setAgentUrl(e.target.value);
                setSaved(false);
              }}
              onKeyDown={handleKeyDown}
              placeholder="http://localhost:8090"
              autoFocus
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
            />
            {fromEnv && (
              <p className="text-[11px] text-emerald-600 mt-1.5">
                環境変数から設定されています。上書きする場合は新しい URL を入力してください。
              </p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              AI アシスタント機能を使うには{" "}
              <a
                href="https://github.com/kumagallium/crucible-agent"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                crucible-agent
              </a>{" "}
              を起動し、そのアドレスを入力してください。
            </p>
          </div>
        </div>

        {/* フッター */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors flex items-center gap-1.5"
          >
            {saved ? "保存しました" : "保存"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
