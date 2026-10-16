// @vitest-environment happy-dom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import {
	clearTrackingOperationNotices,
	reportTrackingOperations,
} from "../src/features/anime/tracking/operations.js";
import type { TrackingOperationResponse } from "../src/shared/api/contracts.js";
import { toast } from "../src/shared/components/ui/toast.js";

const identity = { accountId: 7, generation: "one" };
function completed(): TrackingOperationResponse {
	return {
		id: "operation",
		accountId: 7,
		mediaId: 9,
		revision: 1,
		baseline: null,
		desired: { progress: 1 },
		state: "succeeded",
		remote: { id: 1, progress: 1, status: "CURRENT", updatedAt: 1 },
		attempts: 1,
		retryAt: null,
		error: null,
		updatedAt: 1,
		completion: true,
	};
}
afterEach(() => vi.restoreAllMocks());
test("reports a playback operation completed between polls once and refreshes confirmed state", () => {
	const client = new QueryClient();
	const notify = vi.spyOn(toast, "add").mockReturnValue("notice");
	const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
	reportTrackingOperations(client, identity, []);
	reportTrackingOperations(client, identity, [completed()]);
	reportTrackingOperations(client, identity, [completed()]);
	expect(notify).toHaveBeenCalledTimes(1);
	expect(notify).toHaveBeenCalledWith(
		expect.objectContaining({ type: "success" }),
	);
	expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tracking", "entry"] });
	client.clear();
});
test("does not replay old completed notices on first read or after account replacement", () => {
	const client = new QueryClient();
	const notify = vi.spyOn(toast, "add").mockReturnValue("notice");
	reportTrackingOperations(client, identity, [completed()]);
	clearTrackingOperationNotices(client, identity.generation);
	reportTrackingOperations(client, { accountId: 8, generation: "two" }, [
		{ ...completed(), accountId: 8 },
	]);
	expect(notify).not.toHaveBeenCalled();
	client.clear();
});
