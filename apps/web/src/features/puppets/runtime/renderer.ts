/**
 * Draws puppets with WebGL 2: one canvas and one context for everyone on stage. Each frame the
 * visible parts go into one dynamic vertex buffer (position, texture coordinates, opacity, colour
 * group), and consecutive parts that share a texture, blend mode and mask are one draw call. Masked
 * parts (irises inside the eye whites) use the stencil buffer. Textures are premultiplied; colour
 * groups (hair, eyes, skin, clothes) are recoloured in the shader by a hue/saturation/brightness
 * shift, so recolouring costs nothing and changes at once.
 */
import type { PuppetModel } from '@everloom/engine';
import type { PuppetRig } from '@everloom/engine';

export interface ColorShift { hue: number; sat: number; val: number }
export const NO_SHIFT: ColorShift = { hue: 0, sat: 1, val: 1 };
const MAX_GROUPS = 8;

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; in float aAlpha; in float aGroup;
uniform mat3 uMatrix;
out vec2 vUv; out float vAlpha; flat out int vGroup;
void main() {
  vec3 p = uMatrix * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUv = aUv; vAlpha = aAlpha; vGroup = int(aGroup + 0.5);
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUv; in float vAlpha; flat in int vGroup;
uniform sampler2D uTex;
uniform vec3 uShift[${MAX_GROUPS}];
uniform vec4 uTint;
uniform float uMaskPass;
out vec4 outColor;
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  vec4 t = texture(uTex, vUv);
  if (uMaskPass > 0.5) { if (t.a < 0.5) discard; outColor = vec4(0.0); return; }
  vec3 s = uShift[vGroup];
  vec3 rgb = t.a > 0.0 ? t.rgb / t.a : vec3(0.0);
  if (s.x != 0.0 || s.y != 1.0 || s.z != 1.0) {
    vec3 hsv = rgb2hsv(rgb);
    hsv.x = fract(hsv.x + s.x);
    hsv.y = clamp(hsv.y * s.y, 0.0, 1.0);
    hsv.z = clamp(hsv.z * s.z, 0.0, 1.0);
    rgb = hsv2rgb(hsv);
  }
  rgb *= uTint.rgb;
  float a = t.a * vAlpha * uTint.a;
  outColor = vec4(rgb * a, a);
}`;

export interface DrawInstance {
  model: PuppetModel;
  rig: PuppetRig;
  textures: WebGLTexture[];
  /** Puppet space → canvas pixels: scale, then position of the puppet's origin (top-left). */
  x: number;
  y: number;
  scale: number;
  flip: boolean;
  /** Per colour group (names from the model), recolouring. */
  shifts: Map<string, ColorShift>;
  /** Multiplied into every pixel (lighting to match the background), and overall opacity. */
  tint: [number, number, number, number];
  /** Parts to leave out (hidden by an outfit, or the underwear layer outside adult mode…). */
  hidden?: Set<string>;
}

export class PuppetRenderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private verts = new Float32Array(1 << 16);
  private idx = new Uint32Array(1 << 17);
  private loc: { matrix: WebGLUniformLocation | null; tex: WebGLUniformLocation | null; shift: WebGLUniformLocation | null; tint: WebGLUniformLocation | null; mask: WebGLUniformLocation | null };
  drawCalls = 0;
  private stencilRef = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, stencil: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL 2 is not available here.');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Puppet shader: ${gl.getShaderInfoLog(s) ?? 'failed'}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Puppet shader: ${gl.getProgramInfoLog(p) ?? 'failed'}`);
    this.prog = p;
    this.loc = { matrix: gl.getUniformLocation(p, 'uMatrix'), tex: gl.getUniformLocation(p, 'uTex'), shift: gl.getUniformLocation(p, 'uShift'), tint: gl.getUniformLocation(p, 'uTint'), mask: gl.getUniformLocation(p, 'uMaskPass') };
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const stride = 6 * 4;
    const attr = (name: string, size: number, off: number) => { const l = gl.getAttribLocation(p, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off * 4); };
    attr('aPos', 2, 0); attr('aUv', 2, 2); attr('aAlpha', 1, 4); attr('aGroup', 1, 5);
    gl.bindVertexArray(null);
  }

  /** Uploads an image as a premultiplied, mipmapped texture. */
  texture(img: TexImageSource): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    // Premultiplied: ImageBitmaps are made premultiplied (the flag only applies to other sources).
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !(img instanceof ImageBitmap));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  resize(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
  }

  /** Clears and draws every instance, back to front as given. */
  draw(list: DrawInstance[]) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    this.stencilRef = 0;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.loc.tex, 0);
    this.drawCalls = 0;
    for (const inst of list) this.drawInstance(inst);
    gl.bindVertexArray(null);
  }

  private drawInstance(inst: DrawInstance) {
    const gl = this.gl, { model, rig } = inst;
    const W = this.canvas.width, H = this.canvas.height;
    // Puppet space → clip space.
    const sx = (inst.scale * (inst.flip ? -1 : 1) * 2) / W, sy = (-inst.scale * 2) / H;
    const tx = ((inst.flip ? inst.x + model.canvas.width * inst.scale : inst.x) * 2) / W - 1, ty = 1 - (inst.y * 2) / H;
    gl.uniformMatrix3fv(this.loc.matrix, false, [sx, 0, 0, 0, sy, 0, tx, ty, 1]);
    gl.uniform4f(this.loc.tint, ...inst.tint);
    const groups = Object.keys(model.colors);
    const shifts = new Float32Array(MAX_GROUPS * 3);
    for (let g = 0; g < MAX_GROUPS; g++) { const s = inst.shifts.get(groups[g - 1] ?? '') ?? NO_SHIFT; shifts.set([s.hue, s.sat, s.val], g * 3); }
    gl.uniform3fv(this.loc.shift, shifts);
    const groupOf = model.parts.map((p) => (p.color ? Math.min(MAX_GROUPS - 1, groups.indexOf(p.color) + 1) : 0));
    let nv = 0, ni = 0, batchTex = -1, batchBlend = '', batchMasked = false;
    const flush = () => {
      if (!ni) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.verts.subarray(0, nv * 6), gl.STREAM_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx.subarray(0, ni), gl.STREAM_DRAW);
      gl.bindTexture(gl.TEXTURE_2D, inst.textures[batchTex] ?? null);
      gl.drawElements(gl.TRIANGLES, ni, gl.UNSIGNED_INT, 0);
      this.drawCalls++;
      nv = 0; ni = 0;
    };
    const push = (pi: number, alpha: number) => {
      const part = model.parts[pi]!, f = rig.frames[pi]!, uv = part.mesh.uvs, ix = part.mesh.indices;
      const n = f.positions.length / 2;
      if ((nv + n) * 6 > this.verts.length) { flush(); if (n * 6 > this.verts.length) this.verts = new Float32Array(n * 12); }
      if (ni + ix.length > this.idx.length) { flush(); if (ix.length > this.idx.length) this.idx = new Uint32Array(ix.length * 2); }
      const g = groupOf[pi]!;
      for (let v = 0; v < n; v++) {
        const o = (nv + v) * 6;
        this.verts[o] = f.positions[v * 2]!; this.verts[o + 1] = f.positions[v * 2 + 1]!;
        this.verts[o + 2] = uv[v * 2]!; this.verts[o + 3] = uv[v * 2 + 1]!;
        this.verts[o + 4] = alpha; this.verts[o + 5] = g;
      }
      for (let k = 0; k < ix.length; k++) this.idx[ni + k] = ix[k]! + nv;
      nv += n; ni += ix.length;
    };
    const setBlend = (b: string) => {
      if (b === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else if (b === 'screen') gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };
    const partIndex = new Map(model.parts.map((p, i) => [p.id, i]));
    for (const pi of rig.order) {
      const part = model.parts[pi]!, f = rig.frames[pi]!;
      if (part.maskOnly || f.opacity < 0.004 || inst.hidden?.has(part.id)) continue;
      const masked = part.masks.length > 0;
      if (pi < 0) continue;
      if (masked || batchMasked || part.texture !== batchTex || part.blend !== batchBlend) {
        flush();
        if (batchMasked) { gl.disable(gl.STENCIL_TEST); batchMasked = false; }
        if (masked) {
          // Write the mask parts into the stencil (no colour), then draw this part where they are.
          this.stencilRef = (this.stencilRef % 255) + 1;
          if (this.stencilRef === 1) gl.clear(gl.STENCIL_BUFFER_BIT);
          gl.enable(gl.STENCIL_TEST);
          gl.stencilFunc(gl.ALWAYS, this.stencilRef, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
          gl.colorMask(false, false, false, false);
          gl.uniform1f(this.loc.mask, 1);
          for (const mid of part.masks) {
            const mi = partIndex.get(mid);
            if (mi === undefined) continue;
            batchTex = model.parts[mi]!.texture;
            push(mi, 1);
            flush();
          }
          gl.uniform1f(this.loc.mask, 0);
          gl.colorMask(true, true, true, true);
          gl.stencilFunc(gl.EQUAL, this.stencilRef, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          batchMasked = true;
        }
        batchTex = part.texture;
        batchBlend = part.blend;
        setBlend(part.blend);
      }
      push(pi, f.opacity);
    }
    flush();
    if (batchMasked) gl.disable(gl.STENCIL_TEST);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog);
  }
}
