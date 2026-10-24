import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import PQueue from "p-queue";
import type { Logger } from "pino";

export const outboundCooldownOverflowKey = "scheduler:cooldown-overflow";

export class OutboundRequestError extends Error {
	constructor(
		readonly code: "cancelled" | "queue_full" | "cooldown",
		readonly retryAt?: number,
	) {
		super("Outbound request could not start.");
		this.name = "OutboundRequestError";
	}
}

export interface OutboundRequestSchedulerOptions {
	concurrency?: number;
	minimumIntervalMs?: number;
	minimumIntervalForKey?: (key: string) => number;
	maximumQueued?: number;
	maximumBudgets?: number;
	now?: () => number;
	logger?: Pick<Logger, "debug" | "warn">;
	cooldowns?: Readonly<Record<string, number>>;
	onCooldown?: (key: string, until: number) => void;
}

interface Budget {
	queue: PQueue;
	nextAt: number;
	users: number;
}

/** Queue mechanics only: callers own cache policy, budgets and retry decisions. */
export class OutboundRequestScheduler {
	private readonly queue: PQueue;
	private readonly budgets = new Map<string, Budget>();
	private readonly cooldowns = new Map<string, number>();
	private readonly now: () => number;
	private readonly intervalMs: number;
	private readonly maximumPending: number;
	private readonly maximumBudgets: number;
	private overflowUntil = 0;
	private pending = 0;

	constructor(private readonly options: OutboundRequestSchedulerOptions = {}) {
		const concurrency = options.concurrency ?? 2;
		const maximumQueued = options.maximumQueued ?? 64;
		const maximumBudgets = options.maximumBudgets ?? 4096;
		const intervalMs = options.minimumIntervalMs ?? 5000;
		if (
			!Number.isInteger(concurrency) ||
			concurrency < 1 ||
			!Number.isInteger(maximumQueued) ||
			maximumQueued < 0 ||
			!Number.isInteger(maximumBudgets) ||
			maximumBudgets < 1 ||
			!Number.isFinite(intervalMs) ||
			intervalMs < 0
		)
			throw new RangeError("Invalid outbound request scheduler policy.");
		this.queue = new PQueue({ concurrency });
		this.now = options.now ?? Date.now;
		this.intervalMs = intervalMs;
		this.maximumPending = concurrency + maximumQueued;
		this.maximumBudgets = maximumBudgets;
		for (const [key, until] of Object.entries(options.cooldowns ?? {}))
			if (Number.isFinite(until) && until > this.now()) {
				if (
					key === outboundCooldownOverflowKey ||
					this.cooldowns.size >= maximumBudgets
				)
					this.overflowUntil = Math.max(this.overflowUntil, until);
				else this.cooldowns.set(key, until);
			}
	}

	remainingRetryAt(keys: readonly string[]): number | undefined {
		let retryAt =
			this.overflowUntil > this.now() ? this.overflowUntil : undefined;
		for (const key of keys) {
			const until = this.cooldowns.get(key);
			if (until === undefined) continue;
			if (until <= this.now()) this.cooldowns.delete(key);
			else retryAt = Math.max(retryAt ?? 0, until);
		}
		return retryAt;
	}

	cooldown(key: string, until: number): void {
		if (!Number.isFinite(until) || until <= this.now()) return;
		this.prune();
		const overflow =
			key === outboundCooldownOverflowKey ||
			(!this.cooldowns.has(key) && this.cooldowns.size >= this.maximumBudgets);
		const storedKey = overflow ? outboundCooldownOverflowKey : key;
		const current = overflow
			? this.overflowUntil
			: (this.cooldowns.get(key) ?? 0);
		if (current >= until) return;
		if (overflow) this.overflowUntil = until;
		else this.cooldowns.set(key, until);
		this.options.logger?.warn(
			{
				event: "network.request_cooldown",
				budget: this.logKey(storedKey),
				retryAt: until,
				overflow,
			},
			"Outbound request budget is cooling down",
		);
		try {
			this.options.onCooldown?.(storedKey, until);
		} catch {
			this.options.logger?.warn(
				{
					event: "network.request_cooldown_persistence_failed",
					budget: this.logKey(storedKey),
				},
				"Outbound request cooldown could not be persisted",
			);
		}
	}

