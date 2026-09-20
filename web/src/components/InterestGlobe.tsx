import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import "../styles/interest-globe.css";

export type GlobeInterest = {
  id: string;
  label: string;
  color: string;
  count: number;
};

type InterestGlobeProps = {
  interests: GlobeInterest[];
  activeId: string | null;
  onChange: (id: string | null) => void;
  still: boolean;
};

type Point = { x: number; y: number; z: number };
type Rotation = { yaw: number; pitch: number };

const TAU = Math.PI * 2;
const RADIUS = 72;
const CENTER = { x: 110, y: 98 };

function rotate(point: Point, rotation: Rotation): Point {
  const cosYaw = Math.cos(rotation.yaw),
    sinYaw = Math.sin(rotation.yaw);
  const cosPitch = Math.cos(rotation.pitch),
    sinPitch = Math.sin(rotation.pitch);
  const z = point.z * cosYaw - point.x * sinYaw;
  return {
    x: point.x * cosYaw + point.z * sinYaw,
    y: point.y * cosPitch - z * sinPitch,
    z: point.y * sinPitch + z * cosPitch,
  };
}

function project(point: Point) {
  const perspective = 1 + point.z * 0.12;
  return {
    x: CENTER.x + point.x * RADIUS * perspective,
    y: CENTER.y - point.y * RADIUS * perspective,
  };
}

function faceViewer(point: Point): Rotation {
  return {
    yaw: -Math.atan2(point.x, point.z),
    pitch: Math.atan2(point.y, Math.hypot(point.x, point.z)),
  };
}

