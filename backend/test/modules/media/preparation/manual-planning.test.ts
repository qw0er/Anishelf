import { expect, test, vi } from "vitest";
import { fixture, setupTestLifecycle } from "./support/preparation-fixture.js";

setupTestLifecycle();
async function withSubtitle(codec = "ass") {
	const f = await fixture();
	const input = await f.input();
	const inspected = await f.inspection.inspect(
		input.fileId,
		input.sourceVersion,
	);
	const original = inspected.info.streams[0];
	if (!original) throw new Error("Missing stream fixture");
	vi.spyOn(f.inspection, "inspect").mockResolvedValue({
		...inspected,
		info: {
			...inspected.info,
			streams: [
				...inspected.info.streams,
				{
					...original,
					index: 3,
					type: "subtitle",
					codec,
					default: false,
					forced: true,
					tags: { language: "jpn" },
				},
			],
		},
	});
	return { f, input };
}
test("manual commands do not require browser evidence and preserve embedded content", async () => {
	const { f, input } = await withSubtitle();
	const planned = await f.planning.plan(input);
	expect(planned.kind).toBe("processing-required");
	if (planned.kind !== "processing-required") throw new Error("No manual plan");
	expect(planned.execution.plan.preserveSubtitles).toBe(true);
	expect(planned.execution.plan.container).toBe("matroska");
	expect(f.processing.start).not.toHaveBeenCalled();
});
test("a custom container cannot silently discard embedded subtitles", async () => {
	const { f, input } = await withSubtitle();
	const profile = f.profiles[0];
	if (!profile) throw new Error("Missing profile");
	profile.container = "mp4";
	expect(await f.planning.plan(input)).toMatchObject({
		kind: "blocked",
		reason: "subtitle-preservation-requires-matroska",
	});
	expect(f.processing.start).not.toHaveBeenCalled();
});
test("unsupported subtitle copying is rejected before queuing", async () => {
	const { f, input } = await withSubtitle("mov_text");
	expect(await f.planning.plan(input)).toMatchObject({
		kind: "blocked",
		reason: "subtitle-copy-unavailable",
	});
	expect(f.processing.start).not.toHaveBeenCalled();
});
test("stale source versions cannot create a preparation plan", async () => {
	const f = await fixture();
	const input = await f.input();
	await expect(
		f.planning.plan({ ...input, sourceVersion: "stale" }),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
	expect(f.processing.start).not.toHaveBeenCalled();
});
