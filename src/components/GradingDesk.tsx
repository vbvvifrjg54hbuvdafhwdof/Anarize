import {
  Camera,
  FileText,
  HelpCircle,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearAllSessions,
  discardSession,
  replyToReviewSession,
  startReviewSession,
} from '../services/geminiClient.ts';
import type {
  AnswerAttachment,
  AppState,
  ReviewProgressEvent,
  ReviewRecord,
} from '../types.ts';
import {
  captureVideoFrameToJpeg,
  compressImageFileToJpeg,
  countPdfPages,
} from '../utils/imageProcessor.ts';
import { ReviewSheet } from './ReviewSheet.tsx';

interface GradingDeskProps {
  subjects: string[];
  hasApiKey: boolean;
  maxPdfPages: number;
  isOnline: boolean;
  onOpenSettings: () => void;
  onStateUpdated: (state: AppState) => void;
  onJumpToKnowledge: (heading: string, subject: string) => void;
  onJumpToTendency: (tendencyName: string) => void;
}

type InputMode = 'file' | 'camera';

function detectMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

export function GradingDesk({
  subjects,
  hasApiKey,
  maxPdfPages,
  isOnline,
  onOpenSettings,
  onStateUpdated,
  onJumpToKnowledge,
  onJumpToTendency,
}: GradingDeskProps) {
  const [inputMode, setInputMode] = useState<InputMode>('file');
  const [attachments, setAttachments] = useState<AnswerAttachment[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [memo, setMemo] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // PC Camera State
  const [isMobile] = useState<boolean>(() => detectMobileDevice());
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [retakeTargetIndex, setRetakeTargetIndex] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Mobile native camera & file inputs
  const mobileCameraInputRef = useRef<HTMLInputElement | null>(null);
  const mobileRetakeInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Grading Session State
  const [isGrading, setIsGrading] = useState(false);
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clarification, setClarification] = useState<{
    sessionId: string;
    question: string;
  } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [latestReview, setLatestReview] = useState<ReviewRecord | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const startPCCamera = useCallback(async () => {
    setCameraError(null);
    setCameraReady(false);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'このブラウザはカメラ映像の直接取得（getUserMedia）に対応していません。「ファイルから選ぶ」をご利用ください。'
      );
      return;
    }

    try {
      stopCameraStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraError(
          'カメラへのアクセス権限が拒否されました。ブラウザの設定で許可するか、「ファイルから選ぶ」から画像を提出してください。'
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraError(
          '利用可能なカメラが見つかりませんでした。「ファイルから選ぶ」から画像またはPDFを提出してください。'
        );
      } else {
        setCameraError(
          'カメラを起動できませんでした。「ファイルから選ぶ」から画像またはPDFを提出してください。'
        );
      }
    }
  }, [stopCameraStream]);

  useEffect(() => {
    if (inputMode === 'camera' && !isMobile) {
      void startPCCamera();
    } else {
      stopCameraStream();
    }
    return () => {
      stopCameraStream();
    };
  }, [inputMode, isMobile, startPCCamera, stopCameraStream]);

  // Revoke object URLs on unmount
  const attachmentsRef = useRef<AnswerAttachment[]>([]);
  attachmentsRef.current = attachments;
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    };
  }, []);

  const discardPendingClarification = useCallback(() => {
    if (clarification) {
      discardSession(clarification.sessionId);
      setClarification(null);
      setReplyText('');
    }
  }, [clarification]);

  const clearAllAttachments = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      return [];
    });
    setRetakeTargetIndex(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (mobileCameraInputRef.current) mobileCameraInputRef.current.value = '';
  }, []);

  const handleFilesAdded = async (files: FileList | File[], replaceIndex: number | null = null) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setErrorMessage(null);
    discardPendingClarification();

    const pdfFile = fileArray.find(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    );
    if (pdfFile) {
      if (pdfFile.size > 20 * 1024 * 1024) {
        setErrorMessage('PDFファイルサイズは 20MB 以下にしてください。');
        return;
      }
      const pageCount = await countPdfPages(pdfFile);
      if (pageCount > maxPdfPages) {
        setErrorMessage(
          `このPDFは約${pageCount}ページあります（現在の上限: ${maxPdfPages}ページ）。答案を分割して送信するか、設定画面からページ上限を変更してください。`
        );
        return;
      }
      clearAllAttachments();
      const url = URL.createObjectURL(pdfFile);
      setAttachments([
        {
          id: `att_${Date.now().toString(36)}`,
          kind: 'pdf',
          name: pdfFile.name,
          mimeType: 'application/pdf',
          blob: pdfFile,
          previewUrl: url,
          pageCount,
        },
      ]);
      return;
    }

    const imageFiles = fileArray.filter(
      (f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)
    );
    if (imageFiles.length === 0) {
      setErrorMessage('画像（JPG / PNG / WebP）または PDF ファイルを選択してください。');
      return;
    }

    setIsCompressing(true);
    try {
      const processed: AnswerAttachment[] = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const f = imageFiles[i];
        const compressed = await compressImageFileToJpeg(f, 1600, 0.85);
        processed.push({
          id: `att_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 5)}`,
          kind: 'image',
          name: f.name || `撮影_${i + 1}.jpg`,
          mimeType: 'image/jpeg',
          blob: compressed.blob,
          previewUrl: compressed.previewUrl,
          width: compressed.width,
          height: compressed.height,
        });
      }

      setAttachments((prev) => {
        const onlyImages = prev.filter((a) => a.kind === 'image');
        prev.filter((a) => a.kind === 'pdf').forEach((a) => URL.revokeObjectURL(a.previewUrl));

        if (replaceIndex !== null && replaceIndex >= 0 && replaceIndex < onlyImages.length) {
          const next = [...onlyImages];
          URL.revokeObjectURL(next[replaceIndex].previewUrl);
          next[replaceIndex] = processed[0];
          return next;
        }
        return [...onlyImages, ...processed];
      });
      setRetakeTargetIndex(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : '画像の縮小・圧縮処理に失敗しました。'
      );
    } finally {
      setIsCompressing(false);
    }
  };

  const handlePCCapture = async () => {
    if (!videoRef.current || !cameraReady || isCompressing) return;
    setErrorMessage(null);
    discardPendingClarification();
    setIsCompressing(true);
    try {
      const captured = await captureVideoFrameToJpeg(videoRef.current, 1600, 0.85);
      const item: AnswerAttachment = {
        id: `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        kind: 'image',
        name: 'カメラ撮影.jpg',
        mimeType: 'image/jpeg',
        blob: captured.blob,
        previewUrl: captured.previewUrl,
        width: captured.width,
        height: captured.height,
      };

      setAttachments((prev) => {
        const onlyImages = prev.filter((a) => a.kind === 'image');
        prev.filter((a) => a.kind === 'pdf').forEach((a) => URL.revokeObjectURL(a.previewUrl));

        if (
          retakeTargetIndex !== null &&
          retakeTargetIndex >= 0 &&
          retakeTargetIndex < onlyImages.length
        ) {
          const next = [...onlyImages];
          URL.revokeObjectURL(next[retakeTargetIndex].previewUrl);
          next[retakeTargetIndex] = item;
          return next;
        }
        return [...onlyImages, item];
      });
      setRetakeTargetIndex(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'カメラからの撮影に失敗しました。');
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
    if (retakeTargetIndex === index) setRetakeTargetIndex(null);
  };

  const handleTriggerRetake = (index: number) => {
    if (isMobile) {
      setRetakeTargetIndex(index);
      mobileRetakeInputRef.current?.click();
    } else {
      setInputMode('camera');
      setRetakeTargetIndex(index);
    }
  };

  const handleEvent = useCallback(
    (event: ReviewProgressEvent) => {
      if (event.type === 'progress' && event.message) {
        setProgressSteps((prev) =>
          prev[prev.length - 1] === event.message ? prev : [...prev, event.message!]
        );
      } else if (event.type === 'clarification' && event.sessionId && event.message) {
        setClarification({
          sessionId: event.sessionId,
          question: event.message,
        });
        setIsGrading(false);
      } else if (event.type === 'completed' && event.review) {
        setLatestReview(event.review);
        if (event.state) onStateUpdated(event.state);
        setClarification(null);
        setReplyText('');
        setMemo('');
        setIsGrading(false);
        // Discard answer images only once grading succeeds
        clearAllAttachments();
      } else if (event.type === 'error') {
        // Retain attachments on error so user can retry immediately
        setErrorMessage(event.message ?? '添削中にエラーが発生しました。');
        setClarification(null);
        setIsGrading(false);
      }
    },
    [clearAllAttachments, onStateUpdated]
  );

  const handleStartReview = async () => {
    if (attachments.length === 0 || isGrading) return;
    if (!isOnline || !navigator.onLine) {
      setErrorMessage('通信できません。接続を確認して再試行してください。');
      return;
    }
    if (!hasApiKey) {
      setErrorMessage('Gemini APIキーが未設定です。設定画面からAPIキーを入力してください。');
      return;
    }

    stopCameraStream();
    setIsGrading(true);
    setErrorMessage(null);
    setProgressSteps(['答案を圧縮済みデータとして送信しています...']);
    setClarification(null);
    setLatestReview(null);

    await startReviewSession(attachments, memo.trim() || undefined, handleEvent);
  };

  const handleSendClarificationReply = async () => {
    if (!clarification || !replyText.trim() || isGrading) return;
    if (!isOnline || !navigator.onLine) {
      setErrorMessage('通信できません。接続を確認して再試行してください。');
      return;
    }
    const sessionId = clarification.sessionId;
    const answer = replyText.trim();
    setIsGrading(true);
    setErrorMessage(null);
    setProgressSteps((prev) => [...prev, `回答を送信しました: 「${answer}」`]);

    await replyToReviewSession(sessionId, answer, handleEvent);
  };

  const pdfAttachment = attachments.find((a) => a.kind === 'pdf');
  const imageAttachments = attachments.filter((a) => a.kind === 'image');

  return (
    <div className="space-y-5">
      {/* Answer Input Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">答案の提出</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              複数ページ撮影・長辺1600px JPEG自動圧縮・PDF（最大{maxPdfPages}ページ）対応
            </p>
          </div>

          {attachments.length > 0 && !isGrading && (
            <button
              type="button"
              onClick={() => {
                clearAllAttachments();
                clearAllSessions();
                setErrorMessage(null);
              }}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>すべて破棄</span>
            </button>
          )}
        </div>

        {!isOnline && (
          <div className="bg-slate-100 border border-slate-300 rounded-lg p-3 flex items-center gap-2 text-xs text-slate-800">
            <WifiOff className="w-4 h-4 text-slate-600 shrink-0" />
            <span>
              現在オフラインです。過去のノート・履歴の閲覧やPDF/Anki出力は可能ですが、新しい答案の添削にはインターネット接続が必要です。
            </span>
          </div>
        )}

        {!hasApiKey && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-700 shrink-0" />
              <span>添削の実行にはご自身の Gemini APIキー が必要です</span>
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              className="min-h-[40px] px-3 py-1.5 rounded bg-amber-800 text-white font-medium hover:bg-amber-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              設定を開く
            </button>
          </div>
        )}

        {/* Input Mode Segmented Toggle */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            disabled={isGrading}
            onClick={() => setInputMode('file')}
            className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              inputMode === 'file'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>ファイルから選ぶ</span>
          </button>
          <button
            type="button"
            disabled={isGrading}
            onClick={() => setInputMode('camera')}
            className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              inputMode === 'camera'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>カメラで撮影</span>
          </button>
        </div>

        {/* Mode 1: File Selection */}
        {inputMode === 'file' && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) void handleFilesAdded(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
              isDragging
                ? 'border-blue-800 bg-blue-50'
                : 'border-slate-300 hover:border-slate-400 bg-slate-50/60'
            }`}
          >
            <Upload className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-800">
              {attachments.length > 0
                ? '画像を追加選択（複数枚可）または PDF に差し替え'
                : '答案ファイル（画像複数可 / PDF）を選択またはドロップ'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              模範解答が一緒に写っている場合は自動で照合します
            </p>
          </div>
        )}

        {/* Mode 2: Camera Capture */}
        {inputMode === 'camera' && (
          <div className="space-y-3">
            {isMobile ? (
              <div className="border border-slate-200 rounded-lg p-5 bg-slate-50 text-center space-y-3">
                <Camera className="w-8 h-8 text-blue-900 mx-auto" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">背面カメラで撮影（スマホ）</p>
                  <p className="text-xs text-slate-500">
                    連続して複数ページを選択・撮影できます
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => mobileCameraInputRef.current?.click()}
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-blue-900 text-white text-sm font-semibold hover:bg-blue-950 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>カメラを起動して撮影</span>
                </button>
              </div>
            ) : cameraError ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3 text-xs text-amber-950">
                <p className="leading-relaxed">{cameraError}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setInputMode('file')}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 cursor-pointer"
                  >
                    ファイルから選ぶへ移動
                  </button>
                  <button
                    type="button"
                    onClick={() => void startPCCamera()}
                    className="min-h-[44px] px-4 py-2 rounded-lg border border-amber-300 bg-white text-amber-900 font-medium hover:bg-amber-100 cursor-pointer"
                  >
                    カメラを再試行
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-950">
                <div className="relative aspect-video bg-slate-900 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                  {!cameraReady && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300">
                      カメラを起動しています...
                    </div>
                  )}
                </div>
                <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-600">
                    {retakeTargetIndex !== null
                      ? `${retakeTargetIndex + 1}ページ目を撮り直し中`
                      : `撮影済み: ${imageAttachments.length}枚`}
                  </span>
                  <div className="flex items-center gap-2">
                    {retakeTargetIndex !== null && (
                      <button
                        type="button"
                        onClick={() => setRetakeTargetIndex(null)}
                        className="min-h-[44px] px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        撮り直し中止
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!cameraReady || isCompressing}
                      onClick={() => void handlePCCapture()}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 disabled:bg-slate-300 cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>
                        {retakeTargetIndex !== null ? 'この写真で差し替える' : '撮影する'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Hidden inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFilesAdded(e.target.files);
            e.currentTarget.value = '';
          }}
        />
        <input
          ref={mobileCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFilesAdded(e.target.files);
            e.currentTarget.value = '';
          }}
        />
        <input
          ref={mobileRetakeInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFilesAdded(e.target.files, retakeTargetIndex);
            e.currentTarget.value = '';
          }}
        />

        {isCompressing && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-900" />
            <span>画像を長辺1600pxのJPEGに最適化しています...</span>
          </div>
        )}

        {/* Thumbnails / PDF Preview */}
        {pdfAttachment && (
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
            <div className="px-3 py-2 bg-white border-b border-slate-200 flex items-center justify-between text-xs gap-2">
              <span className="flex items-center gap-2 font-medium text-slate-700 truncate">
                <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="truncate">{pdfAttachment.name}</span>
                {pdfAttachment.pageCount && (
                  <span className="text-slate-500 shrink-0 tabular-nums">
                    ({pdfAttachment.pageCount}ページ)
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={isGrading}
                onClick={() => handleRemoveAttachment(0)}
                className="min-h-[36px] px-2 text-slate-500 hover:text-red-700 cursor-pointer shrink-0 disabled:opacity-40"
              >
                削除
              </button>
            </div>
            <iframe
              src={pdfAttachment.previewUrl}
              title="答案PDFプレビュー"
              className="w-full h-[240px] bg-white"
            />
          </div>
        )}

        {imageAttachments.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700 tabular-nums">
              添付中の答案ページ（{imageAttachments.length}枚・撮影順に1つの答案として送信）
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {imageAttachments.map((img, idx) => (
                <div
                  key={img.id}
                  className={`border rounded-lg overflow-hidden bg-slate-50 ${
                    retakeTargetIndex === idx
                      ? 'border-blue-800 ring-2 ring-blue-200'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                    <img
                      src={img.previewUrl}
                      alt={`${idx + 1}ページ目`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-2 bg-white space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                      <span className="font-semibold text-slate-800">{idx + 1}ページ目</span>
                      <span>
                        {img.width}×{img.height}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1 text-[11px]">
                      <button
                        type="button"
                        disabled={isGrading}
                        onClick={() => handleTriggerRetake(idx)}
                        className="min-h-[36px] inline-flex items-center gap-1 text-blue-900 hover:underline font-medium cursor-pointer disabled:opacity-40"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>撮り直し</span>
                      </button>
                      <button
                        type="button"
                        disabled={isGrading}
                        onClick={() => handleRemoveAttachment(idx)}
                        className="min-h-[36px] inline-flex items-center gap-1 text-slate-500 hover:text-red-700 cursor-pointer disabled:opacity-40"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>削除</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Memo + Privacy Reminder + Send CTA */}
        {attachments.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div>
              <label htmlFor="answer-memo" className="block text-xs font-medium text-slate-700 mb-1">
                チューターへの補足メモ（任意）
              </label>
              <textarea
                id="answer-memo"
                rows={2}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                disabled={isGrading}
                placeholder="例: 大問2の(1)と(2)を見てください。模範解答は手元にありません。"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-transparent disabled:bg-slate-100"
              />
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-center gap-2 text-xs text-amber-900">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="font-medium">氏名欄や学校名が写っていないか確認してください</span>
            </div>

            <button
              type="button"
              onClick={() => void handleStartReview()}
              disabled={isGrading || isCompressing || Boolean(clarification)}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-900 text-white text-sm font-semibold hover:bg-blue-950 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isGrading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>添削を実行中...</span>
                </>
              ) : errorMessage ? (
                <span>同じ答案で再試行する（完了後に画像は自動破棄）</span>
              ) : (
                <span>添削を開始する（完了後に画像は自動破棄）</span>
              )}
            </button>
          </div>
        )}

        {/* Clarification Question Box */}
        {clarification && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <HelpCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-amber-900">チューターからの確認質問</div>
                <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">
                  {clarification.question}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {subjects.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setReplyText(sub)}
                  className="min-h-[36px] px-3 py-1 text-xs font-medium bg-white border border-amber-300 text-slate-700 hover:bg-amber-100 rounded-md cursor-pointer"
                >
                  {sub}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void handleSendClarificationReply();
                  }
                }}
                placeholder="回答を入力（例: 数学 / 覚えていなかった）"
                className="flex-1 min-h-[44px] rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
              />
              <button
                type="button"
                onClick={() => void handleSendClarificationReply()}
                disabled={!replyText.trim() || isGrading}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:bg-slate-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>回答する</span>
              </button>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 leading-relaxed">
            {errorMessage}
          </div>
        )}
      </section>

      {/* Live Progress / Structured Review Result */}
      <section className="space-y-4">
        {isGrading && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-900 animate-spin shrink-0" />
              <h2 className="text-base font-semibold text-slate-900">答案を添削しています</h2>
            </div>
            <ul className="space-y-2 border-t border-slate-100 pt-3">
              {progressSteps.map((step, i) => (
                <li key={i} className="text-sm text-slate-600 flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isGrading && latestReview && (
          <ReviewSheet
            review={latestReview}
            onJumpToKnowledge={onJumpToKnowledge}
            onJumpToTendency={onJumpToTendency}
          />
        )}

        {!isGrading && !latestReview && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">添削の仕組み</h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                答案を送信すると、チューターが過去の傾向と既存ノートを照合したうえで、誤りの原因を「知識不足」と「不注意」に切り分けて端末内の IndexedDB に記録します。
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1">
                <div className="text-xs font-semibold text-slate-900">知識不足 → 知識ノート</div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  公式・構文・単語などを覚えていなかった場合は単元フォルダごとに蓄積し、同じ項目の再誤答時はミス回数を加算します。
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1">
                <div className="text-xs font-semibold text-slate-900">不注意 → ミスの傾向</div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  符号ミスや写し間違いなどは科目をまたいで傾向ログ（計算・転記・読解・表記・最終確認）に記録します。
                </p>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3 text-xs text-slate-500">
              現在の登録科目: {subjects.join(' · ')}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
