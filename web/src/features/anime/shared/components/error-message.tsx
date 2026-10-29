import { useTranslation } from "react-i18next";
import { Button } from "../../../../shared/components/ui/button.js";
import { InlineError } from "../../../../shared/components/ui/inline-error.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";

export function ErrorMessage({
	error,
	retry,
}: {
	error: unknown;
	retry?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<InlineError>
			<p>{t(getErrorTranslationKey(error) ?? "errors.requestFailed")}</p>
			{retry && (
				<Button variant="outline" onClick={retry}>
					{t("actions.retry")}
				</Button>
			)}
		</InlineError>
	);
}
