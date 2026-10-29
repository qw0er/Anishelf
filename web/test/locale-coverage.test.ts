import { expect, test } from "vitest";
import en from "../src/shared/locales/en.json" with { type: "json" };
import zhCN from "../src/shared/locales/zh-CN.json" with { type: "json" };

test("Chinese covers English messages and preserves interpolation and markup", () => {
	function check(
		english: Record<string, unknown>,
		chinese: Record<string, unknown>,
	) {
		for (const [key, value] of Object.entries(english)) {
			// Chinese uses only the CLDR 'other' plural form.
			if (key.endsWith("_one")) continue;
			const translated = chinese[key];
			if (typeof value === "string") {
				expect(translated, key).toBeTypeOf("string");
				const tokens = (text: string) =>
					(text.match(/\{\{[^}]+\}\}|<\/?\w+>/g) ?? []).sort();
				expect(tokens(translated as string), key).toEqual(tokens(value));
			} else {
				expect(translated, key).toBeTypeOf("object");
				check(
					value as Record<string, unknown>,
					translated as Record<string, unknown>,
				);
			}
		}
	}
	check(en, zhCN);
});
