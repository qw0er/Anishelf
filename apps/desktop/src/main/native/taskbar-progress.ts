import type { OfflineCacheEntry } from "@anishelf/contracts/offline-cache";
import type { ProgressBarOptions } from "electron";

export interface TaskbarProgressTarget {
	isDestroyed(): boolean;
	setProgressBar(progress: number, options?: ProgressBarOptions): void;
}

export type TaskbarProgressState =
	| { mode: "none"; progress: -1 }
	| { mode: "indeterminate"; progress: 2 }
	| { mode: "normal"; progress: number };

const NONE_STATE: TaskbarProgressState = { mode: "none", progress: -1 };
const INDETERMINATE_STATE: TaskbarProgressState = {
	mode: "indeterminate",
	progress: 2,
};

function clampFraction(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value;
}

export function offlineCacheTaskProgress(
	entry: OfflineCacheEntry | null,
): number | null | undefined {
	if (!entry) return undefined;
	switch (entry.status) {
		case "queued":
		case "preparing":
			return null;
		case "downloading":
			return entry.percent === null ? null : clampFraction(entry.percent / 100);
		case "finalizing":
			return 1;
		case "ready":
		case "failed":
		case "unavailable":
			return undefined;
	}
}

export function aggregateTaskbarProgress(
	tasks: Iterable<number | null>,
): TaskbarProgressState {
	let active = 0;
	let determinateCount = 0;
	let determinateSum = 0;
	for (const value of tasks) {
		active += 1;
		if (value !== null && Number.isFinite(value)) {
			determinateCount += 1;
			determinateSum += clampFraction(value);
		}
	}
	if (active === 0) return NONE_STATE;
	if (determinateCount === 0) return INDETERMINATE_STATE;
	const progress =
		Math.round((determinateSum / determinateCount) * 1000) / 1000;
	return { mode: "normal", progress };
}

export class TaskbarProgress {
	private readonly targets = new Set<TaskbarProgressTarget>();
	private readonly tasks = new Map<string, number | null>();
	private state: TaskbarProgressState = NONE_STATE;
	private disposed = false;

	attach(target: TaskbarProgressTarget): void {
		if (this.disposed || target.isDestroyed()) return;
		this.targets.add(target);
		if (this.state.mode !== "none") this.applyTo(target, this.state);
	}

	detach(target: TaskbarProgressTarget): void {
		this.targets.delete(target);
	}

	refresh(target: TaskbarProgressTarget): void {
		if (this.disposed || !this.targets.has(target) || target.isDestroyed())
			return;
		if (this.state.mode !== "none") this.applyTo(target, this.state);
	}

	setTask(id: string, progress: number | null): void {
		if (this.disposed) return;
		const normalized =
			progress === null || !Number.isFinite(progress)
				? null
				: clampFraction(progress);
		if (this.tasks.has(id) && this.tasks.get(id) === normalized) return;
		this.tasks.set(id, normalized);
		this.sync();
	}

	clearTask(id: string): void {
		if (!this.tasks.delete(id)) return;
		this.sync();
	}

	setOfflineCacheEntry(id: string, entry: OfflineCacheEntry | null): void {
		const key = `offline-cache:${id}`;
		const progress = offlineCacheTaskProgress(entry);
		if (progress === undefined) this.clearTask(key);
		else this.setTask(key, progress);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.tasks.clear();
		if (this.state.mode !== "none") {
			this.state = NONE_STATE;
			for (const target of this.targets) {
				if (!target.isDestroyed()) this.applyTo(target, NONE_STATE);
			}
		}
		this.targets.clear();
	}

	private sync(): void {
		const next = aggregateTaskbarProgress(this.tasks.values());
		if (next.mode === this.state.mode && next.progress === this.state.progress)
			return;
		if (next.mode !== this.state.mode) {
			console.debug("desktop.taskbar_progress_mode_changed", {
				mode: next.mode,
				activeTasks: this.tasks.size,
			});
		}
		this.state = next;
		for (const target of this.targets) {
			if (target.isDestroyed()) {
				this.targets.delete(target);
				continue;
			}
			this.applyTo(target, next);
		}
	}

	private applyTo(
		target: TaskbarProgressTarget,
		state: TaskbarProgressState,
	): void {
		try {
			if (state.mode === "none") target.setProgressBar(-1);
			else if (state.mode === "indeterminate")
				target.setProgressBar(state.progress, { mode: "indeterminate" });
			else target.setProgressBar(state.progress, { mode: "normal" });
		} catch (error) {
			console.warn("desktop.taskbar_progress_failed", {
				mode: state.mode,
				error,
			});
		}
	}
}
