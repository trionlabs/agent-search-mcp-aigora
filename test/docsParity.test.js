import { expect, it } from 'vitest';
import { verifyDocsParity } from '../scripts/docsParity.mjs';

it('the README and docs name every client install command', async () => {
  await expect(verifyDocsParity()).resolves.toBeUndefined();
});
