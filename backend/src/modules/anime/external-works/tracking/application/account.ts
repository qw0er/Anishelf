import type { Logger } from "pino";
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
	readonly initialize: TrackingConnectionState["initialize"];
	readonly status: TrackingConnectionState["status"];
	readonly acquire: TrackingConnectionState["acquire"];
	readonly assertCurrent: TrackingConnectionState["assertCurrent"];
	readonly authorizationFailed: TrackingConnectionState["authorizationFailed"];
	private tail: Promise<unknown> = Promise.resolve();
	constructor(private readonly options: TrackingAccountApplicationOptions) {
		this.initialize = options.connection.initialize.bind(options.connection);
		this.status = options.connection.status.bind(options.connection);
		this.acquire = options.connection.acquire.bind(options.connection);
		this.assertCurrent = options.connection.assertCurrent.bind(
			options.connection,
		);
		this.authorizationFailed = options.connection.authorizationFailed.bind(
			options.connection,
		);
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
