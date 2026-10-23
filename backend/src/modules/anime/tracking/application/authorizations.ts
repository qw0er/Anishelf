import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import { externalIdParts } from "../../../../shared/external-reference.js";
import type { TrackingCandidate, TrackingPreview } from "../domain/model.js";
import type { TrackingAccountProvider } from "../ports.js";
import type { TrackingConnectionState } from "./connection.js";

const candidateLifetime = 5 * 60_000;
export class TrackingAuthorizations {
	private readonly candidates = new Map<string, TrackingCandidate>();
	private readonly expiryTimers = new Set<ReturnType<typeof setTimeout>>();
	private readonly validations = new Map<string, string>();
	constructor(
		private readonly connection: TrackingConnectionState,
		private readonly provider: TrackingAccountProvider,
		private readonly now: () => number,
		private readonly logger: Logger | undefined,
	) {}
	get pendingCount(): number {
		return this.candidates.size;
	}
	get validationCount(): number {
		return this.validations.size;
	}
	require(
		sessionId: string,
		candidateId: string,
		generation: string,
	): TrackingCandidate {
		this.connection.assertCurrent(generation);
		const candidate = this.candidates.get(sessionId);
		if (
			!candidate ||
			candidate.id !== candidateId ||
			candidate.generation !== generation ||
			candidate.expiresAt <= this.now()
		)
			throw new DomainError(
				"TRACKING_CONFLICT",
				"Account preview expired or changed.",
			);
		return candidate;
	}
	async preview(
		sessionId: string,
		credential: string,
	): Promise<TrackingPreview> {
		this.connection.assertOpen();
		if (!credential || credential.length > 8192)
			throw new DomainError("INVALID_REQUEST", "Invalid access credential.");
		for (const [key, candidate] of this.candidates)
			if (candidate.expiresAt <= this.now()) this.candidates.delete(key);
		if (this.candidates.size + this.validations.size >= 100)
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"Too many pending account previews.",
			);
		const id = randomUUID();
		const generation = this.connection.status().generation;
		this.candidates.delete(sessionId);
		this.validations.set(sessionId, id);
		try {
			const account = await this.provider.viewer(
				credential,
				this.connection.signal,
			);
			this.connection.assertCurrent(generation);
			try {
				if (
					externalIdParts(account.id).provider !==
					this.connection.status().provider.key
				)
					throw new Error("Wrong provider.");
			} catch {
				throw new DomainError(
					"TRACKING_UNAVAILABLE",
					"Provider returned an invalid account identity.",
				);
			}
			if (this.validations.get(sessionId) !== id)
				throw new DomainError(
					"TRACKING_CONFLICT",
					"Account preview was replaced.",
				);
			const candidate: TrackingCandidate = {
				id,
				credential,
				account,
				generation,
				expiresAt: this.now() + candidateLifetime,
			};
			this.candidates.set(sessionId, candidate);
			const timer = setTimeout(() => {
				if (this.candidates.get(sessionId)?.id === id) {
					this.candidates.delete(sessionId);
					this.logger?.debug(
						{ event: "tracking.preview_expired", accountId: account.id },
						"Tracking account preview expired.",
					);
				}
				this.expiryTimers.delete(timer);
			}, candidateLifetime);
			timer.unref();
			this.expiryTimers.add(timer);
			this.logger?.info(
				{
					event: "tracking.account_previewed",
					accountId: account.id,
					expiresAt: candidate.expiresAt,
				},
				"Tracking account preview ready for confirmation.",
			);
			return {
				candidateId: id,
				account: { ...account },
				generation,
				expiresAt: candidate.expiresAt,
			};
		} finally {
			if (this.validations.get(sessionId) === id)
				this.validations.delete(sessionId);
		}
	}
	clear(): void {
		this.candidates.clear();
		for (const timer of this.expiryTimers) clearTimeout(timer);
		this.expiryTimers.clear();
		this.validations.clear();
	}
}
