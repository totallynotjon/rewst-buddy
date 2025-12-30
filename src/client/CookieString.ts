import { RegionConfig } from './RegionConfig';

export default class CookieString {
	constructor(public readonly value: string) {}

	static fromToken(token: string, config: RegionConfig): CookieString {
		return new CookieString(`${config.cookieName}=${token}`);
	}
}
