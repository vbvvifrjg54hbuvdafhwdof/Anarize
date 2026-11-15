import {
  CheckCircle2,
  Edit3,
  Folder,
  FolderPlus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createUserFolder,
  deleteFolderCascade,
  deleteKnowledgeItem,
  exportAllDataBundle,
  getTodayJST,
  loadState,
  previewDeleteFolder,
  previewDeleteKnowledgeItem,
  updateKnowledgeItem,
} from '../services/storeService.ts';
import type { AppState, KnowledgeItem } from '../types.ts';
import { ConfirmDeleteFlow } from './ConfirmDeleteFlow.tsx';
import { EmptySubjectsPrompt } from './EmptySubjectsPrompt.tsx';
import { MathText } from './MathText.tsx';

interface KnowledgeNotebookProps {
  state: AppState;
  focusedQuery?: { heading: string; subject: string } | null;
  onClearFocusedQuery?: () => void;
  onStateUpdated: (state: AppState) => void;
  externalSubject?: string;
  externalFolder?: string;
  onSelectSubjectAndFolder?: (subject: string, folder: string) => void;
  hideFolderSidebar?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export function KnowledgeNotebook({
  state,
  focusedQuery,
  onClearFocusedQuery,
  onStateUpdated,
  externalSubject,
  externalFolder,
  onSelectSubjectAndFolder,
  hideFolderSidebar = false,
  onBusyChange,
}: KnowledgeNotebookProps) {
  const [internalSubject, setInternalSubject] = useState<string>(
    focusedQuery?.subject && state.subjects.includes(focusedQuery.subject)
      ? focusedQuery.subject
      : state.subjects[0] ?? ''
  );
  const [internalFolder, setInternalFolder] = useState<string>('ALL');
  const selectedSubject = externalSubject ?? internalSubject;
  const selectedFolder = externalFolder ?? internalFolder;

  const setSelectedSubject = (sub: string) => {
    setInternalSubject(sub);
    onSelectSubjectAndFolder?.(sub, 'ALL');
  };
  const setSelectedFolder = (folder: string) => {
    setInternalFolder(folder);
    onSelectSubjectAndFolder?.(selectedSubject, folder);
  };

  const [searchText, setSearchText] = useState<string>(focusedQuery?.heading ?? '');
  const [filterMode, setFilterMode] = useState<'all' | 'unverified' | 'hidden'>('all');

  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState('');
  const [showNewFolderForm, setShowNewFolderForm] = useState(false);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editHeading, setEditHeading] = useState('');
  const [editExplanation, setEditExplanation] = useState('');
  const [editFolderPath, setEditFolderPath] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'folder'; folderPath: string; impact: string[] }
    | { kind: 'item'; item: KnowledgeItem; impact: string[] }
    | null
  >(null);

  useEffect(() => {
    const busy = showNewFolderForm || editingItemId !== null;
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [showNewFolderForm, editingItemId, onBusyChange]);

  useEffect(() => {
    if (focusedQuery) {
      const targetSub = state.subjects.includes(focusedQuery.subject)
        ? focusedQuery.subject
        : selectedSubject;
      setInternalSubject(targetSub);
      setInternalFolder('ALL');
      onSelectSubjectAndFolder?.(targetSub, 'ALL');
      setSearchText(focusedQuery.heading);
      setFilterMode('all');
      onClearFocusedQuery?.();
    }
  }, [focusedQuery, state.subjects, onClearFocusedQuery, onSelectSubjectAndFolder, selectedSubject]);

  useEffect(() => {
    if (!state.subjects.includes(selectedSubject)) {
      const fallback = state.subjects[0] ?? '';
      setInternalSubject(fallback);
      setInternalFolder('ALL');
    }
  }, [state.subjects, selectedSubject]);

  const subjectFolders = useMemo(() => {
    return state.folders
      .filter((f) => f.startsWith(`${selectedSubject}/`))
      .sort((a, b) => a.localeCompare(b, 'ja'));
  }, [state.folders, selectedSubject]);

  const depth1Folders = useMemo(
    () => subjectFolders.filter((f) => f.split('/').length === 2),
    [subjectFolders]
  );

  const filteredItems = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return state.items
      .filter((item) => {
        const inSubject =
          item.folder_path === selectedSubject ||
          item.folder_path.startsWith(`${selectedSubject}/`);
        if (!inSubject) return false;

        if (filterMode === 'hidden') {
          if (!item.hidden) return false;
        } else {
          if (item.hidden) return false;
          if (filterMode === 'unverified' && item.verified) return false;
        }

        if (selectedFolder !== 'ALL') {
          const matchesFolder =
            item.folder_path === selectedFolder ||
            item.folder_path.startsWith(`${selectedFolder}/`);
          if (!matchesFolder) return false;
        }

        if (q) {
          return (
            item.heading.toLowerCase().includes(q) ||
            item.explanation.toLowerCase().includes(q) ||
            item.folder_path.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => b.mistake_count - a.mistake_count);
  }, [state.items, selectedSubject, selectedFolder, filterMode, searchText]);

  const countForFolder = (folderPath: string) =>
    state.items.filter(
      (i) =>
        !i.hidden &&
        (i.folder_path === folderPath || i.folder_path.startsWith(`${folderPath}/`))
    ).length;

  const handleCreateFolder = async () => {
    const clean = newFolderName.trim();
    if (!clean) return;
    setActionError(null);
    const parent = newFolderParent || selectedSubject;
    const fullPath = `${parent}/${clean}`;

    const res = await createUserFolder(fullPath);
    if (!res.ok || !res.state) {
      setActionError(res.error ?? 'フォルダの作成に失敗しました。');
      return;
    }
    onStateUpdated(res.state);
    setNewFolderName('');
    setShowNewFolderForm(false);
  };

  const beginEdit = (item: KnowledgeItem) => {
    setEditingItemId(item.id);
    setEditHeading(item.heading);
    setEditExplanation(item.explanation);
    setEditFolderPath(item.folder_path);
    setActionError(null);
  };

  const saveEdit = async (itemId: string) => {
    setActionError(null);
    const res = await updateKnowledgeItem(itemId, {
      heading: editHeading,
      explanation: editExplanation,
      folder_path: editFolderPath,
      verified: true,
    });
    if (!res.ok || !res.state) {
      setActionError(res.error ?? '保存に失敗しました。');
      return;
    }
    onStateUpdated(res.state);
    setEditingItemId(null);
  };

  const toggleVerified = async (item: KnowledgeItem) => {
    setActionError(null);
    const res = await updateKnowledgeItem(item.id, { verified: !item.verified });
    if (res.ok && res.state) onStateUpdated(res.state);
  };

  const restoreItem = async (item: KnowledgeItem) => {
    setActionError(null);
    const res = await updateKnowledgeItem(item.id, { hidden: false });
    if (!res.ok || !res.state) {
      setActionError(res.error ?? '復元に失敗しました。');
      return;
    }
    onStateUpdated(res.state);
  };

  const handleBackupDownload = async () => {
    const bundle = await exportAllDataBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Anarize_backup_${getTodayJST()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const refreshed = await loadState();
    onStateUpdated(refreshed);
  };

  if (state.subjects.length === 0) {
    return <EmptySubjectsPrompt onStateUpdated={onStateUpdated} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {state.subjects.map((sub) => {
            const active = sub === selectedSubject;
            const count = state.items.filter(
              (i) => !i.hidden && (i.folder_path === sub || i.folder_path.startsWith(`${sub}/`))
            ).length;
            return (
              <button
                key={sub}
                type="button"
                onClick={() => {
                  setSelectedSubject(sub);
                  setSelectedFolder('ALL');
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {sub} ({count})
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setShowNewFolderForm((v) => !v);
            setNewFolderParent(selectedSubject);
            setActionError(null);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span>単元フォルダ追加</span>
        </button>
      </div>

      {showNewFolderForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">親フォルダ</label>
            <select
              value={newFolderParent}
              onChange={(e) => setNewFolderParent(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value={selectedSubject}>{selectedSubject}（直下）</option>
              {depth1Folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">新しいフォルダ名</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="例: 数列"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCreateFolder()}
              className="px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-medium hover:bg-sky-800 cursor-pointer"
            >
              作成
            </button>
            <button
              type="button"
              onClick={() => setShowNewFolderForm(false)}
              className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {!hideFolderSidebar && (
          <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-2.5 space-y-1">
            <div className="text-xs font-semibold text-slate-500 px-2 pb-1">
              {selectedSubject} の単元構成（最大2段）
            </div>
            <button
              type="button"
              onClick={() => setSelectedFolder('ALL')}
              className={`w-full min-h-[max(44px,2.75rem)] flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs sm:text-sm transition-colors cursor-pointer ${
                selectedFolder === 'ALL'
                  ? 'bg-blue-50 text-blue-950 font-semibold'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>すべての単元</span>
              <span className="text-xs text-slate-500 tabular-nums">
                {countForFolder(selectedSubject)}
              </span>
            </button>

            <div className="space-y-0.5">
              {subjectFolders.map((folderPath) => {
                const parts = folderPath.split('/');
                const isDepth2 = parts.length === 3;
                const name = parts[parts.length - 1];
                const active = selectedFolder === folderPath;
                return (
                  <div
                    key={folderPath}
                    className={`flex items-center gap-1 rounded-lg transition-colors ${
                      active ? 'bg-blue-50 text-blue-950' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedFolder(folderPath)}
                      className={`flex-1 min-w-0 min-h-[max(44px,2.75rem)] flex items-center justify-between py-1.5 pr-1 text-xs sm:text-sm cursor-pointer ${
                        isDepth2 ? 'pl-6' : 'pl-2.5'
                      } ${active ? 'font-semibold' : ''}`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{name}</span>
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums shrink-0">
                        {countForFolder(folderPath)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`フォルダ「${name}」を削除`}
                      onClick={() =>
                        setDeleteTarget({
                          kind: 'folder',
                          folderPath,
                          impact: previewDeleteFolder(state, folderPath).details,
                        })
                      }
                      className="min-w-[max(44px,2.75rem)] min-h-[max(44px,2.75rem)] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              {subjectFolders.length === 0 && (
                <p className="text-xs text-slate-500 px-2.5 py-1.5">
                  単元フォルダはまだありません。答案を添削すると自動で作成されます。
                </p>
              )}
            </div>
          </aside>
        )}

        <section className={`${hideFolderSidebar ? 'lg:col-span-12' : 'lg:col-span-8'} space-y-2.5`}>
          <div className="bg-white border border-slate-200 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2">
            {hideFolderSidebar && selectedFolder !== 'ALL' && (
              <div className="w-full flex items-center justify-between gap-2 px-2 py-1 bg-blue-50/60 border border-blue-100 rounded-lg text-xs">
                <span className="font-medium text-blue-950 truncate">
                  選択中のフォルダ: {selectedFolder}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDeleteTarget({
                      kind: 'folder',
                      folderPath: selectedFolder,
                      impact: previewDeleteFolder(state, selectedFolder).details,
                    })
                  }
                  className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 rounded-md text-red-700 hover:bg-red-50 font-medium cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>フォルダを削除</span>
                </button>
              </div>
            )}
            <div className="relative flex-1 min-w-[11rem]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="見出しや解説を検索..."
                className="w-full pl-9 pr-8 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
              {searchText && (
                <button
                  type="button"
                  onClick={() => setSearchText('')}
                  aria-label="検索をクリア"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['all', 'すべて'],
                  ['unverified', '未確認のみ'],
                  ['hidden', '統合・非表示'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterMode(key)}
                  className={`min-h-[max(44px,2.75rem)] px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    filterMode === key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-1">
              <p className="text-sm font-medium text-slate-700">
                該当する知識項目はありません
              </p>
              <p className="text-xs text-slate-500">
                答案の添削で「知識不足」と判定された内容が、ここにミス回数順で蓄積されます。
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => {
                const isEditing = editingItemId === item.id;
                return (
                  <article
                    key={item.id}
                    className="bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 space-y-2"
                  >
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">
                              見出し
                            </label>
                            <input
                              type="text"
                              value={editHeading}
                              onChange={(e) => setEditHeading(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">
                              フォルダ
                            </label>
                            <select
                              value={editFolderPath}
                              onChange={(e) => setEditFolderPath(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 bg-white"
                            >
                              {subjectFolders.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            解説（LaTeX可）
                          </label>
                          <textarea
                            rows={3}
                            value={editExplanation}
                            onChange={(e) => setEditExplanation(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingItemId(null)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                          >
                            キャンセル
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveEdit(item.id)}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>保存して確認済みにする</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-0.5 min-w-0">
                            <h3 className="text-base font-semibold text-slate-900 leading-snug">
                              {item.heading}
                            </h3>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                              <span>{item.folder_path}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-slate-800">
                                ミス {item.mistake_count}回
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  item.verified ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'
                                }
                              >
                                {item.verified ? '内容確認済み' : 'AI登録（未確認）'}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {item.hidden ? (
                              <button
                                type="button"
                                onClick={() => void restoreItem(item)}
                                className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>復元する</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void toggleVerified(item)}
                                  className={`min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium cursor-pointer transition-colors ${
                                    item.verified
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>{item.verified ? '確認済み' : '確認'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => beginEdit(item)}
                                  className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>編集</span>
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  kind: 'item',
                                  item,
                                  impact: previewDeleteKnowledgeItem(item).details,
                                })
                              }
                              className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>削除</span>
                            </button>
                          </div>
                        </div>

                        <div className="text-sm text-slate-800 leading-snug pt-1.5 border-t border-slate-100">
                          <MathText text={item.explanation} />
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <ConfirmDeleteFlow
        open={Boolean(deleteTarget)}
        targetLabel={
          deleteTarget
            ? deleteTarget.kind === 'folder'
              ? deleteTarget.folderPath
              : deleteTarget.item.heading
            : ''
        }
        impactDetails={deleteTarget?.impact ?? []}
        onBackupClick={handleBackupDownload}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setActionError(null);
          if (deleteTarget.kind === 'folder') {
            const res = await deleteFolderCascade(deleteTarget.folderPath);
            if (!res.ok || !res.state) {
              throw new Error(res.error ?? 'フォルダの削除に失敗しました。');
            }
            if (
              selectedFolder === deleteTarget.folderPath ||
              selectedFolder.startsWith(`${deleteTarget.folderPath}/`)
            ) {
              setSelectedFolder('ALL');
            }
            onStateUpdated(res.state);
          } else {
            const res = await deleteKnowledgeItem(deleteTarget.item.id);
            if (!res.ok || !res.state) {
              throw new Error(res.error ?? '知識項目の削除に失敗しました。');
            }
            onStateUpdated(res.state);
          }
        }}
      />
    </div>
  );
}
