import type { Store } from "../../../../platform/database/store.js";
import * as s from "./schema.js";
import type { SessionRecord } from "./session-record.js";

export function readAuthSessions(
	_store: Store,
	row: typeof s.authSessions.$inferSelect,
): SessionRecord {
	return {
		id: row.id,
		expiresAt: row.expiresAt,
		...(row.authFingerprint !== null
			? {
					authFingerprint:
						row.authFingerprint !== null ? row.authFingerprint : undefined,
				}
			: {}),
		...(row.authExpiresAt !== null
			? {
					authExpiresAt:
						row.authExpiresAt !== null ? row.authExpiresAt : undefined,
				}
			: {}),
		...(row.csrfToken !== null
			? { csrfToken: row.csrfToken !== null ? row.csrfToken : undefined }
			: {}),
		cookie: {
			expires: row.cookieExpires,
			originalMaxAge: row.cookieOriginalMaxAge,
			...(row.cookieOriginalExpires !== null
				? {
						originalExpires:
							row.cookieOriginalExpires !== null
								? row.cookieOriginalExpires
								: undefined,
					}
				: {}),
			sameSite: row.cookieSameSite,
			secure: row.cookieSecure,
			path: row.cookiePath,
			httpOnly: row.cookieHttpOnly,
			domain: row.cookieDomain,
			...(row.cookiePartitioned !== null
				? {
						partitioned:
							row.cookiePartitioned !== null
								? row.cookiePartitioned
								: undefined,
					}
				: {}),
		},
	} as SessionRecord;
}

export function writeAuthSessions(
	connection: Store,
	value: SessionRecord,
): void {
	connection.transaction((store) => {
		const row0 = {
			id: value?.id,
			expiresAt: value?.expiresAt,
			authFingerprint: value?.authFingerprint ?? null,
			authExpiresAt: value?.authExpiresAt ?? null,
			csrfToken: value?.csrfToken ?? null,
			cookieExpires: value?.cookie?.expires ?? null,
			cookieOriginalMaxAge: value?.cookie?.originalMaxAge ?? null,
			cookieOriginalExpires: value?.cookie?.originalExpires ?? null,
			cookieSameSite: value?.cookie?.sameSite ?? null,
			cookieSecure: value?.cookie?.secure ?? null,
			cookiePath: value?.cookie?.path,
			cookieHttpOnly: value?.cookie?.httpOnly,
			cookieDomain: value?.cookie?.domain ?? null,
			cookiePartitioned: value?.cookie?.partitioned ?? null,
		};
		store
			.insert(s.authSessions)
			.values(row0)
			.onConflictDoUpdate({ target: s.authSessions.id, set: row0 })
			.run();
	});
}
