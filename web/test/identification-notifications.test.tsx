// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { IdentificationStatus } from "../src/features/anime/identification-status.js";
import { queryClient } from "../src/shared/api/query-client.js";
import { toast } from "../src/shared/components/ui/toast.js";
import { act, cleanup, render, waitFor } from "./query-test-utils.js";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/features/anime/metadata/api.js", () => ({
	getIdentificationStatus: () => new Promise(() => {}),
}));
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
const key = ["identification", ""];

test("background recognition uses one persistent Toast and updates it on completion", async () => {
	const add = vi
		.spyOn(toast, "add")
		.mockReturnValue("automatic-identification");
	const update = vi.spyOn(toast, "update").mockImplementation(() => {});
	vi.spyOn(toast, "close").mockImplementation(() => {});
	const invalidate = vi.spyOn(queryClient, "invalidateQueries");
	queryClient.setQueryData(key, { running: false, failed: false });
	const view = render(<IdentificationStatus />);
	expect(add).not.toHaveBeenCalled();
	await act(async () => {
		queryClient.setQueryData(key, { running: true, failed: false });
	});
	await waitFor(() =>
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({ type: "loading", timeout: 0 }),
		),
	);
	view.rerender(<IdentificationStatus />);
	expect(add).toHaveBeenCalledTimes(1);
	expect(view.container.textContent).toBe("");
	await act(async () => {
		queryClient.setQueryData(key, { running: false, failed: false });
	});
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith(
			"automatic-identification",
			expect.objectContaining({
				type: "success",
				title: "review.identificationCompleted",
			}),
		),
	);
	expect(invalidate).toHaveBeenCalledWith({ queryKey: ["catalog"] });
	expect(invalidate).toHaveBeenCalledWith({ queryKey: ["anime-library"] });
});

test("failed recognition emits one error notification and cleans it up on unmount", async () => {
	const add = vi
		.spyOn(toast, "add")
		.mockReturnValue("automatic-identification");
	const close = vi.spyOn(toast, "close").mockImplementation(() => {});
	queryClient.setQueryData(key, { running: false, failed: true });
	const view = render(<IdentificationStatus />);
	await waitFor(() =>
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "review.identificationFailed",
			}),
		),
	);
	view.rerender(<IdentificationStatus />);
	expect(add).toHaveBeenCalledTimes(1);
	view.unmount();
	expect(close).toHaveBeenCalledWith("automatic-identification");
});
