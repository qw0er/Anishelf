import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	setThemePreference,
	type ThemePreference,
	useThemePreference,
} from "../theme.js";
import { Button } from "./ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import { Tooltip } from "./ui/tooltip.js";

const themeOptions = [
	{ value: "system", labelKey: "app.themeSystem", icon: Monitor },
	{ value: "light", labelKey: "app.themeLight", icon: Sun },
	{ value: "dark", labelKey: "app.themeDark", icon: Moon },
] as const satisfies readonly {
	value: ThemePreference;
	labelKey: "app.themeSystem" | "app.themeLight" | "app.themeDark";
	icon: typeof Monitor;
}[];

export default function ThemeToggle() {
	const { t } = useTranslation();
	const preference = useThemePreference();
	const current =
		themeOptions.find((option) => option.value === preference) ??
		themeOptions[0];
	const CurrentIcon = current.icon;
	const label = t("app.changeTheme");

	return (
		<DropdownMenu>
			<Tooltip content={label}>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							className="size-9 shrink-0 p-0"
							type="button"
							aria-label={label}
						/>
					}
				>
					<CurrentIcon className="size-4" aria-hidden="true" />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent>
				{themeOptions.map((option) => {
					const OptionIcon = option.icon;
					const selected = option.value === preference;
					return (
						<DropdownMenuItem
							key={option.value}
							aria-current={selected ? "true" : undefined}
							onClick={() => setThemePreference(option.value)}
						>
							<Check
								className={selected ? "size-4 opacity-100" : "size-4 opacity-0"}
								aria-hidden="true"
							/>
							<OptionIcon className="size-4" aria-hidden="true" />
							{t(option.labelKey)}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
