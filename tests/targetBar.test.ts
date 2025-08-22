import assert from 'assert';
import { withinTol, scanHasColor } from '../src/core/TargetBar';

export function runTests() {
  // withinTol
  assert.strictEqual(withinTol([255, 0, 0], [255, 0, 0], 0), true, 'exact red matches');
  assert.strictEqual(withinTol([250, 5, 5], [255, 0, 0], 6), true, 'near red within tol');
  assert.strictEqual(withinTol([240, 15, 15], [255, 0, 0], 6), false, 'farther than tol');

  // scanHasColor
  const width = 3, height = 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(0);
  const setPixel = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    const idx = (y * width + x) * 4;
    data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
  };
  setPixel(1, 1, 252, 3, 3);
  assert.strictEqual(scanHasColor(data, width, height, [255, 0, 0], 5), true, 'found near red with tol=5');
  assert.strictEqual(scanHasColor(data, width, height, [255, 0, 0], 1), false, 'not found with tol=1');

  console.log('TargetBar tests passed');
}
