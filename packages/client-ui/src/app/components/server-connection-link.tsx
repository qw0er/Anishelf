import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { getClientRuntime } from "../../shared/api/connection.js";
import { buttonStyles } from "../../shared/components/ui/button.js";

export function ServerConnectionLink() {
	const { t } = useTranslation();
	const { serverConnectionPath } = getClientRuntime();
	return serverConnectionPath ? (
		<Link
			className={buttonStyles("outline")}
			to={serverConnectionPath}
			state={{ canGoBack: true }}
		>
			{t("serverConnection.title")}
		</Link>
	) : null;
}
