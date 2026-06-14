import { createRoot } from "react-dom/client";
import App from "./App";
import { TestVideoPage } from "./test-video";
import "./index.css";

const params = new URLSearchParams(window.location.search);

// Routing rules:
//   ?test=video → video sandbox (for verifying the Daily.co stack alone)
//   otherwise   → full NeverMiss app
//
// On localhost, the real app talks to dev-server.mjs which stubs auth /
// connections / sessions / session-log / progress / children /
// session_log endpoints with in-memory storage.
createRoot(document.getElementById("root")!).render(
  params.get("test") === "video" ? <TestVideoPage /> : <App />
);
