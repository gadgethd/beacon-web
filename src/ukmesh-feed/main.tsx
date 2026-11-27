import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ready } from "../i18n";
import { Feed } from "./Feed";
import "../index.css";
import "./theme.css";

void ready.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><Feed /></StrictMode>));
