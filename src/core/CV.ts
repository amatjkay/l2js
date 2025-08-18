// Lazy-load OpenCV.js with fallbacks to avoid worker/threading crashes in Node environment
// We avoid top-level import to prevent immediate initialisation that may spawn Worker.
export type CV = any;

let resolvedCV: any | null = null;
let loadTried = false;

async function loadCv(): Promise<any> {
  // Prefer explicit dist build which exports a factory function
  try {
    const mod: any = await import('@techstark/opencv-js/dist/opencv.js');
    const factory = mod?.default ?? mod;
    if (typeof factory === 'function') {
      return await factory();
    }
    return factory;
  } catch (eDist) {
    // Fallback: package root
    try {
      const root: any = await import('@techstark/opencv-js');
      const anyRoot = root?.default ?? root;
      if (typeof anyRoot === 'function') return await anyRoot();
      return anyRoot;
    } catch (eRoot) {
      // Last resort: require
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const req = require('@techstark/opencv-js/dist/opencv.js');
        if (typeof req === 'function') return await req();
        return req && (req.default || req);
      } catch (eReq) {
        const err = new Error('Failed to load @techstark/opencv-js (dist/opencv.js and root)');
        (err as any).details = { eDist: String(eDist), eRoot: String(eRoot), eReq: String(eReq) };
        throw err;
      }
    }
  }
}

export async function initCV(log?: (m: string) => void): Promise<CV> {
  if (!resolvedCV) {
    if (!loadTried) {
      loadTried = true;
      // Load the module
      resolvedCV = await loadCv();
    }
    const anyCv = resolvedCV as any;
    // OpenCV.js initialises asynchronously. It may expose cv.ready (Promise) or onRuntimeInitialized (callback).
    let wasPromise = false;
    await new Promise<void>((resolve) => {
      // Case 1: Promise on the cv object itself
      if (typeof anyCv.then === 'function') {
        wasPromise = true;
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
    // If module was a Promise-like, replace with resolved actual cv object
    if (wasPromise) {
      resolvedCV = await (resolvedCV as any);
    }
    // Validate and fix common nesting cases
    let actual = resolvedCV as any;
    // Some bundles export a factory function returning a Module
    if (typeof actual === 'function') {
      try {
        actual = await actual();
      } catch {
        // ignore
      }
    }
    if (!(actual && typeof actual.Mat === 'function')) {
      if (actual && actual.cv && typeof actual.cv.Mat === 'function') {
        actual = actual.cv;
      } else if (actual && actual.default && typeof actual.default.Mat === 'function') {
        actual = actual.default;
      }
      resolvedCV = actual;
    }
  }

  const actual = resolvedCV as any;
  if (log) {
    try {
      const matInfo = typeof actual?.Mat;
      log(`OpenCV.js initialised. Version: ${actual.version ?? 'unknown'}; Mat type: ${matInfo}`);
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
