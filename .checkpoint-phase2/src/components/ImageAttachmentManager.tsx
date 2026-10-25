import React, { useRef, useState } from 'react';
import { Plus, Trash2, Eye, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { ImageAttachment } from '../types/journal';
import { compressImageFile } from '../utils/analysisUtils';

interface ImageAttachmentManagerProps {
  attachments: ImageAttachment[];
  onChange: (attachments: ImageAttachment[]) => void;
  onViewImage: (url: string, title: string) => void;
  label?: string;
  readOnly?: boolean;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const ImageAttachmentManager: React.FC<ImageAttachmentManagerProps> = ({
  attachments = [],
  onChange,
  onViewImage,
  label = 'Attachments',
  readOnly = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of fileList) {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        errors.push(`"${file.name}" is unsupported. Only PNG, JPEG, and WebP are allowed.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push(`"${file.name}" exceeds the 10MB size limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
        continue;
      }
      validFiles.push(file);
    }

    if (errors.length > 0) {
      setErrorMessage(errors.join(' '));
    }

    if (validFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsProcessing(true);
    try {
      const newAttachments: ImageAttachment[] = [];
      for (const file of validFiles) {
        const compressedDataUrl = await compressImageFile(file, 2048, 2048, 0.88);
        const attachmentId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        newAttachments.push({
          id: attachmentId,
          dataUrl: compressedDataUrl,
          name: file.name,
          caption: '',
          createdAt: Date.now(),
        });
      }

      onChange([...attachments, ...newAttachments]);
    } catch (err) {
      console.error('Failed to process image attachment:', err);
      setErrorMessage('Failed to process selected image(s). Please try again.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = (id: string) => {
    onChange(attachments.filter((item) => item.id !== id));
    setDeleteConfirmId(null);
  };

  const handleCaptionChange = (id: string, caption: string) => {
    onChange(
      attachments.map((item) =>
        item.id === id ? { ...item, caption } : item
      )
    );
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-xs font-medium text-app-secondary flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-emerald-theme" />
          <span>{label}</span>
          {attachments.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-app-field border border-app text-app-main font-semibold">
              {attachments.length}
            </span>
          )}
        </label>

        {!readOnly && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => {
                setErrorMessage(null);
                fileInputRef.current?.click();
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-theme hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              <span>{isProcessing ? 'Processing...' : 'Add Image'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Validation / error banner */}
      {errorMessage && (
        <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 text-[11px] flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Thumbnails Grid */}
      {attachments.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
          {attachments.map((item, idx) => {
            const isDeleting = deleteConfirmId === item.id;
            return (
              <div
                key={item.id || idx}
                className="group relative border border-app rounded-md bg-app-field overflow-hidden flex flex-col shadow-2xs"
              >
                {/* Image thumbnail container */}
                <div className="relative aspect-video bg-black/5 dark:bg-black/30 overflow-hidden flex items-center justify-center">
                  <img
                    src={item.dataUrl}
                    alt={item.caption || item.name || `Attachment ${idx + 1}`}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />

                  {/* Quick actions overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-1">
                    <button
                      type="button"
                      onClick={() =>
                        onViewImage(
                          item.dataUrl,
                          item.caption || item.name || `Attachment ${idx + 1}`
                        )
                      }
                      className="p-1.5 bg-black/70 hover:bg-black text-white rounded-full transition-colors cursor-pointer"
                      title="View Fullscreen"
                      aria-label="View Fullscreen"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Caption / details footer */}
                <div className="p-1.5 space-y-1 bg-app-main border-t border-app flex-1 flex flex-col justify-between text-[11px]">
                  {!readOnly ? (
                    <input
                      type="text"
                      value={item.caption || ''}
                      onChange={(e) => handleCaptionChange(item.id, e.target.value)}
                      placeholder="Optional caption..."
                      className="w-full px-1.5 py-0.5 text-[11px] bg-app-field border border-app rounded text-app-main placeholder:text-app-secondary/60 focus:outline-hidden focus:border-emerald-600"
                    />
                  ) : item.caption ? (
                    <p className="text-[11px] font-medium text-app-main truncate" title={item.caption}>
                      {item.caption}
                    </p>
                  ) : (
                    <p className="text-[10px] text-app-secondary truncate italic">
                      {item.name || 'Chart Screenshot'}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        onViewImage(
                          item.dataUrl,
                          item.caption || item.name || `Attachment ${idx + 1}`
                        )
                      }
                      className="inline-flex items-center gap-1 text-[10px] text-emerald-theme hover:underline cursor-pointer"
                    >
                      <Eye className="w-2.5 h-2.5" />
                      View
                    </button>

                    {!readOnly && (
                      <div>
                        {isDeleting ? (
                          <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/60 p-0.5 rounded border border-rose-300">
                            <span className="text-[10px] text-rose-700 dark:text-rose-300">Remove?</span>
                            <button
                              type="button"
                              onClick={() => handleRemove(item.id)}
                              className="px-1 py-0.2 bg-rose-600 text-white rounded text-[9px] font-semibold"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-1 py-0.2 text-app-secondary text-[9px]"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(item.id)}
                            className="inline-flex items-center gap-0.5 text-[10px] text-rose-600 hover:text-rose-700 cursor-pointer"
                            title="Remove attachment"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
