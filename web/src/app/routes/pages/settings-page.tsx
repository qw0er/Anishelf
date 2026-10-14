import { useTranslation } from "react-i18next";
import {
	usePreparationAction,
	usePreparationContext,
} from "../../../features/media/public.js";
import {
	ExternalPlayerSettings,
	PreparationProfileSettings,
	ResourceSettings,
} from "../../../features/settings/ui.js";
import { useAppRuntime } from "../../runtime/context.js";
export function SettingsPage() {
	const preparation = usePreparationContext();
	const action = usePreparationAction();
	const { t } = useTranslation();
	const { settings, scanning, scanPending } = useAppRuntime();
	return settings ? (
		<div className="stack-page mx-auto w-full max-w-2xl">
			<ResourceSettings
				key={settings.resourceRoot}
				settings={settings}
				disabled={scanning || scanPending}
			/>
			<PreparationProfileSettings preparation={preparation} action={action} />
			<ExternalPlayerSettings />
		</div>
	) : (
		<section role="alert">{t("errors.settingsUnavailable")}</section>
	);
}
