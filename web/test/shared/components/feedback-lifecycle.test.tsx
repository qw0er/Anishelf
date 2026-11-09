// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FieldError } from "../../../src/shared/components/ui/field.js";
import {
	createToastManager,
	Toaster,
} from "../../../src/shared/components/ui/toast.js";
import "../../../src/shared/i18n.js";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

test("errors and partial results persist, recovery replaces them with expiring success", async () => {
	vi.useFakeTimers();
	const manager = createToastManager();
	const closed = vi.fn();
	render(<Toaster toastManager={manager} />);
	act(() => {
		manager.add({
			id: "save",
			type: "error",
			title: "Save failed",
			actionProps: { children: "Retry", onClick: () => {} },
			onClose: closed,
			timeout: 10000,
		});
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(20000);
	});
	expect(screen.getByText("Save failed")).toBeTruthy();
	act(() => {
		manager.update("save", { type: "success", title: "Saved" });
	});
	expect(screen.getByText("Saved")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(6000);
	});
	expect(closed).toHaveBeenCalledOnce();
	act(() => {
		manager.add({
			id: "batch",
			type: "warning",
			title: "Some files failed",
			description: "Failure details",
			actionProps: { children: "Retry", onClick: () => {} },
			timeout: 0,
		});
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(20000);
	});
	expect(screen.getByText("Some files failed")).toBeTruthy();
	act(() => {
		manager.add({ id: "batch", type: "success", title: "All files deleted" });
	});
	expect(screen.getByText("All files deleted")).toBeTruthy();
	expect(screen.queryByText("Failure details")).toBeNull();
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	act(() => {
		manager.close("batch");
	});
	expect(
		screen
			.getByText("All files deleted")
			.closest("[data-slot=toast]")
			?.hasAttribute("data-ending-style"),
	).toBe(true);
});

test("validation keeps a silent mounted slot before and after correction", () => {
	const view = render(<FieldError id="validation" />);
	const slot = view.container.querySelector("#validation");
	expect(slot).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
	view.rerender(<FieldError id="validation">Enter a valid URL.</FieldError>);
	expect(screen.getByRole("alert")).toBe(slot);
	view.rerender(<FieldError id="validation" />);
	expect(view.container.querySelector("#validation")).toBe(slot);
	expect(screen.queryByRole("alert")).toBeNull();
});
