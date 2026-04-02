// 設定モーダル
// AI エージェントの接続先 URL を設定する

import { useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon, ChevronDown } from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@ui/modal";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { loadSettings, saveSettings, getAgentUrl, getAgentApiKey, type Settings } from "./store";
import { fetchModels, fetchProfiles, type ModelInfo, type ProfileInfo } from "../ai-assistant/api";
import { useLocale, type Locale } from "../../i18n";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { locale, setLocale, t } = useLocale();
  const [agentUrl, setAgentUrl] = useState("");
  const [agentApiKey, setAgentApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [profile, setProfile] = useState("");
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
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
      setModel(settings.model);
      setProfile(settings.profile);
      setFromEnv(!settings.agentUrl && !!effectiveUrl);
      setApiKeyFromEnv(!settings.agentApiKey && !!effectiveApiKey);
      setSaved(false);

      // エージェントが設定済みならモデル・プロファイル一覧を取得
      if (effectiveUrl) {
        setModelsLoading(true);
        fetchModels()
          .then((res) => {
            setModels(res.models);
            setDefaultModel(res.default);
          })
          .catch(() => {
            setModels([]);
            setDefaultModel("");
          })
          .finally(() => setModelsLoading(false));

        setProfilesLoading(true);
        fetchProfiles()
          .then((res) => setProfiles(res.profiles))
          .catch(() => setProfiles([]))
          .finally(() => setProfilesLoading(false));
      }
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    const trimmed = agentUrl.trim();
    // 末尾スラッシュを除去
    const normalized = trimmed.replace(/\/+$/, "");
    const settings: Settings = { agentUrl: normalized, agentApiKey: agentApiKey.trim(), model, profile };
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => onClose(), 600);
  }, [agentUrl, agentApiKey, model, profile, onClose]);

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
          {t("settings.title")}
        </span>
      </ModalHeader>

      <ModalBody className="space-y-4 w-full max-w-md">
        {/* 言語 / Language */}
        <div>
          <label className="text-xs font-semibold text-foreground mb-1 block">
            {t("settings.language")}
          </label>
          <div className="flex gap-2">
            {(["en", "ja"] as Locale[]).map((loc) => (
              <button
                key={loc}
                onClick={() => setLocale(loc)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  locale === loc
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {loc === "en" ? "English" : "日本語"}
              </button>
            ))}
          </div>
        </div>

        {/* AI エージェント URL */}
        <div>
          <label className="text-xs font-semibold text-foreground mb-1 block">
            {t("settings.agentUrl")}
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
              {t("settings.envNote")}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {t("settings.agentHelp")}
          </p>
        </div>

        {/* API キー */}
        <div>
          <label className="text-xs font-semibold text-foreground mb-1 block">
            {t("settings.apiKey")}
          </label>
          <Input
            type="password"
            value={agentApiKey}
            onChange={(e) => {
              setAgentApiKey(e.target.value);
              setSaved(false);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("settings.apiKeyPlaceholder")}
            className="font-mono"
          />
          {apiKeyFromEnv && (
            <p className="text-xs text-primary mt-1.5">
              {t("settings.apiKeyEnvNote")}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {t("settings.apiKeyHelp")}
          </p>
        </div>

        {/* プロファイル選択 */}
        <div>
          <label className="text-xs font-semibold text-foreground mb-1 block">
            {t("settings.profile")}
          </label>
          <div className="relative">
            <select
              value={profile}
              onChange={(e) => {
                setProfile(e.target.value);
                setSaved(false);
              }}
              disabled={profilesLoading || profiles.length === 0}
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {profilesLoading
                  ? t("settings.profileLoading")
                  : profiles.length === 0
                    ? t("settings.profileNone")
                    : t("settings.profileDefault")}
              </option>
              {profiles.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name} — {p.description}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {t("settings.profileHelp")}
          </p>
        </div>

        {/* モデル選択 */}
        <div>
          <label className="text-xs font-semibold text-foreground mb-1 block">
            {t("settings.model")}
          </label>
          <div className="relative">
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setSaved(false);
              }}
              disabled={modelsLoading || models.length === 0}
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {modelsLoading
                  ? t("settings.modelLoading")
                  : models.length === 0
                    ? t("settings.modelNone")
                    : t("settings.modelDefault", { name: defaultModel })}
              </option>
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.name === defaultModel ? ` (${t("settings.modelDefaultLabel")})` : ""}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {t("settings.modelHelp")}
          </p>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={handleSave}>
          {saved ? t("common.saved") : t("common.save")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
