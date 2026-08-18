import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import ErrorBoundary from "./ErrorBoundary.js";
import { config } from "mdye";
import { installGlobalDiagnostics } from "./diagnostics.js";
import "./style.less";

installGlobalDiagnostics(window);
const root = createRoot(document.querySelector("#app"));
root.render(<ErrorBoundary runtimeConfig={config || {}}><App /></ErrorBoundary>);
