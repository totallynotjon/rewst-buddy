/**
 * Mocha-TDD-shaped aliases over vitest, so a suite migrated off the electron
 * runner keeps its `suite`/`test`/`setup`/`teardown` shape: the only edit a
 * migrated file needs is swapping `import * as Mocha from 'mocha'` (plus the
 * destructure) for `import { suite, test, setup, teardown } from '../test/tdd'`.
 *
 * Only files listed in vitest.suites.mjs may import this module — it resolves
 * `vitest`, which exists solely as a devDependency and is not bundled into the
 * extension or the electron test bundle.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';

export const suite = describe;
export const test = it;
export const setup = beforeEach;
export const teardown = afterEach;
export const suiteSetup = beforeAll;
export const suiteTeardown = afterAll;
