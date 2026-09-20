import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "../styles/network-atlas.css";

export type AtlasPerson = {
  id: string;
  name: string;
  group: number;
  groups?: number[];
  initials: string;
  sharedConceptIds?: string[];
  score?: number;
};

type NetworkAtlasProps = {
  people: AtlasPerson[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  activeGroup: number | null;
  still: boolean;
  zoom: number;
};

type PersonPoint = {
  id: string;
  x: number;
  y: number;
  radius: number;
  distance: number;
  opacity: number;
  inFrame: boolean;
};
type SharedEdge = { a: number; b: number; strength: number };
type LabelMap = Map<string, HTMLButtonElement>;

const GROUP_COLORS = ["#168f8d", "#a394c7", "#bd9651", "#73a1b6", "#829977"];
// Rank determines position: the strongest match starts at the top/front.
const PERSON_POSITIONS: [number, number, number][] = [
  [-0.28, 1.36, 1.14],
  [-1.42, 0.46, 0.92],
  [1.33, 0.65, 0.75],
  [0.25, -0.16, 1.63],
  [-0.91, -1.1, 0.72],
  [1.16, -1.06, 0.48],
  [-0.63, 0.94, -1.24],
  [1.52, -0.13, -0.9],
  [-1.41, -0.61, -0.79],
  [0.41, -1.44, -0.73],
  [0.76, 1.33, -0.62],
  [-0.05, -0.31, -1.64],
];

function personPosition(index: number, count: number) {
  if (count === 1) return new THREE.Vector3(0, 0.2, 0.75);
  if (count === 2)
    return new THREE.Vector3(
      index ? 0.94 : -0.86,
      index ? -0.57 : 0.69,
      index ? 0.25 : 0.8,
    );
  if (index < PERSON_POSITIONS.length)
    return new THREE.Vector3(...PERSON_POSITIONS[index]);
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (index + 0.5)) / count;
  const radius = Math.sqrt(1 - y * y);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    y,
    Math.sin(angle) * radius,
  ).multiplyScalar(1.65);
}

function matchesGroup(person: AtlasPerson, activeGroup: number | null) {
  return (
    activeGroup === null ||
    (person.groups ?? [person.group]).includes(activeGroup)
  );
}

function personLabel(person: AtlasPerson, people: AtlasPerson[]) {
  const [first, last] = person.name.split(" ");
  return last &&
    people.some(
      (other) => other.id !== person.id && other.name.split(" ")[0] === first,
    )
    ? `${first} ${last[0]}.`
    : first;
}

function sharedStrength(a: AtlasPerson, b: AtlasPerson) {
  if (a.sharedConceptIds !== undefined || b.sharedConceptIds !== undefined) {
    const otherIds = new Set(b.sharedConceptIds ?? []);
    return [...new Set(a.sharedConceptIds ?? [])].filter((id) =>
      otherIds.has(id),
    ).length;
  }
  const otherGroups = new Set(b.groups ?? [b.group]);
  return [...new Set(a.groups ?? [a.group])].filter((group) =>
    otherGroups.has(group),
  ).length;
}

function meaningfulEdges(people: AtlasPerson[]): SharedEdge[] {
  const candidates: SharedEdge[] = [];
  people.forEach((person, a) => {
    people.slice(a + 1).forEach((other, offset) => {
      const strength = sharedStrength(person, other);
      if (strength) candidates.push({ a, b: a + offset + 1, strength });
    });
  });
  candidates.sort(
    (a, b) => b.strength - a.strength || a.b - a.a - (b.b - b.a) || a.a - b.a,
  );
  // A strongest-overlap spanning forest connects people without drawing every possible pair.
  const components = people.map((_, index) => index);
  const root = (index: number): number =>
    components[index] === index ? index : root(components[index]);
  const edges: SharedEdge[] = [];
  candidates.forEach((edge) => {
    const a = root(edge.a);
    const b = root(edge.b);
    if (a === b) return;
    components[a] = b;
    edges.push(edge);
  });
  return edges;
}

function fitDistance(width: number, height: number) {
  return Math.max(6.35, 5.1 / (width / height));
}

function projectPerson(
  id: string,
  position: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  radius: number,
  subdued: boolean,
): PersonPoint {
  const projected = position.clone().project(camera);
  const cameraSpace = position.clone().applyMatrix4(camera.matrixWorldInverse);
  const front = position.dot(camera.position.clone().normalize()) / 1.8;
  const opacity =
    THREE.MathUtils.smoothstep(front, -0.65, 0.78) * (subdued ? 0.25 : 1);
  const x = (projected.x * 0.5 + 0.5) * width;
  const y = (-projected.y * 0.5 + 0.5) * height;
  return {
    id,
    x,
    y,
    opacity,
    radius:
      (radius * height * camera.zoom) /
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * -cameraSpace.z),
    distance: camera.position.distanceTo(position),
    inFrame:
      projected.z > -1 &&
      projected.z < 1 &&
      x > 12 &&
      x < width - 12 &&
      y > 12 &&
      y < height - 12,
  };
}

