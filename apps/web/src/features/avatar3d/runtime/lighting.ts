/**
 * Lighting that matches the scene: chosen from the story's time of day, weather and the kind of
 * place, so a character in a tavern at night isn't lit like a studio photo.
 */
import * as THREE from 'three';

export interface LightingPreset {
  id: 'day' | 'golden' | 'night' | 'indoor' | 'overcast' | 'studio';
  key: { color: THREE.Color; intensity: number; dir: THREE.Vector3 };
  sky: THREE.Color;
  ground: THREE.Color;
  fill: number;
  rim: { color: THREE.Color; intensity: number };
  /** Shadow tint for toon materials. */
  shade: THREE.Color;
  exposure: number;
}

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();

export const PRESETS: Record<LightingPreset['id'], LightingPreset> = {
  studio: { id: 'studio', key: { color: c(1, 0.97, 0.93), intensity: 2.6, dir: v(-1.25, 1.1, 0.75) }, sky: c(0.82, 0.86, 0.95), ground: c(0.42, 0.38, 0.36), fill: 0.7, rim: { color: c(1, 1, 1), intensity: 1.3 }, shade: c(0.86, 0.8, 0.92), exposure: 1 },
  day: { id: 'day', key: { color: c(1, 0.96, 0.88), intensity: 2.7, dir: v(-1.15, 1.3, 0.8) }, sky: c(0.72, 0.84, 1), ground: c(0.46, 0.42, 0.34), fill: 0.85, rim: { color: c(1, 0.98, 0.92), intensity: 0.8 }, shade: c(0.84, 0.82, 0.96), exposure: 1 },
  golden: { id: 'golden', key: { color: c(1, 0.74, 0.5), intensity: 2.3, dir: v(-1, 0.45, 0.7) }, sky: c(0.95, 0.72, 0.62), ground: c(0.42, 0.3, 0.26), fill: 0.85, rim: { color: c(1, 0.68, 0.42), intensity: 1.2 }, shade: c(0.88, 0.68, 0.78), exposure: 1 },
  night: { id: 'night', key: { color: c(0.6, 0.7, 1), intensity: 1.1, dir: v(0.6, 1, 0.8) }, sky: c(0.22, 0.27, 0.48), ground: c(0.08, 0.08, 0.12), fill: 0.7, rim: { color: c(0.55, 0.65, 1), intensity: 1.4 }, shade: c(0.58, 0.62, 0.9), exposure: 1.15 },
  indoor: { id: 'indoor', key: { color: c(1, 0.82, 0.6), intensity: 2.1, dir: v(-1.05, 0.9, 0.85) }, sky: c(0.82, 0.7, 0.6), ground: c(0.36, 0.28, 0.22), fill: 0.85, rim: { color: c(1, 0.74, 0.5), intensity: 0.8 }, shade: c(0.9, 0.74, 0.76), exposure: 1.05 },
  overcast: { id: 'overcast', key: { color: c(0.86, 0.9, 0.96), intensity: 1.3, dir: v(-0.3, 1.5, 0.8) }, sky: c(0.7, 0.75, 0.82), ground: c(0.38, 0.38, 0.4), fill: 1.15, rim: { color: c(0.85, 0.9, 1), intensity: 0.45 }, shade: c(0.78, 0.8, 0.9), exposure: 1 },
};

const INDOOR = /building|room|interior|home|shop|service|bank|tavern|inn|station/;

/** Picks a preset from the story's state. */
export function lightingFor(s: { hour?: number | null; weather?: string | null; locationKind?: string | null } | null): LightingPreset {
  if (!s) return PRESETS.studio;
  if (s.locationKind && INDOOR.test(s.locationKind)) return PRESETS.indoor;
  const h = s.hour ?? 12;
  if (h < 5.5 || h >= 20.5) return PRESETS.night;
  if (/rain|storm|overcast|fog|snow|cloud/.test(s.weather ?? '')) return PRESETS.overcast;
  if (h < 7.5 || h >= 17.5) return PRESETS.golden;
  return PRESETS.day;
}

export interface StageLights {
  key: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  rim: THREE.DirectionalLight;
}

export function makeLights(scene: THREE.Scene): StageLights {
  const key = new THREE.DirectionalLight(0xffffff, 2);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  const rim = new THREE.DirectionalLight(0xffffff, 1);
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target, hemi, rim, rim.target);
  return { key, hemi, rim };
}

/** Moves lights toward a preset (call every frame with dt for smooth changes, or dt=1 to snap). */
export function applyLighting(l: StageLights, p: LightingPreset, center: THREE.Vector3, size: number, k = 1) {
  l.key.color.lerp(p.key.color, k);
  l.key.intensity += (p.key.intensity - l.key.intensity) * k;
  l.key.position.copy(p.key.dir).multiplyScalar(size * 3).add(center);
  l.key.target.position.copy(center);
  l.hemi.color.lerp(p.sky, k);
  l.hemi.groundColor.lerp(p.ground, k);
  l.hemi.intensity += (p.fill - l.hemi.intensity) * k;
  l.rim.color.lerp(p.rim.color, k);
  l.rim.intensity += (p.rim.intensity - l.rim.intensity) * k;
  // Rim light from behind and above, opposite the key.
  l.rim.position.set(-p.key.dir.x * size * 2, size * 2.2, -size * 3).add(center);
  l.rim.target.position.copy(center);
  const cam = l.key.shadow.camera as THREE.OrthographicCamera;
  cam.left = cam.bottom = -size * 1.5;
  cam.right = cam.top = size * 1.5;
  cam.updateProjectionMatrix();
}
