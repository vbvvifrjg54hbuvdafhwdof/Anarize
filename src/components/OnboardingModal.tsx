import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { useState } from 'react';
import { APP_FULL_NAME, APP_NAME } from '../config.ts';
import { testApiKeyConnection } from '../services/geminiClient.ts';
import { getApiKey, setApiKey } from '../services/storeService.ts';
import { PWAInstallSection } from './PWAInstallSection.tsx';

interface OnboardingModalProps {
  consentAccepted: boolean;
  hasApiKey: boolean;
  onAcceptConsent: () => Promise<void>;
  onApiKeySaved: () => void;
  onSkipKeyForSession: () => void;
  onDismissInstallGuide?: () => Promise<void>;
}

export function OnboardingModal({
  consentAccepted,
  hasApiKey,
  onAcceptConsent,
  onApiKeySaved,
  onSkipKeyForSession,
  onDismissInstallGuide,
}: OnboardingModalProps) {
  const [checked, setChecked] = useState(consentAccepted);
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => getApiKey());
  const [showKey, setShowKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const canProceed = consentAccepted || checked;

  const handleTestKey = async () => {
    const clean = apiKeyInput.trim();
    if (!clean) return;
    setTestingKey(true);
    setKeyStatus(null);
    try {
      const res = await testApiKeyConnection(clean);
      setKeyStatus(res);
    } finally {
      setTestingKey(false);
    }
  };

  const handleSaveAndStart = async () => {
    if (!canProceed || busy) return;
    setBusy(true);
    try {
      if (!consentAccepted) {
        await onAcceptConsent();
      }
      const clean = apiKeyInput.trim();
      if (clean) {
        setApiKey(clean);
        onApiKeySaved();
      }
      if (onDismissInstallGuide) {
        await onDismissInstallGuide();
      }
      onSkipKeyForSession();
    } finally {
      setBusy(false);
    }
  };

  const handleContinueWithoutKey = async () => {
    if (!canProceed || busy) return;
    setBusy(true);
    try {
      if (!consentAccepted) {
        await onAcceptConsent();
      }
      if (onDismissInstallGuide) {
        await onDismissInstallGuide();
      }
      onSkipKeyForSession();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${APP_NAME} 初回セットアップガイド`}
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-3.5 sm:p-5 space-y-3.5">
        <div className="space-y-0.5 border-b border-slate-200 pb-3">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            {APP_FULL_NAME} へようこそ
          </h2>
          <p className="text-xs text-slate-500">
            ブラウザ完結型の大学受験 答案添削・復習ノートアプリ（{hasApiKey ? '利用同意の確認' : '初期ガイド & APIキー設定'}）
          </p>
        </div>

        {/* 1. Local-only Storage Notice */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <BookOpen className="w-4 h-4 text-blue-900 shrink-0" />
            <span>1. データはお使いの端末内だけに保存されます</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed pl-6">
            知識ノート・ミスの傾向・添削履歴・設定はすべてブラウザ内の IndexedDB に保存され、専用のサーバーには一切送信・保存されません。答案画像は添削完了後に即座に破棄されます（端末間での自動同期はないため、設定画面から定期的なJSONバックアップをおすすめします）。
          </p>
        </section>

        {/* 2. Mandatory Google Data Transmission Consent & Age Notice */}
        <section className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-amber-950">
                2. 答案データの送信・年齢条件に関する同意（必須）
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">
                添削を実行すると、答案画像と添削内容はご自身のAPIキーを通じてブラウザから直接 Google（Gemini API）へ送信されます。
                <strong>
                  無料枠のAPIキーを使用する場合、送信された内容は Google の製品改善に使われ、人間が内容を確認する場合があります。
                </strong>
                撮影・送信の前に、氏名欄・学校名・受験番号などの個人情報が写っていないことを必ずご確認ください。
              </p>
              <p className="text-xs text-amber-950 font-semibold leading-relaxed">
                ※ Gemini API の利用は 18歳以上を対象としています。18歳未満の方は必ず保護者に確認のうえ、Google の利用規約をご確認ください。
              </p>
            </div>
          </div>

          {consentAccepted ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 pl-7">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              <span>利用条件・送信内容に同意済みです</span>
            </div>
          ) : (
            <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none min-h-[44px]">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-amber-400 text-blue-900 focus:ring-blue-900 shrink-0"
              />
              <span className="text-xs font-medium text-slate-900 leading-relaxed">
                上記の内容（答案と添削内容はGoogleに送信され、無料枠では製品改善に使われ、人間が確認する場合があること／Gemini APIの利用は18歳以上であること）を理解し、同意します。
              </span>
            </label>
          )}
        </section>

        {/* 3. API Key Step-by-Step Guide & Input */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <KeyRound className="w-4 h-4 text-blue-900 shrink-0" />
            <span>3. Gemini APIキーの準備と入力</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 text-xs text-slate-700">
            <ol className="space-y-1 pl-4 list-decimal leading-snug">
              <li>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-blue-900 underline underline-offset-2"
                >
                  <span>Google AI Studio</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                を開き、Google アカウントでログインします（利用対象は18歳以上です。保護者の方ともご確認ください）。
              </li>
              <li>画面の「Get API key」→「APIキーを作成（Create API key）」を押します。</li>
              <li>発行されたキー文字列をコピーします（画面のスクリーンショットやSNS等で他人に共有しないでください）。</li>
              <li>下の入力欄に貼り付け、「接続テスト」で成功を確認してから開始します。</li>
            </ol>
            <p className="text-xs text-slate-500">
              ※ Google AI Studio の画面名や手順は変更されることがあります。無料枠には1分・1日あたりの回数上限があります。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[13rem]">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIza...（あとから設定画面でも登録できます）"
                autoComplete="off"
                className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 pl-3 pr-11 py-2 text-sm font-mono text-slate-900"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'キーを隠す' : 'キーを表示'}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              disabled={testingKey || !apiKeyInput.trim()}
              onClick={() => void handleTestKey()}
              className="min-h-[max(44px,2.75rem)] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-blue-900 text-blue-900 text-xs font-semibold hover:bg-blue-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
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

        {/* 4. PWA Install Section */}
        <PWAInstallSection />

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
          <button
            type="button"
            disabled={!canProceed || busy}
            onClick={() => void handleContinueWithoutKey()}
            className="min-h-[max(44px,2.75rem)] px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            あとでキーを設定する（閲覧・復元へ）
          </button>
          <button
            type="button"
            disabled={!canProceed || busy || !apiKeyInput.trim()}
            onClick={() => void handleSaveAndStart()}
            className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>キーを保存して始める</span>
          </button>
        </div>
      </div>
    </div>
  );
}
