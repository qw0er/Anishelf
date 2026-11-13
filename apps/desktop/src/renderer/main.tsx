import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

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
