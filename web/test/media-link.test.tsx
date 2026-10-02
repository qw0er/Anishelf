// @vitest-environment happy-dom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import MediaLink from "../src/components/media-link.js";
import { createMediaLink } from "../src/lib/media-link.js";
import "../src/i18n.js";

const fileId = "file_123";
const file = {
	file: {
		kind: "file" as const,
		id: fileId,
		parentId: "root",
		name: "中文 space % &.mp4",
		sizeBytes: 10,
		modifiedAt: "date",
		mimeType: "video/mp4",
	},
	playbackUrl: `/api/media/${fileId}`,
};
const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
	writeText.mockReset().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	vi.spyOn(api, "getFile").mockResolvedValue(file);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test.each([
	"http://localhost:9000",
	"http://127.0.0.1:3000",
	"https://example.test",
])(
	"uses application origin %s without leaking the filename",
	async (origin) => {
		expect(await createMediaLink(fileId, origin)).toBe(
			`${origin}/api/media/${fileId}`,
		);
	},
);
test.each([
	"https://other.test/api/media/file_123",
	"/api/media/another",
	"/api/media/file_123?path=/secret",
	"//other.test/media",
])("rejects unexpected media route %s", async (playbackUrl) => {
	vi.mocked(api.getFile).mockResolvedValue({ ...file, playbackUrl });
	await expect(
		createMediaLink(fileId, "http://localhost:9000"),
	).rejects.toMatchObject({ kind: "invalid_response" });
});
test("rechecks the file, copies its link and does not touch playback state", async () => {
	const open = vi.spyOn(api, "openPlaybackSession");
	const save = vi.spyOn(api, "savePlaybackProgress");
	render(<MediaLink fileId={fileId} />);
	fireEvent.click(screen.getByRole("button", { name: "Copy media link" }));
	await screen.findByText(/Link copied/);
	expect(writeText).toHaveBeenCalledWith(
		`${window.location.origin}${file.playbackUrl}`,
	);
	expect(api.getFile).toHaveBeenCalledWith(fileId, {
		signal: expect.any(AbortSignal),
	});
	expect(open).not.toHaveBeenCalled();
	expect(save).not.toHaveBeenCalled();
	const input = screen.getByRole<HTMLInputElement>("textbox", {
		name: "Media link",
	});
	expect(input.readOnly).toBe(true);
	fireEvent.focus(input);
	expect(input.selectionEnd).toBe(input.value.length);
});
test.each(["unavailable", "rejected"])(
	"offers manual copying when clipboard is %s",
	async (mode) => {
		if (mode === "unavailable") vi.stubGlobal("navigator", {});
		else writeText.mockRejectedValue(new Error("Denied"));
		render(<MediaLink fileId={fileId} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy media link" }));
		await screen.findByRole("dialog", { name: "Media link" });
		await screen.findByText(/Copy the link below/);
		expect(
			screen.getByRole<HTMLInputElement>("textbox", { name: "Media link" })
				.value,
		).toBe(`${window.location.origin}${file.playbackUrl}`);
	},
);
test("clears a previous link if the source disappears and allows retry", async () => {
	render(<MediaLink fileId={fileId} />);
	const button = screen.getByRole("button", { name: "Copy media link" });
	fireEvent.click(button);
	await screen.findByText(/Link copied/);
	fireEvent.click(
		screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement,
	);
	vi.mocked(api.getFile).mockRejectedValue(
		new api.ApiClientError({
			kind: "http",
			status: 404,
			code: "RESOURCE_MISSING",
			message: "Missing",
		}),
	);
	fireEvent.click(button);
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: "Media link" })).toBeNull();
	expect(writeText).toHaveBeenCalledTimes(1);
	vi.mocked(api.getFile).mockResolvedValue(file);
	fireEvent.click(button);
	await screen.findByText(/Link copied/);
});
test("prevents duplicate requests and cancels on unmount", async () => {
	let signal: AbortSignal | undefined;
	vi.mocked(api.getFile).mockImplementation((_id, options) => {
		signal = options?.signal;
		return new Promise(() => {});
	});
	const view = render(<MediaLink fileId={fileId} />);
	const button = screen.getByRole<HTMLButtonElement>("button", {
		name: "Copy media link",
	});
	fireEvent.click(button);
	fireEvent.click(button);
	await waitFor(() => expect(button.disabled).toBe(true));
	expect(api.getFile).toHaveBeenCalledTimes(1);
	view.unmount();
	expect(signal?.aborted).toBe(true);
	expect(writeText).not.toHaveBeenCalled();
});

test("shows the result in a modal and restores focus when closed", async () => {
	render(<MediaLink fileId={fileId} iconOnly />);
	const button = screen.getByRole<HTMLButtonElement>("button", {
		name: "Copy media link",
	});
	button.focus();
	fireEvent.click(button);
	const modal = await screen.findByRole("dialog", { name: "Media link" });
	expect(
		modal.contains(screen.getByRole("textbox", { name: "Media link" })),
	).toBe(true);
	expect(modal.contains(screen.getByText(/Link copied/))).toBe(true);
	expect(modal.getAttribute("data-state")).toBe("open");
	fireEvent.click(
		screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement,
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await waitFor(() => expect(document.activeElement).toBe(button));
	fireEvent.click(button);
	await screen.findByRole("dialog", { name: "Media link" });
});

test("Escape dismisses the dialog and returns focus to the copy button", async () => {
	render(<MediaLink fileId={fileId} iconOnly />);
	const button = screen.getByRole<HTMLButtonElement>("button", {
		name: "Copy media link",
	});
	button.focus();
	fireEvent.click(button);
	await screen.findByRole("dialog", { name: "Media link" });
	fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await waitFor(() => expect(document.activeElement).toBe(button));
});
