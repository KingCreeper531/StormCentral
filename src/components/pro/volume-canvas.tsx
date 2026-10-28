"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Mesh, Rgb } from "@/lib/pro/isosurface";
import type { VolumePoints } from "@/lib/pro/volume3d";
import { cn } from "@/lib/utils";

/** Column-major 4×4 matrices, just what an orbit camera needs. */
type Mat = Float32Array;

function perspective(fovy: number, aspect: number, near: number, far: number): Mat {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye: readonly number[], c: readonly number[], up: readonly number[]): Mat {
  const sub = (a: readonly number[], b: readonly number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
  const norm = (a: number[]) => {
    const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
    return [a[0]! / l, a[1]! / l, a[2]! / l];
  };
  const cross = (a: number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dot = (a: number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const z = norm(sub(eye, c));
  const x = norm(cross([...up], z));
  const y = cross(z, x);
  return new Float32Array([x[0]!, y[0]!, z[0]!, 0, x[1]!, y[1]!, z[1]!, 0, x[2]!, y[2]!, z[2]!, 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

function multiply(a: Mat, b: Mat): Mat {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[j * 4 + i] = a[i]! * b[j * 4]! + a[4 + i]! * b[j * 4 + 1]! + a[8 + i]! * b[j * 4 + 2]! + a[12 + i]! * b[j * 4 + 3]!;
  return o;
}

const POINT_VS = `#version 300 es
in vec3 a_pos;
in vec3 a_color;
in float a_size;
uniform mat4 u_mvp;
uniform float u_exag;
uniform float u_ground;
uniform float u_pxPerKm;
out vec3 v_color;
out vec3 v_world;
void main() {
  vec4 c = u_mvp * vec4(a_pos.xy, u_ground + (a_pos.z - u_ground) * u_exag, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(a_size * u_pxPerKm / c.w, 1.5, 40.0);
  v_color = a_color / 255.0;
  v_world = a_pos;
}`;

// Square points with a slightly darker rim read as solid blocks of echo.
const POINT_FS = `#version 300 es
precision mediump float;
in vec3 v_color;
in vec3 v_world;
uniform vec4 u_clip;
out vec4 o;
void main() {
  if (dot(vec4(v_world, 1.0), u_clip) > 0.0) discard;
  vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
  o = vec4(v_color * (1.0 - 0.28 * smoothstep(0.65, 1.0, max(q.x, q.y))), 1.0);
}`;

const LINE_VS = `#version 300 es
in vec3 a_pos;
uniform mat4 u_mvp;
uniform float u_exag;
uniform float u_ground;
void main() {
  gl_Position = u_mvp * vec4(a_pos.xy, u_ground + (a_pos.z - u_ground) * u_exag, 1.0);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o;
void main() { o = u_color; }`;

// Surfaces: stretching heights by the exaggeration squashes the normals' z by as much.
const MESH_VS = `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
uniform mat4 u_mvp;
uniform float u_exag;
uniform float u_ground;
out vec3 v_world;
out vec3 v_pos;
out vec3 v_normal;
void main() {
  vec3 p = vec3(a_pos.xy, u_ground + (a_pos.z - u_ground) * u_exag);
  v_world = a_pos;
  v_pos = p;
  v_normal = vec3(a_normal.xy, a_normal.z / u_exag);
  gl_Position = u_mvp * vec4(p, 1.0);
}`;

// Ambient + diffuse from a light over the viewer's shoulder, a little shine. The inside of a shell (through a cut,
// or the far side of a see-through one) is lit the same but darker, so it reads as inside.
const MESH_FS = `#version 300 es
precision highp float;
in vec3 v_world;
in vec3 v_pos;
in vec3 v_normal;
uniform vec4 u_color;
uniform vec3 u_light;
uniform vec3 u_eye;
uniform vec4 u_clip;
out vec4 o;
void main() {
  if (dot(vec4(v_world, 1.0), u_clip) > 0.0) discard;
  vec3 n = normalize(v_normal);
  vec3 v = normalize(u_eye - v_pos);
  float side = 1.0;
  if (dot(n, v) < 0.0) {
    n = -n;
    side = 0.55;
  }
  float diffuse = max(dot(n, u_light), 0.0);
  float shine = pow(max(dot(n, normalize(u_light + v)), 0.0), 48.0) * 0.28;
  o = vec4((u_color.rgb * (0.36 + 0.64 * diffuse) + shine) * side, u_color.a);
}`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || (gl.isContextLost() ? "WebGL context lost" : "shader didn't compile"));
    gl.attachShader(p, s);
    // Freed with the program.
    gl.deleteShader(s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

/** Points `name` of `prog` at `buf` (in the vertex array bound now). */
function attribute(ctx: WebGL2RenderingContext, prog: WebGLProgram, name: string, buf: WebGLBuffer, size: number, type: number) {
  const loc = ctx.getAttribLocation(prog, name);
  ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
  ctx.enableVertexAttribArray(loc);
  ctx.vertexAttribPointer(loc, size, type, false, 0, 0);
}

export interface VolumeLabel {
  /** Local frame, km; z before the exaggeration. */
  at: [number, number, number];
  text: string;
  color?: string;
  align?: CanvasTextAlign;
  /** Screen offset, CSS px. */
  dx?: number;
  dy?: number;
}

/** A shaded shell (lib/pro/isosurface). */
export interface SceneSurface {
  mesh: Mesh;
  color: Rgb;
  /** 1: solid; less: see-through. */
  opacity: number;
  /** See-through shells are drawn outermost (lowest) first behind, innermost first in front. */
  order: number;
}

export interface VolumeScene {
  points: VolumePoints | null;
  surfaces: SceneSurface[];
  /** Half the width of the surfaces' box (km), outlined on the ground; null: none. */
  box: number | null;
  radiusKm: number;
  exaggeration: number;
  /** Ground level for the grid and the exaggeration (km above sea level). */
  ground: number;
  /** Top of the height axis (km above sea level). */
  top: number;
  /** Height-axis ticks (km above sea level), labelled left of the axis in `axisUnit`... */
  ticks: { km: number; label: string }[];
  axisUnit: string;
  /** ...and right of it in the other unit. */
  ticks2: { km: number; label: string }[];
  axisUnit2: string;
  /** Horizontal levels to draw as sheets: the freezing level, −20 °C. */
  levels: { km: number; color: [number, number, number, number]; label: string }[];
  /** Map lines on the ground: segment ends x, y, z (km). */
  outlines: Float32Array | null;
  /** Everything east of x, north of y or above z (km; z above sea level) is cut away. */
  cut: { axis: "x" | "y" | "z"; at: number } | null;
  labels: VolumeLabel[];
  dark: boolean;
}

export interface VolumeCanvasHandle {
  reset: () => void;
  /** Closer (under 1) or further. */
  zoom: (f: number) => void;
  /** The view as a PNG, with `caption` in a corner. */
  snapshot: (caption: string) => Promise<Blob | null>;
}

interface Camera {
  yaw: number;
  pitch: number;
  dist: number;
  target: [number, number, number];
}

interface MeshGpu {
  vao: WebGLVertexArrayObject;
  bufs: WebGLBuffer[];
  count: number;
}

const FOV = (40 * Math.PI) / 180;
const defaultCamera = (s: VolumeScene): Camera => ({
  yaw: 0.35,
  pitch: 0.42,
  dist: s.radiusKm * 3,
  target: [0, 0, s.ground + ((s.top - s.ground) * s.exaggeration) / 3],
});

/**
 * The 3D volume (lib/pro/volume3d, lib/pro/isosurface) drawn with WebGL 2:
 * shaded shells or echo as gate-sized blocks, a ground grid with map lines,
 * the circle and the shells' box, a height axis in both units with a grid on
 * the far walls, level sheets and a cut-away plane, with labels and a north
 * arrow on a 2D layer above. Drag to orbit, right-drag, Shift-drag or two
 * fingers to pan, wheel or pinch to zoom, double-click to reset; arrows, +
 * and − on the keyboard.
 */
export const VolumeCanvas = forwardRef<VolumeCanvasHandle, { scene: VolumeScene; label: string; unsupported: string; className?: string }>(function VolumeCanvas({ scene, label, unsupported, className }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  const cam = useRef<Camera>(defaultCamera(scene));
  const frame = useRef(0);
  /** Sends the scene's points, shells and map lines to the GPU (set once WebGL is up). */
  const uploadRef = useRef<(what: "points" | "meshes" | "outlines" | "all") => void>(() => {});
  /** Bumped for a new canvas element when the old one's context was let go (see the set-up below). */
  const [canvasKey, setCanvasKey] = useState(0);
  const [failed, setFailed] = useState(false);
  const renewed = useRef(false);
  const gl = useRef<{
    ctx: WebGL2RenderingContext;
    points: WebGLProgram;
    lines: WebGLProgram;
    mesh: WebGLProgram;
    pointVao: WebGLVertexArrayObject;
    pointBufs: WebGLBuffer[];
    pointCount: number;
    lineVao: WebGLVertexArrayObject;
    lineBuf: WebGLBuffer;
    outlineVao: WebGLVertexArrayObject;
    outlineBuf: WebGLBuffer;
    outlineCount: number;
    meshes: Map<Mesh, MeshGpu>;
  } | null>(null);

  const draw = useCallback(() => {
    frame.current = 0;
    const g = gl.current;
    const c = canvas.current;
    const o = overlay.current;
    if (!g || !c || !o) return;
    const s = sceneRef.current;
    const { ctx } = g;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = o.width = Math.round(w * dpr);
      c.height = o.height = Math.round(h * dpr);
    }
    const k = cam.current;
    const eye = [
      k.target[0] + k.dist * Math.cos(k.pitch) * Math.sin(k.yaw),
      k.target[1] - k.dist * Math.cos(k.pitch) * Math.cos(k.yaw),
      k.target[2] + k.dist * Math.sin(k.pitch),
    ];
    const mvp = multiply(perspective(FOV, w / h, 0.5, s.radiusKm * 40), lookAt(eye, k.target, [0, 0, 1]));
    const project = (p: readonly number[]) => {
      const zz = s.ground + (p[2]! - s.ground) * s.exaggeration;
      const x = mvp[0]! * p[0]! + mvp[4]! * p[1]! + mvp[8]! * zz + mvp[12]!;
      const y = mvp[1]! * p[0]! + mvp[5]! * p[1]! + mvp[9]! * zz + mvp[13]!;
      const ww = mvp[3]! * p[0]! + mvp[7]! * p[1]! + mvp[11]! * zz + mvp[15]!;
      if (ww <= 0.1) return null;
      return [((x / ww + 1) / 2) * w, ((1 - y / ww) / 2) * h] as const;
    };
    // The height axis stands at whichever corner is furthest left on screen, clear of the storm.
    const R0 = s.radiusKm;
    const corners: [number, number][] = [
      [-R0, -R0],
      [R0, -R0],
      [R0, R0],
      [-R0, R0],
    ];
    const [ax, ay] = corners.reduce((best, c) => ((project([c[0], c[1], s.ground])?.[0] ?? Infinity) < (project([best[0], best[1], s.ground])?.[0] ?? Infinity) ? c : best));
    // Ticks point into the square.
    const tick = ax < 0 ? R0 * 0.04 : -R0 * 0.04;
    ctx.viewport(0, 0, c.width, c.height);
    const bg = s.dark ? [0.02, 0.025, 0.035] : [0.95, 0.96, 0.97];
    ctx.clearColor(bg[0]!, bg[1]!, bg[2]!, 1);
    ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT);
    ctx.enable(ctx.DEPTH_TEST);
    ctx.disable(ctx.CULL_FACE);
    ctx.frontFace(ctx.CCW);

    // The ground, its grid, the circle, the box, the axis and ticks, the far walls' height grid and the cut.
    const R = s.radiusKm;
    const z0 = s.ground;
    const step = R > 80 ? 20 : 10;
    const lines: number[] = [-R, -R, z0, R, -R, z0, R, R, z0, -R, -R, z0, R, R, z0, -R, R, z0];
    const seg = (a: number[], b: number[]) => lines.push(...a, ...b);
    for (let v = -Math.floor(R / step) * step; v <= R + 1e-6; v += step) {
      seg([v, -R, z0], [v, R, z0]);
      seg([-R, v, z0], [R, v, z0]);
    }
    const grid = lines.length / 3;
    // The walls behind the storm from here: the sides the eye isn't on.
    const wx = eye[0]! > 0 ? -R : R;
    const wy = eye[1]! > 0 ? -R : R;
    for (const t of s.ticks) {
      if (t.km <= z0 + 0.05) continue;
      seg([wx, -R, t.km], [wx, R, t.km]);
      seg([-R, wy, t.km], [R, wy, t.km]);
    }
    seg([wx, wy, z0], [wx, wy, s.top]);
    seg([wx, -wy, z0], [wx, -wy, s.top]);
    seg([-wx, wy, z0], [-wx, wy, s.top]);
    const walls = lines.length / 3;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const b = ((i + 1) / 96) * Math.PI * 2;
      seg([R * Math.sin(a), R * Math.cos(a), z0], [R * Math.sin(b), R * Math.cos(b), z0]);
    }
    seg([ax, ay, z0], [ax, ay, s.top]);
    for (const t of s.ticks) seg([ax, ay, t.km], [ax + tick, ay, t.km]);
    if (s.box) {
      const b = s.box;
      seg([-b, -b, z0], [b, -b, z0]);
      seg([b, -b, z0], [b, b, z0]);
      seg([b, b, z0], [-b, b, z0]);
      seg([-b, b, z0], [-b, -b, z0]);
    }
    const marks = lines.length / 3;
    const cut = s.cut;
    if (cut) {
      const q: number[][] =
        cut.axis === "x"
          ? [[cut.at, -R, z0], [cut.at, R, z0], [cut.at, R, s.top], [cut.at, -R, s.top]]
          : cut.axis === "y"
            ? [[-R, cut.at, z0], [R, cut.at, z0], [R, cut.at, s.top], [-R, cut.at, s.top]]
            : [[-R, -R, cut.at], [R, -R, cut.at], [R, R, cut.at], [-R, R, cut.at]];
      for (let i = 0; i < 4; i++) seg(q[i]!, q[(i + 1) % 4]!);
    }
    const cutEnd = lines.length / 3;
    // Level sheets as two triangles each.
    for (const l of s.levels) lines.push(-R, -R, l.km, R, -R, l.km, R, R, l.km, -R, -R, l.km, R, R, l.km, -R, R, l.km);
    ctx.bindBuffer(ctx.ARRAY_BUFFER, g.lineBuf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array(lines), ctx.DYNAMIC_DRAW);
    ctx.useProgram(g.lines);
    const lu = (n: string) => ctx.getUniformLocation(g.lines, n);
    ctx.uniformMatrix4fv(lu("u_mvp"), false, mvp);
    ctx.uniform1f(lu("u_exag"), s.exaggeration);
    ctx.uniform1f(lu("u_ground"), z0);
    ctx.bindVertexArray(g.lineVao);
    const ink = s.dark ? [1, 1, 1] : [0, 0, 0];
    const color = (a: number) => ctx.uniform4f(lu("u_color"), ink[0]!, ink[1]!, ink[2]!, a);
    ctx.enable(ctx.BLEND);
    // The canvas stays opaque: see-through layers blend colour only, so neither the page nor a snapshot's
    // transparent background shows through them.
    ctx.blendFuncSeparate(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA, ctx.ZERO, ctx.ONE);
    // The ground never hides anything.
    ctx.depthMask(false);
    color(s.dark ? 0.035 : 0.05);
    ctx.drawArrays(ctx.TRIANGLES, 0, 6);
    ctx.depthMask(true);
    color(0.12);
    ctx.drawArrays(ctx.LINES, 6, grid - 6);
    color(0.07);
    ctx.drawArrays(ctx.LINES, grid, walls - grid);
    color(0.45);
    ctx.drawArrays(ctx.LINES, walls, marks - walls);
    if (cutEnd > marks) {
      ctx.uniform4f(lu("u_color"), 0.98, 0.72, 0.18, 0.85);
      ctx.drawArrays(ctx.LINES, marks, cutEnd - marks);
    }
    if (g.outlineCount) {
      ctx.bindVertexArray(g.outlineVao);
      color(s.dark ? 0.3 : 0.35);
      ctx.drawArrays(ctx.LINES, 0, g.outlineCount);
    }

    const clip = !cut ? [0, 0, 0, -1] : cut.axis === "x" ? [1, 0, 0, -cut.at] : cut.axis === "y" ? [0, 1, 0, -cut.at] : [0, 0, 1, -cut.at];

    // The echo as points.
    if (g.pointCount) {
      ctx.disable(ctx.BLEND);
      ctx.useProgram(g.points);
      const pu = (n: string) => ctx.getUniformLocation(g.points, n);
      ctx.uniformMatrix4fv(pu("u_mvp"), false, mvp);
      ctx.uniform1f(pu("u_exag"), s.exaggeration);
      ctx.uniform1f(pu("u_ground"), z0);
      ctx.uniform1f(pu("u_pxPerKm"), (c.height / 2) / Math.tan(FOV / 2));
      ctx.uniform4f(pu("u_clip"), clip[0]!, clip[1]!, clip[2]!, clip[3]!);
      ctx.bindVertexArray(g.pointVao);
      ctx.drawArrays(ctx.POINTS, 0, g.pointCount);
    }

    // The shells: solid ones first, then see-through ones without hiding each other, back faces outermost first
    // and front faces innermost first (nested shells then blend in the order they're met).
    const shells = s.surfaces.filter((x) => g.meshes.get(x.mesh)?.count);
    if (shells.length) {
      ctx.useProgram(g.mesh);
      const mu = (n: string) => ctx.getUniformLocation(g.mesh, n);
      ctx.uniformMatrix4fv(mu("u_mvp"), false, mvp);
      ctx.uniform1f(mu("u_exag"), s.exaggeration);
      ctx.uniform1f(mu("u_ground"), z0);
      ctx.uniform3f(mu("u_eye"), eye[0]!, eye[1]!, eye[2]!);
      ctx.uniform4f(mu("u_clip"), clip[0]!, clip[1]!, clip[2]!, clip[3]!);
      // Over the viewer's right shoulder.
      const toEye = [eye[0]! - k.target[0], eye[1]! - k.target[1], eye[2]! - k.target[2]].map((v) => v / k.dist);
      const light = [toEye[0]! + Math.cos(k.yaw) * 0.45, toEye[1]! + Math.sin(k.yaw) * 0.45, toEye[2]! + 0.8];
      const ll = Math.hypot(light[0]!, light[1]!, light[2]!);
      ctx.uniform3f(mu("u_light"), light[0]! / ll, light[1]! / ll, light[2]! / ll);
      const drawShell = (x: SceneSurface, alpha: number) => {
        const m = g.meshes.get(x.mesh)!;
        ctx.uniform4f(mu("u_color"), x.color[0], x.color[1], x.color[2], alpha);
        ctx.bindVertexArray(m.vao);
        ctx.drawElements(ctx.TRIANGLES, m.count, ctx.UNSIGNED_INT, 0);
      };
      ctx.disable(ctx.BLEND);
      for (const x of shells) if (x.opacity >= 0.99) drawShell(x, 1);
      const clear = shells.filter((x) => x.opacity < 0.99).sort((a, b) => a.order - b.order);
      if (clear.length) {
        ctx.enable(ctx.BLEND);
        ctx.depthMask(false);
        ctx.enable(ctx.CULL_FACE);
        ctx.cullFace(ctx.FRONT);
        for (const x of clear) drawShell(x, x.opacity);
        ctx.cullFace(ctx.BACK);
        for (const x of [...clear].reverse()) drawShell(x, x.opacity);
        ctx.disable(ctx.CULL_FACE);
        ctx.depthMask(true);
      }
    }

    // Level sheets last, see-through, without hiding what's behind them.
    if (s.levels.length) {
      ctx.useProgram(g.lines);
      ctx.bindVertexArray(g.lineVao);
      ctx.enable(ctx.BLEND);
      ctx.depthMask(false);
      s.levels.forEach((l, i) => {
        ctx.uniform4f(lu("u_color"), l.color[0], l.color[1], l.color[2], l.color[3]);
        ctx.drawArrays(ctx.TRIANGLES, cutEnd + i * 6, 6);
      });
      ctx.depthMask(true);
    }
    ctx.bindVertexArray(null);

    // Labels.
    const g2 = o.getContext("2d")!;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, w, h);
    g2.font = "11px system-ui, sans-serif";
    g2.textBaseline = "middle";
    const halo = s.dark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)";
    const text = (l: VolumeLabel) => {
      const q = project(l.at);
      if (!q) return;
      g2.textAlign = l.align ?? "left";
      const x = q[0] + (l.dx ?? 0);
      const y = q[1] + (l.dy ?? 0);
      g2.lineWidth = 3;
      g2.strokeStyle = halo;
      g2.strokeText(l.text, x, y);
      g2.fillStyle = l.color ?? (s.dark ? "#cbd5e1" : "#334155");
      g2.fillText(l.text, x, y);
    };
    const dim = s.dark ? "#7c8798" : "#7a8494";
    for (const t of s.ticks) text({ at: [ax, ay, t.km], text: t.label, align: "right", dx: -6 });
    text({ at: [ax, ay, s.top], text: s.axisUnit, align: "right", dx: -6, dy: -12 });
    for (const t of s.ticks2) text({ at: [ax, ay, t.km], text: t.label, align: "left", dx: 6, color: dim });
    text({ at: [ax, ay, s.top], text: s.axisUnit2, align: "left", dx: 6, dy: -12, color: dim });
    for (const l of s.levels) text({ at: [ax, ay, l.km], text: l.label, color: `rgba(${l.color.slice(0, 3).map((v) => Math.round(v * 255)).join(",")},1)`, dx: 36 });
    text({ at: [0, R, z0], text: "N", align: "center", dy: -10, color: s.dark ? "#f8fafc" : "#0f172a" });
    for (const l of s.labels) text(l);

    // A north arrow, the way north points on screen from the middle of the ground.
    const a = project([0, 0, z0]);
    const b = project([0, R * 0.25, z0]);
    let nx = 0;
    let ny = -1;
    if (a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1) {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      nx = (b[0] - a[0]) / l;
      ny = (b[1] - a[1]) / l;
    }
    const cx = 26;
    const cy = h - 26;
    g2.lineWidth = 1;
    g2.strokeStyle = s.dark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.3)";
    g2.fillStyle = s.dark ? "rgba(2,6,12,0.55)" : "rgba(255,255,255,0.7)";
    g2.beginPath();
    g2.arc(cx, cy, 16, 0, Math.PI * 2);
    g2.fill();
    g2.stroke();
    g2.fillStyle = s.dark ? "#f8fafc" : "#0f172a";
    g2.beginPath();
    g2.moveTo(cx + nx * 12, cy + ny * 12);
    g2.lineTo(cx - ny * 5 - nx * 6, cy + nx * 5 - ny * 6);
    g2.lineTo(cx - nx * 2, cy - ny * 2);
    g2.lineTo(cx + ny * 5 - nx * 6, cy - nx * 5 - ny * 6);
    g2.closePath();
    g2.fill();
    g2.font = "bold 10px system-ui, sans-serif";
    g2.textAlign = "center";
    g2.lineWidth = 3;
    g2.strokeStyle = halo;
    g2.strokeText("N", cx + nx * 24, cy + ny * 24);
    g2.fillText("N", cx + nx * 24, cy + ny * 24);
  }, []);

  const request = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // WebGL set-up (again after a lost context comes back).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const init = () => {
      const ctx = c.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
      if (!ctx) {
        setFailed(true);
        return;
      }
      // This canvas's context was let go (an unmount React then undid): a new canvas gets a new one. Once, not in a loop.
      if (ctx.isContextLost()) {
        if (!renewed.current) setCanvasKey((k) => k + 1);
        renewed.current = true;
        return;
      }
      renewed.current = false;
      const points = program(ctx, POINT_VS, POINT_FS);
      const lines = program(ctx, LINE_VS, LINE_FS);
      const mesh = program(ctx, MESH_VS, MESH_FS);
      const pointVao = ctx.createVertexArray()!;
      const pointBufs = [ctx.createBuffer()!, ctx.createBuffer()!, ctx.createBuffer()!];
      ctx.bindVertexArray(pointVao);
      const attr = (prog: WebGLProgram, name: string, buf: WebGLBuffer, size: number, type: number) => attribute(ctx, prog, name, buf, size, type);
      attr(points, "a_pos", pointBufs[0]!, 3, ctx.FLOAT);
      attr(points, "a_color", pointBufs[1]!, 3, ctx.UNSIGNED_BYTE);
      attr(points, "a_size", pointBufs[2]!, 1, ctx.FLOAT);
      const lineVao = ctx.createVertexArray()!;
      const lineBuf = ctx.createBuffer()!;
      ctx.bindVertexArray(lineVao);
      attr(lines, "a_pos", lineBuf, 3, ctx.FLOAT);
      const outlineVao = ctx.createVertexArray()!;
      const outlineBuf = ctx.createBuffer()!;
      ctx.bindVertexArray(outlineVao);
      attr(lines, "a_pos", outlineBuf, 3, ctx.FLOAT);
      ctx.bindVertexArray(null);
      gl.current = { ctx, points, lines, mesh, pointVao, pointBufs, pointCount: 0, lineVao, lineBuf, outlineVao, outlineBuf, outlineCount: 0, meshes: new Map() };
      upload("all");
      request();
    };
    /** Each shell's buffers, made as shells arrive and freed as they go. */
    const uploadMeshes = (g: NonNullable<typeof gl.current>) => {
      const { ctx } = g;
      const wanted = new Set(sceneRef.current.surfaces.map((x) => x.mesh));
      for (const [m, b] of g.meshes) {
        if (wanted.has(m)) continue;
        ctx.deleteVertexArray(b.vao);
        for (const x of b.bufs) ctx.deleteBuffer(x);
        g.meshes.delete(m);
      }
      for (const m of wanted) {
        if (g.meshes.has(m)) continue;
        const vao = ctx.createVertexArray()!;
        const bufs = [ctx.createBuffer()!, ctx.createBuffer()!, ctx.createBuffer()!];
        ctx.bindVertexArray(vao);
        attribute(ctx, g.mesh, "a_pos", bufs[0]!, 3, ctx.FLOAT);
        ctx.bufferData(ctx.ARRAY_BUFFER, m.positions, ctx.STATIC_DRAW);
        attribute(ctx, g.mesh, "a_normal", bufs[1]!, 3, ctx.FLOAT);
        ctx.bufferData(ctx.ARRAY_BUFFER, m.normals, ctx.STATIC_DRAW);
        ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, bufs[2]!);
        ctx.bufferData(ctx.ELEMENT_ARRAY_BUFFER, m.indices, ctx.STATIC_DRAW);
        ctx.bindVertexArray(null);
        g.meshes.set(m, { vao, bufs, count: m.indices.length });
      }
    };
    const upload = (what: "points" | "meshes" | "outlines" | "all") => {
      const g = gl.current;
      if (!g) return;
      const { ctx } = g;
      if (what === "points" || what === "all") {
        const p = sceneRef.current.points;
        ctx.bindBuffer(ctx.ARRAY_BUFFER, g.pointBufs[0]!);
        ctx.bufferData(ctx.ARRAY_BUFFER, p ? p.positions.subarray(0, p.count * 3) : new Float32Array(0), ctx.STATIC_DRAW);
        ctx.bindBuffer(ctx.ARRAY_BUFFER, g.pointBufs[1]!);
        ctx.bufferData(ctx.ARRAY_BUFFER, p ? p.colors.subarray(0, p.count * 3) : new Uint8Array(0), ctx.STATIC_DRAW);
        ctx.bindBuffer(ctx.ARRAY_BUFFER, g.pointBufs[2]!);
        ctx.bufferData(ctx.ARRAY_BUFFER, p ? p.sizes.subarray(0, p.count) : new Float32Array(0), ctx.STATIC_DRAW);
        g.pointCount = p?.count ?? 0;
      }
      if (what === "outlines" || what === "all") {
        const l = sceneRef.current.outlines;
        ctx.bindBuffer(ctx.ARRAY_BUFFER, g.outlineBuf);
        ctx.bufferData(ctx.ARRAY_BUFFER, l ?? new Float32Array(0), ctx.STATIC_DRAW);
        g.outlineCount = l ? l.length / 3 : 0;
      }
      if (what === "meshes" || what === "all") uploadMeshes(g);
    };
    uploadRef.current = upload;
    const lost = (e: Event) => {
      e.preventDefault();
      gl.current = null;
    };
    c.addEventListener("webglcontextlost", lost);
    c.addEventListener("webglcontextrestored", init);
    try {
      init();
    } catch (err) {
      console.error("[volume] WebGL set-up failed:", err);
      setFailed(true);
    }
    return () => {
      c.removeEventListener("webglcontextlost", lost);
      c.removeEventListener("webglcontextrestored", init);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      const g = gl.current;
      gl.current = null;
      if (!g || g.ctx.isContextLost()) return;
      const { ctx } = g;
      ctx.deleteProgram(g.points);
      ctx.deleteProgram(g.lines);
      ctx.deleteProgram(g.mesh);
      ctx.deleteVertexArray(g.pointVao);
      ctx.deleteVertexArray(g.lineVao);
      ctx.deleteVertexArray(g.outlineVao);
      for (const b of [...g.pointBufs, g.lineBuf, g.outlineBuf]) ctx.deleteBuffer(b);
      for (const m of g.meshes.values()) {
        ctx.deleteVertexArray(m.vao);
        for (const b of m.bufs) ctx.deleteBuffer(b);
      }
      // Gone for good: let the context go now, not whenever the canvas is collected (browsers keep only a
      // handful, and the map panels need theirs). Not on a remount (React runs effects twice in development):
      // the canvas is still in the page then, and gets the same context back.
      if (!c.isConnected) ctx.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [request, canvasKey]);

  // New points, shells or map lines: upload them; anything else: just draw again. A new height scale keeps the view,
  // its centre raised or lowered with the heights.
  const prev = useRef<VolumeScene | null>(null);
  useEffect(() => {
    const was = prev.current;
    sceneRef.current = scene;
    prev.current = scene;
    if (scene.points !== was?.points) uploadRef.current("points");
    if (scene.outlines !== was?.outlines) uploadRef.current("outlines");
    if (scene.surfaces.length !== was?.surfaces.length || scene.surfaces.some((x, i) => x.mesh !== was.surfaces[i]!.mesh)) uploadRef.current("meshes");
    if (was && was.exaggeration !== scene.exaggeration) {
      const k = cam.current;
      k.target = [k.target[0], k.target[1], scene.ground + ((k.target[2] - scene.ground) * scene.exaggeration) / was.exaggeration];
    }
    request();
  }, [scene, request]);

  // A new circle size re-frames the view.
  useEffect(() => {
    cam.current = defaultCamera(sceneRef.current);
    request();
  }, [scene.radiusKm, request]);

  const zoomBy = (f: number) => {
    const k = cam.current;
    const R = sceneRef.current.radiusKm;
    k.dist = Math.min(R * 10, Math.max(R * 0.25, k.dist * f));
  };

  useImperativeHandle(ref, () => ({
    reset: () => {
      cam.current = defaultCamera(sceneRef.current);
      request();
    },
    zoom: (f) => {
      zoomBy(f);
      request();
    },
    snapshot: (caption) => {
      const c = canvas.current;
      const o = overlay.current;
      if (!c || !o || !gl.current) return Promise.resolve(null);
      // Drawn now, so the picture is this moment's.
      draw();
      const out = document.createElement("canvas");
      out.width = c.width;
      out.height = c.height;
      const g2 = out.getContext("2d")!;
      g2.drawImage(c, 0, 0);
      g2.drawImage(o, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      g2.font = `${11 * dpr}px system-ui, sans-serif`;
      g2.textAlign = "right";
      g2.textBaseline = "bottom";
      g2.lineWidth = 3 * dpr;
      const dark = sceneRef.current.dark;
      g2.strokeStyle = dark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)";
      g2.fillStyle = dark ? "#cbd5e1" : "#334155";
      g2.strokeText(caption, out.width - 8 * dpr, out.height - 6 * dpr);
      g2.fillText(caption, out.width - 8 * dpr, out.height - 6 * dpr);
      return new Promise((resolve) => out.toBlob(resolve, "image/png"));
    },
  }));

  // Keep the canvas at its element's size.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(request);
    ro.observe(el);
    return () => ro.disconnect();
  }, [request]);

  // Orbit, pan and zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number } | null>(null);
  const panBy = (dx: number, dy: number) => {
    const k = cam.current;
    const s = (k.dist / (canvas.current?.clientHeight || 500)) * 2 * Math.tan(FOV / 2);
    const right = [Math.cos(k.yaw), Math.sin(k.yaw)];
    const fwd = [-Math.sin(k.yaw), Math.cos(k.yaw)];
    k.target = [k.target[0] - (right[0]! * dx - fwd[0]! * dy) * s, k.target[1] - (right[1]! * dx - fwd[1]! * dy) * s, k.target[2]];
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 };
    }
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mx = (a!.x + b!.x) / 2;
      const my = (a!.y + b!.y) / 2;
      zoomBy(pinch.current.d / (d || 1));
      panBy(mx - pinch.current.mx, my - pinch.current.my);
      pinch.current = { d, mx, my };
    } else {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (e.buttons === 2 || e.shiftKey) panBy(dx, dy);
      else {
        const k = cam.current;
        k.yaw -= dx * 0.008;
        k.pitch = Math.min(1.5, Math.max(0.03, k.pitch + dy * 0.006));
      }
    }
    request();
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  // A wheel listener that can preventDefault (React's is passive).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = cam.current;
      const R = sceneRef.current.radiusKm;
      k.dist = Math.min(R * 10, Math.max(R * 0.25, k.dist * Math.exp(e.deltaY * 0.0015)));
      request();
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, [request, canvasKey]);
  const onKey = (e: React.KeyboardEvent) => {
    const k = cam.current;
    if (e.key === "ArrowLeft") k.yaw += 0.08;
    else if (e.key === "ArrowRight") k.yaw -= 0.08;
    else if (e.key === "ArrowUp") k.pitch = Math.min(1.5, k.pitch + 0.06);
    else if (e.key === "ArrowDown") k.pitch = Math.max(0.03, k.pitch - 0.06);
    else if (e.key === "+" || e.key === "=") zoomBy(0.85);
    else if (e.key === "-") zoomBy(1 / 0.85);
    else if (e.key === "0") cam.current = defaultCamera(sceneRef.current);
    else return;
    // The view's keys, not the workspace's: the arrows mustn't also step and pause the loop.
    e.preventDefault();
    e.stopPropagation();
    request();
  };

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <canvas
        key={canvasKey}
        ref={canvas}
        role="img"
        aria-label={label}
        tabIndex={0}
        className="absolute inset-0 size-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => {
          cam.current = defaultCamera(sceneRef.current);
          request();
        }}
        onKeyDown={onKey}
      />
      <canvas ref={overlay} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
      {failed && <p className="absolute inset-x-3 bottom-3 rounded-[4px] bg-surface-1/90 px-2 py-1.5 text-[12px] text-ink-2">{unsupported}</p>}
    </div>
  );
});
