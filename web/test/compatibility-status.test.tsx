// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { CompatibilityResult } from "../src/api/contracts.js";
import { CompatibilityStatus } from "../src/features/library/components/compatibility-status.js";
import "../src/i18n.js";

afterEach(cleanup);

test.each([
	[
		"supported",
		"This browser reports support for this file.",
		"browser-supported",
	],
	[
		"unsupported",
		"This file is not supported by this browser.",
		"browser-rejected",
	],
	[
		"unknown",
		"Playback compatibility could not be confirmed.",
		"browser-uncertain",
	],
] as const)(
	"%s compatibility is visible with an accessible icon and explanatory tooltip",
	async (status, label, reason) => {
		const view = render(
			<CompatibilityStatus
				loading={false}
				error={null}
				result={{ direct: { status, reason } } as CompatibilityResult}
			/>,
		);
		const indicator = view.getByRole("button", { name: label });
		expect(indicator.querySelector("svg")).toBeTruthy();
		expect(indicator.textContent).toBe("");
		fireEvent.focus(indicator);
		await waitFor(() =>
			expect(
				document.querySelector('[data-slot="tooltip-content"]')?.textContent,
			).toContain(label),
		);
		expect(
			document
				.querySelector('[data-slot="tooltip-content"]')
				?.querySelectorAll("p").length,
		).toBe(2);
	},
);

test("checking uses Spinner and failure remains distinct from unknown support", () => {
	const view = render(
		<CompatibilityStatus loading result={null} error={null} />,
	);
	const pending = view.getByRole("button", {
		name: "Checking playback compatibility…",
	});
	expect(pending.getAttribute("aria-busy")).toBe("true");
	expect(pending.querySelector("svg.animate-spin")).toBeTruthy();
	view.rerender(
		<CompatibilityStatus
			loading={false}
			result={null}
			error={new Error("Failed")}
		/>,
	);
	expect(
		view
			.getByRole("button", {
				name: "Compatibility could not be checked. You can retry or try the original file.",
			})
			.querySelector("svg.animate-spin"),
	).toBeNull();
	expect(
		view.queryByRole("button", {
			name: "Playback compatibility could not be confirmed.",
		}),
	).toBeNull();
});

test("prepared copy has a distinct neutral icon and retains original support in the tooltip", async () => {
	const view = render(
		<CompatibilityStatus
			loading={false}
			error={null}
			prepared
			result={
				{
					direct: { status: "unsupported", reason: "browser-rejected" },
				} as CompatibilityResult
			}
		/>,
	);
	const indicator = view.getByRole("button", {
		name: "A pre-transcoded copy is ready.",
	});
	expect(indicator.querySelector("svg.lucide-file-check-2")).toBeTruthy();
	expect(indicator.className).toContain("text-muted-foreground");
	fireEvent.focus(indicator);
	await waitFor(() =>
		expect(
			document.querySelector('[data-slot="tooltip-content"]')?.textContent,
		).toContain("This file is not supported by this browser."),
	);
});
