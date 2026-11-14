// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { ResourcePathList } from "../../../src/features/settings/components/resource-path-list.js";
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
	vi.restoreAllMocks();
});

test("adds a directory selected with the native picker", async () => {
	const chooseDirectory = vi.fn().mockResolvedValue("/media/anime");
	render(
		<ResourcePathList
			paths={[]}
			disabled={false}
			chooseDirectory={chooseDirectory}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Choose directory" }));

	await waitFor(() =>
		expect(screen.getByRole("textbox", { name: "/media/anime" })).toBeTruthy(),
	);
	expect(chooseDirectory).toHaveBeenCalledOnce();
	expect(
		(document.querySelector('input[name="resourceRoots"]') as HTMLInputElement)
			.value,
	).toBe("/media/anime");
});

test("reports duplicate and picker failures without adding another entry", async () => {
	const chooseDirectory = vi
		.fn()
		.mockResolvedValueOnce("/media/anime")
		.mockResolvedValueOnce("/media/anime")
		.mockRejectedValueOnce(new Error("unavailable"));
	render(
		<ResourcePathList
			paths={[]}
			disabled={false}
			chooseDirectory={chooseDirectory}
		/>,
	);

	const choose = () =>
		fireEvent.click(screen.getByRole("button", { name: "Choose directory" }));
	choose();
	await screen.findByRole("textbox", { name: "/media/anime" });

	choose();
	await screen.findByText("This directory is already in the list.");

	choose();
	await screen.findByText("Could not open the directory picker.");
	expect(screen.getAllByRole("textbox", { name: "/media/anime" })).toHaveLength(
		1,
	);
});

test("keeps manual entry when the host has no directory picker", () => {
	render(<ResourcePathList paths={[]} disabled={false} />);
	expect(screen.queryByRole("button", { name: "Choose directory" })).toBeNull();
});
