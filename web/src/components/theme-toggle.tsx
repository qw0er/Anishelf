import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button.js";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(getInitialTheme);
	const nextTheme = theme === "dark" ? "light" : "dark";

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const applyTheme = (next: Theme) => {
			document.documentElement.classList.toggle("dark", next === "dark");
			document.documentElement.style.colorScheme = next;
		};
		const followSystemTheme = (event: MediaQueryListEvent) => {
			setTheme(event.matches ? "dark" : "light");
		};

		applyTheme(theme);
		media.addEventListener("change", followSystemTheme);
		return () => media.removeEventListener("change", followSystemTheme);
	}, [theme]);

	function selectTheme() {
		setTheme(nextTheme);
	}

	return (
		<Button
			variant="ghost"
			className="px-3"
			type="button"
			aria-label={`Switch to ${nextTheme} mode`}
			title={`Switch to ${nextTheme} mode`}
			onClick={selectTheme}
		>
			{theme === "dark" ? (
				<Sun aria-hidden="true" />
			) : (
				<Moon aria-hidden="true" />
			)}
		</Button>
	);
}
