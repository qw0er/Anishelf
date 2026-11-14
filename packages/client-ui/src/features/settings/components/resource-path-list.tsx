import { FolderMinus, FolderOpen, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../../../shared/components/ui/action-button.js";
import { Button } from "../../../shared/components/ui/button.js";
import { FieldHelp } from "../../../shared/components/ui/field-help.js";
import { Input } from "../../../shared/components/ui/input.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";

type PathError = "duplicate" | "chooseFailed";

export function ResourcePathList({
	paths,
	disabled,
	chooseDirectory,
}: {
	paths: readonly string[];
	disabled: boolean;
	chooseDirectory?: (() => Promise<string | null>) | undefined;
}) {
	const { t } = useTranslation();
	const [entries, setEntries] = useState(() => [...paths]);
	const [draft, setDraft] = useState("");
	const [choosing, setChoosing] = useState(false);
	const [error, setError] = useState<PathError | null>(null);

	function appendPath(path: string, source: "manual" | "picker") {
		if (disabled || choosing || !path || entries.length >= 64) return false;
		if (entries.includes(path)) {
			setError("duplicate");
			return false;
		}
		const next = [...entries, path];
		setEntries(next);
		setDraft("");
		setError(null);
		console.debug("[ResourceSettings] Resource path added to draft.", {
			count: next.length,
			source,
		});
		return true;
	}

	function addPath() {
		appendPath(draft.trim(), "manual");
	}

	async function selectDirectory() {
		if (!chooseDirectory || disabled || choosing || entries.length >= 64)
			return;
		setChoosing(true);
		setError(null);
		try {
			const path = await chooseDirectory();
			if (path) appendPath(path, "picker");
		} catch {
			console.warn("[ResourceSettings] Resource directory selection failed.");
			setError("chooseFailed");
		} finally {
			setChoosing(false);
		}
	}

	return (
		<fieldset
			disabled={disabled || choosing}
			className="flex min-w-0 flex-col gap-2"
		>
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
						<li key={path} className="action-row min-w-0">
							<Tooltip content={path} openOnClick>
								<Input
									readOnly
									value={path}
									aria-label={path}
									className="min-w-0 flex-1 basis-48"
								/>
							</Tooltip>
							<ActionButton
								icon={FolderMinus}
								shortLabel={t("settingsPage.deletePath")}
								label={t("settingsPage.removePath", { path })}
								type="button"
								variant="ghost"
								className="w-32 shrink-0 [&>span]:whitespace-nowrap"
								disabled={disabled}
								onClick={() => {
									const next = entries.filter((entry) => entry !== path);
									setEntries(next);
									setError(null);
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
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				<Input
					id="new-resource-path"
					className="min-w-0 flex-1 basis-48"
					value={draft}
					placeholder={t("settingsPage.pathPlaceholder")}
					disabled={disabled || choosing || entries.length >= 64}
					aria-describedby={
						entries.length >= 64 ? "resource-roots-help" : undefined
					}
					aria-invalid={error === "duplicate" || undefined}
					onChange={(event) => {
						setDraft(event.target.value);
						setError(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							addPath();
						}
					}}
				/>
				{chooseDirectory && (
					<Tooltip content={t("settingsPage.chooseDirectory")}>
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="shrink-0"
							aria-label={t("settingsPage.chooseDirectory")}
							disabled={disabled || choosing || entries.length >= 64}
							onClick={() => void selectDirectory()}
						>
							<FolderOpen size={16} aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
				<ActionButton
					icon={Plus}
					label={t("settingsPage.addPath")}
					shortLabel={t("actions.add")}
					type="button"
					variant="outline"
					className="w-32 shrink-0 [&>span]:whitespace-nowrap"
					disabled={
						disabled || choosing || !draft.trim() || entries.length >= 64
					}
					onClick={addPath}
				/>
			</div>
			{error && (
				<p role="alert" className="field-error">
					{t(
						error === "duplicate"
							? "settingsPage.duplicatePath"
							: "settingsPage.choosePathFailed",
					)}
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
