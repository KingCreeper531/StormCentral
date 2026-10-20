/**
 * Decoded radar on the GPU: a MapLibre custom layer that draws sweeps
 * straight from their gates.
 *
 * Each sweep is uploaded once as textures: the raw levels (gates × radials,
 * 8 or 16 bits), a colour per level, and an azimuth → radial lookup. The
 * fragment shader takes every screen pixel back to the radar's polar grid,
 * by the same 4/3-earth beam geometry as `levelAt` (great-circle distance and
 * bearing, then slant range for the sweep's elevation), and reads the gate
 * under it. So the gates stay sharp at any zoom, there's no image to render
 * or encode, and stepping the loop only changes which textures are bound.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from "maplibre-gl";
import { azimuthIndex, maxRangeKm, type Sweep } from "./sweep";

/** A sweep and the colour of each of its raw levels (RGBA, alpha 0 = clear). */
export interface SweepImageData {
  sweep: Sweep;
  colors: Uint8Array;
}

interface Uploaded {
  data: WebGLTexture;
  colors: WebGLTexture;
  azimuths: WebGLTexture;
}

/** The azimuth lookup's 3600 bins (0.1°) as a 60 × 60 texture (WebGL2 only promises 2048 px wide). */
const AZ_SIDE = 60;
/** The quad is a grid, so it follows the globe too. */
const GRID = 32;

