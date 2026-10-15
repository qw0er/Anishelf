import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import { type AniListClient, AniListError } from "../anilist/public.js";
import type {
	TrackingAccount,
	TrackingConnection,
	TrackingStatus,
} from "./domain/model.js";
import type { TrackingCredentials, TrackingStore } from "./ports.js";
import type { TrackingApi } from "./public.js";

const clientId = "53902";
const candidateLifetime = 5 * 60_000;
interface Candidate {
	id: string;
	token: string;
	account: TrackingAccount;
	expiresAt: number;
	generation: string;
}
export class TrackingApplication implements TrackingApi {
	private readonly logger: Logger | undefined;
	private connection: TrackingConnection;
	private connectivity: TrackingStatus["connectivity"] = "unknown";
	private readonly candidates = new Map<string, Candidate>();
	private readonly expiryTimers = new Set<ReturnType<typeof setTimeout>>();
	private checkSequence = 0;
	private readonly validations = new Map<string, string>();
	private readonly lifetime = new AbortController();
	private accountLifetime = new AbortController();
	private tail: Promise<unknown> = Promise.resolve();
	constructor(
		private readonly options: {
			store: TrackingStore;
			credentials: TrackingCredentials;
			client: AniListClient;
			now?: () => number;
			logger?: Logger;
		},
	) {
		this.logger = options.logger?.child({ module: "tracking" });
		this.connection = options.store.get() ?? {
			generation: randomUUID(),
			account: null,
			credentialId: null,
			state: "disconnected",
			checkedAt: null,
		};
		if (!options.store.get()) options.store.save(this.connection);
	}
	async initialize() {
		if (this.connection.credentialId) {
			try {
				await this.options.credentials.read(this.connection);
			} catch {
				this.connection = {
					...this.connection,
					state: "authorization-required",
				};
				this.options.store.save(this.connection);
				this.logger?.warn(
					{ event: "tracking.authorization_required", phase: "startup" },
					"AniList credential is missing or invalid; reconnect required.",
				);
			}
		}
	}
	status(): TrackingStatus {
		return {
			clientId,
			authorizationUrl: `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`,
			generation: this.connection.generation,
			account: this.connection.account ? { ...this.connection.account } : null,
			state: this.connection.state,
			connectivity: this.connectivity,
			checkedAt: this.connection.checkedAt,
		};
	}
	preview(sessionId: string, token: string) {
		return this.observeOperation("preview", () =>
			this.previewAccount(sessionId, token),
		);
	}
	confirm(sessionId: string, candidateId: string, generation: string) {
		return this.observeOperation("confirm", () =>
			this.confirmAccount(sessionId, candidateId, generation),
		);
	}
	disconnect(generation: string) {
		return this.observeOperation("disconnect", () =>
			this.disconnectAccount(generation),
		);
	}
	check() {
		return this.observeOperation("check", () => this.checkAccount());
	}
	private async observeOperation<T extends { account: TrackingAccount | null }>(
		operation: "preview" | "confirm" | "disconnect" | "check",
		action: () => Promise<T>,
	): Promise<T> {
		const startedAt = Date.now();
		this.logger?.debug(
			{
				event: "tracking.operation_started",
				operation,
				generation: this.connection.generation,
			},
			"AniList account operation started.",
		);
		try {
			const result = await action();
			this.logger?.debug(
				{
					event: "tracking.operation_succeeded",
					operation,
					accountId: result.account?.id,
					generation: this.connection.generation,
					durationMs: Date.now() - startedAt,
				},
				"AniList account operation completed.",
			);
			return result;
		} catch (error) {
			const context = {
				operation,
				generation: this.connection.generation,
				code: error instanceof DomainError ? error.code : "INTERNAL_ERROR",
				durationMs: Date.now() - startedAt,
			};
			if (this.lifetime.signal.aborted)
				this.logger?.debug(
					{
						event: "tracking.operation_cancelled",
						...context,
						reason: "shutdown",
					},
					"AniList account operation cancelled.",
				);
			else if (
				error instanceof DomainError &&
				["TRACKING_CONFLICT", "INVALID_REQUEST"].includes(error.code)
			)
				this.logger?.debug(
					{ event: "tracking.operation_rejected", ...context },
					"AniList account operation rejected.",
				);
			else
				this.logger?.warn(
					{ event: "tracking.operation_failed", ...context },
					"AniList account operation failed.",
				);
			throw error;
		}
	}
	private async removeCredential(
		id: string,
		phase: "rollback" | "replacement" | "disconnect",
	) {
		try {
			await this.options.credentials.remove(id);
		} catch {
			this.logger?.warn(
				{ event: "tracking.credential_cleanup_failed", phase },
				"AniList credential cleanup failed.",
			);
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"Credential cleanup failed.",
			);
		}
	}
	private clearCandidates() {
		this.candidates.clear();
		for (const timer of this.expiryTimers) clearTimeout(timer);
		this.expiryTimers.clear();
	}
	private now() {
		return (this.options.now ?? Date.now)();
	}
	private assertOpen() {
		if (this.lifetime.signal.aborted)
			throw new DomainError("TRACKING_UNAVAILABLE", "Tracking is stopped.");
	}
	private assertGeneration(generation: string) {
		this.assertOpen();
		if (this.connection.generation !== generation)
			throw new DomainError(
				"TRACKING_CONFLICT",
				"AniList connection changed. Retry.",
			);
	}
	private async viewer(
		token: string,
		signal: AbortSignal,
	): Promise<TrackingAccount> {
		try {
			const raw = (await this.options.client.request(
				"query ConnectedAniListAccount { Viewer { id name } }",
				{},
				{ token, signal, priority: true },
			)) as { Viewer?: { id?: unknown; name?: unknown } };
			if (
				!Number.isSafeInteger(raw?.Viewer?.id) ||
				Number(raw.Viewer?.id) <= 0 ||
				typeof raw.Viewer?.name !== "string" ||
				!raw.Viewer.name ||
				raw.Viewer.name.length > 256
			)
				throw new DomainError(
					"TRACKING_UNAVAILABLE",
					"AniList returned an invalid account.",
				);
			return { id: raw.Viewer.id as number, name: raw.Viewer.name };
		} catch (error) {
			if (error instanceof DomainError) throw error;
			if (
				error instanceof AniListError &&
				error.failure.code === "unauthorized"
			)
				throw new DomainError(
					"TRACKING_AUTHORIZATION_REQUIRED",
					"Reconnect your AniList account.",
				);
			if (
				error instanceof AniListError &&
				error.failure.code === "rate-limited"
			)
				throw new DomainError(
					"TRACKING_RATE_LIMITED",
					"AniList rate limit reached.",
				);
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"AniList account check failed. Retry later.",
			);
		}
	}
	private async previewAccount(sessionId: string, token: string) {
		this.assertOpen();
		if (!token || token.length > 8192 || /\s/.test(token))
			throw new DomainError("INVALID_REQUEST", "Invalid access token.");
		for (const [key, candidate] of this.candidates)
			if (candidate.expiresAt <= this.now()) this.candidates.delete(key);
		if (this.candidates.size + this.validations.size >= 100)
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"Too many pending account previews.",
			);
		const id = randomUUID();
		const generation = this.connection.generation;
		this.candidates.delete(sessionId);
		this.validations.set(sessionId, id);
		try {
			const account = await this.viewer(token, this.lifetime.signal);
			this.assertGeneration(generation);
			if (this.validations.get(sessionId) !== id)
				throw new DomainError(
					"TRACKING_CONFLICT",
					"Account preview was replaced.",
				);
			const candidate = {
				id,
				token,
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
						"AniList account preview expired.",
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
				"AniList account preview ready for confirmation.",
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
	private exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const task = this.tail.then(operation);
		this.tail = task.catch(() => {});
		return task;
	}
	private confirmAccount(
		sessionId: string,
		candidateId: string,
		generation: string,
	) {
		return this.exclusive(async () => {
			this.assertGeneration(generation);
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
			const next: TrackingConnection = {
				generation: randomUUID(),
				account: candidate.account,
				credentialId: randomUUID(),
				state: "connected",
				checkedAt: this.now(),
			};
			try {
				await this.options.credentials.write(next, candidate.token);
				this.assertGeneration(generation);
				this.options.store.save(next);
			} catch (error) {
				if (
					!this.lifetime.signal.aborted &&
					!(error instanceof DomainError && error.code === "TRACKING_CONFLICT")
				)
					this.logger?.error(
						{ event: "tracking.persistence_failed", operation: "confirm" },
						"AniList account connection could not be persisted.",
					);
				if (next.credentialId)
					await this.removeCredential(next.credentialId, "rollback").catch(
						() => {},
					);
				throw new DomainError(
					"TRACKING_UNAVAILABLE",
					"Account connection could not be saved.",
				);
			}
			const previous = this.connection;
			this.connection = next;
			this.connectivity = "available";
			this.accountLifetime.abort();
			this.accountLifetime = new AbortController();
			this.clearCandidates();
			this.validations.clear();
			if (previous.credentialId)
				await this.removeCredential(previous.credentialId, "replacement").catch(
					() => {},
				);
			this.logger?.info(
				{
					event: "tracking.account_connected",
					accountId: next.account?.id,
					generation: next.generation,
				},
				"AniList account connected.",
			);
			return this.status();
		});
	}
	private disconnectAccount(generation: string) {
		return this.exclusive(async () => {
			this.assertGeneration(generation);
			const previous = this.connection;
			const next: TrackingConnection = {
				generation: randomUUID(),
				account: null,
				credentialId: null,
				state: "disconnected",
				checkedAt: null,
			};
			try {
				this.options.store.save(next);
			} catch {
				this.logger?.error(
					{ event: "tracking.persistence_failed", operation: "disconnect" },
					"AniList disconnect could not be persisted.",
				);
				throw new DomainError(
					"TRACKING_UNAVAILABLE",
					"Disconnect could not be saved.",
				);
			}
			this.connection = next;
			this.connectivity = "unknown";
			this.accountLifetime.abort();
			this.accountLifetime = new AbortController();
			this.clearCandidates();
			this.validations.clear();
			if (previous.credentialId) {
				try {
					await this.removeCredential(previous.credentialId, "disconnect");
				} catch {
					throw new DomainError(
						"TRACKING_UNAVAILABLE",
						"Disconnected, but credential cleanup failed.",
					);
				}
			}
			this.logger?.info(
				{ event: "tracking.account_disconnected", generation: next.generation },
				"AniList account disconnected locally.",
			);
			return this.status();
		});
	}
	private async checkAccount() {
		this.assertOpen();
		const connection = { ...this.connection };
		const sequence = ++this.checkSequence;
		if (!connection.account) return this.status();
		try {
			const token = await this.options.credentials.read(connection);
			const account = await this.viewer(
				token,
				AbortSignal.any([this.lifetime.signal, this.accountLifetime.signal]),
			);
			this.assertGeneration(connection.generation);
			if (sequence !== this.checkSequence)
				throw new DomainError(
					"TRACKING_CONFLICT",
					"A newer account check has started.",
				);
			if (account.id !== connection.account.id)
				throw new DomainError(
					"TRACKING_AUTHORIZATION_REQUIRED",
					"Account identity changed. Reconnect.",
				);
			this.connection = {
				...connection,
				account,
				state: "connected",
				checkedAt: this.now(),
			};
			this.options.store.save(this.connection);
			this.connectivity = "available";
			this.logger?.debug(
				{
					event: "tracking.connection_checked",
					accountId: account.id,
					generation: connection.generation,
				},
				"AniList connection verified.",
			);
		} catch (error) {
			this.assertGeneration(connection.generation);
			if (sequence !== this.checkSequence)
				throw new DomainError(
					"TRACKING_CONFLICT",
					"A newer account check has started.",
				);
			this.connectivity = "unavailable";
			if (
				error instanceof DomainError &&
				error.code === "TRACKING_AUTHORIZATION_REQUIRED"
			) {
				this.connection = {
					...connection,
					state: "authorization-required",
					checkedAt: this.now(),
				};
				this.options.store.save(this.connection);
				this.logger?.warn(
					{
						event: "tracking.authorization_required",
						phase: "check",
						accountId: connection.account.id,
						generation: connection.generation,
					},
					"AniList authorization is invalid; reconnect required.",
				);
			}
			if (error instanceof DomainError) throw error;
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"AniList account check failed.",
			);
		}
		return this.status();
	}
	async close() {
		this.logger?.debug(
			{
				event: "tracking.stopping",
				pendingPreviews: this.candidates.size,
				validations: this.validations.size,
			},
			"Stopping AniList account service.",
		);
		this.lifetime.abort();
		this.accountLifetime.abort();
		this.clearCandidates();
		this.validations.clear();
		await this.tail;
		this.logger?.debug(
			{ event: "tracking.stopped" },
			"AniList account service stopped.",
		);
	}
}
