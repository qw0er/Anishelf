import type { Logger } from "pino";
import { sourcePolicy } from "../domain/model.js";
import type { SourceContext } from "./context.js";

/** One bounded scheduler for managed evidence and existing subscription consumers. */
export class SourceScheduler {
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking: Promise<void> | undefined;
	constructor(
		private readonly context: SourceContext,
		private readonly logger: Logger,
		private readonly activeIds: () => string[],
		private readonly read: (
			id: string,
		) => { id: string; nextAttemptAt: number } | null,
		private readonly poll: (id: string) => Promise<void>,
	) {}
	start() {
		this.timer = setInterval(() => {
			void this.tick();
		}, sourcePolicy.tickMs);
		this.timer.unref();
		void this.tick();
	}
	private tick(): Promise<void> {
		if (this.ticking || this.context.signal.aborted)
			return this.ticking ?? Promise.resolve();
		const task = (async () => {
			const due = [...new Set(this.activeIds())].filter((id) => {
				const source = this.read(id);
				return source && source.nextAttemptAt <= this.context.now();
			});
			for (
				let index = 0;
				index < due.length && !this.context.signal.aborted;
				index += 2
			)
				await Promise.all(
					due.slice(index, index + 2).map(async (id) => {
						// Recheck ownership immediately before dispatch.
						if (this.activeIds().includes(id)) await this.poll(id);
					}),
				);
		})().catch(() => {
			this.logger.warn(
				{ event: "acquisition.scheduler_failed" },
				"Source scheduler will retry.",
			);
		});
		this.ticking = task;
		void task.finally(() => {
			this.ticking = undefined;
		});
		return task;
	}
	async close() {
		if (this.timer) clearInterval(this.timer);
		await this.ticking;
	}
}
