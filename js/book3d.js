// A real 3D book (three.js): hardcover with thickness and a rounded spine, page stacks that grow and shrink,
// bendable leaves with spring physics, orbit-anywhere handling, riffling when you jump across the year.
// Reading/writing happens in the flat "write view" (js/book.js) that zooms in over the 3D scene.
//
// Coordinates: the book faces the camera. +x = right, +y = up the page, +z = out of the page toward you.
// The spine is the y axis at x = 0; the right-hand pages span x ∈ [0, W].
// Pages are numbered like the printed book: -1 cover, 0 inside cover, 1..366 dates, 367 inside back cover.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { h, icon, clamp, debounce } from './ui.js';
import { PAGES, LAST, MONTHS, MONTHS_SHORT, dateKey, today, pageOf, pageOfKey, parseKey } from './dates.js';
import * as store from './store.js';
import { createBook as createFlatBook } from './book.js';
import * as PT from './pagetex.js';

// ---- dimensions (page width = 1) ----------------------------------------------
const W = 1, H = 1.6, C = 0.03, OVER_X = 0.045, OVER_Y = 0.04, T = 0.2;
const COLS = 30, ROWS = 12;
const SIGMA = 0.16, GAMMA0 = 0.3;          // how the page dips into the gutter
const MAX_S = 184;                          // spreads: 0 closed … 184 last
const BOARD_W = W + OVER_X, BOARD_H = H + 2 * OVER_Y;
const LEAF_POOL = 10;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarseDevice = matchMedia('(pointer: coarse)').matches;

const spreadOfPage = (n) => (n < 0 ? 0 : Math.floor(n / 2) + 1);
const leftPage = (s) => (s < 2 ? null : 2 * s - 2);
const rightPage = (s) => (s >= 184 ? null : s === 0 ? 1 : 2 * s - 1);

// ---- page shape: one function shapes static pages and turning leaves -----------
function profile() {
  const xs = [0], zs = [0];
  const ds = W / COLS;
  let x = 0, z = 0;
  for (let i = 0; i < COLS; i++) {
    const phi = GAMMA0 * Math.exp(-((i + 0.5) / COLS) * W / SIGMA);
    x += ds * Math.cos(phi); z += ds * Math.sin(phi);
    xs.push(x); zs.push(z);
  }
  return { xs, zs, rise: z };
}
const PROF = profile();

function writeSheet(pos, theta, A, rootZ, corner) {
  const ds = W / COLS;
  const cg = GAMMA0 * Math.cos(theta);
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    const y = (v - 0.5) * H;
    const Ar = A * (1 + corner * (v - 0.5) * 1.6);
    let x = 0, z = rootZ;
    let o = r * (COLS + 1) * 3;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    for (let i = 0; i < COLS; i++) {
      const u = (i + 0.5) / COLS;
      let phi = theta + cg * Math.exp(-u * W / SIGMA) + Ar * Math.pow(u, 1.5);
      phi = phi < 0 ? 0 : phi > Math.PI ? Math.PI : phi;
      x += ds * Math.cos(phi); z += ds * Math.sin(phi);
      o += 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    }
  }
}

function sheetGeometry(mirrorU) {
  const geo = new THREE.BufferGeometry();
  const nv = (COLS + 1) * (ROWS + 1);
  const uv = new Float32Array(nv * 2);
  const idx = [];
  for (let r = 0; r <= ROWS; r++) {
    for (let i = 0; i <= COLS; i++) {
      const k = r * (COLS + 1) + i;
      uv[k * 2] = mirrorU ? 1 - i / COLS : i / COLS;
      uv[k * 2 + 1] = r / ROWS;
      if (r < ROWS && i < COLS) {
        const a = k, b = k + 1, c = k + COLS + 1, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** A sheet of paper: front face + back face sharing one bendable surface. */
class Sheet {
  constructor() {
    this.front = sheetGeometry(false);
    this.back = sheetGeometry(true);
    this.back.setAttribute('position', this.front.getAttribute('position'));
    writeSheet(this.front.getAttribute('position').array, 0, 0, 0, 0);
    this.front.computeVertexNormals();
    this.back.setAttribute('normal', this.front.getAttribute('normal'));
    this.matF = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, side: THREE.FrontSide });
    this.matB = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, side: THREE.BackSide });
    this.meshF = new THREE.Mesh(this.front, this.matF);
    this.meshB = new THREE.Mesh(this.back, this.matB);
    for (const m of [this.meshF, this.meshB]) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; }
    this.group = new THREE.Group();
    this.group.add(this.meshF, this.meshB);
    this.meshF.userData.kind = this.meshB.userData.kind = 'page';
  }
  textures(f, b) {
    const fresh = !this.matF.map || !this.matB.map;
    this.matF.map = f; this.matB.map = b;
    if (fresh) this.matF.needsUpdate = this.matB.needsUpdate = true;
  }
  shape(theta, A, rootZ, corner) {
    const p = this.front.getAttribute('position');
    writeSheet(p.array, theta, A, rootZ, corner);
    p.needsUpdate = true;
    this.front.computeVertexNormals();
    this.front.getAttribute('normal').needsUpdate = true;
  }
}

