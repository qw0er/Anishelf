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

export function TraySettings({
	closeToTray,
	save,
}: {
	closeToTray: boolean;
	save(enabled: boolean): Promise<void>;
}) {
	const { t } = useTranslation();
	const [enabled, setEnabled] = useState(closeToTray);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);

	async function change(next: boolean) {
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
				<CardTitle>{t("desktopSettings.title")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				<div className="flex items-center gap-2">
					<Checkbox
						id="close-to-tray"
						checked={enabled}
						disabled={pending}
						aria-busy={pending}
						aria-describedby="close-to-tray-help"
						onCheckedChange={(checked) => void change(checked)}
					/>
					<label htmlFor="close-to-tray" className="field-label">
						{t("desktopSettings.closeToTray")}
					</label>
				</div>
				<p id="close-to-tray-help" className="supporting-text">
					{t("desktopSettings.closeToTrayHelp")}
				</p>
				{failed && <FieldError>{t("desktopSettings.saveFailed")}</FieldError>}
			</CardContent>
		</Card>
	);
}
