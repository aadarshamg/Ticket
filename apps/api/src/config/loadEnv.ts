import path from 'node:path';
import dotenv from 'dotenv';

/** Loads the repo-root .env. Variables already set in the environment win. */
export function loadRootEnv(): void {
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
}
