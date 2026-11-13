export interface DeviceSession {
	id: string;
	name: string;
	createdAt: number;
	expiresAt: number;
}

export interface AuthenticationStore {
	saveSession(id: string, data: string, expiresAt: number): void;
	readSession(id: string, now: number): string | undefined;
	deleteSession(id: string): void;
	clear(): void;
	saveDeviceSession(
		session: DeviceSession & { tokenHash: string; fingerprint: string },
	): void;
	readDeviceSession(
		tokenHash: string,
		fingerprint: string,
		now: number,
	): DeviceSession | undefined;
	listDeviceSessions(fingerprint: string, now: number): DeviceSession[];
	deleteDeviceSession(id: string): boolean;
	saveLink(link: {
		tokenHash: string;
		fileId: string;
		sourceVersion: string;
		fingerprint: string;
		expiresAt: number;
	}): void;
	readLink(
		tokenHash: string,
		now: number,
	): { fileId: string; sourceVersion: string; fingerprint: string } | undefined;
}
