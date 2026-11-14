import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Checkbox,
	FieldError,
} from "@anishelf/client-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopLoginItemState } from "../../ipc/desktop.js";

export function StartupSettings({
	status,
	save,
}: {
	status: DesktopLoginItemState;
	save(enabled: boolean): Promise<void>;
}) {
	const { t } = useTranslation();
	const [enabled, setEnabled] = useState(status.enabled);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);

	async function change(next: boolean) {
		if (!status.supported) return;
		setPending(true);
		setFailed(false);
		try {
			await save(next);
			setEnabled(next);
		} catch {
			setFailed(true);
		} finally {
			setPending(false);
		}
	}

	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("startupSettings.title")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				<div className="flex items-center gap-2">
					<Checkbox
						id="launch-at-login"
						checked={enabled}
						disabled={pending || !status.supported}
						aria-busy={pending}
						aria-describedby="launch-at-login-help"
						onCheckedChange={(checked) => void change(checked)}
					/>
					<label htmlFor="launch-at-login" className="field-label">
						{t("startupSettings.launchAtLogin")}
					</label>
				</div>
				<p id="launch-at-login-help" className="supporting-text">
					{status.supported
						? t("startupSettings.launchAtLoginHelp")
						: t("startupSettings.unavailable")}
				</p>
				{failed && <FieldError>{t("startupSettings.saveFailed")}</FieldError>}
			</CardContent>
		</Card>
	);
}
