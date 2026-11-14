import {
	ExternalPlayerSettings,
	Field,
	FieldHelp,
	Input,
	maximumPlayerTemplateLength,
} from "@anishelf/client-ui";
import { useTranslation } from "react-i18next";

export function WebExternalPlayerSettings() {
	const { t } = useTranslation();
	return (
		<ExternalPlayerSettings
			description={t("externalPlayers.description")}
			storageError={t("externalPlayers.storageError")}
			saveError={t("externalPlayers.saveError")}
			createDraft={(name, values) => ({
				kind: "url-template",
				name,
				template: String(values.get("template") ?? "").trim(),
			})}
			fields={
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
						name="template"
						required
						maxLength={maximumPlayerTemplateLength}
						placeholder="infuse://x-callback-url/play?url={urlEncoded}"
					/>
				</Field>
			}
		/>
	);
}
