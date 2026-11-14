import {
	Button,
	ExternalPlayerSettings,
	Field,
	FieldHelp,
	Input,
	Textarea,
	Tooltip,
	toast,
} from "@anishelf/client-ui";
import { FolderOpen } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

export function DesktopExternalPlayerSettings({
	chooseExecutable,
}: {
	chooseExecutable(): Promise<string | null>;
}) {
	const { t } = useTranslation();
	const executableInput = useRef<HTMLInputElement>(null);

	async function selectExecutable() {
		try {
			const path = await chooseExecutable();
			if (!path || !executableInput.current) return;
			executableInput.current.value = path;
			console.debug("[Settings] External player executable selected.");
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
		<ExternalPlayerSettings
			description={t("externalPlayers.commandDescription")}
			storageError={t("externalPlayers.commandStorageError")}
			saveError={t("externalPlayers.commandSaveError")}
			createDraft={(name, values) => ({
				kind: "command",
				name,
				executable: String(values.get("executable") ?? ""),
				args: String(values.get("arguments") ?? "")
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean),
			})}
			renderPlayerDetail={(player) =>
				player.kind === "command" && (
					<span className="block truncate text-xs text-muted-foreground">
						{player.executable}
					</span>
				)
			}
			fields={
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
								ref={executableInput}
								id="external-player-executable"
								name="executable"
								placeholder={t("externalPlayers.executablePlaceholder")}
							/>
							<Tooltip content={t("externalPlayers.chooseExecutable")}>
								<Button
									type="button"
									variant="outline"
									size="icon"
									className="shrink-0"
									aria-label={t("externalPlayers.chooseExecutable")}
									onClick={() => void selectExecutable()}
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
							name="arguments"
							placeholder={"--no-terminal\n{url}"}
						/>
					</Field>
				</>
			}
		/>
	);
}
