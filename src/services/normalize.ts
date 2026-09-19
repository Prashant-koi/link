// Lowercase, depunctuate, and drop a trailing plural 's'. A real
// implementation would want a proper lemmatizer; this is a placeholder
// (the resolution pipeline doc leaves exact normalisation unspecified).
export function normalizeSurface(surface: string): string {
  const stripped = surface.toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
  return stripped.replace(/s$/, "");
}
