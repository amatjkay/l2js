import assert from 'assert';
import { CombatState } from '../src/spoiler/states/CombatState';

export async function runTests() {
  // Arrange: deps stub — alive twice, then dead
  let calls = 0;
  let pressed = 0;
  const deps = {
    checkAlive: async () => {
      calls++;
      return calls <= 2; // true, true, then false
    },
    pressAttack: async () => { pressed++; },
    attackIntervalMs: 0,
  };
  const cs = new CombatState(deps);

  // Dummy ctx with spoiled=true to check Sweep/Scan branch; we won't import SweepState
  const ctx: any = { spoiled: false };

  // Act & Assert: first execute -> alive -> stay in CombatState and press attack
  let st = await cs.execute(ctx);
  assert.ok(st instanceof CombatState, 'should remain in CombatState while alive');
  assert.ok(pressed >= 1, 'should press attack at least once');

  // Second execute -> still alive
  st = await (st as CombatState).execute(ctx);
  assert.ok(st instanceof CombatState, 'still in CombatState on second alive check');

  // Third execute -> dead -> transition to ScanState (since SweepState may be absent)
  const next = await (st as CombatState).execute(ctx);
  assert.ok(next && (next as any).name, 'should transition to another state');
  assert.notStrictEqual((next as any).name, 'CombatState', 'should leave CombatState when dead');

  console.log('CombatState tests passed');
}
