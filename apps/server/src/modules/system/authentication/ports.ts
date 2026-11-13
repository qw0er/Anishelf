export interface AuthenticationStore {
	saveSession(id: string, data: string, expiresAt: number): void;
	readSession(id: string, now: number): string | undefined;
	deleteSession(id: string): void;
	clear(): void;
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
