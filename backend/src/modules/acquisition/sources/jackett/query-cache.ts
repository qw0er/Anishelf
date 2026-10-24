import { SourceError } from "../domain/model.js";

interface SharedRequest<T> {
	controller: AbortController;
	promise: Promise<T>;
	waiters: number;
	settled: boolean;
}

/** Short-lived adapter evidence only; cached locators never grant download permission. */
export class JackettQueryCache<T> {
	private readonly saved = new Map<
		string,
		{ value: T; expiresAt: number; weight: number }
	>();
	private readonly pending = new Map<string, SharedRequest<T>>();
	private weight = 0;
	private closed = false;
	constructor(
		private readonly maximumEntries: number,
		private readonly maximumWeight: number,
		private readonly now: () => number,
	) {}
	async read(
		key: string,
		signal: AbortSignal,
		load: (signal: AbortSignal) => Promise<{
			value: T;
			ttlMs: number;
			weight: number;
		}>,
	): Promise<{ value: T; cache: "hit" | "shared" | "miss" }> {
		if (this.closed || signal.aborted)
			throw new SourceError("request_cancelled");
		const cached = this.saved.get(key);
		if (cached && cached.expiresAt > this.now()) {
			this.saved.delete(key);
			this.saved.set(key, cached);
			return { value: cached.value, cache: "hit" };
		}
		if (cached) this.remove(key);
		let shared = this.pending.get(key);
		if (shared?.controller.signal.aborted) {
			this.pending.delete(key);
			shared = undefined;
		}
		const cache = shared ? "shared" : "miss";
		if (!shared) {
			if (this.pending.size >= this.maximumEntries)
				throw new SourceError("source_busy");
			const controller = new AbortController();
			const request: SharedRequest<T> = {
				controller,
				waiters: 0,
				settled: false,
				promise: Promise.resolve().then(async () => {
					try {
						const result = await load(controller.signal);
						if (controller.signal.aborted || this.closed)
							throw new SourceError("request_cancelled");
						this.save(key, result);
						return result.value;
					} finally {
						request.settled = true;
						if (this.pending.get(key) === request) this.pending.delete(key);
					}
				}),
			};
			this.pending.set(key, request);
			shared = request;
		}
		return { value: await this.wait(shared, signal), cache };
	}
	private wait(request: SharedRequest<T>, signal: AbortSignal): Promise<T> {
		request.waiters++;
		return new Promise((resolve, reject) => {
			let finished = false;
			const finish = (value?: T, error?: unknown) => {
				if (finished) return;
				finished = true;
				signal.removeEventListener("abort", abort);
				request.waiters--;
				if (!request.settled && request.waiters === 0)
					request.controller.abort();
				if (error) reject(error);
				else resolve(value as T);
			};
			const abort = () =>
				finish(undefined, new SourceError("request_cancelled"));
			signal.addEventListener("abort", abort, { once: true });
			request.promise.then(
				(value) => finish(value),
				(error) => finish(undefined, error),
			);
			if (signal.aborted) abort();
		});
	}
	private save(
		key: string,
		result: { value: T; ttlMs: number; weight: number },
	) {
		if (result.weight > this.maximumWeight || result.ttlMs <= 0) return;
		for (const [id, entry] of this.saved)
			if (entry.expiresAt <= this.now()) this.remove(id);
		this.remove(key);
		this.saved.set(key, {
			value: result.value,
			expiresAt: this.now() + result.ttlMs,
			weight: result.weight,
		});
		this.weight += result.weight;
		while (
			this.saved.size > this.maximumEntries ||
			this.weight > this.maximumWeight
		) {
			const oldest = this.saved.keys().next().value;
			if (oldest === undefined) break;
			this.remove(oldest);
		}
	}
	private remove(key: string) {
		const value = this.saved.get(key);
		if (value) this.weight -= value.weight;
		this.saved.delete(key);
	}
	close() {
		this.closed = true;
		this.saved.clear();
		this.weight = 0;
		for (const request of this.pending.values()) request.controller.abort();
		this.pending.clear();
	}
}
