/**
 * Gate load test: 50 scans a second for 2 minutes, each of a different valid pass,
 * spread over 25 scanner "phones". Target: 95% of scans answered in under 500 ms.
 *
 *   npm run seed                      # 3,000 demo bookings (about 9,300 passes)
 *   npm run loadtest                  # against http://localhost:4000
 *   npm run loadtest -- --url https://passes.example.com --rate 50 --duration 120
 *
 * It only runs against demo data (every order ID must start with DEMO-), because it marks
 * passes as used. When it finishes it puts those passes back and removes its own gate and
 * scan records, so it can be run again.
 */
import { randomInt, randomUUID } from 'node:crypto';
import autocannon from 'autocannon';
import { prisma } from '../db';
import { hashPin } from '../lib/passwords';
import { signPass } from '../lib/qr';

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
};

const url = arg('url', 'http://localhost:4000').replace(/\/$/, '');
const rate = Number(arg('rate', '50'));
const duration = Number(arg('duration', '120'));
const devices = Number(arg('devices', '25')); // each phone stays under the per-device scan limit
const targetP95 = Number(arg('p95', '500'));
const GATE_NAME = 'Load Test Gate';
const DEVICE_PREFIX = 'loadtest-';

interface Device {
  cookie: string;
  csrf: string;
}

/** Signs one "phone" in with the gate PIN, like a volunteer would. */
async function signIn(pin: string, deviceId: string): Promise<Device> {
  const res = await fetch(`${url}/api/auth/gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, deviceId }),
  });
  if (!res.ok) throw new Error(`Gate sign-in failed (${res.status}): ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ');
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return { cookie, csrf: csrfToken };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
}

async function main() {
  const total = rate * duration;
  console.log(`Target: ${url}   ${rate} scans/s for ${duration}s = ${total} scans over ${devices} devices`);

  // Safety: this marks passes used, so it must never touch real bookings.
  const realBookings = await prisma.ticket.count({ where: { NOT: { orderId: { startsWith: 'DEMO-' } } } });
  if (realBookings > 0) {
    throw new Error(`Refusing to run: ${realBookings} bookings are not demo data. Use a database seeded with "npm run seed".`);
  }
  const passes = await prisma.pass.findMany({
    where: { status: 'valid', ticket: { status: 'active' } },
    select: { id: true },
    take: total,
  });
  if (passes.length < total) {
    throw new Error(`Need ${total} valid passes but found ${passes.length}. Run "npm run seed", or lower --rate / --duration.`);
  }
  const passIds = passes.map((pass) => pass.id);
  const qrCodes = passIds.map((id) => signPass(id));

  const pin = String(randomInt(100_000, 1_000_000));
  await prisma.gate.deleteMany({ where: { name: GATE_NAME } });
  const gate = await prisma.gate.create({ data: { name: GATE_NAME, pinHash: await hashPin(pin) } });

  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  const results = new Map<string, number>();
  let next = 0;

  try {
    // The API caches the gate list for a few seconds; give it a moment to see the new gate.
    const sessions: Device[] = [];
    for (let i = 0; i < devices; i++) sessions.push(await signIn(pin, `${DEVICE_PREFIX}${i}`));
    console.log(`Signed in ${devices} devices. Scanning...`);

    let deviceIndex = 0;
    const run = await autocannon({
      url,
      connections: devices,
      duration,
      overallRate: rate,
      timeout: 30,
      setupClient: (client) => {
        const device = sessions[deviceIndex++ % sessions.length] as Device;
        client.setRequests([
          {
            method: 'POST',
            path: '/api/scan',
            headers: { 'Content-Type': 'application/json', Cookie: device.cookie, 'X-CSRF-Token': device.csrf },
            // A fresh, never-scanned pass for every request.
            setupRequest: (request) => ({
              ...request,
              body: JSON.stringify({ qr: qrCodes[next++ % qrCodes.length], clientRef: randomUUID() }),
            }),
          },
        ]);
        client.on('response', (statusCode, _bytes, responseTime) => {
          latencies.push(responseTime);
          statuses.set(statusCode, (statuses.get(statusCode) ?? 0) + 1);
        });
        client.on('body', (body) => {
          const match = /"result":"(\w+)"/.exec(body.toString());
          if (match) results.set(match[1] as string, (results.get(match[1] as string) ?? 0) + 1);
        });
      },
    });

    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const ok = statuses.get(200) ?? 0;
    const admitted = results.get('ok') ?? 0;
    const usedInDb = await prisma.pass.count({ where: { id: { in: passIds }, status: 'used' } });

    console.log('');
    console.log(`Requests answered: ${latencies.length}   (${(latencies.length / duration).toFixed(1)} per second achieved)`);
    console.log(`HTTP statuses:     ${[...statuses].map(([code, count]) => `${code} x${count}`).join(', ') || 'none'}`);
    console.log(`Scan results:      ${[...results].map(([name, count]) => `${name} x${count}`).join(', ') || 'none'}`);
    console.log(`Errors / timeouts: ${run.errors} / ${run.timeouts}`);
    console.log(`Latency (ms):      p50 ${Math.round(p50)}   p95 ${Math.round(p95)}   p99 ${Math.round(p99)}   max ${Math.round(latencies[latencies.length - 1] ?? 0)}`);
    console.log(`Passes marked used in the database: ${usedInDb} (scans answered "ok": ${admitted})`);
    console.log('');

    const problems: string[] = [];
    if (p95 >= targetP95) problems.push(`p95 was ${Math.round(p95)} ms; the target is under ${targetP95} ms`);
    if (ok !== latencies.length) problems.push(`${latencies.length - ok} requests did not return 200`);
    if (run.errors > 0 || run.timeouts > 0) problems.push(`${run.errors} errors and ${run.timeouts} timeouts`);
    if (latencies.length < total * 0.98) problems.push(`only ${latencies.length} of ${total} scans were completed`);
    // Scans still on their way when the clock ran out are recorded but their answers not counted.
    if (usedInDb < admitted || usedInDb > admitted + devices) {
      problems.push(`database shows ${usedInDb} used passes but ${admitted} scans said ok`);
    }

    if (problems.length === 0) {
      console.log(`PASS: p95 ${Math.round(p95)} ms is under ${targetP95} ms, and every scan was answered correctly.`);
    } else {
      console.log('FAIL:');
      for (const problem of problems) console.log(`  - ${problem}`);
      process.exitCode = 1;
    }
  } finally {
    // Put everything back the way it was.
    await prisma.pass.updateMany({ where: { id: { in: passIds } }, data: { status: 'valid', usedAt: null, usedGate: null } });
    await prisma.checkin.deleteMany({ where: { deviceId: { startsWith: DEVICE_PREFIX } } });
    await prisma.auditLog.deleteMany({ where: { actorLabel: { startsWith: `${GATE_NAME} / ${DEVICE_PREFIX}` } } });
    await prisma.gate.delete({ where: { id: gate.id } }).catch(() => undefined);
    console.log('Cleaned up: passes are valid again; the test gate and its scan records are removed.');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