function positionLabels(
  points: PersonPoint[],
  labels: LabelMap,
  width: number,
  height: number,
) {
  const occupied: { x: number; y: number; width: number; height: number }[] =
    [];
  const sorted = [...points].sort((a, b) => a.distance - b.distance);
  const limit = width < 440 ? 4 : 6;
  sorted.forEach((point, index) => {
    const label = labels.get(point.id);
    if (!label) return;
    let opacity = 0;
    const occluded = sorted
      .slice(0, index)
      .some(
        (nearer) =>
          nearer.inFrame &&
          Math.hypot(nearer.x - point.x, nearer.y - point.y) <
            nearer.radius + point.radius * 0.4,
      );
    if (
      point.inFrame &&
      point.opacity > 0.13 &&
      !occluded &&
      occupied.length < limit
    ) {
      const labelWidth = label.offsetWidth;
      const labelHeight = label.offsetHeight;
      const gap = point.radius + 8;
      const right = [gap, -labelHeight / 2];
      const left = [-labelWidth - gap, -labelHeight / 2];
      const offsets = point.x > width * 0.64 ? [left, right] : [right, left];
      offsets.push(
        [-labelWidth / 2, gap],
        [-labelWidth / 2, -labelHeight - gap],
      );
      const position = offsets
        .map(([offsetX, offsetY]) => ({
          x: point.x + offsetX,
          y: point.y + offsetY,
          width: labelWidth,
          height: labelHeight,
        }))
        .find(
          (option) =>
            option.x > 8 &&
            option.y > 8 &&
            option.x + option.width < width - 8 &&
            option.y + option.height < height - 8 &&
            !occupied.some(
              (other) =>
                option.x < other.x + other.width + 7 &&
                option.x + option.width + 7 > other.x &&
                option.y < other.y + other.height + 7 &&
                option.y + option.height + 7 > other.y,
            ) &&
            !points.some(
              (other) =>
                other.id !== point.id &&
                other.inFrame &&
                other.x + other.radius > option.x - 4 &&
                other.x - other.radius < option.x + option.width + 4 &&
                other.y + other.radius > option.y - 4 &&
                other.y - other.radius < option.y + option.height + 4,
            ),
        );
      if (position) {
        occupied.push(position);
        label.style.left = `${position.x}px`;
        label.style.top = `${position.y}px`;
        opacity = point.opacity;
      }
    }
    label.style.opacity = `${opacity}`;
    label.dataset.depth = point.distance.toFixed(3);
    label.style.zIndex = `${sorted.length - index + 1}`;
    label.style.pointerEvents = opacity > 0.25 ? "auto" : "none";
    label.tabIndex = opacity > 0.25 ? 0 : -1;
    label.setAttribute("aria-hidden", opacity > 0.25 ? "false" : "true");
  });
}

