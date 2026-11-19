// 实时带体 WebGL2 光栅（issue 80）。中心线、折返及材质表与 CPU 实现共用。
import { splitBandAtFolds } from '../../../rendering/slideBandGeometry';
import {
  simBandCenterlineChains,
  type SimBandRasterGroup,
  type SimBandRasterMaterial,
  type SimBandRenderer,
} from './simBandRaster';
import type { SimFieldMetrics } from './simGeometry';

const vertexSource = `#version 300 es
layout(location = 0) in vec2 position;
layout(location = 1) in vec3 profile;
layout(location = 2) in float material;
uniform vec2 size;
out vec3 band;
flat out int skin;
void main() {
  gl_Position = vec4(position / size * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
  band = profile;
  skin = int(material);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec3 band;
flat in int skin;
uniform highp sampler2D lut;
uniform vec3 colors[2];
uniform float opacity;
out vec4 rgba;
void main() {
  float distanceFromCenter = abs(gl_FragCoord.x - band.x);
  float coverage = clamp(band.y - distanceFromCenter, 0., 1.);
  int crossIndex = int(clamp(distanceFromCenter / band.y, 0., 1.) * 1024.);
  int alongIndex = int(clamp(band.z, 0., 1.) * 256.);
  float crossSection = texelFetch(lut, ivec2(crossIndex, skin * 2), 0).r;
  float along = texelFetch(lut, ivec2(alongIndex, skin * 2 + 1), 0).r;
  float alpha = floor(clamp(crossSection * along * coverage * opacity, 0., 1.) * 255.) / 255.;
  if (alpha == 0.) discard;
  rgba = vec4(colors[skin], alpha);
}`;

const coverVertex = `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2. - 1., 0., 1.);
}`;
const coverFragment = `#version 300 es
precision highp float;
uniform sampler2D layer;
out vec4 rgba;
void main() {
  vec4 straight = texelFetch(layer, ivec2(gl_FragCoord.xy), 0);
  rgba = vec4(straight.rgb * straight.a, straight.a);
}`;

function createProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate band program');
  for (const [type, source] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate band shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
  return program;
}

function createScratch() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: true,
  });
  if (!gl) throw new Error('WebGL2 unavailable');
  try {
    return initScratch(gl, canvas);
  } catch (error) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw error;
  }
}

function initScratch(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
  const material = createProgram(gl, vertexSource, fragmentSource);
  const cover = createProgram(gl, coverVertex, coverFragment);
  const framebuffer = gl.createFramebuffer();
  const pixels = gl.createTexture();
  const lut = gl.createTexture();
  const vertices = gl.createBuffer();
  if (!framebuffer || !pixels || !lut || !vertices) throw new Error('Unable to allocate band buffers');
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  for (const [index, count, offset] of [[0, 2, 0], [1, 3, 8], [2, 1, 20]]) {
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, count, gl.FLOAT, false, 24, offset);
  }
  for (const texture of [pixels, lut]) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pixels, 0);
  gl.disable(gl.DITHER);
  gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return {
    canvas, gl, material, cover, framebuffer, pixels, lut, vertices,
    size: gl.getUniformLocation(material, 'size'),
    opacity: gl.getUniformLocation(material, 'opacity'),
    colors: gl.getUniformLocation(material, 'colors[0]'),
    data: new Float32Array(4096),
    width: 0,
    height: 0,
    skins: null as readonly SimBandRasterMaterial[] | null,
  };
}