function shortestAngle(angle: number) {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

// Evenly distribute only the interests supplied by the API around the sphere.
function surfacePoint(index: number, count: number): Point {
  if (count === 1) return { x: 0, y: 0, z: 1 };
  const y = 1 - (2 * (index + 0.5)) / count;
  const radius = Math.sqrt(1 - y * y);
  const angle = index * Math.PI * (3 - Math.sqrt(5)) + 0.5;
  return { x: Math.sin(angle) * radius, y, z: Math.cos(angle) * radius };
}

const gridLines: Point[][] = [
  ...Array.from({ length: 6 }, (_, meridian) =>
    Array.from({ length: 73 }, (_, step) => {
      const angle = (step / 72) * TAU;
      const longitude = (meridian / 6) * Math.PI;
      return {
        x: Math.sin(angle) * Math.cos(longitude),
        y: Math.cos(angle),
        z: Math.sin(angle) * Math.sin(longitude),
      };
    }),
  ),
  ...[-0.55, 0, 0.55].map((y) =>
    Array.from({ length: 73 }, (_, step) => {
      const angle = (step / 72) * TAU;
      const radius = Math.sqrt(1 - y * y);
      return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
    }),
  ),
];

function gridPath(points: Point[], rotation: Rotation, front: boolean) {
  let path = "",
    drawing = false;
  for (const point of points) {
    const rotated = rotate(point, rotation);
    if (rotated.z >= 0 !== front) {
      drawing = false;
      continue;
    }
    const projected = project(rotated);
    path += `${drawing ? "L" : "M"}${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
    drawing = true;
  }
  return path;
}

export function InterestGlobe({
  interests,
  activeId,
  onChange,
  still,
}: InterestGlobeProps) {
  const uid = useId().replace(/:/g, "");
  const surface = useMemo(
    () =>
      interests.map((interest, index) => ({
        ...interest,
        point: surfacePoint(index, interests.length),
      })),
    [interests],
  );
  const [rotation, setRotation] = useState<Rotation>(() =>
    surface.length
      ? faceViewer(
          (surface.find((item) => item.id === activeId) ?? surface[0]).point,
        )
      : { yaw: 0.2, pitch: 0.25 },
  );
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(220);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const latest = useRef({ surface, onChange, still, reducedMotion });
  latest.current = { surface, onChange, still, reducedMotion };
  const rotationRef = useRef(rotation);
  const animationRef = useRef(0);
  const suppressPointerClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    start: Rotation;
    moved: boolean;
    captureTarget: HTMLElement;
  } | null>(null);
  const selected = interests.find((interest) => interest.id === activeId);
  const signature = interests.map((interest) => interest.id).join("|");

  function updateRotation(next: Rotation) {
    rotationRef.current = next;
    setRotation(next);
  }

  function turnTo(point: Point) {
    cancelAnimationFrame(animationRef.current);
    const target = faceViewer(point);
    if (latest.current.still || latest.current.reducedMotion) {
      updateRotation(target);
      return;
    }
    const start = rotationRef.current;
    const yaw = shortestAngle(target.yaw - start.yaw);
    const pitch = shortestAngle(target.pitch - start.pitch);
    const began = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - began) / 380);
      const ease = 1 - (1 - progress) ** 3;
      updateRotation({
        yaw: start.yaw + yaw * ease,
        pitch: start.pitch + pitch * ease,
      });
      animationRef.current = progress < 1 ? requestAnimationFrame(tick) : 0;
    };
    animationRef.current = requestAnimationFrame(tick);
  }

  function choose(id: string) {
    const item = latest.current.surface.find((interest) => interest.id === id);
    if (!item) return;
    turnTo(item.point);
    latest.current.onChange(id);
  }

  function closestInterest() {
    return latest.current.surface.reduce<(typeof surface)[number] | undefined>(
      (nearest, item) =>
        !nearest ||
        rotate(item.point, rotationRef.current).z >
          rotate(nearest.point, rotationRef.current).z
          ? item
          : nearest,
      undefined,
    );
  }

  function step(direction: number) {
    const current = activeId ?? closestInterest()?.id;
    const index = latest.current.surface.findIndex(
      (item) => item.id === current,
    );
    const next =
      latest.current.surface[
        (index + direction + interests.length) % interests.length
      ];
    if (next) choose(next.id);
  }

  function reset() {
    cancelAnimationFrame(animationRef.current);
    latest.current.onChange(null);
  }

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onMotionChange);
    return () => {
      media.removeEventListener("change", onMotionChange);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => setStageWidth(Math.max(1, stage.clientWidth));
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (still || reducedMotion) cancelAnimationFrame(animationRef.current);
  }, [still, reducedMotion]);

  useEffect(() => {
    const item = latest.current.surface.find(
      (interest) => interest.id === activeId,
    );
    if (item && !dragRef.current) turnTo(item.point);
    // Counts can refresh without changing the orientation or current filter.
  }, [activeId, signature]);

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || interests.length === 0)
      return;
    cancelAnimationFrame(animationRef.current);
    suppressPointerClickRef.current = false;
    // Capture on the original button so an unmoved pointer still produces its
    // normal click. Its pointer events bubble to the stable sphere handlers.
    const captureTarget =
      (event.target as HTMLElement).closest<HTMLButtonElement>("button") ??
      event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: rotationRef.current,
      moved: false,
      captureTarget,
    };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    suppressPointerClickRef.current = true;
    setDragging(true);
    const sensitivity = 2.8 / Math.max(140, event.currentTarget.clientWidth);
    updateRotation({
      yaw: drag.start.yaw + dx * sensitivity,
      pitch: drag.start.pitch + dy * sensitivity,
    });
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (drag.captureTarget.hasPointerCapture(event.pointerId))
      drag.captureTarget.releasePointerCapture(event.pointerId);
    if (drag.moved && !cancelled) {
      const nearest = closestInterest();
      if (nearest) choose(nearest.id);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Home" || event.key === "Escape") {
      event.preventDefault();
      reset();
    } else if (
      (event.key === "Enter" || event.key === " ") &&
      event.target === event.currentTarget
    ) {
      event.preventDefault();
      const nearest = closestInterest();
      if (nearest) choose(nearest.id);
    }
  }

  const occupied: { x: number; y: number; width: number }[] = [];
  const labels = surface
    .map((item, index) => {
      const point = rotate(item.point, rotation);
      return { ...item, index, depth: point.z, projected: project(point) };
    })
    .sort((a, b) => b.depth - a.depth)
    .map((item) => {
      const width =
        (Math.min(126, 28 + item.label.length * 5.6) * 220) / stageWidth;
      const x = Math.max(
        width / 2 + 2,
        Math.min(218 - width / 2, item.projected.x),
      );
      const y = item.projected.y;
      const hidden = occupied.some(
        (other) =>
          Math.abs(other.y - y) < (29 * 220) / stageWidth &&
          Math.abs(other.x - x) < (other.width + width) / 2 + 4,
      );
      if (!hidden) occupied.push({ x, y, width });
      const opacity =
        item.depth > 0
          ? 0.5 + 0.5 * item.depth ** 0.6
          : 0.06 + 0.17 * (item.depth + 1);
      return { ...item, x, y, hidden, opacity };
    })
    .sort((a, b) => a.index - b.index);

  return (
    <section className="interest-globe" aria-labelledby={`${uid}-title`}>
      <div className="interest-globe-heading">
        <h4 id={`${uid}-title`}>Your interests</h4>
        <button
          type="button"
          className="interest-globe-reset"
          onClick={reset}
          disabled={activeId === null}
          title="Show all interests"
          aria-label="Show all interests"
        >
          <RotateCcw size={11} aria-hidden="true" /> Reset
        </button>
      </div>
      <div
        ref={stageRef}
        className={`interest-globe-stage${dragging ? " is-dragging" : ""}`}
        tabIndex={interests.length ? 0 : -1}
        role="group"
        aria-label="Rotate the interest sphere"
        aria-describedby={`${uid}-instructions`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={(event) => pointerEnd(event)}
        onPointerCancel={(event) => pointerEnd(event, true)}
        onLostPointerCapture={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onClickCapture={(event) => {
          // Browsers emit a click after pointerup even when that gesture was a
          // drag. Do not let the starting label replace the released selection.
          // Keyboard and assistive-technology clicks have detail 0 and remain valid.
          if (suppressPointerClickRef.current && event.detail > 0) {
            suppressPointerClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDown={keyDown}
      >
        <svg
          viewBox="0 0 220 196"
          aria-hidden="true"
          className="interest-globe-sphere"
        >
          <defs>
            <radialGradient id={`${uid}-glass`} cx="29%" cy="23%" r="79%">
              <stop offset="0" stopColor="#f9fffb" />
              <stop offset="0.38" stopColor="#e0eee3" />
              <stop offset="0.78" stopColor="#b5d4bf" />
              <stop offset="1" stopColor="#6f9e87" />
            </radialGradient>
            <radialGradient id={`${uid}-shine`} cx="31%" cy="21%" r="74%">
              <stop offset="0" stopColor="white" stopOpacity="0.9" />
              <stop offset="0.42" stopColor="white" stopOpacity="0" />
              <stop offset="0.88" stopColor="#6b9981" stopOpacity="0" />
              <stop offset="1" stopColor="#366b50" stopOpacity="0.15" />
            </radialGradient>
            <radialGradient id={`${uid}-shadow`}>
              <stop offset="0" stopColor="#3c7660" stopOpacity="0.14" />
              <stop offset="1" stopColor="#3c7660" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse
            cx="112"
            cy="181"
            rx="63"
            ry="11"
            fill={`url(#${uid}-shadow)`}
          />
          <circle
            cx={CENTER.x}
            cy={CENTER.y}
            r={RADIUS + 4}
            fill="none"
            stroke="#bad8c6"
            strokeOpacity="0.2"
          />
          <circle
            cx={CENTER.x}
            cy={CENTER.y}
            r={RADIUS}
            fill={`url(#${uid}-glass)`}
            stroke="#b4d1bf"
            strokeWidth="0.65"
          />
          <g fill="none" stroke="#3e8063" strokeWidth="0.6" opacity="0.12">
            {gridLines.map((points, index) => (
              <path key={index} d={gridPath(points, rotation, false)} />
            ))}
          </g>
          <g fill="none" stroke="#568e70" strokeWidth="0.65" opacity="0.38">
            {gridLines.map((points, index) => (
              <path key={index} d={gridPath(points, rotation, true)} />
            ))}
          </g>
          <circle
            cx={CENTER.x}
            cy={CENTER.y}
            r={RADIUS}
            fill={`url(#${uid}-shine)`}
          />
          {labels.map((item) => (
            <circle
              key={item.id}
              cx={item.projected.x}
              cy={item.projected.y}
              r={item.depth > 0 ? 3 : 1.8}
              fill={item.color}
              opacity={item.depth > 0 ? 0.6 : 0.12}
            />
          ))}
        </svg>
        {labels.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`interest-globe-label${activeId === item.id ? " is-selected" : ""}`}
            style={
              {
                "--interest-color": item.color,
                left: `${(item.x / 220) * 100}%`,
                top: `${(item.y / 196) * 100}%`,
                opacity: item.hidden ? 0 : item.opacity,
                visibility: item.hidden ? "hidden" : "visible",
                zIndex: Math.round(10 + item.depth * 8),
              } as CSSProperties
            }
            tabIndex={item.hidden || item.depth < 0 ? -1 : 0}
            title={`${item.label} · ${item.count} ${item.count === 1 ? "person" : "people"}`}
            aria-label={`${item.label}, ${item.count} ${item.count === 1 ? "person shares" : "people share"} this interest`}
            aria-pressed={activeId === item.id}
            onClick={() => choose(item.id)}
          >
            <span className="interest-globe-dot" aria-hidden="true" />
            <span className="interest-globe-label-name">{item.label}</span>
          </button>
        ))}
        {!interests.length && (
          <span className="interest-globe-empty">
            Add your interests
            <br />
            to find your people.
          </span>
        )}
      </div>
      <div className="interest-globe-selection">
        <button
          type="button"
          className="interest-globe-arrow"
          onClick={() => step(-1)}
          disabled={interests.length < 2}
          aria-label="Previous interest"
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <div
          className="interest-globe-current"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong title={selected?.label}>
            {selected?.label ?? "All interests"}
          </strong>
          <span>
            {selected
              ? `${selected.count} ${selected.count === 1 ? "person shares" : "people share"} this`
              : `${interests.length} interests to explore`}
          </span>
        </div>
        <button
          type="button"
          className="interest-globe-arrow"
          onClick={() => step(1)}
          disabled={interests.length < 2}
          aria-label="Next interest"
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
      <p id={`${uid}-instructions`} className="interest-globe-instructions">
        Drag to turn · use arrows to explore
        <span className="interest-globe-sr-only">
          . Press Home to show all interests.
        </span>
      </p>
    </section>
  );
}

export default InterestGlobe;
