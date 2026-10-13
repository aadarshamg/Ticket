import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { getDummyPasswordHash, verifyHash } from '../lib/passwords';
import { ADMIN_COOKIE, adminCookieOptions, signAdminSession } from '../lib/session';
import { adminActor, requireAdmin, requireCsrf } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { createLoginLimiter } from '../middleware/rateLimit';

const loginSchema = z.object({
  email: z.string({ required_error: 'Enter your email' }).trim().toLowerCase().email('Enter a valid email').max(254),
  password: z.string({ required_error: 'Enter your password' }).min(1, 'Enter your password').max(200),
});

export function authRouter(): Router {
  const router = Router();

  router.post('/login', createLoginLimiter(), async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    const passwordOk = await verifyHash(password, admin?.passwordHash ?? (await getDummyPasswordHash()));
    if (!admin || !passwordOk) {
      await audit(prisma, { type: 'system', label: 'auth' }, 'admin.login_failed', undefined, { email });
      throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
    }

    const csrf = randomBytes(24).toString('base64url');
    const token = await signAdminSession({ adminId: admin.id, email: admin.email, name: admin.name, csrf });

    await prisma.$transaction([
      prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          actorType: 'admin',
          actorId: admin.id,
          actorLabel: admin.email,
          action: 'admin.login',
          entityType: 'AdminUser',
          entityId: admin.id,
        },
      }),
    ]);

    res.cookie(ADMIN_COOKIE, token, adminCookieOptions());
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name }, csrfToken: csrf });
  });

  router.get('/me', requireAdmin, (req, res) => {
    const session = req.admin!;
    res.json({
      admin: { id: session.adminId, email: session.email, name: session.name },
      csrfToken: session.csrf,
    });
  });

  router.post('/logout', requireAdmin, requireCsrf, async (req, res) => {
    const actor = adminActor(req);
    await audit(prisma, actor, 'admin.logout', { type: 'AdminUser', id: actor.id });
    const { maxAge: _maxAge, ...clearOptions } = adminCookieOptions();
    res.clearCookie(ADMIN_COOKIE, clearOptions);
    res.status(204).end();
  });

  return router;
}
