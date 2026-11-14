import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
export const opaqueTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createToken(): string {
	return randomBytes(32).toString("base64url");
}

export function readBearerToken(authorization: string): string | undefined {
	return /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization)?.[1];
}

export function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
	return timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
}
