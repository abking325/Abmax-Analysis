import React, { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react';

interface ImageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  title: string;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title,
}) => {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!isOpen) {
      setZoom(1);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => setZoom(1);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `${title.toLowerCase().replace(/\s+/g, '_')}_chart.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate pr-2">
            {title}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              title="Zoom out"
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-40"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              title="Reset zoom"
              className="px-2 py-1 text-xs font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              title="Zoom in"
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-40"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              title="Download image"
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1" />
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Image Display Area */}
        <div className="relative flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100 dark:bg-slate-950 min-h-[300px]">
          <img
            src={imageUrl}
            alt={title}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            className="max-w-full max-h-[72vh] object-contain transition-transform duration-150 select-none rounded shadow-xs"
          />
        </div>
      </div>
    </div>
  );
};
