import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { PlaybackCompletions } from "../src/modules/playback/progress/application/completions.js";
import type {
	CompletionRecord,
	PlaybackCompletionObserver,
} from "../src/modules/playback/progress/domain/completion.js";

const workers: PlaybackCompletions[] = [];
afterEach(async () => {
	for (const worker of workers.splice(0)) await worker.close();
	vi.useRealTimers();
});
function fixture() {
	const rows = new Map<string, CompletionRecord>();
	const read = vi.fn(() =>
		[...rows.values()]
			.filter((row) => ["pending", "unavailable"].includes(row.outcome.state))
			.slice(0, 100),
	);
	const submit = vi
		.fn<PlaybackCompletionObserver["submit"]>()
		.mockResolvedValue({ state: "accepted", reason: "queued" });
	const worker = new PlaybackCompletions(
		{
			completions: read,
			saveCompletion: (record) => {
				rows.set(record.id, record);
			},
		},
		{ capture: async () => null, submit },
		pino({ level: "silent" }),
	);
	workers.push(worker);
	const add = (id: string) =>
		rows.set(id, {
			id,
			sourceId: id,
			context: JSON.stringify({
				version: 2,
				accountId: "account",
				generation: "generation",
				manualVersion: 0,
				fileId: "file",
				sourceVersion: "v1",
				reviewId: "review",
				mappingRevision: 1,
				episodeId: "episode",
				mediaId: "media",
				episode: 1,
			}),
			outcome: { state: "pending", reason: "new" },
		});
	return { worker, rows, read, submit, add };
}
test("empty completion queue sleeps; persisted batches drain on direct wake", async () => {
	vi.useFakeTimers();
	const f = fixture();
	await f.worker.flush();
	f.read.mockClear();
	await vi.advanceTimersByTimeAsync(60_000);
	expect(f.read).not.toHaveBeenCalled();
	for (let i = 0; i < 105; i++) f.add(String(i));
	await f.worker.flush();
	expect(f.submit).toHaveBeenCalledTimes(105);
	expect(
		[...f.rows.values()].every((row) => row.outcome.state === "accepted"),
	).toBe(true);
	f.read.mockClear();
	await vi.advanceTimersByTimeAsync(60_000);
	expect(f.read).not.toHaveBeenCalled();
});
test("handoff failures retry with backoff and cancel their timer after recovery", async () => {
	vi.useFakeTimers();
	const f = fixture();
	await f.worker.flush();
	f.add("one");
	f.submit.mockRejectedValueOnce(new Error("temporarily unavailable"));
	await f.worker.flush();
	expect(f.rows.get("one")?.outcome.state).toBe("unavailable");
	await vi.advanceTimersByTimeAsync(1999);
	expect(f.submit).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1);
	expect(f.rows.get("one")?.outcome.state).toBe("accepted");
	f.read.mockClear();
	await vi.advanceTimersByTimeAsync(60_000);
	expect(f.read).not.toHaveBeenCalled();
});
test("a wake during delivery is retained and processed without a periodic fallback", async () => {
	const f = fixture();
	await f.worker.flush();
	let release!: () => void;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.submit.mockImplementationOnce(async () => {
		await waiting;
		return { state: "accepted", reason: "queued" };
	});
	f.add("first");
	const running = f.worker.flush();
	await Promise.resolve();
	f.add("second");
	const next = f.worker.flush();
	release();
	await Promise.all([running, next]);
	expect(f.submit).toHaveBeenCalledTimes(2);
	expect(f.rows.get("second")?.outcome.state).toBe("accepted");
});
