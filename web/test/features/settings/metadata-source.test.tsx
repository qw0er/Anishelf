// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { MetadataSourceSettings } from "../../../src/features/settings/components/metadata-source-settings.js";
import * as api from "../../../src/shared/api/client.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
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
