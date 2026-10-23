import { Check, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	defaultLanguage,
	isSupportedLanguage,
	supportedLanguages,
} from "../config/languages.js";
import { setLanguage } from "../i18n.js";
import { Button } from "./ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import { Tooltip } from "./ui/tooltip.js";

export default function LanguageToggle() {
	const { t, i18n } = useTranslation();
	const active = isSupportedLanguage(i18n.resolvedLanguage)
		? i18n.resolvedLanguage
		: defaultLanguage;
	const current =
		supportedLanguages.find((language) => language.code === active) ??
		supportedLanguages[0];
	const label = t("app.changeLanguage");

	return (
		<DropdownMenu>
			<Tooltip content={label}>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							className="h-9 shrink-0 gap-1 px-2"
							type="button"
							aria-label={label}
						/>
					}
				>
					<Languages className="size-4" aria-hidden="true" />
					<span className="text-xs font-medium" aria-hidden="true">
						{current.shortLabel}
					</span>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent>
				{supportedLanguages.map((language) => (
					<DropdownMenuItem
						key={language.code}
						aria-current={language.code === active ? "true" : undefined}
						onClick={() => void setLanguage(language.code)}
					>
						<Check
							className={
								language.code === active
									? "size-4 opacity-100"
									: "size-4 opacity-0"
							}
							aria-hidden="true"
						/>
						{language.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
