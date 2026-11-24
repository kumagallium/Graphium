// 配られた接続のファイル（.graphium-ai.json）を読み込む画面。
//
// 1. ファイルを選ぶ
// 2. 送り先（ノートの内容が届く先）・配った人・足すモデルを見せて、確かめてもらう。
//    キーが暗号化されていればパスフレーズを聞く
// 3. 「読み込む」で登録する。既存の接続は置き換えない（format.ts の planImport）
//
// 送り先の確認は省かない。配られたファイルの URL を書き換えられると、ノートの内容が別の先へ流れるため。

import { AlertTriangle, ChevronLeft, FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { useT } from "../../../i18n";
import { SETTINGS_CARD_CLASS } from "../SettingsGroup";
import { decryptKey, keyBinding } from "./crypto";
import {
  CONNECTION_FILE_EXTENSION,
  ConnectionFileError,
  destinationOf,
  keyKind,
  parseConnectionFileText,
  planImport,
  type ConnectionFile,
  type ExistingModel,
} from "./format";

/** 1 件分の登録。設定画面の今の経路（デスクトップはサーバー、ブラウザは localStorage）で入れる */
export type ImportModelSpec = { name: string; provider: string; modelId: string; apiKey: string; apiBase: string };

export type ConnectionFileImportProps = {
  existing: ExistingModel[];
  /** まとめて登録する。失敗したら投げる */
  importModels: (specs: ImportModelSpec[]) => Promise<void>;
  /** キーの要らない接続先に送る中身の無い値（AiConnectFlow の KEYLESS_PLACEHOLDER） */
  keylessPlaceholder: string;
  onBack: () => void;
  /** Storybook 用: 最初から読み込んだファイル */
  initialFile?: ConnectionFile;
};

const MAX_FILE_BYTES = 64 * 1024;

export function ConnectionFileImport({ existing, importModels, keylessPlaceholder, onBack, initialFile }: ConnectionFileImportProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ConnectionFile | null>(initialFile ?? null);
  const [error, setError] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    setError("");
    setFile(null);
    setPassphrase("");
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setError(t("settings.connectionFile.error.notConnectionFile"));
      return;
    }
    try {
      setFile(parseConnectionFileText(await f.text()));
    } catch (e) {
      const code = e instanceof ConnectionFileError ? e.code : "notConnectionFile";
      setError(t(`settings.connectionFile.error.${code}`));
    }
  };

  const run = async () => {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      let apiKey = "";
      if (file.key && "plain" in file.key) apiKey = file.key.plain;
      if (file.key && "encrypted" in file.key) {
        try {
          apiKey = await decryptKey(file.key.encrypted, passphrase, keyBinding(file.connection.provider, file.connection.apiBase));
        } catch {
          setError(t("settings.connectionFile.error.wrongPassphrase"));
          return;
        }
      }
      const steps = planImport(file, existing).filter((s) => s.action === "add");
      await importModels(
        steps.map((s) => ({
          name: s.name,
          provider: file.connection.provider,
          modelId: s.modelId,
          apiKey: apiKey || keylessPlaceholder,
          apiBase: file.connection.apiBase ?? "",
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-left">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={12} /> {t("settings.aiConnect.back")}
      </button>
      <h4 className="text-sm font-semibold text-foreground">{t("settings.connectionFile.import.title")}</h4>
      <p className="text-xs text-muted-foreground">{t("settings.connectionFile.import.hint")}</p>

      <input
        ref={inputRef}
        type="file"
        accept={`${CONNECTION_FILE_EXTENSION},.json,application/json`}
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
        <FileUp /> {file ? t("settings.connectionFile.import.pickAgain") : t("settings.connectionFile.import.pick")}
      </Button>

      {file && <Review file={file} existing={existing} passphrase={passphrase} onPassphraseChange={setPassphrase} />}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {file && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => void run()}
            disabled={busy || (keyKind(file) === "encrypted" && !passphrase) || planImport(file, existing).every((s) => s.action === "skip")}
          >
            {busy && <Loader2 className="animate-spin" />}
            {t("settings.connectionFile.import.run")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Review({
  file,
  existing,
  passphrase,
  onPassphraseChange,
}: {
  file: ConnectionFile;
  existing: ExistingModel[];
  passphrase: string;
  onPassphraseChange: (v: string) => void;
}) {
  const t = useT();
  const dest = destinationOf(file);
  const steps = planImport(file, existing);
  const kind = keyKind(file);
  const allSkipped = steps.every((s) => s.action === "skip");

  return (
    <div className={`${SETTINGS_CARD_CLASS} space-y-3 p-3`}>
      {/* 送り先: ノートの内容が実際に届く先。いちばん目立たせる */}
      <div>
        <p className="text-xs text-muted-foreground">{t("settings.connectionFile.import.destination")}</p>
        <p className="mt-0.5 break-all font-mono text-sm font-semibold text-foreground">{dest.host}</p>
        {dest.url && <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{dest.url}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.connectionFile.import.destinationHint")}</p>
        {!dest.secure && (
          <p className="mt-1 inline-flex items-start gap-1 text-xs text-warning">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            {t("settings.connectionFile.import.insecure")}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("settings.connectionFile.import.from")}</dt>
        <dd className="text-foreground">{file.from ?? t("settings.connectionFile.import.fromUnknown")}</dd>
        <dt className="text-muted-foreground">{t("settings.connectionFile.import.key")}</dt>
        <dd className="text-foreground">{t(`settings.connectionFile.import.key.${kind}`)}</dd>
      </dl>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">{t("settings.connectionFile.import.models")}</p>
        <ul className="space-y-0.5 text-xs">
          {steps.map((s) => (
            <li key={s.modelId} className="flex items-baseline justify-between gap-2">
              <span className={s.action === "skip" ? "text-muted-foreground" : "text-foreground"}>
                {s.name} <span className="font-mono text-muted-foreground">({s.modelId})</span>
              </span>
              <span className="shrink-0 text-muted-foreground">
                {s.action === "skip"
                  ? t("settings.connectionFile.import.skip", { name: s.existingName })
                  : t("settings.connectionFile.import.add")}
              </span>
            </li>
          ))}
        </ul>
        {allSkipped && <p className="mt-1 text-xs text-muted-foreground">{t("settings.connectionFile.import.allSkipped")}</p>}
      </div>

      {kind === "encrypted" && !allSkipped && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">{t("settings.connectionFile.import.passphrase")}</label>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => onPassphraseChange(e.target.value)}
            autoComplete="off"
            className="text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.connectionFile.import.passphraseHint")}</p>
        </div>
      )}
    </div>
  );
}
