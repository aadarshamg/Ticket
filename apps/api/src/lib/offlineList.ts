import { createECDH, createHash, createPrivateKey, hkdfSync, sign, type KeyObject } from 'node:crypto';
import { env } from '../config/env';

// The offline list lets a scanner check passes with no connection. It holds a short hash of
// each valid pass's QR text, not the QR text itself: a phone can recognise a real pass, but
// the list cannot be turned back into working QR codes.
//
// The list is signed with ECDSA P-256 so the phone can check it is complete and unaltered
// (Web Crypto verifies this natively). The key pair is derived from QR_SECRET, so there is
// no extra secret to manage; rotating QR_SECRET rotates this key too.

const HASH_BYTES = 12; // 96 bits: collisions are not a practical concern at any event size

/** Short hash of a pass's full QR text. The scanner computes the same value from what it scans. */
export function hashQr(qr: string): string {
  return createHash('sha256').update(qr).digest().subarray(0, HASH_BYTES).toString('base64url');
}

export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

let cached: { privateKey: KeyObject; publicJwk: PublicJwk } | undefined;

function signingKeys() {
  if (cached) return cached;
  // A P-256 private key is any number from 1 to n-1. An HKDF output is out of that range
  // about once in 2^32 tries; if so, derive again with the next counter.
  for (let counter = 0; ; counter++) {
    const seed = Buffer.from(hkdfSync('sha256', env.QR_SECRET, 'ticketing', `offline-list-signing-v1:${counter}`, 32));
    try {
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(seed);
      const point = ecdh.getPublicKey(); // 0x04 | X (32 bytes) | Y (32 bytes)
      const publicJwk: PublicJwk = {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33, 65).toString('base64url'),
      };
      const privateKey = createPrivateKey({ key: { ...publicJwk, d: seed.toString('base64url') }, format: 'jwk' });
      cached = { privateKey, publicJwk };
      return cached;
    } catch {
      if (counter > 8) throw new Error('Could not derive the offline-list signing key');
    }
  }
}

/** The exact bytes that are signed. The scanner rebuilds this from the list it received. */
export function listMessage(listId: string, generatedAt: string, hashes: string[]): Buffer {
  const digest = createHash('sha256').update(hashes.join('\n')).digest('base64url');
  return Buffer.from(`ticketing-offline-list-v1\n${listId}\n${generatedAt}\n${hashes.length}\n${digest}`);
}

/** Signs a list. The signature is 64 raw bytes (r | s), the format Web Crypto expects. */
export function signList(listId: string, generatedAt: string, hashes: string[]): { signature: string; publicKey: PublicJwk } {
  const { privateKey, publicJwk } = signingKeys();
  const signature = sign('sha256', listMessage(listId, generatedAt, hashes), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return { signature: signature.toString('base64url'), publicKey: publicJwk };
}