// ---- page-edge stack (custom geometry so its top follows the page curve) ------------
class Stack {
  constructor(material, capMaterial) {
    const n = COLS + 1;
    this.n = n;
    const verts = n * 2 * 2 + 4 + n * 2; // two long sides, outer end, cap
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(verts * 3);
    this.uv = new Float32Array(verts * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    const idx = [];
    const strip = (a0, count, flip) => { // a0: first vertex of the strip; vertices alternate bottom, top
      for (let i = 0; i < count - 1; i++) {
        const b0 = a0 + i * 2, t0 = b0 + 1, b1 = b0 + 2, t1 = b0 + 3;
        flip ? idx.push(b0, t1, b1, b0, t0, t1) : idx.push(b0, b1, t1, b0, t1, t0);
      }
    };
    strip(0, n, false);
    strip(n * 2, n, true);
    const endBase = n * 4;
    idx.push(endBase, endBase + 1, endBase + 2, endBase, endBase + 2, endBase + 3);
    strip(endBase + 4, n, false);
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, [material, capMaterial]);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.userData.kind = 'stack';
    this.geo.addGroup(0, (n - 1) * 6 * 2 + 6, 0);
    this.geo.addGroup((n - 1) * 6 * 2 + 6, (n - 1) * 6, 1);
  }
  update(root) {
    const { pos, uv, n } = this;
    const set = (vi, x, y, z, v) => { pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z; uv[vi * 2] = x; uv[vi * 2 + 1] = v; };
    const tv = (z) => z / 0.034;
    for (let i = 0; i < n; i++) {
      const x = PROF.xs[i] - (i === n - 1 ? 0.004 : 0);
      const top = Math.max(0.002, root + PROF.zs[i] - 0.004);
      set(i * 2, x, -H / 2, 0, 0);
      set(i * 2 + 1, x, -H / 2, top, tv(top));
      set(n * 2 + i * 2, x, H / 2, 0, 0);
      set(n * 2 + i * 2 + 1, x, H / 2, top, tv(top));
    }
    const topEnd = Math.max(0.002, root + PROF.rise - 0.004);
    const xe = PROF.xs[n - 1] - 0.004, eb = n * 4;
    set(eb, xe, -H / 2, 0, 0); set(eb + 1, xe, H / 2, 0, 0);
    set(eb + 2, xe, H / 2, topEnd, tv(topEnd)); set(eb + 3, xe, -H / 2, topEnd, tv(topEnd));
    for (let i = 0; i < n; i++) {
      const top = Math.max(0.002, root + PROF.zs[i] - 0.004);
      const x = PROF.xs[i];
      set(eb + 4 + i * 2, x, -H / 2, top, 0);
      set(eb + 4 + i * 2 + 1, x, H / 2, top, 1);
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('uv').needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ---- textures ---------------------------------------------------------------------
class TexMgr {
  constructor(renderer) {
    this.renderer = renderer;
    this.cache = new Map();
    this.ver = new Map();
    this.global = 0;
    this.queue = [];
    this.pinned = new Set();
    this.blank = this.fromCanvas(Object.assign(document.createElement('canvas'), { width: 8, height: 8 }));
    const bg = this.blank.image.getContext('2d'); bg.fillStyle = '#f6f2e7'; bg.fillRect(0, 0, 8, 8);
  }
  fromCanvas(cv, { repeat = false } = {}) {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  sig() {
    const s = store.getSettings();
    return [store.bookYears().join(','), s.writing, s.hand, today().key, this.global].join('|');
  }
  env() {
    const s = store.getSettings();
    return { years: store.bookYears(), pageYears: store.pageYears, writing: s.writing, hand: s.hand, todayKey: today().key, getText: store.getText };
  }
  bump(page) { if (page == null) this.global++; else this.ver.set(page, (this.ver.get(page) || 0) + 1); }
  /** low: a cheap 256px version used by leaves that are only on screen for a fraction of a second. */
  get(n, { async = false, low = false } = {}) {
    const key = low ? `l${n}` : n;
    let e = this.cache.get(key);
    const sig = this.sig(), ver = this.ver.get(n) || 0;
    if (!e) {
      const { w, h } = low ? { w: 256, h: 410 } : PT.texSize();
      const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const g = cv.getContext('2d'); g.fillStyle = '#f6f2e7'; g.fillRect(0, 0, w, h);
      e = { cv, tex: this.fromCanvas(cv), sig: null, ver: -1, n, key };
      this.cache.set(key, e);
    }
    this.pinned.add(key);
    if (e.sig !== sig || e.ver !== ver) {
      if (async) { if (!this.queue.includes(key)) this.queue.push(key); } else this.draw(e, sig, ver);
    }
    return e.tex;
  }
  draw(e, sig, ver) {
    PT.drawPage(e.cv, e.n, this.env());
    e.tex.needsUpdate = true;
    e.sig = sig; e.ver = ver;
  }
  /** Draw one queued texture; returns true if work remains. */
  pump() {
    const key = this.queue.shift();
    if (key == null) return false;
    const e = this.cache.get(key);
    if (e) this.draw(e, this.sig(), this.ver.get(e.n) || 0);
    return this.queue.length > 0;
  }
  trim(keep = coarseDevice ? 12 : 16) {
    if (this.cache.size <= keep) return;
    for (const [n, e] of this.cache) {
      if (this.cache.size <= keep) break;
      if (this.pinned.has(n)) continue;
      e.tex.dispose(); this.cache.delete(n);
    }
  }
  pin(list) { this.pinned = new Set(list); }
}

// ---- the book ---------------------------------------------------------------------
export function createBook3D({ openSettings }) {
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL is not available');

  const coarse = coarseDevice;
  PT.setTexWidth(coarse ? 768 : 1024);

  // DOM ---------------------------------------------------------------------------
  const canvas = h('canvas.b3d-canvas');
  const hint = h('div.book-hint', 'Tap the cover to open · drag to turn the book around');
  const resetBtn = h('button.ctl.b3d-reset', { type: 'button', hidden: true, onclick: () => resetView() }, icon('undo', 18), h('span', 'Reset view'));
  const stage = h('div.b3d-stage', canvas, hint);

  const prevBtn = h('button.ctl', { type: 'button', 'aria-label': 'Previous page', onclick: () => step(-1) }, icon('left', 22));
  const nextBtn = h('button.ctl', { type: 'button', 'aria-label': 'Next page', onclick: () => step(1) }, icon('right', 22));
  const dateBtn = h('button.ctl.date-label', { type: 'button', 'aria-label': 'Jump to a date', onclick: () => openJump() });
  const todayBtn = h('button.ctl.today-btn', { type: 'button', title: 'Go to today', onclick: () => goToday() }, icon('today', 18), h('span', 'Today'));
  const closeBtn = h('button.ctl.close-btn', { type: 'button', title: 'Close the book', onclick: () => goTo(-1) }, icon('closed', 18), h('span', 'Close'));
  const strip = createStrip();
  const controls = h('div.book-controls', h('div.ctl-nav', closeBtn, prevBtn, dateBtn, nextBtn, todayBtn, resetBtn), strip.el);
  const overlayBack = h('button.write-back', { type: 'button', onclick: () => closeWrite() }, icon('arrowLeft', 18), h('span', 'Back to the book'));
  const overlay = h('div.write-overlay', { hidden: true }, overlayBack);
  const el = h('div.view-book3d', stage, controls, overlay);

  // three.js ------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  const FOV_T = Math.tan((camera.fov * Math.PI) / 360);

  scene.add(new THREE.HemisphereLight(0xfff3dd, 0x6b5a46, 0.5));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.25);
  sun.position.set(-2.6, 3.4, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 16 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.012; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const blobCv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  { const g = blobCv.getContext('2d'); const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobCv), transparent: true, opacity: 0.5, depthWrite: false }));
  blob.position.z = -0.9;
  scene.add(blob);

  const rig = new THREE.Group();   // orbit rotation
  const inner = new THREE.Group(); // keeps the book centred as it opens
  rig.add(inner);
  scene.add(rig);
  inner.position.z = -T / 2;

  const tex = new TexMgr(renderer);
  const clothCv = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
  PT.drawCloth(clothCv);
  const clothTex = tex.fromCanvas(clothCv, { repeat: true });
  const clothMat = new THREE.MeshStandardMaterial({ map: clothTex, bumpMap: clothTex, bumpScale: 0.6, roughness: 0.92, metalness: 0 });
  const edgeCv = Object.assign(document.createElement('canvas'), { width: 8, height: 64 });
  PT.drawEdge(edgeCv);
  const edgeTex = tex.fromCanvas(edgeCv, { repeat: true });
  const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 1, side: THREE.DoubleSide });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xe3dbc4, roughness: 1, side: THREE.DoubleSide });

  // boards ------------------------------------------------------------------------------
  const BW = 1024, BH = Math.round((1024 * BOARD_H) / BOARD_W);
  const insideTex = (front) => tex.fromCanvas(PT.drawInsideBoard(BW, BH, {
    title: front, owner: store.getSettings().owner, years: store.bookYears(), hand: store.getSettings().hand, spineOnRight: front,
  }));
  let insideFront = insideTex(true), insideBack = insideTex(false);
  const coverMaps = PT.drawCover(BW, BH);
  const coverColor = tex.fromCanvas(coverMaps.color);
  const coverMetal = tex.fromCanvas(coverMaps.metal); coverMetal.colorSpace = THREE.NoColorSpace;
  const coverRough = tex.fromCanvas(coverMaps.rough); coverRough.colorSpace = THREE.NoColorSpace;
  const coverMat = new THREE.MeshStandardMaterial({ map: coverColor, metalnessMap: coverMetal, roughnessMap: coverRough, metalness: 0.7, roughness: 0.9, bumpMap: coverRough, bumpScale: -0.4, envMapIntensity: 2.2, emissiveMap: coverMetal, emissive: new THREE.Color(0x8a6b22), emissiveIntensity: 0.55 });
  const mkInside = (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
  let frontInsideMat = mkInside(insideFront), backInsideMat = mkInside(insideBack);
  const boardGeo = new THREE.BoxGeometry(BOARD_W, BOARD_H, C);
  // BoxGeometry material order: +x -x +y -y +z -z
  const backBoard = new THREE.Mesh(boardGeo, [clothMat, clothMat, clothMat, clothMat, backInsideMat, clothMat]);
  backBoard.position.set(BOARD_W / 2, 0, -C / 2);
  const frontPivot = new THREE.Group();
  frontPivot.position.set(0, 0, T / 2);
  const frontBoard = new THREE.Mesh(boardGeo, [clothMat, clothMat, clothMat, clothMat, coverMat, frontInsideMat]);
  frontBoard.position.set(BOARD_W / 2, 0, T / 2 + C / 2);
  frontPivot.add(frontBoard);
  for (const m of [backBoard, frontBoard]) { m.castShadow = true; m.receiveShadow = true; }
  backBoard.userData.kind = 'other'; frontBoard.userData.kind = 'cover';

  const spine = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, BOARD_H, 28, 1, true, Math.PI, Math.PI), new THREE.MeshStandardMaterial({ map: clothTex, bumpMap: clothTex, bumpScale: 0.6, roughness: 0.9, side: THREE.DoubleSide }));
  spine.castShadow = true; spine.userData.kind = 'other';

  const stackR = new Stack(edgeMat, capMat);
  const stackL = new Stack(edgeMat, capMat);
  stackL.mesh.scale.x = -1;

  const sheetR = new Sheet();   // static right page (front face visible)
  const sheetL = new Sheet();   // static left page (back face visible)
  sheetR.meshB.visible = false; sheetL.meshF.visible = false;
  const pool = Array.from({ length: LEAF_POOL }, () => { const s = new Sheet(); s.group.visible = false; return s; });
  inner.add(backBoard, frontPivot, spine, stackR.mesh, stackL.mesh, sheetR.group, sheetL.group, ...pool.map((p) => p.group));
  const pickables = [frontBoard, backBoard, spine, stackR.mesh, stackL.mesh, sheetR.meshF, sheetL.meshB, ...pool.flatMap((p) => [p.meshF, p.meshB])];

  // state -------------------------------------------------------------------------------------
  const S = {
    s: 0,                 // resting spread (0 = closed)
    sR: 0, sL: 0,         // spreads the static pages currently show (differ from s mid-flight)
    tR: T, tL: 0,         // displayed stack thicknesses (smoothed)
    coverTheta: 0,
    userPose: false,
    userZoom: 1,
    single: false,        // tall/narrow screens: frame one page at a time
    side: 'R',            // which page of the spread is framed in single mode
    panX: 0,
    busy: false,
    write: null,
    dirty: true,
  };
  const flights = [];
  const q = new THREE.Quaternion();
  const qRead = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.26, 0, 0));
  const qClosed = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0.5, 0.03));
  q.copy(qClosed);
  const omega = new THREE.Vector2();
  let size = { w: 1, h: 1 };

  // layout ---------------------------------------------------------------------------------
  const openAmount = () => clamp(S.coverTheta / Math.PI, 0, 1);

  function applyCover() {
    const o = openAmount();
    frontPivot.rotation.y = -S.coverTheta;
    const r = ((T + C) * (1 - o) + C) / 2;
    spine.scale.set(r, 1, r);
    spine.position.set(0, 0, -C + r);
    inner.position.x = -(BOARD_W / 2 - 0.05) * (1 - smooth(o));
  }
  const smooth = (t) => t * t * (3 - 2 * t);

  function stackTargets() {
    const left = S.sL < 1 ? 0 : clamp((S.sL - 1) / 183, 0, 1);
    const right = S.sR >= 184 ? 0 : clamp((184 - Math.max(S.sR, 1)) / 183, 0, 1);
    return { tR: right * T, tL: left * T };
  }
  const rootFor = (t) => Math.max(t - PROF.rise - 0.002, 0.003);

  function layoutStatics() {
    const rootR = rootFor(S.tR), rootL = rootFor(S.tL);
    const pR = rightPage(S.sR), pL = leftPage(S.sL);
    sheetR.group.visible = pR != null;
    sheetL.group.visible = pL != null;
    if (pR != null) sheetR.shape(0, 0, rootR, 0);
    if (pL != null) sheetL.shape(Math.PI, 0, rootL, 0);
    stackR.mesh.visible = S.tR > 0.004;
    stackL.mesh.visible = S.tL > 0.004;
    if (stackR.mesh.visible) stackR.update(rootR);
    if (stackL.mesh.visible) stackL.update(rootL);
  }

  function setStaticTextures() {
    const pR = rightPage(S.sR), pL = leftPage(S.sL);
    const used = [];
    if (pR != null) { sheetR.textures(tex.get(pR), tex.blank); used.push(pR); }
    if (pL != null) { sheetL.textures(tex.blank, tex.get(pL)); used.push(pL); }
    for (const f of flights) { if (f.front) used.push(...f.keys); }
    tex.pin(used);
  }

  function setStatics(sR, sL) {
    S.sR = sR; S.sL = sL;
    setStaticTextures();
    layoutStatics();
    dirty();
  }

  // camera ------------------------------------------------------------------------------------
  function camDistance() {
    const aspect = size.w / size.h;
    const need = (hw, hh) => Math.max(hh / FOV_T, hw / (FOV_T * aspect));
    const open = S.single ? need(BOARD_W / 2 + 0.2, BOARD_H / 2 + 0.2) : need(BOARD_W + 0.16, BOARD_H / 2 + 0.22);
    const closed = need(BOARD_W / 2 + 0.34, BOARD_H / 2 + 0.2);
    return (closed + (open - closed) * smooth(openAmount())) / S.userZoom;
  }

  function wantedPose() {
    const opening = S.s > 0 || flights.some((f) => f.cover && (f.dir > 0 || f.dragging));
    return opening ? qRead : qClosed;
  }

  // flights ------------------------------------------------------------------------------------
  function makeFlight({ j, dir, delay = 0, i = 0, n = 1, k = 62, c = 15, dragging = false, corner = 0 }) {
    const cover = j === 0;
    if (cover && !dragging) { k = Math.min(k, 38); c = 11.5; } // the heavy board swings more slowly than paper
    const f = { j, dir, delay, i, n, k, c, cover, dragging, corner, theta: dir > 0 ? 0 : Math.PI, vel: 0, target: dir > 0 ? Math.PI : 0, landed: false, sheet: null, front: null, back: null };
    if (!cover) {
      f.sheet = pool.find((p) => !p.group.visible && !flights.some((x) => x.sheet === p));
      if (!f.sheet) return null;
      f.front = 2 * j - 1; f.back = 2 * j;
      const low = n > 3;
      f.keys = low ? [`l${f.front}`, `l${f.back}`] : [f.front, f.back];
      f.sheet.textures(tex.get(f.front, { low, async: low && i > 0 }), tex.get(f.back, { low, async: low && i > 0 }));
      f.sheet.group.visible = true;
    }
    flights.push(f);
    return f;
  }

  function applyFlight(f) {
    if (f.cover) { S.coverTheta = f.theta; applyCover(); return; }
    const t = f.theta / Math.PI;
    let A = 0.62 * Math.sin(2 * Math.PI * t) - 0.04 * f.vel;
    A = clamp(A, -1, 1);
    const progress = f.dir > 0 ? t : 1 - t;
    // stacked leaves keep their order: the first to leave is on top at the start, the last to land is on top at the end
    const off = (f.n - f.i) * 0.0013 * (1 - progress) + f.i * 0.0013 * progress + 0.001 * Math.sin(Math.PI * t);
    const root = rootFor(S.tR) * (1 - t) + rootFor(S.tL) * t + off;
    f.sheet.shape(f.theta, A, root, f.corner);
  }

  function endOf(f) { return f.dir > 0 ? Math.PI : 0; }

  function stepFlights(dt) {
    let moving = false;
    for (const f of flights) {
      if (f.landed) continue;
      if (f.delay > 0) { f.delay -= dt; moving = true; applyFlight(f); continue; }
      const sub = Math.max(1, Math.ceil(dt / (1 / 160)));
      const hdt = dt / sub;
      for (let n = 0; n < sub; n++) {
        const acc = f.k * (f.target - f.theta) - f.c * f.vel;
        f.vel += acc * hdt;
        f.theta += f.vel * hdt;
        if (f.theta < 0) { f.theta = 0; f.vel = 0; }
        if (f.theta > Math.PI) { f.theta = Math.PI; f.vel = 0; }
      }
      applyFlight(f);
      moving = true;
      if (!f.dragging && Math.abs(f.target - f.theta) < 0.004 && Math.abs(f.vel) < 0.08) {
        f.theta = f.target; f.vel = 0; f.landed = true; applyFlight(f);
      }
    }
    if (flights.length && flights.every((f) => f.landed)) finalizeFlights();
    return moving;
  }

  let pendingResolves = [];
  let pendingTarget = null; // spread to commit when every leaf has landed (null = leaves returned to start)
  function finalizeFlights() {
    const committed = flights.every((f) => f.theta === endOf(f)) ? pendingTarget : null;
    const s2 = committed ?? S.s;
    for (const f of flights) if (f.sheet) { f.sheet.group.visible = false; }
    flights.length = 0;
    S.s = s2;
    S.coverTheta = s2 >= 1 ? Math.PI : 0;
    applyCover();
    S.sR = s2; S.sL = s2;
    setStaticTextures();
    layoutStatics();
    S.busy = false;
    pendingTarget = null;
    updateLabels();
    queueWarmup();
    const rs = pendingResolves; pendingResolves = [];
    rs.forEach((r) => r());
    dirty();
  }

  /** Move to spread s2: starts the leaves flying (many at once when the jump is long). */
  function transition(s2, { instant = false } = {}) {
    const s = S.s;
    s2 = clamp(s2, 0, MAX_S);
    if (s2 === s || S.busy) return Promise.resolve();
    const dir = s2 > s ? 1 : -1;
    S.busy = true;
    S.userPose = false;
    const lo = Math.min(s, s2), hi = Math.max(s, s2);
    let js = [];
    for (let j = lo; j < hi; j++) js.push(j);
    if (dir < 0) js.reverse();
    const MAXF = LEAF_POOL - 1;
    if (js.length > MAXF) {
      const pick = new Set();
      for (let i = 0; i < MAXF; i++) pick.add(js[Math.round((i * (js.length - 1)) / (MAXF - 1))]);
      js = js.filter((j) => pick.has(j));
    }
    const riffle = js.length > 1;
    if (dir > 0) setStatics(s2, s); else setStatics(s, s2);
    pendingTarget = s2;
    const n = js.length;
    js.forEach((j, i) => {
      const f = makeFlight({
        j, dir, i, n,
        delay: instant ? 0 : i * (riffle ? 0.07 : 0),
        k: riffle ? 120 : 62, c: riffle ? 21 : 15,
        corner: (i % 2 ? -1 : 1) * 0.35,
      });
      if (!f) return;
      if (instant) { f.theta = f.target; f.landed = true; applyFlight(f); }
    });
    // cover-first ordering when opening: let the cover lift before the pages start
    if (dir > 0 && js[0] === 0 && js.length > 1) flights.forEach((f) => { if (!f.cover) f.delay += 0.28; });
    if (reduceMotion() || instant) { flights.forEach((f) => { f.theta = f.target; f.landed = true; applyFlight(f); }); finalizeFlights(); return Promise.resolve(); }
    dirty();
    return new Promise((res) => pendingResolves.push(res));
  }

  // public navigation ----------------------------------------------------------------------------
  async function goTo(page, { focusKey, instant = false } = {}) {
    if (S.write) return;
    if (flights.length && flights.every((f) => f.dragging)) return;
    if (S.busy) return;
    const s2 = spreadOfPage(page);
    if (page > 0) S.side = validSide(s2, page % 2 === 0 ? 'L' : 'R');
    await transition(s2, { instant });
    if (focusKey) pulseHint(focusKey);
  }
  function pulseHint() { /* the flat write view pulses slots; the 3D page already highlights today */ }
  function step(dir) {
    if (S.busy || S.write) return;
    backToReading();
    if (S.single && S.s > 0) {
      // one page at a time, in true page order: …L, R, (turn) L, R…
      if (dir > 0 && S.side === 'L' && rightPage(S.s) != null) { S.side = 'R'; updateLabels(); dirty(); return; }
      if (dir < 0 && S.side === 'R' && leftPage(S.s) != null) { S.side = 'L'; updateLabels(); dirty(); return; }
      const s2 = S.s + dir;
      if (s2 < 0 || s2 > MAX_S) return;
      S.side = validSide(s2, dir > 0 ? 'L' : 'R');
      transition(s2);
      updateLabels();
      return;
    }
    goTo(pageForSpread(S.s + dir));
  }
  const pageForSpread = (s) => (s <= 0 ? -1 : rightPage(s) ?? leftPage(s));
  function goToday() { const t = today(); return goTo(t.n, { focusKey: t.key }); }
  function goToKey(k) { const { m, d } = parseKey(k); return goTo(pageOf(m, d), { focusKey: k }); }
  const validSide = (sp, side) => (side === 'L' && leftPage(sp) == null ? 'R' : side === 'R' && rightPage(sp) == null ? 'L' : side);
  const currentPage = () => (S.s === 0 ? -1 : S.single ? (S.side === 'R' ? rightPage(S.s) : leftPage(S.s)) : rightPage(S.s) ?? leftPage(S.s));

  function backToReading() { S.userPose = false; omega.set(0, 0); dirty(); }
  function resetView() { backToReading(); S.userZoom = 1; }

  // gestures ----------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    scene.updateMatrixWorld(true);
    const visible = pickables.filter((m) => m.visible && m.parent?.visible !== false);
    const hit = raycaster.intersectObjects(visible, false)[0];
    if (!hit) return null;
    const o = hit.object;
    let kind = o.userData.kind;
    let page = null;
    if (o === sheetR.meshF) page = rightPage(S.sR);
    else if (o === sheetL.meshB) page = leftPage(S.sL);
    else if (kind === 'page') { const f = flights.find((x) => x.sheet && (x.sheet.meshF === o || x.sheet.meshB === o)); kind = 'leaf'; page = f ? (o === f.sheet.meshF ? f.front : f.back) : null; }
    return { kind, page, uv: hit.uv, point: hit.point };
  }

  const facing = () => new THREE.Vector3(0, 0, 1).applyQuaternion(q).z;
  function spineMetrics() {
    scene.updateMatrixWorld(true);
    const a = new THREE.Vector3(0, 0, T / 2), b = new THREE.Vector3(W, 0, T / 2), c2 = new THREE.Vector3(0, H / 2, T / 2);
    const P = (v) => { const w = inner.localToWorld(v.clone()).project(camera); return { x: ((w.x + 1) / 2) * size.w, y: ((1 - w.y) / 2) * size.h }; };
    const pa = P(a), pb = P(b), pc = P(c2);
    return { x0: pa.x, y0: pa.y, unit: Math.max(60, Math.hypot(pb.x - pa.x, pb.y - pa.y) / W), up: Math.max(40, Math.hypot(pc.x - pa.x, pc.y - pa.y) / (H / 2)) };
  }

  const pointers = new Map();
  let gesture = null, pinch = null;
  stage.addEventListener('pointerdown', (e) => {
    if (S.write || (e.pointerType === 'mouse' && e.button !== 0)) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: S.userZoom };
      gesture = null;
      return;
    }
    omega.set(0, 0);
    gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), hit: pick(e), mode: null, samples: [] };
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      S.userZoom = clamp(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), 0.55, 2.4);
      dirty();
      return;
    }
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.mode) {
      if (Math.hypot(dx, dy) < 7) return;
      const onPage = g.hit && (g.hit.kind === 'page' || g.hit.kind === 'leaf' || (g.hit.kind === 'cover' && S.s === 0));
      const dir = dx < 0 ? 1 : -1;
      const nextS = S.s + dir;
      const horizontal = Math.abs(dx) >= Math.abs(dy) * 0.9;
      const panOnly = S.single && S.s > 0 && onPage && horizontal && !S.busy && ((dir > 0 && S.side === 'L' && rightPage(S.s) != null) || (dir < 0 && S.side === 'R' && leftPage(S.s) != null));
      const canTurn = onPage && !S.busy && horizontal && facing() > 0.6 && nextS >= 0 && nextS <= MAX_S && !panOnly;
      if (panOnly) { g.mode = 'swipe'; step(dir); }
      else if (canTurn) { if (S.single && S.s > 0) S.side = validSide(nextS, dir > 0 ? 'L' : 'R'); startDragTurn(g, dir, e); }
      else g.mode = S.s === 0 ? 'orbit' : 'none'; // the book only spins while it's closed
    }
    if (g.mode === 'orbit') {
      const ddx = e.clientX - g.lx, ddy = e.clientY - g.ly;
      S.userPose = true;
      rotateBy(ddx * 0.0075, ddy * 0.0075);
      const now = performance.now();
      g.samples.push([now, ddx, ddy]);
      if (g.samples.length > 6) g.samples.shift();
    } else if (g.mode === 'turn') {
      updateDragTurn(g, e);
    }
    g.lx = e.clientX; g.ly = e.clientY;
  });

  const endPointer = (e, cancelled) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; gesture = null; return; }
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    gesture = null;
    if (g.mode === 'turn') { releaseDragTurn(g, e, cancelled); return; }
    if (g.mode === 'orbit') {
      const now = performance.now();
      const recent = g.samples.filter((s) => now - s[0] < 90);
      if (recent.length && !cancelled) {
        const dt = Math.max(16, now - recent[0][0]);
        omega.set((recent.reduce((a, s) => a + s[1], 0) / dt) * 1000 * 0.0075, (recent.reduce((a, s) => a + s[2], 0) / dt) * 1000 * 0.0075);
        omega.clampLength(0, 9);
        dirty();
      }
      return;
    }
    if (g.mode || cancelled || performance.now() - g.t0 > 600) return; // any swipe/drag is never a tap
    handleTap(g.hit);
  };
  stage.addEventListener('pointerup', (e) => endPointer(e, false));
  stage.addEventListener('pointercancel', (e) => endPointer(e, true));
  stage.addEventListener('dblclick', (e) => { if (!pick(e)) resetView(); });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) { S.userZoom = clamp(S.userZoom * Math.exp(-e.deltaY * 0.0015), 0.55, 2.4); dirty(); }
  }, { passive: false });

  const axisY = new THREE.Vector3(0, 1, 0), axisX = new THREE.Vector3(1, 0, 0), tmpQ = new THREE.Quaternion();
  function rotateBy(yaw, pitch) {
    q.premultiply(tmpQ.setFromAxisAngle(axisY, yaw));
    q.premultiply(tmpQ.setFromAxisAngle(axisX, pitch));
    q.normalize();
    dirty();
  }

  // drag-to-turn: the finger holds a point on the page, so the page follows it
  function startDragTurn(g, dir) {
    g.mode = 'turn';
    g.dir = dir;
    const s = S.s, s2 = s + dir;
    const m = spineMetrics();
    g.m = m;
    const xr0 = (g.x0 - m.x0) / m.unit;
    g.grab = Math.max(Math.abs(xr0), 0.45 * W);
    g.yr = clamp(-(g.y0 - m.y0) / m.up, -1, 1);
    const j = dir > 0 ? s : s - 1;
    S.busy = true;
    S.userPose = false;
    if (dir > 0) setStatics(s2, s); else setStatics(s, s2);
    pendingTarget = s2;
    const f = makeFlight({ j, dir, dragging: true, corner: g.yr, k: 140, c: 24 });
    g.flight = f;
    g.vs = [];
    if (!f) { S.busy = false; g.mode = 'orbit'; }
  }
  function updateDragTurn(g, e) {
    const f = g.flight; if (!f) return;
    const xr = (e.clientX - g.m.x0) / g.m.unit;
    f.target = Math.acos(clamp(xr / g.grab, -1, 1));
    if (g.dir > 0) f.target = clamp(f.target, 0, Math.PI); else f.target = clamp(f.target, 0, Math.PI);
    g.vs.push([performance.now(), xr]);
    if (g.vs.length > 6) g.vs.shift();
    dirty();
  }
  function releaseDragTurn(g, e, cancelled) {
    const f = g.flight; if (!f) return;
    let vx = 0;
    if (g.vs.length > 1) { const [ta, xa] = g.vs[0], [tb, xb] = g.vs.at(-1); vx = ((xb - xa) / Math.max(10, tb - ta)) * 1000; } // units/s
    const towardEnd = g.dir > 0 ? -vx : vx;
    const progress = g.dir > 0 ? f.theta / Math.PI : 1 - f.theta / Math.PI;
    const commit = !cancelled && ((progress > 0.4 && towardEnd > -0.8) || towardEnd > 1.1);
    f.dragging = false;
    f.target = commit ? endOf(f) : (g.dir > 0 ? 0 : Math.PI);
    f.k = 70; f.c = 15.5;
    if (!commit) { pendingTarget = null; }
    // when reverting, finalizeFlights() sees leaves back at the start and keeps the old spread
    if (!commit) pendingTarget = S.s;
    S.userPose = false;
    dirty();
  }

  // tap → open the write view on that page (and focus the line that was tapped)
  function handleTap(hit) {
    if (!hit) return;
    if (hit.kind === 'cover' && S.s === 0) { backToReading(); goToday(); return; }
    if ((hit.kind === 'page') && hit.page != null && !S.busy) {
      const n = hit.page;
      const py = (1 - hit.uv.y) * 48;
      const { m, d } = PAGES[n];
      const years = store.pageYears(m, d);
      const L = PT.slotLayout(years.length, store.getSettings().writing);
      const i = Math.floor((py - L.top) / L.slotH);
      const key = i >= 0 && i < years.length ? dateKey(years[i], m, d) : null;
      openWrite(n, key);
    }
  }

  // write view (the flat DOM book) ------------------------------------------------------------------
  let flat = null;
  function openWrite(page, key) {
    if (!flat) {
      flat = createFlatBook({ openSettings });
      overlay.append(flat.el);
    }
    S.write = { page };
    overlay.hidden = false;
    document.body.classList.add('writing');
    requestAnimationFrame(() => overlay.classList.add('on'));
    canvas.classList.add('zoomed');
    flat.jumpTo(page, key);
  }
  function closeWrite() {
    if (!S.write) return;
    document.activeElement?.blur?.();
    store.flush();
    const p = flat.page;
    overlay.classList.remove('on');
    canvas.classList.remove('zoomed');
    document.body.classList.remove('writing');
    setTimeout(() => { overlay.hidden = true; }, 260);
    S.write = null;
    tex.bump(null);
    setStaticTextures();
    if (p > 0 && spreadOfPage(p) !== S.s) transition(spreadOfPage(p), { instant: true });
    dirty();
  }

  // render loop -----------------------------------------------------------------------------------------
  let raf = 0, lastT = 0, idleWarm = 0;
  function dirty() { S.dirty = true; if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }

  // Adaptive quality: if animation frames take too long (weak GPU / software rendering), drop soft shadows,
  // then shadows entirely, then to 1× pixel ratio — smoothness matters more than shadow polish.
  let quality = 2, slow = 0;
  function degrade() {
    quality--;
    if (quality === 1) {
      renderer.shadowMap.type = THREE.BasicShadowMap;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    } else if (quality <= 0) {
      renderer.shadowMap.enabled = false;
      renderer.setPixelRatio(1);
      renderer.setSize(size.w, size.h, false);
      sun.castShadow = false;
    }
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    slow = 0;
  }

  function frame(now) {
    raf = 0;
    const raw = (now - lastT) / 1000;
    const dt = Math.min(0.05, Math.max(0.001, raw));
    lastT = now;
    let active = false;
    if (quality > 0 && (flights.length || omega.lengthSq() > 1e-5)) {
      slow = raw > 0.045 && raw < 1 ? slow + 1 : Math.max(0, slow - 1);
      if (slow >= 10) degrade();
    }

    if (stepFlights(dt)) active = true;

    // smooth stack thickness
    const tt = stackTargets();
    const k = 1 - Math.exp(-9 * dt);
    if (Math.abs(tt.tR - S.tR) > 0.0003 || Math.abs(tt.tL - S.tL) > 0.0003) {
      S.tR += (tt.tR - S.tR) * k; S.tL += (tt.tL - S.tL) * k;
      layoutStatics();
      active = true;
    } else if (S.tR !== tt.tR || S.tL !== tt.tL) { S.tR = tt.tR; S.tL = tt.tL; layoutStatics(); }

    // orbit inertia + easing back to the reading pose
    if (omega.lengthSq() > 1e-5 && !gesture) {
      rotateBy(omega.x * dt, omega.y * dt);
      omega.multiplyScalar(Math.exp(-3.2 * dt));
      active = true;
    }
    const target = wantedPose();
    if (!S.userPose && !(gesture && gesture.mode === 'orbit')) {
      const ang = q.angleTo(target);
      if (ang > 0.002) { q.slerp(target, 1 - Math.exp(-5.5 * dt)); active = true; } else q.copy(target);
    }
    rig.quaternion.copy(q);
    const away = q.angleTo(wantedPose()) > 0.35 || Math.abs(S.userZoom - 1) > 0.05;
    if (resetBtn.hidden === away) resetBtn.hidden = !away;

    // camera
    const dist = camDistance();
    const panTarget = S.single && S.s > 0 ? (S.side === 'R' ? W / 2 : -W / 2) * smooth(openAmount()) : 0;
    if (Math.abs(panTarget - S.panX) > 0.0008) { S.panX += (panTarget - S.panX) * (1 - Math.exp(-6.5 * dt)); active = true; } else S.panX = panTarget;
    camera.position.set(S.panX, 0, dist);
    camera.lookAt(S.panX, 0, 0);
    sun.position.set(-2.6, 3.4, 6);
    sun.target.position.set(0, 0, 0);
    const o = smooth(openAmount());
    blob.scale.set(2.0 + o * 2.4, 2.9 + o * 0.2, 1);
    blob.position.set(0.18 + o * 0.05, -0.3, -0.9);
    blob.material.opacity = 0.42 * (0.35 + 0.65 * Math.max(0, facing()));

    if (tex.queue.length) { tex.pump(); active = true; }
    renderer.render(scene, camera);
    S.dirty = false;
    if (active || S.dirty || flights.length) { raf = requestAnimationFrame(frame); }
  }

  const idle = (fn, ms) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, ms));
  function queueWarmup() {
    clearTimeout(idleWarm);
    const want = [];
    for (const ds of [1, -1, 2]) {
      const s = clamp(S.s + ds, 0, MAX_S);
      for (const n of [leftPage(s), rightPage(s)]) if (n != null && !want.includes(n)) want.push(n);
    }
    const run = () => {
      const n = want.shift();
      if (n == null) return;
      tex.get(n, { async: true });
      dirty();
      idleWarm = setTimeout(() => idle(run, 400), 120);
    };
    idleWarm = setTimeout(() => idle(run, 600), 300);
    tex.trim();
  }

  // sizing ---------------------------------------------------------------------------------------------------
  function resize() {
    const w = stage.clientWidth, hh = stage.clientHeight;
    if (!w || !hh) return;
    size = { w, h: hh };
    const wasSingle = S.single;
    S.single = w / hh < 0.8;
    if (S.single !== wasSingle) { S.side = validSide(S.s, S.side); updateLabels(); }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 2 : 2));
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
    strip.draw();
    dirty();
  }
  new ResizeObserver(debounce(resize, 30)).observe(stage);

  // labels / strip ---------------------------------------------------------------------------------------------
  function updateLabels() {
    const s = S.s;
    let label;
    if (s === 0) label = 'Cover';
    else if (S.single) {
      const pg = S.side === 'R' ? rightPage(s) : leftPage(s);
      const a = PAGES[pg ?? rightPage(s) ?? leftPage(s)];
      label = `${MONTHS[a.m]} ${a.d}`;
    } else {
      const l = leftPage(s), r = rightPage(s);
      const a = PAGES[l ?? r], b = PAGES[r ?? l];
      label = a === b ? `${MONTHS[a.m]} ${a.d}`
        : a.m === b.m ? `${MONTHS_SHORT[a.m]} ${a.d} – ${b.d}` : `${MONTHS_SHORT[a.m]} ${a.d} – ${MONTHS_SHORT[b.m]} ${b.d}`;
    }
    dateBtn.textContent = label;
    prevBtn.disabled = s === 0;
    nextBtn.disabled = s === MAX_S;
    closeBtn.hidden = s === 0;
    el.dataset.closed = s === 0 ? '1' : '0';
    strip.mark();
  }

  function createStrip() {
    const cv = h('canvas.strip-canvas');
    const marker = h('div.strip-marker');
    const tip = h('div.strip-tip');
    const months = h('div.strip-months');
    const wrap = h('div.strip', { role: 'slider', 'aria-label': 'Position in the book', 'aria-valuemin': 1, 'aria-valuemax': LAST }, cv, marker, tip, months);
    let dragging = false;
    const pageAtX = (cx) => { const r = wrap.getBoundingClientRect(); return clamp(Math.floor(((cx - r.left) / r.width) * LAST) + 1, 1, LAST); };
    const showTip = (n, cx) => {
      const r = wrap.getBoundingClientRect();
      tip.textContent = `${MONTHS_SHORT[PAGES[n].m]} ${PAGES[n].d}`;
      tip.style.left = `${clamp(cx - r.left, 24, r.width - 24)}px`;
      tip.classList.add('on');
      marker.style.left = `${((n - 0.5) / LAST) * 100}%`; marker.style.width = '4px';
    };
    wrap.addEventListener('pointerdown', (e) => { if (S.busy || S.write) return; dragging = true; wrap.setPointerCapture(e.pointerId); showTip(pageAtX(e.clientX), e.clientX); });
    wrap.addEventListener('pointermove', (e) => { if (dragging) showTip(pageAtX(e.clientX), e.clientX); });
    const release = (e, cancel) => {
      if (!dragging) return;
      dragging = false; tip.classList.remove('on');
      if (cancel) return mark();
      const n = pageAtX(e.clientX), t = today();
      backToReading();
      goTo(n, { focusKey: n === t.n ? t.key : undefined });
    };
    wrap.addEventListener('pointerup', (e) => release(e, false));
    wrap.addEventListener('pointercancel', (e) => release(e, true));
    function draw() {
      const Wd = wrap.clientWidth, Hd = wrap.clientHeight;
      if (!Wd) return;
      const dpr = Math.min(devicePixelRatio || 1, 3);
      cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr);
      const g = cv.getContext('2d'); g.scale(dpr, dpr);
      const per = store.filledPerPage(), bw = Wd / LAST, t = today();
      for (let n = 1; n <= LAST; n++) {
        const c = per[n];
        g.fillStyle = c ? `rgba(232,197,108,${0.45 + Math.min(c, 5) * 0.11})` : 'rgba(255,255,255,0.13)';
        g.fillRect((n - 1) * bw + 0.25, 4, Math.max(0.8, bw - 0.5), Hd - 8);
      }
      g.fillStyle = '#fff'; g.fillRect((t.n - 1) * bw - 0.5, 0, Math.max(2, bw + 1), 4);
      months.replaceChildren();
      const narrow = Wd < 460;
      for (let mo = 0; mo < 12; mo++) months.append(h('span', { style: { left: `${((pageOf(mo, 1) - 1) / LAST) * 100}%` } }, narrow ? MONTHS[mo][0] : MONTHS_SHORT[mo]));
      mark();
    }
    function mark() {
      const s = S.s;
      const l = s === 0 ? 1 : (leftPage(s) ?? rightPage(s));
      const wide = s === 0 ? 1 : (leftPage(s) && rightPage(s) ? 2 : 1);
      marker.style.left = `${((l - 1) / LAST) * 100}%`;
      marker.style.width = `max(5px, ${(wide / LAST) * 100}%)`;
      wrap.setAttribute('aria-valuenow', l);
    }
    return { el: wrap, draw, mark };
  }

  function openJump() {
    if (S.busy || S.write) return;
    let m = S.s > 0 ? PAGES[rightPage(S.s) ?? leftPage(S.s)].m : today().m;
    const dlg = h('dialog.sheet.small.jump');
    const render = () => {
      const filled = store.filledPerPage(), t = today();
      dlg.replaceChildren(h('div.sheet-body',
        h('div.jump-months', MONTHS_SHORT.map((name, i) => h('button.chip' + (i === m ? '.on' : ''), { type: 'button', onclick: () => { m = i; render(); } }, name))),
        h('div.jump-days', PAGES.filter((p) => p && p.m === m).map((p) => h('button.day' + (filled[p.n] ? '.has' : '') + (t.n === p.n ? '.is-today' : ''), {
          type: 'button', onclick: () => { dlg.close(); backToReading(); goTo(p.n, { focusKey: dateKey(t.y, p.m, p.d) }); },
        }, p.d))),
        h('div.row.end',
          h('button.btn.ghost', { type: 'button', onclick: () => { dlg.close(); goToday(); } }, icon('today', 18), 'Today'),
          h('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Close'))));
    };
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    render();
    dlg.showModal();
  }

  // data changes -----------------------------------------------------------------------------------------------
  store.onChange((k) => {
    if (k) tex.bump(pageOfKey(k)); else tex.bump(null);
    if (!S.write) { setStaticTextures(); }
    strip.draw();
    dirty();
  });
  store.onSettings(() => {
    tex.bump(null);
    insideFront = insideTex(true); frontInsideMat.map = insideFront; frontInsideMat.needsUpdate = true;
    insideBack = insideTex(false); backInsideMat.map = insideBack; backInsideMat.needsUpdate = true;
    setStaticTextures();
    dirty();
  });
  document.fonts?.ready.then(() => {
    Promise.all(['500 20px Jost', '400 20px Caveat', '400 20px Kalam', '400 20px "Patrick Hand"', 'italic 500 20px "Cormorant Garamond"'].map((f) => document.fonts.load(f).catch(() => {}))).then(() => {
      tex.bump(null);
      insideFront = insideTex(true); frontInsideMat.map = insideFront; frontInsideMat.needsUpdate = true;
      insideBack = insideTex(false); backInsideMat.map = insideBack; backInsideMat.needsUpdate = true;
      const cm = PT.drawCover(BW, BH);
      for (const [cvs, t] of [[cm.color, coverColor], [cm.metal, coverMetal], [cm.rough, coverRough]]) { t.image = cvs; t.needsUpdate = true; }
      setStaticTextures();
      dirty();
    });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tex.bump(null); setStaticTextures(); dirty(); } });

  // boot: start closed (or open at today if "skip cover" is on)
  const initial = store.getSettings().skipCover ? spreadOfPage(today().n) : 0;
  S.s = initial; S.sR = S.sL = initial;
  S.coverTheta = initial >= 1 ? Math.PI : 0;
  if (initial >= 1) q.copy(qRead);
  const tt0 = stackTargets(); S.tR = tt0.tR; S.tL = tt0.tL;
  applyCover();
  setStaticTextures();
  layoutStatics();
  updateLabels();
  requestAnimationFrame(resize);

  return {
    el,
    refresh() { resize(); setStaticTextures(); dirty(); },
    goTo, goToday, goToKey,
    openBook: goToday,
    get isOpen() { return S.s > 0; },
    get editing() { return !!S.write; },
    handleKey(e) {
      if (S.write) { if (e.key === 'Escape') { closeWrite(); return true; } return flat?.handleKey?.(e) || false; }
      if (e.key === 'ArrowRight') { step(1); return true; }
      if (e.key === 'ArrowLeft') { step(-1); return true; }
      if (e.key === 't' || e.key === 'T') { goToday(); return true; }
      if (e.key === 'Escape') { resetView(); return true; }
      return false;
    },
    // test hooks
    _state: S, _flights: flights, _currentPage: currentPage, _pick: pick,
  };
}
