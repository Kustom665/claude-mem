import { coreutils } from './coreutils.ts';
import { procutils } from './procutils.ts';
import { agentPrograms } from './agent.ts';
import { memutils } from './memutils.ts';
import { cron } from './cron.ts';
import { init } from './init.ts';
import { sh } from '../shell/sh.ts';
import type { Program } from '../kernel/types.ts';

/** Everything installed into /bin at boot. */
export const allPrograms: Program[] = [
  init,
  sh,
  ...coreutils,
  ...procutils,
  ...agentPrograms,
  ...memutils,
  cron,
];

export { init, sh, cron };
export * from './coreutils.ts';
export * from './procutils.ts';
export * from './agent.ts';
export * from './memutils.ts';
