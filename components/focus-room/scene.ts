import { createHeadCloud } from "./head";

/**
 * The room behind the hero, drawn with plain WebGL: you, from behind, with
 * three people talking around you. The same scene as the web trial's Focus
 * screen (trial/components/focus/scene.ts), without three.js, which would
 * cost the landing page most of its script budget. Your head turns toward
 * the voice you attend to, each speaker's mouth moves with their voice,
 * sound flows from each mouth to you as bright as you hear it, and a beam
 * shows where your attention points. Amber marks the voice that is forward,
 * and the beam while a replay speaks.
 *
 * The canvas covers the whole hero and has no edges of its own: the room is
 * composed into a rectangle of it (the layout's slot for it), and anything
 * that strays outside that rectangle is simply drawn there.
 *
 * The shaders are kept terse because their text ships as is.
 */

const PAPER = [1, 1, 0.976];
const AMBER = [1, 0.761, 0.294];

/** Scene units from you to each speaker (the head is about 2.3 tall). */
const ROOM = 5.4;
const SPEAKER_SCALE = 0.92;
const EARS = [0, 0.2, 0];
const FOV = 48;

/** What every point shader shares: the matrices (uMV model-view, uP projection), size, brightness and colours. */
const HEAD = `uniform mat4 uMV;
uniform mat4 uP;
uniform float uPixel;
uniform float uBright;
uniform vec3 uPaper;
uniform vec3 uAmber;
varying float vAlpha;
varying vec3 vColor;
`;

/**
 * A bust: the mouth opens with the voice, the head turns on the neck while
 * the shoulders stay, points fly in along their normals on entrance, and
 * the light is a key from the upper left plus a rim that turns amber as the
 * speaker comes forward. uN is the normal matrix.
 */
const BUST = `attribute vec3 position;
attribute vec3 normal;
attribute float aJaw;
attribute float aSeed;
uniform mat3 uN;
uniform float uHeadYaw,uTalk,uFocus,uDim,uIntro,uTime;
vec3 turnY(vec3 v,float a){float c=cos(a),s=sin(a);return vec3(v.x*c+v.z*s,v.y,-v.x*s+v.z*c);}
void main(){
vec3 p=position;
p.y-=.09*aJaw*uTalk;
p.z-=.02*aJaw*uTalk;
float w=smoothstep(-1.05,-.45,position.y);
vec3 pivot=vec3(0.,0.,-.18);
p=turnY(p-pivot,uHeadYaw*w)+pivot;
vec3 nrm=turnY(normal,uHeadYaw*w);
float intro=clamp(uIntro*1.5-aSeed*.5,0.,1.);
p+=nrm*(1.-intro)*(.5+2.*aSeed);
vec4 mv=uMV*vec4(p,1.);
gl_Position=uP*mv;
vec3 n=normalize(uN*nrm);
float facing=dot(n,normalize(-mv.xyz));
float key=max(dot(n,normalize(vec3(-.4,.6,.65))),0.);
float rim=pow(1.-max(facing,0.),2.2);
float scan=.8+.2*smoothstep(.6,1.,sin(position.y*92.+uTime*.6));
vColor=mix(uPaper,uAmber,uFocus*(.3+.7*rim));
vAlpha=uBright*(.1+.75*key*key+.9*rim)*scan*(.42+.36*uFocus)*uDim*intro*smoothstep(-2.15,-.95,position.y)*mix(.05,1.,smoothstep(-.12,.35,facing));
gl_PointSize=uPixel*(.95+.6*aSeed)*(6./-mv.z);
}`;

/** Sound in the air: points on a curve from a mouth to your ears, as bright as the voice and as you hear it. */
const STREAM = `attribute float aT;
attribute float aSpeed;
attribute vec2 aJitter;
uniform vec3 uFrom,uBend,uTo;
uniform float uFlow,uLevel,uGain,uFocus;
void main(){
float t=fract(aT+uFlow*aSpeed);
vec3 p=mix(mix(uFrom,uBend,t),mix(uBend,uTo,t),t)+vec3(aJitter.x,aJitter.y,aJitter.x*.5)*sin(t*3.14159)*.32;
vec4 mv=uMV*vec4(p,1.);
gl_Position=uP*mv;
vAlpha=uBright*smoothstep(0.,.12,t)*(1.-smoothstep(.82,1.,t))*(.06+.95*uLevel)*(.12+.88*uGain);
vColor=mix(uPaper,uAmber,uFocus);
gl_PointSize=uPixel*(.55+.55*aSpeed)*(6./-mv.z);
}`;

