import { config } from "../config.js";

// GitHub is the one import with a real public API behind it, so it is the
// one import that actually fetches. Unauthenticated requests are rate
// limited to 60/hour per IP — set GITHUB_TOKEN for a demo that repeats.

const API = "https://api.github.com";
const REPO_LIMIT = 30;

export interface GithubRepo {
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  fork: boolean;
  pushedAt: string | null;
  createdAt: string | null;
  htmlUrl: string;
}

export interface GithubProfile {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  repos: GithubRepo[];
}

function headers(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "link-hackmit",
    ...(config.github.token ? { Authorization: `Bearer ${config.github.token}` } : {}),
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  if (res.status === 404) throw new Error(`GitHub user not found`);
  if (res.status === 403) {
    throw new Error("GitHub rate limit reached — set GITHUB_TOKEN and retry");
  }
  if (!res.ok) throw new Error(`GitHub request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function fetchGithubProfile(login: string): Promise<GithubProfile> {
  const user = await getJson<{
    login: string;
    name: string | null;
    bio: string | null;
    company: string | null;
    blog: string | null;
  }>(`/users/${encodeURIComponent(login)}`);

  const repos = await getJson<Array<Record<string, any>>>(
    `/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=${REPO_LIMIT}`,
  );

  return {
    login: user.login,
    name: user.name,
    bio: user.bio,
    company: user.company,
    blog: user.blog,
    repos: repos.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description ?? null,
      language: repo.language ?? null,
      topics: Array.isArray(repo.topics) ? repo.topics : [],
      stars: repo.stargazers_count ?? 0,
      fork: Boolean(repo.fork),
      pushedAt: repo.pushed_at ?? null,
      createdAt: repo.created_at ?? null,
      htmlUrl: repo.html_url,
    })),
  };
}

// Flattened into the same shape of messy prose bio_extract already reads, so
// GitHub needs no prompt of its own. Forks are left out: someone else's
// interests are not evidence of yours.
export function profileToSourceText(profile: GithubProfile): string {
  const lines: string[] = [`GitHub profile: ${profile.name ?? profile.login} (@${profile.login})`];
  if (profile.bio) lines.push(profile.bio);
  if (profile.company) lines.push(`Affiliation: ${profile.company}`);

  const owned = profile.repos.filter((r) => !r.fork);
  if (owned.length > 0) {
    lines.push("", "Repositories:");
    for (const repo of owned) {
      const parts = [repo.name];
      if (repo.description) parts.push(repo.description);
      if (repo.language) parts.push(`written in ${repo.language}`);
      if (repo.topics.length > 0) parts.push(`topics: ${repo.topics.join(", ")}`);
      lines.push(`- ${parts.join(" — ")}`);
    }
  }

  const languages = [...new Set(owned.map((r) => r.language).filter((l): l is string => Boolean(l)))];
  if (languages.length > 0) lines.push("", `Languages: ${languages.join(", ")}`);

  const topics = [...new Set(owned.flatMap((r) => r.topics))];
  if (topics.length > 0) lines.push(`Topics: ${topics.join(", ")}`);

  return lines.join("\n");
}
