import type { Logger } from "pino";
import type { AniListClient } from "../anilist/public.js";
import { TrackingAuthorizations } from "./application/authorizations.js";
import { TrackingConnectionState } from "./application/connection.js";
import { TrackingConnectionCheck } from "./application/connection-check.js";
import { TrackingDiagnostics } from "./application/diagnostics.js";
import type { TrackingLease } from "./domain/list.js";
import type { TrackingPreview, TrackingStatus } from "./domain/model.js";
import { AniListAccountProvider } from "./infrastructure/account-provider.js";
import type {
	TrackingCredentials,
	TrackingListAccess,
	TrackingStore,
} from "./ports.js";
import type { TrackingApi } from "./public.js";

export interface TrackingApplicationOptions {
	store: TrackingStore;
	credentials: TrackingCredentials;
	client: AniListClient;
	now?: () => number;
	logger?: Logger;
}
/** Coordinates account use cases; collaborators own state, previews and provider I/O. */
export class TrackingApplication implements TrackingApi, TrackingListAccess {
	private readonly logger: Logger | undefined;
	private readonly connection: TrackingConnectionState;
	private readonly authorizations: TrackingAuthorizations;
	private readonly checks: TrackingConnectionCheck;
	private readonly diagnostics: TrackingDiagnostics;
	private tail: Promise<unknown> = Promise.resolve();
	constructor(options: TrackingApplicationOptions) {
		this.logger = options.logger?.child({ module: "tracking" });
		this.connection = new TrackingConnectionState({
			store: options.store,
			credentials: options.credentials,
			...(options.now ? { now: options.now } : {}),
			...(this.logger ? { logger: this.logger } : {}),
			onChange: () => this.authorizations.clear(),
		});
		const provider = new AniListAccountProvider(options.client);
		this.authorizations = new TrackingAuthorizations(
			this.connection,
			provider,
			options.now ?? Date.now,
			this.logger,
		);
		this.checks = new TrackingConnectionCheck(
			this.connection,
			options.credentials,
			provider,
			this.logger,
		);
		this.diagnostics = new TrackingDiagnostics(this.connection, this.logger);
	}
	initialize(): Promise<void> {
		return this.connection.initialize();
	}
	status(): TrackingStatus {
		return this.connection.status();
	}
	preview(sessionId: string, token: string): Promise<TrackingPreview> {
		return this.diagnostics.observe("preview", () =>
			this.authorizations.preview(sessionId, token),
		);
	}
	confirm(
		sessionId: string,
		candidateId: string,
		generation: string,
	): Promise<TrackingStatus> {
		return this.diagnostics.observe("confirm", () =>
			this.exclusive(() =>
				this.connection.connect(
					this.authorizations.require(sessionId, candidateId, generation),
					generation,
				),
			),
		);
	}
	disconnect(generation: string): Promise<TrackingStatus> {
		return this.diagnostics.observe("disconnect", () =>
			this.exclusive(() => this.connection.disconnect(generation)),
		);
	}
	check(): Promise<TrackingStatus> {
		return this.diagnostics.observe("check", () => this.checks.check());
	}
	acquire(): Promise<TrackingLease> {
		return this.connection.acquire();
	}
	assertCurrent(generation: string): void {
		this.connection.assertCurrent(generation);
	}
	authorizationFailed(generation: string): void {
		this.connection.authorizationFailed(generation);
	}
	private exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const task = this.tail.then(operation);
		this.tail = task.catch(() => {});
		return task;
	}
	async close(): Promise<void> {
		this.logger?.debug(
			{
				event: "tracking.stopping",
				pendingPreviews: this.authorizations.pendingCount,
				validations: this.authorizations.validationCount,
			},
			"Stopping AniList account service.",
		);
		this.connection.stop();
		this.authorizations.clear();
		await this.tail;
		this.logger?.debug(
			{ event: "tracking.stopped" },
			"AniList account service stopped.",
		);
	}
}
