import type { Logger } from "pino";
import {
	OutboundRequestError,
	OutboundRequestScheduler,
} from "../../../../platform/network/request-scheduler.js";
import { SourceError } from "../domain/model.js";

interface SourceRequestGateOptions {
	logger?: Pick<Logger, "debug" | "warn">;
	cooldowns?: Readonly<Record<string, number>>;
	onCooldown?: (key: string, until: number) => void;
	maximumQueued?: number;
	minimumIntervalForKey?: (key: string) => number;
}

/** Sources maps its budgets and failures onto the shared outbound scheduler. */
export class SourceRequestGate {
	private readonly scheduler: OutboundRequestScheduler;

	constructor(
		intervalMs = 5000,
		now = Date.now,
		options: SourceRequestGateOptions = {},
	) {
		this.scheduler = new OutboundRequestScheduler({
			...options,
			minimumIntervalMs: intervalMs,
			now,
			concurrency: 2,
		});
	}

	run<T>(
		key: string | null,
		signal: AbortSignal,
		operation: () => Promise<T>,
	): Promise<T> {
		return this.runMany(key ? [key] : [], signal, operation);
	}

	async runMany<T>(
		keys: readonly string[],
		signal: AbortSignal,
		operation: () => Promise<T>,
	): Promise<T> {
		try {
			return await this.scheduler.run(keys, signal, async () => {
				try {
					return await operation();
				} catch (error) {
					// Publish the remote cooldown before releasing budget locks, so an
					// already queued request cannot slip through before this rejection.
					if (
						error instanceof SourceError &&
						error.code === "rate_limited" &&
						error.retryAt !== undefined
					)
						for (const key of keys) this.cooldown(key, error.retryAt);
					throw error;
				}
			});
		} catch (error) {
			if (error instanceof OutboundRequestError) {
				const code = {
					cancelled: "request_cancelled",
					queue_full: "source_busy",
					cooldown: "rate_limited",
				}[error.code];
				throw new SourceError(code, error.retryAt);
			}
			throw error;
		}
	}

	cooldown(key: string, until: number): void {
		this.scheduler.cooldown(key, until);
	}

	remainingRetryAt(keys: readonly string[]): number | undefined {
		return this.scheduler.remainingRetryAt(keys);
	}
}
