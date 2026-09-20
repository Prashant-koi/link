// Auth handoff, section 2: one normalisation function, applied to both
// username and password so they never disagree.
export function norm(s: string): string {
  return s
    .normalize("NFD") // split accents off their letters
    .replace(/[̀-ͯ]/g, "") // drop the accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ""); // strip spaces, apostrophes, hyphens
}

export interface DerivedCredential {
  username: string;
  password: string;
  fallback: boolean; // true when norm() collapsed to empty and a user{n} id was used instead
}

// First token is the first name, last token is the last name — middle
// names are dropped (stated explicitly in the handoff: "a silent source of
// 'my password doesn't work'").
function firstAndLast(displayName: string): { first: string; last: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts[parts.length - 1] ?? parts[0] ?? "" };
}

// Derives username/password for one person from their display name, before
// collision resolution. A name that normalises to nothing (entirely
// non-Latin script) falls back to a random-password user{n} placeholder —
// the caller supplies `n` and the random password.
export function deriveCredential(displayName: string, fallbackIndex: number, fallbackPassword: string): DerivedCredential {
  const { first, last } = firstAndLast(displayName);
  const normFirst = norm(first);
  const normLast = norm(last);

  if (!normFirst || !normLast) {
    return { username: `user${fallbackIndex}`, password: fallbackPassword, fallback: true };
  }

  return {
    username: `${normFirst}.${normLast}`,
    password: `${normFirst}@${normLast}`,
    fallback: false,
  };
}

// Collisions are resolved on the *username only*, in insertion order —
// maria.obrien, maria.obrien2 — the password stays derived from the name
// for both, since it doesn't depend on the username.
export function resolveUsernameCollisions(baseUsernames: string[]): string[] {
  const seenCount = new Map<string, number>();
  return baseUsernames.map((base) => {
    const count = (seenCount.get(base) ?? 0) + 1;
    seenCount.set(base, count);
    return count === 1 ? base : `${base}${count}`;
  });
}