const VERTEX = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
in vec2 a_pos;
out vec2 v_merc;
void main() {
  v_merc = a_pos;
  gl_Position = projectTile(a_pos);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D u_data;
uniform highp isampler2D u_az;
uniform sampler2D u_colors;
uniform vec2 u_radar;
uniform float u_elev;
uniform vec3 u_gates;
uniform float u_opacity;
in vec2 v_merc;
out vec4 fragColor;
const float PI = 3.141592653589793;
const float R_EARTH = 6371.0088;
const float KA = 4.0 / 3.0 * R_EARTH;
void main() {
  float lon = v_merc.x * 2.0 * PI - PI;
  float lat = 2.0 * atan(exp(PI - 2.0 * PI * v_merc.y)) - 0.5 * PI;
  float p1 = u_radar.x;
  float dl = lon - u_radar.y;
  float sLat = sin((lat - p1) * 0.5);
  float sLon = sin(dl * 0.5);
  float a = sLat * sLat + cos(p1) * cos(lat) * sLon * sLon;
  float km = 2.0 * R_EARTH * asin(sqrt(min(a, 1.0)));
  // Slant range from ground range (4/3 earth): r = ka sin(phi) / cos(elev + phi).
  float phi = km / KA;
  float c = cos(u_elev + phi);
  if (c <= 0.0) discard;
  float g = (KA * sin(phi) / c - u_gates.x) / u_gates.y + 0.5;
  if (g < 0.0 || g >= u_gates.z) discard;
  float az = degrees(atan(sin(dl) * cos(lat), cos(p1) * sin(lat) - sin(p1) * cos(lat) * cos(dl)));
  if (az < 0.0) az += 360.0;
  int bin = int(az * 10.0) % 3600;
  int radial = texelFetch(u_az, ivec2(bin % ${AZ_SIDE}, bin / ${AZ_SIDE}), 0).r;
  if (radial < 0) discard;
  int level = int(texelFetch(u_data, ivec2(int(g), radial), 0).r);
  vec4 color = texelFetch(u_colors, ivec2(level % 256, level / 256), 0);
  if (color.a == 0.0) discard;
  // MapLibre blends premultiplied colour.
  fragColor = vec4(color.rgb, 1.0) * color.a * u_opacity;
}`;

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

/** The sweep's reach as a Web Mercator box: [x0, y0, x1, y1] (y down). */
export function sweepBox(s: Pick<Sweep, "lat" | "lon" | "firstGateKm" | "gateKm" | "nGates" | "elevation">): [number, number, number, number] {
  const rangeKm = Math.max(10, maxRangeKm(s));
  const dLat = rangeKm / 111.195;
  const dLon = rangeKm / (111.195 * Math.max(0.05, Math.cos((s.lat * Math.PI) / 180)));
  return [mercX(s.lon - dLon), mercY(Math.min(84, s.lat + dLat)), mercX(s.lon + dLon), mercY(Math.max(-84, s.lat - dLat))];
}

export class SweepLayer implements CustomLayerInterface {
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  private map: MlMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private programs = new Map<string, { program: WebGLProgram; loc: (name: string) => WebGLUniformLocation | null; pos: number }>();
  private frames = new Map<string, SweepImageData>();
  private uploaded = new Map<string, Uploaded>();
  private visible: string | null = null;
  private opacity = 0.85;
  /** Sweeps too big for this GPU's textures (never seen from NEXRAD, but not worth a broken map). */
  private skipped = new Set<string>();
  private failed = false;
  private grid: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; index: WebGLBuffer; count: number; box: string } | null = null;

  constructor(readonly id: string) {}

  /** The loop's sweeps by frame id; textures for ones that left are freed. */
  setFrames(frames: ReadonlyMap<string, SweepImageData>) {
    for (const id of this.uploaded.keys()) if (!frames.has(id)) this.free(id);
    this.frames = new Map(frames);
    if (this.visible && !frames.has(this.visible)) this.visible = null;
    this.map?.triggerRepaint();
  }

  /** Draw this frame (null: none). */
  show(id: string | null) {
    if (id === this.visible) return;
    this.visible = id;
    this.map?.triggerRepaint();
  }

  setOpacity(opacity: number) {
    this.opacity = opacity;
    this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    map.on("webglcontextlost", this.onContextLost);
  }

  /** The GPU dropped everything (driver reset, too many contexts): forget it, and upload again once it's back. */
  private readonly onContextLost = () => {
    this.programs.clear();
    this.uploaded.clear();
    this.grid = null;
  };

  onRemove(map: MlMap, gl: WebGL2RenderingContext) {
    map.off("webglcontextlost", this.onContextLost);
    for (const id of [...this.uploaded.keys()]) this.free(id);
    for (const p of this.programs.values()) gl.deleteProgram(p.program);
    this.programs.clear();
    if (this.grid) {
      gl.deleteVertexArray(this.grid.vao);
      gl.deleteBuffer(this.grid.buffer);
      gl.deleteBuffer(this.grid.index);
      this.grid = null;
    }
    this.map = null;
    this.gl = null;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    // An exception here would stop the whole map drawing: radar is skipped instead, and said once.
    try {
      this.draw(gl, args);
    } catch (e) {
      if (!this.failed) console.error("Radar layer:", e);
      this.failed = true;
    }
  }

  private draw(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    // Upload the whole loop up front: stepping through it then costs nothing.
    for (const [id, f] of this.frames) if (!this.uploaded.has(id) && !this.skipped.has(id)) this.upload(gl, id, f);
    const id = this.visible;
    const frame = id ? this.frames.get(id) : undefined;
    const tex = id ? this.uploaded.get(id) : undefined;
    if (!frame || !tex || this.opacity <= 0) return;
    const prog = this.program(gl, args);
    if (!prog) return;
    const s = frame.sweep;

    gl.useProgram(prog.program);
    const d = args.defaultProjectionData;
    gl.uniformMatrix4fv(prog.loc("u_projection_matrix"), false, d.mainMatrix);
    gl.uniform4f(prog.loc("u_projection_tile_mercator_coords"), ...d.tileMercatorCoords);
    gl.uniform4f(prog.loc("u_projection_clipping_plane"), ...d.clippingPlane);
    gl.uniform1f(prog.loc("u_projection_transition"), d.projectionTransition);
    gl.uniformMatrix4fv(prog.loc("u_projection_fallback_matrix"), false, d.fallbackMatrix);
    gl.uniform2f(prog.loc("u_radar"), (s.lat * Math.PI) / 180, (s.lon * Math.PI) / 180);
    gl.uniform1f(prog.loc("u_elev"), (s.elevation * Math.PI) / 180);
    gl.uniform3f(prog.loc("u_gates"), s.firstGateKm, s.gateKm, s.nGates);
    gl.uniform1f(prog.loc("u_opacity"), this.opacity);
    const bind = (unit: number, t: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(prog.loc(name), unit);
    };
    bind(0, tex.data, "u_data");
    bind(1, tex.azimuths, "u_az");
    bind(2, tex.colors, "u_colors");

    const grid = this.gridFor(gl, sweepBox(s), prog.pos);
    gl.bindVertexArray(grid.vao);
    gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  private program(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const key = args.shaderData.variantName;
    const cached = this.programs.get(key);
    if (cached) return cached;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("Radar shader:", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX(args.shaderData.vertexShaderPrelude, args.shaderData.define));
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Radar shader:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    const locs = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => {
      if (!locs.has(name)) locs.set(name, gl.getUniformLocation(program, name));
      return locs.get(name)!;
    };
    const entry = { program, loc, pos: gl.getAttribLocation(program, "a_pos") };
    this.programs.set(key, entry);
    return entry;
  }

  /** A (GRID+1)² vertex grid over the box; rebuilt only when the box changes (another radar). */
  private gridFor(gl: WebGL2RenderingContext, box: [number, number, number, number], pos: number) {
    const key = box.join(",");
    if (this.grid?.box === key) return this.grid;
    if (this.grid) {
      gl.deleteVertexArray(this.grid.vao);
      gl.deleteBuffer(this.grid.buffer);
      gl.deleteBuffer(this.grid.index);
    }
    const [x0, y0, x1, y1] = box;
    const verts = new Float32Array((GRID + 1) * (GRID + 1) * 2);
    for (let j = 0, o = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++, o += 2) {
        verts[o] = x0 + ((x1 - x0) * i) / GRID;
        verts[o + 1] = y0 + ((y1 - y0) * j) / GRID;
      }
    }
    const idx = new Uint16Array(GRID * GRID * 6);
    for (let j = 0, o = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++, o += 6) {
        const a = j * (GRID + 1) + i;
        idx.set([a, a + 1, a + GRID + 1, a + 1, a + GRID + 2, a + GRID + 1], o);
      }
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const index = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.grid = { vao, buffer, index, count: idx.length, box: key };
    return this.grid;
  }

  private upload(gl: WebGL2RenderingContext, id: string, f: SweepImageData) {
    const s = f.sweep;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (s.nGates > max || s.nRadials > max || s.nGates * s.nRadials !== s.data.length || f.colors.length / 4 > 256 * max) {
      this.skipped.add(id);
      return;
    }
    const align = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const texture = (w: number, h: number, internal: number, format: number, type: number, pixels: ArrayBufferView) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      // Integer textures can only be read exactly: no filtering, no mipmaps.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, pixels);
      return t;
    };
    const wide = s.data instanceof Uint16Array;
    const data = texture(s.nGates, s.nRadials, wide ? gl.R16UI : gl.R8UI, gl.RED_INTEGER, wide ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE, s.data);
    const levels = f.colors.length / 4;
    const rows = Math.max(1, Math.ceil(levels / 256));
    const lut = new Uint8Array(256 * rows * 4);
    lut.set(f.colors);
    const colors = texture(256, rows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, lut);
    const azimuths = texture(AZ_SIDE, AZ_SIDE, gl.R32I, gl.RED_INTEGER, gl.INT, azimuthIndex(s));
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, align);
    this.uploaded.set(id, { data, colors, azimuths });
  }

  private free(id: string) {
    this.skipped.delete(id);
    const t = this.uploaded.get(id);
    if (t && this.gl) {
      this.gl.deleteTexture(t.data);
      this.gl.deleteTexture(t.colors);
      this.gl.deleteTexture(t.azimuths);
    }
    this.uploaded.delete(id);
  }
}
