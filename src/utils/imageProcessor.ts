export interface CompressedImageResult {
  blob: Blob;
  previewUrl: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('データの変換に失敗しました。'));
    reader.readAsDataURL(blob);
  });
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像のデコードに失敗しました。JPG / PNG / WebP 形式をお試しください。'));
    };
    img.src = url;
  });
}

export function canvasToCompressedJpeg(
  canvas: HTMLCanvasElement,
  maxLongEdge = 1600,
  quality = 0.85
): Promise<CompressedImageResult> {
  return new Promise((resolve, reject) => {
    const srcW = canvas.width;
    const srcH = canvas.height;
    const longEdge = Math.max(srcW, srcH);

    let targetCanvas = canvas;
    let targetW = srcW;
    let targetH = srcH;

    if (longEdge > maxLongEdge) {
      const scale = maxLongEdge / longEdge;
      targetW = Math.round(srcW * scale);
      targetH = Math.round(srcH * scale);
      targetCanvas = document.createElement('canvas');
      targetCanvas.width = targetW;
      targetCanvas.height = targetH;
      const ctx = targetCanvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas コンテキストを取得できませんでした。'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(canvas, 0, 0, targetW, targetH);
    }

    targetCanvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('JPEG 圧縮に失敗しました。'));
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        resolve({
          blob,
          previewUrl,
          mimeType: 'image/jpeg',
          width: targetW,
          height: targetH,
        });
      },
      'image/jpeg',
      quality
    );
  });
}

export async function compressImageFileToJpeg(
  file: File,
  maxLongEdge = 1600,
  quality = 0.85
): Promise<CompressedImageResult> {
  const img = await loadImageFromBlob(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const longEdge = Math.max(srcW, srcH);

  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('画像の縮小処理用 Canvas を初期化できませんでした。');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  return canvasToCompressedJpeg(canvas, maxLongEdge, quality);
}

export function captureVideoFrameToJpeg(
  video: HTMLVideoElement,
  maxLongEdge = 1600,
  quality = 0.85
): Promise<CompressedImageResult> {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) {
    return Promise.reject(new Error('カメラ映像の準備ができていません。'));
  }

  const canvas = document.createElement('canvas');
  canvas.width = srcW;
  canvas.height = srcH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.reject(new Error('撮影用 Canvas を初期化できませんでした。'));
  }
  ctx.drawImage(video, 0, 0, srcW, srcH);
  return canvasToCompressedJpeg(canvas, maxLongEdge, quality);
}
