import { Application, Container, Graphics } from 'pixi.js';
import type { Network } from '../network/network';
import { PED_STRIDE, VEH_STRIDE, type Frame } from '../app/protocol';
import { drawBridges, drawDecor, drawNetwork, drawSelection, drawSignals, legAt, type Decor } from './drawNetwork';
import { legColorNum, type CanvasTheme } from './theme';

const CAR_WIDTH = 1.9;
const TRUCK_WIDTH = 2.4;
const PED_RADIUS = 0.4;
const SELECT_COLOR = 0x3d7dd8;

export interface Camera {
  /** Screen pixels per metre. */
  scale: number;
  /** Screen position of the world origin. */
  x: number;
  y: number;
}

/**
 * Draws the junction top-down with PixiJS. World units are metres with y up;
 * the world container flips y so everything else can stay in world coordinates.
 */
export class Renderer {
  private app = new Application();
  private world = new Container();
  private decorLayer = new Graphics();
  private decor: Decor | null = null;
  private roads = new Graphics();
  private selection = new Graphics();
  private signals = new Graphics();
  private vehicles = new Graphics();
  private bridges = new Graphics();
  private bridgeVehicles = new Graphics();
  private peds = new Graphics();
  private network: Network | null = null;
  private selectedLeg: string | null = null;
  private theme: CanvasTheme;
  private prev: Frame | null = null;
  private curr: Frame | null = null;
  private currAt = 0;
  private interval = 100;
  private camera: Camera = { scale: 4, x: 0, y: 0 };
  private userMoved = false;
  private cameraListeners = new Set<(c: Camera) => void>();
  private ready: Promise<void>;
  private destroyed = false;

  constructor(
    private host: HTMLElement,
    theme: CanvasTheme,
    private onSelectLeg: (leg: string | null) => void = () => {},
  ) {
    this.theme = theme;
    this.ready = this.init();
  }

