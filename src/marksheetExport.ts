
import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';

export type MarksheetImageFormat = 'png' | 'jpg';

export type MarksheetExportFormat = MarksheetImageFormat | 'pdf';

export interface MarksheetExportOptions {
  format: MarksheetExportFormat;
  quality?: number;
  pdfMode?: 'combined' | 'individual';
  onProgress?: (completed: number, total: number) => void;
  isCancelled?: () => boolean;
}

export interface MarksheetExportStudent {
  roll: string;
  name: string;
}

export interface MarksheetExportPage {
  html: string;
  student: MarksheetExportStudent;
}

const A4_WIDTH_MM = 210;
const SHEET_HEIGHT_MM = 296;
const DPI = 300;
const CSS_PIXELS_PER_INCH = 96;

const safeFilePart = (value: string): string => {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'student'
  );
};

const getFileName = (
  student: MarksheetExportStudent,
  extension: string
): string => {
  return `${safeFilePart(student.roll)}_${safeFilePart(student.name)}.${extension}`;
};

const waitForFrameReady = async (
  frame: HTMLIFrameElement
): Promise<void> => {
  const doc = frame.contentDocument;

  if (!doc) {
    throw new Error('Unable to access marksheet rendering document.');
  }

  if (doc.readyState !== 'complete') {
    await new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), {
        once: true,
      });
    });
  }

  try {
    await doc.fonts?.ready;
  } catch {
    // Continue if a custom font cannot be loaded.
  }

  await Promise.all(
    Array.from(doc.images).map((img) => {
      if (img.complete) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        const finish = () => resolve();

        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });

        window.setTimeout(finish, 10000);
      });
    })
  );
};

/**
 * Render the existing .sheet element from the supplied marksheet HTML.
 * This captures the actual template rather than recreating its design.
 */
const renderSheetCanvas = async (
  html: string
): Promise<HTMLCanvasElement> => {
  const frame = document.createElement('iframe');

  frame.setAttribute('aria-hidden', 'true');

  frame.style.cssText = `
    position: fixed;
    left: -12000px;
    top: 0;
    width: ${A4_WIDTH_MM}mm;
    height: ${SHEET_HEIGHT_MM}mm;
    border: 0;
    opacity: 0;
    pointer-events: none;
  `;

  document.body.appendChild(frame);

  try {
    const doc = frame.contentDocument;

    if (!doc) {
      throw new Error('Unable to create marksheet document.');
    }

    doc.open();
    doc.write(html);
    doc.close();

    await waitForFrameReady(frame);

    const sheet = doc.querySelector<HTMLElement>('.sheet');

    if (!sheet) {
      throw new Error(
        'The marksheet template does not contain a .sheet element.'
      );
    }

    return await toCanvas(sheet, {
      pixelRatio: DPI / CSS_PIXELS_PER_INCH,
      backgroundColor: '#ffffff',
      cacheBust: true,
      width: sheet.scrollWidth,
      height: sheet.scrollHeight,
      style: {
        margin: '0',
        boxShadow: 'none',
        transform: 'none',
      },
    });
  } finally {
    frame.remove();
  }
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  format: MarksheetImageFormat,
  quality: number
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Unable to encode marksheet image.'));
          return;
        }

        resolve(blob);
      },
      format === 'png' ? 'image/png' : 'image/jpeg',
      format === 'jpg' ? quality : undefined
    );
  });
};

const downloadBlob = (
  blob: Blob,
  filename: string
): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30000);
};

const createPdf = (
  imageData: string
): jsPDF => {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  pdf.addImage(
    imageData,
    'PNG',
    0,
    0,
    A4_WIDTH_MM,
    SHEET_HEIGHT_MM,
    undefined,
    'FAST'
  );

  return pdf;
};

/**
 * Export marksheets.
 *
 * Supported:
 * - One PNG/JPEG download
 * - Multiple PNG/JPEG files in ZIP
 * - One PDF download
 * - Multiple marksheets in one combined PDF
 * - Individual PDFs inside ZIP
 */
export async function exportMarksheets(
  pages: MarksheetExportPage[],
  options: MarksheetExportOptions
): Promise<void> {
  if (pages.length === 0) {
    throw new Error('No students selected for export.');
  }

  const quality = Math.min(
    1,
    Math.max(0.5, options.quality ?? 0.92)
  );

  const isPdf = options.format === 'pdf';
  const pdfMode = options.pdfMode ?? 'combined';

  const zip = new JSZip();

  const combinedPdf =
    isPdf && pdfMode === 'combined'
      ? new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
          compress: true,
        })
      : null;

  for (let index = 0; index < pages.length; index += 1) {
    if (options.isCancelled?.()) {
      throw new DOMException('Export cancelled.', 'AbortError');
    }

    const page = pages[index];

    const canvas = await renderSheetCanvas(page.html);

    try {
      if (options.isCancelled?.()) {
        throw new DOMException('Export cancelled.', 'AbortError');
      }

      if (isPdf) {
        const imageData = canvas.toDataURL('image/png');

        if (combinedPdf) {
          if (index > 0) {
            combinedPdf.addPage('a4', 'portrait');
          }

          combinedPdf.addImage(
            imageData,
            'PNG',
            0,
            0,
            A4_WIDTH_MM,
            SHEET_HEIGHT_MM,
            undefined,
            'FAST'
          );
        } else {
          const individualPdf = createPdf(imageData);

          zip.file(
            getFileName(page.student, 'pdf'),
            individualPdf.output('blob')
          );
        }
      } else {
        // Explicitly narrow the format before passing it to canvasToBlob.
        if (options.format !== 'png' && options.format !== 'jpg') {
          throw new Error('Invalid image export format.');
        }

        const blob = await canvasToBlob(
          canvas,
          options.format,
          quality
        );

        if (pages.length === 1) {
          downloadBlob(
            blob,
            getFileName(page.student, options.format)
          );
        } else {
          zip.file(
            getFileName(page.student, options.format),
            blob
          );
        }
      }
    } finally {
      // Release high-resolution canvas memory.
      canvas.width = 1;
      canvas.height = 1;
    }

    options.onProgress?.(index + 1, pages.length);
  }

  if (combinedPdf) {
    const filename =
      pages.length === 1
        ? getFileName(pages[0].student, 'pdf')
        : 'marksheets_combined.pdf';

    downloadBlob(combinedPdf.output('blob'), filename);
    return;
  }

  // A single image has already been downloaded directly.
  if (!isPdf && pages.length === 1) {
    return;
  }

  // Multiple images or individual PDFs are packaged into ZIP.
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 6,
    },
  });

  downloadBlob(zipBlob, 'marksheets.zip');
}
