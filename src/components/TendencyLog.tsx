import { ChevronDown, ChevronUp, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { APP_NAME } from '../config.ts';
import {
  deleteTendency,
  exportAllDataBundle,
  getTodayJST,
  previewDeleteTendency,
  toggleTendencyHidden,
} from '../services/storeService.ts';
import type { AppState, Tendency, TendencyCategory } from '../types.ts';
import { ConfirmDeleteFlow } from './ConfirmDeleteFlow.tsx';
import { EmptySubjectsPrompt } from './EmptySubjectsPrompt.tsx';

interface TendencyLogProps {
  state: AppState;
  focusedTendencyName?: string | null;
  onClearFocusedTendency?: () => void;
  onStateUpdated: (state: AppState) => void;
}

const CATEGORIES: Array<'ALL' | TendencyCategory> = [
  'ALL',
  '計算',
  '転記',
  '読解',
  '表記',
  '最終確認',
];

export function TendencyLog({
  state,
  focusedTendencyName,
  onClearFocusedTendency,
  onStateUpdated,
}: TendencyLogProps) {
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | TendencyCategory>('ALL');
  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');
  const [showHidden, setShowHidden] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<Tendency | null>(null);

  useEffect(() => {
    if (focusedTendencyName) {
      const target = state.tendencies.find((t) => t.name === focusedTendencyName);
      if (target) {
        setSelectedCategory('ALL');
        setSelectedSubject('ALL');
        if (target.hidden) setShowHidden(true);
        setExpandedIds((prev) => ({ ...prev, [target.tendency_id]: true }));
      }
      onClearFocusedTendency?.();
    }
  }, [focusedTendencyName, state.tendencies, onClearFocusedTendency]);

  const filteredTendencies = useMemo(() => {
    return state.tendencies
      .filter((t) => {
        if (!showHidden && t.hidden) return false;
        if (selectedCategory !== 'ALL' && t.category !== selectedCategory) return false;
        if (selectedSubject !== 'ALL' && !t.subjects.includes(selectedSubject)) return false;
        return true;
      })
      .sort((a, b) => {
        const aDate = a.occurrences[0]?.date ?? a.updated_at;
        const bDate = b.occurrences[0]?.date ?? b.updated_at;
        return bDate.localeCompare(aDate);
      });
  }, [state.tendencies, showHidden, selectedCategory, selectedSubject]);

  const handleToggleHidden = async (tendencyId: string, hidden: boolean) => {
    const res = await toggleTendencyHidden(tendencyId, hidden);
    if (res.ok && res.state) {
      onStateUpdated(res.state);
    }
  };

  const handleBackupDownload = async () => {
    const bundle = await exportAllDataBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_NAME}_backup_${getTodayJST()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (state.subjects.length === 0) {
    return <EmptySubjectsPrompt onStateUpdated={onStateUpdated} />;
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`min-h-[max(44px,2.75rem)] px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                selectedCategory === cat
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat === 'ALL' ? 'すべて' : cat}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            aria-label="科目で絞り込み"
            className="min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-800 bg-white"
          >
            <option value="ALL">全科目</option>
            {state.subjects.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className={`min-h-[max(44px,2.75rem)] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
              showHidden
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>非表示を含む</span>
          </button>
        </div>
      </div>

      {filteredTendencies.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-1">
          <p className="text-sm font-medium text-slate-700">
            記録された不注意ミスの傾向はありません
          </p>
          <p className="text-xs text-slate-500">
            知っているはずの内容を不注意で落とした場合、科目をまたいでここに集約されます。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTendencies.map((t) => {
            const expanded = Boolean(expandedIds[t.tendency_id]);
            const latestDate = t.occurrences[0]?.date ?? t.updated_at.slice(0, 10);

            return (
              <article
                key={t.tendency_id}
                className={`bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 space-y-2 ${
                  t.hidden ? 'opacity-70' : ''
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[0.9375rem] font-semibold text-slate-900 leading-snug">
                        {t.name}
                      </h3>
                      {t.hidden && (
                        <span className="text-xs text-slate-500 font-medium">（非表示中）</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                      <span className="font-medium text-slate-700">{t.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>発生科目: {t.subjects.join(' / ')}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-amber-700">
                        計 {t.occurrences.length}回
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>最終発生 {latestDate}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleHidden(t.tendency_id, !t.hidden)}
                      className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      {t.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      <span>{t.hidden ? '再表示' : '非表示'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedIds((prev) => ({
                          ...prev,
                          [t.tendency_id]: !prev[t.tendency_id],
                        }))
                      }
                      className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <span>履歴</span>
                      {expanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(t)}
                      className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>削除</span>
                    </button>
                  </div>
                </div>

                {t.occurrences.length > 0 && (
                  <div className="border-t border-slate-100 pt-2 space-y-1">
                    {(expanded ? t.occurrences : t.occurrences.slice(0, 1)).map((occ) => (
                      <div
                        key={occ.id}
                        className="flex flex-wrap items-baseline justify-between gap-1.5 text-xs sm:text-[0.8125rem] text-slate-700 leading-snug"
                      >
                        <div className="space-x-1.5">
                          <span className="text-[0.75rem] font-mono text-slate-500 tabular-nums">
                            {occ.date}
                          </span>
                          <span className="text-xs font-medium text-slate-600">
                            {occ.subject} / {occ.unit}
                          </span>
                          <span>— {occ.situation}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDeleteFlow
        open={Boolean(deleteTarget)}
        targetLabel={deleteTarget?.name ?? ''}
        impactDetails={deleteTarget ? previewDeleteTendency(deleteTarget).details : []}
        steps={2}
        onBackupClick={handleBackupDownload}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const res = await deleteTendency(deleteTarget.tendency_id);
          if (!res.ok || !res.state) {
            throw new Error(res.error ?? '傾向の削除に失敗しました。');
          }
          onStateUpdated(res.state);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
