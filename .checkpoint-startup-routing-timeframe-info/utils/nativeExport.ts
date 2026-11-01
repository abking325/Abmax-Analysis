import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Converts a Blob to a base64 string.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Universal file export that seamlessly handles Android native save/share sheets
 * via Capacitor while preserving standard browser downloads on Web.
 */
export async function exportBlobOrDownload(
  blob: Blob,
  filename: string,
  mimeType: string = 'application/octet-stream',
  dialogTitle: string = 'Export File'
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const base64Data = await blobToBase64(blob);
      const writeResult = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
      });

      await Share.share({
        title: filename,
        files: [writeResult.uri],
        dialogTitle,
      });
      return;
    } catch (err) {
      console.warn('Native export failed, falling back to browser download:', err);
    }
  }

  // Standard Web Download fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Universal text/data export helper (e.g. for CSV or JSON backup).
 */
export async function exportTextOrDownload(
  content: string,
  filename: string,
  mimeType: string,
  dialogTitle: string = 'Export File'
): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  await exportBlobOrDownload(blob, filename, mimeType, dialogTitle);
}
