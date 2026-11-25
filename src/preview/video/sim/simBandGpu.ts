// 实时带体 WebGL2 光栅（issue 80）。中心线、折返及材质表与 CPU 实现共用。
import { splitBandAtFolds } from '../../../rendering/slideBandGeometry';
import {
  simBandCenterlineChains,
  type SimBandRasterGroup,
  type SimBandRasterMaterial,
  type SimBandRenderer,
} from './simBandRaster';
import type { SimFieldMetrics } from './simGeometry';

const FLOATS_PER_VERTEX = 10;

const vertexSource = `#version 300 es
layout(location = 0) in vec2 position;
layout(location = 1) in vec3 profile;
layout(location = 2) in float material;
layout(location = 3) in vec4 segment;
uniform vec2 size;
out vec3 band;
flat out int skin;
flat out vec4 coverageSegment;
void main() {
  gl_Position = vec4(position / size * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
  band = profile;
  skin = int(material);
  coverageSegment = segment;
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec3 band;
flat in int skin;
flat in vec4 coverageSegment;
uniform vec2 size;
uniform highp sampler2D lut;
uniform vec3 colors[2];
uniform float opacity;
out vec4 rgba;

// The integral of the symmetric cross-section is odd and constant beyond the strip.
float integratedProfile(float u) {
  float index = min(abs(u), 1.) * 1024.;
  int lo = int(index);
  int hi = min(lo + 1, 1024);
  return sign(u) * mix(
    texelFetch(lut, ivec2(lo, skin + 4), 0).r,
    texelFetch(lut, ivec2(hi, skin + 4), 0).r, fract(index));
}

float filteredProfile(float y, float halfSlope, float phaseSlope, out float phase) {
  float y0 = max(y - .5, coverageSegment.x);
  float y1 = min(y + .5, coverageSegment.y);
  float offset = (y0 + y1) * .5 - y;
  float halfWidth = max(1e-5, band.y + halfSlope * offset);
  phase = band.z + phaseSlope * offset;
  vec2 t = (vec2(y0, y1) - coverageSegment.x) / (coverageSegment.y - coverageSegment.x);
  vec2 center = mix(vec2(coverageSegment.z), vec2(coverageSegment.w), t);
  float travel = abs(center.y - center.x);
  float x = gl_FragCoord.x;
  if (travel < 1.) {
    float u = x - (center.x + center.y) * .5;
    return (y1 - y0) * halfWidth * (integratedProfile((u + .5) / halfWidth)
                                  - integratedProfile((u - .5) / halfWidth));
  }
  // Integrate along the strip's travel at two x positions, including the
  // coverage of segments that fall between consecutive pixel row centres.
  float left = min(center.x, center.y);
  float right = max(center.x, center.y);
  vec2 upper = (vec2(x - .25, x + .25) - left) / halfWidth;
  vec2 lower = (vec2(x - .25, x + .25) - right) / halfWidth;
  float summed = integratedProfile(upper.x) - integratedProfile(lower.x)
               + integratedProfile(upper.y) - integratedProfile(lower.y);
  return (y1 - y0) * halfWidth * summed / (2. * travel);
}

void main() {
  // Fragment y grows upwards, while stage y grows downwards.
  float halfSlope = -dFdy(band.y);
  float phaseSlope = -dFdy(band.z);
  bool filtered = coverageSegment.y > coverageSegment.x;
  float phase = band.z;
  float crossSection;
  float coverage = 1.;
  if (filtered) {
    crossSection = filteredProfile(size.y - gl_FragCoord.y, halfSlope, phaseSlope, phase);
  } else {
    float distanceFromCenter = abs(gl_FragCoord.x - band.x);
    coverage = clamp(band.y - distanceFromCenter, 0., 1.);
    int crossIndex = int(clamp(distanceFromCenter / band.y, 0., 1.) * 1024.);
    crossSection = texelFetch(lut, ivec2(crossIndex, skin * 2), 0).r;
  }
  int alongIndex = int(clamp(phase, 0., 1.) * 256.);
  float along = texelFetch(lut, ivec2(alongIndex, skin * 2 + 1), 0).r;
  float alpha = floor(clamp(crossSection * along * coverage * opacity, 0., 1.) * 255.
                    + (filtered ? .5 : 0.)) / 255.;
  if (alpha == 0.) discard;
  rgba = vec4(colors[skin], alpha);
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
    alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false,
    failIfMajorPerformanceCaveat: true,
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
  const lut = gl.createTexture();
  const vertices = gl.createBuffer();
  if (!lut || !vertices) throw new Error('Unable to allocate band buffers');
  gl.useProgram(material);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  for (const [index, count, offset] of [[0, 2, 0], [1, 3, 8], [2, 1, 20], [3, 4, 24]]) {
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, count, gl.FLOAT, false, FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT, offset);
  }
  gl.bindTexture(gl.TEXTURE_2D, lut);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.disable(gl.DITHER);
  // Keep the latest band's straight RGB and accumulate alpha even for overlapping skins.
  // The 2D stage composites the straight-alpha drawing buffer when it draws this canvas.
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const initialData = new Float32Array(4096);
  gl.bufferData(gl.ARRAY_BUFFER, initialData.byteLength, gl.DYNAMIC_DRAW);
  return {
    canvas, gl, material, lut, vertices,
    size: gl.getUniformLocation(material, 'size'),
    opacity: gl.getUniformLocation(material, 'opacity'),
    colors: gl.getUniformLocation(material, 'colors[0]'),
    data: initialData,
    vertexFloats: initialData.length,
    width: 0,
    height: 0,
    lastOpacity: Number.NaN,
    skins: null as readonly SimBandRasterMaterial[] | null,
  };
}

function writeIntegratedProfile(values: Float32Array, offset: number, cross: Float32Array): void {
  let integral = 0;
  for (let i = 1; i < cross.length; i++) {
    integral += (cross[i - 1]! + cross[i]!) / (2 * (cross.length - 1));
    values[offset + i] = integral;
  }
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
  const { canvas, gl } = scratch;
  if (gl.isContextLost()) throw new Error('Band WebGL context lost');
  // 跟随主画布实际分辨率调整：过渡帧由 simPlayback 延迟后统一回缩，避免同步拆缓冲也释放窗口态冗余显存
  const needBuffer = canvas.width !== w || canvas.height !== h;
  const needView = scratch.width !== w || scratch.height !== h;
  if (needBuffer) {
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (gl.drawingBufferWidth < w || gl.drawingBufferHeight < h) {
      throw new Error('Unable to resize band drawing buffer');
    }
  }
  if (needView) {
    scratch.width = w;
    scratch.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(scratch.size, w, h);
  }
  if (scratch.skins?.[0] !== normal || scratch.skins?.[1] !== sp) {
    const values = new Float32Array(1025 * 6);
    values.set(normal.cross, 0);
    values.set(normal.longitudinal, 1025);
    values.set(sp.cross, 2050);
    values.set(sp.longitudinal, 3075);
    writeIntegratedProfile(values, 1025 * 4, normal.cross);
    writeIntegratedProfile(values, 1025 * 5, sp.cross);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1025, 6, 0, gl.RED, gl.FLOAT, values);
    gl.uniform3fv(scratch.colors, [...normal.rgb, ...sp.rgb].map(channel => channel / 255));
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Unable to upload band material');
    scratch.skins = [normal, sp];
  }

  let size = 0;
  const bandScratch = scratch;
  let clipStart = 0, clipEnd = 0, centerStart = 0, centerEnd = 0;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  function vertex(x: number, y: number, center: number, half: number, phase: number, skin: number) {
    if (size + FLOATS_PER_VERTEX > bandScratch.data.length) {
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
    data[size++] = clipStart;
    data[size++] = clipEnd;
    data[size++] = centerStart;
    data[size++] = centerEnd;
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
        const height = end - start;
        // Even a fully opaque segment of this height rounds to zero in RGBA8.
        if (height < .5 / 255) continue;
        centerStart = a.x * sx;
        centerEnd = b.x * sx;
        const edgeDelta = Math.abs(centerEnd - centerStart) + Math.abs(b.half - a.half) * sx;
        const filtered = height < 2 || edgeDelta > 2 * height;
        clipStart = filtered ? start : 0;
        clipEnd = filtered ? end : 0;
        // Regular segments retain row-centre ownership at an exact join.
        let first = filtered ? Math.floor(start) : Math.ceil(start - .5);
        if (!filtered && index > 1 && first + .5 === start) first++;
        const last = Math.min(h - 1, filtered ? Math.ceil(end) - 1 : Math.floor(end - .5));
        first = Math.max(first, 0);
        if (last < first) continue;
        const ay = first;
        const by = last + 1;
        const singleRow = first === last && (!filtered || height < 2);
        const oneRowSample = filtered ? (start + end) / 2 : first + .5;
        const sampleA = singleRow ? oneRowSample : ay;
        const sampleB = singleRow ? oneRowSample : by;
        const t0 = (sampleA - start) / (end - start);
        const t1 = (sampleB - start) / (end - start);
        const ax = (a.x + (b.x - a.x) * t0) * sx;
        const bx = (a.x + (b.x - a.x) * t1) * sx;
        const ah = (a.half + (b.half - a.half) * t0) * sx;
        const bh = (a.half + (b.half - a.half) * t1) * sx;
        const au = (sampleA / sy - low) / span;
        const bu = (sampleB / sy - low) / span;
        const margin = filtered ? .5 + .5 * edgeDelta / height : 0;
        let leftA = ax - Math.max(0, ah) - margin;
        let rightA = ax + Math.max(0, ah) + margin;
        let leftB = bx - Math.max(0, bh) - margin;
        let rightB = bx + Math.max(0, bh) + margin;
        // Bound very short segments without extrapolating their x positions.
        if (filtered && height < 2) {
          leftA = leftB = Math.min((a.x - a.half) * sx, (b.x - b.half) * sx) - .5;
          rightA = rightB = Math.max((a.x + a.half) * sx, (b.x + b.half) * sx) + .5;
        }
        left = Math.min(left, leftA, leftB);
        right = Math.max(right, rightA, rightB);
        top = Math.min(top, ay);
        bottom = Math.max(bottom, by);
        vertex(leftA, ay, ax, ah, au, skin);
        vertex(rightA, ay, ax, ah, au, skin);
        vertex(leftB, by, bx, bh, bu, skin);
        vertex(rightA, ay, ax, ah, au, skin);
        vertex(rightB, by, bx, bh, bu, skin);
        vertex(leftB, by, bx, bh, bu, skin);
      }
    }
  }
  if (size === 0) return;
  // Keep the WebGL pixel grid, but copy only the potentially painted area to the stage.
  const x = Math.max(0, Math.floor(left) - 2);
  const y = Math.max(0, Math.floor(top) - 2);
  const width = Math.min(w, Math.ceil(right) + 2) - x;
  const height = Math.min(h, Math.ceil(bottom) + 2) - y;
  if (width <= 0 || height <= 0) return;
  // Rewriting unchanged uniforms makes ANGLE upload shader constants again on D3D11.
  if (scratch.lastOpacity !== opacity) {
    gl.uniform1f(scratch.opacity, opacity);
    scratch.lastOpacity = opacity;
  }
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (size > scratch.vertexFloats) {
    scratch.vertexFloats = scratch.data.length;
    gl.bufferData(gl.ARRAY_BUFFER, scratch.vertexFloats * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.data.subarray(0, size));
  gl.drawArrays(gl.TRIANGLES, 0, size / FLOATS_PER_VERTEX);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  try {
    const scaleX = metrics.w * sx / w;
    const scaleY = metrics.h * sy / h;
    ctx.drawImage(canvas, x, y, width, height, dx + x * scaleX, dy + y * scaleY, width * scaleX, height * scaleY);
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
    const { gl, canvas, material, lut, vertices } = scratch;
    scratch = undefined;
    gl.deleteBuffer(vertices);
    gl.deleteTexture(lut);
    gl.deleteProgram(material);
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
