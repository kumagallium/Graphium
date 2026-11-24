// 接続を配るファイル（.graphium-ai.json）を書き出す画面。
//
// 研究室で 1 人がつないだ接続（研究室のサーバーなど）を選び、ファイルにしてほかの人へ渡す。
// キーは任意。入れるときは既定でパスフレーズで暗号化する（研究室の中だけで渡すなら外せる）。
//
// キーは、ここでもう一度貼ってもらう。保存済みのキーを読み出す口は作らない
// （デスクトップでは Keychain にあり、サーバーの一覧の API もキーを返さない。その守りを崩さない）。

import { AlertTriangle, Download, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { useT } from "../../../i18n";
import { SETTINGS_CARD_CLASS } from "../SettingsGroup";
import { encryptKey, keyBinding, MIN_PASSPHRASE_LENGTH } from "./crypto";
import { buildConnectionFile, ConnectionFileError, suggestedFileName, type ConnectionFileKey, type DistributableProvider } from "./format";

/** 配れる接続（設定画面の一覧を、種類と送り先でまとめたもの） */
export type ExportableGroup = {
  id: string;
  label: string;
  provider: DistributableProvider;
  apiBase: string | null;
  models: { name: string; modelId: string }[];
};

export type ConnectionFileExportProps = {
  groups: ExportableGroup[];
  /** 配る人の名前の初期値（共有の「あなたの名前」など。無ければ空） */
  defaultFrom?: string;
  /** 保存する（デスクトップは保存ダイアログ、ブラウザはダウンロード）。キャンセルなら false */
  save: (blob: Blob, filename: string) => Promise<boolean>;
  onClose: () => void;
  /** 暗号化の反復回数（テスト用に下げられる） */
  iterations?: number;
};

type KeyMode = "none" | "include";

export function ConnectionFileExport({ groups, defaultFrom = "", save, onClose, iterations }: ConnectionFileExportProps) {
  const t = useT();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const group = groups.find((g) => g.id === groupId);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(groups[0]?.models.map((m) => m.modelId) ?? []));
  const [from, setFrom] = useState(defaultFrom);
  const [keyMode, setKeyMode] = useState<KeyMode>("none");
  const [apiKey, setApiKey] = useState("");
  const [encrypt, setEncrypt] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [passphrase2, setPassphrase2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const chooseGroup = (id: string) => {
    setGroupId(id);
    setSelected(new Set(groups.find((g) => g.id === id)?.models.map((m) => m.modelId) ?? []));
    setSaved("");
  };

  // 各社の公式の API はキーが無いと呼べないので、キーを入れる形だけにする
  const keyRequired = !!group && group.provider !== "openai-compatible";
  const effectiveKeyMode: KeyMode = keyRequired ? "include" : keyMode;

  const passphraseProblem =
    effectiveKeyMode === "include" && encrypt
      ? passphrase.normalize("NFC").length < MIN_PASSPHRASE_LENGTH
        ? t("settings.connectionFile.export.passphraseShort", { n: String(MIN_PASSPHRASE_LENGTH) })
        : passphrase !== passphrase2
          ? t("settings.connectionFile.export.passphraseMismatch")
          : ""
      : "";
  const canExport =
    !!group && selected.size > 0 && (effectiveKeyMode === "none" || (apiKey.trim() !== "" && !passphraseProblem)) && !busy;

  const run = async () => {
    if (!group) return;
    setError("");
    setSaved("");
    setBusy(true);
    try {
      let key: ConnectionFileKey | undefined;
      if (effectiveKeyMode === "include") {
        key = encrypt
          ? { encrypted: await encryptKey(apiKey.trim(), passphrase, keyBinding(group.provider, group.apiBase), iterations) }
          : { plain: apiKey.trim() };
      }
      const file = buildConnectionFile({
        provider: group.provider,
        apiBase: group.apiBase,
        models: group.models.filter((m) => selected.has(m.modelId)),
        from,
        key,
      });
      const filename = suggestedFileName(group.models.find((m) => selected.has(m.modelId))?.name ?? "ai");
      const ok = await save(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), filename);
      if (ok) setSaved(filename);
    } catch (e) {
      setError(e instanceof ConnectionFileError ? t(`settings.connectionFile.error.${e.code}`) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = "mb-1.5 block text-xs font-medium text-foreground";

  if (groups.length === 0) {
    return (
      <div className={`${SETTINGS_CARD_CLASS} space-y-2 p-3 text-left`}>
        <Header onClose={onClose} />
        <p className="text-xs text-muted-foreground">{t("settings.connectionFile.export.noGroups")}</p>
      </div>
    );
  }

  return (
    <div className={`${SETTINGS_CARD_CLASS} space-y-3 p-3 text-left`}>
      <Header onClose={onClose} />
      <p className="text-xs text-muted-foreground">{t("settings.connectionFile.export.hint")}</p>

      <div>
        <label className={label}>{t("settings.connectionFile.export.connection")}</label>
        <select
          value={groupId}
          onChange={(e) => chooseGroup(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      {group && (
        <fieldset>
          <legend className={label}>{t("settings.connectionFile.export.models")}</legend>
          <div className="space-y-1">
            {group.models.map((m) => (
              <label key={m.modelId} className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={selected.has(m.modelId)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(m.modelId);
                    else next.delete(m.modelId);
                    setSelected(next);
                  }}
                />
                {m.name} <span className="font-mono text-muted-foreground">({m.modelId})</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <label className={label}>{t("settings.connectionFile.export.from")}</label>
        <Input value={from} onChange={(e) => setFrom(e.target.value)} className="text-sm" maxLength={100} />
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.connectionFile.export.fromHint")}</p>
      </div>

      <fieldset className="space-y-1.5">
        <legend className={label}>{t("settings.connectionFile.export.key")}</legend>
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="radio" name="cf-key" disabled={keyRequired} checked={effectiveKeyMode === "none"} onChange={() => setKeyMode("none")} />
          {t("settings.connectionFile.export.keyNone")}
        </label>
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="radio" name="cf-key" checked={effectiveKeyMode === "include"} onChange={() => setKeyMode("include")} />
          {t("settings.connectionFile.export.keyInclude")}
        </label>
      </fieldset>

      {keyRequired && <p className="text-xs text-muted-foreground">{t("settings.connectionFile.export.keyRequired")}</p>}

      {effectiveKeyMode === "include" && (
        <div className="space-y-2 border-l-2 border-border pl-3">
          <div>
            <label className={label}>{t("settings.connectionFile.export.keyValue")}</label>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" className="font-mono text-sm" />
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.connectionFile.export.keyValueHint")}</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
            {t("settings.connectionFile.export.encrypt")}
          </label>
          {encrypt ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={label}>{t("settings.connectionFile.export.passphrase")}</label>
                <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" className="text-sm" />
              </div>
              <div>
                <label className={label}>{t("settings.connectionFile.export.passphrase2")}</label>
                <Input type="password" value={passphrase2} onChange={(e) => setPassphrase2(e.target.value)} autoComplete="new-password" className="text-sm" />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t("settings.connectionFile.export.passphraseHint")}</p>
              {passphraseProblem && (passphrase || passphrase2) && (
                <p className="text-xs text-destructive sm:col-span-2">{passphraseProblem}</p>
              )}
            </div>
          ) : (
            <p className="inline-flex items-start gap-1 text-xs text-warning">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
              {t("settings.connectionFile.export.plainWarning")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t("settings.connectionFile.export.keyWarning")}</p>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-xs text-foreground" role="status">
          {t("settings.connectionFile.export.saved", { file: saved })}
        </p>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void run()} disabled={!canExport}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {t("settings.connectionFile.export.run")}
        </Button>
      </div>
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold text-foreground">{t("settings.connectionFile.export.title")}</h4>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("settings.connectionFile.export.close")}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