function PersonLabels({
  people,
  selectedId,
  onSelect,
  labels,
}: {
  people: AtlasPerson[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  labels: LabelMap;
}) {
  return (
    <div className="atlas-labels">
      {people.map((person) => (
        <button
          key={person.id}
          ref={(element) => {
            if (element) labels.set(person.id, element);
            else labels.delete(person.id);
          }}
          type="button"
          data-person-id={person.id}
          tabIndex={-1}
          className={`atlas-person ${selectedId === person.id ? "atlas-person-selected" : ""}`}
          onClick={() => onSelect(person.id)}
          aria-label={`Explore ${person.name}'s connections`}
          aria-pressed={selectedId === person.id}
        >
          <span
            className="atlas-person-initials"
            style={{ color: GROUP_COLORS[person.group % GROUP_COLORS.length] }}
          >
            {person.initials}
          </span>
          <span>{personLabel(person, people)}</span>
          {selectedId === person.id && (
            <span className="atlas-person-dot" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}

function StaticAtlas({
  people,
  selectedId,
  onSelect,
  activeGroup,
  zoom,
  gradientId,
}: NetworkAtlasProps & { gradientId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<LabelMap>(new Map());
  const [size, setSize] = useState({ width: 500, height: 450 });
  const edges = useMemo(() => meaningfulEdges(people), [people]);
  const camera = new THREE.PerspectiveCamera(
    43,
    size.width / size.height,
    0.1,
    80,
  );
  camera.position.set(0, 0, fitDistance(size.width, size.height));
  camera.zoom = Math.max(0.7, Math.min(1.6, zoom));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const points = people.map((person, index) =>
    projectPerson(
      person.id,
      personPosition(index, people.length),
      camera,
      size.width,
      size.height,
      selectedId === person.id ? 0.155 : 0.12,
      !matchesGroup(person, activeGroup),
    ),
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() =>
      setSize({
        width: Math.max(1, container.clientWidth),
        height: Math.max(1, container.clientHeight),
      }),
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    positionLabels(points, labelsRef.current, size.width, size.height);
  });

  return (
    <div ref={containerRef} className="atlas-fallback">
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="img"
        aria-label={`${people.length} matching people; lines show shared interests`}
      >
        <defs>
          <radialGradient id={gradientId} cx="28%" cy="22%" r="80%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="42%" stopColor="#e0f0e9" />
            <stop offset="100%" stopColor="#83b8ad" />
          </radialGradient>
        </defs>
        {edges.map(({ a, b }) => (
          <line
            key={`${people[a].id}-${people[b].id}`}
            x1={points[a].x}
            y1={points[a].y}
            x2={points[b].x}
            y2={points[b].y}
            stroke="#79a99b"
            strokeWidth="0.85"
            opacity={
              0.12 + Math.min(points[a].opacity, points[b].opacity) * 0.23
            }
          />
        ))}
        {[...points]
          .sort((a, b) => b.distance - a.distance)
          .map((point) => (
            <g
              key={point.id}
              opacity={0.2 + point.opacity * 0.8}
              onClick={() => onSelect(point.id)}
              className="atlas-fallback-node"
            >
              {selectedId === point.id && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={point.radius + 6}
                  fill="none"
                  stroke="#168f87"
                  opacity="0.3"
                />
              )}
              <circle
                cx={point.x}
                cy={point.y}
                r={point.radius}
                fill={
                  selectedId === point.id ? "#329e90" : `url(#${gradientId})`
                }
                stroke="#ffffff"
                strokeWidth="1"
              />
            </g>
          ))}
      </svg>
      <PersonLabels
        people={people}
        selectedId={selectedId}
        onSelect={onSelect}
        labels={labelsRef.current}
      />
    </div>
  );
}

export function NetworkAtlas(props: NetworkAtlasProps) {
  const { people, selectedId, activeGroup, still, zoom } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<LabelMap>(new Map());
  const latestRef = useRef(props);
  const refreshRef = useRef<() => void>(() => {});
  const [webglReady, setWebglReady] = useState(false);
  const gradientId = useId().replace(/:/g, "");
  latestRef.current = props;
  const signature = JSON.stringify(
    people.map(({ id, group, groups, sharedConceptIds, score }) => [
      id,
      group,
      groups,
      sharedConceptIds,
      score,
    ]),
  );

  useEffect(() => {
    const container = containerRef.current;
    const mount = canvasMountRef.current;
    if (!container || !mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      setWebglReady(false);
      return;
    }

    let disposed = false;
    let visible = true;
    let contextAvailable = true;
    let animationFrame = 0;
    let previousTime = 0;
    let width = 1;
    let height = 1;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 80);
    camera.position.set(0, 0, 6.35);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setClearColor(0xffffff, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.rotateSpeed = 0.48;
    controls.minPolarAngle = Math.PI * 0.16;
    controls.maxPolarAngle = Math.PI * 0.84;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.ROTATE;

    scene.add(new THREE.AmbientLight(0xe4fff3, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.5);
    keyLight.position.set(-4, 5, 6);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x60aa98, 2.2);
    rimLight.position.set(5, -2, -3);
    scene.add(rimLight);

    const network = new THREE.Group();
    scene.add(network);
    const resources: (THREE.BufferGeometry | THREE.Material)[] = [];
    const sphereGeometry = new THREE.SphereGeometry(1, 32, 24);
    const ringGeometry = new THREE.RingGeometry(1.48, 1.54, 48);
    resources.push(sphereGeometry, ringGeometry);
    const personMeshes = latestRef.current.people.map((person, index) => {
      const material = new THREE.MeshPhysicalMaterial({
        color: "#d6e8df",
        roughness: 0.21,
        metalness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.14,
        transparent: true,
      });
      const mesh = new THREE.Mesh(sphereGeometry, material);
      mesh.position.copy(
        personPosition(index, latestRef.current.people.length),
      );
      mesh.userData.personId = person.id;
      network.add(mesh);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: "#178e80",
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.copy(mesh.position);
      ring.scale.setScalar(0.155);
      network.add(ring);
      resources.push(material, ringMaterial);
      return { person, mesh, material, ring, ringMaterial };
    });

    const strands = meaningfulEdges(latestRef.current.people).map(
      ({ a, b, strength }) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          personMeshes[a].mesh.position,
          personMeshes[b].mesh.position,
        ]);
        const material = new THREE.LineBasicMaterial({
          color: "#79a99b",
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
        });
        network.add(new THREE.Line(geometry, material));
        resources.push(geometry, material);
        return { a, b, strength, material };
      },
    );

    const worldPosition = new THREE.Vector3();
    const render = () => {
      if (disposed || !visible || !contextAvailable) return;
      const current = latestRef.current;
      camera.zoom = Math.max(0.7, Math.min(1.6, current.zoom));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      network.updateMatrixWorld(true);
      const points = personMeshes.map(
        ({ person, mesh, material, ring, ringMaterial }) => {
          const selected = current.selectedId === person.id;
          const subdued = !matchesGroup(person, current.activeGroup);
          const radius = selected ? 0.155 : 0.12;
          mesh.getWorldPosition(worldPosition);
          const point = projectPerson(
            person.id,
            worldPosition,
            camera,
            width,
            height,
            radius,
            subdued,
          );
          material.color.set(selected ? "#228f81" : "#d6e8df");
          material.opacity = 0.18 + point.opacity * 0.82;
          mesh.scale.setScalar(radius);
          ring.visible = selected;
          ringMaterial.opacity = point.opacity * 0.35;
          ring.quaternion.copy(
            network.quaternion.clone().invert().multiply(camera.quaternion),
          );
          return point;
        },
      );
      strands.forEach(({ a, b, strength, material }) => {
        const selected =
          current.selectedId === personMeshes[a].person.id ||
          current.selectedId === personMeshes[b].person.id;
        material.opacity =
          (selected ? 0.19 : 0.1) +
          Math.min(points[a].opacity, points[b].opacity) *
            Math.min(0.28, 0.15 + strength * 0.025);
        material.color.set(selected ? "#3e9e89" : "#79a99b");
      });
      positionLabels(points, labelsRef.current, width, height);
      renderer.render(scene, camera);
    };
    const shouldAnimate = () =>
      visible &&
      contextAvailable &&
      !document.hidden &&
      !latestRef.current.still &&
      !reducedMotion.matches;
    const tick = (time: number) => {
      animationFrame = 0;
      if (!shouldAnimate() || disposed) return;
      const delta = previousTime
        ? Math.min((time - previousTime) / 1000, 0.05)
        : 0;
      previousTime = time;
      network.rotation.y += delta * 0.021;
      render();
      animationFrame = requestAnimationFrame(tick);
    };
    const refresh = () => {
      render();
      if (shouldAnimate() && !animationFrame) {
        previousTime = 0;
        animationFrame = requestAnimationFrame(tick);
      } else if (!shouldAnimate() && animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    };
    refreshRef.current = refresh;
    controls.addEventListener("change", render);

    const resize = () => {
      width = Math.max(1, container.clientWidth);
      height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.position.setLength(fitDistance(width, height));
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      refresh();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        refresh();
      },
      { threshold: 0.01 },
    );
    visibilityObserver.observe(container);
    document.addEventListener("visibilitychange", refresh);
    reducedMotion.addEventListener("change", refresh);

    const raycaster = new THREE.Raycaster();
    const pointerStart = { x: 0, y: 0 };
    const pointerDown = (event: PointerEvent) => {
      pointerStart.x = event.clientX;
      pointerStart.y = event.clientY;
    };
    const pointerUp = (event: PointerEvent) => {
      if (
        Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        ) > 5
      )
        return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(
        personMeshes.map(({ mesh }) => mesh),
      )[0];
      if (hit)
        latestRef.current.onSelect(hit.object.userData.personId as string);
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      contextAvailable = false;
      refresh();
      setWebglReady(false);
    };
    const contextRestored = () => {
      contextAvailable = true;
      setWebglReady(true);
      refresh();
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      contextRestored,
    );
    resize();
    setWebglReady(true);

    return () => {
      disposed = true;
      refreshRef.current = () => {};
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      reducedMotion.removeEventListener("change", refresh);
      controls.removeEventListener("change", render);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        contextRestored,
      );
      resources.forEach((resource) => resource.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [signature]);

  useEffect(() => {
    refreshRef.current();
  }, [people, selectedId, activeGroup, still, zoom, webglReady]);

  return (
    <div
      ref={containerRef}
      className={`atlas-root ${webglReady ? "atlas-ready" : ""}`}
      aria-label="Matching people in an interactive network"
    >
      <div className="atlas-atmosphere" aria-hidden="true" />
      <div ref={canvasMountRef} className="atlas-canvas" />
      {!webglReady && <StaticAtlas {...props} gradientId={gradientId} />}
      {webglReady && (
        <PersonLabels
          people={people}
          selectedId={selectedId}
          onSelect={props.onSelect}
          labels={labelsRef.current}
        />
      )}
    </div>
  );
}

export default NetworkAtlas;
