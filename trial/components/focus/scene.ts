"use client";

import * as THREE from "three";
import { focus } from "@/lib/client/focus";
import { headTracker } from "@/lib/client/head-tracker";
import { buildHead } from "@/lib/rewind/head";
import { FOCUS_SPEAKERS } from "@/lib/shared/focus";

/**
 * The Focus room in three.js: you, from behind, with three people talking
 * around you. Your head turns with the tracker (the shoulders stay, the neck
 * twists), each speaker's jaw moves with their own voice, sound flows from
 * each mouth to you as bright as that voice is loud, and a beam shows where
 * your attention points. Amber marks the voice that is forward, and the
 * beam when it is locked.
 */

const PAPER = new THREE.Vector3(1, 1, 0.976);
const AMBER = new THREE.Vector3(1, 0.761, 0.294);

/** Scene units from you to each speaker (the head is about 2.3 tall). */
const ROOM = 5.4;
const SPEAKER_SCALE = 0.92;
const EARS = new THREE.Vector3(0, 0.2, 0);

const BUST_VERT = /* glsl */ `
attribute float aJaw;
attribute float aSeed;
uniform float uHeadYaw;
uniform float uTalk;
uniform float uFocus;
uniform float uDim;
uniform float uIntro;
uniform float uPixel;
uniform float uTime;
uniform vec3 uPaper;
uniform vec3 uAmber;
varying float vAlpha;
varying vec3 vColor;

vec3 turnY(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

void main() {
  vec3 p = position;
  // The mouth opens with the voice.
  p.y -= 0.09 * aJaw * uTalk;
  p.z -= 0.02 * aJaw * uTalk;
  // The head turns on the neck; the shoulders stay.
  float w = smoothstep(-1.05, -0.45, position.y);
  vec3 pivot = vec3(0.0, 0.0, -0.18);
  p = turnY(p - pivot, uHeadYaw * w) + pivot;
  vec3 nrm = turnY(normal, uHeadYaw * w);

  float intro = clamp(uIntro * 1.5 - aSeed * 0.5, 0.0, 1.0);
  p += nrm * (1.0 - intro) * (0.5 + 2.0 * aSeed);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 n = normalize(normalMatrix * nrm);
  vec3 toEye = normalize(-mv.xyz);
  float facing = dot(n, toEye);
  float key = max(dot(n, normalize(vec3(-0.4, 0.6, 0.65))), 0.0);
  float rim = pow(1.0 - max(facing, 0.0), 2.2);
  float lit = 0.1 + 0.75 * key * key + 0.9 * rim;
  float scan = 0.8 + 0.2 * smoothstep(0.6, 1.0, sin(position.y * 92.0 + uTime * 0.6));
  float bust = smoothstep(-2.15, -0.95, position.y);

  vColor = mix(uPaper, uAmber, uFocus * (0.3 + 0.7 * rim));
  vAlpha = lit * scan * (0.3 + 0.3 * uFocus) * uDim * intro * bust * mix(0.05, 1.0, smoothstep(-0.12, 0.35, facing));
  gl_PointSize = uPixel * (0.85 + 0.55 * aSeed) * (6.0 / -mv.z);
}
`;

const STREAM_VERT = /* glsl */ `
attribute float aT;
attribute float aSpeed;
attribute vec2 aJitter;
uniform vec3 uFrom;
uniform vec3 uBend;
uniform vec3 uTo;
uniform float uFlow;
uniform float uLevel;
uniform float uGain;
uniform float uFocus;
uniform float uPixel;
uniform vec3 uPaper;
uniform vec3 uAmber;
varying float vAlpha;
varying vec3 vColor;

void main() {
  float t = fract(aT + uFlow * aSpeed);
  vec3 p = mix(mix(uFrom, uBend, t), mix(uBend, uTo, t), t);
  p += vec3(aJitter.x, aJitter.y, aJitter.x * 0.5) * sin(t * 3.14159) * 0.32;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.82, 1.0, t));
  vAlpha = fade * (0.06 + 0.95 * uLevel) * (0.12 + 0.88 * uGain);
  vColor = mix(uPaper, uAmber, uFocus);
  gl_PointSize = uPixel * (0.55 + 0.55 * aSpeed) * (6.0 / -mv.z);
}
`;

