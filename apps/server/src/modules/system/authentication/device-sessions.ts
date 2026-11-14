import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type { AuthenticationService } from "./application.js";
import { authenticationFailure } from "./diagnostics.js";
import type { AuthenticationStore } from "./ports.js";
import {
	createToken,
	digest,
	readBearerToken,
	sessionLifetime,
} from "./tokens.js";

export function createDeviceSessions(
	service: AuthenticationService,
	store: AuthenticationStore,
	logger: Logger,
) {
	function deviceStore<T>(operation: string, run: () => T): T {
		try {
			return run();
		} catch (error) {
			logger.error(
				{
					event: "auth.device_store_failed",
					operation,
					...authenticationFailure(error),
				},
				"Device session storage failed.",
			);
			throw new Error("Device session storage failed.");
		}
	}
	return {
		create(name: string, fingerprint: string) {
			if (fingerprint !== service.fingerprint)
				throw new DomainError("AUTH_REQUIRED", "Sign in again.");
			const token = createToken();
			const createdAt = Date.now();
			const device = {
				id: randomUUID(),
				name,
				createdAt,
				expiresAt: createdAt + sessionLifetime,
			};
			deviceStore("save", () =>
				store.saveDeviceSession({
					...device,
					tokenHash: digest(token),
					fingerprint,
				}),
			);
			return { token, session: device };
		},
		authenticate(authorization: string) {
			const token = readBearerToken(authorization);
			if (!token) return undefined;
			return deviceStore("read", () =>
				store.readDeviceSession(digest(token), service.fingerprint, Date.now()),
			);
		},
		list() {
			return deviceStore("list", () =>
				store.listDeviceSessions(service.fingerprint, Date.now()),
			);
		},
		revoke(id: string) {
			return deviceStore("delete", () => store.deleteDeviceSession(id));
		},
	};
}
