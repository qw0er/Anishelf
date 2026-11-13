// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../../src/shared/components/ui/collapsible.js";
import { Input } from "../../../src/shared/components/ui/input.js";
import { RadioOptions } from "../../../src/shared/components/ui/radio-options.js";
import "../../../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
} from "../../support/query-test-utils.js";

afterEach(cleanup);

function Choices() {
	const [value, setValue] = useState("first");
	return (
		<form aria-label="Preferences">
			<RadioOptions
				legend="Mode"
				value={value}
				onChange={setValue}
				options={[
					{ value: "first", label: "First" },
					{ value: "second", label: "Second" },
				]}
			/>
			<output>{value}</output>
		</form>
	);
}

test("radio options report the selected value and submit one named choice", () => {
	render(<Choices />);
	fireEvent.click(screen.getByRole("radio", { name: "Second" }));
	expect(screen.getByRole("status").textContent).toBe("second");
	const form = screen.getByRole("form", {
		name: "Preferences",
	}) as HTMLFormElement;
	expect([...new FormData(form)]).toEqual([[expect.any(String), "second"]]);
});

test("collapsing a disclosure preserves its editable draft and exposes expansion state", () => {
	render(
		<Collapsible defaultOpen>
			<CollapsibleTrigger>Connection</CollapsibleTrigger>
			<CollapsibleContent keepMounted>
				<Input aria-label="Endpoint" defaultValue="saved" />
			</CollapsibleContent>
		</Collapsible>,
	);
	const trigger = screen.getByRole("button", { name: "Connection" });
	const input = screen.getByRole("textbox", { name: "Endpoint" });
	fireEvent.change(input, { target: { value: "draft" } });
	fireEvent.click(trigger);
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
	expect(input.isConnected).toBe(true);
	fireEvent.click(trigger);
	expect(screen.getByRole("textbox", { name: "Endpoint" })).toBe(input);
	expect((input as HTMLInputElement).value).toBe("draft");
});
