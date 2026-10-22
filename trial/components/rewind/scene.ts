"use client";

import * as THREE from "three";
import { CLENCH_MS, REWIND_MS, rewind } from "@/lib/client/rewind";
import { buildHead, EARBUD, MASSETER } from "@/lib/rewind/head";
import { REWIND_BUFFER_SEC } from "@/lib/shared/constants";

/**
 * The Rewind figure in three.js: the bust as glowing points, sound flowing
 * into the earbud, a ring of the last 30 seconds around the head, and the
 * clench signal travelling from the jaw muscle to the earbud. Everything is
 * driven by rewind.view and rewind.level() each frame, outside React.
 *
 * Colors follow the brand: paper for the figure, amber only for what is live
 * or attended (the earbud while listening, the clench, the rewound seconds).
 */

// sRGB values written straight to the screen (no color management in these shaders).
const PAPER = new THREE.Vector3(1, 1, 0.976);
const MIST = new THREE.Vector3(0.706, 0.706, 0.725);
const AMBER = new THREE.Vector3(1, 0.761, 0.294);

// Close to a profile from the earbud's side: the face reads in silhouette,
// and the ear and the jaw, where everything happens, face the camera.
const TARGET = new THREE.Vector3(0.1, -0.08, 0.25);
const VIEW_DIR = new THREE.Vector3(4.6, 0.5, 2.0).normalize();

const HEAD_VERT = /* glsl */ `
attribute float aJaw;
attribute float aMasseter;
attribute float aSeed;
uniform float uTime;
uniform float uClench;
uniform float uSweep;
uniform float uActive;
uniform float uLevel;
uniform float uIntro;
uniform float uPixel;
uniform vec3 uEar;
uniform vec3 uPaper;
uniform vec3 uAmber;
varying float vAlpha;
varying vec3 vColor;

void main() {
  vec3 p = position;
  // The clench: the lower jaw lifts and draws back, the masseter swells.
  p.y += 0.06 * aJaw * uClench;
  p.z -= 0.014 * aJaw * uClench;
  p += normal * 0.06 * aMasseter * uClench;

  // Materialize: each point arrives from out along its normal.
  float intro = clamp(uIntro * 1.5 - aSeed * 0.5, 0.0, 1.0);
  p += normal * (1.0 - intro) * (0.5 + 2.2 * aSeed);

  // The rewind sweep: a bright band running backward around the head.
  float ang = atan(position.x, position.z) / 6.2831853 + 0.5;
  float sweep = fract(ang + uSweep * 2.0);
  float band = uSweep > 0.0 && uSweep < 1.0 ? smoothstep(0.09, 0.0, abs(sweep - 0.5)) : 0.0;
  p += normal * 0.045 * band;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  vec3 n = normalize(normalMatrix * normal);
  vec3 toEye = normalize(-mv.xyz);
  float facing = dot(n, toEye);
  float key = max(dot(n, normalize(vec3(-0.75, 0.45, 0.55))), 0.0);
  float rim = pow(1.0 - max(facing, 0.0), 2.2);
  float lit = 0.1 + 0.78 * key * key + 0.9 * rim;
  // Fine horizontal striations, like a scan.
  float scan = 0.78 + 0.22 * smoothstep(0.6, 1.0, sin(position.y * 92.0 + uTime * 0.6));
  float nearEar = exp(-dot(position - uEar, position - uEar) / 0.16);
  float bust = smoothstep(-2.15, -0.95, position.y);

  float glow = aMasseter * uClench;
  vColor = mix(uPaper, uAmber, clamp(glow * 1.6 + nearEar * uActive * uLevel * 0.3, 0.0, 1.0));
  vAlpha = lit * scan * (0.3 + 0.18 * uActive) + nearEar * uLevel * uActive * 0.4 + band * 0.9 + glow * 1.3;
  vAlpha *= intro * bust * mix(0.05, 1.0, smoothstep(-0.12, 0.35, facing));
  gl_PointSize = uPixel * (0.85 + 0.55 * aSeed) * (1.0 + 0.45 * glow + 0.5 * band) * (6.0 / -mv.z);
}
`;

