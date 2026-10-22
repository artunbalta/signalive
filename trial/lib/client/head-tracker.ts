"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { headYaw, median, steering, STEER_MAX } from "@/lib/focus/head-pose";
import { createStore } from "./store";

/**
 * Where the listener's head points, as a steering angle in degrees (right
 * positive), from one of three sources:
 *
 * - camera: MediaPipe face landmarks, computed in this tab. Frames never
 *   leave the browser and are not kept.
 * - motion: the phone's orientation (turn the phone, or yourself with it).
 * - pointer: drag, arrow keys or buttons; always available.
 *
 * Earbuds' own head tracking is not exposed to web pages, so these stand in.
 */

export type TrackingSource = "pointer" | "camera" | "motion";
export type TrackingStatus = "idle" | "starting" | "tracking" | "no_face" | "denied" | "unavailable";

export interface TrackerView {
  source: TrackingSource;
  status: TrackingStatus;
}

const clamp = (d: number) => Math.max(-STEER_MAX, Math.min(STEER_MAX, d));
/** Frames averaged when the user sets "straight ahead" themselves. */
const STRAIGHT_FRAMES = 12;

class HeadTracker {
  readonly view = createStore<TrackerView>({ source: "pointer", status: "idle" });
  /** The smoothed steering angle; advance it with tick(). */
  angle = 0;
  /** The camera feed while the camera is the source, for a small preview. */
  video: HTMLVideoElement | null = null;
  private target = 0;
  /**
   * The camera yaw that counts as straight ahead. The pose is measured from
   * the camera's axis, so 0 (facing the camera) is right for a camera in the
   * screen; recenter() takes the current head position instead, for a camera
   * off to one side. It is never taken automatically: the first frames may
   * well catch the head turned.
   */
  private straight: number | null = 0;
  private straightSamples: number[] = [];
  private zeroMotion: () => void = () => {};
  private stopSource: (() => void) | null = null;
  private run = 0;

  /** Follows the target smoothly; returns the angle to use this frame. */
  tick(dt: number): number {
    this.angle += (this.target - this.angle) * (1 - Math.exp(-dt * 12));
    return this.angle;
  }

  /** Pointer, keys and buttons. Ignored while the camera or the phone steers. */
  setAngle(deg: number) {
    if (this.view.get().source === "pointer") this.target = clamp(deg);
  }

  nudge(delta: number) {
    this.setAngle(this.target + delta);
  }

  /** Takes the current head position as straight ahead. */
  recenter() {
    this.straight = null;
    this.straightSamples = [];
    this.zeroMotion();
    if (this.view.get().source === "pointer") this.target = 0;
  }

  async use(source: TrackingSource) {
    this.stop();
    const run = ++this.run;
    this.target = 0;
    this.view.set({ source, status: source === "pointer" ? "tracking" : "starting" });
    if (source === "camera") await this.startCamera(run);
    else if (source === "motion") await this.startMotion(run);
  }

  stop() {
    this.run++;
    this.stopSource?.();
    this.stopSource = null;
    this.video = null;
    this.view.set({ status: "idle" });
  }

  private async startCamera(run: number) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (err) {
      this.view.set({ status: err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "unavailable" });
      return;
    }
    const stopStream = () => stream.getTracks().forEach((t) => t.stop());
    if (run !== this.run) return stopStream();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    let landmarker: FaceLandmarker;
    try {
      await video.play();
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks("/vendor/mediapipe");
      const make = (delegate: "GPU" | "CPU") =>
        FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
        });
      landmarker = await make("GPU").catch(() => make("CPU"));
    } catch {
      stopStream();
      if (run === this.run) this.view.set({ status: "unavailable" });
      return;
    }
    if (run !== this.run) {
      landmarker.close();
      return stopStream();
    }
    this.video = video;
    let raf = 0;
    let lastFrame = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.currentTime === lastFrame) return;
      lastFrame = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      const pose = result.facialTransformationMatrixes?.[0];
      const yaw = pose ? headYaw(pose.data) : null;
      if (yaw === null) {
        this.view.set({ status: "no_face" });
        return;
      }
      if (this.straight === null) {
        this.straightSamples.push(yaw);
        if (this.straightSamples.length < STRAIGHT_FRAMES) return;
        this.straight = median(this.straightSamples);
      }
      this.view.set({ status: "tracking" });
      this.target = steering(yaw, this.straight);
    };
    raf = requestAnimationFrame(loop);
    this.stopSource = () => {
      cancelAnimationFrame(raf);
      landmarker.close();
      stopStream();
      video.srcObject = null;
    };
  }

  private async startMotion(run: number) {
    const Orientation = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!Orientation) {
      this.view.set({ status: "unavailable" });
      return;
    }
    // iOS asks once, and only from a tap.
    if (typeof Orientation.requestPermission === "function") {
      try {
        if ((await Orientation.requestPermission()) !== "granted") {
          this.view.set({ status: "denied" });
          return;
        }
      } catch {
        this.view.set({ status: "denied" });
        return;
      }
    }
    if (run !== this.run) return;
    let zero: number | null = null;
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha === null) return;
      zero ??= e.alpha;
      // alpha grows turning left; wrap the difference into -180..180.
      const turned = ((zero - e.alpha + 540) % 360) - 180;
      this.target = clamp(turned);
      if (this.view.get().status !== "tracking") this.view.set({ status: "tracking" });
    };
    window.addEventListener("deviceorientation", onOrientation);
    this.zeroMotion = () => (zero = null);
    const silent = setTimeout(() => {
      if (run === this.run && this.view.get().status === "starting") this.view.set({ status: "unavailable" });
    }, 2500);
    this.stopSource = () => {
      clearTimeout(silent);
      window.removeEventListener("deviceorientation", onOrientation);
      this.zeroMotion = () => {};
    };
  }
}

export const headTracker = new HeadTracker();
