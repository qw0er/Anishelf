import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Check } from "typebox/value";
import { expect, test, vi } from "vitest";
import type { CompatibilityEvidence } from "../../../../src/contracts/http.js";
import { PlaybackPlanSchema } from "../../../../src/contracts/schemas/playback.js";
import { updateResourceSettings } from "../../../support/settings.js";

import {
	cleanup,
	fixture,
	setupTestLifecycle,
} from "./support/media-execution-planning-fixture.js";

setupTestLifecycle();

test("profile content changes invalidate evidence; metadata and key order do not", async () => {
	const f = await fixture();
	f.profile.name = "Renamed";
	const renamed = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
	);
	expect(renamed.descriptionId).toBe(f.description.descriptionId);
	if ("crf" in f.profile.video) f.profile.video.crf += 1;
	await expect(f.resolve()).rejects.toThrow("stale");
});

test("duplicate compatibility evidence is rejected", async () => {
	const f = await fixture();
	await expect(
		f.resolveInput({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: f.description.descriptionId,
			evidence: [...f.evidence(), f.evidence()[0] as CompatibilityEvidence],
		}),
	).rejects.toThrow("evidence");
});

test("source-only and output-context checks share evidence validation", async () => {
	const f = await fixture();
	const invalid: CompatibilityEvidence = {
		id: "original",
		status: "unknown",
		reason: "browser-supported",
		smooth: null,
	};
	const original = await f.app.inspect({
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
	});
	await expect(
		f.app.check({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: original.descriptionId,
			output: null,
			evidence: [invalid],
		}),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await expect(
		f.app.check({
			output: { profileId: f.profile.id, target: "file" },
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: f.description.descriptionId,
			evidence: [invalid],
		}),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

test("media planning validates evidence without opening history or claiming resource readiness", async () => {
	const f = await fixture();
	const input = {
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" as const },
		evidence: f.evidence(),
	};
	const result = await f.app.plan(input);
	expect(result.kind).toBe("processing-required");
	if (result.kind !== "processing-required") throw new Error("Missing work");
	expect(result.target).toBe("file");
	expect(result.mode).toBe("remux");
	expect(result.identity).toMatchObject({
		fileId: f.file.id,
		sourceVersion: input.sourceVersion,
		executionPlanId: result.execution.plan.id,
		videoStreamIndex: 2,
		audioStreamIndices: [4],
	});
	expect(result.identity.rootId).toBe(f.source.identity.scopeId);
	expect(JSON.stringify(result.identity)).not.toContain(f.root);
	expect(Object.isFrozen(result.execution.plan)).toBe(true);
	expect(result).not.toHaveProperty("playbackUrl");
	expect(result).not.toHaveProperty("taskId");
	await expect(
		f.app.plan({ ...input, descriptionId: "stale" }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	const direct = await f.app.plan({
		...input,
		evidence: f.evidence(
			Object.fromEntries(f.description.queries.map((q) => [q.id, "supported"])),
		),
	});
	expect(direct).toEqual({
		kind: "playable",
		fileId: f.file.id,
		mimeType: "video/x-matroska",
	});

	expect(
		await f.app.plan(
			{
				...input,
				evidence: f.evidence(
					Object.fromEntries(
						f.description.queries.map((q) => [q.id, "supported"]),
					),
				),
			},
			{ forcePreparation: true },
		),
	).toMatchObject({ kind: "processing-required" });

	const blocked = await f.app.plan({
		...input,
		evidence: f.evidence({ "copy-video": "unknown" }),
	});
	expect(blocked).toEqual({
		kind: "blocked",
		reason: "source-stream-compatibility-unknown",
	});
	f.app.close();
	await expect(f.app.plan(input)).rejects.toMatchObject({
		code: "MEDIA_PLANNING_UNAVAILABLE",
	});
});

test("media planning rejects a root change while compatibility is awaited", async () => {
	const f = await fixture();
	const otherRoot = await mkdtemp(join(tmpdir(), "anishelf-planning-other-"));
	cleanup.push(() => rm(otherRoot, { recursive: true, force: true }));
	const original = f.app.check.bind(f.app);
	vi.spyOn(f.app, "check").mockImplementationOnce(async (input) => {
		const checked = await original(input);
		await updateResourceSettings(f.library, { resourceRoots: [otherRoot] });
		return checked;
	});
	await expect(
		f.app.plan({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: f.description.descriptionId,
			output: { profileId: f.profile.id, target: "file" },
			evidence: f.evidence(),
		}),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
});

test("playback resource contracts reject premature URLs and private execution fields", () => {
	expect(Check(PlaybackPlanSchema, { mode: "preparing", taskId: "task" })).toBe(
		false,
	);
	expect(
		Check(PlaybackPlanSchema, {
			mode: "preparing",
			taskId: "task",
			playbackUrl: "/partial.mp4",
		}),
	).toBe(false);
	expect(
		Check(PlaybackPlanSchema, { mode: "prepared", artifactId: "artifact" }),
	).toBe(false);
	expect(
		Check(PlaybackPlanSchema, {
			mode: "direct",
			playbackUrl: "/api/media/file",
			path: "/private/source",
		}),
	).toBe(false);
});
