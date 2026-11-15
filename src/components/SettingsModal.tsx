import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { APP_FULL_NAME, APP_NAME } from '../config.ts';
import { testApiKeyConnection } from '../services/geminiClient.ts';
import {
  addSubject,
  checkStoragePersisted,
  clearApiKey,
  deleteSubject,
  executeImportBundle,
  exportAllDataBundle,
  getApiKey,
  getTodayJST,
  loadState,
  parseAndPreviewImportBundle,
  renameSubject,
  requestStoragePersistence,
  setApiKey,
  setMode,
  updateLimits,
} from '../services/storeService.ts';
import type {
  AppLimits,
  AppState,
  ExportDataBundle,
  ImportPreviewCounts,
  OrganizationMode,
} from '../types.ts';
import { PWAInstallSection } from './PWAInstallSection.tsx';

interface SettingsModalProps {
  state: AppState;
  onClose: () => void;
  onStateUpdated: (state: AppState) => void;
  onApiKeyChanged?: () => void;
}

export function SettingsModal({
  state,
  onClose,
  onStateUpdated,
  onApiKeyChanged,
}: SettingsModalProps) {
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => getApiKey());
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiHelp, setShowApiHelp] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const [newSubject, setNewSubject] = useState('');
  const [renamingSubject, setRenamingSubject] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [limits, setLimits] = useState<AppLimits>({ ...state.limits });
  const [persistedStorage, setPersistedStorage] = useState<boolean | null>(null);

  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    bundle: ExportDataBundle;
    counts: ImportPreviewCounts;
  } | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void checkStoragePersisted().then(setPersistedStorage);
  }, []);

  const handleRequestPersist = async () => {
    const ok = await requestStoragePersistence();
    setPersistedStorage(ok);
    setSavedNotice(
      ok
        ? 'ブラウザにデータの永続保存（削除されにくい保護）をリクエストしました。'
        : 'このブラウザでは自動保護が許可されませんでした。定期的なJSONバックアップをご活用ください。'
    );
  };

  const handleSaveApiKey = () => {
    const clean = apiKeyInput.trim();
    setApiKeyInput(clean);
    setApiKey(clean);
    onApiKeyChanged?.();
    setKeyStatus({
      ok: true,
      message: clean
        ? 'APIキーをこのブラウザの localStorage に保存しました。'
        : 'APIキーをクリアしました。',
    });
  };

  const handleDeleteApiKey = () => {
    clearApiKey();
    setApiKeyInput('');
    onApiKeyChanged?.();
    setKeyStatus({ ok: true, message: '保存されていたAPIキーを削除しました。' });
  };

  const handleTestApiKey = async () => {
    setTestingKey(true);
    setKeyStatus(null);
    try {
      const result = await testApiKeyConnection(apiKeyInput);
      setKeyStatus(result);
    } finally {
      setTestingKey(false);
    }
  };

  const handleAddSubject = async () => {
    const clean = newSubject.trim();
    if (!clean) return;
    setErrorMsg(null);
    const res = await addSubject(clean);
    if (!res.ok || !res.state) {
      setErrorMsg(res.error ?? '科目の追加に失敗しました。');
      return;
    }
    onStateUpdated(res.state);
    setNewSubject('');
  };

  const handleConfirmRenameSubject = async (oldName: string) => {
    setErrorMsg(null);
    const res = await renameSubject(oldName, renameValue);
    if (!res.ok || !res.state) {
      setErrorMsg(res.error ?? '科目名の変更に失敗しました。');
      return;
    }
    onStateUpdated(res.state);
    setRenamingSubject(null);
    setRenameValue('');
  };

  const handleDeleteSubject = async (name: string) => {
    setErrorMsg(null);
    const res = await deleteSubject(name);
    if (!res.ok || !res.state) {
      setErrorMsg(res.error ?? '科目の削除に失敗しました。');
      return;
    }
    onStateUpdated(res.state);
  };

  const handleModeChange = async (mode: OrganizationMode) => {
    setErrorMsg(null);
    const nextState = await setMode(mode);
    onStateUpdated(nextState);
  };

  const handleSaveLimits = async () => {
    setErrorMsg(null);
    setSavedNotice(null);
    const nextState = await updateLimits(limits);
    onStateUpdated(nextState);
    setSavedNotice('上限・PDFページ制限・傾向自動非表示の設定を保存しました。');
  };

  const handleExportJson = async () => {
    const bundle = await exportAllDataBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_NAME}_backup_${getTodayJST()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const refreshed = await loadState();
    onStateUpdated(refreshed);
    setSavedNotice('全データを1つのJSONファイルにエクスポートしました（APIキーは含まれません）。');
  };

  const handleSelectImportFile = async (file: File) => {
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      const text = await file.text();
      const preview = parseAndPreviewImportBundle(text);
      if (!preview.ok || !preview.bundle || !preview.counts) {
        setErrorMsg(preview.error ?? 'インポートファイルの解析に失敗しました。');
        return;
      }
      setPendingImport({
        fileName: file.name,
        bundle: preview.bundle,
        counts: preview.counts,
      });
    } catch {
      setErrorMsg('ファイルの読み込みに失敗しました。');
    }
  };

  const handleExecuteImport = async (strategy: 'overwrite' | 'merge') => {
    if (!pendingImport) return;
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      const nextState = await executeImportBundle(pendingImport.bundle, strategy);
      onStateUpdated(nextState);
      setLimits({ ...nextState.limits });
      setPendingImport(null);
      setSavedNotice(
        strategy === 'overwrite'
          ? 'バックアップデータで既存データを上書き復元しました。'
          : 'バックアップデータを既存データに結合しました。'
      );
    } catch {
      setErrorMsg('データの復元に失敗しました。');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${APP_NAME} 設定`}
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">設定</h2>
            <p className="text-xs text-slate-500">{APP_FULL_NAME}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
            {errorMsg}
          </div>
        )}
        {savedNotice && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800">
            {savedNotice}
          </div>
        )}

        {/* 1. Gemini API Key Management */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-900" />
              <h3 className="text-sm font-semibold text-slate-900">Gemini APIキー</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowApiHelp((v) => !v)}
              className="min-h-[44px] inline-flex items-center gap-1 px-2 text-xs font-medium text-blue-900 hover:underline cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{showApiHelp ? '取得ガイド・注意点を閉じる' : '取得方法・注意点・エラー対処'}</span>
            </button>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            入力したキーはお使いのブラウザ内（localStorage）にのみ保存され、ソースコードや外部サーバーには一切保持されません。
            <strong>
              他人に共有したり、スクリーンショットに写したりしないでください。共有端末では利用後に必ず削除してください。
            </strong>
          </p>

          {showApiHelp && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 text-xs text-slate-700">
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-900">
                  取得の手順（Google AI Studio）
                </div>
                <ol className="space-y-1.5 pl-4 list-decimal leading-relaxed">
                  <li>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-900 font-semibold underline"
                    >
                      <span>Google AI Studio（aistudio.google.com）</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    にログインします。
                  </li>
                  <li>「Get API key」→「APIキーを作成（Create API key）」を押します。</li>
                  <li>発行された文字列をコピーし、下の欄に貼り付けて「保存」します。</li>
                  <li>「接続テスト」を押して成功メッセージが出れば完了です。</li>
                </ol>
                <p className="text-[11px] text-slate-500">
                  ※ Google AI Studio の画面名や手順は変わることがあります。最新の公式画面に従って操作してください。
                </p>
              </div>

              <div className="border-t border-slate-200 pt-2.5 space-y-1.5">
                <div className="font-semibold text-slate-900">利用条件・安全管理・よくあるエラー</div>
                <ul className="space-y-1 pl-4 list-disc text-[11px] text-slate-600 leading-relaxed">
                  <li>
                    <strong>年齢・規約:</strong> Gemini API の利用は原則 18歳以上が対象です（
                    <a
                      href="https://ai.google.dev/gemini-api/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-900 underline"
                    >
                      Gemini API 利用規約
                    </a>
                    ）。
                  </li>
                  <li>
                    <strong>漏洩時の対応:</strong> 万が一キーが漏れた疑いがある場合は、Google AI Studio の APIキー一覧から該当キーをすぐ削除し、新しいキーを発行してください。
                  </li>
                  <li>
                    <strong>使用状況の確認:</strong> 無料枠の上限・利用状況は Google AI Studio 内の「Rate limits（使用量と制限）」画面で確認できます。
                  </li>
                  <li>
                    <strong>エラーの対処:</strong> キーが無効な場合は前後の空白・改行を確認してください（保存時に自動で除去されます）。「今日の無料枠を使い切りました」の場合は時間を空けて再試行してください。
                  </li>
                </ul>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[210px]">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIza..."
                autoComplete="off"
                className="w-full min-h-[44px] rounded-lg border border-slate-300 pl-3 pr-11 py-2 text-sm font-mono text-slate-900"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                aria-label={showApiKey ? 'キーを隠す' : 'キーを表示'}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="button"
              onClick={handleSaveApiKey}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => void handleTestApiKey()}
              disabled={testingKey || !apiKeyInput.trim()}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-blue-900 text-blue-900 text-xs font-semibold hover:bg-blue-50 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              {testingKey ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>テスト中...</span>
                </>
              ) : (
                <span>接続テスト</span>
              )}
            </button>
            <button
              type="button"
              onClick={handleDeleteApiKey}
              className="min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              削除
            </button>
          </div>

          {keyStatus && (
            <div
              className={`rounded-lg border p-3 flex items-center gap-2 text-xs ${
                keyStatus.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {keyStatus.ok && <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />}
              <span>{keyStatus.message}</span>
            </div>
          )}

          {/* Always-visible Consent & 18+ Age Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-950 leading-relaxed space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-amber-950">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
              <span>送信データ・利用年齢に関する重要事項</span>
            </div>
            <p>
              答案画像と添削内容は、ご自身のAPIキーを通じてブラウザから直接 Google（Gemini API）へ送信されます。
              <strong>
                無料枠のAPIキーを使用する場合、送信された内容は Google の製品改善に使われ、人間が内容を確認する場合があります。
              </strong>
              氏名欄・学校名などの個人情報は写さないでください。
            </p>
            <p className="font-semibold">
              ※ Gemini API の利用は 18歳以上が対象です（
              <a
                href="https://ai.google.dev/gemini-api/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-900 underline"
              >
                Gemini API 利用規約
              </a>
              ）。
            </p>
            {state.consentAccepted && (
              <div className="text-[11px] text-emerald-800 font-medium">
                同意済み
                {state.consentAcceptedAt
                  ? `（${new Date(state.consentAcceptedAt).toLocaleString('ja-JP')}）`
                  : ''}
              </div>
            )}
          </div>
        </section>

        {/* 2. PWA Install */}
        <section className="space-y-2 border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">アプリインストール（PWA）</h3>
          <PWAInstallSection />
        </section>

        {/* 3. Organization Mode */}
        <section className="space-y-2 border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">整理モード</h3>
          <p className="text-xs text-slate-500">
            AIによる単元フォルダ作成・移動・名前変更・統合の実行方法を選びます（知識項目の保存に伴う最小限のフォルダ作成は自動実行されます）。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {(
              [
                ['確認', '確認モード', '整理操作を提案として保留し、承認後に実行'],
                ['一任', '一任モード', 'AIの判断で整理操作を即時実行'],
              ] as const
            ).map(([val, title, desc]) => {
              const active = state.mode === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => void handleModeChange(val)}
                  className={`min-h-[44px] text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                    active ? 'border-blue-900 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{desc}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 4. Subjects Management (Add / Rename / Delete) */}
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">科目の管理</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              AIは科目を自動で作成・変更・削除しません。受験科目に合わせて追加・名前変更・削除ができます。
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleAddSubject();
                }
              }}
              placeholder="新しい科目名（例: 化学、世界史）"
              className="flex-1 min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
            <button
              type="button"
              onClick={() => void handleAddSubject()}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>追加</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {state.subjects.map((sub) => {
              const isRenaming = renamingSubject === sub;
              return (
                <div key={sub} className="px-3.5 py-2 flex items-center justify-between gap-2 text-sm">
                  {isRenaming ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 min-h-[38px] rounded border border-slate-300 px-2.5 py-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void handleConfirmRenameSubject(sub)}
                        className="min-h-[38px] inline-flex items-center gap-1 px-3 rounded bg-blue-900 text-white text-xs font-medium cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>確定</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingSubject(null)}
                        className="min-h-[38px] px-2.5 rounded text-xs text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        中止
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium text-slate-800">{sub}</span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingSubject(sub);
                            setRenameValue(sub);
                          }}
                          className="min-h-[36px] inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-900 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>名前変更</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSubject(sub)}
                          className="min-h-[36px] inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>削除</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 5. Limits & Auto-hide */}
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              登録・PDFページ上限・傾向自動非表示
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              1回の添削における登録件数・文字数・往復上限、PDFページ数上限、および「その科目の添削で連続N回発生しなかった傾向」を自動非表示にする回数を設定します（初期値: 5回）。
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {(
              [
                ['maxPdfPages', 'PDF最大ページ数 (枚)', 1],
                ['autoHideTendencyReviews', '傾向 自動非表示 (同科目連続回, 0=無効)', 0],
                ['maxSavePerReview', '知識登録/回 (件)', 1],
                ['maxTendencyPerReview', '傾向記録/回 (件)', 1],
                ['maxToolRounds', 'ツール往復上限 (回)', 1],
                ['maxHeadingLength', '見出し上限 (文字)', 1],
                ['maxTendencyNameLength', '傾向名上限 (文字)', 1],
                ['maxExplanationLength', '解説上限 (文字)', 1],
                ['maxSituationLength', '状況上限 (文字)', 1],
                ['maxReasonLength', '理由上限 (文字)', 1],
                ['maxNoteLength', 'ひとこと上限 (文字)', 1],
              ] as const
            ).map(([key, label, minVal]) => (
              <label key={key} className="space-y-1 block">
                <span className="text-slate-600 font-medium block">{label}</span>
                <input
                  type="number"
                  min={minVal}
                  value={limits[key]}
                  onChange={(e) =>
                    setLimits((prev) => ({
                      ...prev,
                      [key]: Math.max(minVal, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 tabular-nums"
                />
              </label>
            ))}
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => void handleSaveLimits()}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 cursor-pointer"
            >
              上限設定を保存
            </button>
          </div>
        </section>

        {/* 6. Backup Export / Import & Storage Persistence */}
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              データのバックアップと端末保護（エクスポート / インポート）
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              データはこのブラウザ内に保存されており、他の端末とは同期されません。ブラウザのデータ削除等で消える可能性があるため、定期的なエクスポートをおすすめします（APIキーは出力されません）。
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-slate-700">
              <Database className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                ブラウザ永続ストレージ保護:{' '}
                <strong>
                  {persistedStorage === null
                    ? '確認中...'
                    : persistedStorage
                      ? '有効（削除されにくい状態）'
                      : '未確定 / 標準'}
                </strong>
              </span>
            </div>
            {persistedStorage === false && (
              <button
                type="button"
                onClick={() => void handleRequestPersist()}
                className="min-h-[36px] px-3 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                保護をリクエスト
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleExportJson()}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>全データをJSONエクスポート</span>
            </button>

            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>JSONファイルからインポート</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleSelectImportFile(file);
                e.currentTarget.value = '';
              }}
            />
          </div>

          {pendingImport && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-amber-950">
                    インポート内容の確認: {pendingImport.fileName}
                  </div>
                  <div className="text-amber-900 tabular-nums">
                    科目 {pendingImport.counts.subjects} · フォルダ {pendingImport.counts.folders} ·
                    知識項目 {pendingImport.counts.items}件 · 傾向 {pendingImport.counts.tendencies}件 ·
                    履歴 {pendingImport.counts.reviews}件 · 提案 {pendingImport.counts.proposals}件
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleExecuteImport('merge')}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 cursor-pointer"
                >
                  既存データに結合する
                </button>
                <button
                  type="button"
                  onClick={() => void handleExecuteImport('overwrite')}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-red-700 text-white text-xs font-semibold hover:bg-red-800 cursor-pointer"
                >
                  既存データを上書きする
                </button>
                <button
                  type="button"
                  onClick={() => setPendingImport(null)}
                  className="min-h-[44px] px-3 py-2 rounded-lg text-xs text-slate-600 hover:bg-amber-100 cursor-pointer"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 7. Operation Logs */}
        <section className="space-y-2 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            {showLogs
              ? `操作ログを閉じる（${state.logs.length}件）`
              : `操作ログを表示する（直近 ${state.logs.length}件）`}
          </button>

          {showLogs && (
            <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
              {state.logs.length === 0 ? (
                <div className="p-3 text-slate-500">まだ操作ログはありません。</div>
              ) : (
                state.logs.slice(0, 50).map((log) => (
                  <div key={log.id} className="px-3 py-2 flex items-baseline justify-between gap-3">
                    <div className="space-x-2">
                      <span className="font-semibold text-slate-800">{log.action}</span>
                      <span className="text-slate-600">{log.detail}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono shrink-0 tabular-nums">
                      {new Date(log.timestamp).toLocaleString('ja-JP')}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
