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
import { FieldHelp } from "../../../shared/components/ui/field-help.js";
import { Input } from "../../../shared/components/ui/input.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";
import { externalPlayerPolicy } from "../external-player-policy.js";
import { validPlayerTemplate } from "../external-players.js";
import { useExternalPlayers } from "../hooks/use-external-players.js";

export function ExternalPlayerSettings() {
	const { t } = useTranslation();
	const custom = useExternalPlayers();
	const [name, setName] = useState("");
	const [template, setTemplate] = useState("");
	const [error, setError] = useState<string | null>(null);
	const full =
		custom.players.length >= externalPlayerPolicy.maximumCustomPlayers;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("externalPlayers.title")}</CardTitle>
				<CardDescription>{t("externalPlayers.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{custom.error && (
					<p role="alert" className="text-sm text-destructive sm:col-span-2">
						{t("externalPlayers.storageError")}
					</p>
				)}
				{custom.players.length === 0 && !custom.error && (
					<p className="text-sm text-muted-foreground">
						{t("externalPlayers.empty")}
					</p>
				)}
				<ul className="max-h-64 divide-y overflow-auto">
					{custom.players.map((player) => (
						<li
							key={player.id}
							className="action-row flex-nowrap min-w-0 items-center gap-3 py-2"
						>
							<div className="min-w-0 flex-1 basis-40">
								<Tooltip content={player.template} openOnClick>
									<button
										type="button"
										className="max-w-full truncate rounded text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring"
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
										custom.remove(player.id);
										console.debug("[Settings] Custom player removed.", {
											count: custom.players.length - 1,
										});
										setError(null);
									} catch {
										setError("externalPlayers.saveError");
									}
								}}
							/>
						</li>
					))}
				</ul>
				<form
					className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
					onSubmit={(event) => {
						event.preventDefault();
						if (!name.trim() || !validPlayerTemplate(template.trim())) {
							setError("externalPlayers.invalidTemplate");
							return;
						}
						try {
							custom.add(name.trim(), template.trim());
							console.debug("[Settings] Custom player added.", {
								count: custom.players.length + 1,
							});
							setName("");
							setTemplate("");
							setError(null);
						} catch {
							setError("externalPlayers.saveError");
						}
					}}
				>
					<div className="space-y-2">
						<label
							htmlFor="external-player-name"
							className="text-sm font-medium"
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
					</div>
					<div className="space-y-2">
						<label
							htmlFor="external-player-template"
							className="text-sm font-medium"
						>
							{t("externalPlayers.template")}
						</label>
						<FieldHelp
							label={t("externalPlayers.templateHelpLabel")}
							help={t("externalPlayers.templateHelp")}
						/>
						<Input
							id="external-player-template"
							required
							maxLength={externalPlayerPolicy.maximumTemplateLength}
							value={template}
							onChange={(event) => setTemplate(event.target.value)}
							placeholder="infuse://x-callback-url/play?url={urlEncoded}"
						/>
					</div>
					<div className="action-row sm:col-span-2">
						<ActionButton
							icon={Plus}
							label={t("externalPlayers.add")}
							shortLabel={t("actions.add")}
							type="submit"
							disabled={custom.error || full}
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
						<p role="alert" className="text-sm text-destructive sm:col-span-2">
							{t(error)}
						</p>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