/** Where your attention points: a pulsing line of dots from your head, amber and steady while a replay speaks. */
const BEAM = `attribute float aD;
uniform float uYaw,uLock,uShow,uTime;
void main(){
float d=1.+aD*3.6;
vec4 mv=uMV*vec4(sin(uYaw)*d,.35-aD*.35,-cos(uYaw)*d,1.);
gl_Position=uP*mv;
vAlpha=uShow*(1.-aD)*(.33+.15*sin(aD*18.-uTime*5.)+.5*uLock);
vColor=mix(uPaper,uAmber,uLock);
gl_PointSize=uPixel*(1.3+1.2*uLock)*(6./-mv.z);
}`;

/** A soft round point. */
const FRAG = `precision mediump float;
varying float vAlpha;
varying vec3 vColor;
void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vColor,smoothstep(.5,.08,d)*vAlpha);}`;

/* ---- A little linear algebra (column-major, like WebGL) ----------------- */

type Vec3 = readonly number[];
type Mat4 = Float32Array;

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** Translate, then turn about y (right-handed, as three.js does), then scale. */
function model(pos: Vec3, rotY: number, scale: number): Mat4 {
  const c = Math.cos(rotY) * scale;
  const s = Math.sin(rotY) * scale;
  return new Float32Array([c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, pos[0], pos[1], pos[2], 1]);
}

function lookAt(eye: Vec3, target: Vec3): Mat4 {
  const zl = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
  const zx = (eye[0] - target[0]) / zl;
  const zy = (eye[1] - target[1]) / zl;
  const zz = (eye[2] - target[2]) / zl;
  // x = up (0, 1, 0) cross z, then y = z cross x.
  const xl = Math.hypot(zz, zx);
  const xx = zz / xl;
  const xz = -zx / xl;
  const yx = zy * xz;
  const yy = zz * xx - zx * xz;
  const yz = -zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    0, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

/** Near 0.1, far 120. */
function perspective(aspect: number): Mat4 {
  const f = 1 / Math.tan((FOV * Math.PI) / 360);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -120.1 / 119.9, -1, 0, 0, -24 / 119.9, 0]);
}

/** Clip space, then normalised device coordinates. */
function project(m: Mat4, p: Vec3): [number, number] {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w];
}

/* ---- The room ------------------------------------------------------------ */

/** Each speaker stands ROOM away at their azimuth, turned toward you. */
function placeSpeakers(azimuths: readonly number[]) {
  return azimuths.map((deg) => {
    const a = (deg * Math.PI) / 180;
    const pos = [Math.sin(a) * ROOM, -0.15, -Math.cos(a) * ROOM];
    return {
      model: model(pos, -a, SPEAKER_SCALE),
      mouth: [pos[0] - Math.sin(a) * 0.9, pos[1] - 0.15, pos[2] + Math.cos(a) * 0.9],
      top: [pos[0], pos[1] + 1.95 * SPEAKER_SCALE, pos[2]],
      pos,
      rot: -a,
    };
  });
}

export interface RoomFrame {
  /** CSS pixels relative to the canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Room to leave above each speaker's head for their label, CSS pixels. */
  labelHeight: number;
  /** The frame spans the page: the outer shoulders may run a little off its sides. */
  bleed?: boolean;
}

export interface RoomCamera {
  width: number;
  height: number;
  view: Mat4;
  proj: Mat4;
  /** Point size per CSS pixel of the frame's height. */
  pixel: number;
  /** How much brighter each point is drawn: a small room has smaller points, which read faint. */
  bright: number;
  /** The top of each speaker's head, CSS pixels on the canvas: where their label goes. */
  anchors: { x: number; y: number }[];
}

/**
 * Framing: from behind and above you, pulled back until every speaker, the
 * room for their label and their shoulders fit the frame; then the frame's
 * view is placed where the frame sits on the canvas. Pure, so the labels can
 * be placed even where WebGL is not available.
 */
