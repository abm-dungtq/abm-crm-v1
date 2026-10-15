export const IMAGE_MAX_BYTES = 1_000_000;
export const IMAGE_MAX_DIMENSION = 2048;
export const IMAGE_QUALITIES = [0.85, 0.75, 0.65, 0.55] as const;
export const IMAGE_SCALE_FACTOR = 0.75;
export const IMAGE_MIN_DIMENSION = 256;
export const IMAGE_DECODE_ERROR = 'Không đọc được ảnh này, hãy chọn ảnh JPG hoặc PNG';
export const IMAGE_TOO_LARGE_ERROR = 'Ảnh lớn hơn 1 MB sau khi nén, hãy chọn ảnh khác';

export interface CompressedImage {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  quality: number;
}

export interface DecodedImageHandle {
  width: number;
  height: number;
  encodeJpeg: (width: number, height: number, quality: number) => Promise<Blob>;
  close: () => void;
}

export type ImageDecoder = (file: Blob) => Promise<DecodedImageHandle>;

interface BrowserBitmap {
  width: number;
  height: number;
  close?: () => void;
}

interface BrowserImage {
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

interface BrowserCanvasContext {
  fillStyle: string;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  drawImage: (source: unknown, x: number, y: number, w: number, h: number) => void;
}

interface BrowserCanvas {
  width: number;
  height: number;
  getContext: (contextId: '2d') => BrowserCanvasContext | null;
  toBlob: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
}

interface BrowserGlobals {
  createImageBitmap?: (blob: Blob) => Promise<BrowserBitmap>;
  Image?: new () => BrowserImage;
  document?: {
    createElement: (tag: 'canvas') => BrowserCanvas;
  };
}

/** Replaces or appends a `.jpg` extension for the compressed JPEG upload. */
export function toJpgFilename(name?: string): string {
  const base = (name ?? '').trim().replace(/\.[^/.]+$/, '');
  return `${base || 'image'}.jpg`;
}

/** Scales `(width, height)` down so the longest side is at most `maxDimension` without upscaling. */
export function fitImageDimensions(
  width: number,
  height: number,
  maxDimension = IMAGE_MAX_DIMENSION,
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const longest = Math.max(safeW, safeH);
  if (longest <= maxDimension) {
    return { width: safeW, height: safeH };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  };
}

async function decodeImageSourceInBrowser(
  file: Blob,
  env: BrowserGlobals = globalThis as unknown as BrowserGlobals,
): Promise<{ source: unknown; width: number; height: number; close: () => void }> {
  if (typeof env.createImageBitmap === 'function') {
    try {
      const bitmap = await env.createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close?.(),
        };
      }
      bitmap.close?.();
    } catch {
      // Fall back to an <img> element when createImageBitmap rejects or is unsupported for this format.
    }
  }

  const ImageCtor = env.Image;
  if (typeof ImageCtor !== 'function' || typeof URL?.createObjectURL !== 'function') {
    throw new Error(IMAGE_DECODE_ERROR);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<BrowserImage>((resolve, reject) => {
      const el = new ImageCtor();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(IMAGE_DECODE_ERROR));
      el.src = objectUrl;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error(IMAGE_DECODE_ERROR);
    return {
      source: img,
      width,
      height,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error(IMAGE_DECODE_ERROR);
  }
}

export const browserImageDecoder: ImageDecoder = async (file: Blob): Promise<DecodedImageHandle> => {
  const env = globalThis as unknown as BrowserGlobals;
  const decoded = await decodeImageSourceInBrowser(file, env);
  let canvas: BrowserCanvas | null = null;
  let ctx: BrowserCanvasContext | null = null;
  let drawnW = 0;
  let drawnH = 0;

  return {
    width: decoded.width,
    height: decoded.height,
    encodeJpeg: async (width: number, height: number, quality: number): Promise<Blob> => {
      if (!env.document) throw new Error(IMAGE_DECODE_ERROR);
      if (!canvas || !ctx) {
        canvas = env.document.createElement('canvas');
        ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(IMAGE_DECODE_ERROR);
      }
      if (drawnW !== width || drawnH !== height) {
        canvas.width = width;
        canvas.height = height;
        // Fill opaque white so transparent PNGs flatten cleanly onto a white background.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(decoded.source, 0, 0, width, height);
        drawnW = width;
        drawnH = height;
      }
      const currentCanvas = canvas;
      return new Promise<Blob>((resolve, reject) => {
        currentCanvas.toBlob(
          (blob: Blob | null) => {
            if (blob) resolve(blob);
            else reject(new Error(IMAGE_DECODE_ERROR));
          },
          'image/jpeg',
          quality,
        );
      });
    },
    close: () => {
      decoded.close();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
  };
};

/**
 * Decodes `file` (`createImageBitmap` with `<img>` fallback), scales longest side to <= 2048 px,
 * draws onto a white-backed canvas, and exports JPEG starting at quality 0.85 -> 0.75 -> 0.65 -> 0.55,
 * scaling down dimensions further if needed until the result is at most 1,000,000 bytes.
 */
export async function compressImage(
  file: Blob | File,
  decode: ImageDecoder = browserImageDecoder,
): Promise<CompressedImage> {
  let handle: DecodedImageHandle;
  try {
    handle = await decode(file);
  } catch {
    throw new Error(IMAGE_DECODE_ERROR);
  }

  try {
    if (handle.width <= 0 || handle.height <= 0) {
      throw new Error(IMAGE_DECODE_ERROR);
    }

    const filename = toJpgFilename('name' in file && typeof file.name === 'string' ? file.name : undefined);
    let maxSide = Math.min(Math.max(handle.width, handle.height), IMAGE_MAX_DIMENSION);

    for (let scaleStep = 0; scaleStep < 8; scaleStep++) {
      const { width, height } = fitImageDimensions(handle.width, handle.height, maxSide);
      for (const quality of IMAGE_QUALITIES) {
        const blob = await handle.encodeJpeg(width, height, quality);
        if (blob.size <= IMAGE_MAX_BYTES) {
          return { blob, filename, width, height, quality };
        }
      }
      const currentLongest = Math.max(width, height);
      if (currentLongest <= IMAGE_MIN_DIMENSION) break;
      maxSide = Math.max(IMAGE_MIN_DIMENSION, Math.floor(currentLongest * IMAGE_SCALE_FACTOR));
    }

    throw new Error(IMAGE_TOO_LARGE_ERROR);
  } finally {
    handle.close();
  }
}
