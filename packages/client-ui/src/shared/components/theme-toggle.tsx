import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setTheme, useTheme } from "../theme.js";
import { Button } from "./ui/button.js";
import { Tooltip } from "./ui/tooltip.js";

export default function ThemeToggle() {
	const { t } = useTranslation();
	const theme = useTheme();
	const nextTheme = theme === "dark" ? "light" : "dark";

	return (
		<Tooltip content={t("app.switchToMode", { mode: t(`app.${nextTheme}`) })}>
			<Button
				variant="ghost"
				className="size-9 shrink-0 p-0"
				type="button"
				aria-label={t("app.switchToMode", { mode: t(`app.${nextTheme}`) })}
				onClick={() => setTheme(nextTheme)}
			>
				{theme === "dark" ? (
					<Sun size={16} aria-hidden="true" />
				) : (
					<Moon size={16} aria-hidden="true" />
				)}
			</Button>
		</Tooltip>
	);
}
