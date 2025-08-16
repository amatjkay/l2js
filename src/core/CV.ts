import cv from '@techstark/opencv-js';
export type CV = typeof cv;

let resolvedCV: any | null = null;

export async function initCV(log?: (m: string) => void): Promise<CV> {
  // OpenCV.js initialises asynchronously. It may expose cv.ready (Promise) or onRuntimeInitialized (callback).
  const anyCv = cv as any;
  await new Promise<void>((resolve) => {
    // Case 1: Promise on the cv object itself
    if (typeof anyCv.then === 'function') {
      anyCv.then(() => resolve());
      return;
    }

    // Case 2: ready Promise (some builds expose it)
    if (anyCv.ready && typeof anyCv.ready.then === 'function') {
      anyCv.ready.then(() => resolve());
      return;
    }

    // Case 3: callback onRuntimeInitialized
    if (typeof anyCv.onRuntimeInitialized === 'function') {
      const prev = anyCv.onRuntimeInitialized;
      anyCv.onRuntimeInitialized = () => {
        try { prev(); } catch {}
        resolve();
      };
      return;
    }

    // Fallback: assume already initialised or resolve next tick
    setImmediate(() => resolve());
  });

  // After initialisation, if it's a Promise-like, resolve to the actual cv object
  const actual = (typeof anyCv.then === 'function') ? await anyCv : anyCv;
  resolvedCV = actual;

  if (log) {
    try {
      log(`OpenCV.js initialised. Version: ${actual.version ?? 'unknown'}`);
    } catch {
      // ignore logging errors
    }
  }
  return actual as CV;
}

export function getCV(): CV {
  if (!resolvedCV) {
    throw new Error('OpenCV.js is not initialised. Call initCV() first.');
  }
  return resolvedCV as CV;
}
