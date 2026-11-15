import {
  AlertCircle,
  BookOpen,
  Clock,
  FileOutput,
  Folder,
  FolderOpen,
  RefreshCw,
  Settings,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ExportView } from './components/ExportView.tsx';
import { GradingDesk } from './components/GradingDesk.tsx';
import { KnowledgeNotebook } from './components/KnowledgeNotebook.tsx';
import { OnboardingModal } from './components/OnboardingModal.tsx';
import { ProposalsView } from './components/ProposalsView.tsx';
import { ReviewHistory } from './components/ReviewHistory.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { TendencyLog } from './components/TendencyLog.tsx';
import { APP_NAME } from './config.ts';
import { useOnlineStatus } from './hooks/useOnlineStatus.ts';
import {
  acceptConsent,
  dismissInstallGuide,
  getApiKey,
  loadState,
  requestStoragePersistence,
  setMode,
  toggleTendencyHidden,
} from './services/storeService.ts';
import type { AppState, OrganizationMode } from './types.ts';

type ActiveTab = 'grade' | 'knowledge' | 'tendencies' | 'history' | 'export' | 'proposals';

const VALID_TABS: ActiveTab[] = [
  'grade',
  'knowledge',
  'tendencies',
  'history',
  'export',
  'proposals',
];

function parseTabFromHash(): ActiveTab {
  if (typeof window === 'undefined') return 'grade';
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (VALID_TABS.includes(raw as ActiveTab)) {
    return raw as ActiveTab;
  }
  return 'grade';
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => parseTabFromHash());
  const [showSettings, setShowSettings] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(() => Boolean(getApiKey()));
  const [keyGuideSkippedForSession, setKeyGuideSkippedForSession] = useState(false);

  // PC 3-pane shared folder selection
  const [paneSubject, setPaneSubject] = useState<string>('');
  const [paneFolder, setPaneFolder] = useState<string>('ALL');

  const [focusedKnowledge, setFocusedKnowledge] = useState<{
    heading: string;
    subject: string;
  } | null>(null);
  const [focusedTendency, setFocusedTendency] = useState<string | null>(null);

  const isOnline = useOnlineStatus();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const navigateTo = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    const targetHash = `#/${tab}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setActiveTab(parseTabFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      window.location.hash = `#/${activeTab}`;
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [activeTab]);

  const refreshState = useCallback(async () => {
    try {
      const data = await loadState();
      setState(data);
      setHasApiKey(Boolean(getApiKey()));
      setPaneSubject((prev) =>
        prev && data.subjects.includes(prev) ? prev : data.subjects[0] ?? ''
      );
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'ローカルデータベース（IndexedDB）の読み込みに失敗しました。'
      );
    }
  }, []);

  useEffect(() => {
    void refreshState();
    void requestStoragePersistence();
  }, [refreshState]);

  const handleModeSwitch = async (mode: OrganizationMode) => {
    const nextState = await setMode(mode);
    setState(nextState);
  };

  const handleAcceptConsent = async () => {
    const nextState = await acceptConsent();
    setState(nextState);
  };

  const handleDismissInstallGuide = async () => {
    const nextState = await dismissInstallGuide();
    setState(nextState);
  };

  const handleJumpToKnowledge = useCallback(
    (heading: string, subject: string) => {
      setFocusedKnowledge({ heading, subject });
      setPaneSubject(subject);
      setPaneFolder('ALL');
      navigateTo('knowledge');
    },
    [navigateTo]
  );

  const handleJumpToTendency = useCallback(
    (tendencyName: string) => {
      setFocusedTendency(tendencyName);
      navigateTo('tendencies');
    },
    [navigateTo]
  );

  const pendingProposalsCount =
    state?.proposals.filter((p) => p.status === 'pending').length ?? 0;

  const activeTendencies = useMemo(() => {
    if (!state) return [];
    return state.tendencies
      .filter((t) => !t.hidden)
      .sort((a, b) => {
        const aDate = a.occurrences[0]?.date ?? a.updated_at;
        const bDate = b.occurrences[0]?.date ?? b.updated_at;
        return bDate.localeCompare(aDate);
      });
  }, [state]);

  const activeFoldersForPane = useMemo(() => {
    if (!state || !paneSubject) return [];
    return state.folders
      .filter((f) => f.startsWith(`${paneSubject}/`))
      .sort((a, b) => a.localeCompare(b, 'ja'));
  }, [state, paneSubject]);

  const countItemsInPath = (pathPrefix: string) => {
    if (!state) return 0;
    return state.items.filter(
      (i) =>
        !i.hidden &&
        (i.folder_path === pathPrefix || i.folder_path.startsWith(`${pathPrefix}/`))
    ).length;
  };

  const showOnboarding =
    Boolean(state) &&
    (!state!.consentAccepted || (!hasApiKey && !keyGuideSkippedForSession));

  const isThreePaneDesktopTab = activeTab === 'grade' || activeTab === 'knowledge';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* PWA Update Banner */}
      {needRefresh && (
        <div className="no-print bg-blue-900 text-white px-4 py-2 text-xs flex flex-wrap items-center justify-center gap-3">
          <span>新しいバージョンの {APP_NAME} が利用可能です。</span>
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white text-blue-950 font-semibold hover:bg-blue-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>更新する</span>
          </button>
        </div>
      )}

      {/* Offline Banner */}
      {!isOnline && (
        <div className="no-print bg-slate-800 text-slate-100 px-4 py-2 text-xs flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>
            オフラインです — 過去のノート・傾向・履歴の閲覧やPDF/Anki出力は利用できます（答案の添削には接続が必要です）
          </span>
        </div>
      )}

      {/* Header */}
      <header className="no-print bg-white border-b border-slate-200 safe-top sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigateTo('grade')}
            className="min-h-[44px] inline-flex items-center gap-2 text-lg font-bold tracking-tight text-blue-950 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span className="w-7 h-7 rounded-md bg-blue-900 text-white text-sm font-bold flex items-center justify-center">
              A
            </span>
            <span>{APP_NAME}</span>
          </button>

          {/* Desktop Navigation (>= lg) */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
            {(
              [
                ['grade', '添削する'],
                ['knowledge', '知識ノート'],
                ['tendencies', 'ミスの傾向'],
                ['history', '添削履歴'],
                ['export', '出力'],
                [
                  'proposals',
                  pendingProposalsCount > 0 ? `整理提案 (${pendingProposalsCount})` : '整理提案',
                ],
              ] as const
            ).map(([tabKey, label]) => {
              const active = activeTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => navigateTo(tabKey)}
                  className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-blue-900 text-blue-950 font-semibold'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {/* Mobile compact proposal shortcut if pending */}
            {pendingProposalsCount > 0 && (
              <button
                type="button"
                onClick={() => navigateTo('proposals')}
                className="lg:hidden min-h-[44px] px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                提案 {pendingProposalsCount}件
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              <span>設定</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-24 lg:pb-8 space-y-5">
        {loadError && (
          <div className="no-print bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 flex items-center justify-between gap-4">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => void refreshState()}
              className="min-h-[44px] px-3 py-1.5 rounded-lg bg-white border border-red-300 text-xs font-medium text-red-800 hover:bg-red-100 cursor-pointer"
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
            {/* Workspace Status & Mode Bar */}
            <div className="no-print bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-600">
                <span className="font-medium text-slate-800">整理モード:</span>
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['確認', '一任'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => void handleModeSwitch(m)}
                      className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        state.mode === m
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <span className="hidden sm:inline text-slate-500">
                  {state.mode === '確認'
                    ? '整理操作は承認待ちの提案として保留されます'
                    : 'AIが整理操作を即時実行します'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 tabular-nums">
                <span>
                  知識 {state.items.filter((i) => !i.hidden).length} · 傾向{' '}
                  {state.tendencies.filter((t) => !t.hidden).length} · 履歴{' '}
                  {state.reviews.length}
                </span>
                <button
                  type="button"
                  onClick={() => navigateTo('proposals')}
                  className={`hidden sm:inline font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'proposals'
                      ? 'text-slate-900 underline underline-offset-4 font-semibold'
                      : pendingProposalsCount > 0
                        ? 'text-blue-900 hover:underline font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {pendingProposalsCount > 0
                    ? `整理提案 (${pendingProposalsCount}件)`
                    : '整理提案'}
                </button>
              </div>
            </div>

            {/* PC 3-Pane Layout for Primary Views (grade / knowledge) */}
            {isThreePaneDesktopTab ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Left Pane (PC only): Subject & Folder Tree */}
                <aside className="hidden lg:block lg:col-span-3 bg-white border border-slate-200 rounded-xl p-4 space-y-3 sticky top-20 max-h-[calc(100vh-7rem)] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-semibold text-slate-700">科目・単元フォルダ</span>
                    <button
                      type="button"
                      onClick={() => navigateTo('knowledge')}
                      className="text-[11px] font-medium text-blue-900 hover:underline cursor-pointer"
                    >
                      ノートを開く
                    </button>
                  </div>

                  {/* Subject Pills */}
                  <div className="flex flex-wrap gap-1.5">
                    {state.subjects.map((sub) => {
                      const active = sub === paneSubject;
                      return (
                        <button
                          key={sub}
                          type="button"
                          onClick={() => {
                            setPaneSubject(sub);
                            setPaneFolder('ALL');
                          }}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                            active
                              ? 'bg-blue-900 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {sub}
                        </button>
                      );
                    })}
                  </div>

                  {/* Folder Tree */}
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPaneFolder('ALL');
                        navigateTo('knowledge');
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                        activeTab === 'knowledge' && paneFolder === 'ALL'
                          ? 'bg-blue-50 text-blue-950 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                        <span>{paneSubject} すべて</span>
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        {countItemsInPath(paneSubject)}
                      </span>
                    </button>

                    {activeFoldersForPane.map((folderPath) => {
                      const parts = folderPath.split('/');
                      const isDepth2 = parts.length === 3;
                      const name = parts[parts.length - 1];
                      const active = activeTab === 'knowledge' && paneFolder === folderPath;
                      return (
                        <button
                          key={folderPath}
                          type="button"
                          onClick={() => {
                            setPaneFolder(folderPath);
                            navigateTo('knowledge');
                          }}
                          className={`w-full flex items-center justify-between py-1.5 pr-2.5 rounded-lg text-xs transition-colors cursor-pointer ${
                            isDepth2 ? 'pl-6' : 'pl-2.5'
                          } ${
                            active
                              ? 'bg-blue-50 text-blue-950 font-semibold'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{name}</span>
                          </span>
                          <span className="text-slate-500 tabular-nums shrink-0">
                            {countItemsInPath(folderPath)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                {/* Center Pane: GradingDesk OR KnowledgeNotebook */}
                <div className="lg:col-span-6">
                  {activeTab === 'grade' ? (
                    <GradingDesk
                      subjects={state.subjects}
                      hasApiKey={hasApiKey}
                      maxPdfPages={state.limits.maxPdfPages}
                      isOnline={isOnline}
                      onOpenSettings={() => setShowSettings(true)}
                      onStateUpdated={setState}
                      onJumpToKnowledge={handleJumpToKnowledge}
                      onJumpToTendency={handleJumpToTendency}
                    />
                  ) : (
                    <>
                      {/* On PC >= lg hide duplicated sidebar; on mobile < lg show full KnowledgeNotebook */}
                      <div className="lg:hidden">
                        <KnowledgeNotebook
                          state={state}
                          focusedQuery={focusedKnowledge}
                          onClearFocusedQuery={() => setFocusedKnowledge(null)}
                          onStateUpdated={setState}
                        />
                      </div>
                      <div className="hidden lg:block">
                        <KnowledgeNotebook
                          state={state}
                          focusedQuery={focusedKnowledge}
                          onClearFocusedQuery={() => setFocusedKnowledge(null)}
                          onStateUpdated={setState}
                          externalSubject={paneSubject}
                          externalFolder={paneFolder}
                          onSelectSubjectAndFolder={(sub, folder) => {
                            setPaneSubject(sub);
                            setPaneFolder(folder);
                          }}
                          hideFolderSidebar
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Right Pane (PC only): Active Tendencies Panel */}
                <aside className="hidden lg:block lg:col-span-3 bg-white border border-slate-200 rounded-xl p-4 space-y-3 sticky top-20 max-h-[calc(100vh-7rem)] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-semibold text-slate-700">
                      注意すべきミスの傾向
                    </span>
                    <button
                      type="button"
                      onClick={() => navigateTo('tendencies')}
                      className="text-[11px] font-medium text-blue-900 hover:underline cursor-pointer"
                    >
                      すべて見る
                    </button>
                  </div>

                  {activeTendencies.length === 0 ? (
                    <p className="text-xs text-slate-500 py-3">
                      現在表示中の不注意ミス傾向はありません。
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {activeTendencies.slice(0, 8).map((t) => (
                        <div
                          key={t.tendency_id}
                          className="border border-slate-200 rounded-lg p-3 space-y-1.5 bg-slate-50/50"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handleJumpToTendency(t.name)}
                              className="text-left text-xs font-semibold text-slate-900 hover:text-blue-900 cursor-pointer"
                            >
                              {t.name}
                            </button>
                            <span className="text-[11px] font-semibold text-amber-800 shrink-0 tabular-nums">
                              {t.occurrences.length}回
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2">
                            <span>
                              {t.category} · {t.subjects.join('/')}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                void toggleTendencyHidden(t.tendency_id, true).then((res) => {
                                  if (res.ok && res.state) setState(res.state);
                                })
                              }
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              非表示
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            ) : (
              <>
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

                {activeTab === 'export' && (
                  <ExportView state={state} onStateUpdated={setState} />
                )}

                {activeTab === 'proposals' && (
                  <ProposalsView state={state} onStateUpdated={setState} />
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (< lg) */}
      <nav
        aria-label="メインナビゲーション"
        className="no-print lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 safe-bottom"
      >
        <div className="grid grid-cols-5">
          {(
            [
              ['grade', '添削', Sparkles],
              ['knowledge', '知識', BookOpen],
              ['tendencies', '傾向', AlertCircle],
              ['history', '履歴', Clock],
              ['export', '出力', FileOutput],
            ] as const
          ).map(([tabKey, label, Icon]) => {
            const active = activeTab === tabKey;
            return (
              <button
                key={tabKey}
                type="button"
                onClick={() => navigateTo(tabKey)}
                className={`min-h-[52px] py-1.5 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                  active ? 'text-blue-900 font-semibold' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Onboarding & API Key Guide Modal */}
      {showOnboarding && state && (
        <OnboardingModal
          consentAccepted={state.consentAccepted}
          hasApiKey={hasApiKey}
          onAcceptConsent={handleAcceptConsent}
          onApiKeySaved={() => setHasApiKey(Boolean(getApiKey()))}
          onSkipKeyForSession={() => setKeyGuideSkippedForSession(true)}
          onDismissInstallGuide={handleDismissInstallGuide}
        />
      )}

      {/* Settings Modal */}
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