export function frameRoom(azimuths: readonly number[], width: number, height: number, frame: RoomFrame): RoomCamera {
  const cssW = Math.max(1, width);
  const cssH = Math.max(1, height);
  const fw = Math.max(1, frame.w);
  const fh = Math.max(1, frame.h);
  const speakers = placeSpeakers(azimuths);
  const base = perspective(fw / fh);
  // The highest a head may sit (device coordinates) with its label still inside.
  const label = (2 * (frame.labelHeight + 8)) / fh;
  // Spanning a phone, the outer shoulders may run a little off its sides, so
  // the people are not shrunk to fit; beside copy, they stay inside.
  const sides = frame.bleed ? 1.1 : 0.94;
  let view = base;
  let m = base;
  for (let scale = 0.9; scale < 4; scale += 0.03) {
    view = lookAt([0, -0.1 + 4.4 * scale, -2.7 + 6.4 * scale], [0, -0.1, -2.7]);
    m = multiply(base, view);
    const fits = speakers.every((sp) => {
      // Their shoulders: the speaker's own x axis, either way.
      const sx = Math.cos(sp.rot) * 1.4;
      const sz = -Math.sin(sp.rot) * 1.4;
      return (
        project(m, sp.top)[1] < 1 - label &&
        Math.abs(project(m, [sp.pos[0] + sx, sp.pos[1], sp.pos[2] + sz])[0]) < sides &&
        Math.abs(project(m, [sp.pos[0] - sx, sp.pos[1], sp.pos[2] - sz])[0]) < sides
      );
    });
    if (fits) break;
  }
  // Whatever height is left over (the people did not need it all) is shared
  // above the labels and under your shoulders, so the room sits centred;
  // spanning a phone, it all goes underneath, so the people sit up under
  // the controls.
  const top = Math.max(...speakers.map((sp) => project(m, sp.top)[1])) + label;
  const bottom = project(m, [0, -1.75, 0.2])[1];
  const lift = top >= 1 ? 0 : frame.bleed ? 1 - top : bottom > -1 ? (1 - top - (bottom + 1)) / 2 : 0;
  // Then the frame's view goes where the frame sits on the canvas.
  const place = new Float32Array(16);
  place[0] = fw / cssW;
  place[5] = fh / cssH;
  place[10] = 1;
  place[15] = 1;
  place[12] = ((frame.x + fw / 2) / cssW) * 2 - 1;
  place[13] = 1 - ((frame.y + fh / 2) / cssH) * 2 + (lift * fh) / cssH;
  const proj = multiply(place, base);
  const viewProj = multiply(proj, view);
  return {
    width: cssW,
    height: cssH,
    view,
    proj,
    // Never so small that the points fade to nothing on a phone.
    pixel: Math.max(1.3, (fh / 640) * 1.7),
    bright: Math.min(3.4, Math.max(1, (700 / fh) ** 2)),
    anchors: speakers.map((sp) => {
      const [x, y] = project(viewProj, sp.top);
      return { x: (x * 0.5 + 0.5) * cssW, y: (-y * 0.5 + 0.5) * cssH };
    }),
  };
}

export interface RoomFrameState {
  /** Where your head points, degrees, right positive. */
  yaw: number;
  /** Where the beam points: the speaker being replayed, else your head. */
  beamYaw: number;
  /** A replay is speaking: the beam turns amber. */
  replaying: boolean;
  /** Per speaker, 0..1: how loud the voice is right now, and how loud you hear it. */
  levels: readonly number[];
  gains: readonly number[];
  /** Per speaker, 0..1: how far forward. */
  focus: readonly number[];
  /** Holds the figures' entrance (the page's own intro is still playing). */
  hold?: boolean;
}

export interface Room {
  /** Recomputes the camera for a canvas size and a slot within it. */
  layout(width: number, height: number, frame: RoomFrame): void;
  /** Where each speaker's label goes (the top of their head), CSS pixels on the canvas. */
  anchors(): { x: number; y: number }[];
  render(state: RoomFrameState, dt: number, time: number): void;
  dispose(): void;
}

const approach = (cur: number, to: number, dt: number, rate: number) => cur + (to - cur) * (1 - Math.exp(-dt * rate));

