import type { CourseOffering } from "../types.js";

// A simulated registrar feed. A real Canvas/SIS integration is deliberately
// out of scope; what matters for the graph is the shape of what it returns,
// and that is what this matches — so replacing the catalogue with a real
// feed changes this file and nothing downstream of it.
export const COURSE_CATALOG: CourseOffering[] = [
  {
    code: "6.1200",
    title: "Mathematics for Computer Science",
    term: "Fall 2025",
    description: "Discrete mathematics, proof technique, probability, and graph theory for computer science.",
    startsOn: "2025-09-03",
    endsOn: "2025-12-12",
  },
  {
    code: "6.3900",
    title: "Introduction to Machine Learning",
    term: "Fall 2025",
    description: "Supervised and unsupervised learning, regression, classification, neural networks, generalisation.",
    startsOn: "2025-09-03",
    endsOn: "2025-12-12",
  },
  {
    code: "6.5830",
    title: "Database Systems",
    term: "Fall 2025",
    description: "Query processing, transactions, concurrency control, storage engines, distributed databases.",
    startsOn: "2025-09-03",
    endsOn: "2025-12-12",
  },
  {
    code: "6.8610",
    title: "Quantitative Methods for Natural Language Processing",
    term: "Spring 2026",
    description: "Language modelling, sequence transduction, representation learning, and evaluation for NLP.",
    startsOn: "2026-02-02",
    endsOn: "2026-05-15",
  },
  {
    code: "6.4200",
    title: "Robotics: Science and Systems",
    term: "Spring 2026",
    description: "Perception, planning, control, and state estimation on real autonomous robot platforms.",
    startsOn: "2026-02-02",
    endsOn: "2026-05-15",
  },
  {
    code: "6.1810",
    title: "Operating System Engineering",
    term: "Fall 2025",
    description: "Kernel design, virtual memory, scheduling, file systems, and concurrency in a teaching OS.",
    startsOn: "2025-09-03",
    endsOn: "2025-12-12",
  },
  {
    code: "6.5660",
    title: "Computer Systems Security",
    term: "Spring 2026",
    description: "Threat models, memory safety attacks, cryptographic protocols, web and network security.",
    startsOn: "2026-02-02",
    endsOn: "2026-05-15",
  },
  {
    code: "2.008",
    title: "Design and Manufacturing II",
    term: "Spring 2026",
    description: "Injection moulding, sheet metal forming, process control, and design for manufacturability.",
    startsOn: "2026-02-02",
    endsOn: "2026-05-15",
  },
  {
    code: "6.3000",
    title: "Signal Processing",
    term: "Fall 2025",
    description: "Discrete-time signals, Fourier analysis, filtering, sampling, and feedback systems.",
    startsOn: "2025-09-03",
    endsOn: "2025-12-12",
  },
  {
    code: "9.40",
    title: "Introduction to Neural Computation",
    term: "Spring 2026",
    description: "Biophysics of neurons, neural coding, synaptic plasticity, and models of neural circuits.",
    startsOn: "2026-02-02",
    endsOn: "2026-05-15",
  },
  {
    code: "15.390",
    title: "New Enterprises",
    term: "Fall 2025",
    description: "Customer discovery, market sizing, product-market fit, and early-stage venture strategy.",
    startsOn: "2025-09-03",
    endsOn: "2025-12-12",
  },
  {
    code: "20.109",
    title: "Laboratory Fundamentals in Biological Engineering",
    term: "Spring 2026",
    description: "Molecular cloning, protein engineering, assay design, and quantitative experimental analysis.",
    startsOn: "2026-02-02",
    endsOn: "2026-05-15",
  },
  {
    code: "4.500",
    title: "Design Computation",
    term: "Fall 2025",
    description: "Computational geometry, parametric modelling, and fabrication workflows for design.",
    startsOn: "2025-09-03",
    endsOn: "2025-12-12",
  },
  {
    code: "18.065",
    title: "Matrix Methods in Data Analysis and Signal Processing",
    term: "Spring 2026",
    description: "Linear algebra applied to least squares, SVD, optimisation, and learning from data.",
    startsOn: "2026-02-02",
    endsOn: "2026-05-15",
  },
];

export function findOffering(code: string): CourseOffering | undefined {
  return COURSE_CATALOG.find((c) => c.code.toLowerCase() === code.trim().toLowerCase());
}

// The manual path: a pasted transcript, one course per line, as
// `CODE, Title, Term` — anything a registrar export or a student's own notes
// can be coerced into in ten seconds. Fields after the code are optional and
// filled from the catalogue when the code is known.
export function parseCourseLines(text: string): CourseOffering[] {
  const out: CourseOffering[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(course|code)\s*[,;]/i.test(trimmed)) continue; // skip a CSV header

    const fields = trimmed.split(/\s*[,;\t]\s*/).filter(Boolean);
    if (fields.length === 0) continue;

    const known = findOffering(fields[0]);
    const code = fields[0];
    const title = fields[1] ?? known?.title ?? code;
    const term = fields[2] ?? known?.term ?? "";

    out.push({
      code,
      title,
      term,
      description: known?.description ?? title,
      startsOn: known?.startsOn ?? "",
      endsOn: known?.endsOn ?? "",
    });
  }

  return out;
}
