import { expect, test } from "vitest";
import { mediaToolPolicy } from "../src/platform/media/policy.js";
import {
	parseExecutionProgress,
	startMediaProcess,
} from "../src/platform/media/processing-process.js";
import type { MediaProcessEvent } from "../src/shared/media-execution.js";

const policy = {
	...mediaToolPolicy,
	processingStartupTimeoutMs: 1000,
	processingStallTimeoutMs: 200,
	processingStopGraceMs: 50,
	diagnosticMaximumBytes: 64,
	progressMaximumBytes: 128,
};
function launch(
	script: string,
	overrides = {},
	timeoutMs = 3000,
	events: MediaProcessEvent[] = [],
) {
	return startMediaProcess(
		process.execPath,
		["-e", script],
		{ timeoutMs, durationMs: 1000, onEvent: (event) => events.push(event) },
		{ ...policy, ...overrides },
	);
}
test("parses microseconds and leaves unknown duration percentages absent", () => {
	const fields = new Map([
		["out_time_us", "500000"],
		["speed", "1.5x"],
		["progress", "end"],
	]);
	expect(parseExecutionProgress(fields, 1000)).toMatchObject({
		mediaTimeMs: 500,
		percent: 50,
		speed: 1.5,
		ended: true,
	});
	expect(parseExecutionProgress(fields, null).percent).toBeNull();
});
test("streams split records and permits aggregate stdout larger than record limit", async () => {
	const events: MediaProcessEvent[] = [];
	const handle = launch(
		"for(let i=0;i<1000;i++) process.stdout.write('frame='+i+'\\nprogress=continue\\n'); process.stdout.write('out_time_us='); setTimeout(()=>process.stdout.write('1000000\\nprogress=end\\n'),20)",
		{},
		3000,
		events,
	);
	await handle.completion;
	expect(events.filter((e) => e.type === "progress")).toHaveLength(1001);
	expect(events.at(-1)).toMatchObject({ type: "closed", reason: null });
});
test.each([
	[
		"startup-timeout",
		"setInterval(()=>{},1000)",
		{ processingStartupTimeoutMs: 150 },
		3000,
	],
	[
		"stalled",
		"setInterval(()=>process.stdout.write('frame=1\\nprogress=continue\\n'),30)",
		{},
		3000,
	],
	[
		"timeout",
		"let n=0;setInterval(()=>process.stdout.write('frame='+n+++'\\nprogress=continue\\n'),20)",
		{},
		250,
	],
	[
		"invalid-progress",
		"process.stdout.write('x'.repeat(200));setInterval(()=>{},1000)",
		{},
		3000,
	],
	["invalid-progress", "process.stdout.write('broken')", {}, 3000],
	[
		"exit-failed",
		"process.stderr.write('x'.repeat(200)+'tail');process.exitCode=3",
		{},
		3000,
	],
] as const)(
	"classifies %s and waits for close",
	async (reason, script, limits, timeoutMs) => {
		const events: MediaProcessEvent[] = [];
		const handle = launch(script, limits, timeoutMs, events);
		await expect(handle.completion).rejects.toMatchObject({ reason });
		expect(events.at(-1)).toMatchObject({ type: "closed", reason });
		if (reason === "exit-failed")
			await handle.completion.catch((error) => {
				expect(error.diagnostic).toHaveLength(64);
				expect(error.diagnostic).toMatch(/tail$/);
			});
	},
);
test("stop escalates for a child ignoring termination and awaits close", async () => {
	let started!: () => void;
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	const handle = startMediaProcess(
		process.execPath,
		[
			"-e",
			"process.on('SIGTERM',()=>{});process.stdout.write('frame=0\\nprogress=continue\\n');setInterval(()=>{},1000)",
		],
		{
			timeoutMs: 3000,
			onEvent(event) {
				if (event.type === "progress") started();
			},
		},
		policy,
	);
	await ready;
	await handle.stop();
	await expect(handle.completion).rejects.toMatchObject({
		reason: "cancelled",
		signal: "SIGKILL",
	});
});
test("pre-cancelled signals never spawn and spawn failures settle", async () => {
	const handle = startMediaProcess(
		process.execPath,
		[],
		{ timeoutMs: 1000, signal: AbortSignal.abort() },
		policy,
	);
	expect(handle.pid).toBeNull();
	await expect(handle.completion).rejects.toMatchObject({
		reason: "cancelled",
	});
	await expect(
		startMediaProcess("/nonexistent/ffmpeg", [], { timeoutMs: 1000 }, policy)
			.completion,
	).rejects.toMatchObject({ reason: "spawn-failed" });
});
test("observer exceptions cannot prevent completion", async () => {
	await startMediaProcess(
		process.execPath,
		["-e", "process.stdout.write('progress=end\\n')"],
		{
			timeoutMs: 1000,
			onEvent() {
				throw new Error("observer");
			},
		},
		policy,
	).completion;
});
