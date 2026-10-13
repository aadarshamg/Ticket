/**
 * Creates an organiser login, or resets the password of an existing one.
 *
 *   npm run create-admin -- --email you@example.com --name "Your Name"
 *
 * The password is read from ADMIN_PASSWORD if set, otherwise you are prompted.
 */
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { hashPassword, MIN_ADMIN_PASSWORD_LENGTH } from '../lib/passwords';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = z
    .string({ required_error: 'Pass --email you@example.com' })
    .trim()
    .toLowerCase()
    .email('--email is not a valid email address')
    .parse(arg('email'));
  const name = (arg('name') ?? email.split('@')[0] ?? 'Admin').trim();

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question(`Password for ${email} (min ${MIN_ADMIN_PASSWORD_LENGTH} characters): `);
    rl.close();
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);
  }

  const passwordHash = await hashPassword(password);
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  const admin = await prisma.adminUser.upsert({
    where: { email },
    create: { email, name, passwordHash },
    update: { passwordHash },
  });
  await audit(
    prisma,
    { type: 'system', label: 'create-admin script' },
    existing ? 'admin.password_reset' : 'admin.create',
    { type: 'AdminUser', id: admin.id },
    { email },
  );
  console.log(existing ? `Password reset for ${email}.` : `Admin ${email} created.`);
}

main()
  .catch((error) => {
    console.error(error instanceof z.ZodError ? error.issues.map((i) => i.message).join('\n') : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
