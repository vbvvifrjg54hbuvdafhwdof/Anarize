import { Check, Copy, Download, FileDown, FileText, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_NAME } from '../config.ts';
import { getTodayJST, updatePdfSettings } from '../services/storeService.ts';
import type { AppState, KnowledgeItem, PdfExportSettings, Tendency } from '../types.ts';
import { buildPdfFileName, generatePdfBlobFromPages, savePdfBlob } from '../utils/pdfExport.ts';
import { EmptySubjectsPrompt } from './EmptySubjectsPrompt.tsx';
import {
  chunkArray,
  computePdfFontPt,
  formatFolderTitle,
  getPaperDimensions,
  type PaperDimensions,
  PdfBlockView,
  type PdfPageData,
  PdfPageSheet,
  type PdfRenderBlock,
} from './PdfPageRenderer.tsx';

interface ExportViewProps {
  state: AppState;
  onStateUpdated: (state: AppState) => void;
}

type ExportTab = 'pdf' | 'anki';
type ScopeMode = 'subject' | 'folder' | 'custom';

function escapeAnkiHtmlAndMath(raw: string): string {
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

function LazyPreviewPage({
  page,
  totalPages,
  headerTitle,
  headerMetaText,
  settings,
  dimensions,
  scale,
}: {
  page: PdfPageData;
  totalPages: number;
  headerTitle: string;
  headerMetaText: string;
  settings: PdfExportSettings;
  dimensions: PaperDimensions;
  scale: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(page.pageNumber <= 2);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
          } else if (totalPages > 12) {
            setIsVisible(false);
          }
        }
      },
      { rootMargin: '450px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [totalPages]);

  const scaledW = Math.max(120, Math.round(dimensions.widthPx * scale));
  const scaledH = Math.max(160, Math.round(dimensions.heightPx * scale));

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={containerRef}
        className="relative bg-white border border-slate-200 overflow-hidden"
        style={{ width: `${scaledW}px`, height: `${scaledH}px` }}
      >
        {isVisible ? (
          <div
            style={{
              width: `${dimensions.widthPx}px`,
              height: `${dimensions.heightPx}px`,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            <PdfPageSheet
              page={page}
              totalPages={totalPages}
              headerTitle={headerTitle}
              headerMetaText={headerMetaText}
              settings={settings}
              dimensions={dimensions}
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
            {page.pageNumber} / {totalPages}
          </div>
        )}
      </div>
      <div className="text-xs font-medium text-slate-500 tabular-nums">
        {page.pageNumber} / {totalPages}
      </div>
    </div>
  );
}

export function ExportView({ state, onStateUpdated }: ExportViewProps) {
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

  // Pagination & Preview State
  const [pages, setPages] = useState<PdfPageData[]>([]);
  const [isPaginating, setIsPaginating] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(600);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const measurerRef = useRef<HTMLDivElement | null>(null);
  const hasMeasuredOnceRef = useRef(false);

  // PDF Export Generation State
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [pdfMessage, setPdfMessage] = useState<{ text: string; url?: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [exportPageIndex, setExportPageIndex] = useState<number | null>(null);
  const exportHostRef = useRef<HTMLDivElement | null>(null);
  const exportResolveRef = useRef<((el: HTMLElement) => void) | null>(null);

  // Anki Options
  const [ankiDeck, setAnkiDeck] = useState('');
  const [copiedAnki, setCopiedAnki] = useState(false);

  useEffect(() => {
    setPdf({ ...state.pdfSettings });
  }, [state.pdfSettings]);

  // Keep selectedSubjects valid if user adds/deletes subjects
  const prevSubjectsRef = useRef<string[]>(state.subjects);
  useEffect(() => {
    const prev = prevSubjectsRef.current;
    const added = state.subjects.filter((s) => !prev.includes(s));
    setSelectedSubjects((curr) => {
      const valid = curr.filter((s) => state.subjects.includes(s));
      if (prev.length === 0 && added.length > 0) {
        return [...state.subjects];
      }
      return Array.from(new Set([...valid, ...added]));
    });
    prevSubjectsRef.current = state.subjects;
  }, [state.subjects]);

  // Measure preview viewport width for scaling paper sheets
  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const w = el.clientWidth;
      if (w > 0) setPreviewWidth(w);
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateWidth());
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [state.subjects.length, activeTab]);

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
      if (subjectsInScope.length === 0) return false;
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

  const groupedByUnit = useMemo(() => {
    const unitMap = new Map<
      string,
      {
        directItems: KnowledgeItem[];
        subfolders: Array<{ subfolderName: string; items: KnowledgeItem[] }>;
        subMap: Map<string, KnowledgeItem[]>;
      }
    >();

    for (const item of filteredItems) {
      const parts = item.folder_path.split('/').filter(Boolean);
      const unitPath = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : item.folder_path;
      let group = unitMap.get(unitPath);
      if (!group) {
        group = { directItems: [], subfolders: [], subMap: new Map() };
        unitMap.set(unitPath, group);
      }

      if (parts.length >= 3) {
        const subName = parts.slice(2).join('　');
        const subList = group.subMap.get(subName) ?? [];
        subList.push(item);
        group.subMap.set(subName, subList);
      } else {
        group.directItems.push(item);
      }
    }

    return Array.from(unitMap.entries()).map(([unitPath, data]) => {
      const subfolders = Array.from(data.subMap.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'ja'))
        .map(([subfolderName, items]) => ({ subfolderName, items }));
      const totalCount =
        data.directItems.length + subfolders.reduce((acc, s) => acc + s.items.length, 0);
      return {
        unitPath,
        unitTitle: formatFolderTitle(unitPath),
        totalCount,
        directItems: data.directItems,
        subfolders,
      };
    });
  }, [filteredItems]);

  const dimensions = useMemo(() => getPaperDimensions(pdf), [pdf]);
  const fontPt = useMemo(() => computePdfFontPt(pdf), [pdf]);

  const scopeLabel = useMemo(() => {
    if (scopeMode === 'custom') return '選択項目';
    if (scopeMode === 'folder' && selectedFolder !== 'ALL') {
      return selectedFolder.replace(/\//g, '_');
    }
    if (selectedSubjects.length === 0) return '科目未選択';
    if (selectedSubjects.length === state.subjects.length) return '全科目';
    return selectedSubjects.join('_');
  }, [scopeMode, selectedFolder, selectedSubjects, state.subjects.length]);

  const pdfHeaderTitle = useMemo(() => {
    let subjectPrefix = '';
    if (scopeMode === 'custom') {
      const subs = Array.from(
        new Set(filteredItems.map((i) => i.folder_path.split('/')[0]).filter(Boolean))
      );
      subjectPrefix = subs.join('・') || '選択項目';
    } else if (scopeMode === 'folder' && selectedFolder !== 'ALL') {
      subjectPrefix = formatFolderTitle(selectedFolder);
    } else {
      subjectPrefix = selectedSubjects.join('・') || '全科目';
    }
    return `${subjectPrefix}　要復習まとめ`;
  }, [scopeMode, selectedFolder, selectedSubjects, filteredItems]);

  const pdfHeaderMetaText = useMemo(() => {
    return `${getTodayJST()} · 知識${filteredItems.length}件${
      pdf.includeTendencies ? ` · 傾向${filteredTendencies.length}件` : ''
    }`;
  }, [filteredItems.length, filteredTendencies.length, pdf.includeTendencies]);

  // Build ordered blocks for measurement & pagination
  const candidateBlocks = useMemo<PdfRenderBlock[]>(() => {
    if (filteredItems.length === 0 && filteredTendencies.length === 0) {
      return [];
    }

    const blocks: PdfRenderBlock[] = [];

    if (pdf.includeToc && groupedByUnit.length > 0) {
      blocks.push({
        id: 'toc',
        kind: 'toc',
        entries: groupedByUnit.map((g) => ({
          label: g.unitTitle,
          count: g.totalCount,
        })),
      });
    }

    if (filteredItems.length > 0) {
      if (pdf.itemsPerPage === 'auto' && pdf.sortBy === 'folder') {
        groupedByUnit.forEach((unitGroup, gIdx) => {
          blocks.push({
            id: `unit-header-${gIdx}-${unitGroup.unitPath}`,
            kind: 'unit-header',
            title: unitGroup.unitTitle,
          });
          const directRows = chunkArray(unitGroup.directItems, pdf.columns);
          directRows.forEach((rowItems, rIdx) => {
            blocks.push({
              id: `unit-${gIdx}-direct-row-${rIdx}`,
              kind: 'item-row',
              items: rowItems,
              showUnitBadge: false,
            });
          });
          unitGroup.subfolders.forEach((sub, sIdx) => {
            blocks.push({
              id: `unit-${gIdx}-sub-${sIdx}`,
              kind: 'subfolder-header',
              title: sub.subfolderName,
            });
            const subRows = chunkArray(sub.items, pdf.columns);
            subRows.forEach((rowItems, rIdx) => {
              blocks.push({
                id: `unit-${gIdx}-sub-${sIdx}-row-${rIdx}`,
                kind: 'item-row',
                items: rowItems,
                showUnitBadge: false,
              });
            });
          });
        });
      } else {
        const rows = chunkArray(filteredItems, pdf.columns);
        rows.forEach((rowItems, rIdx) => {
          blocks.push({
            id: `flat-row-${rIdx}`,
            kind: 'item-row',
            items: rowItems,
            showUnitBadge: true,
          });
        });
      }
    }

    if (pdf.includeTendencies && filteredTendencies.length > 0) {
      blocks.push({
        id: 'tendencies-header',
        kind: 'tendencies-header',
      });
      filteredTendencies.forEach((tendency) => {
        blocks.push({
          id: `tendency-${tendency.tendency_id}`,
          kind: 'tendency-row',
          tendency,
        });
      });
    }

    return blocks;
  }, [
    filteredItems,
    filteredTendencies,
    groupedByUnit,
    pdf.includeToc,
    pdf.includeTendencies,
    pdf.itemsPerPage,
    pdf.sortBy,
    pdf.columns,
  ]);

  const computePagesFromDom = useCallback(() => {
    if (candidateBlocks.length === 0) {
      setPages([]);
      setIsPaginating(false);
      return;
    }

    const host = measurerRef.current;
    if (!host) {
      setIsPaginating(false);
      return;
    }

    const heightMap = new Map<string, number>();
    const blockEls = host.querySelectorAll<HTMLElement>('[data-block-id]');
    blockEls.forEach((el) => {
      const id = el.dataset.blockId;
      if (id) heightMap.set(id, el.offsetHeight);
    });

    const maxH = dimensions.availableBodyHeightPx;
    const gapPx = 4;

    const resultPages: PdfPageData[] = [];
    let currentBlocks: PdfRenderBlock[] = [];
    let currentHeight = 0;

    const pushPage = () => {
      if (currentBlocks.length > 0) {
        resultPages.push({
          pageNumber: resultPages.length + 1,
          blocks: currentBlocks,
        });
        currentBlocks = [];
        currentHeight = 0;
      }
    };

    const appendBlock = (block: PdfRenderBlock, h: number) => {
      const addH = currentBlocks.length > 0 ? gapPx + h : h;
      currentBlocks.push(block);
      currentHeight += addH;
    };

    const getH = (id: string) => heightMap.get(id) ?? 32;

    // 1. TOC
    const tocBlock = candidateBlocks.find((b) => b.kind === 'toc');
    if (tocBlock) {
      appendBlock(tocBlock, getH(tocBlock.id));
    }

    // 2. Knowledge Items
    if (filteredItems.length > 0) {
      if (pdf.itemsPerPage === 'auto' && pdf.sortBy === 'folder') {
        let unitIndex = 0;
        let i = 0;
        while (i < candidateBlocks.length) {
          const block = candidateBlocks[i];
          if (block.kind === 'toc' || block.kind === 'tendencies-header' || block.kind === 'tendency-row') {
            i++;
            continue;
          }

          if (block.kind === 'unit-header') {
            if (pdf.pageBreakPerUnit && unitIndex > 0) {
              pushPage();
            }
            unitIndex++;

            // Keep unit-header + immediate subfolder-header (if any) + first item-row together
            const b1 = candidateBlocks[i + 1];
            const b2 = candidateBlocks[i + 2];
            if (b1 && b1.kind === 'subfolder-header' && b2 && b2.kind === 'item-row') {
              const needed =
                (currentBlocks.length > 0 ? gapPx : 0) +
                getH(block.id) +
                gapPx +
                getH(b1.id) +
                gapPx +
                getH(b2.id);
              if (currentBlocks.length > 0 && currentHeight + needed > maxH) {
                pushPage();
              }
              appendBlock(block, getH(block.id));
              appendBlock(b1, getH(b1.id));
              appendBlock(b2, getH(b2.id));
              i += 3;
            } else if (b1 && b1.kind === 'item-row') {
              const needed =
                (currentBlocks.length > 0 ? gapPx : 0) + getH(block.id) + gapPx + getH(b1.id);
              if (currentBlocks.length > 0 && currentHeight + needed > maxH) {
                pushPage();
              }
              appendBlock(block, getH(block.id));
              appendBlock(b1, getH(b1.id));
              i += 2;
            } else {
              const h = getH(block.id);
              if (currentBlocks.length > 0 && currentHeight + gapPx + h > maxH) {
                pushPage();
              }
              appendBlock(block, h);
              i += 1;
            }
            continue;
          }

          if (block.kind === 'subfolder-header') {
            const next = candidateBlocks[i + 1];
            if (next && next.kind === 'item-row') {
              const needed =
                (currentBlocks.length > 0 ? gapPx : 0) + getH(block.id) + gapPx + getH(next.id);
              if (currentBlocks.length > 0 && currentHeight + needed > maxH) {
                pushPage();
              }
              appendBlock(block, getH(block.id));
              appendBlock(next, getH(next.id));
              i += 2;
            } else {
              const h = getH(block.id);
              if (currentBlocks.length > 0 && currentHeight + gapPx + h > maxH) {
                pushPage();
              }
              appendBlock(block, h);
              i += 1;
            }
            continue;
          }

          // item-row
          const rowH = getH(block.id);
          if (currentBlocks.length > 0 && currentHeight + gapPx + rowH > maxH) {
            pushPage();
          }
          appendBlock(block, rowH);
          i += 1;
        }
      } else {
        const limitPerPage = pdf.itemsPerPage === 'auto' ? Infinity : pdf.itemsPerPage;
        let itemsOnPage = 0;
        const rowBlocks = candidateBlocks.filter(
          (b): b is Extract<PdfRenderBlock, { kind: 'item-row' }> => b.kind === 'item-row'
        );

        for (const rowBlock of rowBlocks) {
          const rowH = getH(rowBlock.id);
          const exceedsCount = itemsOnPage > 0 && itemsOnPage >= limitPerPage;
          const exceedsHeight =
            currentBlocks.length > 0 && currentHeight + gapPx + rowH > maxH;

          if (exceedsCount || exceedsHeight) {
            pushPage();
            itemsOnPage = 0;
          }

          appendBlock(rowBlock, rowH);
          itemsOnPage += rowBlock.items.length;
        }
      }
    }

    // 3. Dedicated Tendencies Section
    const tendHeader = candidateBlocks.find((b) => b.kind === 'tendencies-header');
    const tendRows = candidateBlocks.filter(
      (b): b is Extract<PdfRenderBlock, { kind: 'tendency-row' }> => b.kind === 'tendency-row'
    );
    if (tendHeader && tendRows.length > 0) {
      if (filteredItems.length > 0) {
        pushPage();
      }
      const tendHeaderH = getH(tendHeader.id);
      const firstTendH = getH(tendRows[0].id);
      const combinedNeeded =
        (currentBlocks.length > 0 ? gapPx : 0) + tendHeaderH + gapPx + firstTendH;
      if (currentBlocks.length > 0 && currentHeight + combinedNeeded > maxH) {
        pushPage();
      }
      appendBlock(tendHeader, tendHeaderH);
      appendBlock(tendRows[0], firstTendH);

      for (let tIdx = 1; tIdx < tendRows.length; tIdx++) {
        const row = tendRows[tIdx];
        const rowH = getH(row.id);
        if (currentBlocks.length > 0 && currentHeight + gapPx + rowH > maxH) {
          pushPage();
        }
        appendBlock(row, rowH);
      }
    }

    pushPage();
    setPages(resultPages);
    setIsPaginating(false);
  }, [
    candidateBlocks,
    dimensions.availableBodyHeightPx,
    filteredItems.length,
    pdf.itemsPerPage,
    pdf.pageBreakPerUnit,
    pdf.sortBy,
  ]);

  // Immediate pagination on first render, 300ms debounce on subsequent settings/content updates
  useEffect(() => {
    if (activeTab !== 'pdf' || state.subjects.length === 0) return;
    if (candidateBlocks.length === 0) {
      setPages([]);
      setIsPaginating(false);
      return;
    }

    setIsPaginating(true);
    const delay = hasMeasuredOnceRef.current ? 300 : 0;
    const timer = window.setTimeout(() => {
      hasMeasuredOnceRef.current = true;
      requestAnimationFrame(() => computePagesFromDom());
    }, delay);

    return () => window.clearTimeout(timer);
  }, [activeTab, state.subjects.length, candidateBlocks, computePagesFromDom]);

  // Resolve single-page offscreen render promise when exportPageIndex mounts
  useEffect(() => {
    if (exportPageIndex === null || !exportHostRef.current || !exportResolveRef.current) return;
    const resolver = exportResolveRef.current;
    const host = exportHostRef.current;
    requestAnimationFrame(() => {
      const pageEl = host.querySelector<HTMLElement>('[data-pdf-page="true"]');
      if (pageEl) {
        exportResolveRef.current = null;
        resolver(pageEl);
      }
    });
  }, [exportPageIndex]);

  const renderPageForExport = useCallback((pageIdx: number): Promise<HTMLElement> => {
    return new Promise((resolve) => {
      exportResolveRef.current = resolve;
      setExportPageIndex(pageIdx);
    });
  }, []);

  const handleCreatePdf = async () => {
    if (isGeneratingPdf || pages.length === 0) return;
    setIsGeneratingPdf(true);
    setPdfError(null);
    setPdfMessage(null);
    setExportProgress({ current: 0, total: pages.length });

    try {
      const filename = buildPdfFileName(scopeLabel, getTodayJST());
      const blob = await generatePdfBlobFromPages({
        pages,
        settings: pdf,
        dimensions,
        renderPageIntoContainer: renderPageForExport,
        onProgress: (current, total) => setExportProgress({ current, total }),
      });

      const saved = await savePdfBlob(blob, filename);
      if (saved.method === 'download') {
        setPdfMessage({ text: `「${filename}」をダウンロードしました。` });
      } else if (saved.method === 'share') {
        setPdfMessage({ text: `「${filename}」の共有・保存メニューを開きました。` });
      } else {
        setPdfMessage({
          text: `新しいタブで「${filename}」を開きました（開かない場合はリンクをタップしてください）。`,
          url: saved.blobUrl,
        });
      }
    } catch (err) {
      setPdfError(
        err instanceof Error ? `PDFの生成に失敗しました: ${err.message}` : 'PDFの生成に失敗しました。'
      );
    } finally {
      exportResolveRef.current = null;
      setExportPageIndex(null);
      setIsGeneratingPdf(false);
      setExportProgress(null);
    }
  };

  // Anki handlers
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

  if (state.subjects.length === 0) {
    return <EmptySubjectsPrompt onStateUpdated={onStateUpdated} />;
  }

  const previewScale = Math.min(1, Math.max(0.2, (previewWidth - 4) / dimensions.widthPx));
  const hasAnyContent = filteredItems.length > 0 || filteredTendencies.length > 0;

  return (
    <div className="space-y-3.5">
      {/* Offscreen Measurer */}
      <div
        ref={measurerRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '-99999px',
          top: 0,
          width: `${dimensions.contentWidthPx}px`,
          fontSize: `${fontPt}pt`,
          lineHeight: 1.45,
          visibility: 'hidden',
          pointerEvents: 'none',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {candidateBlocks.map((block) => (
            <div key={block.id} data-block-id={block.id}>
              <PdfBlockView block={block} settings={pdf} />
            </div>
          ))}
        </div>
      </div>

      {/* Offscreen Single-Page Export Render Host */}
      {exportPageIndex !== null && pages[exportPageIndex] && (
        <div
          ref={exportHostRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: '-99999px',
            top: 0,
            pointerEvents: 'none',
            zIndex: -1,
          }}
        >
          <PdfPageSheet
            page={pages[exportPageIndex]}
            totalPages={pages.length}
            headerTitle={pdfHeaderTitle}
            headerMetaText={pdfHeaderMetaText}
            settings={pdf}
            dimensions={dimensions}
          />
        </div>
      )}

      {/* Top Mode Switcher & Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('pdf')}
            className={`min-h-[max(44px,2.75rem)] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'pdf'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileDown className="w-4 h-4" />
            <span>PDF出力</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('anki')}
            className={`min-h-[max(44px,2.75rem)] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
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
          <button
            type="button"
            onClick={() => void handleCreatePdf()}
            disabled={!hasAnyContent || pages.length === 0 || isGeneratingPdf || isPaginating}
            className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 disabled:bg-slate-300 cursor-pointer"
          >
            {isGeneratingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {exportProgress
                    ? `作成中 (${exportProgress.current}/${exportProgress.total}ページ)`
                    : 'PDFを作成中...'}
                </span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>PDF作成</span>
              </>
            )}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyAnki()}
              disabled={ankiRows.length === 0}
              className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-blue-900 text-blue-900 bg-white text-xs font-semibold hover:bg-blue-50 disabled:opacity-40 cursor-pointer"
            >
              {copiedAnki ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedAnki ? 'コピーしました' : 'クリップボードにコピー'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadAnkiTxt}
              disabled={ankiRows.length === 0}
              className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 disabled:bg-slate-300 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>.txt で保存（{ankiRows.length}件）</span>
            </button>
          </div>
        )}
      </div>

      {pdfError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">
          {pdfError}
        </div>
      )}

      {pdfMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-2">
          <span>{pdfMessage.text}</span>
          {pdfMessage.url && (
            <a
              href={pdfMessage.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-900 underline"
            >
              PDFを開く
            </a>
          )}
        </div>
      )}

      {/* Range & Format Options */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 space-y-3.5">
        <div className="space-y-2.5">
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
                  className={`min-h-[max(44px,2.75rem)] px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                    scopeMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {scopeMode !== 'custom' ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-600 mr-1">科目:</span>
                {state.subjects.map((sub) => {
                  const active = selectedSubjects.includes(sub);
                  return (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => toggleSubject(sub)}
                      className={`min-h-[max(44px,2.75rem)] px-3 py-1 rounded-md border text-xs font-medium cursor-pointer transition-colors ${
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
                    className="min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900 bg-white"
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
            <div className="border border-slate-200 rounded-lg p-2.5 space-y-2">
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
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded">
                {activeItemsPool.map((item) => {
                  const checked = customSelectedIds.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50 cursor-pointer"
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
                      <span className="font-medium text-slate-900 truncate">{item.heading}</span>
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
          <div className="border-t border-slate-200 pt-3.5 space-y-3">
            <div className="text-sm font-semibold text-slate-900">
              2. PDFレイアウト・サイズ・詳細オプション（設定は自動保存）
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="text-slate-600 font-medium block">表示モード</span>
                <select
                  value={pdf.displayMode}
                  onChange={(e) =>
                    patchPdf({ displayMode: e.target.value as PdfExportSettings['displayMode'] })
                  }
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
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
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
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
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
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
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
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
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
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
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
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
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
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
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-2.5 py-1.5 bg-white"
                >
                  <option value="normal">標準（16mm）</option>
                  <option value="narrow">狭め（8mm）</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs pt-0.5">
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
          <div className="border-t border-slate-200 pt-3.5 space-y-2 text-xs">
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
                className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900"
              />
            </label>
          </div>
        )}
      </div>

      {/* Preview Area */}
      {activeTab === 'pdf' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="text-sm font-semibold text-slate-900">
              プレビュー
              {hasAnyContent && pages.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500 tabular-nums">
                  全 {pages.length} ページ（{pdf.paperSize}{' '}
                  {pdf.orientation === 'landscape' ? '横' : '縦'}）
                </span>
              )}
            </div>
            {isPaginating && (
              <span className="text-xs text-slate-500">ページ割り付けを更新中...</span>
            )}
          </div>

          {!hasAnyContent ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              出力する項目を選んでください
            </div>
          ) : (
            <div className="bg-slate-100/80 border border-slate-200 rounded-xl p-3 sm:p-5">
              <div
                ref={previewContainerRef}
                className="w-full max-w-3xl mx-auto space-y-5"
              >
                {pages.map((page) => (
                  <LazyPreviewPage
                    key={`${page.pageNumber}-${pdf.paperSize}-${pdf.orientation}-${pdf.columns}-${pdf.fontSize}-${pdf.margin}-${pdf.displayMode}`}
                    page={page}
                    totalPages={pages.length}
                    headerTitle={pdfHeaderTitle}
                    headerMetaText={pdfHeaderMetaText}
                    settings={pdf}
                    dimensions={dimensions}
                    scale={previewScale}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">Anki用テキストプレビュー</h3>
            <p className="text-xs text-slate-500 leading-snug">
              先頭行に{' '}
              <code className="bg-slate-100 px-1 rounded">#separator:tab</code> /{' '}
              <code className="bg-slate-100 px-1 rounded">#html:true</code> /{' '}
              <code className="bg-slate-100 px-1 rounded">#guid column:1</code> /{' '}
              <code className="bg-slate-100 px-1 rounded">#tags column:4</code> /{' '}
              <code className="bg-slate-100 px-1 rounded">#deck column:5</code>{' '}
              を付与し、改行は <code className="bg-slate-100 px-1 rounded">&lt;br&gt;</code>、HTML特殊文字をエスケープして出力します。
            </p>
          </div>

          {ankiRows.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              出力する項目を選んでください
            </p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-2.5 font-semibold">1: GUID</th>
                    <th className="py-2 px-2.5 font-semibold">2: 見出し</th>
                    <th className="py-2 px-2.5 font-semibold">3: 解説（HTML/MathJax）</th>
                    <th className="py-2 px-2.5 font-semibold">4: タグ</th>
                    <th className="py-2 px-2.5 font-semibold">5: デッキ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ankiRows.map((row) => (
                    <tr key={row.guid} className="align-top">
                      <td className="py-1.5 px-2.5 text-slate-500 font-mono text-xs whitespace-nowrap">
                        {row.guid}
                      </td>
                      <td className="py-1.5 px-2.5 font-medium text-slate-900 whitespace-nowrap">
                        {row.heading}
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-700 max-w-md break-words font-mono text-xs">
                        {row.explanation}
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-600 font-mono text-xs whitespace-nowrap">
                        {row.tags}
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-500 text-xs whitespace-nowrap">
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
