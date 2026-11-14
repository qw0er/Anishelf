import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { DeviceSession } from "./ports.js";
import { opaqueTokenPattern, readBearerToken, safeEqual } from "./tokens.js";

export function createLocalDeviceSession(token: string, logger: Logger) {
	if (!opaqueTokenPattern.test(token))
		throw new Error("Invalid local device credential.");

	const session: DeviceSession = {
		id: randomUUID(),
		name: "Anishelf Desktop",
		createdAt: Date.now(),
		// This in-memory session lasts until the backend instance stops.
		expiresAt: 8_640_000_000_000_000,
	};
	logger.info(
		{ event: "auth.local_device_session_created", deviceId: session.id },
		"Local desktop device session created.",
	);
	return {
		authenticate(authorization: string): DeviceSession | undefined {
			const presented = readBearerToken(authorization);
			if (presented && safeEqual(presented, token)) return session;
		},
	};
}
