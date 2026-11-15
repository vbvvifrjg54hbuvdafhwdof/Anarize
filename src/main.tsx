import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { clearAppCachesAndReload } from './utils/cacheRecovery.ts';

// Recover automatically if a stale HTML references an outdated chunk hash
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  void clearAppCachesAndReload();
});

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Anarize runtime error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
            <h1 className="text-base font-bold text-slate-900">
              画面の読み込み中にエラーが発生しました
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              古いキャッシュが残っている可能性があります。下のボタンからキャッシュを消去して最新版を再読み込みしてください（学習データやAPIキーは保持されます）。
            </p>
            <div className="bg-slate-100 rounded-lg p-3 text-[11px] font-mono text-slate-700 break-all">
              {this.state.error.message}
            </div>
            <button
              type="button"
              onClick={() => void clearAppCachesAndReload()}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 cursor-pointer"
            >
              キャッシュを最新にして再読み込み
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
