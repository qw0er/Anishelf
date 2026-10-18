import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { TrackingStatus } from "../domain/model.js";
import type { TrackingAccountProvider, TrackingCredentials } from "../ports.js";
import type { TrackingConnectionState } from "./connection.js";

export class TrackingConnectionCheck {
	private checkSequence = 0;
	constructor(
		private readonly connection: TrackingConnectionState,
		private readonly credentials: TrackingCredentials,
		private readonly provider: TrackingAccountProvider,
		private readonly logger: Logger | undefined,
	) {}
	async check(): Promise<TrackingStatus> {
		this.connection.assertOpen();
		const connection = this.connection.snapshot();
		const sequence = ++this.checkSequence;
		if (!connection.account) return this.connection.status();
		try {
			const credential = await this.credentials.read(connection);
			const account = await this.provider.viewer(
				credential,
				this.connection.accountSignal(),
			);
			this.connection.assertCurrent(connection.generation);
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
			this.connection.checked(connection, account);
			this.logger?.debug(
				{
					event: "tracking.connection_checked",
					accountId: account.id,
					generation: connection.generation,
				},
				"Tracking connection verified.",
			);
		} catch (error) {
			this.connection.assertCurrent(connection.generation);
			if (sequence !== this.checkSequence)
				throw new DomainError(
					"TRACKING_CONFLICT",
					"A newer account check has started.",
				);
			this.connection.checkFailed(
				connection,
				error instanceof DomainError &&
					error.code === "TRACKING_AUTHORIZATION_REQUIRED",
			);
			if (
				error instanceof DomainError &&
				error.code === "TRACKING_AUTHORIZATION_REQUIRED"
			) {
				this.logger?.warn(
					{
						event: "tracking.authorization_required",
						phase: "check",
						accountId: connection.account.id,
						generation: connection.generation,
					},
					"Tracking authorization is invalid; reconnect required.",
				);
			}
			if (error instanceof DomainError) throw error;
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"Tracking account check failed.",
			);
		}
		return this.connection.status();
	}
}
