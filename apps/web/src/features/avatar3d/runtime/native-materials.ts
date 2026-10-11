/** Independently authored skin microdetail and a restrained wrapped-light approximation. */
import * as THREE from 'three';

export function skinDetail(material: THREE.MeshPhysicalMaterial, owned: THREE.Texture[]) {
  const size = 256, normal = new Uint8Array(size * size * 4), roughness = new Uint8Array(size * size * 4);
  const noise = (x: number, y: number) => { let value = Math.imul(x & 255, 374761393) + Math.imul(y & 255, 668265263); value = Math.imul(value ^ value >>> 13, 1274126177); return ((value ^ value >>> 16) >>> 0) / 4294967295; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    normal[index] = Math.round(128 + (noise(x + 1, y) - noise(x - 1, y)) * 18);
    normal[index + 1] = Math.round(128 + (noise(x, y + 1) - noise(x, y - 1)) * 18); normal[index + 2] = 254; normal[index + 3] = 255;
    const value = Math.round(210 + noise(x, y) * 35); roughness[index] = roughness[index + 1] = roughness[index + 2] = value; roughness[index + 3] = 255;
  }
  const texture = (bytes: Uint8Array) => {
    // glTF export merges roughness and metalness through drawImage, which needs
    // a drawable image rather than a DataTexture's {data,width,height} object.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bytes), size, size), 0, 0);
    const map = new THREE.CanvasTexture(canvas); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(6, 6); map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; owned.push(map); return map;
  };
  if (!material.normalMap) { material.normalMap = texture(normal); material.normalScale.set(0.3, 0.3); }
  material.roughnessMap = texture(roughness);
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
      for (int skinLight = 0; skinLight < NUM_DIR_LIGHTS; skinLight++) {
        float skinCosine = dot(normal, directionalLights[skinLight].direction);
        float skinWrap = clamp((skinCosine + 0.45) / 1.45, 0.0, 1.0) * (1.0 - max(skinCosine, 0.0));
        reflectedLight.directDiffuse += directionalLights[skinLight].color * diffuseColor.rgb * vec3(1.0, 0.38, 0.24) * skinWrap * 0.055;
      }
      #endif`);
  };
  material.customProgramCacheKey = () => 'everloom-native-skin-wrap-v1';
}

/** Add a short deforming chain to the hanging portion of long native hair. */
export function longHairMotion(mesh: THREE.SkinnedMesh, scene: THREE.Object3D, skeleton: THREE.Skeleton) {
  const head = skeleton.bones.find(bone => /^head$/i.test(bone.name)); if (!head) return;
  scene.updateMatrixWorld(true);
  const position = mesh.geometry.getAttribute('position'), weights = mesh.geometry.getAttribute('skinWeight'), indices = mesh.geometry.getAttribute('skinIndex');
  const box = new THREE.Box3(), vertexPosition = new THREE.Vector3();
  for (let vertex = 0; vertex < position.count; vertex++) box.expandByPoint(vertexPosition.fromBufferAttribute(position, vertex));
  const headPosition = head.getWorldPosition(new THREE.Vector3()), length = headPosition.y - box.min.y;
  if (length < 0.08) return;
  const count = 3, bones: THREE.Bone[] = [], first = skeleton.bones.length, center = box.getCenter(new THREE.Vector3());
  for (let i = 0; i < count; i++) {
    const bone = new THREE.Bone(); bone.name = `NativeHair_${mesh.name}_${i}`;
    if (i === 0) { bone.position.copy(new THREE.Vector3(center.x, headPosition.y, center.z).applyMatrix4(head.matrixWorld.clone().invert())); head.add(bone); }
    else { bone.position.set(0, -length / count, 0); bones[i - 1].add(bone); }
    bone.userData.everloomSpring = { hitRadius: 0.012, stiffness: 0.8, gravityPower: 0.12, dragForce: 0.55, gravityDir: [0, -1, 0] };
    bones.push(bone); skeleton.bones.push(bone);
  }
  scene.updateMatrixWorld(true); skeleton.calculateInverses();
  for (let vertex = 0; vertex < position.count; vertex++) {
    const fraction = THREE.MathUtils.clamp((headPosition.y - position.getY(vertex)) / length, 0, 1);
    if (fraction < 0.12) continue;
    const blend = THREE.MathUtils.smoothstep(fraction, 0.12, 0.45), segment = Math.min(count - 1, Math.floor(fraction * count));
    const merged = new Map<number, number>();
    for (let channel = 0; channel < 4; channel++) merged.set(indices.getComponent(vertex, channel), (merged.get(indices.getComponent(vertex, channel)) ?? 0) + weights.getComponent(vertex, channel) * (1 - blend));
    merged.set(first + segment, (merged.get(first + segment) ?? 0) + blend);
    const sorted = [...merged].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = sorted.reduce((total, pair) => total + pair[1], 0);
    for (let channel = 0; channel < 4; channel++) { indices.setComponent(vertex, channel, sorted[channel]?.[0] ?? 0); weights.setComponent(vertex, channel, sum ? (sorted[channel]?.[1] ?? 0) / sum : channel === 0 ? 1 : 0); }
  }
  indices.needsUpdate = weights.needsUpdate = true;
}
