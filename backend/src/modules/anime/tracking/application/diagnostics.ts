import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { TrackingPreview, TrackingStatus } from "../domain/model.js";
import type { TrackingConnectionState } from "./connection.js";

export class TrackingDiagnostics {
	constructor(
		private readonly connection: TrackingConnectionState,
		private readonly logger: Logger | undefined,
	) {}
	async observe<T extends TrackingPreview | TrackingStatus>(
		operation: "preview" | "confirm" | "disconnect" | "check",
		action: () => Promise<T>,
	): Promise<T> {
		const startedAt = Date.now();
		this.logger?.debug(
			{
				event: "tracking.operation_started",
				operation,
				generation: this.connection.status().generation,
			},
			"Tracking account operation started.",
		);
		try {
			const result = await action();
			this.logger?.debug(
				{
					event: "tracking.operation_succeeded",
					operation,
					accountId: result.account?.id,
					generation: this.connection.status().generation,
					durationMs: Date.now() - startedAt,
				},
				"Tracking account operation completed.",
			);
			return result;
		} catch (error) {
			const context = {
				operation,
				generation: this.connection.status().generation,
				code: error instanceof DomainError ? error.code : "INTERNAL_ERROR",
				durationMs: Date.now() - startedAt,
			};
			if (this.connection.signal.aborted)
				this.logger?.debug(
					{
						event: "tracking.operation_cancelled",
						...context,
						reason: "shutdown",
					},
					"Tracking account operation cancelled.",
				);
			else if (
				error instanceof DomainError &&
				["TRACKING_CONFLICT", "INVALID_REQUEST"].includes(error.code)
			)
				this.logger?.debug(
					{ event: "tracking.operation_rejected", ...context },
					"Tracking account operation rejected.",
				);
			else
				this.logger?.warn(
					{ event: "tracking.operation_failed", ...context },
					"Tracking account operation failed.",
				);
			throw error;
		}
	}
}
