import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPass, verifyQr } from '../../src/lib/qr';

const passId = '3f1c2b9e-8a4d-4c6f-9b1a-2d3e4f5a6b7c';

describe('pass QR signing', () => {
  it('produces "<passId>.<signature>" and verifies it', () => {
    const qr = signPass(passId);
    expect(qr.startsWith(`${passId}.`)).toBe(true);
    expect(verifyQr(qr)).toBe(passId);
  });

  it('signs with HMAC-SHA256 of the pass ID, truncated to 16 bytes, in base64url', () => {
    const expected = createHmac('sha256', process.env.QR_SECRET as string)
      .update(passId)
      .digest()
      .subarray(0, 16)
      .toString('base64url');
    const signature = signPass(passId).split('.')[1]!;
    expect(signature).toBe(expected);
    expect(Buffer.from(signature, 'base64url')).toHaveLength(16);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{22}$/); // URL-safe, no padding
  });

  it('is deterministic per pass and different between passes', () => {
    expect(signPass(passId)).toBe(signPass(passId));
    const other = randomUUID();
    expect(signPass(other).split('.')[1]).not.toBe(signPass(passId).split('.')[1]);
  });

  it('rejects a signature moved onto another pass ID', () => {
    const signature = signPass(passId).split('.')[1];
    expect(verifyQr(`${randomUUID()}.${signature}`)).toBeNull();
  });

  it('rejects any change to the signature', () => {
    const [id, signature] = signPass(passId).split('.') as [string, string];
    for (let i = 0; i < signature.length; i++) {
      const swapped = signature[i] === 'A' ? 'B' : 'A';
      const tampered = signature.slice(0, i) + swapped + signature.slice(i + 1);
      expect(verifyQr(`${id}.${tampered}`), `character ${i}`).toBeNull();
    }
    expect(verifyQr(`${id}.${signature.slice(0, -1)}`)).toBeNull();
    expect(verifyQr(`${id}.${signature}A`)).toBeNull();
  });

  it('rejects a signature made with a different secret', () => {
    const forged = createHmac('sha256', 'some-other-secret-0123456789-abcdefghij')
      .update(passId)
      .digest()
      .subarray(0, 16)
      .toString('base64url');
    expect(verifyQr(`${passId}.${forged}`)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    const inputs: unknown[] = [
      '',
      'hello',
      passId,
      `${passId}.`,
      `.${signPass(passId).split('.')[1]}`,
      `${passId.toUpperCase()}.${signPass(passId).split('.')[1]}`,
      `not-a-uuid.${signPass(passId).split('.')[1]}`,
      `${signPass(passId)}.extra`,
      'https://example.com/b/ABCDEFGHJKLM',
      'x'.repeat(5000),
      null,
      undefined,
      12345,
      { qr: signPass(passId) },
    ];
    for (const input of inputs) expect(verifyQr(input)).toBeNull();
  });

  it('fits comfortably in a small QR code', () => {
    expect(signPass(passId).length).toBe(59);
  });
});
