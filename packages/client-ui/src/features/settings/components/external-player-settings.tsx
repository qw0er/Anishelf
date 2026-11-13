import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../../../shared/components/ui/action-button.js";
import { Button } from "../../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { Field } from "../../../shared/components/ui/field.js";
import { FieldHelp } from "../../../shared/components/ui/field-help.js";
import { Input } from "../../../shared/components/ui/input.js";
import { Textarea } from "../../../shared/components/ui/textarea.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";
import type { ExternalPlayerDraft } from "../../../shared/platform.js";
import { externalPlayerPolicy } from "../external-player-policy.js";
import { useExternalPlayers } from "../hooks/use-external-players.js";

function parseArgumentLines(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

export function ExternalPlayerSettings() {
	const { t } = useTranslation();
	const players = useExternalPlayers();
	const command = players.mode === "command";
	const [name, setName] = useState("");
	const [template, setTemplate] = useState("");
	const [executable, setExecutable] = useState("");
	const [argumentsText, setArgumentsText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const full =
		players.custom.length >= externalPlayerPolicy.maximumCustomPlayers;

	async function save(draft: ExternalPlayerDraft): Promise<boolean> {
		setPending(true);
		try {
			await players.add(draft);
			console.debug("[Settings] External player added.", {
				mode: players.mode,
				count: players.custom.length + 1,
			});
			toast.add({
				id: "external-players-save",
				type: "success",
				title: t("externalPlayers.added"),
			});
			setError(null);
			return true;
		} catch {
			console.warn("[Settings] External player could not be saved.", {
				mode: players.mode,
			});
			toast.add({
				id: "external-players-save",
				type: "error",
				title: t(
					command
						? "externalPlayers.commandSaveError"
						: "externalPlayers.saveError",
				),
			});
			return false;
		} finally {
			setPending(false);
		}
	}

	async function remove(player: { id: string; name: string }) {
		setPending(true);
		try {
			await players.remove(player.id);
			console.debug("[Settings] External player removed.", {
				mode: players.mode,
				count: players.custom.length - 1,
			});
			toast.add({
				id: "external-players-save",
				type: "success",
				title: t("externalPlayers.removed"),
			});
			setError(null);
		} catch {
			console.warn("[Settings] External player removal could not be saved.", {
				mode: players.mode,
			});
			toast.add({
				id: "external-players-save",
				type: "error",
				title: t(
					command
						? "externalPlayers.commandSaveError"
						: "externalPlayers.saveError",
				),
			});
		} finally {
			setPending(false);
		}
	}

	async function chooseExecutable() {
		if (!players.chooseExecutable) return;
		try {
			const path = await players.chooseExecutable();
			if (path) {
				setExecutable(path);
				setError(null);
				console.debug("[Settings] External player executable selected.");
			}
		} catch {
			console.warn("[Settings] External player executable selection failed.");
			toast.add({
				id: "external-players-executable",
				type: "error",
				title: t("externalPlayers.chooseExecutableFailed"),
			});
		}
	}

	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("externalPlayers.title")}</CardTitle>
				<CardDescription>
					{t(
						command
							? "externalPlayers.commandDescription"
							: "externalPlayers.description",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{players.error && (
					<p role="alert" className="field-error sm:col-span-2">
						{t(
							command
								? "externalPlayers.commandStorageError"
								: "externalPlayers.storageError",
						)}
					</p>
				)}
				{players.custom.length > 0 && (
					<ul className="max-h-64 divide-y overflow-auto">
						{players.custom.map((player) => (
							<li
								key={player.id}
								className="action-row flex-nowrap min-w-0 items-center gap-3 py-2"
							>
								<div className="min-w-0 flex-1 basis-40">
									<Tooltip content={players.describe(player)} openOnClick>
										<button
											type="button"
											className="max-w-full truncate rounded text-left text-sm font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50"
										>
											{player.name}
										</button>
									</Tooltip>
									{player.kind === "command" && (
										<span className="block truncate text-xs text-muted-foreground">
											{player.executable}
										</span>
									)}
								</div>
								<ActionButton
									icon={Trash2}
									shortLabel={t("externalPlayers.delete")}
									variant="outline"
									label={t("externalPlayers.deleteNamed", {
										name: player.name,
									})}
									disabled={pending}
									onClick={() => void remove(player)}
								/>
							</li>
						))}
					</ul>
				)}
				<form
					className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
					onSubmit={(event) => {
						event.preventDefault();
						if (pending) return;
						const draft: ExternalPlayerDraft = command
							? {
									kind: "command",
									name: name.trim(),
									executable,
									args: parseArgumentLines(argumentsText),
								}
							: {
									kind: "url-template",
									name: name.trim(),
									template: template.trim(),
								};
						const validationError = players.validate(draft);
						if (validationError) {
							setError(validationError);
							return;
						}
						void save(draft).then((saved) => {
							if (!saved) return;
							setName("");
							setTemplate("");
							setExecutable("");
							setArgumentsText("");
						});
					}}
				>
					<Field>
						<label
							htmlFor="external-player-name"
							className="field-label flex h-11 items-center"
						>
							{t("externalPlayers.name")}
						</label>
						<Input
							id="external-player-name"
							required
							maxLength={externalPlayerPolicy.maximumNameLength}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</Field>
					{command ? (
						<>
							<Field>
								<div className="flex h-11 items-center gap-1">
									<label
										htmlFor="external-player-executable"
										className="field-label"
									>
										{t("externalPlayers.executable")}
									</label>
									<FieldHelp
										label={t("externalPlayers.executableHelpLabel")}
										help={t("externalPlayers.executableHelp")}
									/>
								</div>
								<div className="flex min-w-0 gap-2">
									<Input
										id="external-player-executable"
										value={executable}
										onChange={(event) => setExecutable(event.target.value)}
										placeholder={t("externalPlayers.executablePlaceholder")}
									/>
									<Tooltip content={t("externalPlayers.chooseExecutable")}>
										<Button
											type="button"
											variant="outline"
											size="icon"
											className="shrink-0"
											aria-label={t("externalPlayers.chooseExecutable")}
											disabled={pending}
											onClick={() => void chooseExecutable()}
										>
											<FolderOpen size={16} aria-hidden="true" />
										</Button>
									</Tooltip>
								</div>
							</Field>
							<Field className="sm:col-span-2">
								<div className="flex h-11 items-center gap-1">
									<label
										htmlFor="external-player-arguments"
										className="field-label"
									>
										{t("externalPlayers.arguments")}
									</label>
									<FieldHelp
										label={t("externalPlayers.argumentsHelpLabel")}
										help={t("externalPlayers.argumentsHelp")}
									/>
								</div>
								<Textarea
									id="external-player-arguments"
									value={argumentsText}
									onChange={(event) => setArgumentsText(event.target.value)}
									placeholder={"--no-terminal\n{url}"}
								/>
							</Field>
						</>
					) : (
						<Field>
							<div className="flex h-11 items-center gap-1">
								<label
									htmlFor="external-player-template"
									className="field-label"
								>
									{t("externalPlayers.template")}
								</label>
								<FieldHelp
									label={t("externalPlayers.templateHelpLabel")}
									help={t("externalPlayers.templateHelp")}
								/>
							</div>
							<Input
								id="external-player-template"
								required
								maxLength={externalPlayerPolicy.maximumTemplateLength}
								value={template}
								onChange={(event) => setTemplate(event.target.value)}
								placeholder="infuse://x-callback-url/play?url={urlEncoded}"
							/>
						</Field>
					)}
					<div className="action-row sm:col-span-2">
						<ActionButton
							icon={Plus}
							label={t("externalPlayers.add")}
							shortLabel={t("actions.add")}
							type="submit"
							disabled={pending || players.error || full}
							aria-busy={pending}
						/>
					</div>
					{full && (
						<p role="status" className="text-sm text-muted-foreground">
							{t("externalPlayers.limit", {
								count: externalPlayerPolicy.maximumCustomPlayers,
							})}
						</p>
					)}
					{error && (
						<p role="alert" className="field-error sm:col-span-2">
							{t(error)}
						</p>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
