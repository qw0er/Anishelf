import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";
import { externalPlayerPolicy } from "../../../config/external-player-policy.js";
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
		<Card className="w-full max-w-2xl">
			<CardHeader>
				<CardTitle>{t("externalPlayers.title")}</CardTitle>
				<CardDescription>{t("externalPlayers.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{custom.error && (
					<p role="alert" className="text-sm text-destructive">
						{t("externalPlayers.storageError")}
					</p>
				)}
				{custom.players.length === 0 && !custom.error && (
					<p className="text-sm text-muted-foreground">
						{t("externalPlayers.empty")}
					</p>
				)}
				<ul className="space-y-2">
					{custom.players.map((player) => (
						<li
							key={player.id}
							className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border p-3"
						>
							<div className="min-w-0 flex-1 basis-40">
								<p className="wrap-break-word text-sm font-medium">
									{player.name}
								</p>
								<p className="break-all text-xs text-muted-foreground">
									{player.template}
								</p>
							</div>
							<Button
								variant="outline"
								aria-label={t("externalPlayers.deleteNamed", {
									name: player.name,
								})}
								onClick={() => {
									try {
										custom.remove(player.id);
										setError(null);
									} catch {
										setError("externalPlayers.saveError");
									}
								}}
							>
								<Trash2 size={16} aria-hidden="true" />
								{t("externalPlayers.delete")}
							</Button>
						</li>
					))}
				</ul>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!name.trim() || !validPlayerTemplate(template.trim())) {
							setError("externalPlayers.invalidTemplate");
							return;
						}
						try {
							custom.add(name.trim(), template.trim());
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
						<Input
							id="external-player-template"
							required
							maxLength={externalPlayerPolicy.maximumTemplateLength}
							value={template}
							onChange={(event) => setTemplate(event.target.value)}
							placeholder="infuse://x-callback-url/play?url={urlEncoded}"
							aria-describedby="external-player-template-help"
						/>
						<p
							id="external-player-template-help"
							className="text-sm text-muted-foreground"
						>
							{t("externalPlayers.templateHelp")}
						</p>
					</div>
					<Button type="submit" disabled={custom.error || full}>
						<Plus size={16} aria-hidden="true" />
						{t("externalPlayers.add")}
					</Button>
					{full && (
						<p role="status" className="text-sm text-muted-foreground">
							{t("externalPlayers.limit", {
								count: externalPlayerPolicy.maximumCustomPlayers,
							})}
						</p>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{t(error)}
						</p>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