/** Mounts the room on a canvas; throws when WebGL is unavailable. */
export function createRoom(canvas: HTMLCanvasElement, azimuths: readonly number[], opts: { small: boolean; reducedMotion: boolean }): Room {
  const gl = canvas.getContext("webgl", { antialias: false, powerPreference: "high-performance" });
  if (!gl) throw new Error("webgl");
  const F = gl.FLOAT;

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
    return sh;
  };
  const frag = compile(gl.FRAGMENT_SHADER, FRAG);
  /** A program, its uniforms by name and its attributes by name. */
  const program = (vert: string, attrs: string[]) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, HEAD + vert));
    gl.attachShader(p, frag);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
    const cache: Record<string, WebGLUniformLocation | null> = {};
    const u = (name: string) => (name in cache ? cache[name] : (cache[name] = gl.getUniformLocation(p, name)));
    return { p, u, a: attrs.map((n) => gl.getAttribLocation(p, n)) };
  };
  const bust = program(BUST, ["position", "normal", "aJaw", "aSeed"]);
  const stream = program(STREAM, ["aT", "aSpeed", "aJitter"]);
  const beam = program(BEAM, ["aD"]);

  const buffer = (data: Float32Array) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  };
  const bind = (loc: number, b: WebGLBuffer, size: number) => {
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, F, false, 0, 0);
  };

  // One cloud for every figure, filled in a few milliseconds a frame; the
  // speakers draw its first part, which is itself an even, sparser cloud.
  const cloud = createHeadCloud(opts.small ? 14000 : 16000);
  const speakerShare = Math.round(cloud.capacity * 0.55);
  const cloudData = [cloud.positions, cloud.normals, cloud.jaw, cloud.seed];
  const cloudSizes = [3, 3, 1, 1];
  // Sized for the whole cloud now (still zeros), filled in as it grows.
  const cloudBuffers = cloudData.map(buffer);
  let uploaded = 0;
  let full = false;
  const grow = () => {
    if (full) return;
    full = cloud.grow(opts.small ? 5 : 4);
    const to = cloud.count;
    if (to === uploaded) return;
    cloudBuffers.forEach((b, k) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferSubData(gl.ARRAY_BUFFER, uploaded * cloudSizes[k] * 4, cloudData[k].subarray(uploaded * cloudSizes[k], to * cloudSizes[k]));
    });
    uploaded = to;
  };

  const speakers = placeSpeakers(azimuths);
  const you = model([0, 0, 0], Math.PI, 1);

  // Sound on its way from each mouth to you: one buffer, a range per speaker.
  const perStream = opts.small ? 140 : 260;
  const n = perStream * speakers.length;
  const t = new Float32Array(n);
  const speed = new Float32Array(n);
  const jitter = new Float32Array(n * 2);
  speakers.forEach((_, i) => {
    let seed = 97 + i * 31;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = i * perStream; k < (i + 1) * perStream; k++) {
      t[k] = rnd();
      speed[k] = 0.6 + rnd() * 0.8;
      jitter[k * 2] = rnd() * 2 - 1;
      jitter[k * 2 + 1] = rnd() * 2 - 1;
    }
  });
  const streamBuffers = [buffer(t), buffer(speed), buffer(jitter)];
  const bends = speakers.map((sp) => [(sp.mouth[0] + EARS[0]) / 2, (sp.mouth[1] + EARS[1]) / 2 + 0.7, (sp.mouth[2] + EARS[2]) / 2]);

  // Where your attention points.
  const beamDots = 56;
  const beamBuffer = buffer(Float32Array.from({ length: beamDots }, (_, k) => k / (beamDots - 1)));

  let camera = frameRoom(azimuths, 1, 1, { x: 0, y: 0, w: 1, h: 1, labelHeight: 0 });
  let dpr = 1;

  const begin = (prog: ReturnType<typeof program>, mv: Mat4) => {
    gl.useProgram(prog.p);
    gl.uniform3fv(prog.u("uPaper"), PAPER);
    gl.uniform3fv(prog.u("uAmber"), AMBER);
    gl.uniform1f(prog.u("uPixel"), camera.pixel * dpr);
    gl.uniform1f(prog.u("uBright"), camera.bright);
    gl.uniformMatrix4fv(prog.u("uP"), false, camera.proj);
    gl.uniformMatrix4fv(prog.u("uMV"), false, mv);
  };

  let intro = opts.reducedMotion ? 1 : 0;
  const talk = speakers.map(() => 0);
  const flow = speakers.map(() => 0);
  /** 0..1: how far the beam has turned amber for a replay. */
  let lock = 0;
  let show = 0;

  return {
    layout(width, height, frame) {
      camera = frameRoom(azimuths, width, height, frame);
      dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(camera.width * dpr);
      canvas.height = Math.round(camera.height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    anchors: () => camera.anchors,
    render(s, dt, time) {
      grow();
      if (!s.hold) intro = Math.min(1, intro + dt / 1.6);
      lock = approach(lock, s.replaying ? 1 : 0, dt, 8);
      show = approach(show, 1, dt, 4);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      // The figures: you, then the three speakers.
      begin(bust, camera.view);
      bust.a.forEach((loc, k) => bind(loc, cloudBuffers[k], cloudSizes[k]));
      gl.uniform1f(bust.u("uTime"), time);
      gl.uniform1f(bust.u("uIntro"), intro);
      const figure = (m: Mat4, yaw: number, talkAmount: number, focusAmount: number, dim: number, count: number) => {
        const mv = multiply(camera.view, m);
        gl.uniformMatrix4fv(bust.u("uMV"), false, mv);
        gl.uniformMatrix3fv(bust.u("uN"), false, [mv[0], mv[1], mv[2], mv[4], mv[5], mv[6], mv[8], mv[9], mv[10]]);
        gl.uniform1f(bust.u("uHeadYaw"), yaw);
        gl.uniform1f(bust.u("uTalk"), talkAmount);
        gl.uniform1f(bust.u("uFocus"), focusAmount);
        gl.uniform1f(bust.u("uDim"), dim);
        if (count > 0) gl.drawArrays(gl.POINTS, 0, count);
      };
      figure(you, (-s.yaw * Math.PI) / 180, 0, 0, 1, uploaded);
      speakers.forEach((sp, i) => {
        talk[i] = approach(talk[i], s.levels[i] ?? 0, dt, 18);
        const sway = opts.reducedMotion ? 0 : Math.sin(time * 0.7 + i * 2.1) * 0.08 * (0.3 + talk[i]);
        figure(sp.model, sway, talk[i], s.focus[i] ?? 0, 0.45 + 0.55 * (s.gains[i] ?? 0), Math.min(uploaded, speakerShare));
      });

      // The sound in the air.
      begin(stream, camera.view);
      stream.a.forEach((loc, k) => bind(loc, streamBuffers[k], k === 2 ? 2 : 1));
      gl.uniform3fv(stream.u("uTo"), EARS);
      speakers.forEach((sp, i) => {
        flow[i] += dt * (0.25 + talk[i] * 0.35) * (opts.reducedMotion ? 0.5 : 1);
        gl.uniform3fv(stream.u("uFrom"), sp.mouth);
        gl.uniform3fv(stream.u("uBend"), bends[i]);
        gl.uniform1f(stream.u("uFlow"), flow[i]);
        gl.uniform1f(stream.u("uLevel"), talk[i] * intro);
        gl.uniform1f(stream.u("uGain"), s.gains[i] ?? 0);
        gl.uniform1f(stream.u("uFocus"), s.focus[i] ?? 0);
        gl.drawArrays(gl.POINTS, i * perStream, perStream);
      });

      // Where your attention points.
      begin(beam, camera.view);
      bind(beam.a[0], beamBuffer, 1);
      gl.uniform1f(beam.u("uYaw"), (s.beamYaw * Math.PI) / 180);
      gl.uniform1f(beam.u("uLock"), lock);
      gl.uniform1f(beam.u("uShow"), show * intro);
      gl.uniform1f(beam.u("uTime"), time);
      gl.drawArrays(gl.POINTS, 0, beamDots);
    },
    dispose() {
      for (const b of [...cloudBuffers, ...streamBuffers, beamBuffer]) gl.deleteBuffer(b);
      for (const prog of [bust, stream, beam]) gl.deleteProgram(prog.p);
      // The context itself stays: the same canvas may be mounted again.
    },
  };
}
