/**
 * Deterministic planner used while LLM_BASE_URL is unset (i.e. before the GPU
 * host is available). It is NOT a model: it maps a query to the same scoped
 * graph tools the model would call, so the demo path, the RBAC behaviour and
 * the rendered subgraph are all real. Point LLM_BASE_URL at vLLM and this file
 * stops being reached.
 */

import type { Scope } from "@/lib/auth/roles";

export interface PlanStep {
  name: string;
  args: Record<string, unknown>;
}

/** Interest vocabulary, with the phrasings people actually type. */
const VOCAB: [string, string[]][] = [
  ["Computational Biology", ["computational biology", "comp bio", "compbio", "computational bio", "bioinformatics"]],
  ["Genomics", ["genomics", "genome", "sequencing"]],
  ["Protein Structure", ["protein", "folding", "structural biology"]],
  ["Machine Learning", ["machine learning", "ml", "deep learning"]],
  ["Natural Language Processing", ["nlp", "natural language", "language model"]],
  ["Computer Vision", ["computer vision", "vision", "imaging"]],
  ["Security", ["security", "infosec", "ctf", "privacy"]],
  ["Cryptography", ["cryptography", "crypto", "encryption"]],
  ["Systems", ["systems", "operating system", "low level"]],
  ["Distributed Systems", ["distributed", "replication", "consensus"]],
  ["Networking", ["networking", "networks", "congestion"]],
  ["Databases", ["database", "databases", "sql", "query engine"]],
  ["Human-Computer Interaction", ["hci", "human-computer", "interaction design", "ux"]],
  ["Neuroscience", ["neuro", "neuroscience", "brain"]],
  ["Ecology", ["ecology", "field biology", "environment"]],
  ["Statistics", ["statistics", "stats", "probability"]],
  ["Mathematics", ["math", "mathematics"]],
  ["Biology", ["biology", "bio"]],
  ["Computer Science", ["computer science", "cs", "computing"]],
  ["Programming Languages", ["programming languages", "compilers"]],
  ["Numerical Analysis", ["numerical", "linear algebra"]],
  ["Bioinformatics Tooling", ["pipeline", "tooling", "workflow"]],
];

function interestsIn(q: string): string[] {
  const lower = ` ${q.toLowerCase()} `;
  const hits: string[] = [];
  for (const [canonical, phrases] of VOCAB) {
    if (phrases.some((p) => lower.includes(p.length <= 3 ? ` ${p} ` : p))) hits.push(canonical);
  }
  return hits;
}

const LABEL_HINTS: [string, string[]][] = [
  ["Lab", ["lab", "labs", "research group", "research"]],
  ["Position", ["opening", "openings", "position", "positions", "slot", "job", "hiring", "undergrad"]],
  ["Course", ["course", "courses", "class", "classes", "take"]],
  ["Club", ["club", "clubs", "society", "student org", "organization"]],
  ["Event", ["event", "events", "seminar", "talk", "workshop", "info session", "this week"]],
  ["Person", ["who", "people", "professor", "faculty", "student", "pi", "advisor"]],
  ["Paper", ["paper", "papers", "publication", "published"]],
  ["Application", ["application", "applications", "applicant", "pipeline", "admission"]],
  ["FinanceRecord", ["budget", "tuition", "finance", "financial", "aid"]],
  ["HRRecord", ["hr", "employment", "salary", "payroll", "staffing"]],
  ["Goal", ["goal", "goals", "objective"]],
];

function labelsIn(q: string): string[] {
  const lower = ` ${q.toLowerCase()} `;
  const hits: string[] = [];
  for (const [label, phrases] of LABEL_HINTS) {
    if (phrases.some((p) => lower.includes(p.length <= 3 ? ` ${p} ` : p))) hits.push(label);
  }
  return hits;
}

