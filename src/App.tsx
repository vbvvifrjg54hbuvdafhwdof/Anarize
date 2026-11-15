import { useCallback, useEffect, useState } from 'react';
import { ExportView } from './components/ExportView.tsx';
import { GradingDesk } from './components/GradingDesk.tsx';
import { KnowledgeNotebook } from './components/KnowledgeNotebook.tsx';
import { OnboardingModal } from './components/OnboardingModal.tsx';
import { ProposalsView } from './components/ProposalsView.tsx';
import { ReviewHistory } from './components/ReviewHistory.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { TendencyLog } from './components/TendencyLog.tsx';
import {
  acceptConsent,
  getApiKey,
  loadState,
  setMode,
} from './services/storeService.ts';
import type { AppState, OrganizationMode } from './types.ts';

type ActiveTab = 'grade' | 'knowledge' | 'tendencies' | 'history' | 'export' | 'proposals';

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('grade');
  const [showSettings, setShowSettings] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(() => Boolean(getApiKey()));

  const [focusedKnowledge, setFocusedKnowledge] = useState<{
    heading: string;
    subject: string;
  } | null>(null);
  const [focusedTendency, setFocusedTendency] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const data = await loadState();
      setState(data);
      setHasApiKey(Boolean(getApiKey()));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'ローカルデータベース（IndexedDB）の読み込みに失敗しました。'
      );
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const handleModeSwitch = async (mode: OrganizationMode) => {
    const nextState = await setMode(mode);
    setState(nextState);
  };

  const handleAcceptConsent = async (openSettingsAfter: boolean) => {
    const nextState = await acceptConsent();
    setState(nextState);
    if (openSettingsAfter) {
      setShowSettings(true);
    }
  };

  const handleJumpToKnowledge = useCallback((heading: string, subject: string) => {
    setFocusedKnowledge({ heading, subject });
    setActiveTab('knowledge');
  }, []);

  const handleJumpToTendency = useCallback((tendencyName: string) => {
    setFocusedTendency(tendencyName);
    setActiveTab('tendencies');
  }, []);

  const pendingProposalsCount =
    state?.proposals.filter((p) => p.status === 'pending').length ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 1 row, 3 zones separated by gap-8 */}
      <header className="no-print bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('grade')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            添削ノート
          </button>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav className="flex items-center gap-5 sm:gap-7 overflow-x-auto text-sm font-medium">
            {(
              [
                ['grade', '添削する'],
                ['knowledge', '知識ノート'],
                ['tendencies', 'ミスの傾向'],
                ['history', '添削履歴'],
                ['export', '出力'],
              ] as const
            ).map(([tabKey, label]) => {
              const active = activeTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setActiveTab(tabKey)}
                  className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-sky-700 text-slate-900 font-semibold'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              環境設定
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loadError && (
          <div className="no-print bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 flex items-center justify-between gap-4">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => void refreshState()}
              className="px-3 py-1.5 rounded-lg bg-white border border-red-300 text-xs font-medium text-red-800 hover:bg-red-100 cursor-pointer"
            >
              再読み込み
            </button>
          </div>
        )}

        {!state && !loadError && (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            ワークスペースを読み込んでいます...
          </div>
        )}

        {state && (
          <>
            {/* Workspace Toolbar */}
            <div className="no-print bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <span className="font-medium text-slate-800">整理モード:</span>
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['確認', '一任'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => void handleModeSwitch(m)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        state.mode === m
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <span className="text-slate-500">
                  {state.mode === '確認'
                    ? '整理操作は承認待ちの提案として保留されます'
                    : 'AIが必要に応じて整理操作を即時実行します'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 tabular-nums">
                <span>
                  知識 {state.items.filter((i) => !i.hidden).length}件 · 傾向{' '}
                  {state.tendencies.filter((t) => !t.hidden).length}件 · 履歴{' '}
                  {state.reviews.length}件
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('proposals')}
                  className={`font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'proposals'
                      ? 'text-slate-900 underline underline-offset-4 font-semibold'
                      : pendingProposalsCount > 0
                        ? 'text-sky-700 hover:text-sky-900 underline underline-offset-2 font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {pendingProposalsCount > 0
                    ? `整理提案 (${pendingProposalsCount}件)`
                    : '整理提案'}
                </button>
              </div>
            </div>

            {activeTab === 'grade' && (
              <GradingDesk
                subjects={state.subjects}
                hasApiKey={hasApiKey}
                onOpenSettings={() => setShowSettings(true)}
                onStateUpdated={setState}
                onJumpToKnowledge={handleJumpToKnowledge}
                onJumpToTendency={handleJumpToTendency}
              />
            )}

            {activeTab === 'knowledge' && (
              <KnowledgeNotebook
                state={state}
                focusedQuery={focusedKnowledge}
                onClearFocusedQuery={() => setFocusedKnowledge(null)}
                onStateUpdated={setState}
              />
            )}

            {activeTab === 'tendencies' && (
              <TendencyLog
                state={state}
                focusedTendencyName={focusedTendency}
                onClearFocusedTendency={() => setFocusedTendency(null)}
                onStateUpdated={setState}
              />
            )}

            {activeTab === 'history' && (
              <ReviewHistory
                reviews={state.reviews}
                onJumpToKnowledge={handleJumpToKnowledge}
                onJumpToTendency={handleJumpToTendency}
              />
            )}

            {activeTab === 'export' && <ExportView state={state} />}

            {activeTab === 'proposals' && (
              <ProposalsView state={state} onStateUpdated={setState} />
            )}
          </>
        )}
      </main>

      {state && !state.consentAccepted && (
        <OnboardingModal
          onAcceptConsent={() => handleAcceptConsent(false)}
          onOpenSettingsAfterConsent={() => handleAcceptConsent(true)}
        />
      )}

      {showSettings && state && (
        <SettingsModal
          state={state}
          onClose={() => setShowSettings(false)}
          onStateUpdated={setState}
          onApiKeyChanged={() => setHasApiKey(Boolean(getApiKey()))}
        />
      )}
    </div>
  );
}
