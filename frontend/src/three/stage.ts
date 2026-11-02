import {
  Color,
  type Material,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { keepLabelsReadable } from "./labels";

/** Can this browser draw WebGL? (Old devices, some privacy settings and remote desktops cannot.) */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Phones and small tablets get lighter 3D (smaller textures, fewer polygons, lower pixel density). */
export function isSmallScreen(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 760px)").matches);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  reducedMotion: boolean;
  /** Called every animation frame while the view is visible. Returns a function that stops it. */
  onFrame: (fn: (seconds: number, delta: number) => void) => () => void;
  /** Ask for one more frame (for views that only redraw when something changes). */
  invalidate: () => void;
  /**
   * Point the camera at `target` from `direction`, far enough away that a scene of half-width `half.x` and
   * half-height `half.y` fits whatever the screen's shape (portrait phones included). Re-applied on resize until
   * the user moves the view.
   */
  frame: (half: { x: number; y: number }, target: [number, number, number], direction: [number, number, number],
    options?: { smooth?: boolean }) => void;
  dispose: () => void;
}

interface Options {
  fov?: number;
  zoom?: boolean;
  minDistance?: number;
  maxDistance?: number;
}

/**
 * A three.js renderer bound to a container: sizes itself with the container, pauses when off screen or in a
 * background tab, and cleans up everything on dispose (React effects call it on unmount).
 */
export function createStage(container: HTMLElement, options: Options = {}): Stage {
  const small = isSmallScreen();
  const renderer = new WebGLRenderer({ antialias: !small, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(new Color(0x000000), 0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  // On touch screens a vertical swipe should still scroll the page; sideways swipes turn the view and
  // two fingers zoom. (OrbitControls would otherwise capture every touch.)
  renderer.domElement.style.touchAction = "pan-y";
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(options.fov ?? 40, 1, 0.01, 100);
  camera.position.set(0, 0, 3.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = options.zoom ?? true;
  controls.minDistance = options.minDistance ?? 1.4;
  controls.maxDistance = options.maxDistance ?? 8;
  controls.update();

  const reducedMotion = prefersReducedMotion();
  const frameCallbacks: ((seconds: number, delta: number) => void)[] = [];
  let visible = true;
  let raf = 0;
  let dirty = true;
  let last = performance.now();

  let framing: { half: { x: number; y: number }; target: Vector3; direction: Vector3 } | null = null;
  let userMoved = false;
  let glide: { position: Vector3; target: Vector3 } | null = null;      // smooth framing in progress
  const applyFrame = (smooth = false) => {
    if (!framing) return;
    const vertical = (camera.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const r = framing.half;
    const distance = Math.max(r.x / Math.tan(horizontal / 2), r.y / Math.tan(vertical / 2)) + 0.3 * Math.max(r.x, r.y);
    const position = framing.target.clone().addScaledVector(framing.direction, distance);
    if (smooth) {
      glide = { position, target: framing.target.clone() };
      controls.maxDistance = Math.max(controls.maxDistance, distance * 1.8);
      dirty = true;
      return;
    }
    glide = null;
    camera.position.copy(position);
    camera.lookAt(framing.target);
    controls.target.copy(framing.target);
    controls.maxDistance = Math.max(controls.maxDistance, distance * 1.8);
    controls.update();
    dirty = true;
  };

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!userMoved) applyFrame(false);
    dirty = true;
    start();
  };

  // `raf` stays non-zero while a frame is scheduled or running, so invalidate() calls made from inside a frame
  // never schedule a second loop. When nothing changes the loop stops (saves battery) until invalidate(),
  // a resize or the user touching the view starts it again.
  const loop = (now: number) => {
    if (!visible || document.hidden) {
      raf = 0;
      return;
    }
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const fn of frameCallbacks) fn(now / 1000, delta);
    if (glide) {
      const k = Math.min(1, delta * 5);
      camera.position.lerp(glide.position, k);
      controls.target.lerp(glide.target, k);
      dirty = true;
      if (camera.position.distanceTo(glide.position) < 1e-3) glide = null;
    }
    const moved = controls.update();
    const draw = dirty || moved;
    if (draw) {
      dirty = false;
      keepLabelsReadable(scene, camera, container.clientHeight);
      renderer.render(scene, camera);
    }
    raf = draw || dirty ? requestAnimationFrame(loop) : 0;
  };
  const start = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
  });
  visibilityObserver.observe(container);
  const onVisibility = () => {
    if (!document.hidden) start();
  };
  document.addEventListener("visibilitychange", onVisibility);
  controls.addEventListener("change", () => {
    dirty = true;
    start();
  });
  controls.addEventListener("start", () => {
    userMoved = true;
    glide = null;
    start();
  });
  resize();
  start();

  return {
    renderer,
    scene,
    camera,
    controls,
    reducedMotion,
    onFrame: (fn) => {
      frameCallbacks.push(fn);
      start();
      return () => {
        const i = frameCallbacks.indexOf(fn);
        if (i >= 0) frameCallbacks.splice(i, 1);
      };
    },
    invalidate: () => {
      dirty = true;
      start();
    },
    frame: (half, target, direction, frameOptions = {}) => {
      framing = { half, target: new Vector3(...target), direction: new Vector3(...direction).normalize() };
      if (frameOptions.smooth && userMoved) return;      // never yank the view away from someone exploring it
      userMoved = false;
      applyFrame(frameOptions.smooth);
      start();
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      controls.dispose();
      disposeGroup(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * Hover (mouse) and click or tap on a 3D view: `pick` names the item under the pointer from a raycaster aimed there.
 * A press that moves 8px or more is turning the view, so it picks nothing. Returns a function that stops listening.
 */
export function pointerPicking<T>(stage: Stage, pick: (raycaster: Raycaster) => T | undefined,
  onPick: (item: T) => void, hover?: (item: T | undefined, x: number, y: number, rect: DOMRect) => void,
  leave?: () => void) {
  const el = stage.renderer.domElement;
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const at = (e: PointerEvent) => {
    const rect = el.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, stage.camera);
    const item = pick(raycaster);
    hover?.(item, e.clientX - rect.left, e.clientY - rect.top, rect);
    el.style.cursor = item !== undefined ? "pointer" : "grab";
    return item;
  };
  let down: { x: number; y: number } | null = null;
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && !e.buttons) at(e);
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
      const item = at(e);
      if (item !== undefined) onPick(item);
    }
    down = null;
  };
  const onLeave = () => leave?.();
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointerleave", onLeave);
  return () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointerleave", onLeave);
  };
}

/** Remove objects from their parents and free their GPU memory. */
export function disposeGroup(...objects: Object3D[]) {
  for (const root of objects) {
    root.removeFromParent();
    root.traverse((object) => {
      const mesh = object as Mesh;
      mesh.geometry?.dispose();
      for (const material of ([] as (Material | undefined)[]).concat(mesh.material as Material | Material[])) {
        if (!material) continue;
        for (const value of Object.values(material)) if ((value as Texture)?.isTexture) (value as Texture).dispose();
        material.dispose();
      }
    });
  }
}