function drawGlBands(
  ctx: CanvasRenderingContext2D,
  scratch: ReturnType<typeof createScratch>,
  groups: readonly SimBandRasterGroup[],
  normal: SimBandRasterMaterial,
  sp: SimBandRasterMaterial,
  opacity: number,
  metrics: SimFieldMetrics,
): void {
  const { a: sx, d: sy, e: dx, f: dy } = ctx.getTransform();
  const w = Math.max(1, Math.round(metrics.w * sx));
  const h = Math.max(1, Math.round(metrics.h * sy));
  const { canvas, gl, material, cover, framebuffer, pixels, lut, vertices } = scratch;
  if (gl.isContextLost()) throw new Error('Band WebGL context lost');
  if (scratch.width !== w || scratch.height !== h) {
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (gl.drawingBufferWidth !== w || gl.drawingBufferHeight !== h) {
      throw new Error('Unable to resize band drawing buffer');
    }
    gl.bindTexture(gl.TEXTURE_2D, pixels);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    if (gl.getError() !== gl.NO_ERROR || gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Incomplete band framebuffer');
    }
    scratch.width = w;
    scratch.height = h;
  }
  gl.useProgram(material);
  gl.bindTexture(gl.TEXTURE_2D, lut);
  if (scratch.skins?.[0] !== normal || scratch.skins?.[1] !== sp) {
    const values = new Float32Array(1025 * 4);
    values.set(normal.cross, 0);
    values.set(normal.longitudinal, 1025);
    values.set(sp.cross, 2050);
    values.set(sp.longitudinal, 3075);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1025, 4, 0, gl.RED, gl.FLOAT, values);
    gl.uniform3fv(scratch.colors, [...normal.rgb, ...sp.rgb].map(channel => channel / 255));
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Unable to upload band material');
    scratch.skins = [normal, sp];
  }

  let size = 0;
  const bandScratch = scratch;
  function vertex(x: number, y: number, center: number, half: number, phase: number, skin: number) {
    if (size + 6 > bandScratch.data.length) {
      const enlarged = new Float32Array(bandScratch.data.length * 2);
      enlarged.set(bandScratch.data);
      bandScratch.data = enlarged;
    }
    const data = bandScratch.data;
    data[size++] = x;
    data[size++] = y;
    data[size++] = center;
    data[size++] = half;
    data[size++] = phase;
    data[size++] = skin;
  }
  for (const group of groups) {
    const chains = simBandCenterlineChains(group.quads);
    type Node = (typeof chains)[number][number];
    let low = Infinity;
    let high = -Infinity;
    for (const chain of chains) for (const point of chain) {
      low = Math.min(low, point.y);
      high = Math.max(high, point.y);
    }
    const span = high - low;
    if (span < 1e-6) continue;
    const skin = Number(group.sp);
    for (const chain of chains) for (const points of splitBandAtFolds(chain) as Node[][]) {
      const run = points[0]!.y > points.at(-1)!.y ? points.reverse() : points;
      for (let index = 1; index < run.length; index++) {
        const a = run[index - 1]!;
        const b = run[index]!;
        if (b.y - a.y <= 1e-9) continue;
        const start = a.y * sy;
        const end = b.y * sy;
        // Match the CPU row-center rule. Each folded run owns both ends, and
        // an exact join within one run belongs to the earlier segment.
        let first = Math.ceil(start - .5);
        if (index > 1 && first + .5 === start) first++;
        const last = Math.min(h - 1, Math.floor(end - .5));
        first = Math.max(first, 0);
        if (last < first) continue;
        const ay = first;
        const by = last + 1;
        const sampleA = first === last ? first + .5 : ay;
        const sampleB = first === last ? first + .5 : by;
        const t0 = (sampleA - start) / (end - start);
        const t1 = (sampleB - start) / (end - start);
        const ax = (a.x + (b.x - a.x) * t0) * sx;
        const bx = (a.x + (b.x - a.x) * t1) * sx;
        const ah = (a.half + (b.half - a.half) * t0) * sx;
        const bh = (a.half + (b.half - a.half) * t1) * sx;
        const au = (sampleA / sy - low) / span;
        const bu = (sampleB / sy - low) / span;
        const hwA = Math.max(0, ah);
        const hwB = Math.max(0, bh);
        vertex(ax - hwA, ay, ax, ah, au, skin);
        vertex(ax + hwA, ay, ax, ah, au, skin);
        vertex(bx - hwB, by, bx, bh, bu, skin);
        vertex(ax + hwA, ay, ax, ah, au, skin);
        vertex(bx + hwB, by, bx, bh, bu, skin);
        vertex(bx - hwB, by, bx, bh, bu, skin);
      }
    }
  }
  if (size === 0) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // Retain the later band's RGB and independently accumulate opacity through overlaps.
  gl.enable(gl.BLEND);
  gl.uniform2f(scratch.size, w, h);
  gl.uniform1f(scratch.opacity, opacity);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, scratch.data.subarray(0, size), gl.STREAM_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, size / 6);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(cover);
  gl.bindTexture(gl.TEXTURE_2D, pixels);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  try {
    ctx.drawImage(canvas, dx, dy, metrics.w * sx, metrics.h * sy);
  } finally {
    ctx.restore();
  }
}

/** 单个动态舞台持有同一组纹理和程序。首次失败后，该舞台走 CPU 路径。 */
export function createSimGpuBandRenderer(): { draw: SimBandRenderer; dispose(): void } {
  let scratch: ReturnType<typeof createScratch> | undefined;
  let failed = false;

  function release(): void {
    if (!scratch) return;
    const { gl, canvas, material, cover, framebuffer, pixels, lut, vertices } = scratch;
    scratch = undefined;
    gl.deleteBuffer(vertices);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(pixels);
    gl.deleteTexture(lut);
    gl.deleteProgram(material);
    gl.deleteProgram(cover);
    canvas.width = canvas.height = 1;
  }

  return {
    draw(ctx, groups, normal, sp, opacity, metrics) {
      if (failed) return false;
      try {
        scratch ??= createScratch();
        drawGlBands(ctx, scratch, groups, normal, sp, opacity, metrics);
        return true;
      } catch (error) {
        failed = true;
        release();
        console.warn('[preview] WebGL2 带体不可用，改用 CPU 绘制', error);
        return false;
      }
    },
    dispose() {
      release();
      failed = false;
    },
  };
}