const BEAM_VERT = /* glsl */ `
attribute float aD;
uniform float uYaw;
uniform float uLock;
uniform float uShow;
uniform float uTime;
uniform float uPixel;
uniform vec3 uPaper;
uniform vec3 uAmber;
varying float vAlpha;
varying vec3 vColor;

void main() {
  float d = 1.0 + aD * 3.6;
  vec3 p = vec3(sin(uYaw) * d, 0.35 - aD * 0.35, -cos(uYaw) * d);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float pulse = 0.5 + 0.5 * sin(aD * 18.0 - uTime * 5.0);
  vAlpha = uShow * (1.0 - aD) * (0.18 + 0.3 * pulse + 0.5 * uLock);
  vColor = mix(uPaper, uAmber, uLock);
  gl_PointSize = uPixel * (1.3 + 1.2 * uLock) * (6.0 / -mv.z);
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

function material(vertexShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const approach = (cur: number, to: number, dt: number, rate: number) => cur + (to - cur) * (1 - Math.exp(-dt * rate));

export interface FocusSceneOptions {
  reducedMotion: boolean;
  /** One label element per speaker, moved over their head each frame. */
  labels: (HTMLElement | null)[];
}

/** Mounts the room into host; throws when WebGL is unavailable. Returns cleanup. */
export function mountFocusScene(host: HTMLElement, opts: FocusSceneOptions): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "pan-y";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);

  // One cloud of points for every figure; the speakers draw a uniform subset.
  const small = Math.min(window.innerWidth, window.innerHeight) < 640;
  const cloud = buildHead(small ? 14000 : 26000);
  const attrs = {
    position: new THREE.BufferAttribute(cloud.positions, 3),
    normal: new THREE.BufferAttribute(cloud.normals, 3),
    aJaw: new THREE.BufferAttribute(cloud.jaw, 1),
    aSeed: new THREE.BufferAttribute(cloud.seed, 1),
  };
  const geometry = (count: number) => {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(attrs)) g.setAttribute(name, a);
    g.setDrawRange(0, count);
    return g;
  };
  const youGeo = geometry(cloud.count);
  const speakerGeo = geometry(Math.round(cloud.count * 0.55));

  const bustUniforms = (focusAmount: number) => ({
    uHeadYaw: { value: 0 },
    uTalk: { value: 0 },
    uFocus: { value: focusAmount },
    uDim: { value: 1 },
    uIntro: { value: opts.reducedMotion ? 1 : 0 },
    uPixel: { value: 1 },
    uTime: { value: 0 },
    uPaper: { value: PAPER },
    uAmber: { value: AMBER },
  });

  // You: in the middle of the room, facing away from the camera.
  const youU = bustUniforms(0);
  const you = new THREE.Points(youGeo, material(BUST_VERT, youU));
  you.frustumCulled = false;
  you.rotation.y = Math.PI;
  scene.add(you);

  // The three speakers, each turned toward you.
  const speakers = FOCUS_SPEAKERS.map((s) => {
    const a = (s.azimuth * Math.PI) / 180;
    const u = bustUniforms(0);
    const p = new THREE.Points(speakerGeo, material(BUST_VERT, u));
    p.frustumCulled = false;
    p.position.set(Math.sin(a) * ROOM, -0.15, -Math.cos(a) * ROOM);
    p.rotation.y = -a;
    p.scale.setScalar(SPEAKER_SCALE);
    scene.add(p);
    const mouth = p.position.clone().add(new THREE.Vector3(-Math.sin(a) * 0.9, -0.15, Math.cos(a) * 0.9));
    const top = p.position.clone().add(new THREE.Vector3(0, 1.95 * SPEAKER_SCALE, 0));
    return { u, points: p, mouth, top, talk: 0, gain: 0, focus: 0 };
  });

  // Sound on its way from each mouth to you.
  const perStream = small ? 140 : 260;
  const streams = speakers.map((sp, i) => {
    const t = new Float32Array(perStream);
    const speed = new Float32Array(perStream);
    const jitter = new Float32Array(perStream * 2);
    let seed = 97 + i * 31;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < perStream; k++) {
      t[k] = rnd();
      speed[k] = 0.6 + rnd() * 0.8;
      jitter[k * 2] = rnd() * 2 - 1;
      jitter[k * 2 + 1] = rnd() * 2 - 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(perStream * 3), 3));
    g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    g.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
    g.setAttribute("aJitter", new THREE.BufferAttribute(jitter, 2));
    const bend = sp.mouth.clone().lerp(EARS, 0.5).add(new THREE.Vector3(0, 0.7, 0));
    const u = {
      uFrom: { value: sp.mouth },
      uBend: { value: bend },
      uTo: { value: EARS },
      uFlow: { value: 0 },
      uLevel: { value: 0 },
      uGain: { value: 0 },
      uFocus: { value: 0 },
      uPixel: { value: 1 },
      uPaper: { value: PAPER },
      uAmber: { value: AMBER },
    };
    const points = new THREE.Points(g, material(STREAM_VERT, u));
    points.frustumCulled = false;
    scene.add(points);
    return { u, points, flow: 0 };
  });

  // Where your attention points.
  const beamDots = 56;
  const beamD = new Float32Array(beamDots);
  for (let k = 0; k < beamDots; k++) beamD[k] = k / (beamDots - 1);
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(beamDots * 3), 3));
  beamGeo.setAttribute("aD", new THREE.BufferAttribute(beamD, 1));
  const beamU = {
    uYaw: { value: 0 },
    uLock: { value: 0 },
    uShow: { value: 0 },
    uTime: { value: 0 },
    uPixel: { value: 1 },
    uPaper: { value: PAPER },
    uAmber: { value: AMBER },
  };
  const beam = new THREE.Points(beamGeo, material(BEAM_VERT, beamU));
  beam.frustumCulled = false;
  scene.add(beam);

  // Framing: from behind and above you, pulled back until every speaker,
  // their shoulders and the label over their head fit, whatever the stage's
  // shape.
  const look = new THREE.Vector3(0, -0.1, -2.7);
  const offset = new THREE.Vector3(0, 4.4, 6.4);
  const sides = speakers.flatMap((sp) => {
    const side = new THREE.Vector3(Math.cos(sp.points.rotation.y), 0, Math.sin(sp.points.rotation.y)).multiplyScalar(1.25);
    return [sp.points.position.clone().add(side), sp.points.position.clone().sub(side)];
  });
  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    camera.aspect = w / h;
    // The highest a head may sit, in device coordinates, with its label inside.
    const labelHeight = Math.max(40, ...opts.labels.map((l) => l?.offsetHeight ?? 0));
    const headroom = 1 - (2 * (labelHeight + 10)) / h;
    for (let scale = 0.9; scale < 4; scale += 0.03) {
      camera.position.copy(look).addScaledVector(offset, scale);
      camera.lookAt(look);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      if (
        sides.every((p) => Math.abs(p.clone().project(camera).x) < 0.92) &&
        speakers.every((sp) => sp.top.clone().project(camera).y < headroom)
      ) break;
    }
    renderer.setSize(w, h, false);
    const px = renderer.getPixelRatio() * (h / 640) * 1.7;
    for (const m of [youU, ...speakers.map((s) => s.u), ...streams.map((s) => s.u), beamU]) m.uPixel.value = px;
  };
  fit();
  const resize = new ResizeObserver(fit);
  resize.observe(host);
  for (const l of opts.labels) if (l) resize.observe(l);

  // Dragging the scene turns your head, when the pointer is what steers.
  let dragX: number | null = null;
  const onDown = (e: PointerEvent) => {
    dragX = e.clientX;
  };
  const onMove = (e: PointerEvent) => {
    if (dragX === null) return;
    headTracker.nudge((e.clientX - dragX) * 0.3);
    dragX = e.clientX;
  };
  const onUp = () => (dragX = null);
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
  io.observe(host);

  const tmp = new THREE.Vector3();
  let raf = 0;
  let last = performance.now();
  let lock = 0;
  let show = 0;
  let beamYaw = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const v = focus.view.get();
    const playing = v.phase === "playing";
    const time = now / 1000;
    const yaw = (headTracker.angle * Math.PI) / 180;

    youU.uTime.value = time;
    youU.uIntro.value = Math.min(1, youU.uIntro.value + dt / 1.6);
    youU.uHeadYaw.value = -yaw;

    speakers.forEach((sp, i) => {
      const gainDb = v.gainsDb[i] ?? -Infinity;
      const gain = playing && Number.isFinite(gainDb) ? Math.min(1, 10 ** (gainDb / 20)) : 0;
      sp.gain = approach(sp.gain, gain, dt, 8);
      sp.talk = approach(sp.talk, playing ? focus.level(i) : 0, dt, 18);
      sp.focus = approach(sp.focus, v.attended === i ? 1 : 0, dt, 6);
      sp.u.uTime.value = time;
      sp.u.uIntro.value = youU.uIntro.value;
      sp.u.uTalk.value = sp.talk;
      sp.u.uFocus.value = sp.focus;
      sp.u.uDim.value = playing ? 0.45 + 0.55 * sp.gain : 0.55;
      sp.u.uHeadYaw.value = opts.reducedMotion ? 0 : Math.sin(time * 0.7 + i * 2.1) * 0.08 * (0.3 + sp.talk);

      const st = streams[i]!;
      st.flow += dt * (0.25 + sp.talk * 0.35) * (opts.reducedMotion ? 0.5 : 1);
      st.u.uFlow.value = st.flow;
      st.u.uLevel.value = sp.talk;
      st.u.uGain.value = sp.gain;
      st.u.uFocus.value = sp.focus;

      const label = opts.labels[i];
      if (label) {
        tmp.copy(sp.top).project(camera);
        // Over the head, but never past the stage's edges.
        const half = label.offsetWidth / 2 + 10;
        const x = Math.min(host.clientWidth - half, Math.max(half, (tmp.x * 0.5 + 0.5) * host.clientWidth));
        const y = (-tmp.y * 0.5 + 0.5) * host.clientHeight;
        label.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    });

    lock = approach(lock, v.locked !== null ? 1 : 0, dt, 8);
    show = approach(show, playing ? 1 : 0, dt, 4);
    // Locked, the beam holds on that person wherever the head goes.
    const lockedSpeaker = v.locked !== null ? FOCUS_SPEAKERS[v.locked] : undefined;
    beamYaw = approach(beamYaw, lockedSpeaker ? (lockedSpeaker.azimuth * Math.PI) / 180 : yaw, dt, 10);
    beamU.uYaw.value = beamYaw;
    beamU.uLock.value = lock;
    beamU.uShow.value = show;
    beamU.uTime.value = time;

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    io.disconnect();
    canvas.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    for (const o of [you, ...speakers.map((s) => s.points), ...streams.map((s) => s.points), beam]) {
      (o.material as THREE.Material).dispose();
    }
    for (const g of [youGeo, speakerGeo, beamGeo, ...streams.map((s) => s.points.geometry)]) g.dispose();
    renderer.dispose();
    canvas.remove();
  };
}
