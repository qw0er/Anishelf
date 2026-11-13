import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { createDesktopConnection } from "./connection.js";

function App() {
	return (
		<main>
			<h1>Anishelf Desktop</h1>
		</main>
	);
}

const root = document.getElementById("app");
if (!root) throw new Error("Desktop mount point is missing.");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
console.info("desktop.renderer_started");

if (window.desktop) {
	void createDesktopConnection(window.desktop)
		.then((connection) => {
			window.addEventListener("pagehide", () => connection.dispose(), {
				once: true,
			});
			console.info("desktop.connection_ready");
		})
		.catch((error: unknown) => {
			console.error("desktop.connection_setup_failed", { error });
		});
}