  private async init() {
    await this.app.init({
      resizeTo: this.host,
      antialias: true,
      background: this.theme.ground,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.host.appendChild(this.app.canvas);
    // Ground first, then the bridge deck and whatever is driving on it.
    this.world.addChild(this.decorLayer, this.roads, this.selection, this.signals, this.peds, this.vehicles, this.bridges, this.bridgeVehicles);
    this.app.stage.addChild(this.world);
    this.app.ticker.add(() => this.drawDynamic());
    this.app.renderer.on('resize', () => {
      if (!this.userMoved) this.fit();
      else this.applyCamera();
    });
    this.bindPanZoom();
    this.fit();
  }

  /**
   * Show a network. A brand-new junction (`fresh`) drops old frames and re-fits the view;
   * an edit keeps the camera and the traffic stream as they are.
   */
  async setNetwork(network: Network, fresh: boolean) {
    await this.ready;
    this.network = network;
    if (fresh) {
      this.prev = this.curr = null;
      this.userMoved = false;
    }
    this.drawStatic();
    if (fresh) this.fit();
  }

  async setTheme(theme: CanvasTheme) {
    await this.ready;
    this.theme = theme;
    this.app.renderer.background.color = theme.ground;
    this.drawStatic();
  }

  async setSelectedLeg(leg: string | null) {
    await this.ready;
    this.selectedLeg = leg;
    if (this.network) drawSelection(this.selection, this.network, leg, SELECT_COLOR);
  }

  async setDecor(decor: Decor | null) {
    await this.ready;
    this.decor = decor;
    if (this.network) drawDecor(this.decorLayer, this.network, decor, this.theme);
  }

  private drawStatic() {
    if (!this.network) return;
    drawDecor(this.decorLayer, this.network, this.decor, this.theme);
    drawNetwork(this.roads, this.network, this.theme);
    drawBridges(this.bridges, this.network, this.theme);
    drawSelection(this.selection, this.network, this.selectedLeg, SELECT_COLOR);
  }

  pushFrame(frame: Frame) {
    const now = performance.now();
    if (this.curr) {
      // Smooth the expected gap between frames; at 1x they arrive every ~100 ms, faster at higher speeds.
      this.interval = this.interval * 0.8 + Math.min(500, now - this.currAt) * 0.2;
    }
    this.prev = this.curr;
    this.curr = frame;
    this.currAt = now;
  }

  onCamera(fn: (c: Camera) => void): () => void {
    this.cameraListeners.add(fn);
    fn(this.camera);
    return () => this.cameraListeners.delete(fn);
  }

  /** Re-centre and fit the whole junction in view. */
  fit() {
    if (!this.network || !this.app.renderer) return;
    const { width, height } = this.app.screen;
    // Frame the junction and the nearer half of each approach, where queues build up.
    const extent = Math.max(...[...this.network.legs.values()].map((l) => l.length)) * 0.5;
    this.camera = { scale: Math.min(width, height) / (2 * extent), x: width / 2, y: height / 2 };
    this.userMoved = false;
    this.applyCamera();
  }

  destroy() {
    this.destroyed = true;
    this.cameraListeners.clear();
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }

  private applyCamera() {
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.scale, -this.camera.scale);
    for (const fn of this.cameraListeners) fn(this.camera);
  }

  private bindPanZoom() {
    const canvas = this.app.canvas;
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const k = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.min(60, Math.max(0.5, this.camera.scale * k));
        const f = scale / this.camera.scale;
        // Zoom around the cursor.
        this.camera = { scale, x: mx - (mx - this.camera.x) * f, y: my - (my - this.camera.y) * f };
        this.userMoved = true;
        this.applyCamera();
      },
      { passive: false },
    );
    let drag: { x: number; y: number } | null = null;
    let moved = 0;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      moved = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      this.camera = { ...this.camera, x: this.camera.x + e.clientX - drag.x, y: this.camera.y + e.clientY - drag.y };
      drag = { x: e.clientX, y: e.clientY };
      this.userMoved = true;
      this.applyCamera();
    });
    canvas.addEventListener('pointerup', (e) => {
      drag = null;
      // A click (not a drag) selects the leg under the pointer, or clears the selection.
      if (moved > 4 || !this.network) return;
      const rect = canvas.getBoundingClientRect();
      const wx = (e.clientX - rect.left - this.camera.x) / this.camera.scale;
      const wy = -(e.clientY - rect.top - this.camera.y) / this.camera.scale;
      this.onSelectLeg(legAt(this.network, { x: wx, y: wy }));
    });
    canvas.addEventListener('dblclick', () => this.fit());
  }

  private drawDynamic() {
    const frame = this.curr;
    if (!frame || !this.network) return;
    const t = this.theme;
    drawSignals(this.signals, this.network, frame.clock, t);

    // Interpolate from the previous frame towards the current one.
    const alpha = Math.min(1, (performance.now() - this.currAt) / Math.max(16, this.interval));
    const prevIndex = new Map<number, number>();
    if (this.prev) this.prev.vehIds.forEach((id, i) => prevIndex.set(id, i));

    this.vehicles.clear();
    this.bridgeVehicles.clear();
    for (let i = 0; i < frame.vehIds.length; i++) {
      const o = i * VEH_STRIDE;
      let x = frame.veh[o]!;
      let y = frame.veh[o + 1]!;
      let h = frame.veh[o + 2]!;
      const j = prevIndex.get(frame.vehIds[i]!);
      if (j !== undefined && this.prev) {
        const p = j * VEH_STRIDE;
        const px = this.prev.veh[p]!;
        const py = this.prev.veh[p + 1]!;
        let dh = h - this.prev.veh[p + 2]!;
        if (dh > Math.PI) dh -= 2 * Math.PI;
        if (dh < -Math.PI) dh += 2 * Math.PI;
        x = px + (x - px) * alpha;
        y = py + (y - py) * alpha;
        h = h - dh * (1 - alpha);
      }
      const layer = frame.veh[o + 6]! > 0 ? this.bridgeVehicles : this.vehicles;
      drawVehicle(layer, x, y, h, frame.veh[o + 3]!, frame.veh[o + 4]!, frame.veh[o + 5]!, t);
    }

    const pp = this.peds;
    pp.clear();
    const prevPed = new Map<number, number>();
    if (this.prev) this.prev.pedIds.forEach((id, i) => prevPed.set(id, i));
    for (let i = 0; i < frame.pedIds.length; i++) {
      const o = i * PED_STRIDE;
      let x = frame.peds[o]!;
      let y = frame.peds[o + 1]!;
      const j = prevPed.get(frame.pedIds[i]!);
      if (j !== undefined && this.prev) {
        x = this.prev.peds[j * PED_STRIDE]! + (x - this.prev.peds[j * PED_STRIDE]!) * alpha;
        y = this.prev.peds[j * PED_STRIDE + 1]! + (y - this.prev.peds[j * PED_STRIDE + 1]!) * alpha;
      }
      const crossing = frame.peds[o + 2]! > 0;
      pp.circle(x, y, PED_RADIUS).fill(crossing ? t.pedestrian : t.pedestrianWaiting);
    }
  }
}

function drawVehicle(g: Graphics, x: number, y: number, h: number, length: number, leg: number, acc: number, t: CanvasTheme) {
  const width = length > 6 ? TRUCK_WIDTH : CAR_WIDTH;
  const c = Math.cos(h);
  const s = Math.sin(h);
  // Local (along, across) -> world.
  const P = (a: number, b: number): [number, number] => [x + a * c - b * s, y + a * s + b * c];
  const L = length / 2;
  const W = width / 2;
  const k = 0.35; // chamfered corners read as rounded at this scale
  const body = [P(L - k, -W), P(L, -W + k), P(L, W - k), P(L - k, W), P(-L + k, W), P(-L, W - k), P(-L, -W + k), P(-L + k, -W)];
  g.poly(body.flat()).fill(legColorNum(leg)).stroke({ width: 0.12, color: t.vehicleOutline });
  // Windshield band towards the front.
  const ws = length > 6 ? L - 1.6 : L - 1.3;
  g.poly([P(ws, -W + 0.3), P(ws + 0.45, -W + 0.35), P(ws + 0.45, W - 0.35), P(ws, W - 0.3)].flat()).fill({ color: t.windshield, alpha: 0.55 });
  // A bus: a row of side windows along its length.
  if (length > 11) {
    for (let a = -L + 1.2; a < ws - 0.8; a += 1.4) {
      for (const b of [-W + 0.12, W - 0.32]) g.poly([P(a, b), P(a + 0.9, b), P(a + 0.9, b + 0.2), P(a, b + 0.2)].flat()).fill({ color: t.windshield, alpha: 0.55 });
    }
  }
  if (acc < -1) {
    for (const b of [-W + 0.35, W - 0.35]) {
      const [bx, by] = P(-L + 0.1, b);
      g.circle(bx, by, 0.28).fill(t.brake);
    }
  }
}
