import { useTranslation } from "react-i18next";
import { AniListAccountSettings } from "../../../features/anime/ui.js";
import {
	usePreparationAction,
	usePreparationContext,
} from "../../../features/media/public.js";
import {
	ExternalPlayerSettings,
	PreparationProfileSettings,
	ResourceSettings,
} from "../../../features/settings/ui.js";
import { PageHeader } from "../../../shared/components/page-header.js";
import { SecuritySettings } from "../../auth/security-settings.js";
import { useAppRuntime } from "../../runtime/context.js";
export function SettingsPage() {
	const preparation = usePreparationContext();
	const action = usePreparationAction();
	const { t } = useTranslation();
	const { settings, scanning, scanPending } = useAppRuntime();
	return settings ? (
		<div className="stack-page">
			<PageHeader
				title={t("settingsPage.title")}
				description={t("settingsPage.description")}
			/>
			<ResourceSettings
				key={settings.resourceRoot}
				settings={settings}
				disabled={scanning || scanPending}
			/>
			<PreparationProfileSettings preparation={preparation} action={action} />
			<ExternalPlayerSettings />
			<AniListAccountSettings />
			<SecuritySettings />
		</div>
	) : (
		<section role="alert">{t("errors.settingsUnavailable")}</section>
	);
}
