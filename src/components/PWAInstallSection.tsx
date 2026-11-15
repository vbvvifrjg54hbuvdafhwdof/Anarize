import { CheckCircle2, Download, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export function PWAInstallSection() {
  const { canInstallPrompt, isStandalone, isIOS, isIOSSafari, install } = usePWAInstall();
  const [installNote, setInstallNote] = useState<string | null>(null);

  const handleInstallClick = async () => {
    const outcome = await install();
    if (outcome === 'accepted') {
      setInstallNote('ホーム画面への追加を開始しました。');
    } else if (outcome === 'dismissed') {
      setInstallNote('インストールはキャンセルされました。いつでも設定画面から追加できます。');
    }
  };

  if (isStandalone) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 flex items-center gap-2.5 text-xs text-emerald-900">
        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
        <span>
          アプリとしてインストール済み（スタンドアロン表示）です。定期的なJSONバックアップもおすすめです。
        </span>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <Smartphone className="w-4 h-4 text-blue-900 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-900">
            ホーム画面に追加してアプリとして使う（PWA）
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            インストールすると全画面表示で集中して使えるほか、ブラウザの履歴掃除で学習データが消えるリスクを減らせます（念のため定期的なJSONバックアップも推奨します）。
          </p>
        </div>
      </div>

      {canInstallPrompt && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => void handleInstallClick()}
            className="w-full sm:w-auto min-h-[max(44px,2.75rem)] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>アプリとしてインストール</span>
          </button>
        </div>
      )}

      {isIOS && isIOSSafari && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2.5">
          <div className="text-xs font-semibold text-slate-800">
            iPhone / iPad（Safari）での追加手順
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-700">
            <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-md p-2.5">
              <svg
                viewBox="0 0 36 36"
                className="w-8 h-8 shrink-0 text-blue-900"
                aria-hidden="true"
              >
                <rect x="6" y="13" width="24" height="19" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M18 22V5m0 0l-5 5m5-5l5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div>
                <div className="font-semibold text-slate-900">1. 共有ボタン（□↑）</div>
                <div className="text-xs text-slate-500">画面下部または上部の共有アイコンをタップ</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-md p-2.5">
              <svg
                viewBox="0 0 36 36"
                className="w-8 h-8 shrink-0 text-blue-900"
                aria-hidden="true"
              >
                <rect x="5" y="5" width="26" height="26" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M18 11v14M11 18h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              <div>
                <div className="font-semibold text-slate-900">2.「ホーム画面に追加」</div>
                <div className="text-xs text-slate-500">一覧から選び、右上の「追加」をタップ</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isIOS && !isIOSSafari && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
          iPhone / iPad でホーム画面に追加するには、このページのURLをコピーして <strong>Safari で開いてから追加してください</strong>。
        </div>
      )}

      {!isIOS && !canInstallPrompt && (
        <div className="text-xs text-slate-500 leading-relaxed">
          Chrome・Edge では、アドレスバー右端のインストールアイコンまたはブラウザメニュー（⋮）の「アプリをインストール」「ホーム画面に追加」からも追加できます。
        </div>
      )}

      {installNote && <div className="text-xs text-blue-900 font-medium">{installNote}</div>}
    </div>
  );
}
