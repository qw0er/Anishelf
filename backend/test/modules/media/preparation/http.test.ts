import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import type { PreparationStartResponse } from "../../../../src/contracts/http.js";

import {
	completed,
	fixture,
	headers,
	required,
	setupTestLifecycle,
	taskId,
	waitForAbort,
} from "./support/preparation-fixture.js";

setupTestLifecycle();

test("HTTP only delivers completed media, supports ranges/HEAD, rejects arbitrary execution fields", async () => {
	const f = await fixture();
	const { fileId, ...input } = await f.input();
	const start = await f.app.inject({
		method: "POST",
		url: `/api/files/${fileId}/preparations`,
		headers,
		payload: input,
	});
	expect(start.statusCode).toBe(200);
	const result = start.json<PreparationStartResponse>();
	if (result.kind !== "task") throw new Error("Missing task");
	const task = await completed(f, result.task.id);
	for (const [range, code, body] of [
		["bytes=2-5", 206, "2345"],
		["bytes=-3", 206, "789"],
		["bytes=20-", 416, ""],
		["invalid", 200, "0123456789"],
	] as const) {
		const response = await f.app.inject({
			url: required(task.resource?.url),
			headers: { ...headers, range },
		});
		expect(response.statusCode).toBe(code);
		expect(response.body).toBe(body);
	}
	const head = await f.app.inject({
		method: "HEAD",
		url: required(task.resource?.url),
		headers,
	});
	expect(head.statusCode).toBe(200);
	expect(head.headers["content-type"]).toBe("video/mp4");
	expect(head.headers["content-length"]).toBe("10");
	expect(head.body).toBe("");
	const status = await f.app.inject({
		url: `/api/preparations?fileId=${fileId}`,
		headers,
	});
	expect(
		status.json().tasks.find((item: { id: string }) => item.id === task.id)
			.status,
	).toBe("ready");
	expect(JSON.stringify(status.json())).not.toContain("scopeId");
	expect(
		(
			await f.app.inject({
				method: "POST",
				url: `/api/files/${fileId}/preparations`,
				headers,
				payload: { ...input, arguments: ["-anything"] },
			})
		).statusCode,
	).toBe(400);
	expect(
		(
			await f.app.inject({
				url: "/api/prepared-media/not-a-fingerprint",
				headers,
			})
		).statusCode,
	).toBe(400);
});

test("HTTP cancellation, retry and deletion never expose a pending file", async () => {
	let blocked = true;
	const f = await fixture({
		beforeOutput: async (request) => {
			if (blocked) await waitForAbort(request);
		},
	});
	const { fileId, ...payload } = await f.input();
	const started = await f.app.inject({
		method: "POST",
		url: `/api/files/${fileId}/preparations`,
		headers,
		payload,
	});
	const id = started.json().task.id as string;
	await vi.waitFor(async () =>
		expect((await f.preparation.get(id)).status).toBe("processing"),
	);
	const pending = await f.preparation.get(id);
	expect(pending.resource).toBeNull();
	const key = required(f.database.preparation.get(id)).spec.executionPlanId;
	expect(
		(await f.app.inject({ url: `/api/prepared-media/${key}`, headers }))
			.statusCode,
	).toBe(404);
	const cancelled = await f.app.inject({
		method: "POST",
		url: `/api/preparations/${id}/cancel`,
		headers,
		payload: {},
	});
	expect(cancelled.statusCode).toBe(200);
	expect(cancelled.json().status).toBe("cancelled");
	blocked = false;
	const retried = await f.app.inject({
		method: "POST",
		url: `/api/preparations/${id}/retry`,
		headers,
		payload,
	});
	expect(retried.statusCode).toBe(200);
	const ready = await completed(f, id);
	const list = await f.app.inject({ url: "/api/preparations", headers });
	expect(list.json().tasks[0].id).toBe(id);
	const deleted = await f.app.inject({
		method: "DELETE",
		url: required(ready.resource?.url),
		headers,
	});
	expect(deleted.statusCode).toBe(204);
	expect(
		(await f.app.inject({ url: required(ready.resource?.url), headers }))
			.statusCode,
	).toBe(404);
});

test("summary transport rejects duplicate or oversized file batches", async () => {
	const f = await fixture();
	for (const fileIds of [
		["root", "root"],
		Array.from({ length: 501 }, (_, index) => `file-${index}`),
	]) {
		const response = await f.app.inject({
			method: "POST",
			url: "/api/preparations/summaries",
			headers,
			payload: { fileIds },
		});
		expect(response.statusCode).toBe(400);
	}
});

test("task list shows every active task and pages history without a cap", async () => {
	const f = await fixture();
	const id = await taskId(f.preparation.create(await f.input()));
	await completed(f, id);
	const original = required(f.database.preparation.get(id));
	for (let index = 1; index <= 105; index++)
		f.database.preparation.insert({
			...original,
			id: randomUUID(),
			spec: {
				...original.spec,
				executionPlanId: index.toString(16).padStart(64, "0"),
			},
			state: {
				status: "cancelled",
				failureReason: "cancelled",
				progress: null,
				updatedAtMs: original.createdAtMs + index,
			},
			createdAtMs: original.createdAtMs + index,
		});
	const activeId = randomUUID();
	f.database.preparation.insert({
		...original,
		id: activeId,
		spec: { ...original.spec, executionPlanId: "f".repeat(64) },
		state: {
			status: "queued",
			progress: null,
			failureReason: null,
			updatedAtMs: original.createdAtMs,
		},
		createdAtMs: original.createdAtMs - 1,
	});
	const initial = await f.app.inject({
		url: "/api/preparations?summary=true",
		headers,
	});
	expect(initial.statusCode).toBe(200);
	expect(initial.json()).toMatchObject({ hasMore: true });
	expect(initial.json().tasks).toHaveLength(1);
	expect(initial.json().tasks[0].id).toBe(activeId);

	const firstPage = await f.app.inject({
		url: "/api/preparations?summary=true&inactiveLimit=10",
		headers,
	});
	expect(firstPage.statusCode).toBe(200);
	expect(firstPage.json()).toMatchObject({ hasMore: true });
	expect(firstPage.json().tasks).toHaveLength(11);
	expect(firstPage.json().tasks[0]).toEqual(initial.json().tasks[0]);

	const complete = await f.app.inject({
		url: "/api/preparations?summary=true&inactiveLimit=106",
		headers,
	});
	expect(complete.statusCode).toBe(200);
	expect(complete.json()).toMatchObject({ hasMore: false });
	expect(complete.json().tasks).toHaveLength(107);

	const invalid = await f.app.inject({
		url: "/api/preparations?summary=true&inactiveLimit=-1",
		headers,
	});
	expect(invalid.statusCode).toBe(400);
});
