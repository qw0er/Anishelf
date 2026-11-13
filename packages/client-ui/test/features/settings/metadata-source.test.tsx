// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { MetadataSourceSettings } from "../../../src/features/settings/components/metadata-source-settings.js";
import * as api from "../../../src/shared/api/client.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import { queryClient } from "../../setup.js";
import "../../../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
});
test("saves the default metadata source independently of library configuration", async () => {
	vi.spyOn(toast, "add").mockReturnValue("saved");
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (_path, method, _options, body) =>
			method === "PUT"
				? { resourceRoots: [], ...(body as object) }
				: { resourceRoots: [] },
		);
	render(<MetadataSourceSettings />);
	const source = await screen.findByLabelText("Source");
	await waitFor(() => expect(source.hasAttribute("disabled")).toBe(false));
	fireEvent.change(source, { target: { value: "bangumi" } });
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith("/api/settings", "PUT", undefined, {
			defaultMetadataProvider: "bangumi",
		}),
	);
	await waitFor(() =>
		expect((source as HTMLSelectElement).value).toBe("bangumi"),
	);
});

test("saves title preference and refreshes cached page projections", async () => {
	vi.spyOn(toast, "add").mockReturnValue("saved");
	const invalidate = vi.spyOn(queryClient, "invalidateQueries");
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (_path, method, _options, body) =>
			method === "PUT"
				? { resourceRoots: [], ...(body as object) }
				: { resourceRoots: [] },
		);
	render(<MetadataSourceSettings />);
	const select = await screen.findByLabelText("Title display preference");
	await waitFor(() => expect(select.hasAttribute("disabled")).toBe(false));
	expect((select as HTMLSelectElement).value).toBe("native");
	fireEvent.change(select, { target: { value: "chinese" } });
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith("/api/settings", "PUT", undefined, {
			titleDisplayPreference: "chinese",
		}),
	);
	await waitFor(() =>
		expect((select as HTMLSelectElement).value).toBe("chinese"),
	);
	expect(invalidate).toHaveBeenCalled();
});
test("keeps the saved title preference after persistence failure", async () => {
	const notification = vi.spyOn(toast, "add").mockReturnValue("failed");
	vi.spyOn(api, "request").mockImplementation(async (_path, method) => {
		if (method === "PUT") throw new Error("save failed");
		return { resourceRoots: [], titleDisplayPreference: "english" };
	});
	render(<MetadataSourceSettings />);
	const select = await screen.findByLabelText("Title display preference");
	await waitFor(() => expect(select.hasAttribute("disabled")).toBe(false));
	fireEvent.change(select, { target: { value: "chinese" } });
	await waitFor(() =>
		expect(notification).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error" }),
		),
	);
	expect((select as HTMLSelectElement).value).toBe("english");
});
