import type { Logger } from "pino";
import type { TrackingLease } from "../domain/list.js";
import type { TrackingPreview, TrackingStatus } from "../domain/model.js";
import type { TrackingListAccess } from "../ports.js";
import type { TrackingAccountsApi } from "../public.js";
import type { TrackingAuthorizations } from "./authorizations.js";
import type { TrackingConnectionState } from "./connection.js";
import type { TrackingConnectionCheck } from "./connection-check.js";
import type { TrackingDiagnostics } from "./diagnostics.js";

export interface TrackingAccountApplicationOptions {
	connection: TrackingConnectionState;
	authorizations: TrackingAuthorizations;
	checks: TrackingConnectionCheck;
	diagnostics: TrackingDiagnostics;
	logger?: Logger;
}
/** Coordinates account use cases; composition supplies all collaborators. */
export class TrackingAccountApplication
	implements TrackingAccountsApi, TrackingListAccess
{
	private tail: Promise<unknown> = Promise.resolve();
	constructor(private readonly options: TrackingAccountApplicationOptions) {}

	initialize(): Promise<void> {
		return this.options.connection.initialize();
	}
	status(): TrackingStatus {
		return this.options.connection.status();
	}
	preview(sessionId: string, credential: string): Promise<TrackingPreview> {
		return this.options.diagnostics.observe("preview", () =>
			this.options.authorizations.preview(sessionId, credential),
		);
	}
	confirm(
		sessionId: string,
		candidateId: string,
		generation: string,
	): Promise<TrackingStatus> {
		return this.options.diagnostics.observe("confirm", () =>
			this.exclusive(() =>
				this.options.connection.connect(
					this.options.authorizations.require(
						sessionId,
						candidateId,
						generation,
					),
					generation,
				),
			),
		);
	}
	disconnect(generation: string): Promise<TrackingStatus> {
		return this.options.diagnostics.observe("disconnect", () =>
			this.exclusive(() => this.options.connection.disconnect(generation)),
		);
	}
	check(): Promise<TrackingStatus> {
		return this.options.diagnostics.observe("check", () =>
			this.options.checks.check(),
		);
	}
	acquire(): Promise<TrackingLease> {
		return this.options.connection.acquire();
	}
	assertCurrent(generation: string): void {
		this.options.connection.assertCurrent(generation);
	}
	authorizationFailed(generation: string): void {
		this.options.connection.authorizationFailed(generation);
	}
	private exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const task = this.tail.then(operation);
		this.tail = task.catch(() => {});
		return task;
	}
	async close(): Promise<void> {
		this.options.logger?.debug(
			{
				event: "tracking.stopping",
				pendingPreviews: this.options.authorizations.pendingCount,
				validations: this.options.authorizations.validationCount,
			},
			"Stopping Tracking account service.",
		);
		this.options.connection.stop();
		this.options.authorizations.clear();
		await this.tail;
		this.options.logger?.debug(
			{ event: "tracking.stopped" },
			"Tracking account service stopped.",
		);
	}
}
