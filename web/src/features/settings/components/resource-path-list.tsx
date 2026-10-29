import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../../../shared/components/ui/action-button.js";
import { FieldHelp } from "../../../shared/components/ui/field-help.js";
import { Input } from "../../../shared/components/ui/input.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";

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
				<FieldHelp
					label={t("settingsPage.pathHelpLabel")}
					help={t("settingsPage.pathsHelp")}
				/>
			</legend>
			<input type="hidden" name="resourceRoots" value={entries.join("\n")} />
			{entries.length > 0 ? (
				<ul
					aria-label={t("settingsPage.pathLabel")}
					className="max-h-64 min-w-0 space-y-2 overflow-auto"
				>
					{entries.map((path) => (
						<li
							key={path}
							className="action-row flex-nowrap min-w-0 items-center gap-2"
						>
							<Tooltip content={path} openOnClick>
								<Input
									readOnly
									value={path}
									aria-label={path}
									className="min-w-0 flex-1"
								/>
							</Tooltip>
							<ActionButton
								icon={Trash2}
								shortLabel={t("settingsPage.deletePath")}
								label={t("settingsPage.removePath", { path })}
								type="button"
								variant="ghost"
								className="shrink-0 px-2"
								disabled={disabled}
								onClick={() => {
									const next = entries.filter((entry) => entry !== path);
									setEntries(next);
									setError(false);
									console.debug(
										"[ResourceSettings] Resource path removed from draft.",
										{ count: next.length },
									);
								}}
							/>
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
					aria-describedby={
						entries.length >= 64 ? "resource-roots-help" : undefined
					}
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
				<ActionButton
					icon={Plus}
					label={t("settingsPage.addPath")}
					shortLabel={t("actions.add")}
					type="button"
					variant="outline"
					disabled={disabled || !draft.trim() || entries.length >= 64}
					onClick={addPath}
				/>
			</div>
			{error && (
				<p role="alert" className="field-error">
					{t("settingsPage.duplicatePath")}
				</p>
			)}
			{entries.length >= 64 && (
				<p id="resource-roots-help" className="text-sm text-muted-foreground">
					{t("settingsPage.pathsLimitReached")}
				</p>
			)}
		</fieldset>
	);
}
