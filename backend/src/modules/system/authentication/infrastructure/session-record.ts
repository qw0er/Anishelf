export interface SessionRecord {
	id: string;
	expiresAt: number;
	authFingerprint?: string;
	authExpiresAt?: number;
	csrfToken?: string;
	cookie: {
		expires: string | null;
		originalMaxAge: number | null;
		originalExpires?: string;
		sameSite: string | null;
		secure: boolean | null;
		path: string;
		httpOnly: boolean;
		domain: string | null;
		partitioned?: boolean;
	};
}
