import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { TrackingLease } from "../domain/list.js";
import type {
	TrackingAccount,
	TrackingAuthorization,
	TrackingCandidate,
	TrackingConnection,
	TrackingStatus,
} from "../domain/model.js";
import type { TrackingCredentials, TrackingStore } from "../ports.js";

export interface TrackingConnectionOptions {
	authorization: TrackingAuthorization;
	store: TrackingStore;
	credentials: TrackingCredentials;
	now?: () => number;
	logger?: Logger;
	onChange(): void;
}
export class TrackingConnectionState {
	private readonly logger: Logger | undefined;
	private connection: TrackingConnection;
	private connectivity: TrackingStatus["connectivity"] = "unknown";
	private readonly lifetime = new AbortController();
	private accountLifetime = new AbortController();
	constructor(private readonly options: TrackingConnectionOptions) {
		this.logger = options.logger;
		this.connection = options.store.get() ?? {
			generation: randomUUID(),
			account: null,
			credentialId: null,
			state: "disconnected",
			checkedAt: null,
		};
		if (!options.store.get()) options.store.save(this.connection);
	}
	async initialize(): Promise<void> {
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
			clientId: this.options.authorization.clientId,
			authorizationUrl: this.options.authorization.authorizationUrl,
			generation: this.connection.generation,
			account: this.connection.account ? { ...this.connection.account } : null,
			state: this.connection.state,
			connectivity: this.connectivity,
			checkedAt: this.connection.checkedAt,
		};
	}
	private async removeCredential(
		id: string,
		phase: "rollback" | "replacement" | "disconnect",
	): Promise<void> {
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
	/** Internal account capability, supplied only to the list reader by composition. */
	async acquire(): Promise<TrackingLease> {
		this.assertOpen();
		const connection = { ...this.connection };
		if (!connection.account || connection.state !== "connected")
			throw new DomainError(
				"TRACKING_AUTHORIZATION_REQUIRED",
				"Connect AniList first.",
			);
		const signal = AbortSignal.any([
			this.lifetime.signal,
			this.accountLifetime.signal,
		]);
		const token = await this.options.credentials.read(connection);
		this.assertGeneration(connection.generation);
		signal.throwIfAborted();
		return {
			accountId: connection.account.id,
			generation: connection.generation,
			token,
			signal,
		};
	}
	assertCurrent(generation: string): void {
		this.assertGeneration(generation);
	}
	authorizationFailed(generation: string): void {
		this.assertGeneration(generation);
		const next: TrackingConnection = {
			...this.connection,
			state: "authorization-required",
		};
		this.options.store.save(next);
		this.connection = next;
		this.logger?.warn(
			{ event: "tracking.authorization_required", phase: "list", generation },
			"AniList list authorization requires reconnection.",
		);
	}
	private now(): number {
		return (this.options.now ?? Date.now)();
	}
	assertOpen(): void {
		if (this.lifetime.signal.aborted)
			throw new DomainError("TRACKING_UNAVAILABLE", "Tracking is stopped.");
	}
	private assertGeneration(generation: string): void {
		this.assertOpen();
		if (this.connection.generation !== generation)
			throw new DomainError(
				"TRACKING_CONFLICT",
				"AniList connection changed. Retry.",
			);
	}
	async connect(
		candidate: TrackingCandidate,
		generation: string,
	): Promise<TrackingStatus> {
		this.assertGeneration(generation);
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
		this.options.onChange();
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
	}
	async disconnect(generation: string): Promise<TrackingStatus> {
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
		this.options.onChange();
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
	}

	get signal(): AbortSignal {
		return this.lifetime.signal;
	}
	snapshot(): TrackingConnection {
		return {
			...this.connection,
			account: this.connection.account ? { ...this.connection.account } : null,
		};
	}
	accountSignal(): AbortSignal {
		return AbortSignal.any([this.lifetime.signal, this.accountLifetime.signal]);
	}
	checked(connection: TrackingConnection, account: TrackingAccount): void {
		this.assertGeneration(connection.generation);
		const next: TrackingConnection = {
			...connection,
			account,
			state: "connected",
			checkedAt: this.now(),
		};
		this.options.store.save(next);
		this.connection = next;
		this.connectivity = "available";
	}
	checkFailed(connection: TrackingConnection, unauthorized: boolean): void {
		this.connectivity = "unavailable";
		if (unauthorized) {
			const next: TrackingConnection = {
				...connection,
				state: "authorization-required",
				checkedAt: this.now(),
			};
			this.options.store.save(next);
			this.connection = next;
		}
	}
	stop(): void {
		this.lifetime.abort();
		this.accountLifetime.abort();
	}
}
