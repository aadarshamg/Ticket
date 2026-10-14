// Starts the whole system in ONE container: the API (with the WhatsApp send worker) on an
// internal port and the web app on the public port. Used by the root Dockerfile, for hosts
// whose free plan allows a single always-on service (see README > Deployment > Option A).
//
// If either process stops, this stops the other and exits, so the host restarts the container
// instead of leaving half the system running.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicPort = process.env.PORT || '3000';
const apiPort = process.env.API_PORT || '4000';

function start(name, args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    console.error(`[start] ${name} stopped (${signal ?? `exit code ${code}`}); stopping everything.`);
    shutdown(code ?? 1);
  });
  return child;
}

const children = [];
let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 10_000).unref();
  Promise.all(children.map((child) => new Promise((resolve) => (child.exitCode !== null ? resolve() : child.on('exit', resolve))))).then(
    () => process.exit(code),
  );
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// 1. Database migrations, before anything takes traffic.
const migrate = spawn(process.execPath, ['dist/scripts/migrate.js'], {
  cwd: path.join(root, 'apps/api'),
  stdio: 'inherit',
});
migrate.on('exit', (code) => {
  if (code !== 0) {
    console.error('[start] Database migration failed; not starting.');
    process.exit(code ?? 1);
  }
  // 2. The API, reachable only inside the container.
  children.push(start('api', ['dist/index.js'], path.join(root, 'apps/api'), { PORT: apiPort }));
  // 3. The web app on the public port; it forwards /api/* to the API above.
  children.push(
    start('web', ['apps/web/server.js'], path.join(root, 'web'), {
      PORT: publicPort,
      HOSTNAME: '0.0.0.0',
      API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
    }),
  );
});
