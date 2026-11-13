import { and, desc, eq, gt, lte, ne, or } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { AuthenticationStore } from "../ports.js";
import { readAuthSessions, writeAuthSessions } from "./records.js";
import { authSessions, deviceSessions, mediaAccessLinks } from "./schema.js";
import type { SessionRecord } from "./session-record.js";

const deviceFields = {
	id: deviceSessions.id,
	name: deviceSessions.name,
	createdAt: deviceSessions.createdAt,
	expiresAt: deviceSessions.expiresAt,
};

export class AuthenticationRepository implements AuthenticationStore {
	constructor(private readonly store: Store) {}

	saveSession(id: string, data: string, expiresAt: number) {
		this.store
			.delete(authSessions)
			.where(lte(authSessions.expiresAt, Date.now()))
			.run();
		const value = JSON.parse(data) as Omit<SessionRecord, "id" | "expiresAt">;
		writeAuthSessions(this.store, { ...value, id, expiresAt });
	}
	readSession(id: string, now: number) {
		const row = this.store
			.select()
			.from(authSessions)
			.where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, now)))
			.get();
		if (!row) return undefined;
		const {
			id: _id,
			expiresAt: _expiresAt,
			...value
		} = readAuthSessions(this.store, row);
		return JSON.stringify(value);
	}

	deleteSession(id: string) {
		this.store.delete(authSessions).where(eq(authSessions.id, id)).run();
	}
	clear() {
		this.store.transaction((tx) => {
			tx.delete(authSessions).run();
			tx.delete(deviceSessions).run();
			tx.delete(mediaAccessLinks).run();
		});
	}
	saveDeviceSession(
		session: Parameters<AuthenticationStore["saveDeviceSession"]>[0],
	) {
		this.store.transaction((tx) => {
			tx.delete(deviceSessions)
				.where(
					or(
						lte(deviceSessions.expiresAt, session.createdAt),
						ne(deviceSessions.fingerprint, session.fingerprint),
					),
				)
				.run();
			tx.insert(deviceSessions).values(session).run();
		});
	}
	readDeviceSession(tokenHash: string, fingerprint: string, now: number) {
		return this.store
			.select(deviceFields)
			.from(deviceSessions)
			.where(
				and(
					eq(deviceSessions.tokenHash, tokenHash),
					eq(deviceSessions.fingerprint, fingerprint),
					gt(deviceSessions.expiresAt, now),
				),
			)
			.get();
	}
	listDeviceSessions(fingerprint: string, now: number) {
		return this.store
			.select(deviceFields)
			.from(deviceSessions)
			.where(
				and(
					eq(deviceSessions.fingerprint, fingerprint),
					gt(deviceSessions.expiresAt, now),
				),
			)
			.orderBy(desc(deviceSessions.createdAt), deviceSessions.id)
			.all();
	}
	deleteDeviceSession(id: string) {
		return (
			this.store.delete(deviceSessions).where(eq(deviceSessions.id, id)).run()
				.changes > 0
		);
	}
	saveLink(link: Parameters<AuthenticationStore["saveLink"]>[0]) {
		this.store
			.delete(mediaAccessLinks)
			.where(lte(mediaAccessLinks.expiresAt, Date.now()))
			.run();
		this.store.insert(mediaAccessLinks).values(link).run();
	}
	readLink(tokenHash: string, now: number) {
		return this.store
			.select()
			.from(mediaAccessLinks)
			.where(
				and(
					eq(mediaAccessLinks.tokenHash, tokenHash),
					gt(mediaAccessLinks.expiresAt, now),
				),
			)
			.get();
	}
}
