import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import "./index.css";
import { libraryRoute } from "./routes/library.js";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element.");
const router = createBrowserRouter([libraryRoute]);

createRoot(root).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
