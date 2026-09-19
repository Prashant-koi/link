/**
 * Deterministic synthetic university.
 *
 * Density over scale: the point is that "where do I fit" finds real paths, and
 * that comes from the interest edges, not from node counts.
 */

/* deterministic PRNG so every reseed produces the same institution */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20251117);
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const pickN = <T>(xs: T[], n: number): T[] => {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(...pool.splice(Math.floor(rnd() * pool.length), 1));
  return out;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

export interface Node {
  id: string;
  labels: string[];
  props: Record<string, unknown>;
}
export interface Edge {
  from: string;
  to: string;
  type: string;
  props?: Record<string, unknown>;
}

const nodes: Node[] = [];
const edges: Edge[] = [];
const node = (id: string, labels: string[], props: Record<string, unknown>) => {
  nodes.push({ id, labels, props: { id, ...props } });
  return id;
};
const edge = (from: string, type: string, to: string, props?: Record<string, unknown>) => {
  edges.push({ from, to, type, props });
};

/* -------------------------------------------------------------------------- */
/* 1. Interests — a shallow DAG, the pivot for everything else                */
/* -------------------------------------------------------------------------- */

const INTERESTS: [string, string[]][] = [
  ["Computer Science", []],
  ["Biology", []],
  ["Mathematics", []],
  ["Systems", ["Computer Science"]],
  ["Networking", ["Systems"]],
  ["Distributed Systems", ["Systems"]],
  ["Security", ["Computer Science", "Cryptography"]],
  ["Cryptography", ["Mathematics"]],
  ["Machine Learning", ["Computer Science", "Statistics"]],
  ["Statistics", ["Mathematics"]],
  ["Natural Language Processing", ["Machine Learning"]],
  ["Computer Vision", ["Machine Learning"]],
  ["Computational Biology", ["Biology", "Computer Science"]],
  ["Genomics", ["Computational Biology"]],
  ["Protein Structure", ["Computational Biology"]],
  ["Neuroscience", ["Biology"]],
  ["Ecology", ["Biology"]],
  ["Human-Computer Interaction", ["Computer Science"]],
  ["Databases", ["Systems"]],
  ["Programming Languages", ["Computer Science"]],
  ["Numerical Analysis", ["Mathematics"]],
  ["Bioinformatics Tooling", ["Computational Biology", "Databases"]],
];

const interestId = (name: string) => `int-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
for (const [name] of INTERESTS) node(interestId(name), ["Interest"], { name });
for (const [name, parents] of INTERESTS) {
  for (const p of parents) edge(interestId(name), "SUBFIELD_OF", interestId(p));
}
const allInterests = INTERESTS.map(([n]) => n);

/* -------------------------------------------------------------------------- */
/* 2. Departments                                                             */
/* -------------------------------------------------------------------------- */

const ACADEMIC = [
  { id: "dept-cs", name: "Computer Science", kind: "academic" },
  { id: "dept-bio", name: "Biology", kind: "academic" },
  { id: "dept-math", name: "Mathematics", kind: "academic" },
];
const ADMIN = [
  { id: "dept-admissions", name: "Admissions", kind: "administrative" },
  { id: "dept-finance", name: "Finance", kind: "administrative" },
  { id: "dept-hr", name: "Human Resources", kind: "administrative" },
  { id: "dept-deans", name: "Dean's Office", kind: "administrative" },
  { id: "dept-registrar", name: "Registrar", kind: "administrative" },
];
for (const d of [...ACADEMIC, ...ADMIN]) node(d.id, ["Department"], { name: d.name, kind: d.kind });

/* department goals — the dean's layer */
const DEPT_GOALS: [string, string, string][] = [
  ["dept-cs", "Double undergraduate research placements by 2027", "Computational Biology"],
  ["dept-cs", "Launch a security certificate track", "Security"],
  ["dept-bio", "Cross-list computational methods into the core", "Computational Biology"],
  ["dept-math", "Raise statistics enrollment among non-majors", "Statistics"],
];
DEPT_GOALS.forEach(([dept, title, interest], i) => {
  const id = `goal-dept-${i + 1}`;
  node(id, ["Goal"], { name: title, type: "degree", horizon: "2027" });
  edge(dept, "OWNS", id);
  edge(id, "ABOUT", interestId(interest));
});

/* -------------------------------------------------------------------------- */
/* 3. Terms                                                                    */
/* -------------------------------------------------------------------------- */

node("term-f25", ["Term"], { name: "Fall 2025", starts: "2025-09-02", ends: "2025-12-18" });
node("term-s26", ["Term"], { name: "Spring 2026", starts: "2026-01-20", ends: "2026-05-08" });

/* -------------------------------------------------------------------------- */
/* 4. People                                                                   */
/* -------------------------------------------------------------------------- */

const FIRST = ["Amara","Noor","Diego","Wei","Priya","Tomas","Ines","Kofi","Lena","Rafael","Mina","Jonas","Sofia","Amir","Yuki","Hana","Oscar","Nadia","Emil","Chen","Layla","Marcus","Elif","Ravi","Clara","Dmitri","Aisha","Felix","Rosa","Ken","Tara","Owen","Mira","Luca","Zoe","Ibrahim","Nina","Paolo","Sana","Theo","Greta","Hugo","Iris","Jae","Kara","Liam","Maya","Nico","Opal","Pedro"];
const LAST = ["Okonkwo","Haddad","Rivera","Zhang","Nair","Costa","Alvarez","Mensah","Novak","Duarte","Farrokh","Lindqvist","Moreau","Rahimi","Tanaka","Kim","Berg","Salih","Andersen","Liu","Haddadi","Webb","Demir","Iyer","Fontaine","Sokolov","Bello","Braun","Marino","Sato","Volkov","Doyle","Patel","Ferrari","Kowalski","Osei","Larsen","Bianchi","Qureshi","Marchetti","Olsen","Weiss","Nyberg","Park","Lindberg","Byrne","Sharma","Ricci","Vance","Silva"];

let nameIdx = 0;
function personName(): string {
  const n = `${FIRST[nameIdx % FIRST.length]} ${LAST[(nameIdx * 7) % LAST.length]}`;
  nameIdx++;
  return n;
}

interface P { id: string; name: string; role: string; subrole: string | null; dept: string }
const faculty: P[] = [];
const students: P[] = [];
const staff: P[] = [];

function makePerson(
  id: string,
  role: string,
  subrole: string | null,
  dept: string,
  extra: Record<string, unknown> = {},
): P {
  const name = (extra.name as string) ?? personName();
  node(id, ["Person"], {
    name,
    role,
    subrole,
    email: `${id}@university.edu`,
    phone: `+1-555-${String(1000 + nameIdx).slice(-4)}`,
    ...extra,
  });
  edge(id, "WORKS_IN", dept);
  return { id, name, role, subrole, dept };
}

/* faculty: 15 across the three academic departments */
const FACULTY_PLAN: [string, string][] = [
  ["dept-cs", "prof"], ["dept-cs", "prof"], ["dept-cs", "assoc_prof"], ["dept-cs", "assoc_prof"],
  ["dept-cs", "phd_student"], ["dept-cs", "phd_student"], ["dept-cs", "phd_student"],
  ["dept-bio", "prof"], ["dept-bio", "assoc_prof"], ["dept-bio", "phd_student"], ["dept-bio", "phd_student"],
  ["dept-math", "prof"], ["dept-math", "assoc_prof"], ["dept-math", "phd_student"], ["dept-math", "prof"],
];
FACULTY_PLAN.forEach(([dept, subrole], i) => {
  faculty.push(makePerson(`fac-${i + 1}`, "faculty", subrole, dept, { title: subrole === "phd_student" ? "PhD Student" : subrole === "prof" ? "Professor" : "Associate Professor" }));
});

/* the hero: a sophomore into computational biology */
const HERO_ID = "stu-1";
students.push(
  makePerson(HERO_ID, "student", null, "dept-cs", {
    name: "Amara Okonkwo",
    year: 2,
    program: "BS Computer Science",
    standing: "sophomore",
  }),
);
for (let i = 2; i <= 40; i++) {
  students.push(
    makePerson(`stu-${i}`, "student", null, pick(ACADEMIC).id, {
      year: 1 + Math.floor(rnd() * 4),
      program: pick(["BS Computer Science", "BS Biology", "BS Mathematics", "BA Cognitive Science"]),
    }),
  );
}

/* staff: 10 across the admin departments */
const STAFF_PLAN: [string, string][] = [
  ["dept-admissions", "admissions"], ["dept-admissions", "admissions"], ["dept-admissions", "admissions"],
  ["dept-finance", "finance"], ["dept-finance", "finance"],
  ["dept-hr", "hr"], ["dept-hr", "hr"],
  ["dept-deans", "deans_office"], ["dept-deans", "deans_office"],
  ["dept-registrar", "registrar"],
];
STAFF_PLAN.forEach(([dept, subrole], i) => {
  staff.push(makePerson(`staff-${i + 1}`, "staff", subrole, dept, { title: subrole.replace(/_/g, " ") }));
});

/* -------------------------------------------------------------------------- */
/* 5. Courses, offerings, prereqs, assignments                                */
/* -------------------------------------------------------------------------- */

const COURSES: { code: string; title: string; dept: string; interests: string[]; prereq?: string }[] = [
  { code: "CSC 101", title: "Introduction to Computing", dept: "dept-cs", interests: ["Computer Science", "Programming Languages"] },
  { code: "CSC 201", title: "Data Structures", dept: "dept-cs", interests: ["Computer Science", "Programming Languages"], prereq: "CSC 101" },
  { code: "CSC 210", title: "Computer Systems", dept: "dept-cs", interests: ["Systems"], prereq: "CSC 101" },
  { code: "CSC 301", title: "Computer Networks", dept: "dept-cs", interests: ["Networking", "Systems"], prereq: "CSC 210" },
  { code: "CSC 305", title: "Distributed Systems", dept: "dept-cs", interests: ["Distributed Systems", "Systems"], prereq: "CSC 210" },
  { code: "CSC 310", title: "Introduction to Security", dept: "dept-cs", interests: ["Security"], prereq: "CSC 210" },
  { code: "CSC 315", title: "Applied Cryptography", dept: "dept-cs", interests: ["Cryptography", "Security"], prereq: "CSC 310" },
  { code: "CSC 320", title: "Databases", dept: "dept-cs", interests: ["Databases"], prereq: "CSC 201" },
  { code: "CSC 330", title: "Machine Learning", dept: "dept-cs", interests: ["Machine Learning", "Statistics"], prereq: "CSC 201" },
  { code: "CSC 335", title: "Natural Language Processing", dept: "dept-cs", interests: ["Natural Language Processing"], prereq: "CSC 330" },
  { code: "CSC 340", title: "Computer Vision", dept: "dept-cs", interests: ["Computer Vision"], prereq: "CSC 330" },
  { code: "CSC 350", title: "Human-Computer Interaction", dept: "dept-cs", interests: ["Human-Computer Interaction"] },
  { code: "BIO 101", title: "Foundations of Biology", dept: "dept-bio", interests: ["Biology"] },
  { code: "BIO 210", title: "Genetics", dept: "dept-bio", interests: ["Biology", "Genomics"], prereq: "BIO 101" },
  { code: "BIO 305", title: "Computational Genomics", dept: "dept-bio", interests: ["Computational Biology", "Genomics"], prereq: "BIO 210" },
  { code: "BIO 320", title: "Protein Structure & Function", dept: "dept-bio", interests: ["Protein Structure", "Computational Biology"], prereq: "BIO 210" },
  { code: "BIO 340", title: "Neurobiology", dept: "dept-bio", interests: ["Neuroscience"], prereq: "BIO 101" },
  { code: "MAT 150", title: "Linear Algebra", dept: "dept-math", interests: ["Mathematics", "Numerical Analysis"] },
  { code: "MAT 220", title: "Probability & Statistics", dept: "dept-math", interests: ["Statistics", "Mathematics"], prereq: "MAT 150" },
  { code: "MAT 310", title: "Number Theory & Cryptography", dept: "dept-math", interests: ["Cryptography", "Mathematics"], prereq: "MAT 150" },
];

const courseId = (code: string) => `crs-${code.toLowerCase().replace(/\s+/g, "")}`;
for (const c of COURSES) {
  node(courseId(c.code), ["Course"], { code: c.code, name: `${c.code} ${c.title}`, title: c.title, credits: 3 });
  edge(courseId(c.code), "OFFERED_BY", c.dept);
  for (const i of c.interests) edge(courseId(c.code), "COVERS", interestId(i));
}
for (const c of COURSES) if (c.prereq) edge(courseId(c.prereq), "PREREQ_OF", courseId(c.code));

/* offerings: every course in Fall 2025, half again in Spring 2026 */
const ASSIGNMENT_NAMES = ["Problem Set 1", "Problem Set 2", "Midterm Project", "Final Project"];
const offerings: { id: string; course: string; term: string; instructor: string }[] = [];
let offIdx = 0;
for (const c of COURSES) {
  const terms = rnd() > 0.5 ? ["term-f25", "term-s26"] : ["term-f25"];
  for (const term of terms) {
    offIdx++;
    const id = `off-${offIdx}`;
    const deptFaculty = faculty.filter((f) => f.dept === c.dept && f.subrole !== "phd_student");
    const instructor = deptFaculty.length ? pick(deptFaculty) : pick(faculty);
    const termName = term === "term-f25" ? "Fall 2025" : "Spring 2026";
    node(id, ["Offering"], {
      name: `${c.code} (${termName})`,
      section: `00${1 + Math.floor(rnd() * 2)}`,
      capacity: 30 + Math.floor(rnd() * 90),
      meets: pick(["MWF 09:00", "TTh 11:00", "MW 14:00", "TTh 15:30"]),
    });
    edge(id, "OF_COURSE", courseId(c.code));
    edge(id, "IN_TERM", term);
    edge(instructor.id, "TEACHES", id);
    offerings.push({ id, course: c.code, term, instructor: instructor.id });

    /* a TA for some offerings */
    const phds = faculty.filter((f) => f.subrole === "phd_student" && f.dept === c.dept);
    if (phds.length && rnd() > 0.35) edge(pick(phds).id, "TAS", id);

    /* assignments with real due dates so the Calendar has something to show */
    const base = term === "term-f25" ? new Date("2025-09-22") : new Date("2026-02-09");
    ASSIGNMENT_NAMES.forEach((an, ai) => {
      const due = new Date(base.getTime() + (ai * 21 + Math.floor(rnd() * 5)) * 86400000);
      const aid = `asg-${offIdx}-${ai + 1}`;
      node(aid, ["Assignment"], {
        name: `${c.code} — ${an}`,
        title: an,
        dueAt: due.toISOString().slice(0, 10),
        points: 100,
      });
      edge(id, "HAS", aid);
    });
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Labs, papers, positions                                                 */
/* -------------------------------------------------------------------------- */

const LABS = [
  { id: "lab-compbio", name: "Computational Biology Lab", dept: "dept-bio", interests: ["Computational Biology", "Genomics", "Protein Structure"] },
  { id: "lab-genomics", name: "Genome Informatics Group", dept: "dept-bio", interests: ["Genomics", "Bioinformatics Tooling", "Machine Learning"] },
  { id: "lab-systems", name: "Systems Lab", dept: "dept-cs", interests: ["Systems", "Distributed Systems", "Networking"] },
  { id: "lab-security", name: "Security & Privacy Lab", dept: "dept-cs", interests: ["Security", "Cryptography"] },
  { id: "lab-nlp", name: "Language & Learning Lab", dept: "dept-cs", interests: ["Natural Language Processing", "Machine Learning"] },
  { id: "lab-neuro", name: "Neural Circuits Lab", dept: "dept-bio", interests: ["Neuroscience", "Computer Vision"] },
];

const PAPER_TITLES: Record<string, string[]> = {
  "lab-compbio": ["Structure-aware embeddings for protein function prediction", "A benchmark for single-cell trajectory inference"],
  "lab-genomics": ["Scalable variant calling on commodity hardware", "Indexing pangenomes for interactive query"],
  "lab-systems": ["Tail latency in geo-replicated key-value stores", "Rethinking congestion control for campus networks"],
  "lab-security": ["Side channels in shared research clusters", "Usable key management for small labs"],
  "lab-nlp": ["Instruction tuning on a single GPU budget", "Grounded question answering over institutional graphs"],
  "lab-neuro": ["Automated segmentation of dendritic spines", "Population coding in visual cortex under sparse input"],
};

const POSITIONS = [
  { lab: "lab-compbio", title: "Undergraduate Research Assistant — protein structure", level: "undergraduate", hours: "10 hrs/week", open: true },
  { lab: "lab-compbio", title: "Summer Research Fellow — genomics pipelines", level: "undergraduate", hours: "full-time (summer)", open: true },
  { lab: "lab-genomics", title: "Undergraduate Data Assistant", level: "undergraduate", hours: "8 hrs/week", open: true },
  { lab: "lab-systems", title: "Undergraduate Research Assistant — distributed tracing", level: "undergraduate", hours: "10 hrs/week", open: true },
  { lab: "lab-security", title: "Research Intern — applied cryptography", level: "undergraduate", hours: "12 hrs/week", open: true },
  { lab: "lab-nlp", title: "PhD Rotation Slot", level: "graduate", hours: "full-time", open: true },
  { lab: "lab-neuro", title: "Undergraduate Imaging Assistant", level: "undergraduate", hours: "6 hrs/week", open: false },
];

/* The demo path at 1:15 — "your CSC101 prof runs Systems Lab, your TA is in it" —
   has to be true in the data, not narrated over it. */
const csc101 = offerings.find((o) => o.course === "CSC 101" && o.term === "term-f25")!;
const systemsTa = faculty.find((f) => f.subrole === "phd_student" && f.dept === "dept-cs")!;
edge(systemsTa.id, "TAS", csc101.id);

LABS.forEach((lab, li) => {
  node(lab.id, ["Lab"], {
    name: lab.name,
    summary: `${lab.name} — ${lab.interests.join(", ")}.`,
    room: `${pick(["Turing", "Franklin", "Hopper", "Mendel"])} ${200 + li * 11}`,
  });
  edge(lab.id, "AFFILIATED_WITH", lab.dept);
  for (const i of lab.interests) edge(lab.id, "FOCUSES_ON", interestId(i));

  const deptFaculty = faculty.filter((f) => f.dept === lab.dept && f.subrole !== "phd_student");
  const pi =
    lab.id === "lab-systems"
      ? faculty.find((f) => f.id === csc101.instructor)!
      : deptFaculty.length
        ? deptFaculty[li % deptFaculty.length]
        : faculty[li];
  edge(pi.id, "PI_OF", lab.id);
  edge(pi.id, "MEMBER_OF", lab.id);

  const members = [
    ...(lab.id === "lab-systems" ? [systemsTa] : []),
    ...pickN(faculty.filter((f) => f.subrole === "phd_student" && f.id !== systemsTa.id), 2),
    ...pickN(students.slice(1), 3),
  ];
  for (const m of members) edge(m.id, "MEMBER_OF", lab.id);

  PAPER_TITLES[lab.id].forEach((title, pi2) => {
    const id = `paper-${lab.id}-${pi2 + 1}`;
    node(id, ["Paper"], { name: title, title, year: 2024 + pi2, venue: pick(["NeurIPS", "SIGCOMM", "RECOMB", "CCS", "CHI"]) });
    edge(id, "FROM_LAB", lab.id);
    edge(pi.id, "AUTHORED", id);
    for (const m of pickN(members, 2)) edge(m.id, "AUTHORED", id);
    for (const i of pickN(lab.interests, 2)) edge(id, "ON", interestId(i));
  });
});

POSITIONS.forEach((p, i) => {
  const id = `pos-${i + 1}`;
  node(id, ["Position"], { name: p.title, title: p.title, level: p.level, hours: p.hours, open: p.open, postedAt: "2025-09-01" });
  edge(p.lab, "HAS_OPENING", id);
});

/* -------------------------------------------------------------------------- */
/* 7. Clubs                                                                    */
/* -------------------------------------------------------------------------- */

const CLUBS = [
  { id: "club-bioinfo", name: "Bioinformatics Club", interests: ["Computational Biology", "Bioinformatics Tooling"] },
  { id: "club-sec", name: "Cyber Defense Team", interests: ["Security", "Cryptography"] },
  { id: "club-ml", name: "Machine Learning Society", interests: ["Machine Learning", "Natural Language Processing"] },
  { id: "club-systems", name: "Open Systems Collective", interests: ["Systems", "Distributed Systems"] },
  { id: "club-women-cs", name: "Women in Computing", interests: ["Computer Science"] },
  { id: "club-math", name: "Math Circle", interests: ["Mathematics", "Numerical Analysis"] },
  { id: "club-hci", name: "Design & Interaction Guild", interests: ["Human-Computer Interaction"] },
  { id: "club-eco", name: "Field Ecology Society", interests: ["Ecology", "Biology"] },
];
for (const c of CLUBS) {
  node(c.id, ["Club"], { name: c.name, summary: `Student organization focused on ${c.interests.join(" and ")}.` });
  for (const i of c.interests) edge(c.id, "CENTERED_ON", interestId(i));
  for (const m of pickN(students, 6)) edge(m.id, "MEMBER_OF", c.id);
}

/* -------------------------------------------------------------------------- */
/* 8. Events                                                                   */
/* -------------------------------------------------------------------------- */

const EVENTS = [
  { host: "lab-compbio", name: "Seminar: Protein folding at scale", kind: "seminar", at: "2025-11-18T16:00", interests: ["Protein Structure", "Computational Biology"] },
  { host: "lab-genomics", name: "Workshop: Genomics pipelines in practice", kind: "workshop", at: "2025-11-20T14:00", interests: ["Genomics"] },
  { host: "lab-systems", name: "Systems Lab open house", kind: "open_house", at: "2025-11-21T15:00", interests: ["Systems"] },
  { host: "lab-security", name: "Seminar: Side channels in shared clusters", kind: "seminar", at: "2025-11-25T16:00", interests: ["Security"] },
  { host: "lab-nlp", name: "Reading group: instruction tuning", kind: "reading_group", at: "2025-11-19T17:00", interests: ["Natural Language Processing"] },
  { host: "lab-neuro", name: "Imaging methods demo", kind: "demo", at: "2025-12-02T13:00", interests: ["Neuroscience"] },
  { host: "club-bioinfo", name: "Intro to sequence alignment (hands-on)", kind: "workshop", at: "2025-11-19T18:00", interests: ["Computational Biology"] },
  { host: "club-sec", name: "CTF practice night", kind: "meetup", at: "2025-11-24T19:00", interests: ["Security"] },
  { host: "club-ml", name: "Paper night: attention revisited", kind: "meetup", at: "2025-11-26T18:30", interests: ["Machine Learning"] },
  { host: "club-systems", name: "Hack night: build a tiny database", kind: "meetup", at: "2025-12-03T18:00", interests: ["Databases", "Systems"] },
  { host: "dept-cs", name: "CS undergraduate research info session", kind: "info_session", at: "2025-11-17T17:00", interests: ["Computer Science"] },
  { host: "dept-bio", name: "Biology research fair", kind: "fair", at: "2025-12-05T12:00", interests: ["Biology", "Computational Biology"] },
  { host: "dept-admissions", name: "Fall open house (prospective students)", kind: "open_house", at: "2025-11-22T10:00", interests: [] },
  { host: "dept-admissions", name: "Early decision deadline", kind: "deadline", at: "2025-11-30T23:59", interests: [] },
  { host: "dept-deans", name: "State of the college address", kind: "address", at: "2025-12-08T15:00", interests: [] },
];
EVENTS.forEach((e, i) => {
  const id = `evt-${i + 1}`;
  node(id, ["Event"], {
    name: e.name,
    kind: e.kind,
    startsAt: e.at,
    location: pick(["Turing 210", "Mendel Hall 105", "Franklin Atrium", "Online"]),
  });
  edge(e.host, "HOSTS", id);
  for (const int of e.interests) edge(id, "ON", interestId(int));
});

/* -------------------------------------------------------------------------- */
/* 9. Enrollment + interests + goals + advising                               */
/* -------------------------------------------------------------------------- */

/* the hero's story: comp-bio sophomore in CSC 101 and BIO 101 */
const heroCourses = ["CSC 101", "BIO 101", "MAT 150"];
for (const code of heroCourses) {
  const off = offerings.find((o) => o.course === code && o.term === "term-f25")!;
  edge(HERO_ID, "ENROLLED_IN", off.id, { status: "active" });
}
[
  ["Computational Biology", 0.95],
  ["Genomics", 0.8],
  ["Machine Learning", 0.6],
  ["Protein Structure", 0.55],
].forEach(([name, strength]) => edge(HERO_ID, "INTERESTED_IN", interestId(name as string), { strength }));

node("goal-hero-1", ["Goal"], {
  name: "Join a computational biology lab by spring",
  type: "research",
  horizon: "Spring 2026",
});
edge(HERO_ID, "OWNS", "goal-hero-1");
edge("goal-hero-1", "ABOUT", interestId("Computational Biology"));

node("goal-hero-2", ["Goal"], {
  name: "Build enough ML background to read genomics papers",
  type: "degree",
  horizon: "2026",
});
edge(HERO_ID, "OWNS", "goal-hero-2");
edge("goal-hero-2", "ABOUT", interestId("Machine Learning"));

/* the hero's advisor, and a lab path worth demoing */
const heroAdvisor = faculty.find((f) => f.dept === "dept-cs" && f.subrole === "prof")!;
edge(heroAdvisor.id, "ADVISES", HERO_ID);

/* everyone else: enrollments, interests, goals */
for (const s of students.slice(1)) {
  for (const off of pickN(offerings.filter((o) => o.term === "term-f25"), 2 + Math.floor(rnd() * 3))) {
    edge(s.id, "ENROLLED_IN", off.id, { status: "active" });
  }
  for (const i of pickN(allInterests, 1 + Math.floor(rnd() * 3))) {
    edge(s.id, "INTERESTED_IN", interestId(i), { strength: round2(0.3 + rnd() * 0.7) });
  }
  if (rnd() > 0.5) {
    const g = `goal-${s.id}`;
    const about = pick(allInterests);
    node(g, ["Goal"], {
      name: pick([`Get research experience in ${about}`, `Complete the ${about} track`, `Find an internship in ${about}`]),
      type: pick(["research", "degree", "career"]),
      horizon: pick(["2026", "Spring 2026", "2027"]),
    });
    edge(s.id, "OWNS", g);
    edge(g, "ABOUT", interestId(about));
  }
  if (rnd() > 0.6) edge(pick(faculty.filter((f) => f.subrole !== "phd_student")).id, "ADVISES", s.id);
}

for (const f of faculty) {
  const pool = f.dept === "dept-cs"
    ? ["Computer Science", "Systems", "Security", "Machine Learning", "Databases", "Networking", "Natural Language Processing", "Computational Biology"]
    : f.dept === "dept-bio"
      ? ["Biology", "Genomics", "Computational Biology", "Neuroscience", "Protein Structure", "Ecology"]
      : ["Mathematics", "Statistics", "Cryptography", "Numerical Analysis"];
  for (const i of pickN(pool, 2 + Math.floor(rnd() * 2))) {
    edge(f.id, "INTERESTED_IN", interestId(i), { strength: round2(0.6 + rnd() * 0.4) });
  }
}

/* make the hero's neighbourhood definitely land: the comp-bio PI and a TA */
const compbioPi = "fac-8"; // dept-bio prof
edge(compbioPi, "INTERESTED_IN", interestId("Computational Biology"), { strength: 1.0 });
edge(compbioPi, "INTERESTED_IN", interestId("Protein Structure"), { strength: 0.9 });

/* -------------------------------------------------------------------------- */
/* 10. Restricted layer: applications, finance, HR                            */
/* -------------------------------------------------------------------------- */

const STAGES = ["received", "in_review", "interview", "decision_pending", "admitted", "waitlisted"];
const applicants: string[] = [];
for (let i = 1; i <= 10; i++) {
  const pid = `app-person-${i}`;
  makePerson(pid, "student", null, "dept-admissions", { name: personName(), applicant: true, year: 0, program: "Prospective" });
  applicants.push(pid);
  const id = `appl-${i}`;
  node(id, ["Application"], {
    name: `Application ${String(i).padStart(3, "0")}`,
    stage: STAGES[i % STAGES.length],
    program: pick(["BS Computer Science", "BS Biology", "BS Mathematics"]),
    submittedAt: `2025-10-${String(5 + i).padStart(2, "0")}`,
    gpa: round2(3 + rnd()),
    ssnLast4: String(1000 + Math.floor(rnd() * 8999)).slice(-4),
  });
  edge(id, "SUBMITTED_BY", pid);
  edge(id, "REVIEWED_BY", staff[i % 3].id);
}

for (const p of [...faculty, ...staff]) {
  const hid = `hr-${p.id}`;
  node(hid, ["HRRecord"], {
    name: `HR record — ${p.name}`,
    employmentType: p.subrole === "phd_student" ? "stipend" : "salaried",
    salaryBand: pick(["A", "B", "C", "D"]),
    startDate: `20${18 + Math.floor(rnd() * 7)}-08-15`,
  });
  edge(p.id, "HAS_HR", hid);
}

for (const s of students) {
  const fid = `fin-${s.id}`;
  node(fid, ["FinanceRecord"], {
    name: `Student account — ${s.name}`,
    tuitionBalance: Math.floor(rnd() * 20000),
    aidPackage: Math.floor(rnd() * 30000),
    term: "Fall 2025",
  });
  edge(s.id, "HAS_FINANCE", fid);
}
for (const d of ACADEMIC) {
  const fid = `fin-${d.id}`;
  node(fid, ["FinanceRecord"], {
    name: `Department budget — ${d.name}`,
    budget: 1_200_000 + Math.floor(rnd() * 800_000),
    fiscalYear: "FY2026",
  });
  edge(d.id, "HAS_FINANCE", fid);
}

export const HERO = HERO_ID;
export const GRAPH = { nodes, edges };

export const DEMO_LOGINS = [
  { id: HERO_ID, label: "Amara Okonkwo — sophomore, computational biology" },
  { id: heroAdvisor.id, label: "Faculty — Professor (CS), advisor & PI" },
  { id: faculty.find((f) => f.subrole === "phd_student")!.id, label: "PhD student — TA & lab member" },
  { id: staff[0].id, label: "Staff — Admissions" },
  { id: staff[3].id, label: "Staff — Finance" },
  { id: staff[5].id, label: "Staff — HR" },
  { id: staff[7].id, label: "Staff — Dean's Office" },
];
