import { PasswordSignInForm, SignInPanel } from "@anishelf/client-ui";
import { useTranslation } from "react-i18next";

export function WebLoginPage() {
	const { t } = useTranslation();
	return (
		<SignInPanel>
			<h1 className="page-title">{t("auth.login.title")}</h1>
			<p className="text-sm text-muted-foreground">
				{t("auth.login.description")}
			</p>
			<PasswordSignInForm />
		</SignInPanel>
	);
}