const POINT_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, smoothstep(0.5, 0.08, d) * vAlpha);
}
`;

const FLOW_VERT = /* glsl */ `
attribute vec4 aOrbit;
attribute float aPhase;
uniform float uFlow;
uniform float uShow;
uniform float uLevel;
uniform float uWarm;
uniform float uPixel;
uniform vec3 uEar;
uniform vec3 uPaper;
uniform vec3 uAmber;
varying float vAlpha;
varying vec3 vColor;

void main() {
  // Each particle spirals in from the room to the earbud; a negative flow
  // runs it back out.
  float u = fract(aPhase + uFlow * aOrbit.w);
  float e = u * u * (3.0 - 2.0 * u);
  float ang = aOrbit.x + e * 1.25;
  float rad = aOrbit.y * (1.0 - e);
  vec3 p = uEar + vec3(cos(ang) * rad, aOrbit.z * (1.0 - e), sin(ang) * rad);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = smoothstep(0.0, 0.25, u) * (1.0 - smoothstep(0.7, 0.96, u));
  vAlpha = fade * uShow * (0.22 + 0.6 * uLevel);
  vColor = mix(uPaper, uAmber, uWarm * smoothstep(0.35, 1.0, u));
  gl_PointSize = uPixel * (0.45 + aOrbit.w * 0.45) * (6.0 / -mv.z);
}
`;

const RING_VERT = /* glsl */ `
attribute float aIndex;
uniform float uFilled;
uniform float uSelect;
uniform float uShowSel;
uniform float uHead;
uniform float uShowHead;
uniform float uActive;
uniform float uPixel;
uniform vec3 uPaper;
uniform vec3 uMist;
uniform vec3 uAmber;
varying float vAlpha;
varying vec3 vColor;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // aIndex runs from the oldest kept second (0) to now (1).
  float kept = step(1.0 - uFilled, aIndex) * uActive;
  float sel = step(1.0 - uSelect, aIndex) * uShowSel;
  float head = exp(-pow((aIndex - uHead) / 0.012, 2.0)) * uShowHead;
  vColor = mix(mix(uMist, uPaper, kept), uAmber, max(sel, head));
  vAlpha = 0.12 + 0.34 * kept + 0.55 * sel + 1.4 * head;
  gl_PointSize = uPixel * (1.6 + 4.5 * head + 0.8 * sel) * (6.0 / -mv.z);
}
`;

const SIGNAL_VERT = /* glsl */ `
attribute float aT;
uniform float uPulse;
uniform float uShow;
uniform float uPixel;
varying float vAlpha;
varying vec3 vColor;
uniform vec3 uAmber;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float pulse = exp(-pow((aT - uPulse) / 0.09, 2.0));
  vAlpha = uShow * (0.22 + 1.4 * pulse);
  vColor = uAmber;
  gl_PointSize = uPixel * (1.7 + 3.4 * pulse) * (6.0 / -mv.z);
}
`;

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const approach = (cur: number, to: number, dt: number, rate: number) => cur + (to - cur) * (1 - Math.exp(-dt * rate));

function pointsMaterial(vertexShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export interface SceneOptions {
  reducedMotion: boolean;
  /** Gets the time readout ("-12.4 s"), updated in place each frame. */
  timeLabel: HTMLElement | null;
  secondsUnit: string;
}

/** Mounts the scene into host; throws when WebGL is unavailable. Returns cleanup. */
export function mountRewindScene(host: HTMLElement, opts: SceneOptions): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
  const figure = new THREE.Group();
  scene.add(figure);
  const ear = new THREE.Vector3(...EARBUD);

  // The bust.
  const small = Math.min(window.innerWidth, window.innerHeight) < 640;
  const head = buildHead(small ? 15000 : 30000);
  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute("position", new THREE.BufferAttribute(head.positions, 3));
  headGeo.setAttribute("normal", new THREE.BufferAttribute(head.normals, 3));
  headGeo.setAttribute("aJaw", new THREE.BufferAttribute(head.jaw, 1));
  headGeo.setAttribute("aMasseter", new THREE.BufferAttribute(head.masseter, 1));
  headGeo.setAttribute("aSeed", new THREE.BufferAttribute(head.seed, 1));
  const headU = {
    uTime: { value: 0 },
    uClench: { value: 0 },
    uSweep: { value: 0 },
    uActive: { value: 0 },
    uLevel: { value: 0 },
    uIntro: { value: opts.reducedMotion ? 1 : 0 },
    uPixel: { value: 1 },
    uEar: { value: ear },
    uPaper: { value: PAPER },
    uAmber: { value: AMBER },
  };
  const headPoints = new THREE.Points(headGeo, pointsMaterial(HEAD_VERT, headU));
  headPoints.frustumCulled = false;
  figure.add(headPoints);

  // Sound on its way into the earbud.
  const flowCount = small ? 600 : 1100;
  const orbit = new Float32Array(flowCount * 4);
  const phase = new Float32Array(flowCount);
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < flowCount; i++) {
    orbit.set([-1.25 + rnd() * 1.8, 1.1 + rnd() * 2.4, (rnd() - 0.5) * 2.8, 0.55 + rnd() * 0.9], i * 4);
    phase[i] = rnd();
  }
  const flowGeo = new THREE.BufferGeometry();
  flowGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(flowCount * 3), 3));
  flowGeo.setAttribute("aOrbit", new THREE.BufferAttribute(orbit, 4));
  flowGeo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  const flowU = {
    uFlow: { value: 0 },
    uShow: { value: 0 },
    uLevel: { value: 0 },
    uWarm: { value: 0 },
    uPixel: { value: 1 },
    uEar: { value: ear },
    uPaper: { value: PAPER },
    uAmber: { value: AMBER },
  };
  const flow = new THREE.Points(flowGeo, pointsMaterial(FLOW_VERT, flowU));
  flow.frustumCulled = false;
  figure.add(flow);

  // The last 30 seconds as a clock face around the head, turned to the
  // viewer: oldest just past six o'clock, running clockwise to now just
  // before it. A rewind runs the hand back.
  const ringDots = REWIND_BUFFER_SEC * 6;
  const ringPos = new Float32Array(ringDots * 3);
  const ringIdx = new Float32Array(ringDots);
  const right = new THREE.Vector3().crossVectors(VIEW_DIR.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, VIEW_DIR.clone().negate()).normalize();
  const centre = new THREE.Vector3(0.05, 0.36, 0.04);
  for (let i = 0; i < ringDots; i++) {
    const t = i / (ringDots - 1);
    const a = Math.PI * (195 / 180) + t * Math.PI * (330 / 180);
    const p = centre.clone().addScaledVector(right, Math.sin(a) * 1.34).addScaledVector(up, Math.cos(a) * 1.34);
    ringPos.set(p.toArray(), i * 3);
    ringIdx[i] = t;
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
  ringGeo.setAttribute("aIndex", new THREE.BufferAttribute(ringIdx, 1));
  const ringU = {
    uFilled: { value: 0 },
    uSelect: { value: 0.5 },
    uShowSel: { value: 0 },
    uHead: { value: 1 },
    uShowHead: { value: 0 },
    uActive: { value: 0 },
    uPixel: { value: 1 },
    uPaper: { value: PAPER },
    uMist: { value: MIST },
    uAmber: { value: AMBER },
  };
  const ring = new THREE.Points(ringGeo, pointsMaterial(RING_VERT, ringU));
  ring.frustumCulled = false;
  scene.add(ring);

  // The clench signal: from the masseter to the earbud, bowing outward.
  const sigDots = 44;
  const sigPos = new Float32Array(sigDots * 3);
  const sigT = new Float32Array(sigDots);
  const from = new THREE.Vector3(...MASSETER).add(new THREE.Vector3(0.12, 0, 0.02));
  const to = ear.clone().add(new THREE.Vector3(0.05, 0, 0.03));
  const bow = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0.12, -0.02, -0.34));
  const curve = new THREE.QuadraticBezierCurve3(from, bow, to);
  for (let i = 0; i < sigDots; i++) {
    const t = i / (sigDots - 1);
    sigPos.set(curve.getPoint(t).toArray(), i * 3);
    sigT[i] = t;
  }
  const sigGeo = new THREE.BufferGeometry();
  sigGeo.setAttribute("position", new THREE.BufferAttribute(sigPos, 3));
  sigGeo.setAttribute("aT", new THREE.BufferAttribute(sigT, 1));
  const sigU = { uPulse: { value: -1 }, uShow: { value: 0 }, uPixel: { value: 1 }, uAmber: { value: AMBER } };
  const signal = new THREE.Points(sigGeo, pointsMaterial(SIGNAL_VERT, sigU));
  signal.frustumCulled = false;
  figure.add(signal);

  // The earbud: a small solid body and its glow.
  const budMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#b4b4b9"), transparent: true, opacity: 0.9 });
  const bud = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.05, 6, 12), budMat);
  bud.position.copy(ear).add(new THREE.Vector3(0.03, -0.01, 0.03));
  bud.rotation.set(0.15, 0.4, 0.5);
  figure.add(bud);
  const glowTex = glowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: new THREE.Color("#ffc24b"),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.position.copy(bud.position);
  glow.scale.setScalar(0.7);
  figure.add(glow);
  const muscleMat = glowMat.clone();
  const muscle = new THREE.Sprite(muscleMat);
  muscle.position.set(MASSETER[0] + 0.1, MASSETER[1], MASSETER[2]);
  muscle.scale.set(0.62, 0.8, 1);
  figure.add(muscle);

  // Framing: the head and shoulders, whatever the stage's shape.
  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    camera.aspect = w / h;
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const dist = Math.max(3.8 / 2 / Math.tan(half), 3.2 / 2 / (Math.tan(half) * camera.aspect));
    camera.position.copy(TARGET).addScaledVector(VIEW_DIR, dist);
    camera.lookAt(TARGET);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const px = renderer.getPixelRatio() * (h / 640) * (6.0 / dist) * 1.9;
    headU.uPixel.value = px;
    flowU.uPixel.value = px;
    ringU.uPixel.value = px;
    sigU.uPixel.value = px;
  };
  fit();
  const resize = new ResizeObserver(fit);
  resize.observe(host);

  // Pointer parallax.
  let pointerX = 0;
  let pointerY = 0;
  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointerX = clamp01((e.clientX - r.left) / r.width) * 2 - 1;
    pointerY = clamp01((e.clientY - r.top) / r.height) * 2 - 1;
  };
  if (!opts.reducedMotion) window.addEventListener("pointermove", onPointer, { passive: true });

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
  io.observe(host);

  let raf = 0;
  let last = performance.now();
  let flowT = 0;
  let level = 0;
  let yaw = 0;
  let pitch = 0;
  let active = 0;
  let show = 0;
  let warm = 0;
  let clenchAt = -1e9;
  let seenPhaseAt = 0;
  let lastLabel = "";

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const v = rewind.view.get();
    const t = now - v.phaseAt;
    if (v.phase === "clench" && v.phaseAt !== seenPhaseAt) clenchAt = v.phaseAt;
    seenPhaseAt = v.phaseAt;
    const live = v.phase !== "off" && v.phase !== "starting";
    const rewinding = v.phase === "rewinding";
    const replaying = v.phase === "replaying";
    const narrating = v.phase === "narrating";

    level = approach(level, rewind.level(), dt, 14);
    active = approach(active, live ? 1 : 0, dt, 4);
    headU.uTime.value = now / 1000;
    headU.uIntro.value = Math.min(1, headU.uIntro.value + dt / 1.6);
    headU.uActive.value = active;
    headU.uLevel.value = level;

    // The clench: up fast, a short hold, then let go as the rewind starts.
    const ct = now - clenchAt;
    headU.uClench.value = ct < 0 ? 0 : ct < 110 ? ct / 110 : ct < 430 ? 1 : Math.max(0, 1 - (ct - 430) / 320);
    sigU.uShow.value = ct < 900 ? 1 - clamp01((ct - 600) / 300) : 0;
    sigU.uPulse.value = clamp01((ct - 60) / 380);
    const flash = ct > 440 && ct < 1100 ? 1 - (ct - 440) / 660 : 0;

    headU.uSweep.value = rewinding ? clamp01(t / REWIND_MS) : 0;

    const sel = (v.clipSeconds || v.seconds) / REWIND_BUFFER_SEC;
    ringU.uActive.value = active;
    ringU.uFilled.value = approach(ringU.uFilled.value, v.buffered / REWIND_BUFFER_SEC, dt, 6);
    ringU.uSelect.value = sel;
    const inRewind = v.phase === "clench" || rewinding || replaying || narrating;
    ringU.uShowSel.value = approach(ringU.uShowSel.value, inRewind ? 1 : 0, dt, 8);
    let headPos = 1;
    let secondsBack = 0;
    if (rewinding) {
      const r = ease(clamp01(t / REWIND_MS));
      headPos = 1 - sel * r;
      secondsBack = (v.clipSeconds || v.seconds) * r;
    } else if (replaying) {
      const r = clamp01(t / Math.max(1, v.clipSeconds * 1000));
      headPos = 1 - sel * (1 - r);
      secondsBack = v.clipSeconds * (1 - r);
    }
    ringU.uHead.value = headPos;
    ringU.uShowHead.value = approach(ringU.uShowHead.value, live && !narrating ? 1 : 0, dt, 8);

    // Sound flows in while listening, races back out during the rewind,
    // and pours in, warm, while the seconds replay.
    const speed = rewinding ? -0.95 : replaying ? 0.3 + level * 0.5 : narrating ? 0.22 : live ? 0.12 + level * 0.25 : 0.04;
    flowT += dt * speed * (opts.reducedMotion ? 0.5 : 1);
    flowU.uFlow.value = flowT;
    show = approach(show, rewinding ? 1 : replaying ? 0.9 : narrating ? 0.45 : live ? 0.6 : 0, dt, 5);
    flowU.uShow.value = show;
    flowU.uLevel.value = level;
    warm = approach(warm, replaying || narrating ? 1 : 0, dt, 5);
    flowU.uWarm.value = warm;

    // The earbud is amber while it listens; brighter with what it plays.
    budMat.color.set(live ? "#ffc24b" : "#b4b4b9");
    glowMat.opacity = active * (0.24 + level * 0.5) + flash * 1.1;
    muscleMat.opacity = headU.uClench.value * 0.55;
    glow.scale.setScalar(0.36 + level * 0.22 + flash * 0.55);

    // A slow idle turn, and the figure leaning toward the pointer.
    const idle = opts.reducedMotion ? 0 : Math.sin(now / 2600) * 0.07;
    yaw = approach(yaw, idle + pointerX * 0.16, dt, 3);
    pitch = approach(pitch, pointerY * 0.05, dt, 3);
    figure.rotation.y = yaw;
    figure.rotation.x = pitch;
    if (!opts.reducedMotion) figure.position.y = Math.sin(now / 1900) * 0.012;

    if (opts.timeLabel) {
      const label = rewinding || replaying ? `-${secondsBack.toFixed(1)} ${opts.secondsUnit}` : "";
      if (label !== lastLabel) {
        opts.timeLabel.textContent = label;
        lastLabel = label;
      }
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    io.disconnect();
    window.removeEventListener("pointermove", onPointer);
    for (const o of [headPoints, flow, ring, signal]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    bud.geometry.dispose();
    budMat.dispose();
    glowMat.dispose();
    muscleMat.dispose();
    glowTex.dispose();
    renderer.dispose();
    canvas.remove();
  };
}
