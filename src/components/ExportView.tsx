import { Check, Copy, Download, ExternalLink, FileText, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { APP_NAME, PDF_COLORS } from '../config.ts';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { getTodayJST, updatePdfSettings } from '../services/storeService.ts';
import type { AppState, KnowledgeItem, PdfExportSettings, Tendency } from '../types.ts';
import { MathText } from './MathText.tsx';

interface ExportViewProps {
  state: AppState;
  onStateUpdated: (state: AppState) => void;
}

type ExportTab = 'pdf' | 'anki';
type ScopeMode = 'subject' | 'folder' | 'custom';

function escapeAnkiHtmlAndMath(raw: string): string {
  // Normalize $$...$$ and $...$ to MathJax \[...\] and \(...\) if present
  const normalizedMath = raw
    .replace(/\$\$([\s\S]+?)\$\$/g, '\\[$1\\]')
    .replace(/\$([^$\n]+?)\$/g, '\\($1\\)');

  return normalizedMath
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, ' ')
    .replace(/\r\n/g, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/\r/g, '<br>')
    .trim();
}

function buildAnkiTags(folderPath: string): string {
  const parts = folderPath
    .split('/')
    .map((p) => p.trim().replace(/\s+/g, '_'))
    .filter(Boolean);
  if (parts.length === 0) return APP_NAME;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts.slice(1).join('_')}`;
}

function computePrintFontPt(settings: PdfExportSettings): number {
  const base = settings.fontSize === 'sm' ? 9.5 : settings.fontSize === 'lg' ? 12 : 10.5;
  if (settings.itemsPerPage === 'auto') {
    if (settings.columns === 3) return Math.max(8, base - 1.5);
    if (settings.columns === 2) return Math.max(8, base - 0.5);
    return base;
  }
  const perCol = settings.itemsPerPage / settings.columns;
  if (perCol >= 18) return 8;
  if (perCol >= 12) return Math.max(8, base - 1.5);
  if (perCol >= 8) return Math.max(8, base - 0.5);
  return base;
}

export function ExportView({ state, onStateUpdated }: ExportViewProps) {
  const { isStandalone } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<ExportTab>('pdf');

  // Range Selection State
  const [scopeMode, setScopeMode] = useState<ScopeMode>('subject');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(() => [...state.subjects]);
  const [selectedFolder, setSelectedFolder] = useState<string>('ALL');
  const [customSelectedIds, setCustomSelectedIds] = useState<string[]>(() =>
    state.items.filter((i) => !i.hidden).map((i) => i.id)
  );
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  // Persisted PDF Settings
  const [pdf, setPdf] = useState<PdfExportSettings>(() => ({ ...state.pdfSettings }));
  const [includeHiddenTendencies, setIncludeHiddenTendencies] = useState(false);

  // Anki Options
  const [ankiDeck, setAnkiDeck] = useState('');
  const [copiedAnki, setCopiedAnki] = useState(false);

  useEffect(() => {
    setPdf({ ...state.pdfSettings });
  }, [state.pdfSettings]);

  const patchPdf = (patch: Partial<PdfExportSettings>) => {
    const next = { ...pdf, ...patch };
    setPdf(next);
    void updatePdfSettings(next).then(onStateUpdated);
  };

  const toggleSubject = (sub: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub]
    );
  };

  const availableFolders = useMemo(() => {
    return state.folders
      .filter((f) => selectedSubjects.some((s) => f.startsWith(`${s}/`)))
      .sort((a, b) => a.localeCompare(b, 'ja'));
  }, [state.folders, selectedSubjects]);

  const activeItemsPool = useMemo(() => {
    return state.items.filter((i) => !i.hidden && (!verifiedOnly || i.verified));
  }, [state.items, verifiedOnly]);

  const filteredItems: KnowledgeItem[] = useMemo(() => {
    const matched = activeItemsPool.filter((item) => {
      if (scopeMode === 'custom') {
        return customSelectedIds.includes(item.id);
      }
      const subject = item.folder_path.split('/')[0];
      if (!selectedSubjects.includes(subject)) return false;
      if (
        scopeMode === 'folder' &&
        selectedFolder !== 'ALL' &&
        item.folder_path !== selectedFolder &&
        !item.folder_path.startsWith(`${selectedFolder}/`)
      ) {
        return false;
      }
      return true;
    });

    return matched.sort((a, b) => {
      if (pdf.sortBy === 'mistakes') {
        if (b.mistake_count !== a.mistake_count) return b.mistake_count - a.mistake_count;
        return a.folder_path.localeCompare(b.folder_path, 'ja');
      }
      const folderCmp = a.folder_path.localeCompare(b.folder_path, 'ja');
      if (folderCmp !== 0) return folderCmp;
      return b.mistake_count - a.mistake_count;
    });
  }, [activeItemsPool, scopeMode, customSelectedIds, selectedSubjects, selectedFolder, pdf.sortBy]);

  const filteredTendencies: Tendency[] = useMemo(() => {
    if (!pdf.includeTendencies) return [];
    const subjectsInScope =
      scopeMode === 'custom'
        ? Array.from(new Set(filteredItems.map((i) => i.folder_path.split('/')[0])))
        : selectedSubjects;
    return state.tendencies.filter((t) => {
      if (!includeHiddenTendencies && t.hidden) return false;
      if (subjectsInScope.length === 0) return true;
      return t.subjects.some((s) => subjectsInScope.includes(s));
    });
  }, [
    state.tendencies,
    pdf.includeTendencies,
    includeHiddenTendencies,
    scopeMode,
    filteredItems,
    selectedSubjects,
  ]);

  const groupedByFolder = useMemo(() => {
    const map = new Map<string, KnowledgeItem[]>();
    for (const item of filteredItems) {
      const list = map.get(item.folder_path) ?? [];
      list.push(item);
      map.set(item.folder_path, list);
    }
    return Array.from(map.entries());
  }, [filteredItems]);

  const pagedItems = useMemo(() => {
    if (pdf.itemsPerPage === 'auto' || pdf.itemsPerPage <= 0) {
      return [filteredItems];
    }
    const chunks: KnowledgeItem[][] = [];
    for (let i = 0; i < filteredItems.length; i += pdf.itemsPerPage) {
      chunks.push(filteredItems.slice(i, i + pdf.itemsPerPage));
    }
    return chunks.length > 0 ? chunks : [[]];
  }, [filteredItems, pdf.itemsPerPage]);

  const ankiRows = useMemo(() => {
    const deck = ankiDeck.replace(/\t/g, ' ').trim();
    return filteredItems.map((item) => ({
      guid: item.id,
      heading: escapeAnkiHtmlAndMath(item.heading),
      explanation: escapeAnkiHtmlAndMath(item.explanation),
      tags: buildAnkiTags(item.folder_path),
      deck,
    }));
  }, [filteredItems, ankiDeck]);

  const ankiTsvContent = useMemo(() => {
    const header = [
      '#separator:tab',
      '#html:true',
      '#guid column:1',
      '#tags column:4',
      '#deck column:5',
    ];
    const body = ankiRows.map(
      (r) => `${r.guid}\t${r.heading}\t${r.explanation}\t${r.tags}\t${r.deck}`
    );
    return [...header, ...body].join('\n');
  }, [ankiRows]);

  const handleCopyAnki = async () => {
    if (ankiRows.length === 0) return;
    try {
      await navigator.clipboard.writeText(ankiTsvContent);
      setCopiedAnki(true);
      window.setTimeout(() => setCopiedAnki(false), 2500);
    } catch {
      // Fallback textarea copy
      const ta = document.createElement('textarea');
      ta.value = ankiTsvContent;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedAnki(true);
      window.setTimeout(() => setCopiedAnki(false), 2500);
    }
  };

  const handleDownloadAnkiTxt = () => {
    const blob = new Blob([ankiTsvContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_NAME}_anki_${getTodayJST()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintPdf = () => {
    const origTitle = document.title;
    const subjectLabel =
      scopeMode === 'custom'
        ? '選択項目'
        : selectedSubjects.length > 0
          ? selectedSubjects.join('_')
          : '全科目';
    document.title = `${APP_NAME}_${subjectLabel}`;

    const restore = () => {
      document.title = origTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    window.setTimeout(restore, 3000);
  };

  const printFontPt = computePrintFontPt(pdf);
  const marginMm = pdf.margin === 'narrow' ? '8mm' : '16mm';
  const pageCss = `
    @page {
      size: ${pdf.paperSize} ${pdf.orientation};
      margin: ${marginMm};
      @bottom-center {
        content: counter(page) " / " counter(pages);
        font-size: 9pt;
        color: ${PDF_COLORS.muted};
      }
    }
  `;

  const gridColsClass =
    pdf.columns === 3
      ? 'grid-cols-1 md:grid-cols-3 print:grid-cols-3'
      : pdf.columns === 2
        ? 'grid-cols-1 md:grid-cols-2 print:grid-cols-2'
        : 'grid-cols-1';

  const renderKnowledgeCard = (item: KnowledgeItem, showUnitBadge = false) => {
    const isShort =
      item.explanation.length <= 45 && !item.explanation.includes('\n');
    return (
      <div
        key={item.id}
        className="rounded-md p-2.5 break-inside-avoid border"
        style={{
          borderColor: PDF_COLORS.border,
          backgroundColor: PDF_COLORS.background,
          color: PDF_COLORS.text,
        }}
      >
        {pdf.displayMode === 'headings' ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold" style={{ color: PDF_COLORS.text }}>
              {item.heading}
            </span>
            <span className="text-[0.82em] tabular-nums shrink-0" style={{ color: PDF_COLORS.muted }}>
              {showUnitBadge ? `${item.folder_path} ` : ''}
              {pdf.showMistakeCount ? `(${item.mistake_count}回)` : ''}
            </span>
          </div>
        ) : isShort ? (
          <div className="leading-snug flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <div>
              <span className="font-semibold" style={{ color: PDF_COLORS.text }}>
                {item.heading}：
              </span>
              <span
                style={{
                  color:
                    pdf.displayMode === 'redsheet' ? PDF_COLORS.redSheet : PDF_COLORS.text,
                }}
              >
                <MathText text={item.explanation} />
              </span>
            </div>
            {(showUnitBadge || pdf.showMistakeCount) && (
              <span className="text-[0.8em] tabular-nums shrink-0" style={{ color: PDF_COLORS.muted }}>
                {showUnitBadge ? `${item.folder_path} ` : ''}
                {pdf.showMistakeCount ? `(${item.mistake_count}回)` : ''}
              </span>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold" style={{ color: PDF_COLORS.text }}>
                {item.heading}
              </span>
              {(showUnitBadge || pdf.showMistakeCount) && (
                <span className="text-[0.8em] tabular-nums shrink-0" style={{ color: PDF_COLORS.muted }}>
                  {showUnitBadge ? `${item.folder_path} ` : ''}
                  {pdf.showMistakeCount ? `ミス ${item.mistake_count}回` : ''}
                </span>
              )}
            </div>
            <div
              className="leading-relaxed"
              style={{
                color:
                  pdf.displayMode === 'redsheet' ? PDF_COLORS.redSheet : PDF_COLORS.text,
              }}
            >
              <MathText text={item.explanation} />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <style>{pageCss}</style>

      {/* Top Mode Switcher & Action Bar */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('pdf')}
            className={`min-h-[44px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'pdf'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Printer className="w-4 h-4" />
            <span>PDF出力（印刷）</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('anki')}
            className={`min-h-[44px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'anki'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Anki用テキスト出力</span>
          </button>
        </div>

        {activeTab === 'pdf' ? (
          <div className="flex flex-wrap items-center gap-2">
            {isStandalone && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <ExternalLink className="w-4 h-4" />
                <span>ブラウザで開く</span>
              </a>
            )}
            <button
              type="button"
              onClick={handlePrintPdf}
              disabled={filteredItems.length === 0 && filteredTendencies.length === 0}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 disabled:bg-slate-300 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>PDFとして保存 / 印刷</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyAnki()}
              disabled={ankiRows.length === 0}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-blue-900 text-blue-900 bg-white text-xs font-semibold hover:bg-blue-50 disabled:opacity-40 cursor-pointer"
            >
              {copiedAnki ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedAnki ? 'コピーしました' : 'クリップボードにコピー'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadAnkiTxt}
              disabled={ankiRows.length === 0}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 disabled:bg-slate-300 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>.txt で保存（{ankiRows.length}件）</span>
            </button>
          </div>
        )}
      </div>

      {/* Range & Format Options */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">1. 出力範囲の選択</div>
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              {(
                [
                  ['subject', '科目全体'],
                  ['folder', 'フォルダ指定'],
                  ['custom', '個別チェック'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setScopeMode(m)}
                  className={`min-h-[36px] px-3 py-1 rounded-md font-medium cursor-pointer ${
                    scopeMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {scopeMode !== 'custom' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600 mr-1">科目:</span>
                {state.subjects.map((sub) => {
                  const active = selectedSubjects.includes(sub);
                  return (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => toggleSubject(sub)}
                      className={`min-h-[38px] px-3 py-1 rounded-md border text-xs font-medium cursor-pointer transition-colors ${
                        active
                          ? 'border-blue-900 bg-blue-900 text-white'
                          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {sub}
                    </button>
                  );
                })}
              </div>

              {scopeMode === 'folder' && (
                <label className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-600 font-medium">対象フォルダ（子フォルダ含む）:</span>
                  <select
                    value={selectedFolder}
                    onChange={(e) => setSelectedFolder(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 bg-white"
                  >
                    <option value="ALL">選択科目のすべて</option>
                    {availableFolders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 tabular-nums">
                  選択中: {customSelectedIds.length} / {activeItemsPool.length} 件
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCustomSelectedIds(activeItemsPool.map((i) => i.id))}
                    className="text-blue-900 font-medium hover:underline cursor-pointer"
                  >
                    すべて選択
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomSelectedIds([])}
                    className="text-slate-600 hover:underline cursor-pointer"
                  >
                    選択解除
                  </button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded">
                {activeItemsPool.map((item) => {
                  const checked = customSelectedIds.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setCustomSelectedIds((prev) =>
                            checked ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                          )
                        }
                        className="w-4 h-4 rounded border-slate-300 text-blue-900"
                      />
                      <span className="font-medium text-slate-900">{item.heading}</span>
                      <span className="text-slate-500 ml-auto shrink-0">{item.folder_path}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-900"
            />
            <span className="text-slate-700">「内容確認済み」の知識項目のみ出力</span>
          </label>
        </div>

        {/* PDF Options */}
        {activeTab === 'pdf' ? (
          <div className="border-t border-slate-200 pt-4 space-y-4">
            <div className="text-sm font-semibold text-slate-900">
              2. PDFレイアウト・サイズ・詳細オプション（設定は自動保存）
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">表示モード</span>
                <select
                  value={pdf.displayMode}
                  onChange={(e) =>
                    patchPdf({ displayMode: e.target.value as PdfExportSettings['displayMode'] })
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value="normal">通常（見出し＋解説）</option>
                  <option value="redsheet">赤シート（解説が赤字）</option>
                  <option value="headings">見出しのみ</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">用紙サイズ</span>
                <select
                  value={pdf.paperSize}
                  onChange={(e) =>
                    patchPdf({ paperSize: e.target.value as PdfExportSettings['paperSize'] })
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value="A4">A4</option>
                  <option value="B5">B5</option>
                  <option value="A5">A5</option>
                  <option value="A6">A6（単語カード大）</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">向き</span>
                <select
                  value={pdf.orientation}
                  onChange={(e) =>
                    patchPdf({ orientation: e.target.value as PdfExportSettings['orientation'] })
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value="portrait">縦</option>
                  <option value="landscape">横</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">段組み</span>
                <select
                  value={pdf.columns}
                  onChange={(e) => patchPdf({ columns: Number(e.target.value) as 1 | 2 | 3 })}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value={1}>1列</option>
                  <option value={2}>2列</option>
                  <option value={3}>3列</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">文字サイズ</span>
                <select
                  value={pdf.fontSize}
                  onChange={(e) =>
                    patchPdf({ fontSize: e.target.value as PdfExportSettings['fontSize'] })
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value="sm">小（最小8pt対応）</option>
                  <option value="md">標準</option>
                  <option value="lg">大</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">1ページの項目数</span>
                <select
                  value={pdf.itemsPerPage === 'auto' ? 'auto' : String(pdf.itemsPerPage)}
                  onChange={(e) => {
                    const v = e.target.value;
                    patchPdf({ itemsPerPage: v === 'auto' ? 'auto' : Number(v) });
                  }}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value="auto">自動</option>
                  <option value="6">6件 / ページ</option>
                  <option value="10">10件 / ページ</option>
                  <option value="15">15件 / ページ</option>
                  <option value="20">20件 / ページ</option>
                  <option value="30">30件 / ページ</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">並び順</span>
                <select
                  value={pdf.sortBy}
                  onChange={(e) =>
                    patchPdf({ sortBy: e.target.value as PdfExportSettings['sortBy'] })
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value="folder">フォルダ順</option>
                  <option value="mistakes">ミス回数順</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">余白</span>
                <select
                  value={pdf.margin}
                  onChange={(e) =>
                    patchPdf({ margin: e.target.value as PdfExportSettings['margin'] })
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value="normal">標準（16mm）</option>
                  <option value="narrow">狭め（8mm）</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs pt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pdf.includeToc}
                  onChange={(e) => patchPdf({ includeToc: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-blue-900"
                />
                <span>目次を含める</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pdf.pageBreakPerUnit}
                  disabled={pdf.itemsPerPage !== 'auto' || pdf.sortBy !== 'folder'}
                  onChange={(e) => patchPdf({ pageBreakPerUnit: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-blue-900 disabled:opacity-40"
                />
                <span>単元ごとに改ページ</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pdf.showMistakeCount}
                  onChange={(e) => patchPdf({ showMistakeCount: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-blue-900"
                />
                <span>ミス回数を表示</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pdf.includeTendencies}
                  onChange={(e) => patchPdf({ includeTendencies: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-blue-900"
                />
                <span className="font-medium text-slate-800">傾向ログ専用ページを含める</span>
              </label>
              {pdf.includeTendencies && (
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeHiddenTendencies}
                    onChange={(e) => setIncludeHiddenTendencies(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-900"
                  />
                  <span className="text-slate-600">非表示中の傾向も含める</span>
                </label>
              )}
            </div>
          </div>
        ) : (
          <div className="border-t border-slate-200 pt-4 space-y-2 text-xs">
            <div className="text-sm font-semibold text-slate-900">2. Anki 取り込み設定</div>
            <label className="block max-w-sm space-y-1">
              <span className="text-slate-600 font-medium block">
                デッキ名（任意 · 5列目 #deck column:5）
              </span>
              <input
                type="text"
                value={ankiDeck}
                onChange={(e) => setAnkiDeck(e.target.value)}
                placeholder="例: Anarize::弱点復習"
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
              />
            </label>
          </div>
        )}
      </div>

      {/* Preview Area */}
      {activeTab === 'pdf' ? (
        <div
          className="print-only-container rounded-xl border p-6 sm:p-8 space-y-5"
          style={{
            backgroundColor: PDF_COLORS.background,
            borderColor: PDF_COLORS.border,
            color: PDF_COLORS.text,
            fontSize: `${printFontPt}pt`,
          }}
        >
          {/* Print Header */}
          <div
            className="pb-3 flex flex-wrap items-baseline justify-between gap-3 border-b"
            style={{ borderColor: PDF_COLORS.primary }}
          >
            <div>
              <h2 className="text-[1.35em] font-bold" style={{ color: PDF_COLORS.primary }}>
                {APP_NAME} 復習まとめ（
                {scopeMode === 'custom'
                  ? '選択項目'
                  : selectedSubjects.join('・') || '科目未選択'}
                ）
              </h2>
              <div className="text-[0.82em] mt-0.5 tabular-nums" style={{ color: PDF_COLORS.muted }}>
                出力日: {getTodayJST()} · 知識 {filteredItems.length}件
                {pdf.includeTendencies ? ` · 傾向 ${filteredTendencies.length}件` : ''}
              </div>
            </div>
            <div className="text-[0.8em] tabular-nums" style={{ color: PDF_COLORS.muted }}>
              {pdf.paperSize} {pdf.orientation === 'landscape' ? '横' : '縦'} · {pdf.columns}列
            </div>
          </div>

          {filteredItems.length === 0 && filteredTendencies.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: PDF_COLORS.muted }}>
              選択された条件に該当する出力データがありません。
            </p>
          ) : (
            <>
              {/* Optional Table of Contents */}
              {pdf.includeToc && groupedByFolder.length > 0 && (
                <section
                  className="p-3 rounded-md border space-y-1.5"
                  style={{
                    borderColor: PDF_COLORS.border,
                    backgroundColor: PDF_COLORS.bandBg,
                  }}
                >
                  <div className="font-bold text-[0.95em]" style={{ color: PDF_COLORS.primary }}>
                    目次（収録単元）
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.85em] tabular-nums">
                    {groupedByFolder.map(([folderPath, items]) => (
                      <span key={folderPath}>
                        {folderPath}（{items.length}件）
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Knowledge Items */}
              {filteredItems.length > 0 && (
                <>
                  {pdf.itemsPerPage === 'auto' && pdf.sortBy === 'folder' ? (
                    <div className="space-y-4">
                      {groupedByFolder.map(([folderPath, items], idx) => (
                        <section
                          key={folderPath}
                          className={`space-y-2 ${
                            pdf.pageBreakPerUnit && idx > 0 ? 'print-page-break' : ''
                          }`}
                        >
                          <h3
                            className="font-bold px-2.5 py-1 rounded text-[0.95em]"
                            style={{
                              backgroundColor: PDF_COLORS.bandBg,
                              color: PDF_COLORS.primary,
                            }}
                          >
                            {folderPath}
                          </h3>
                          <div className={`grid gap-2 ${gridColsClass}`}>
                            {items.map((item) => renderKnowledgeCard(item, false))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {pagedItems.map((pageSlice, pageIdx) => (
                        <div
                          key={pageIdx}
                          className={`grid gap-2 ${gridColsClass} ${
                            pageIdx > 0 ? 'print-page-break' : ''
                          }`}
                        >
                          {pageSlice.map((item) => renderKnowledgeCard(item, true))}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Dedicated Tendencies Page */}
              {pdf.includeTendencies && filteredTendencies.length > 0 && (
                <section
                  className={`space-y-3 pt-2 ${
                    filteredItems.length > 0 ? 'print-page-break' : ''
                  }`}
                >
                  <h3
                    className="font-bold px-2.5 py-1.5 rounded text-[1.05em]"
                    style={{
                      backgroundColor: PDF_COLORS.bandBg,
                      color: PDF_COLORS.primary,
                    }}
                  >
                    注意すべきミスの傾向
                  </h3>
                  <div className="divide-y rounded-md border" style={{ borderColor: PDF_COLORS.border }}>
                    {filteredTendencies.map((t) => (
                      <div key={t.tendency_id} className="p-2.5 space-y-1 break-inside-avoid">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold">
                            {t.name}
                            {t.hidden ? '（非表示）' : ''}
                          </span>
                          <span className="text-[0.85em] tabular-nums" style={{ color: PDF_COLORS.muted }}>
                            {t.category} · {t.subjects.join('/')} · 計{t.occurrences.length}回
                          </span>
                        </div>
                        {t.occurrences[0] && (
                          <div className="text-[0.85em]" style={{ color: PDF_COLORS.muted }}>
                            直近例 ({t.occurrences[0].date} {t.occurrences[0].subject}/
                            {t.occurrences[0].unit}): {t.occurrences[0].situation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">Anki用テキストプレビュー</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              先頭行に{' '}
              <code className="bg-slate-100 px-1 rounded">#separator:tab</code> /{' '}
              <code className="bg-slate-100 px-1 rounded">#html:true</code> /{' '}
              <code className="bg-slate-100 px-1 rounded">#guid column:1</code> /{' '}
              <code className="bg-slate-100 px-1 rounded">#tags column:4</code> /{' '}
              <code className="bg-slate-100 px-1 rounded">#deck column:5</code>{' '}
              を付与し、改行は <code className="bg-slate-100 px-1 rounded">&lt;br&gt;</code>、HTML特殊文字をエスケープして出力します。Anki 側の「ファイルを読み込む」でそのままインポートできます。
            </p>
          </div>

          {ankiRows.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              出力対象の知識項目がありません。
            </p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">1: GUID</th>
                    <th className="py-2.5 px-3 font-semibold">2: 見出し</th>
                    <th className="py-2.5 px-3 font-semibold">3: 解説（HTML/MathJax）</th>
                    <th className="py-2.5 px-3 font-semibold">4: タグ</th>
                    <th className="py-2.5 px-3 font-semibold">5: デッキ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ankiRows.slice(0, 50).map((row) => (
                    <tr key={row.guid} className="align-top">
                      <td className="py-2 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {row.guid}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                        {row.heading}
                      </td>
                      <td className="py-2 px-3 text-slate-700 max-w-md break-words font-mono text-[11px]">
                        {row.explanation}
                      </td>
                      <td className="py-2 px-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">
                        {row.tags}
                      </td>
                      <td className="py-2 px-3 text-slate-500 text-[11px] whitespace-nowrap">
                        {row.deck || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
