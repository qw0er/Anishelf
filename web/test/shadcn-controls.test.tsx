// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { Checkbox } from "../src/shared/components/ui/checkbox.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../src/shared/components/ui/collapsible.js";
import { FieldLabel } from "../src/shared/components/ui/field.js";
import { Input } from "../src/shared/components/ui/input.js";
import {
	NativeSelect,
	NativeSelectOption,
} from "../src/shared/components/ui/native-select.js";
import { Progress } from "../src/shared/components/ui/progress.js";
import { RadioOptions } from "../src/shared/components/ui/radio-options.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";
import "../src/shared/i18n.js";

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

test("radio choices support arrow navigation and submit exactly one selected value", async () => {
	render(<Choices />);
	const first = screen.getByRole("radio", { name: "First" });
	first.focus();
	fireEvent.keyDown(first, { key: "ArrowRight" });
	await waitFor(() =>
		expect(
			screen
				.getByRole("radio", { name: "Second" })
				.getAttribute("aria-checked"),
		).toBe("true"),
	);
	const form = screen.getByRole("form", {
		name: "Preferences",
	}) as HTMLFormElement;
	expect([...new FormData(form).values()]).toEqual(["second"]);
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

test("native select preserves browser validation and form submission", () => {
	render(
		<form aria-label="Destination">
			<label htmlFor="destination">Destination</label>
			<NativeSelect
				id="destination"
				name="destination"
				defaultValue=""
				required
			>
				<NativeSelectOption value="">Choose</NativeSelectOption>
				<NativeSelectOption value="media">Media</NativeSelectOption>
			</NativeSelect>
		</form>,
	);
	const form = screen.getByRole("form", {
		name: "Destination",
	}) as HTMLFormElement;
	expect(form.checkValidity()).toBe(false);
	fireEvent.change(screen.getByRole("combobox", { name: "Destination" }), {
		target: { value: "media" },
	});
	expect(form.checkValidity()).toBe(true);
	expect(new FormData(form).get("destination")).toBe("media");
});

test("confirmation checkbox submits consent only while checked", () => {
	render(
		<form aria-label="Consent">
			<Checkbox id="consent" name="consent" />
			<FieldLabel htmlFor="consent">Confirm replacement</FieldLabel>
		</form>,
	);
	const form = screen.getByRole("form", { name: "Consent" }) as HTMLFormElement;
	const checkbox = screen.getByRole("checkbox", {
		name: "Confirm replacement",
	});
	expect(new FormData(form).has("consent")).toBe(false);
	fireEvent.click(checkbox);
	expect(checkbox.getAttribute("aria-checked")).toBe("true");
	expect(new FormData(form).get("consent")).toBe("on");
	fireEvent.click(checkbox);
	expect(new FormData(form).has("consent")).toBe(false);
});
test("progress retains its actual measurement range", () => {
	render(<Progress aria-label="Download" value={0.4} max={1} />);
	const progress = screen.getByRole("progressbar", { name: "Download" });
	expect(progress.getAttribute("aria-valuenow")).toBe("0.4");
	expect(progress.getAttribute("aria-valuemax")).toBe("1");
});
