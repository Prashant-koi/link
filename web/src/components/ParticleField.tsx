import { useEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";

// Small floating specks behind the whole app. They drift on their own and are
// nudged away by the pointer, then glide back to drifting — never snapping.
//
// It is one fixed canvas behind everything (pointer-events off), so the pointer
// is read from `window`. Canvas 2D cannot use CSS variables, so the palette is
// resolved once from the tokens.

interface Particle {
  x: number;
  y: number;
  vx: number; // velocity from being pushed; decays back to zero
  vy: number;
  r: number;
  depth: number; // 0.4 (far, dim, slow) .. 1 (near)
  phase: number;
  speed: number;
  alpha: number;
  tone: 0 | 1;
}

const AREA_PER_PARTICLE = 14000;
const MIN_COUNT = 40;
const MAX_COUNT = 140;
const REACH = 140; // px of pointer influence
const PUSH = 260; // px/s^2 at the pointer, falling off by smoothstep
const DAMP = 2.4; // 1/s: how quickly a push dies away

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

function seed(width: number, height: number): Particle[] {
  const n = Math.round(Math.min(MAX_COUNT, Math.max(MIN_COUNT, (width * height) / AREA_PER_PARTICLE)));
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    const depth = 0.4 + Math.random() * 0.6;
    out.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 0,
      vy: 0,
      r: 0.8 + depth * depth * 1.4,
      depth,
      phase: Math.random() * Math.PI * 2,
      speed: (4 + Math.random() * 8) * depth,
      alpha: 0.15 + depth * 0.3,
      tone: Math.random() < 0.6 ? 0 : 1,
    });
  }
  return out;
}

export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [still] = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const styles = getComputedStyle(document.documentElement);
    const tones = [styles.getPropertyValue("--tq-500").trim() || "#17a2b8", styles.getPropertyValue("--tq-300").trim() || "#7fd4dc"];

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    const pointer = { x: -9999, y: -9999, active: false };

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      canvas!.width = Math.round(nw * dpr);
      canvas!.height = Math.round(nh * dpr);
      canvas!.style.width = `${nw}px`;
      canvas!.style.height = `${nh}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (particles.length === 0) {
        particles = seed(nw, nh);
      } else {
        // Keep the existing specks, scaled into the new size, then top up/trim.
        for (const p of particles) {
          p.x = (p.x / width) * nw;
          p.y = (p.y / height) * nh;
        }
        const target = seed(nw, nh).length;
        if (particles.length > target) particles.length = target;
        else particles.push(...seed(nw, nh).slice(0, target - particles.length));
      }
      width = nw;
      height = nh;
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        ctx!.globalAlpha = p.alpha;
        ctx!.fillStyle = tones[p.tone];
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    resize();

    if (still) {
      // Reduced motion: one static frame, no loop, no pointer tracking.
      draw();
      const onResize = () => {
        resize();
        draw();
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    let raf = 0;
    let last = performance.now();
    let time = 0;

    function tick(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;

      for (const p of particles) {
        // Ambient drift: a slow wandering heading, slower for far specks.
        const heading = p.phase + Math.sin(time * 0.15 + p.phase * 3) * 1.2;
        let x = p.x + (Math.cos(heading) * p.speed + p.vx) * dt;
        let y = p.y + (Math.sin(heading) * p.speed * 0.7 - p.speed * 0.25 + p.vy) * dt;

        if (pointer.active) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < REACH && d > 0.01) {
            const push = smooth(1 - d / REACH) * PUSH * (0.5 + p.depth * 0.5);
            p.vx += (dx / d) * push * dt;
            p.vy += (dy / d) * push * dt;
          }
        }
        const decay = Math.exp(-DAMP * dt);
        p.vx *= decay;
        p.vy *= decay;

        // Wrap with a little margin so a speck never pops at the edge.
        if (x < -10) x = width + 10;
        else if (x > width + 10) x = -10;
        if (y < -10) y = height + 10;
        else if (y > height + 10) y = -10;
        p.x = x;
        p.y = y;
      }
      draw();
      raf = requestAnimationFrame(tick);
    }

    const start = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [still]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, zIndex: -1, pointerEvents: "none" }}
    />
  );
}
