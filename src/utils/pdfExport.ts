import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import type { PaperDimensions, PdfPageData } from '../components/PdfPageRenderer.tsx';
import type { PdfExportSettings } from '../types.ts';

export function buildPdfFileName(scopeLabel: string, dateStr: string): string {
  const cleanLabel =
    scopeLabel
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, '_')
      .replace(/^_+|_+$/g, '') || '全科目';
  return `Anarize_${cleanLabel}_${dateStr}.pdf`;
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function detectIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export interface SavePdfResult {
  method: 'download' | 'share' | 'tab';
  blobUrl?: string;
}

export async function savePdfBlob(blob: Blob, filename: string): Promise<SavePdfResult> {
  const isIOS = detectIOSDevice();
  const isStandalone =
    typeof window !== 'undefined' &&
    ((window.matchMedia?.('(display-mode: standalone)').matches ?? false) ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

  // On iPhone/iPad Safari or iOS standalone PWA, <a download> often fails or doesn't save cleanly.
  if (isIOS || isStandalone) {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: filename,
          });
          return { method: 'share' };
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { method: 'share' };
        }
        // Fall through to opening in a new tab or direct download
      }
    }

    const blobUrl = URL.createObjectURL(blob);
    const tabLink = document.createElement('a');
    tabLink.href = blobUrl;
    tabLink.target = '_blank';
    tabLink.rel = 'noopener noreferrer';
    document.body.appendChild(tabLink);
    tabLink.click();
    document.body.removeChild(tabLink);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return { method: 'tab', blobUrl };
  }

  // Standard desktop & Android browsers: direct Blob download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { method: 'download' };
}

export async function generatePdfBlobFromPages(opts: {
  pages: PdfPageData[];
  settings: PdfExportSettings;
  dimensions: PaperDimensions;
  renderPageIntoContainer: (pageIndex: number) => Promise<HTMLElement>;
  onProgress: (current: number, total: number) => void;
}): Promise<Blob> {
  const { pages, settings, dimensions, renderPageIntoContainer, onProgress } = opts;

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const doc = new jsPDF({
    orientation: settings.orientation,
    unit: 'mm',
    format: [dimensions.baseShortMm, dimensions.baseLongMm],
    compress: true,
  });

  const total = pages.length;
  for (let i = 0; i < total; i++) {
    onProgress(i + 1, total);
    await yieldToUI();

    const pageEl = await renderPageIntoContainer(i);
    await yieldToUI();

    const dataUrl = await toJpeg(pageEl, {
      pixelRatio: 2.5,
      quality: 0.85,
      backgroundColor: '#FFFFFF',
      cacheBust: false,
    });

    if (i > 0) {
      doc.addPage([dimensions.baseShortMm, dimensions.baseLongMm], settings.orientation);
    }

    doc.addImage(
      dataUrl,
      'JPEG',
      0,
      0,
      dimensions.widthMm,
      dimensions.heightMm,
      undefined,
      'FAST'
    );
  }

  return doc.output('blob');
}
