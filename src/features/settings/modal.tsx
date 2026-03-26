// 設定モーダル
// AI エージェントの接続先 URL を設定する

import { useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@ui/modal";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { loadSettings, saveSettings, getAgentUrl, getAgentApiKey, type Settings } from "./store";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [agentUrl, setAgentUrl] = useState("");
  const [agentApiKey, setAgentApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [fromEnv, setFromEnv] = useState(false);
  const [apiKeyFromEnv, setApiKeyFromEnv] = useState(false);

  // 現在の有効な値を表示（localStorage → 環境変数の優先順）
  useEffect(() => {
    if (isOpen) {
      const settings = loadSettings();
      const effectiveUrl = getAgentUrl();
      const effectiveApiKey = getAgentApiKey();
      setAgentUrl(effectiveUrl);
      setAgentApiKey(effectiveApiKey);
      setFromEnv(!settings.agentUrl && !!effectiveUrl);
      setApiKeyFromEnv(!settings.agentApiKey && !!effectiveApiKey);
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    const trimmed = agentUrl.trim();
    // 末尾スラッシュを除去
    const normalized = trimmed.replace(/\/+$/, "");
    const settings: Settings = { agentUrl: normalized, agentApiKey: agentApiKey.trim() };
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => onClose(), 600);
  }, [agentUrl, agentApiKey, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  return (
    <Modal open={isOpen} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          <SettingsIcon size={16} className="text-muted-foreground" />
          設定
        </span>
      </ModalHeader>

      <ModalBody className="space-y-4 w-full max-w-md">
        {/* AI エージェント URL */}
        <div>
          <label className="text-xs font-semibold text-foreground mb-1 block">
            AI エージェント URL
          </label>
          <Input
            type="url"
            value={agentUrl}
            onChange={(e) => {
              setAgentUrl(e.target.value);
              setSaved(false);
            }}
            onKeyDown={handleKeyDown}
            placeholder="http://localhost:8090"
            autoFocus
          />
          {fromEnv && (
            <p className="text-xs text-primary mt-1.5">
              環境変数から設定されています。上書きする場合は新しい URL を入力してください。
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
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

        {/* API キー */}
        <div>
          <label className="text-xs font-semibold text-foreground mb-1 block">
            API キー
          </label>
          <Input
            type="password"
            value={agentApiKey}
            onChange={(e) => {
              setAgentApiKey(e.target.value);
              setSaved(false);
            }}
            onKeyDown={handleKeyDown}
            placeholder="未設定（認証なし）"
            className="font-mono"
          />
          {apiKeyFromEnv && (
            <p className="text-xs text-primary mt-1.5">
              環境変数から設定されています。上書きする場合は新しいキーを入力してください。
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            crucible-agent の AGENT_API_KEY と同じ値を設定してください。未設定の場合は認証なしで接続します。
          </p>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          キャンセル
        </Button>
        <Button size="sm" onClick={handleSave}>
          {saved ? "保存しました" : "保存"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
