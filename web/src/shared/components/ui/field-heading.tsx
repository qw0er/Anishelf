import { useTranslation } from "react-i18next";
import { FieldLabel } from "./field.js";
import { FieldHelp } from "./field-help.js";
export function FieldHeading({
	id,
	label,
	help,
}: {
	id: string;
	label: string;
	help?: string;
}) {
	const { t } = useTranslation();
	return (
		<div className="field-heading justify-between">
			<FieldLabel className="field-label" htmlFor={id}>
				{label}
			</FieldLabel>
			{help && (
				<FieldHelp label={`${label} · ${t("actions.help")}`} help={help} />
			)}
		</div>
	);
}
