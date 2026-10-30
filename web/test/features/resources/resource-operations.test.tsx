// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../../../src/features/resources/library/api.js";
import { ResourceOperationDialog } from "../../../src/features/resources/library/components/resource-operations.js";
import { ApiClientError } from "../../../src/shared/api/client.js";
import type {
	DirectoryResponse,
	ResourceDto,
} from "../../../src/shared/api/contracts.js";
import i18n from "../../../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";

const entry: ResourceDto = {
	kind: "directory",
	id: "season",
	parentId: "root",
	name: "Season 1",
};
beforeEach(async () => {
	await i18n.changeLanguage("en");
	vi.spyOn(api, "executeResource").mockResolvedValue({
		refreshRequired: false,
	});
	vi.spyOn(api, "getDirectory").mockImplementation(
		async (id): Promise<DirectoryResponse> => ({
			directory: {
				kind: "directory",
				id,
				parentId: id === "root" ? null : "root",
				name: id === "root" ? "Media" : "Archive",
			},
			children:
				id === "root"
					? [
							entry,
							{
								kind: "directory",
								id: "archive",
								parentId: "root",
								name: "Archive",
							},
						]
					: [],
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test("delete executes once after confirming the dialog without a preview step", async () => {
	const onClose = vi.fn();
	render(
		<ResourceOperationDialog entry={entry} action="delete" onClose={onClose} />,
	);
	expect(
		screen.getByText(
			/This folder and all its contents will be permanently deleted/,
		),
	).toBeDefined();
	expect(screen.queryByRole("button", { name: /Preview/ })).toBeNull();
	expect(api.executeResource).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(api.executeResource).toHaveBeenCalledExactlyOnceWith({
		id: "season",
		action: "delete",
	});
});

test("move executes directly into the selected destination", async () => {
	const onClose = vi.fn();
	render(
		<ResourceOperationDialog entry={entry} action="move" onClose={onClose} />,
	);
	await screen.findByRole("button", { name: "Archive" });
	expect(
		(screen.getByRole("button", { name: "Confirm move" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(screen.queryByRole("button", { name: "Season 1" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Archive" }));
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Confirm move",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Parent directory" }));
	await screen.findByRole("button", { name: "Archive" });
	expect(api.executeResource).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Archive" }));
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Confirm move",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(api.executeResource).toHaveBeenCalledExactlyOnceWith({
		id: "season",
		action: "move",
		destinationId: "archive",
	});
});

test("a failed command keeps the dialog open for correction and retry", async () => {
	vi.mocked(api.executeResource).mockRejectedValue(
		new ApiClientError({
			kind: "http",
			code: "RESOURCE_CONFLICT",
			status: 409,
			message: "Changed",
		}),
	);
	const onClose = vi.fn();
	render(
		<ResourceOperationDialog entry={entry} action="delete" onClose={onClose} />,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Delete permanently" }),
	);
	await screen.findByRole("alert");
	expect(
		screen.getByRole("button", { name: "Delete permanently" }),
	).toBeDefined();
	expect(onClose).not.toHaveBeenCalled();
});

test("an executing deletion cannot close or submit twice", async () => {
	let release = () => {};
	vi.mocked(api.executeResource).mockImplementation(
		() =>
			new Promise((resolve) => {
				release = () => resolve({ refreshRequired: false });
			}),
	);
	const onClose = vi.fn();
	render(
		<ResourceOperationDialog entry={entry} action="delete" onClose={onClose} />,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Delete permanently" }),
	);
	await waitFor(() => expect(api.executeResource).toHaveBeenCalledOnce());
	expect(
		(screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
	fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
	expect(onClose).not.toHaveBeenCalled();
	release();
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