export function planWithoutLLM(ctx: Scope, query: string): PlanStep[] {
  const q = query.toLowerCase();
  const interests = interestsIn(q);
  const labels = labelsIn(q);

  /* "how am I connected to X" */
  if (/how (am|is|are) .* connected|connection between|path (to|from)|how do i (know|reach)/.test(q)) {
    return [
      { name: "search_nodes", args: { query_terms: query, limit: 5 } },
      { name: "recommend_for_person", args: { person_id: ctx.personId, limit: 10 } },
    ];
  }

  /* "where do I fit" / recommendations */
  if (/where (do|should) i fit|recommend|suggest|what should i|good fit|for me\b/.test(q) || (!interests.length && !labels.length)) {
    return [
      {
        name: "recommend_for_person",
        args: {
          person_id: ctx.personId,
          target_labels: labels.length ? labels : undefined,
          limit: 20,
        },
      },
    ];
  }

  /* interest-driven discovery — the common case */
  if (interests.length) {
    const targets = labels.length ? labels : ["Lab", "Course", "Club", "Event", "Person", "Position", "Paper"];
    /* asking about joining something implies the lab's openings and its PI */
    const enriched = /opening|position|slot|undergrad|join|research group/.test(q)
      ? [...new Set([...targets, "Lab", "Position", "Person"])]
      : targets;
    return [
      {
        name: "nodes_by_interest",
        args: { interest_names: interests, target_labels: enriched, expand_subfields: true, limit: 50 },
      },
    ];
  }

  return [{ name: "search_nodes", args: { query_terms: query, labels: labels.length ? labels : undefined, limit: 25 } }];
}

/** Compose a grounded answer from tool output. Chunked to mimic streaming. */
export function narrate(
  ctx: Scope,
  query: string,
  results: { name: string; result: unknown }[],
): string[] {
  const lines: string[] = [];

  for (const { name, result } of results) {
    if (name === "recommend_for_person") {
      const r = result as { ranked: { node: { name: string; label: string; id: string }; shared: string[] }[]; interests: string[] };
      if (!r.ranked?.length) {
        lines.push("Nothing in your view shares an interest with your profile yet — add interests or goals and ask again.");
        continue;
      }
      lines.push(`Working from your interests (${r.interests.slice(0, 4).join(", ")}), here is where you connect:\n`);
      const byLabel = new Map<string, string[]>();
      for (const x of r.ranked.slice(0, 14)) {
        if (!byLabel.has(x.node.label)) byLabel.set(x.node.label, []);
        byLabel.get(x.node.label)!.push(`${x.node.name} — shared: ${x.shared.slice(0, 3).join(", ")}`);
      }
      for (const [label, items] of byLabel) {
        lines.push(`**${label}**\n${items.map((i) => `- ${i}`).join("\n")}\n`);
      }
    } else if (name === "nodes_by_interest" || name === "search_nodes" || name === "traverse") {
      const sub = result as { nodes: { name: string; label: string; props: Record<string, unknown> }[] };
      if (!sub.nodes?.length) continue;
      const byLabel = new Map<string, string[]>();
      for (const n of sub.nodes) {
        if (n.label === "Interest") continue;
        if (!byLabel.has(n.label)) byLabel.set(n.label, []);
        const extra = n.props.startsAt ? ` (${String(n.props.startsAt).replace("T", " ")})` : n.props.open === true ? " (open)" : "";
        byLabel.get(n.label)!.push(`${n.name}${extra}`);
      }
      if (byLabel.size === 0) continue;
      lines.push(`Matches in your view:\n`);
      for (const [label, items] of byLabel) {
        lines.push(`**${label}**\n${[...new Set(items)].slice(0, 8).map((i) => `- ${i}`).join("\n")}\n`);
      }
    } else if (name === "find_paths") {
      const paths = result as { narrative: string }[];
      for (const p of paths) lines.push(`Path: ${p.narrative}\n`);
    }
  }

  if (lines.length === 0) {
    lines.push(
      `Nothing in your access scope matches that. As ${ctx.role}${ctx.subrole ? `/${ctx.subrole}` : ""} you can see the public layer plus what you own — try naming a topic, a course code, or a person.`,
    );
  }

  lines.push("\n_Local planner — connect vLLM via LLM_BASE_URL for full natural-language answers._");

  /* chunk into small pieces so the UI streams visibly */
  const text = lines.join("\n");
  return text.match(/[\s\S]{1,24}/g) ?? [text];
}
