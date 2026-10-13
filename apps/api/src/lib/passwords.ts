import bcrypt from 'bcrypt';

const PASSWORD_ROUNDS = 12;
/** Gate PINs are short and checked against every gate on login, so a lower cost. */
const PIN_ROUNDS = 10;

export const MIN_ADMIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_ROUNDS);
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_ROUNDS);
}

export function verifyHash(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | undefined;

/** A hash to compare against when the account does not exist, so timing does not reveal that. */
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('no-such-account-placeholder');
  return dummyHash;
}
