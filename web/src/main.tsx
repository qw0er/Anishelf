import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { queryClient } from "./api/query-client.js";
import "./index.css";
import { Toaster } from "./components/ui/toast.js";
import "./i18n.js";
import { libraryRoute } from "./routes/library.js";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element.");
const router = createBrowserRouter([libraryRoute]);

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
		<Toaster />
	</StrictMode>,
);
