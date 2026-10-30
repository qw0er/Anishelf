import { expect, test } from "vitest";
import { resolveExecutionPlan as resolvePreparationExecutionPlan } from "../../../../src/modules/media/media-planning/public.js";

import {
	fixture,
	resolveExecutionPlan,
	setupTestLifecycle,
} from "./support/media-execution-planning-fixture.js";

setupTestLifecycle();

test("checks every audio track and defaults execution to all audio streams", async () => {
	const f = await fixture(true, true);
	expect(f.description.audioTracks?.map((track) => track.index)).toEqual([
		4, 7,
	]);
	const checked = await f.app.check({
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" },
		evidence: f.evidence({
			"original-audio": "supported",
			"original-audio-7": "unsupported",
			"copy-audio-7": "unsupported",
		}),
	});
	expect(checked.audio.status).toBe("unsupported");
	expect(checked.audioTracks).toMatchObject([
		{ stream: { index: 4 }, compatibility: { status: "supported" } },
		{
			stream: { index: 7, language: "jpn", label: "Japanese" },
			compatibility: { status: "unsupported" },
		},
	]);
	const plan = resolveExecutionPlan(checked);
	expect(plan).toMatchObject({
		kind: "processing",
		mode: "transcode-audio",
		request: {
			audioStreamIndices: [4, 7],
			plan: { audio: { action: "encode" } },
		},
	});
	expect(
		resolveExecutionPlan(
			await f.app.check({
				fileId: f.file.id,
				sourceVersion: f.source.identity.sourceVersion,
				descriptionId: f.description.descriptionId,
				output: { profileId: f.profile.id, target: "file" },
				evidence: f.evidence({ "copy-audio-7": "unknown" }),
			}),
		),
	).toEqual({ kind: "blocked", reason: "source-stream-compatibility-unknown" });
});

test("audio selection binds evidence and execution identity, preserving requested order and video-only selection", async () => {
	const f = await fixture(true, true);
	const plans = [];
	for (const selection of [[7], [7, 4], []]) {
		const output = { profileId: f.profile.id, target: "file" as const };
		const description = await f.app.inspect({
			fileId: f.file.id,
			output,
			audioStreamIndices: selection,
		});
		expect(description.audioTracks).toHaveLength(2);
		expect(description.selectedAudioStreamIndices).toEqual(selection);
		const evidence = description.queries.map((query) => ({
			id: query.id,
			status: "supported" as const,
			reason: "browser-supported" as const,
			smooth: null,
		}));
		const request = {
			fileId: f.file.id,
			sourceVersion: description.sourceVersion,
			descriptionId: description.descriptionId,
			output,
			evidence,
			audioStreamIndices: selection,
		};
		const plan = resolveExecutionPlan(await f.app.check(request));
		expect(plan).toMatchObject({
			kind: "processing",
			request: { audioStreamIndices: selection },
		});
		if (plan.kind !== "processing") throw new Error("Missing plan");
		plans.push(plan.request.plan.id);
		await expect(
			f.app.check({ ...request, audioStreamIndices: [4] }),
		).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	}
	expect(new Set(plans).size).toBe(3);
	for (const audioStreamIndices of [[0], [4, 4], [-1], [99]]) {
		await expect(
			f.app.inspect({ fileId: f.file.id, audioStreamIndices }),
		).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	}
});

test("compatibility mode without audio still uses the full-transcode mode", async () => {
	const f = await fixture(false);
	const checked = await f.app.check({
		fileId: f.file.id,
		sourceVersion: f.description.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" },
		evidence: f.evidence(),
	});
	expect(resolvePreparationExecutionPlan(checked)).toMatchObject({
		kind: "processing",
		mode: "transcode",
		request: { audioStreamIndices: [], plan: { video: { action: "encode" } } },
	});
});
