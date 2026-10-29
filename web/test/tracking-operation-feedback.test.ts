// @vitest-environment happy-dom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import {
	clearTrackingOperationNotices,
	reportTrackingOperations,
} from "../src/features/anime/tracking/operations.js";
import type { TrackingOperationResponse } from "../src/shared/api/contracts.js";
import { toast } from "../src/shared/components/ui/toast.js";

const identity = { accountId: "anilist:7", generation: "one" };
function completed(): TrackingOperationResponse {
	return {
		id: "operation",
		accountId: "anilist:7",
		mediaId: "anilist:anime:9",
		revision: 1,
		baseline: null,
		desired: { progress: 1 },
		state: "succeeded",
		remote: { id: "anilist:1", progress: 1, status: "watching", updatedAt: 1 },
		attempts: 1,
		retryAt: null,
		error: null,
		updatedAt: 1,
		origin: "automatic",
		commandId: "command",
		intentAt: 1,
		target: null,
		decisionReason: null,
	};
}
afterEach(() => vi.restoreAllMocks());
test("silently refreshes confirmed state when a playback operation completes", () => {
	const client = new QueryClient();
	const notify = vi.spyOn(toast, "add").mockReturnValue("notice");
	const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
	reportTrackingOperations(client, identity, []);
	reportTrackingOperations(client, identity, [completed()]);
	reportTrackingOperations(client, identity, [completed()]);
	expect(notify).not.toHaveBeenCalled();
	expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tracking", "entry"] });
	client.clear();
});
test("does not replay old completed notices on first read or after account replacement", () => {
	const client = new QueryClient();
	const notify = vi.spyOn(toast, "add").mockReturnValue("notice");
	reportTrackingOperations(client, identity, [completed()]);
	clearTrackingOperationNotices(client, identity.generation);
	reportTrackingOperations(
		client,
		{ accountId: "anilist:8", generation: "two" },
		[{ ...completed(), accountId: "anilist:8" }],
	);
	expect(notify).not.toHaveBeenCalled();
	client.clear();
});

test("shows pending feedback and an actionable failure, and clears it after success", () => {
	const client = new QueryClient();
	const notify = vi.spyOn(toast, "add").mockReturnValue("notice");
	const close = vi.spyOn(toast, "close");
	const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
	reportTrackingOperations(client, identity, [
		{ ...completed(), state: "pending" },
	]);
	expect(notify).toHaveBeenCalledWith(
		expect.objectContaining({ type: "loading" }),
	);
	notify.mockClear();
	const failed = {
		...completed(),
		state: "failed" as const,
		error: "provider-unavailable" as const,
		revision: 2,
	};
	reportTrackingOperations(client, identity, [failed]);
	reportTrackingOperations(client, identity, [failed]);
	expect(notify).toHaveBeenCalledTimes(1);
	expect(notify).toHaveBeenCalledWith(
		expect.objectContaining({ type: "error" }),
	);
	reportTrackingOperations(client, identity, [{ ...completed(), revision: 3 }]);
	expect(close).toHaveBeenCalledWith("tracking-operation:operation");
	expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tracking", "entry"] });
	expect(notify).toHaveBeenCalledTimes(1);
	client.clear();
});

test("reports manual submission progress and completion without replaying old results", () => {
	const client = new QueryClient();
	const notify = vi.spyOn(toast, "add").mockReturnValue("notice");
	const manual = { ...completed(), origin: "manual-detail" as const };
	reportTrackingOperations(client, identity, [{ ...manual, state: "pending" }]);
	expect(notify).toHaveBeenLastCalledWith(
		expect.objectContaining({ type: "loading", timeout: 0 }),
	);
	reportTrackingOperations(client, identity, [{ ...manual, revision: 2 }]);
	expect(notify).toHaveBeenLastCalledWith(
		expect.objectContaining({ type: "success" }),
	);
	reportTrackingOperations(client, identity, [{ ...manual, revision: 2 }]);
	expect(notify).toHaveBeenCalledTimes(2);
	client.clear();
});
