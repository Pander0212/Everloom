/**
 * Draws Puppets v2 (Rev2D render lists) with WebGL 2: one canvas and one context for everyone on
 * stage. Each frame the draw items go into one dynamic vertex buffer (position, texture coordinates,
 * straight RGBA), and consecutive items that share a texture and blend mode are one draw call. Masked
 * items use the stencil buffer (a hard-edged version of Rev2D's soft masks). Textures are
 * premultiplied. Antialiasing is off and the pixel ratio is capped by the stage: the meshes are
 * smooth already, and that is what keeps three puppets at 60 fps on a phone (PHASE2_DECISIONS).
 */
import type { DrawItem, RenderList } from '@everloom/engine/puppet2';

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; in vec4 aColor;
uniform mat3 uMatrix;
out vec2 vUv; out vec4 vColor;
void main() {
  vec3 p = uMatrix * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUv = aUv; vColor = aColor;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUv; in vec4 vColor;
uniform sampler2D uTex;
uniform float uTextured;
uniform float uAlpha;
uniform float uMaskPass;
out vec4 outColor;
void main() {
  vec4 t = uTextured > 0.5 ? texture(uTex, vUv) : vec4(1.0);
  float a = t.a * vColor.a * uAlpha;
  if (uMaskPass > 0.5) { if (a < 0.5) discard; outColor = vec4(0.0); return; }
  // t is premultiplied: rgb already carries t.a.
  outColor = vec4(t.rgb * vColor.rgb * vColor.a * uAlpha, a);
}`;

const FLOATS = 8;

export interface Draw2 {
  list: RenderList;
  textures: Map<string, WebGLTexture>;
  /** Model space → canvas pixels: [a, b, c, d, e, f] as in x' = a·x + c·y + e, y' = b·x + d·y + f. */
  matrix: [number, number, number, number, number, number];
  alpha: number;
  /** Part ids left out (another outfit's clothes, the adult layer when it may not be shown…). */
  hidden?: Set<string>;
}

export class Puppet2Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private verts = new Float32Array(1 << 16);
  private idx = new Uint32Array(1 << 17);
  private loc: Record<'matrix' | 'tex' | 'textured' | 'alpha' | 'mask', WebGLUniformLocation | null>;
  drawCalls = 0;
  triangles = 0;
  private stencilRef = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, stencil: true, preserveDrawingBuffer: false });
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
    const u = (n: string) => gl.getUniformLocation(p, n);
    this.loc = { matrix: u('uMatrix'), tex: u('uTex'), textured: u('uTextured'), alpha: u('uAlpha'), mask: u('uMaskPass') };
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const attr = (name: string, size: number, off: number) => { const l = gl.getAttribLocation(p, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, FLOATS * 4, off * 4); };
    attr('aPos', 2, 0); attr('aUv', 2, 2); attr('aColor', 4, 4);
    gl.bindVertexArray(null);
  }

  /** Uploads an image as a premultiplied, mipmapped texture. */
  texture(img: TexImageSource): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !(img instanceof ImageBitmap));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  deleteTexture(t: WebGLTexture) { this.gl.deleteTexture(t); }

  resize(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
  }

  /** Clears and draws every puppet, back to front as given. */
  draw(list: Draw2[]) {
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
    gl.uniform1f(this.loc.mask, 0);
    this.drawCalls = 0;
    this.triangles = 0;
    for (const d of list) this.drawOne(d);
    gl.bindVertexArray(null);
  }

  private drawOne(d: Draw2) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    const [a, b, c, dd, e, f] = d.matrix;
    // Canvas pixels → clip space, after the puppet's own matrix.
    gl.uniformMatrix3fv(this.loc.matrix, false, [(2 * a) / W, (-2 * b) / H, 0, (2 * c) / W, (-2 * dd) / H, 0, (2 * e) / W - 1, 1 - (2 * f) / H, 1]);
    gl.uniform1f(this.loc.alpha, d.alpha);
    let nv = 0, ni = 0, tex: string | undefined, blend = '', masked = false;
    const flush = () => {
      if (!ni) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.verts.subarray(0, nv * FLOATS), gl.STREAM_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx.subarray(0, ni), gl.STREAM_DRAW);
      const t = tex ? d.textures.get(tex) : undefined;
      gl.uniform1f(this.loc.textured, t ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, t ?? null);
      gl.drawElements(gl.TRIANGLES, ni, gl.UNSIGNED_INT, 0);
      this.drawCalls++;
      this.triangles += ni / 3;
      nv = 0; ni = 0;
    };
    const push = (it: DrawItem) => {
      const n = it.positions.length / 2, ix = it.indices;
      if ((nv + n) * FLOATS > this.verts.length) { flush(); if (n * FLOATS > this.verts.length) this.verts = new Float32Array(n * FLOATS * 2); }
      if (ni + ix.length > this.idx.length) { flush(); if (ix.length > this.idx.length) this.idx = new Uint32Array(ix.length * 2); }
      const v = this.verts, p = it.positions, col = it.colors, uv = it.uvs;
      for (let k = 0; k < n; k++) {
        const o = (nv + k) * FLOATS;
        v[o] = p[k * 2]!; v[o + 1] = p[k * 2 + 1]!;
        v[o + 2] = uv ? uv[k * 2]! : 0; v[o + 3] = uv ? uv[k * 2 + 1]! : 0;
        v[o + 4] = col[k * 4]!; v[o + 5] = col[k * 4 + 1]!; v[o + 6] = col[k * 4 + 2]!; v[o + 7] = col[k * 4 + 3]!;
      }
      for (let k = 0; k < ix.length; k++) this.idx[ni + k] = ix[k]! + nv;
      nv += n; ni += ix.length;
    };
    const setBlend = (m: string) => {
      if (m === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else if (m === 'screen') gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else if (m === 'add') gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };
    for (const it of d.list.draws) {
      if (d.hidden?.has(it.partId)) continue;
      // (a wardrobe part whose picture is still loading is not drawn yet, rather than drawn blank)
      if (it.texture && !d.textures.has(it.texture)) continue;
      const hasMask = !!it.masks?.length;
      if (hasMask || masked || it.texture !== tex || it.blend !== blend) {
        flush();
        if (masked) { gl.disable(gl.STENCIL_TEST); masked = false; }
        if (hasMask) {
          this.stencilRef = (this.stencilRef % 255) + 1;
          if (this.stencilRef === 1) gl.clear(gl.STENCIL_BUFFER_BIT);
          gl.enable(gl.STENCIL_TEST);
          gl.stencilFunc(gl.ALWAYS, this.stencilRef, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
          gl.colorMask(false, false, false, false);
          gl.uniform1f(this.loc.mask, 1);
          for (const m of it.masks!) { tex = m.texture; push(m); flush(); }
          gl.uniform1f(this.loc.mask, 0);
          gl.colorMask(true, true, true, true);
          gl.stencilFunc(it.maskInvert ? gl.NOTEQUAL : gl.EQUAL, this.stencilRef, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          masked = true;
        }
        tex = it.texture;
        blend = it.blend;
        setBlend(it.blend);
      }
      push(it);
    }
    flush();
    if (masked) gl.disable(gl.STENCIL_TEST);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog);
  }
}
