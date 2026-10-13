import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashQr, listMessage, signList } from '../../src/lib/offlineList';
import { signPass } from '../../src/lib/qr';

const passId = '3f1c2b9e-8a4d-4c6f-9b1a-2d3e4f5a6b7c';

/** Verifies exactly the way the scanner page does, with Web Crypto. */
async function verifyLikeTheBrowser(listId: string, generatedAt: string, hashes: string[], signature: string, jwk: webcrypto.JsonWebKey) {
  const key = await webcrypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(signature, 'base64url'),
    listMessage(listId, generatedAt, hashes),
  );
}

describe('hashQr', () => {
  it('is the first 12 bytes of SHA-256 of the QR text, in base64url', () => {
    const qr = signPass(passId);
    expect(hashQr(qr)).toBe(createHash('sha256').update(qr).digest().subarray(0, 12).toString('base64url'));
    expect(hashQr(qr)).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('differs for a forged signature on the same pass ID, so a fake cannot match the list', () => {
    const real = signPass(passId);
    const forged = `${passId}.AAAAAAAAAAAAAAAAAAAAAA`;
    expect(hashQr(forged)).not.toBe(hashQr(real));
    expect(hashQr(passId)).not.toBe(hashQr(real));
  });

  it('does not reveal the QR text', () => {
    const qr = signPass(passId);
    expect(hashQr(qr)).not.toContain(qr.split('.')[1]!.slice(0, 6));
  });
});

describe('signList', () => {
  const listId = 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5';
  const generatedAt = '2026-11-14T10:00:00.000Z';
  const hashes = ['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB', 'CCCCCCCCCCCCCCCC'];

  it('produces a signature the browser can verify with the published key', async () => {
    const { signature, publicKey } = signList(listId, generatedAt, hashes);
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64); // raw r|s
    expect(publicKey).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(publicKey).not.toHaveProperty('d'); // the private part is never sent
    expect(await verifyLikeTheBrowser(listId, generatedAt, hashes, signature, publicKey)).toBe(true);
  });

  it('fails verification if a pass is added, removed or reordered, or the header changes', async () => {
    const { signature, publicKey } = signList(listId, generatedAt, hashes);
    const check = (l: string, g: string, h: string[]) => verifyLikeTheBrowser(l, g, h, signature, publicKey);
    expect(await check(listId, generatedAt, [...hashes, 'DDDDDDDDDDDDDDDD'])).toBe(false);
    expect(await check(listId, generatedAt, hashes.slice(0, 2))).toBe(false);
    expect(await check(listId, generatedAt, [hashes[1]!, hashes[0]!, hashes[2]!])).toBe(false);
    expect(await check(listId, '2026-11-14T11:00:00.000Z', hashes)).toBe(false);
    expect(await check('b1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5', generatedAt, hashes)).toBe(false);
  });

  it('uses one stable key, so a stored list can be re-verified later', () => {
    expect(signList(listId, generatedAt, hashes).publicKey).toEqual(signList('x', 'y', []).publicKey);
  });

  it('signs an empty list too', async () => {
    const { signature, publicKey } = signList(listId, generatedAt, []);
    expect(await verifyLikeTheBrowser(listId, generatedAt, [], signature, publicKey)).toBe(true);
  });
});
