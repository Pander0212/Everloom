/**
 * The Bones tab's view of the skeleton in 3D: a dot on every bone, coloured by its role, the
 * selected bones larger; the selected bone's skin weights as a heat overlay (what it moves); and
 * picking a bone by tapping near its dot.
 */
import * as THREE from 'three';
import type { Stage3D } from './stage';

export const ROLE_COLORS: Record<string, string> = {
  humanoid: '#3b82f6',
  spine: '#06b6d4',
  breast: '#ec4899',
  butt: '#f97316',
  belly: '#eab308',
  hair: '#a855f7',
  skirt: '#22c55e',
  coat: '#16a34a',
  tail: '#f59e0b',
  ears: '#d946ef',
  wings: '#8b5cf6',
  eyelid: '#0ea5e9',
  tongue: '#ef4444',
  teeth: '#e5e7eb',
  thighHelper: '#64748b',
  upperArmHelper: '#64748b',
  forearmHelper: '#64748b',
  shoulderHelper: '#64748b',
  accessory: '#94a3b8',
  ignore: '#334155',
  review: '#facc15',
};

export class BoneOverlay {
  private dots: THREE.InstancedMesh;
  private bones: THREE.Object3D[] = [];
  private heat: THREE.Object3D[] = [];
  private tick = () => this.update();
  private selected = new Set<string>();
  private colors = new Map<string, string>();
  private _m = new THREE.Matrix4();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3();
  private _q = new THREE.Quaternion();

  constructor(private stage: Stage3D, private root: THREE.Object3D, private height: number) {
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.push(o);
    });
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9, toneMapped: false });
    this.dots = new THREE.InstancedMesh(geo, mat, Math.max(1, this.bones.length));
    this.dots.renderOrder = 999;
    this.dots.frustumCulled = false;
    stage.scene.add(this.dots);
    stage.tickers.add(this.tick);
    this.update();
  }

  /** Colours by bone name (role colours); unknown bones are grey. */
  setColors(colors: Map<string, string>) {
    this.colors = colors;
    this.update();
  }

  setSelected(names: Iterable<string>) {
    this.selected = new Set(names);
    this.update();
    this.showHeat([...this.selected].at(-1) ?? null);
  }

  private update() {
    const c = new THREE.Color();
    const r = this.height * 0.008;
    this.bones.forEach((b, i) => {
      b.getWorldPosition(this._p);
      const sel = this.selected.has(b.name);
      this._s.setScalar(sel ? r * 2.2 : r);
      this._m.compose(this._p, this._q, this._s);
      this.dots.setMatrixAt(i, this._m);
      this.dots.setColorAt(i, c.set(sel ? '#ffffff' : (this.colors.get(b.name) ?? '#94a3b8')));
    });
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    this.stage.kick();
  }

  /** The bone whose dot is nearest the tap (within 28 px), or null. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.stage.canvas.getBoundingClientRect();
    let best: string | null = null;
    let dist = 28;
    for (const b of this.bones) {
      b.getWorldPosition(this._p).project(this.stage.camera);
      if (this._p.z > 1) continue;
      const x = rect.left + ((this._p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - this._p.y) / 2) * rect.height;
      const d = Math.hypot(x - clientX, y - clientY);
      if (d < dist) {
        dist = d;
        best = b.name;
      }
    }
    return best;
  }

  /** What a bone moves: its skin weights from blue (none) to red (all), drawn over the meshes. */
  private showHeat(name: string | null) {
    for (const h of this.heat) h.removeFromParent();
    this.heat = [];
    if (!name) return;
    this.root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
      const index = mesh.skeleton.bones.findIndex((b) => b.name === name);
      const sw = mesh.geometry.getAttribute('skinWeight');
      const si = mesh.geometry.getAttribute('skinIndex');
      if (index < 0 || !sw || !si) return;
      const geo = mesh.geometry.clone();
      geo.morphAttributes = {};
      const colors = new Float32Array(sw.count * 3);
      const c = new THREE.Color();
      let any = false;
      for (let v = 0; v < sw.count; v++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === index) w += sw.getComponent(v, k);
        if (w > 0.01) any = true;
        c.setHSL((1 - Math.min(1, w)) * 0.66, 0.9, w > 0.01 ? 0.5 : 0.15);
        colors.set([c.r, c.g, c.b], v * 3);
      }
      if (!any) return;
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const overlay = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      overlay.bind(mesh.skeleton, mesh.bindMatrix);
      overlay.renderOrder = 998;
      mesh.parent?.add(overlay);
      this.heat.push(overlay);
    });
    this.stage.kick();
  }

  dispose() {
    this.stage.tickers.delete(this.tick);
    this.dots.removeFromParent();
    this.dots.geometry.dispose();
    (this.dots.material as THREE.Material).dispose();
    for (const h of this.heat) h.removeFromParent();
    this.stage.kick();
  }
}
