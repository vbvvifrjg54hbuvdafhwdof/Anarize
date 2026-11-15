import { PDF_COLORS } from '../config.ts';
import type { KnowledgeItem, PdfExportSettings, Tendency } from '../types.ts';
import { MathText } from './MathText.tsx';

export const MM_TO_PX = 96 / 25.4;

export interface PaperDimensions {
  baseShortMm: number;
  baseLongMm: number;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  marginMm: number;
  marginPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
  headerHeightPx: number;
  footerHeightPx: number;
  availableBodyHeightPx: number;
}

const PAPER_MM_MAP: Record<PdfExportSettings['paperSize'], [number, number]> = {
  A4: [210, 297],
  B5: [182, 257],
  A5: [148, 210],
  A6: [105, 148],
};

export function formatFolderTitle(folderPath: string): string {
  return folderPath
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('　');
}

export function getPaperDimensions(settings: PdfExportSettings): PaperDimensions {
  const [shortMm, longMm] = PAPER_MM_MAP[settings.paperSize] ?? [210, 297];
  const isLandscape = settings.orientation === 'landscape';
  const widthMm = isLandscape ? longMm : shortMm;
  const heightMm = isLandscape ? shortMm : longMm;
  const marginMm = settings.margin === 'narrow' ? 8 : 16;

  const widthPx = Math.round(widthMm * MM_TO_PX);
  const heightPx = Math.round(heightMm * MM_TO_PX);
  const marginPx = Math.round(marginMm * MM_TO_PX);
  const headerHeightPx = 22;
  const footerHeightPx = 22;
  const contentWidthPx = Math.max(100, widthPx - marginPx * 2);
  const contentHeightPx = Math.max(100, heightPx - marginPx * 2);
  const availableBodyHeightPx = Math.max(60, contentHeightPx - headerHeightPx - footerHeightPx);

  return {
    baseShortMm: shortMm,
    baseLongMm: longMm,
    widthMm,
    heightMm,
    widthPx,
    heightPx,
    marginMm,
    marginPx,
    contentWidthPx,
    contentHeightPx,
    headerHeightPx,
    footerHeightPx,
    availableBodyHeightPx,
  };
}

