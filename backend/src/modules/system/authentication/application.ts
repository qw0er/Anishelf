import { join } from "node:path";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import { authenticationFailure } from "./diagnostics.js";
import {
	type Credential,
	credentialFingerprint,
	hashPassword,
	normalizePassword,
	replaceCredential,
	verifyPassword,
} from "./infrastructure/credentials.js";

export class AuthenticationService {
	private credential: Credential;
	private currentFingerprint: string;
	private changing = false;
	constructor(
		private readonly dataDir: string,
		initial: Credential,
		private readonly logger: Logger,
	) {
		this.credential = initial;
		this.currentFingerprint = credentialFingerprint(initial);
	}
	get fingerprint() {
		return this.currentFingerprint;
	}
	async verify(password: string): Promise<boolean> {
		const expected = this.currentFingerprint;
		try {
			return (
				(await verifyPassword(password, this.credential)) &&
				expected === this.currentFingerprint
			);
		} catch (error) {
			this.logger.error(
				{
					event: "auth.password_verification_failed",
					operation: "verify_password",
					...authenticationFailure(error),
				},
				"Password verification failed.",
			);
			throw new Error("Password verification failed.");
		}
	}
	async change(currentPassword: string, password: string): Promise<void> {
		if (this.changing)
			throw new DomainError(
				"REQUEST_FORBIDDEN",
				"Password change already in progress.",
			);
		this.changing = true;
		try {
			const expected = this.currentFingerprint;
			if (
				!(await this.verify(currentPassword)) ||
				expected !== this.currentFingerprint
			)
				throw new DomainError("AUTH_REQUIRED", "Invalid password.");
			const normalized = normalizePassword(password);
			if ([...normalized].length < 8 || [...normalized].length > 128)
				throw new DomainError(
					"INVALID_REQUEST",
					"Password must contain 8–128 characters.",
				);
			const next = await hashPassword(normalized);
			try {
				await replaceCredential(this.dataDir, next);
			} catch (error) {
				this.logger.error(
					{
						event: "auth.credentials_write_failed",
						operation: "replace_credentials",
						path: join(this.dataDir, "auth.json"),
						...authenticationFailure(error),
					},
					"Could not save authentication credentials.",
				);
				throw new DomainError(
					"CONFIG_WRITE_FAILED",
					"Could not save authentication credentials.",
				);
			}
			this.credential = next;
			this.currentFingerprint = credentialFingerprint(next);
		} finally {
			this.changing = false;
		}
	}
}
