import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/components/ui/button.js";
import { Input } from "../../../shared/components/ui/input.js";

export function ResourcePathList({
	paths,
	disabled,
}: {
	paths: readonly string[];
	disabled: boolean;
}) {
	const { t } = useTranslation();
	const [entries, setEntries] = useState(() => [...paths]);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState(false);
	function addPath() {
		const path = draft.trim();
		if (disabled || !path || entries.length >= 64) return;
		if (entries.includes(path)) {
			setError(true);
			return;
		}
		const next = [...entries, path];
		setEntries(next);
		setDraft("");
		setError(false);
		console.debug("[ResourceSettings] Resource path added to draft.", {
			count: next.length,
		});
	}
	return (
		<fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
			<legend className="mb-2 text-sm font-medium">
				{t("settingsPage.pathLabel")}
			</legend>
			<input type="hidden" name="resourceRoots" value={entries.join("\n")} />
			{entries.length > 0 ? (
				<ul
					aria-label={t("settingsPage.pathLabel")}
					className="min-w-0 divide-y rounded-lg border"
				>
					{entries.map((path) => (
						<li
							key={path}
							className="flex min-w-0 items-center gap-3 px-3 py-2"
						>
							<span className="min-w-0 flex-1 break-all text-sm">{path}</span>
							<Button
								type="button"
								variant="ghost"
								className="shrink-0 px-2"
								disabled={disabled}
								aria-label={t("settingsPage.removePath", { path })}
								onClick={() => {
									const next = entries.filter((entry) => entry !== path);
									setEntries(next);
									setError(false);
									console.debug(
										"[ResourceSettings] Resource path removed from draft.",
										{ count: next.length },
									);
								}}
							>
								<Trash2 size={16} aria-hidden="true" />
								{t("settingsPage.deletePath")}
							</Button>
						</li>
					))}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">
					{t("settingsPage.noPaths")}
				</p>
			)}
			<label htmlFor="new-resource-path" className="sr-only">
				{t("settingsPage.newPathLabel")}
			</label>
			<div className="flex min-w-0 items-center gap-2">
				<Input
					id="new-resource-path"
					className="min-w-0 flex-1"
					value={draft}
					placeholder={t("settingsPage.pathPlaceholder")}
					disabled={disabled || entries.length >= 64}
					aria-describedby="resource-roots-help"
					aria-invalid={error || undefined}
					onChange={(event) => {
						setDraft(event.target.value);
						setError(false);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							addPath();
						}
					}}
				/>
				<Button
					type="button"
					variant="outline"
					className="shrink-0"
					disabled={disabled || !draft.trim() || entries.length >= 64}
					onClick={addPath}
				>
					<Plus size={16} aria-hidden="true" />
					{t("settingsPage.addPath")}
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{t("settingsPage.duplicatePath")}
				</p>
			)}
			<p id="resource-roots-help" className="text-sm text-muted-foreground">
				{t(
					entries.length >= 64
						? "settingsPage.pathsLimitReached"
						: "settingsPage.pathsHelp",
				)}
			</p>
		</fieldset>
	);
}
