import type { Logger } from "pino";
import type {
	CompletionRecord,
	PlaybackCompletionObserver,
} from "../domain/completion.js";
import type { PlaybackStore } from "../ports.js";
export class PlaybackCompletions {
	private active: Promise<void> | undefined;
	private closed = false;
	private requested = false;
	private retryAttempts = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	constructor(
		private readonly store: Pick<
			PlaybackStore,
			"completions" | "saveCompletion"
		>,
		private readonly observer: PlaybackCompletionObserver,
		private readonly logger: Logger,
	) {
		void this.flush();
	}
	async flush(): Promise<void> {
		if (this.closed) return;
		this.requested = true;
		clearTimeout(this.timer);
		this.timer = undefined;
		if (this.active) return this.active;
		let retry = false;
		this.active = Promise.resolve()
			.then(async () => {
				while (this.requested && !this.closed) {
					this.requested = false;
					retry = await this.run();
				}
			})
			.catch(() => {
				retry = true;
				this.logger.error(
					{ event: "playback.completion_worker_failed" },
					"Completion handoff retained for retry.",
				);
			})
			.finally(() => {
				this.active = undefined;
				if (this.requested && !this.closed) void this.flush();
				else if (retry && !this.closed) {
					const delay = Math.min(
						60_000,
						2000 * 2 ** Math.min(this.retryAttempts++, 5),
					);
					this.logger.debug(
						{ event: "playback.completion_retry_scheduled", delayMs: delay },
						"Completion handoff will retry after a delay.",
					);
					this.timer = setTimeout(() => void this.flush(), delay);
					this.timer.unref();
				} else this.retryAttempts = 0;
			});
		return this.active;
	}
	private async run() {
		let retry = false;
		const seen = new Set<string>();
		while (!this.closed) {
			const records = this.store
				.completions(undefined, true)
				.filter((record) => !seen.has(record.id));
			if (!records.length) break;
			for (const record of records) {
				if (this.closed) return retry;
				seen.add(record.id);
				retry = (await this.deliver(record)) || retry;
			}
		}
		return retry;
	}
	private async deliver(record: CompletionRecord) {
		try {
			const outcome = await this.observer.submit(record.context, record.id);
			if (this.closed) return false;
			this.store.saveCompletion({ ...record, outcome });
			if (JSON.stringify(outcome) !== JSON.stringify(record.outcome))
				this.logger.info(
					{
						event: "playback.completion_handoff",
						completionId: record.id,
						operationId: outcome.operationId,
						revision: outcome.revision,
						state: outcome.state,
						reason: outcome.reason,
					},
					"Playback completion handoff updated.",
				);
			return outcome.state === "pending" || outcome.state === "unavailable";
		} catch {
			if (record.outcome.state !== "unavailable")
				this.logger.warn(
					{
						event: "playback.completion_admission_failed",
						completionId: record.id,
					},
					"Completion admission failed; durable handoff retained for retry.",
				);
			if (!this.closed)
				this.store.saveCompletion({
					...record,
					outcome: { state: "unavailable", reason: "tracking-unavailable" },
				});
			return true;
		}
	}
	async close() {
		this.closed = true;
		clearTimeout(this.timer);
		await this.active;
	}
}
