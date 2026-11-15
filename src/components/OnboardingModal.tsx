import { BookOpen, CheckCircle2, KeyRound, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

interface OnboardingModalProps {
  onAcceptConsent: () => Promise<void>;
  onOpenSettingsAfterConsent: () => Promise<void>;
}

export function OnboardingModal({
  onAcceptConsent,
  onOpenSettingsAfterConsent,
}: OnboardingModalProps) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleStart = async (openSettings: boolean) => {
    if (!checked || busy) return;
    setBusy(true);
    try {
      if (openSettings) {
        await onOpenSettingsAfterConsent();
      } else {
        await onAcceptConsent();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="初回起動ガイドと利用規約への同意"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6">
        <div className="space-y-1 border-b border-slate-200 pb-4">
          <h2 className="text-xl font-bold text-slate-900">添削ノートへようこそ</h2>
          <p className="text-xs text-slate-500">
            ブラウザ完結型の大学受験 答案添削・復習ノートアプリです
          </p>
        </div>

        {/* 1. Data & Privacy Architecture */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <BookOpen className="w-4 h-4 text-sky-700 shrink-0" />
            <span>1. データはお使いの端末内だけに保存されます</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed pl-6">
            知識ノート・ミスの傾向・添削履歴・設定はすべてブラウザ内の IndexedDB に保存され、専用のバックエンドサーバーへは一切保存されません。また、提出した答案画像は添削完了後に即座に破棄されます。
          </p>
        </section>

        {/* 2. API Key Step Guide */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <KeyRound className="w-4 h-4 text-sky-700 shrink-0" />
            <span>2. Gemini APIキーの準備（初回のみ）</span>
          </div>
          <ol className="text-xs text-slate-600 space-y-1.5 pl-6 list-decimal leading-relaxed">
            <li>Google AI Studio（aistudio.google.com）に Google アカウントでログインします。</li>
            <li>左メニューまたは画面上部の「Get API key」を開き、「APIキーを作成」を押します。</li>
            <li>発行されたキーをコピーし、このアプリの「環境設定」→「APIキー」欄に貼り付けて保存します。</li>
            <li>「接続テスト」ボタンを押して「接続に成功しました」と表示されれば準備完了です。</li>
          </ol>
        </section>

        {/* 3. Mandatory Google Data Transmission Consent */}
        <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-amber-950">
                答案データの送信に関する重要なお知らせ
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">
                添削を実行すると、答案の画像・PDFや確認への回答は、ご自身のAPIキーを通じてブラウザから直接 Google（Gemini API）へ送信されます。
                <strong>無料枠のAPIキーを使用する場合、送信された答案やテキストは Google によるAIモデルの改善・学習に使われることがあります。</strong>
                撮影・送信の前に、氏名欄・受験番号・学校名などの個人情報が写っていないことを必ずご確認ください。
              </p>
            </div>
          </div>

          <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-amber-400 text-sky-700 focus:ring-sky-600"
            />
            <span className="text-xs font-medium text-slate-900">
              上記の内容（答案はGoogleに送信され、無料枠では改善に使われる場合があること）を理解し、同意します。
            </span>
          </label>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-slate-200">
          <button
            type="button"
            disabled={!checked || busy}
            onClick={() => void handleStart(false)}
            className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            あとでキーを設定して始める
          </button>
          <button
            type="button"
            disabled={!checked || busy}
            onClick={() => void handleStart(true)}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>同意してAPIキーを設定する</span>
          </button>
        </div>
      </div>
    </div>
  );
}