	async run<T>(
		keys: readonly string[],
		signal: AbortSignal,
		operation: () => Promise<T>,
	): Promise<T> {
		this.check(keys, signal);
		if (this.pending >= this.maximumPending) {
			this.options.logger?.warn(
				{ event: "network.request_queue_full", pending: this.pending },
				"Outbound request queue is full",
			);
			throw new OutboundRequestError("queue_full");
		}
		this.prune();
		const unique = [...new Set(keys)].sort();
		const intervals = new Map(
			unique.map((key) => {
				const interval = this.options.minimumIntervalForKey
					? this.options.minimumIntervalForKey(key)
					: this.intervalMs;
				if (!Number.isFinite(interval) || interval < 0)
					throw new RangeError("Invalid outbound request budget interval.");
				return [key, interval] as const;
			}),
		);
		const newKeys = unique.filter((key) => !this.budgets.has(key));
		if (this.budgets.size + newKeys.length > this.maximumBudgets) {
			this.options.logger?.warn(
				{
					event: "network.request_queue_full",
					reason: "budget_capacity",
					budgets: this.budgets.size,
				},
				"Outbound request budget capacity reached",
			);
			throw new OutboundRequestError("queue_full");
		}
		const budgets = unique.map((key) => {
			let budget = this.budgets.get(key);
			if (!budget) {
				budget = { queue: new PQueue({ concurrency: 1 }), nextAt: 0, users: 0 };
				this.budgets.set(key, budget);
			}
			budget.users++;
			return budget;
		});
		const enqueuedAt = this.now();
		this.pending++;
		this.options.logger?.debug(
			{
				event: "network.request_queued",
				budgets: unique.map((key) => this.logKey(key)),
				pending: this.pending,
			},
			"Outbound request queued",
		);
		try {
			// A stable lock order prevents cross-budget deadlocks. Pacing waits do not
			// occupy a global network slot, so unrelated services can still progress.
			const acquire = (index: number): Promise<T> => {
				const budget = budgets[index];
				if (budget)
					return this.enqueue(budget.queue, signal, () => acquire(index + 1));
				return this.dispatch(
					unique,
					budgets,
					intervals,
					signal,
					enqueuedAt,
					operation,
				);
			};
			return await acquire(0);
		} catch (error) {
			if (signal.aborted) {
				this.options.logger?.debug(
					{ event: "network.request_cancelled" },
					"Outbound request cancelled",
				);
				throw new OutboundRequestError("cancelled");
			}
			throw error;
		} finally {
			this.pending--;
			for (const budget of budgets) budget.users--;
			this.prune();
		}
	}

	private async dispatch<T>(
		keys: readonly string[],
		budgets: readonly Budget[],
		intervals: ReadonlyMap<string, number>,
		signal: AbortSignal,
		enqueuedAt: number,
		operation: () => Promise<T>,
	): Promise<T> {
		this.check(keys, signal);
		const wait = Math.max(
			0,
			...budgets.map((budget) => budget.nextAt - this.now()),
		);
		if (wait > 0) await delay(wait, undefined, { signal });
		return this.enqueue(this.queue, signal, async () => {
			this.check(keys, signal);
			const startedAt = this.now();
			for (const [index, budget] of budgets.entries()) {
				const key = keys[index];
				budget.nextAt =
					startedAt +
					(key === undefined
						? this.intervalMs
						: (intervals.get(key) ?? this.intervalMs));
			}
			this.options.logger?.debug(
				{
					event: "network.request_started",
					budgets: keys.map((key) => this.logKey(key)),
					waitMs: Math.max(0, startedAt - enqueuedAt),
				},
				"Outbound request started",
			);
			let completed = false;
			try {
				const result = await operation();
				if (signal.aborted) throw new OutboundRequestError("cancelled");
				completed = true;
				return result;
			} finally {
				this.options.logger?.debug(
					{
						event: "network.request_completed",
						outcome: signal.aborted
							? "cancelled"
							: completed
								? "success"
								: "failed",
						durationMs: Math.max(0, this.now() - startedAt),
					},
					"Outbound request finished",
				);
			}
		});
	}

	private check(keys: readonly string[], signal: AbortSignal) {
		if (signal.aborted) throw new OutboundRequestError("cancelled");
		const retryAt = this.remainingRetryAt(keys);
		if (retryAt !== undefined) {
			this.options.logger?.debug(
				{ event: "network.request_deferred", retryAt },
				"Outbound request deferred by remote cooldown",
			);
			throw new OutboundRequestError("cooldown", retryAt);
		}
	}

	private async enqueue<T>(
		queue: PQueue,
		signal: AbortSignal,
		operation: () => Promise<T>,
	): Promise<T> {
		if (signal.aborted) throw new OutboundRequestError("cancelled");
		const waiting = new AbortController();
		const cancel = () => waiting.abort();
		signal.addEventListener("abort", cancel, { once: true });
		try {
			return await queue.add(
				() => {
					// Only cancel queue admission. Running operations retain their slot
					// until they settle, even if they ignore AbortSignal.
					signal.removeEventListener("abort", cancel);
					if (signal.aborted) throw new OutboundRequestError("cancelled");
					return operation();
				},
				{ signal: waiting.signal },
			);
		} finally {
			signal.removeEventListener("abort", cancel);
		}
	}

	private prune() {
		const now = this.now();
		for (const [key, budget] of this.budgets)
			if (budget.users === 0 && budget.nextAt <= now) this.budgets.delete(key);
		for (const [key, until] of this.cooldowns)
			if (until <= now) this.cooldowns.delete(key);
	}

	private logKey(key: string) {
		return createHash("sha256").update(key).digest("hex").slice(0, 16);
	}
}
