import { toPng, toJpeg, toSvg } from 'html-to-image';

const MAX_DIMENSION = 4096;
const CAPTURE_TIMEOUT = 10000;

export async function captureElement(element, options = {}) {
  const {
    format = 'png',
    quality = 0.92,
    pixelRatio = window.devicePixelRatio,
    backgroundColor = null
  } = options;

  validateElement(element);

  await document.fonts.ready;
  await waitForImages(element);

  const captureOptions = {
    cacheBust: true,
    pixelRatio,
    backgroundColor,
    filter: filterNode
  };

  const captureWithTimeout = (captureFn) => {
    return Promise.race([
      captureFn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Capture timed out')), CAPTURE_TIMEOUT)
      )
    ]);
  };

  switch (format) {
    case 'jpeg':
      captureOptions.quality = quality;
      captureOptions.backgroundColor = backgroundColor || '#ffffff';
      return captureWithTimeout(() => toJpeg(element, captureOptions));

    case 'svg':
      return captureWithTimeout(() => toSvg(element, captureOptions));

    case 'png':
    default:
      return captureWithTimeout(() => toPng(element, captureOptions));
  }
}

function validateElement(element) {
  if (!element) {
    throw new Error('No element provided');
  }

  const rect = element.getBoundingClientRect();
  if (rect.width > MAX_DIMENSION || rect.height > MAX_DIMENSION) {
    throw new Error(`Element too large (max ${MAX_DIMENSION}x${MAX_DIMENSION} pixels)`);
  }

  if (rect.width === 0 || rect.height === 0) {
    throw new Error('Element has no visible dimensions');
  }
}

function filterNode(node) {
  if (!(node instanceof Element)) {
    return true;
  }
  const tagName = node.tagName?.toUpperCase();
  if (tagName === 'SCRIPT' || tagName === 'NOSCRIPT') {
    return false;
  }
  return true;
}

async function waitForImages(element) {
  const images = Array.from(element.querySelectorAll('img'));
  if (images.length === 0) {
    return;
  }

  const imagePromises = images.map((img) => {
    if (img.complete && img.naturalHeight !== 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', () => {
        console.warn('Image failed to load:', img.src);
        resolve();
      }, { once: true });
      setTimeout(resolve, 5000);
    });
  });

  await Promise.all(imagePromises);
}

export function getFileExtension(format) {
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'svg':
      return 'svg';
    case 'png':
    default:
      return 'png';
  }
}

export function getMimeType(format) {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
    default:
      return 'image/png';
  }
}
