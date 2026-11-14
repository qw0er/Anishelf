import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { Input } from "../../../shared/components/ui/input.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";
import type {
	ExternalPlayer,
	ExternalPlayerDraft,
} from "../../../shared/platform.js";
import { externalPlayerPolicy } from "../external-player-policy.js";
import { useExternalPlayers } from "../hooks/use-external-players.js";

interface ExternalPlayerSettingsProps {
	description: string;
	storageError: string;
	saveError: string;
	fields: ReactNode;
	createDraft(name: string, values: FormData): ExternalPlayerDraft;
	renderPlayerDetail?(player: ExternalPlayer): ReactNode;
}

export function ExternalPlayerSettings({
	description,
	storageError,
	saveError,
	fields,
	createDraft,
	renderPlayerDetail,
}: ExternalPlayerSettingsProps) {
	const { t } = useTranslation();
	const players = useExternalPlayers();
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
				title: saveError,
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
				title: saveError,
			});
		} finally {
			setPending(false);
		}
	}

	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("externalPlayers.title")}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{players.error && (
					<p role="alert" className="field-error sm:col-span-2">
						{storageError}
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
									{renderPlayerDetail?.(player)}
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
						if (pending || full || players.error) return;
						const form = event.currentTarget;
						const values = new FormData(form);
						const name = String(values.get("name") ?? "").trim();
						const draft = createDraft(name, values);
						const validationError = players.validate(draft);
						if (validationError) {
							setError(validationError);
							return;
						}
						void save(draft).then((saved) => {
							if (saved) form.reset();
						});
					}}
				>
					<fieldset disabled={pending} className="contents">
						<Field>
							<label
								htmlFor="external-player-name"
								className="field-label flex h-11 items-center"
							>
								{t("externalPlayers.name")}
							</label>
							<Input
								id="external-player-name"
								name="name"
								required
								maxLength={externalPlayerPolicy.maximumNameLength}
							/>
						</Field>
						{fields}
					</fieldset>
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
