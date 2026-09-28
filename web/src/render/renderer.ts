import * as THREE from "three";
import type { BBox } from "../gds/geometry";
import type { Scene, SceneCell, SceneChunk, ScenePart } from "../worker/scene";
import type { Extruded } from "../worker/protocol";
import { boxFragment, edgeFragment, fillFragment, flatVertex, pointVertex, solidFragment, solidVertex } from "./shaders";

export interface LayerStyle {
  key: number;
  color: string;
  pattern: number;
  visible: boolean;
  visible3d: boolean;
  z: number;
  t: number;
}

export interface Settings3D {
  exaggeration: number;
  explode: number;
  clip: boolean;
  /** Clip plane position across the layout, 0..1. */
  clipAt: number;
  clipAxis: "x" | "y";
}

interface Chunk {
  lin: THREE.InterleavedBufferAttribute;
  hi: THREE.InterleavedBufferAttribute;
  lo: THREE.InterleavedBufferAttribute;
  count: number;
  box: BBox;
}

interface Obj {
  obj: THREE.Mesh | THREE.LineSegments | THREE.Points;
  key: number;
  box: BBox;
  kind: "fill" | "edge" | "box" | "boxEdge" | "point" | "solid";
}

interface RCell {
  data: SceneCell;
  /** Largest on-screen extent of one placement per µm of zoom. */
  extent: number;
  objs: Obj[];
  chunks: Chunk[];
  partChunks: (Chunk | null)[];
  partAttrs: { pos: THREE.BufferAttribute; tri: THREE.BufferAttribute }[];
  /** Triangles of one placement, all layers. */
  tri: number;
  /** Per frame: drawn as a stand-in. */
  lod: boolean;
}

export interface View2D {
  cx: number;
  cy: number;
  /** CSS pixels per µm. */
  scale: number;
}

export interface Orbit {
  tx: number;
  ty: number;
  tz: number;
  theta: number;
  phi: number;
  dist: number;
}

const LOD_PX = 3;
/** Triangles per frame before the smallest cells on screen fall back to stand-ins. */
const TRI_BUDGET_2D = 6_000_000;
const TRI_BUDGET_3D = 4_000_000;
const UNIT_SPHERE = new THREE.Sphere(new THREE.Vector3(), 1);
const FOV = 40;

