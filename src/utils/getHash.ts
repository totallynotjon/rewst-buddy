import * as crypto from 'crypto';

export function getHash(value: string, algorithm = 'sha256', encoding: crypto.BinaryToTextEncoding = 'hex'): string {
	return crypto.createHash(algorithm).update(value, 'utf8').digest(encoding);
}
