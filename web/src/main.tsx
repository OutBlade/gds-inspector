import { render } from "preact";
import { App } from "./ui/App";
import { app } from "./controller";
import { attachShortcuts } from "./interaction";
import * as S from "./state";
import { EXAMPLES, openExample } from "./demo";
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

S.theme.value = initialTheme();
document.documentElement.dataset.theme = S.theme.value;
S.theme.subscribe((t) => (document.documentElement.dataset.theme = t));

if (window.innerWidth < 900) {
  S.leftOpen.value = false;
  S.rightOpen.value = false;
}

render(<App />, document.getElementById("root")!);
attachShortcuts();

const params = new URLSearchParams(location.search);
const remote = params.get("url");
const example = EXAMPLES.find((e) => e.id === params.get("example"));
if (remote) app.openUrl(remote);
else if (example) openExample(example);

if (import.meta.env.DEV) Object.assign(window, { gdsApp: app, gdsState: S });
