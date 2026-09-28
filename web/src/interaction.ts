import { app } from "./controller";
import * as S from "./state";

interface PointerState {
  id: number;
  x: number;
  y: number;
}

const DRAG_PX = 4;

/** Mouse, touch and pen handling for the viewport. */
export function attachInteraction(el: HTMLElement) {
  const pointers = new Map<number, PointerState>();
  let down: { x: number; y: number; button: number; shift: boolean; moved: boolean; pan: boolean } | null = null;
  let pinch: { d: number; cx: number; cy: number } | null = null;
  let spaceHeld = false;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };
  const R = () => app.renderer;

  function panBy(dx: number, dy: number) {
    const r = R();
    r.keepFit = null;
    if (r.mode === "2d") {
      r.view.cx -= dx / r.view.scale;
      r.view.cy += dy / r.view.scale;
    } else {
      // Move the orbit target in the ground plane, relative to the camera heading.
      const o = r.orbit;
      const k = r.pxPerUm();
      const fx = -Math.cos(o.theta);
      const fy = -Math.sin(o.theta);
      const rx = -fy;
      const ry = fx;
      o.tx -= (dx * rx - dy * fx) / k;
      o.ty -= (dx * ry - dy * fy) / k;
    }
    app.cameraMoved();
  }

  function zoomAt(sx: number, sy: number, f: number) {
    const r = R();
    r.keepFit = null;
    if (r.mode === "2d") {
      const [wx, wy] = r.screenToWorld(sx, sy);
      r.view.scale = Math.min(Math.max(r.view.scale * f, 1e-6), 1e7);
      const [nx, ny] = r.screenToWorld(sx, sy);
      r.view.cx += wx - nx;
      r.view.cy += wy - ny;
    } else {
      r.orbit.dist = Math.min(Math.max(r.orbit.dist / f, 1e-4), 1e8);
    }
    app.cameraMoved();
  }

  function orbitBy(dx: number, dy: number) {
    R().keepFit = null;
    const o = R().orbit;
    o.theta -= dx * 0.008;
    o.phi = Math.min(Math.max(o.phi - dy * 0.008, 0.02), Math.PI / 2 - 0.02);
    app.cameraMoved();
  }

  el.addEventListener("contextmenu", (e) => e.preventDefault());

  el.addEventListener("pointerdown", (e) => {
    if (!S.loaded.value) return;
    el.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { id: e.pointerId, x, y });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      down = null;
      return;
    }
    const panButton = e.button === 1 || e.button === 2 || spaceHeld;
    down = { x, y, button: e.button, shift: e.shiftKey, moved: false, pan: panButton };
  });

  el.addEventListener("pointermove", async (e) => {
    const [x, y] = local(e);
    const p = pointers.get(e.pointerId);
    if (pinch && pointers.size === 2 && p) {
      p.x = x;
      p.y = y;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      panBy(cx - pinch.cx, cy - pinch.cy);
      zoomAt(cx, cy, d / (pinch.d || d));
      pinch = { d, cx, cy };
      return;
    }
    if (S.loaded.value && R().mode === "2d") S.cursor.value = R().screenToWorld(x, y);

    if (down && p) {
      const dx = x - p.x;
      const dy = y - p.y;
      if (!down.moved && Math.hypot(x - down.x, y - down.y) > DRAG_PX) down.moved = true;
      if (down.moved) {
        const r = R();
        const tool = S.tool.value;
        if (r.mode === "3d") {
          if (down.pan || down.shift) panBy(dx, dy);
          else orbitBy(dx, dy);
        } else if (down.pan || tool === "select" || e.pointerType === "touch") {
          panBy(dx, dy);
          S.hover.value = null;
        }
      }
      p.x = x;
      p.y = y;
      if (down.moved) return;
    }
    if (!S.loaded.value) return;

    const tool = S.tool.value;
    if (tool === "ruler" && S.ruler.value && !S.ruler.value.done) {
      const pt = await app.snap(x, y, S.ruler.value.a, e.shiftKey);
      if (pt && S.ruler.value && !S.ruler.value.done) S.ruler.value = { ...S.ruler.value, b: pt };
    } else if (tool === "section" && S.sectionLine.value && !S.sectionLine.value.done) {
      const pt = await app.snap(x, y, S.sectionLine.value.a, e.shiftKey);
      if (pt && S.sectionLine.value && !S.sectionLine.value.done) S.sectionLine.value = { ...S.sectionLine.value, b: pt };
    } else if (tool !== "select" && e.pointerType === "mouse") {
      await app.snap(x, y, null, false);
    } else if (e.pointerType === "mouse" && !down) {
      app.hoverAt(x, y);
    }
  });

  const end = async (e: PointerEvent) => {
    const [x, y] = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    const d = down;
    down = null;
    if (!d || d.moved || !S.loaded.value || e.type === "pointercancel") return;
    if (d.button !== 0) return;
    const tool = S.tool.value;
    if (R().mode === "3d") {
      if (tool === "select") app.pickAt(x, y);
      return;
    }
    if (tool === "select") {
      app.pickAt(x, y);
    } else if (tool === "ruler") {
      const cur = S.ruler.value;
      if (!cur || cur.done) {
        const pt = (await app.snap(x, y, null, false)) ?? R().screenToWorld(x, y);
        S.ruler.value = { a: pt, b: pt, done: false };
      } else {
        const pt = (await app.snap(x, y, cur.a, e.shiftKey)) ?? cur.b;
        S.ruler.value = { a: cur.a, b: pt, done: true };
      }
    } else if (tool === "section") {
      const cur = S.sectionLine.value;
      if (!cur || cur.done) {
        const pt = (await app.snap(x, y, null, false)) ?? R().screenToWorld(x, y);
        S.sectionLine.value = { a: pt, b: pt, done: false };
        S.sectionResult.value = null;
      } else {
        const pt = (await app.snap(x, y, cur.a, e.shiftKey)) ?? cur.b;
        S.sectionLine.value = { a: cur.a, b: pt, done: true };
        app.runSection(cur.a, pt);
      }
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("pointerleave", () => {
    S.cursor.value = null;
    S.hover.value = null;
  });

  el.addEventListener(
    "wheel",
    (e) => {
      if (!S.loaded.value) return;
      e.preventDefault();
      const [x, y] = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const k = e.ctrlKey ? 0.01 : 0.0018;
      zoomAt(x, y, Math.exp(-e.deltaY * unit * k));
    },
    { passive: false },
  );

  el.addEventListener("dblclick", (e) => {
    if (!S.loaded.value || S.tool.value !== "select") return;
    const [x, y] = local(e);
    zoomAt(x, y, 2);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === " " && !isTyping(e)) spaceHeld = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === " ") spaceHeld = false;
  });
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/** Global keyboard shortcuts. The number keys match the Tiny Tapeout viewer. */
export function attachShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (isTyping(e) || e.altKey) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      document.getElementById("file-input")?.click();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === "?") {
      S.helpOpen.value = !S.helpOpen.value;
      return;
    }
    if (e.key === "Escape") {
      if (S.helpOpen.value) S.helpOpen.value = false;
      else if (S.ruler.value || S.sectionLine.value) {
        S.ruler.value = null;
        S.sectionLine.value = null;
        S.sectionResult.value = null;
      } else if (S.selection.value.length) S.selection.value = [];
      else S.tool.value = "select";
      return;
    }
    if (!S.loaded.value) return;
    const k = e.key.toLowerCase();
    const sel = S.selected.value;
    switch (k) {
      case "1":
        S.hideFillers.value = !S.hideFillers.value;
        break;
      case "2":
        S.hideTop.value = !S.hideTop.value;
        break;
      case "3": {
        const hit = S.selected.value;
        if (hit) {
          const id = S.summary.value?.cells.find((c) => c.name === hit.cell)?.id;
          if (id !== undefined) S.highlightCell.value = S.highlightCell.value === id ? null : id;
        } else S.highlightCell.value = null;
        break;
      }
      case "4":
      case "z":
        if (sel) app.zoomTo(sel.box);
        break;
      case "f":
        app.fitAll();
        break;
      case "t":
        app.setMode(S.mode.value === "2d" ? "3d" : "2d");
        break;
      case "s":
        S.tool.value = "select";
        break;
      case "r":
        if (S.mode.value === "2d") S.tool.value = S.tool.value === "ruler" ? "select" : "ruler";
        break;
      case "x":
        if (S.mode.value === "2d") S.tool.value = S.tool.value === "section" ? "select" : "section";
        break;
      case "l":
        S.showLabels.value = !S.showLabels.value;
        break;
      case "g":
        S.showGrid.value = !S.showGrid.value;
        break;
      case "d":
        S.showDensity.value = !S.showDensity.value;
        break;
      case "+":
      case "=":
        app.zoomBy(1.5);
        break;
      case "-":
      case "_":
        app.zoomBy(1 / 1.5);
        break;
      case "[":
        S.leftOpen.value = !S.leftOpen.value;
        break;
      case "]":
        S.rightOpen.value = !S.rightOpen.value;
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}
