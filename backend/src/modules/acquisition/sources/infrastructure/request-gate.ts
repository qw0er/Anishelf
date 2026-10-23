import { setTimeout as delay } from "node:timers/promises";
import { SourceError } from "../domain/model.js";

/** Shared by RSS and Torznab. Reject excess work rather than growing a queue. */
export class SourceRequestGate {
	private active = 0;
	private readonly busy = new Set<string>();
	private readonly next = new Map<string, number>();
	constructor(
		private readonly intervalMs = 5000,
		private readonly now = Date.now,
	) {}
	async run<T>(
		key: string | null,
		signal: AbortSignal,
		operation: () => Promise<T>,
	): Promise<T> {
		if (signal.aborted) throw new SourceError("request_cancelled");
		if (key && this.busy.has(key)) throw new SourceError("source_busy");
		if (key) this.busy.add(key);
		let acquired = false;
		try {
			const wait = key ? (this.next.get(key) ?? 0) - this.now() : 0;
			if (wait > this.intervalMs)
				throw new SourceError("rate_limited", this.next.get(key ?? ""));
			if (wait > 0) await delay(wait, undefined, { signal });
			if (this.active >= 2) throw new SourceError("source_busy");
			this.active++;
			acquired = true;
			if (key) this.next.set(key, this.now() + this.intervalMs);
			return await operation();
		} catch (error) {
			if (key && error instanceof SourceError && error.retryAt)
				this.next.set(key, Math.max(this.next.get(key) ?? 0, error.retryAt));
			if (signal.aborted) throw new SourceError("request_cancelled");
			throw error;
		} finally {
			if (acquired) this.active--;
			if (key) this.busy.delete(key);
		}
	}
}
