import type { Logger } from "pino";
import type {
	CompletionDecision,
	CompletionRecord,
	PlaybackCompletionObserver,
} from "../domain/completion.js";
import type { PlaybackStore } from "../ports.js";
export class PlaybackCompletions {
	private active: Promise<void> | undefined;
	private closed = false;
	private readonly timer: ReturnType<typeof setInterval>;
	constructor(
		private readonly store: PlaybackStore,
		private readonly observer: PlaybackCompletionObserver,
		private readonly logger: Logger,
	) {
		this.timer = setInterval(() => {
			void this.flush();
		}, 2000);
		this.timer.unref();
		void this.flush();
	}
	async flush(): Promise<void> {
		if (this.closed) return;
		if (this.active) return this.active;
		this.active = this.run()
			.catch(() => {
				this.logger.error(
					{ event: "playback.completion_worker_failed" },
					"Completion handoff retained for retry.",
				);
			})
			.finally(() => {
				this.active = undefined;
			});
		return this.active;
	}
	private async run() {
		for (const record of this.store.completions(undefined, true)) {
			if (this.closed) return;
			await this.deliver(record);
		}
	}
	private async deliver(record: CompletionRecord) {
		try {
			const outcome = await this.observer.submit(
				record.context,
				record.capturedAt,
				record.decision,
			);
			if (this.closed) return;
			this.store.saveCompletion({ ...record, outcome });
			if (JSON.stringify(outcome) !== JSON.stringify(record.outcome))
				this.logger.info(
					{
						event: "playback.completion_handoff",
						completionId: record.id,
						state: outcome.state,
						reason: outcome.reason,
					},
					"Playback completion handoff updated.",
				);
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
		}
	}
	async decide(record: CompletionRecord, decision: CompletionDecision) {
		await this.active;
		const latest = this.store
			.completions(record.sourceId, false, record.context)
			.find((r) => r.id === record.id);
		if (latest?.outcome.state !== "decision-required") return;
		this.store.saveCompletion({
			...latest,
			decision,
			outcome: { state: "pending", reason: "decision-recorded" },
		});
		await this.flush();
	}
	/** Manual marking creates the receipt that coverage-based completion would otherwise add. */
	async mark(
		sourceId: string,
		context: string,
		capturedAt: number,
		decision: CompletionDecision,
	): Promise<void> {
		await this.active;
		this.store.recordCompletion({ sourceId, context, capturedAt, decision });
		await this.flush();
	}
	async close() {
		this.closed = true;
		clearInterval(this.timer);
		await this.active;
	}
}
