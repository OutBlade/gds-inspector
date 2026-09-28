import { app } from "./controller";
import type { Example } from "./examples";

export { EXAMPLES } from "./examples";
export type { Example } from "./examples";

/** Opens an example and records it in the address so the link can be shared. */
export function openExample(e: Example) {
  const url = new URL(location.href);
  url.searchParams.delete("url");
  url.searchParams.set("example", e.id);
  url.hash = "";
  history.replaceState(null, "", url);
  if (e.url) app.openUrl(e.url);
  else if (e.make) app.loadBuffer(e.make(), e.file);
}
