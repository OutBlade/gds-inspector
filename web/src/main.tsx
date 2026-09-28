import { render } from "preact";
import { App } from "./ui/App";
import { app } from "./controller";
import { attachShortcuts } from "./interaction";
import * as S from "./state";
import { EXAMPLES, openExample } from "./demo";
import { embedded, hostTheme, onHostMessage, onHostTheme, ownBuffer, post } from "./host";
import { exportLayerCsv, exportPng, exportReport, exportSvg } from "./export";
import "./styles.css";

function initialTheme(): S.Theme {
  try {
    const saved = localStorage.getItem("gds-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

S.theme.value = embedded ? hostTheme() : initialTheme();
if (embedded) onHostTheme((t) => (S.theme.value = t));
document.documentElement.dataset.theme = S.theme.value;
S.theme.subscribe((t) => (document.documentElement.dataset.theme = t));

if (window.innerWidth < 900) {
  S.leftOpen.value = false;
  S.rightOpen.value = false;
}

render(<App />, document.getElementById("root")!);
attachShortcuts();

if (embedded) {
  S.busy.value = { stage: "Reading file", fraction: 0 };
  onHostMessage(async (m) => {
    if (m.type === "open") {
      await app.loadBuffer(ownBuffer(m.bytes), m.name);
      if (m.lyp) app.applyLyp(m.lyp);
    } else if (m.type === "reload") {
      await app.reload(ownBuffer(m.bytes), m.name);
    } else if (m.type === "lyp") {
      app.applyLyp(m.text);
    } else if (m.type === "export") {
      if (m.format === "png") exportPng(3);
      else if (m.format === "svg") exportSvg();
      else if (m.format === "json") exportReport();
      else exportLayerCsv();
    }
  });
  post({ type: "ready" });
} else {
  const params = new URLSearchParams(location.search);
  const remote = params.get("url");
  const example = EXAMPLES.find((e) => e.id === params.get("example"));
  if (remote) app.openUrl(remote);
  else if (example) openExample(example);
}

if (import.meta.env.DEV) Object.assign(window, { gdsApp: app, gdsState: S });
