import { read } from "@/lib/graph/driver";

/**
 * Demo-only: the "switch user" control. A real deployment authenticates against
 * the IdP; this endpoint exists so a judge can watch the same OS become a
 * different institution in two clicks.
 */
export async function GET() {
  const rows = await read<{ id: string; name: string; role: string; subrole: string | null; dept: string }>(
    `
    MATCH (p:Person)-[:WORKS_IN]->(d:Department)
    WHERE coalesce(p.applicant, false) = false
    WITH p, d,
         CASE
           WHEN p.id = 'stu-1' THEN 0
           WHEN p.role = 'staff' THEN 1
           WHEN p.subrole IN ['prof','assoc_prof'] THEN 2
           WHEN p.subrole = 'phd_student' THEN 3
           ELSE 4
         END AS rank
    RETURN p.id AS id, p.name AS name, p.role AS role, p.subrole AS subrole, d.name AS dept
    ORDER BY rank, p.subrole, p.name
    LIMIT 40
    `,
  );
  return Response.json({ personas: rows });
}
