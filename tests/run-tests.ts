import { runTests as runTargetBar } from './targetBar.test';
import { runTests as runCombat } from './combatState.test';

async function main() {
  try {
    runTargetBar();
    await runCombat();
    console.log('All tests passed');
    process.exit(0);
  } catch (e) {
    console.error('Tests failed:', (e as Error).message);
    process.exit(1);
  }
}

main();