export class LayoutRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: THREE.WebGLRenderer;
  private readonly root = new THREE.Scene();
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  private readonly persp = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1e7);
  private readonly originHi = { value: new THREE.Vector2() };
  private readonly originLo = { value: new THREE.Vector2() };
  private readonly px = { value: 1 };
  private readonly light = { value: new THREE.Vector3(0.3, -0.5, 1) };
  private readonly clip = { value: new THREE.Vector4() };
  private readonly clipOn = { value: 0 };
  private readonly fog = { value: new THREE.Color() };
  private readonly fogRange = { value: new THREE.Vector2(1, 2) };
  private fillMats = new Map<number, THREE.RawShaderMaterial>();
  private edgeMats = new Map<number, THREE.RawShaderMaterial>();
  private solidMats = new Map<number, THREE.RawShaderMaterial>();
  private lodMats = new Map<number, { fill: THREE.RawShaderMaterial; edge: THREE.RawShaderMaterial; point: THREE.RawShaderMaterial }>();
  private cells: RCell[] = [];
  private styles = new Map<number, LayerStyle>();
  private order = new Map<number, number>();
  private hiddenCells = new Set<number>();
  private hideTop = false;
  private sceneTop = -1;
  private has3D = false;
  private frameQueued = false;
  private width = 1;
  private height = 1;
  sceneBox: BBox = [0, 0, 1, 1];
  mode: "2d" | "3d" = "2d";
  view: View2D = { cx: 0, cy: 0, scale: 1 };
  orbit: Orbit = { tx: 0, ty: 0, tz: 0, theta: -Math.PI / 2, phi: 0.9, dist: 100 };
  s3d: Settings3D = { exaggeration: 1, explode: 0, clip: false, clipAt: 0.5, clipAxis: "y" };
  dark = true;
  /** While set, resizing the view refits this box (until the user moves the camera). */
  keepFit: { box: BBox; margin: number } | null = null;
  onFrame: (() => void) | null = null;
  stats = { drawn: 0, instances: 0 };

  constructor(host: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.canvas = this.gl.domElement;
    this.canvas.className = "gl";
    host.appendChild(this.canvas);
    this.gl.sortObjects = true;
    this.setTheme(true);
    this.resize();
  }

  private lodMat(key: number) {
    let m = this.lodMats.get(key);
    if (!m) {
      const color = { value: new THREE.Color("#8a93a3") };
      const fill = this.makeFlat(boxFragment, { uColor: color, uAlpha: { value: 0.3 }, uZ: { value: 0.5 } });
      const edge = this.makeFlat(boxFragment, { uColor: color, uAlpha: { value: 0.75 }, uZ: { value: 0.5 } });
      const point = this.makeFlat(boxFragment, { uColor: color, uAlpha: { value: 0.8 }, uZ: { value: 0.5 }, uSize: this.px }, pointVertex);
      for (const x of [fill, edge, point]) {
        x.depthTest = false;
        x.depthWrite = false;
      }
      m = { fill, edge, point };
      this.lodMats.set(key, m);
      const st = this.styles.get(key);
      if (st) color.value.set(st.color);
    }
    return m;
  }

  private makeFlat(fragment: string, uniforms: Record<string, THREE.IUniform>, vertex = flatVertex) {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { ...uniforms, uOriginHi: this.originHi, uOriginLo: this.originLo, uPx: this.px },
      transparent: true,
      depthWrite: true,
    });
  }

  setTheme(dark: boolean) {
    this.dark = dark;
    this.gl.setClearColor(dark ? 0x0b0d12 : 0xf6f6f3, 1);
    this.fog.value.set(dark ? 0x0b0d12 : 0xf6f6f3);
    for (const m of this.fillMats.values()) m.uniforms.uTint.value = dark ? 0.16 : 0.12;
    for (const m of this.edgeMats.values()) m.uniforms.uAlpha.value = dark ? 0.95 : 1;
    this.applyStyles();
    this.request();
  }

  resize() {
    const host = this.canvas.parentElement!;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    this.width = w;
    this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.px.value = dpr;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.keepFit) this.fit(this.keepFit.box, this.keepFit.margin);
    this.request();
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  /** Replaces the displayed layout. Buffers in `scene` are handed to the GPU. */
  setScene(scene: Scene, styles: LayerStyle[]) {
    this.clearScene();
    this.sceneTop = scene.top;
    this.sceneBox = scene.box;
    this.setStyles(styles);
    for (const c of scene.cells) this.cells.push(this.buildCell(c));
    this.request();
  }

  private clearScene() {
    for (const c of this.cells) {
      for (const o of c.objs) {
        this.root.remove(o.obj);
        o.obj.geometry.dispose();
      }
    }
    this.cells = [];
    this.has3D = false;
  }

  private makeChunk(ch: SceneChunk): Chunk {
    const buf = new THREE.InstancedInterleavedBuffer(ch.inst, 8, 1);
    return {
      lin: new THREE.InterleavedBufferAttribute(buf, 4, 0),
      hi: new THREE.InterleavedBufferAttribute(buf, 2, 4),
      lo: new THREE.InterleavedBufferAttribute(buf, 2, 6),
      count: ch.count,
      box: ch.box,
    };
  }

  private geo(pos: THREE.BufferAttribute, index: THREE.BufferAttribute, ch: Chunk, normal?: THREE.InterleavedBufferAttribute) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", pos);
    if (normal) g.setAttribute("normal", normal);
    g.setIndex(index);
    g.setAttribute("iLin", ch.lin);
    g.setAttribute("iHi", ch.hi);
    g.setAttribute("iLo", ch.lo);
    g.instanceCount = ch.count;
    // Culling and sorting are done here, not by three.js; a fixed sphere keeps it from reading 2D positions.
    g.boundingSphere = UNIT_SPHERE;
    return g;
  }

  private add(cell: RCell, obj: Obj["obj"], key: number, box: BBox, kind: Obj["kind"]) {
    obj.frustumCulled = false;
    obj.matrixAutoUpdate = false;
    obj.visible = false;
    this.root.add(obj);
    cell.objs.push({ obj, key, box, kind });
  }

  private buildCell(c: SceneCell): RCell {
    const b = c.ownBox;
    const cell: RCell = {
      data: c,
      extent: Math.max(b[2] - b[0], b[3] - b[1]) * c.maxScale,
      objs: [],
      chunks: c.chunks.map((ch) => this.makeChunk(ch)),
      partChunks: [],
      partAttrs: [],
      tri: c.parts.reduce((n, p) => n + p.tri.length / 3, 0),
      lod: false,
    };

    // Stand-ins for level of detail: bounding boxes, and single pixels when even those vanish.
    if (c.count > 1) {
      const quad = new THREE.BufferAttribute(new Float32Array([b[0], b[1], b[2], b[1], b[2], b[3], b[0], b[3]]), 2);
      const triIdx = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
      const edgeIdx = new THREE.BufferAttribute(new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]), 1);
      // Positions are relative to the bounding box center, so the dot sits at the origin.
      const dot = new THREE.BufferAttribute(new Float32Array([0, 0]), 2);
      const dotIdx = new THREE.BufferAttribute(new Uint16Array([0]), 1);
      const m = this.lodMat(c.keysByArea[0] ?? -1);
      for (const ch of cell.chunks) {
        const fill = new THREE.Mesh(this.geo(quad, triIdx, ch), m.fill);
        fill.renderOrder = -3;
        this.add(cell, fill, -1, ch.box, "box");
        const edge = new THREE.LineSegments(this.geo(quad, edgeIdx, ch), m.edge);
        edge.renderOrder = -2;
        this.add(cell, edge, -1, ch.box, "boxEdge");
        const pts = new THREE.Points(this.geo(dot, dotIdx, ch), m.point);
        pts.renderOrder = -1;
        this.add(cell, pts, -1, ch.box, "point");
      }
    }

    c.parts.forEach((p: ScenePart) => {
      const pos = new THREE.BufferAttribute(p.positions, 2);
      const tri = new THREE.BufferAttribute(p.tri, 1);
      const edge = new THREE.BufferAttribute(p.edge, 1);
      cell.partAttrs.push({ pos, tri });
      const own = p.chunk ? this.makeChunk(p.chunk) : null;
      cell.partChunks.push(own);
      const chunks = own ? [own] : cell.chunks;
      for (const ch of chunks) {
        const fill = new THREE.Mesh(this.geo(pos, tri, ch), this.fillMat(p.key));
        this.add(cell, fill, p.key, ch.box, "fill");
        const line = new THREE.LineSegments(this.geo(pos, edge, ch), this.edgeMat(p.key));
        this.add(cell, line, p.key, ch.box, "edge");
      }
    });
    return cell;
  }

  /** Installs extruded solids for the 3D view. */
  set3D(parts: Extruded[]) {
    for (const e of parts) {
      const cell = this.cells[e.cell];
      if (!cell) continue;
      const part = cell.data.parts[e.part];
      const buf = new THREE.InterleavedBuffer(e.data, 6);
      const pos = new THREE.InterleavedBufferAttribute(buf, 3, 0);
      const nrm = new THREE.InterleavedBufferAttribute(buf, 3, 3);
      const idx = new THREE.BufferAttribute(e.index, 1);
      const own = cell.partChunks[e.part];
      const chunks = own ? [own] : cell.chunks;
      for (const ch of chunks) {
        const g = this.geo(pos as unknown as THREE.BufferAttribute, idx, ch, nrm);
        const mesh = new THREE.Mesh(g, this.solidMat(part.key));
        this.add(cell, mesh, part.key, ch.box, "solid");
      }
    }
    this.has3D = true;
    this.applyStyles();
    this.request();
  }

  get ready3D() {
    return this.has3D;
  }

  private fillMat(key: number) {
    let m = this.fillMats.get(key);
    if (!m) {
      m = this.makeFlat(fillFragment, {
        uColor: { value: new THREE.Color() },
        uAlpha: { value: 1 },
        uTint: { value: this.dark ? 0.16 : 0.12 },
        uPattern: { value: 0 },
        uZ: { value: 0 },
      });
      m.depthFunc = THREE.LessDepth;
      this.fillMats.set(key, m);
    }
    return m;
  }

  private edgeMat(key: number) {
    let m = this.edgeMats.get(key);
    if (!m) {
      m = this.makeFlat(edgeFragment, { uColor: { value: new THREE.Color() }, uAlpha: { value: 0.95 }, uZ: { value: 0 } });
      m.depthTest = false;
      m.depthWrite = false;
      this.edgeMats.set(key, m);
    }
    return m;
  }

  private solidMat(key: number) {
    let m = this.solidMats.get(key);
    if (!m) {
      m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: solidVertex,
        fragmentShader: solidFragment,
        uniforms: {
          uColor: { value: new THREE.Color() },
          uZ0: { value: 0 },
          uT: { value: 1 },
          uOriginHi: this.originHi,
          uOriginLo: this.originLo,
          uLight: this.light,
          uClip: this.clip,
          uClipOn: this.clipOn,
          uFog: this.fog,
          uFogRange: this.fogRange,
        },
        side: THREE.DoubleSide,
      });
      this.solidMats.set(key, m);
    }
    return m;
  }

  setStyles(styles: LayerStyle[]) {
    this.styles = new Map(styles.map((s) => [s.key, s]));
    this.order = new Map(styles.map((s, i) => [s.key, i]));
    this.applyStyles();
    this.request();
  }

  private applyStyles() {
    const ex = this.s3d.exaggeration;
    for (const [key, s] of this.styles) {
      const i = this.order.get(key) ?? 0;
      const f = this.fillMat(key);
      (f.uniforms.uColor.value as THREE.Color).set(s.color);
      f.uniforms.uPattern.value = s.pattern;
      f.uniforms.uZ.value = i + 1;
      const e = this.edgeMat(key);
      (e.uniforms.uColor.value as THREE.Color).set(s.color);
      const m = this.solidMat(key);
      (m.uniforms.uColor.value as THREE.Color).set(s.color);
      const lod = this.lodMats.get(key);
      if (lod) (lod.fill.uniforms.uColor.value as THREE.Color).set(s.color);
      m.uniforms.uZ0.value = s.z * ex + i * this.s3d.explode;
      m.uniforms.uT.value = Math.max(s.t * ex, 0.001);
    }
    for (const c of this.cells) {
      for (const o of c.objs) {
        const i = this.order.get(o.key) ?? 0;
        if (o.kind === "fill") o.obj.renderOrder = i * 2;
        else if (o.kind === "edge") o.obj.renderOrder = i * 2 + 1;
      }
    }
  }

  setHiddenCells(ids: Set<number>, hideTop: boolean) {
    this.hiddenCells = ids;
    this.hideTop = hideTop;
    this.request();
  }

  set3DSettings(s: Partial<Settings3D>) {
    this.s3d = { ...this.s3d, ...s };
    this.applyStyles();
    this.request();
  }

  request() {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      this.draw();
    });
  }

  /** Visible world rectangle in 2D mode. */
  viewBox(): BBox {
    const hw = this.width / 2 / this.view.scale;
    const hh = this.height / 2 / this.view.scale;
    return [this.view.cx - hw, this.view.cy - hh, this.view.cx + hw, this.view.cy + hh];
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [(x - this.view.cx) * this.view.scale + this.width / 2, this.height / 2 - (y - this.view.cy) * this.view.scale];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    if (this.mode === "3d") return this.groundPoint(sx, sy) ?? [this.orbit.tx, this.orbit.ty];
    return [this.view.cx + (sx - this.width / 2) / this.view.scale, this.view.cy - (sy - this.height / 2) / this.view.scale];
  }

  /** Intersection of the screen ray with the z = 0 plane (3D mode). */
  groundPoint(sx: number, sy: number): [number, number] | null {
    const ndc = new THREE.Vector3((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1, 0.5);
    this.updatePersp();
    ndc.unproject(this.persp);
    const o = this.persp.position;
    const d = ndc.sub(o).normalize();
    if (Math.abs(d.z) < 1e-9) return null;
    const t = -o.z / d.z;
    if (t < 0) return null;
    return [o.x + d.x * t + this.orbit.tx, o.y + d.y * t + this.orbit.ty];
  }

  fit(box: BBox = this.sceneBox, margin = 0.92) {
    this.keepFit = { box, margin };
    const w = Math.max(box[2] - box[0], 1e-6);
    const h = Math.max(box[3] - box[1], 1e-6);
    this.view = {
      cx: (box[0] + box[2]) / 2,
      cy: (box[1] + box[3]) / 2,
      scale: Math.min(this.width / w, this.height / h) * margin,
    };
    this.orbit = { ...this.orbit, tx: this.view.cx, ty: this.view.cy, tz: 0, dist: this.distFor(w, h) * 1.1 };
    this.request();
  }

  setMode(mode: "2d" | "3d") {
    if (mode === this.mode) return;
    if (mode === "3d") {
      this.orbit = {
        tx: this.view.cx,
        ty: this.view.cy,
        tz: 0,
        theta: -Math.PI / 2,
        phi: 0.95,
        dist: this.distFor(this.width / this.view.scale, this.height / this.view.scale),
      };
    } else {
      const viewH = 2 * this.orbit.dist * Math.tan((FOV * Math.PI) / 360);
      this.view = { cx: this.orbit.tx, cy: this.orbit.ty, scale: this.height / viewH };
    }
    this.mode = mode;
    this.request();
  }

  /** Camera distance at which a w x h area fills the view. */
  private distFor(w: number, h: number) {
    const t = Math.tan((FOV * Math.PI) / 360);
    return Math.max(h / 2 / t, w / 2 / (t * (this.width / this.height)));
  }

  /** CSS pixels per µm at the center of the view. */
  pxPerUm() {
    if (this.mode === "2d") return this.view.scale;
    return this.height / (2 * this.orbit.dist * Math.tan((FOV * Math.PI) / 360));
  }

  private setOrigin(x: number, y: number) {
    const hx = Math.fround(x);
    const hy = Math.fround(y);
    this.originHi.value.set(hx, hy);
    this.originLo.value.set(x - hx, y - hy);
  }

  private updatePersp() {
    const o = this.orbit;
    const cp = Math.cos(o.phi);
    this.persp.aspect = this.width / this.height;
    this.persp.near = Math.max(o.dist * 0.002, 1e-4);
    this.persp.far = o.dist * 200;
    this.persp.up.set(0, 0, 1);
    this.persp.position.set(o.dist * Math.sin(o.phi) * Math.cos(o.theta), o.dist * Math.sin(o.phi) * Math.sin(o.theta), o.tz + o.dist * cp);
    this.persp.lookAt(0, 0, o.tz);
    this.persp.updateProjectionMatrix();
    this.persp.updateMatrixWorld();
  }

  private draw() {
    const is3d = this.mode === "3d";
    let camera: THREE.Camera;
    let visible: (b: BBox) => boolean;
    if (!is3d) {
      const v = this.view;
      this.setOrigin(v.cx, v.cy);
      const hw = this.width / 2 / v.scale;
      const hh = this.height / 2 / v.scale;
      this.ortho.left = -hw;
      this.ortho.right = hw;
      this.ortho.top = hh;
      this.ortho.bottom = -hh;
      this.ortho.position.set(0, 0, 2000);
      this.ortho.lookAt(0, 0, 0);
      this.ortho.updateProjectionMatrix();
      this.ortho.updateMatrixWorld();
      camera = this.ortho;
      const vb = this.viewBox();
      visible = (b) => b[2] >= vb[0] && b[0] <= vb[2] && b[3] >= vb[1] && b[1] <= vb[3];
    } else {
      const o = this.orbit;
      this.setOrigin(o.tx, o.ty);
      this.updatePersp();
      camera = this.persp;
      const fr = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(this.persp.projectionMatrix, this.persp.matrixWorldInverse),
      );
      const zTop = this.maxZ();
      const box3 = new THREE.Box3();
      visible = (b) => {
        box3.min.set(b[0] - o.tx, b[1] - o.ty, -1);
        box3.max.set(b[2] - o.tx, b[3] - o.ty, zTop + 1);
        return fr.intersectsBox(box3);
      };
      // Key light sits above and to the left of the camera, so walls facing the viewer read clearly.
      this.light.value.set(Math.cos(o.theta - 0.7), Math.sin(o.theta - 0.7), 1.3);
      this.fogRange.value.set(o.dist * 1.2, o.dist * 6);
      const sb = this.sceneBox;
      if (this.s3d.clip) {
        const axis = this.s3d.clipAxis;
        const at = axis === "x" ? sb[0] + (sb[2] - sb[0]) * this.s3d.clipAt : sb[1] + (sb[3] - sb[1]) * this.s3d.clipAt;
        const rel = axis === "x" ? at - o.tx : at - o.ty;
        if (axis === "x") this.clip.value.set(-1, 0, 0, rel);
        else this.clip.value.set(0, 1, 0, -rel);
        this.clipOn.value = 1;
      } else this.clipOn.value = 0;
    }

    const ppu = this.pxPerUm();
    this.chooseLod(ppu, is3d, visible);
    let drawn = 0;
    let instances = 0;
    for (const c of this.cells) {
      const id = c.data.id;
      const cellOn = !this.hiddenCells.has(id) && !(this.hideTop && id === this.sceneTop);
      const px = c.extent * ppu;
      const lod = c.lod;
      // Stand-ins take the color of the largest visible layer and vanish when none is visible.
      let lm: ReturnType<LayoutRenderer["lodMat"]> | null = null;
      if (lod && !is3d)
        for (const k of c.data.keysByArea)
          if (this.styles.get(k)?.visible) {
            lm = this.lodMat(k);
            break;
          }
      for (const o of c.objs) {
        let on = cellOn;
        if (on) {
          if (o.kind === "box" || o.kind === "boxEdge" || o.kind === "point") {
            on = !is3d && lod && lm !== null && (o.kind === "point" ? px < 1.2 : px >= 1.2);
            if (on) o.obj.material = o.kind === "box" ? lm!.fill : o.kind === "boxEdge" ? lm!.edge : lm!.point;
          } else if (lod) on = false;
          else {
            const s = this.styles.get(o.key);
            if (!s) on = false;
            else if (o.kind === "solid") on = is3d && s.visible3d;
            else on = !is3d && s.visible;
          }
        }
        if (on) on = visible(o.box);
        o.obj.visible = on;
        if (on) {
          drawn++;
          instances += (o.obj.geometry as THREE.InstancedBufferGeometry).instanceCount;
        }
      }
    }
    this.stats = { drawn, instances };
    this.gl.render(this.root, camera);
    this.onFrame?.();
  }

  /**
   * Marks cells drawn as stand-ins: those below a few pixels, then, if the view
   * still holds too many triangles, the smallest remaining ones on screen.
   */
  private chooseLod(ppu: number, is3d: boolean, visible: (b: BBox) => boolean) {
    const minPx = is3d ? 1 : LOD_PX;
    const cand: { c: RCell; cost: number; px: number }[] = [];
    let total = 0;
    for (const c of this.cells) {
      const px = c.extent * ppu;
      c.lod = c.data.count > 1 && px < minPx;
      if (c.lod || c.data.count <= 1 || this.hiddenCells.has(c.data.id)) continue;
      let inView = 0;
      for (const ch of c.chunks) if (visible(ch.box)) inView += ch.count;
      const cost = inView * c.tri;
      total += cost;
      cand.push({ c, cost, px });
    }
    // Solids carry roughly three times the triangles of the flat fill (walls).
    const budget = is3d ? TRI_BUDGET_3D / 3 : TRI_BUDGET_2D;
    if (total <= budget) return;
    cand.sort((a, b) => a.px - b.px);
    for (const x of cand) {
      if (total <= budget) break;
      x.c.lod = true;
      total -= x.cost;
    }
  }

  private maxZ() {
    let z = 0;
    let i = 0;
    for (const s of this.styles.values()) {
      z = Math.max(z, (s.z + s.t) * this.s3d.exaggeration + i * this.s3d.explode);
      i++;
    }
    return z;
  }

  /** Renders the current view at a higher pixel ratio and returns the WebGL canvas pixels. */
  snapshot(scale: number): HTMLCanvasElement {
    const dpr = this.px.value;
    this.px.value = scale;
    this.gl.setPixelRatio(scale);
    this.gl.setSize(this.width, this.height, false);
    this.draw();
    const out = document.createElement("canvas");
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    out.getContext("2d")!.drawImage(this.canvas, 0, 0);
    this.px.value = dpr;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.draw();
    return out;
  }

  /** Placements of one cell as world boxes, for highlighting. */
  cellBoxes(cellId: number, max = 50_000): BBox[] {
    const c = this.cells.find((x) => x.data.id === cellId);
    if (!c) return [];
    const b = c.data.ownBox;
    const out: BBox[] = [];
    for (const ch of c.data.chunks) {
      const a = ch.inst;
      for (let k = 0; k < ch.count && out.length < max; k++) {
        const o = k * 8;
        const tx = a[o + 4] + a[o + 6];
        const ty = a[o + 5] + a[o + 7];
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const [x, y] of [
          [b[0], b[1]],
          [b[2], b[1]],
          [b[2], b[3]],
          [b[0], b[3]],
        ]) {
          const wx = a[o] * x + a[o + 2] * y + tx;
          const wy = a[o + 1] * x + a[o + 3] * y + ty;
          x0 = Math.min(x0, wx);
          y0 = Math.min(y0, wy);
          x1 = Math.max(x1, wx);
          y1 = Math.max(y1, wy);
        }
        out.push([x0, y0, x1, y1]);
      }
    }
    return out;
  }

  dispose() {
    this.clearScene();
    this.gl.dispose();
  }
}
