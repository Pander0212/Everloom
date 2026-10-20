/**
 * Idle motion for composited paper dolls, in WebGL 2: each composite is one texture drawn as a grid
 * whose vertices move in the vertex shader (breathing in the chest region, a slight sway of the
 * upper body around the hips, soft bounce in the bounce regions). One draw call per character, no
 * per-frame CPU work beyond uniforms: built for phones.
 */
export interface MotionRig {
  breathe?: [number, number, number, number];
  pivot?: [number, number];
  bounce: Array<[number, number, number, number]>;
}

export interface DollDraw {
  texture: WebGLTexture;
  /** Template size (pixels) and where it goes on the canvas (pixels). */
  width: number; height: number;
  x: number; y: number; scale: number;
  rig: MotionRig;
  /** Seconds offset so two characters don't breathe in step. */
  phase: number;
  alpha: number;
  /** Strength 0…1 (0 = still, for screenshots and reduced motion). */
  motion: number;
}

const VS = `#version 300 es
in vec2 aPos;
uniform vec2 uSize, uCanvas, uOrigin;
uniform float uScale, uTime, uMotion;
uniform vec4 uBreathe;
uniform vec2 uPivot;
uniform vec4 uBounce[4];
uniform int uBounceN;
out vec2 vUv;
float bump(vec2 p, vec4 r) { vec2 c = r.xy + r.zw * 0.5; vec2 d = (p - c) / (r.zw * 0.5); return clamp(1.0 - dot(d, d), 0.0, 1.0); }
void main() {
  vec2 p = aPos * uSize;
  float t = uTime;
  // Breathing: the chest rises a little and widens, strongest in the middle of the region.
  float b = bump(p, uBreathe) * uMotion;
  float br = sin(t * 1.6) * 0.5 + 0.5;
  p.y -= b * br * uBreathe.w * 0.012;
  p.x += (p.x - (uBreathe.x + uBreathe.z * 0.5)) * b * br * 0.008;
  // Sway: everything above the hips turns slightly around them.
  float above = smoothstep(0.0, uSize.y * 0.35, uPivot.y - p.y) * uMotion;
  float ang = sin(t * 0.7) * 0.006 * above;
  vec2 q = p - uPivot;
  p = uPivot + vec2(q.x * cos(ang) - q.y * sin(ang), q.x * sin(ang) + q.y * cos(ang));
  // Bounce: a soft lagging bob in each bounce region.
  for (int i = 0; i < 4; i++) {
    if (i >= uBounceN) break;
    float w = bump(aPos * uSize, uBounce[i]) * uMotion;
    p.y += w * sin(t * 1.6 - 0.9) * uBounce[i].w * 0.018;
  }
  vec2 s = uOrigin + p * uScale;
  gl_Position = vec4(s.x / uCanvas.x * 2.0 - 1.0, 1.0 - s.y / uCanvas.y * 2.0, 0.0, 1.0);
  vUv = aPos;
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 o;
void main() { o = texture(uTex, vUv) * uAlpha; }`;

export class DollRenderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private count: number;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error('WebGL 2 is not available here.');
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const n of ['uSize', 'uCanvas', 'uOrigin', 'uScale', 'uTime', 'uMotion', 'uBreathe', 'uPivot', 'uBounce', 'uBounceN', 'uTex', 'uAlpha']) this.u[n] = gl.getUniformLocation(p, n);
    // A 24 × 48 grid over the unit square, as triangles.
    const C = 24, R = 48, v: number[] = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const a = [c / C, r / R], b = [(c + 1) / C, r / R], d = [c / C, (r + 1) / R], e = [(c + 1) / C, (r + 1) / R];
      v.push(...a, ...b, ...e, ...a, ...e, ...d);
    }
    this.count = v.length / 2;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  texture(src: TexImageSource): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  release(t: WebGLTexture) { this.gl.deleteTexture(t); }

  draw(list: DollDraw[], time: number) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.u.uCanvas!, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.u.uTex!, 0);
    for (const d of list) {
      gl.uniform2f(this.u.uSize!, d.width, d.height);
      gl.uniform2f(this.u.uOrigin!, d.x, d.y);
      gl.uniform1f(this.u.uScale!, d.scale);
      gl.uniform1f(this.u.uTime!, time + d.phase);
      gl.uniform1f(this.u.uMotion!, d.motion);
      gl.uniform1f(this.u.uAlpha!, d.alpha);
      gl.uniform4f(this.u.uBreathe!, ...(d.rig.breathe ?? [0, 0, 1, 1]));
      gl.uniform2f(this.u.uPivot!, ...(d.rig.pivot ?? [d.width / 2, d.height * 0.55]));
      const bb = new Float32Array(16);
      d.rig.bounce.slice(0, 4).forEach((r, i) => bb.set(r, i * 4));
      gl.uniform4fv(this.u.uBounce!, bb);
      gl.uniform1i(this.u.uBounceN!, Math.min(4, d.rig.bounce.length));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, d.texture);
      gl.drawArrays(gl.TRIANGLES, 0, this.count);
    }
    gl.bindVertexArray(null);
  }
}
