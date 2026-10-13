import { timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import { env } from '../config/env';
import { handleWebhookPayload, verifyWebhookSignature } from '../services/webhook';

function sameString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Meta WhatsApp webhook. Mounted before the JSON body parser, because the signature is
 * computed over the exact bytes Meta sent.
 */
export function webhookRouter(): Router {
  const router = Router();

  // Verification handshake when the webhook is registered in the Meta dashboard.
  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (
      env.WA_VERIFY_TOKEN &&
      mode === 'subscribe' &&
      typeof token === 'string' &&
      typeof challenge === 'string' &&
      sameString(token, env.WA_VERIFY_TOKEN)
    ) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.status(403).json({ error: { code: 'forbidden', message: 'Verification failed' } });
  });

  // Delivery reports: sent / delivered / read / failed.
  router.post('/', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
    if (!env.WA_APP_SECRET) {
      res.status(503).json({ error: { code: 'not_configured', message: 'WA_APP_SECRET is not set' } });
      return;
    }
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyWebhookSignature(rawBody, req.get('x-hub-signature-256'), env.WA_APP_SECRET)) {
      res.status(401).json({ error: { code: 'bad_signature', message: 'Signature check failed' } });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: { code: 'invalid_json', message: 'Body is not valid JSON' } });
      return;
    }
    // If the database is down this throws and Meta retries the delivery later.
    await handleWebhookPayload(payload);
    res.sendStatus(200);
  });

  return router;
}
