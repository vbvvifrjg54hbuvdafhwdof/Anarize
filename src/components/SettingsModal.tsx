import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { testApiKeyConnection } from '../services/geminiClient.ts';
import {
  addSubject,
  clearApiKey,
  deleteSubject,
  exportAllDataBundle,
  getApiKey,
  getTodayJST,
  importAllDataBundle,
  setApiKey,
  setMode,
  updateLimits,
} from '../services/storeService.ts';
import type { AppLimits, AppState, OrganizationMode } from '../types.ts';

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
  const [testingKey, setTestingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const [newSubject, setNewSubject] = useState('');
  const [limits, setLimits] = useState<AppLimits>({ ...state.limits });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveApiKey = () => {
    setApiKey(apiKeyInput);
    onApiKeyChanged?.();
    setKeyStatus({
      ok: true,
      message: apiKeyInput.trim()
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
    setSavedNotice('上限・自動非表示設定を保存しました。');
  };

  const handleExportJson = async () => {
    const bundle = await exportAllDataBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tensaku_backup_${getTodayJST()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSavedNotice('全データを1つのJSONファイルにエクスポートしました（APIキーは含まれません）。');
  };

  const handleImportJson = async (file: File) => {
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      const text = await file.text();
      const res = await importAllDataBundle(text);
      if (!res.ok || !res.state) {
        setErrorMsg(res.error ?? 'インポートに失敗しました。');
        return;
      }
      onStateUpdated(res.state);
      setLimits({ ...res.state.limits });
      setSavedNotice('バックアップファイルから全データを復元しました。');
    } catch {
      setErrorMsg('ファイルの読み込みに失敗しました。');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="環境設定"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <h2 className="text-lg font-semibold text-slate-900">環境設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
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
              <KeyRound className="w-4 h-4 text-sky-700" />
              <h3 className="text-sm font-semibold text-slate-900">Gemini APIキー</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowApiHelp((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{showApiHelp ? '取得方法を閉じる' : 'APIキーの取得方法を見る'}</span>
            </button>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            入力したキーはお使いのブラウザ内（localStorage）にのみ保存され、ソースコードや外部サーバーには保持されません。共有端末では利用後に削除してください。
          </p>

          {showApiHelp && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                APIキー取得の手順（Google AI Studio）
              </div>
              <ol className="text-xs text-slate-600 space-y-1.5 pl-4 list-decimal leading-relaxed">
                <li>Google AI Studio（aistudio.google.com）を開き、Google アカウントでログインします。</li>
                <li>「Get API key」→「APIキーを作成（Create API key）」をクリックします。</li>
                <li>発行された `AIza...` から始まるキー文字列をコピーします。</li>
                <li>下の入力欄に貼り付けて「保存」を押し、「接続テスト」で動作を確認します。</li>
              </ol>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIza..."
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 pl-3 pr-9 py-2 text-sm font-mono text-slate-900"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                aria-label={showApiKey ? 'キーを隠す' : 'キーを表示'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="button"
              onClick={handleSaveApiKey}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => void handleTestApiKey()}
              disabled={testingKey || !apiKeyInput.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-sky-700 text-sky-800 text-xs font-semibold hover:bg-sky-50 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
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
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 cursor-pointer whitespace-nowrap shrink-0"
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
        </section>

        {/* 2. Organization Mode */}
        <section className="space-y-2 border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">整理モード</h3>
          <p className="text-xs text-slate-500">
            AIによる単元フォルダ作成・移動・名前変更・統合の実行方法を選びます（知識項目の保存に伴う最小限のフォルダ作成は自動実行されます）。
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
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
                  className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? 'border-sky-700 bg-sky-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{desc}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 3. Subjects Management */}
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">科目の管理</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              AIは科目を自動で作成・変更・削除しません。受験科目に合わせてここで管理してください。
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
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
            <button
              type="button"
              onClick={() => void handleAddSubject()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>追加</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {state.subjects.map((sub) => (
              <div key={sub} className="px-3.5 py-2.5 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-800">{sub}</span>
                <button
                  type="button"
                  onClick={() => void handleDeleteSubject(sub)}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-700 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>削除</span>
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* 4. Limits & Auto-hide */}
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">登録・呼び出し上限・自動非表示</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              1回の添削における登録件数・文字数・往復上限と、長期間発生していない傾向の自動非表示日数を設定します。
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {(
              [
                ['maxSavePerReview', '知識登録/回 (件)', 1],
                ['maxTendencyPerReview', '傾向記録/回 (件)', 1],
                ['maxToolRounds', 'ツール往復上限 (回)', 1],
                ['maxHeadingLength', '見出し上限 (文字)', 1],
                ['maxTendencyNameLength', '傾向名上限 (文字)', 1],
                ['maxExplanationLength', '解説上限 (文字)', 1],
                ['maxSituationLength', '状況上限 (文字)', 1],
                ['maxReasonLength', '理由上限 (文字)', 1],
                ['maxNoteLength', 'ひとこと上限 (文字)', 1],
                ['autoHideTendencyDays', '傾向 自動非表示 (日, 0=無効)', 0],
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
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 tabular-nums"
                />
              </label>
            ))}
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => void handleSaveLimits()}
              className="px-4 py-2 rounded-lg bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 cursor-pointer"
            >
              上限設定を保存
            </button>
          </div>
        </section>

        {/* 5. Backup Export / Import (Excludes API Key) */}
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">データのバックアップ（エクスポート / インポート）</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              知識ノート・ミスの傾向・添削履歴・提案・設定を1つのJSONファイルで保存・復元できます（セキュリティのためAPIキーは出力されません）。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleExportJson()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>全データをエクスポート</span>
            </button>

            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>ファイルからインポート</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportJson(file);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
