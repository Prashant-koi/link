export interface GraphNode {
  id: string;
  labels: string[];
  label: string; // primary label, for colouring
  name: string; // display name
  props: Record<string, unknown>;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
}

export interface Subgraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphPath {
  nodes: GraphNode[];
  links: GraphLink[];
  narrative: string;
}

export const EMPTY_SUBGRAPH: Subgraph = { nodes: [], links: [] };

export class ScopeError extends Error {
  readonly status = 403;
  constructor(message = "outside your access scope") {
    super(message);
    this.name = "ScopeError";
  }
}
