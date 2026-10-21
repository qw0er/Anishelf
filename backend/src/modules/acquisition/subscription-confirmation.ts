import type { Logger } from "pino";
import type { Subscription } from "./discovery/public.js";

/** One synchronous transaction admits both the subscription and its download permission. */
export class SubscriptionConfirmation {
	constructor(
		private readonly options: {
			logger: Logger;
			transaction(operation: () => void): void;
			authorize(
				workKey: string,
				subscriptionRevision: string,
				destinationRevision: string,
			): void;
		},
	) {}
	commit(
		subscription: Subscription,
		destinationRevision: string | null,
		persist: () => void,
	) {
		try {
			this.options.transaction(() => {
				persist();
				if (destinationRevision)
					this.options.authorize(
						subscription.workKey,
						subscription.revision,
						destinationRevision,
					);
			});
		} catch (error) {
			this.options.logger.warn(
				{
					event: "acquisition.subscription_confirmation_failed",
					workKey: subscription.workKey,
					revision: subscription.revision,
				},
				"Subscription confirmation rolled back; preview remains available for retry.",
			);
			throw error;
		}
	}
}
