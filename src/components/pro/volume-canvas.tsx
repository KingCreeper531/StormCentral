"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
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
void main() {
  vec4 c = u_mvp * vec4(a_pos.xy, u_ground + (a_pos.z - u_ground) * u_exag, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(a_size * u_pxPerKm / c.w, 1.5, 40.0);
  v_color = a_color / 255.0;
}`;

// Square points with a slightly darker rim read as solid blocks of echo.
const POINT_FS = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 o;
void main() {
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
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
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

export interface VolumeScene {
  points: VolumePoints | null;
  radiusKm: number;
  exaggeration: number;
  /** Ground level for the grid and the exaggeration (km above sea level). */
  ground: number;
  /** Top of the height axis (km above sea level). */
  top: number;
  /** Height-axis ticks (km above sea level). */
  ticks: { km: number; label: string }[];
  /** The height axis's unit ("kft", "km"). */
  axisUnit: string;
  /** Horizontal levels to draw as sheets: the freezing level, −20 °C. */
  levels: { km: number; color: [number, number, number, number]; label: string }[];
  labels: VolumeLabel[];
  dark: boolean;
}

export interface VolumeCanvasHandle {
  reset: () => void;
}

interface Camera {
  yaw: number;
  pitch: number;
  dist: number;
  target: [number, number, number];
}

const FOV = (40 * Math.PI) / 180;
const defaultCamera = (s: VolumeScene): Camera => ({
  yaw: 0.35,
  pitch: 0.42,
  dist: s.radiusKm * 3,
  target: [0, 0, s.ground + ((s.top - s.ground) * s.exaggeration) / 3],
});

/**
 * The 3D volume (lib/pro/volume3d) drawn with WebGL 2: echo as gate-sized
 * blocks, a ground grid with the circle, a height axis and level sheets, with
 * labels on a 2D layer above. Drag to orbit, right-drag or Shift-drag to pan,
 * wheel or pinch to zoom, double-click to reset; arrows, + and − on the
 * keyboard.
 */
export const VolumeCanvas = forwardRef<VolumeCanvasHandle, { scene: VolumeScene; label: string; className?: string }>(function VolumeCanvas({ scene, label, className }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  const cam = useRef<Camera>(defaultCamera(scene));
  const frame = useRef(0);
  /** Sends the scene's points to the GPU (set once WebGL is up). */
  const uploadRef = useRef<() => void>(() => {});
  const gl = useRef<{
    ctx: WebGL2RenderingContext;
    points: WebGLProgram;
    lines: WebGLProgram;
    pointVao: WebGLVertexArrayObject;
    pointBufs: WebGLBuffer[];
    pointCount: number;
    lineVao: WebGLVertexArrayObject;
    lineBuf: WebGLBuffer;
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

    // Ground grid, circle, axis and ticks.
    const R = s.radiusKm;
    const z0 = s.ground;
    const step = R > 80 ? 20 : 10;
    const lines: number[] = [];
    const seg = (a: number[], b: number[]) => lines.push(...a, ...b);
    for (let v = -Math.floor(R / step) * step; v <= R + 1e-6; v += step) {
      seg([v, -R, z0], [v, R, z0]);
      seg([-R, v, z0], [R, v, z0]);
    }
    const grid = lines.length / 3;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const b = ((i + 1) / 96) * Math.PI * 2;
      seg([R * Math.sin(a), R * Math.cos(a), z0], [R * Math.sin(b), R * Math.cos(b), z0]);
    }
    seg([ax, ay, z0], [ax, ay, s.top]);
    for (const t of s.ticks) seg([ax, ay, t.km], [ax + tick, ay, t.km]);
    const marks = lines.length / 3;
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
    ctx.uniform4f(lu("u_color"), ink[0]!, ink[1]!, ink[2]!, 0.12);
    ctx.enable(ctx.BLEND);
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);
    ctx.drawArrays(ctx.LINES, 0, grid);
    ctx.uniform4f(lu("u_color"), ink[0]!, ink[1]!, ink[2]!, 0.45);
    ctx.drawArrays(ctx.LINES, grid, marks - grid);

    // The echo.
    if (g.pointCount) {
      ctx.disable(ctx.BLEND);
      ctx.useProgram(g.points);
      const pu = (n: string) => ctx.getUniformLocation(g.points, n);
      ctx.uniformMatrix4fv(pu("u_mvp"), false, mvp);
      ctx.uniform1f(pu("u_exag"), s.exaggeration);
      ctx.uniform1f(pu("u_ground"), z0);
      ctx.uniform1f(pu("u_pxPerKm"), (c.height / 2) / Math.tan(FOV / 2));
      ctx.bindVertexArray(g.pointVao);
      ctx.drawArrays(ctx.POINTS, 0, g.pointCount);
    }

    // Level sheets last, see-through, without hiding what's behind them.
    if (s.levels.length) {
      ctx.useProgram(g.lines);
      ctx.bindVertexArray(g.lineVao);
      ctx.enable(ctx.BLEND);
      ctx.depthMask(false);
      s.levels.forEach((l, i) => {
        ctx.uniform4f(lu("u_color"), l.color[0], l.color[1], l.color[2], l.color[3]);
        ctx.drawArrays(ctx.TRIANGLES, marks + i * 6, 6);
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
    const text = (l: VolumeLabel) => {
      const q = project(l.at);
      if (!q) return;
      g2.textAlign = l.align ?? "left";
      const x = q[0] + (l.dx ?? 0);
      const y = q[1] + (l.dy ?? 0);
      g2.lineWidth = 3;
      g2.strokeStyle = s.dark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)";
      g2.strokeText(l.text, x, y);
      g2.fillStyle = l.color ?? (s.dark ? "#cbd5e1" : "#334155");
      g2.fillText(l.text, x, y);
    };
    for (const t of s.ticks) text({ at: [ax, ay, t.km], text: t.label, align: "right", dx: -6 });
    text({ at: [ax, ay, s.top], text: s.axisUnit, align: "right", dx: -6, dy: -12 });
    for (const l of s.levels) text({ at: [ax, ay, l.km], text: l.label, color: `rgba(${l.color.slice(0, 3).map((v) => Math.round(v * 255)).join(",")},1)`, dx: 10 });
    text({ at: [0, R, z0], text: "N", align: "center", dy: -10, color: s.dark ? "#f8fafc" : "#0f172a" });
    for (const l of s.labels) text(l);
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
      if (!ctx) return;
      const points = program(ctx, POINT_VS, POINT_FS);
      const lines = program(ctx, LINE_VS, LINE_FS);
      const pointVao = ctx.createVertexArray()!;
      const pointBufs = [ctx.createBuffer()!, ctx.createBuffer()!, ctx.createBuffer()!];
      ctx.bindVertexArray(pointVao);
      const attr = (prog: WebGLProgram, name: string, buf: WebGLBuffer, size: number, type: number, normalized = false) => {
        const loc = ctx.getAttribLocation(prog, name);
        ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
        ctx.enableVertexAttribArray(loc);
        ctx.vertexAttribPointer(loc, size, type, normalized, 0, 0);
      };
      attr(points, "a_pos", pointBufs[0]!, 3, ctx.FLOAT);
      attr(points, "a_color", pointBufs[1]!, 3, ctx.UNSIGNED_BYTE);
      attr(points, "a_size", pointBufs[2]!, 1, ctx.FLOAT);
      const lineVao = ctx.createVertexArray()!;
      const lineBuf = ctx.createBuffer()!;
      ctx.bindVertexArray(lineVao);
      attr(lines, "a_pos", lineBuf, 3, ctx.FLOAT);
      ctx.bindVertexArray(null);
      gl.current = { ctx, points, lines, pointVao, pointBufs, pointCount: 0, lineVao, lineBuf };
      upload();
      request();
    };
    const upload = () => {
      const g = gl.current;
      const p = sceneRef.current.points;
      if (!g) return;
      const { ctx } = g;
      ctx.bindBuffer(ctx.ARRAY_BUFFER, g.pointBufs[0]!);
      ctx.bufferData(ctx.ARRAY_BUFFER, p ? p.positions.subarray(0, p.count * 3) : new Float32Array(0), ctx.STATIC_DRAW);
      ctx.bindBuffer(ctx.ARRAY_BUFFER, g.pointBufs[1]!);
      ctx.bufferData(ctx.ARRAY_BUFFER, p ? p.colors.subarray(0, p.count * 3) : new Uint8Array(0), ctx.STATIC_DRAW);
      ctx.bindBuffer(ctx.ARRAY_BUFFER, g.pointBufs[2]!);
      ctx.bufferData(ctx.ARRAY_BUFFER, p ? p.sizes.subarray(0, p.count) : new Float32Array(0), ctx.STATIC_DRAW);
      g.pointCount = p?.count ?? 0;
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
    }
    return () => {
      c.removeEventListener("webglcontextlost", lost);
      c.removeEventListener("webglcontextrestored", init);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      // Not lost on purpose: a remount (React runs effects twice in development) gets the same context back.
      gl.current = null;
    };
  }, [request]);

  // New points: upload them; anything else: just draw again.
  const prevPoints = useRef<VolumePoints | null>(null);
  useEffect(() => {
    sceneRef.current = scene;
    if (scene.points !== prevPoints.current) {
      prevPoints.current = scene.points;
      uploadRef.current();
    }
    request();
  }, [scene, request]);

  // A new circle size or height scale re-frames the view.
  const frameKey = `${scene.radiusKm}|${scene.exaggeration}`;
  useEffect(() => {
    cam.current = defaultCamera(sceneRef.current);
    request();
  }, [frameKey, request]);

  useImperativeHandle(ref, () => ({
    reset: () => {
      cam.current = defaultCamera(sceneRef.current);
      request();
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
  const zoomBy = (f: number) => {
    const k = cam.current;
    const R = sceneRef.current.radiusKm;
    k.dist = Math.min(R * 10, Math.max(R * 0.25, k.dist * f));
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
      zoomBy(Math.exp(e.deltaY * 0.0015));
      request();
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, [request]);
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
    e.preventDefault();
    request();
  };

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <canvas
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
    </div>
  );
});
