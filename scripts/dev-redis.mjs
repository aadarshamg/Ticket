// Starts a local Redis for development, if one is not already running.
//
// On Linux/macOS (or anywhere with Docker) use `docker compose up -d redis` instead.
// On Windows without Docker, unzip a portable Redis build into .tools/redis/ so that
// .tools/redis/redis-server.exe exists (see README), and this script will run it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 6379;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(root, '.tools', 'redis', process.platform === 'win32' ? 'redis-server.exe' : 'redis-server');

const alreadyRunning = await new Promise((resolve) => {
  const socket = net.connect(PORT, HOST);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => resolve(false));
});

if (alreadyRunning) {
  console.log(`Redis is already running on ${HOST}:${PORT}.`);
} else if (!existsSync(exe)) {
  console.log(
    `No Redis found on ${HOST}:${PORT} and none at ${path.relative(root, exe)}.\n` +
      'Start one with "docker compose up -d redis", or see README > Redis. WhatsApp sending will not work until then.',
  );
} else {
  // Local only, and nothing written to disk: this is a development queue.
  const child = spawn(exe, ['--bind', HOST, '--port', String(PORT), '--save', '', '--appendonly', 'no'], {
    cwd: path.dirname(exe),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`Redis started on ${HOST}:${PORT} (pid ${child.pid}).`);
  const stop = () => child.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}
