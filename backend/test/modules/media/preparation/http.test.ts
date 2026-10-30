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

test("task list defaults to ten records and More expands to one hundred", async () => {
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
	const initial = await f.app.inject({
		url: "/api/preparations?summary=true",
		headers,
	});
	expect(initial.statusCode).toBe(200);
	expect(initial.json().tasks).toHaveLength(10);
	const expanded = await f.app.inject({
		url: "/api/preparations?summary=true&more=true",
		headers,
	});
	expect(expanded.statusCode).toBe(200);
	expect(expanded.json().tasks).toHaveLength(100);
	expect(expanded.json().tasks.slice(0, 10)).toEqual(initial.json().tasks);
});
