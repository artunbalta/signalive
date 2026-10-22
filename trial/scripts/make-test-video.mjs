#!/usr/bin/env node
/**
 * Builds the camera fixtures for the Focus head tracking test: a realistic
 * scanned head (Lee Perry-Smith, from the three.js examples, CC BY 3.0,
 * downloaded here and used for testing only) rendered straight ahead, then
 * turning to one side and back, as Y4M files Chromium plays as a fake camera
 * (--use-file-for-fake-video-capture). One file per side, so a test can tell
 * a right turn from a left one even though the video loops. Needs the
 * network once, Playwright's Chromium and ffmpeg.
 *
 * Output: tests/fixtures/video/head-turn-right.y4m and head-turn-left.y4m
 * (gitignored).
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tests", "fixtures", "video");
const assets = join(out, "assets");
const frames = join(out, "frames");
mkdirSync(assets, { recursive: true });
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const BASE = "https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/models/gltf/LeePerrySmith/";
for (const name of ["LeePerrySmith.glb", "Map-COL.jpg"]) {
  const dest = join(assets, name);
  if (existsSync(dest)) continue;
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`download failed: ${name} ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

const PAGE = `<!doctype html><html><body style="margin:0;background:#55585e">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(640, 480);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x55585e);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(0.6, 0.8, 2);
scene.add(key);
const gltf = await new GLTFLoader().loadAsync("/assets/LeePerrySmith.glb");
const mesh = gltf.scene.children[0];
const map = await new THREE.TextureLoader().loadAsync("/assets/Map-COL.jpg");
map.colorSpace = THREE.SRGBColorSpace;
mesh.material = new THREE.MeshStandardMaterial({ map, roughness: 0.75 });
const box = new THREE.Box3().setFromObject(mesh);
mesh.position.sub(box.getCenter(new THREE.Vector3()));
const head = new THREE.Group();
head.add(mesh);
scene.add(head);
const h = box.getSize(new THREE.Vector3()).y;
const camera = new THREE.PerspectiveCamera(30, 640 / 480, h / 100, h * 20);
camera.position.set(0, h * 0.08, h * 2.4);
camera.lookAt(0, h * 0.08, 0);
// Positive turns the person to their own right: the face swings to the viewer's left.
window.renderAt = (rightDeg) => {
  head.rotation.y = (-rightDeg * Math.PI) / 180;
  renderer.render(scene, camera);
};
window.ready = true;
</script></body></html>`;

const types = { ".js": "text/javascript", ".glb": "model/gltf-binary", ".jpg": "image/jpeg", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = null;
  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(PAGE);
  }
  if (url.startsWith("/three/")) file = join(root, "node_modules", "three", normalize(url.slice(7)));
  else if (url.startsWith("/assets/")) file = join(assets, normalize(url.slice(8)));
  if (!file || !existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// Straight ahead (long enough to set the reference), turned, straight again.
const FPS = 15;
const keysFor = (side) => [
  [0, 0],
  [3, 0],
  [4, 38 * side],
  [7, 38 * side],
  [8, 0],
  [9.5, 0],
];
const turnAt = (keys, t) => {
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const x = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (x * x * (3 - 2 * x));
    }
  }
  return 0;
};

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
for (const [name, side] of [["right", 1], ["left", -1]]) {
  const keys = keysFor(side);
  const total = Math.round(keys.at(-1)[0] * FPS);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  for (let i = 0; i < total; i++) {
    await page.evaluate((deg) => window.renderAt(deg), turnAt(keys, i / FPS));
    await page.locator("canvas").screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.png`) });
  }
  const y4m = join(out, `head-turn-${name}.y4m`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "f%04d.png"), "-pix_fmt", "yuv420p", y4m]);
  console.log(`[make-test-video] ${total} frames at ${FPS} fps: ${y4m}`);
}
await browser.close();
server.close();
rmSync(frames, { recursive: true, force: true });
