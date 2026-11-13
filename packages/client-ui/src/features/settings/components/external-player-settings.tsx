import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../../../shared/components/ui/action-button.js";
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
import { toast } from "../../../shared/components/ui/toast.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";
import { externalPlayerPolicy } from "../external-player-policy.js";
import { useExternalPlayers } from "../hooks/use-external-players.js";

export function ExternalPlayerSettings() {
	const { t } = useTranslation();
	const players = useExternalPlayers();
	const [name, setName] = useState("");
	const [template, setTemplate] = useState("");
	const [error, setError] = useState<string | null>(null);
	const full =
		players.custom.length >= externalPlayerPolicy.maximumCustomPlayers;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("externalPlayers.title")}</CardTitle>
				<CardDescription>{t("externalPlayers.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{players.error && (
					<p role="alert" className="field-error sm:col-span-2">
						{t("externalPlayers.storageError")}
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
								</div>
								<ActionButton
									icon={Trash2}
									shortLabel={t("externalPlayers.delete")}
									variant="outline"
									label={t("externalPlayers.deleteNamed", {
										name: player.name,
									})}
									onClick={() => {
										try {
											players.remove(player.id);
											console.debug("[Settings] Custom player removed.", {
												count: players.custom.length - 1,
											});
											toast.add({
												id: "external-players-save",
												type: "success",
												title: t("externalPlayers.removed"),
											});
											setError(null);
										} catch {
											console.warn(
												"[Settings] Custom player removal could not be saved.",
											);
											toast.add({
												id: "external-players-save",
												type: "error",
												title: t("externalPlayers.saveError"),
											});
										}
									}}
								/>
							</li>
						))}
					</ul>
				)}
				<form
					className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
					onSubmit={(event) => {
						event.preventDefault();
						const draft = { name: name.trim(), template: template.trim() };
						const validationError = players.validate(draft);
						if (validationError) {
							setError(validationError);
							return;
						}
						try {
							players.add(draft);
							console.debug("[Settings] Custom player added.", {
								count: players.custom.length + 1,
							});
							toast.add({
								id: "external-players-save",
								type: "success",
								title: t("externalPlayers.added"),
							});
							setName("");
							setTemplate("");
							setError(null);
						} catch {
							console.warn("[Settings] Custom player could not be saved.");
							toast.add({
								id: "external-players-save",
								type: "error",
								title: t("externalPlayers.saveError"),
							});
						}
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
					<Field>
						<div className="flex h-11 items-center gap-1">
							<label htmlFor="external-player-template" className="field-label">
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
					<div className="action-row sm:col-span-2">
						<ActionButton
							icon={Plus}
							label={t("externalPlayers.add")}
							shortLabel={t("actions.add")}
							type="submit"
							disabled={players.error || full}
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