export function computePdfFontPt(settings: PdfExportSettings): number {
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

export type PdfRenderBlock =
  | {
      id: string;
      kind: 'toc';
      entries: Array<{ label: string; count: number }>;
    }
  | {
      id: string;
      kind: 'unit-header';
      title: string;
    }
  | {
      id: string;
      kind: 'subfolder-header';
      title: string;
    }
  | {
      id: string;
      kind: 'item-row';
      items: KnowledgeItem[];
      showUnitBadge: boolean;
    }
  | {
      id: string;
      kind: 'tendencies-header';
    }
  | {
      id: string;
      kind: 'tendency-row';
      tendency: Tendency;
    };

export interface PdfPageData {
  pageNumber: number;
  blocks: PdfRenderBlock[];
}

export function chunkArray<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function PdfKnowledgeRow({
  item,
  settings,
  showUnitBadge,
}: {
  item: KnowledgeItem;
  settings: PdfExportSettings;
  showUnitBadge: boolean;
}) {
  const isRedSheet = settings.displayMode === 'redsheet';
  const isHeadingsOnly = settings.displayMode === 'headings';

  return (
    <div
      style={{
        backgroundColor: PDF_COLORS.background,
        color: PDF_COLORS.text,
        padding: '6px 2px',
        borderBottom: `0.75px solid ${PDF_COLORS.border}`,
        boxSizing: 'border-box',
        minWidth: 0,
        wordBreak: 'break-word',
        breakInside: 'avoid',
      }}
    >
      {/* Line 1: Heading (1.0em, weight 500) + right inline mistake tag (0.85em) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <span
          style={{
            fontSize: '1.0em',
            fontWeight: 500,
            color: PDF_COLORS.text,
            lineHeight: 1.4,
            minWidth: 0,
          }}
        >
          {item.heading}
        </span>

        {(showUnitBadge || settings.showMistakeCount) && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: '6px',
              flexShrink: 0,
            }}
          >
            {showUnitBadge && (
              <span
                style={{
                  fontSize: '0.8em',
                  color: PDF_COLORS.muted,
                }}
              >
                {formatFolderTitle(item.folder_path)}
              </span>
            )}
            {settings.showMistakeCount && (
              <span
                style={{
                  fontSize: '0.85em',
                  fontWeight: 500,
                  backgroundColor: PDF_COLORS.bandBg,
                  color: PDF_COLORS.primary,
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                ミス{item.mistake_count}回
              </span>
            )}
          </div>
        )}
      </div>

      {/* Line 2: Explanation (0.95em, weight 400, line-height 1.6); hidden with preserved height in headings mode */}
      <div
        style={{
          marginTop: '3px',
          fontSize: '0.95em',
          fontWeight: 400,
          lineHeight: 1.6,
          color: isRedSheet ? PDF_COLORS.redSheet : PDF_COLORS.text,
          visibility: isHeadingsOnly ? 'hidden' : 'visible',
        }}
        aria-hidden={isHeadingsOnly}
      >
        <MathText text={item.explanation} />
      </div>
    </div>
  );
}

export function PdfBlockView({
  block,
  settings,
}: {
  block: PdfRenderBlock;
  settings: PdfExportSettings;
}) {
  switch (block.kind) {
    case 'toc':
      return (
        <div
          style={{
            padding: '4px 2px 7px 2px',
            borderBottom: `0.75px solid ${PDF_COLORS.border}`,
          }}
        >
          <div
            style={{
              fontWeight: 500,
              fontSize: '0.9em',
              color: PDF_COLORS.primary,
              marginBottom: '4px',
            }}
          >
            目次（収録単元）
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              columnGap: '14px',
              rowGap: '3px',
              fontSize: '0.85em',
              color: PDF_COLORS.text,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {block.entries.map((e, idx) => (
              <span key={`${e.label}-${idx}`}>
                {e.label}（{e.count}件）
              </span>
            ))}
          </div>
        </div>
      );

    case 'unit-header':
      return (
        <div
          style={{
            fontSize: '1.0em',
            fontWeight: 500,
            padding: '3px 10px',
            borderRadius: '4px',
            backgroundColor: PDF_COLORS.bandBg,
            color: PDF_COLORS.primary,
            marginTop: '6px',
            lineHeight: 1.45,
          }}
        >
          {block.title}
        </div>
      );

    case 'subfolder-header':
      return (
        <div
          style={{
            fontSize: '0.9em',
            fontWeight: 500,
            color: PDF_COLORS.primary,
            paddingLeft: '8px',
            paddingTop: '4px',
            paddingBottom: '1px',
            lineHeight: 1.4,
          }}
        >
          {block.title}
        </div>
      );

    case 'item-row':
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))`,
            columnGap: '14px',
            rowGap: '2px',
            alignItems: 'stretch',
          }}
        >
          {block.items.map((item) => (
            <PdfKnowledgeRow
              key={item.id}
              item={item}
              settings={settings}
              showUnitBadge={block.showUnitBadge}
            />
          ))}
        </div>
      );

    case 'tendencies-header':
      return (
        <div
          style={{
            fontSize: '1.0em',
            fontWeight: 500,
            padding: '3px 10px',
            borderRadius: '4px',
            backgroundColor: PDF_COLORS.bandBg,
            color: PDF_COLORS.primary,
            marginTop: '4px',
            lineHeight: 1.45,
          }}
        >
          注意すべきミスの傾向
        </div>
      );

    case 'tendency-row': {
      const t = block.tendency;
      return (
        <div
          style={{
            padding: '6px 2px',
            borderBottom: `0.75px solid ${PDF_COLORS.border}`,
            backgroundColor: PDF_COLORS.background,
            color: PDF_COLORS.text,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            breakInside: 'avoid',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '1.0em', fontWeight: 500, color: PDF_COLORS.text }}>
              {t.name}
              {t.hidden ? '（非表示）' : ''}
            </span>
            <span
              style={{
                fontSize: '0.85em',
                color: PDF_COLORS.muted,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {t.category}・{t.subjects.join('・')}・計{t.occurrences.length}回
            </span>
          </div>
          {t.occurrences[0] && (
            <div style={{ fontSize: '0.9em', color: PDF_COLORS.muted, lineHeight: 1.5 }}>
              直近例 ({t.occurrences[0].date} {t.occurrences[0].subject}　{t.occurrences[0].unit}):{' '}
              {t.occurrences[0].situation}
            </div>
          )}
        </div>
      );
    }
  }
}

export function PdfPageSheet({
  page,
  totalPages,
  headerTitle,
  headerMetaText,
  settings,
  dimensions,
}: {
  page: PdfPageData;
  totalPages: number;
  headerTitle: string;
  headerMetaText?: string;
  settings: PdfExportSettings;
  dimensions: PaperDimensions;
}) {
  const fontPt = computePdfFontPt(settings);

  return (
    <div
      data-pdf-page="true"
      style={{
        width: `${dimensions.widthPx}px`,
        height: `${dimensions.heightPx}px`,
        padding: `${dimensions.marginPx}px`,
        backgroundColor: PDF_COLORS.background,
        color: PDF_COLORS.text,
        fontSize: `${fontPt}pt`,
        lineHeight: 1.45,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {/* Running subtle header on every page */}
        <div
          style={{
            height: `${dimensions.headerHeightPx}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            fontSize: '0.8em',
            color: PDF_COLORS.muted,
            borderBottom: `0.5px solid ${PDF_COLORS.border}`,
            paddingBottom: '4px',
            marginBottom: '6px',
            flexShrink: 0,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {headerTitle}
          </span>
          {headerMetaText && page.pageNumber === 1 && (
            <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {headerMetaText}
            </span>
          )}
        </div>

        {/* Body */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            minHeight: 0,
          }}
        >
          {page.blocks.map((block) => (
            <PdfBlockView key={block.id} block={block} settings={settings} />
          ))}
        </div>
      </div>

      {/* Subtle footer with page number only */}
      <div
        style={{
          height: `${dimensions.footerHeightPx}px`,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          fontSize: '0.8em',
          color: PDF_COLORS.muted,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {page.pageNumber} / {totalPages}
      </div>
    </div>
  );
}
