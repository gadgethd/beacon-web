import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ready } from "../i18n";
import { FeedChannels } from "./FeedChannels";
import "../index.css";
import "./theme.css";

void ready.then(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="ukmesh-feed ukmesh-feed-main ukmesh-feed-main--embedded">
      <h1 className="sr-only">Beacon channels</h1>
      <section className="ukmesh-feed-panel" aria-label="Channel messages">
        <FeedChannels />
      </section>
    </main>
  </StrictMode>,
));
