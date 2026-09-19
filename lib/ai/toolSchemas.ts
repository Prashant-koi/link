import type { ToolSchema } from "./client";

/**
 * What the model is allowed to ask for. Note there is no free-form query tool:
 * the model cannot express "run this Cypher", only "traverse from this node".
 */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "search_nodes",
      description:
        "Keyword search for entities in the university graph (people, courses, labs, clubs, events, interests, papers, positions). Use this first when the user names something you do not yet have an id for.",
      parameters: {
        type: "object",
        properties: {
          query_terms: { type: "string", description: "Words to match on names, titles and summaries." },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Restrict to these node labels, e.g. ['Lab','Position'].",
          },
          limit: { type: "integer" },
        },
        required: ["query_terms"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "nodes_by_interest",
      description:
        "The core discovery tool. Given interest names (e.g. ['Computational Biology']), return the courses, labs, clubs, people, papers and events that point at those interests. Expands down the subfield DAG by default.",
      parameters: {
        type: "object",
        properties: {
          interest_names: { type: "array", items: { type: "string" } },
          target_labels: { type: "array", items: { type: "string" } },
          expand_subfields: { type: "boolean" },
          limit: { type: "integer" },
        },
        required: ["interest_names"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_for_person",
      description:
        "Answer 'where do I fit'. Collects a person's interests and their goals' interests, expands the subfield DAG, and ranks labs/courses/clubs/events/people by shared-interest overlap. Omit person_id to mean the current user.",
      parameters: {
        type: "object",
        properties: {
          person_id: { type: "string" },
          target_labels: { type: "array", items: { type: "string" } },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "traverse",
      description: "Walk outward from a known node id along specific edge types, up to depth 3.",
      parameters: {
        type: "object",
        properties: {
          from_node_id: { type: "string" },
          edge_types: { type: "array", items: { type: "string" } },
          depth: { type: "integer" },
          limit: { type: "integer" },
        },
        required: ["from_node_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_paths",
      description:
        "Explain how two things are connected — 'how am I connected to the Systems Lab'. Give to_node_id, or to_label to find the nearest node of a kind.",
      parameters: {
        type: "object",
        properties: {
          from_node_id: { type: "string" },
          to_node_id: { type: "string" },
          to_label: { type: "string" },
          max_depth: { type: "integer" },
        },
        required: ["from_node_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_neighborhood",
      description: "Pull everything one hop from a node so you can describe it accurately.",
      parameters: {
        type: "object",
        properties: { node_id: { type: "string" }, limit: { type: "integer" } },
        required: ["node_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_intro_email",
      description:
        "Draft (do not send) an introduction email to a person, grounded in shared interests. The user confirms before anything is sent.",
      parameters: {
        type: "object",
        properties: { person_id: { type: "string" }, context: { type: "string" } },
        required: ["person_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_calendar",
      description: "Add an event to the current user's calendar. Requires user confirmation in the UI.",
      parameters: {
        type: "object",
        properties: { event_id: { type: "string" } },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_checklist",
      description: "Produce concrete next steps for a goal or an application.",
      parameters: {
        type: "object",
        properties: { goal_id: { type: "string" }, application_id: { type: "string" } },
      },
    },
  },
];

export const SYSTEM_PROMPT = `You are Compass, the navigator inside StudentOS — a university represented as a connected knowledge graph.

Your job is to help the person in front of you find where they fit: the people, courses, labs, clubs, events and openings connected to what they care about.

Rules:
- Ground every claim in tool results. Never invent a person, lab, course, event or opening.
- You cannot see the whole university. You see exactly what this caller's role permits, and the tools enforce that. If a tool returns nothing, say plainly that nothing in their view matches — never speculate about what might exist outside their access.
- Prefer nodes_by_interest and recommend_for_person for discovery; they traverse the interest graph, which is where real connections live.
- When the user asks how they are connected to something, use find_paths and describe the path hop by hop.
- Be concise. Name specific entities. Say why each one is relevant (the shared interest, the person, the path).`;
