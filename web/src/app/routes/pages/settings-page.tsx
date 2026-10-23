import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import {
	QbittorrentSettings,
	RssSettings,
	SourceSettings,
	WatchingSettings,
} from "../../../features/acquisition/ui.js";
import { TrackingAccountSettings } from "../../../features/anime/ui.js";
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
import { buttonStyles } from "../../../shared/components/ui/button.js";
import { SecuritySettings } from "../../auth/security-settings.js";
import { useAppRuntime } from "../../runtime/context.js";

const settingsSections = [
	"library",
	"playback",
	"downloads",
	"account",
] as const;
type SettingsSection = (typeof settingsSections)[number];

function isSettingsSection(value: string | null): value is SettingsSection {
	return settingsSections.some((section) => section === value);
}

function sectionPath(
	params: URLSearchParams,
	section: SettingsSection,
): string {
	const next = new URLSearchParams(params);
	next.set("section", section);
	return `/settings?${next.toString()}`;
}

export function SettingsPage() {
	const preparation = usePreparationContext();
	const action = usePreparationAction();
	const { t } = useTranslation();
	const [params] = useSearchParams();
	const requestedSection = params.get("section");
	const activeSection: SettingsSection = isSettingsSection(requestedSection)
		? requestedSection
		: "library";
	const { settings, scanning, scanPending } = useAppRuntime();
	return settings ? (
		<div className="stack-page">
			<PageHeader
				title={t("settingsPage.title")}
				description={t("settingsPage.description")}
			/>
			<nav
				aria-label={t("settingsPage.sections.label")}
				className="-mx-1 overflow-x-auto px-1"
			>
				<div className="flex w-max items-center gap-1">
					{settingsSections.map((section) => (
						<Link
							key={section}
							to={sectionPath(params, section)}
							aria-current={activeSection === section ? "page" : undefined}
							className={buttonStyles(
								activeSection === section ? "secondary" : "ghost",
							)}
						>
							{t(`settingsPage.sections.${section}`)}
						</Link>
					))}
				</div>
			</nav>
			<div
				className={activeSection === "library" ? "stack-page" : "hidden"}
				data-settings-section="library"
			>
				<ResourceSettings
					key={JSON.stringify(settings.resourceRoots)}
					settings={settings}
					disabled={scanning || scanPending}
				/>
			</div>
			<div
				className={activeSection === "playback" ? "stack-page" : "hidden"}
				data-settings-section="playback"
			>
				<PreparationProfileSettings preparation={preparation} action={action} />
				<ExternalPlayerSettings />
			</div>
			<div
				className={activeSection === "downloads" ? "stack-page" : "hidden"}
				data-settings-section="downloads"
			>
				<RssSettings />
				<SourceSettings />
				<WatchingSettings />
				<QbittorrentSettings />
			</div>
			<div
				className={activeSection === "account" ? "stack-page" : "hidden"}
				data-settings-section="account"
			>
				<TrackingAccountSettings />
				<SecuritySettings />
			</div>
		</div>
	) : (
		<section role="alert">{t("errors.settingsUnavailable")}</section>
	);
}
