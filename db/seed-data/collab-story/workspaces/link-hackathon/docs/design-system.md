# Link Design System

**Owner:** Mei Shah
**Status:** Active (v0.9)
**Last Updated:** Sun 6 Sep 2026

This document defines the visual language for the Link web app. We are building a responsive web experience only (per D5, no native mobile). The goal is to make the "atlas" feel calm, academic, and slightly magical, without overwhelming users with graph clutter.

## 1. Color Palette (Turquoise Theme)

We use a turquoise primary scale. Avoid pure black or white; use the ink scale for contrast.

### Primary: Turquoise
| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--turq-600` | `#0d9488` | Accent text, active states, primary buttons |
| `--turq-500` | `#14b8a6` | Lines, borders, icon strokes |
| `--turq-300` | `#5eead4` | Secondary accents, focus rings |
| `--turq-100` | `#ccfbf1` | Washes, selected backgrounds, region fills (low opacity) |
| `--turq-050` | `#f0fdfa` | Hover states, subtle backgrounds |

### Ink Scale (Neutrals)
| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--ink-900` | `#0f172a` | Primary text |
| `--ink-600` | `#475569` | Secondary text, captions |
| `--ink-400` | `#94a3b8` | Disabled text, placeholders |
| `--ink-100` | `#f1f5f9` | Card backgrounds, dividers |

### Semantic
*   **Success:** `#10b981` (Emerald) — for accepted connections.
*   **Warning:** `#f59e0b` (Amber) — for pending requests.
*   **Error:** `#ef4444` (Red) — use sparingly.

## 2. Typography

**Font Family:** `Inter`, system-ui, sans-serif.
*   Load via Google Fonts or local asset.
*   Fallbacks are fine for offline dev, but production should have Inter.

### Type Scale
| Role | Size | Weight | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| Display | 2rem (32px) | 700 | 1.2 | Hero titles, "Why you connect" headers |
| H1 | 1.5rem (24px) | 600 | 1.3 | Page titles |
| H2 | 1.25rem (20px) | 600 | 1.4 | Section headers |
| Body | 1rem (16px) | 400 | 1.6 | Default text, interest descriptions |
| Small | 0.875rem (14px) | 400 | 1.5 | Captions, timestamps, badges |

*   **Letter Spacing:** -0.01em for headings > H2 to tighten up the Inter look.
*   **Code/Mono:** `JetBrains Mono` or system mono for concept IDs or debug info (hidden by default).

## 3. Spacing & Layout

Use a 4px base unit. All spacing should be multiples of 4.

*   `--space-1`: 4px
*   `--space-2`: 8px
*   `--space-3`: 12px
*   `--space-4`: 16px (default card padding)
*   `--space-6`: 24px (section gaps)
*   `--space-8`: 32px (page margins)

**Border Radius:**
*   Cards/Buttons: `8px`
*   Badges/Chips: `999px` (pill shape)
*   Atlas Regions: Organic, not geometric. Use SVG paths or CSS clip-paths with high blur.

## 4. The Atlas Visual Language

The home screen is the "Atlas" (D8). This is our signature visual.

### Concept Regions
*   **Style:** Soft, overlapping blobs.
*   **Fill:** `--turq-100` at 30-50% opacity.
*   **Border:** None. Let them blend.
*   **Label:** Centered, `--ink-600`, small size, uppercase tracking 0.05em.
*   **Interaction:** Hovering a region highlights all people inside it.

### People Spheres
*   **Style:** Glassmorphism circles.
*   **Background:** `rgba(255, 255, 255, 0.7)` with `backdrop-filter: blur(10px)`.
*   **Border:** `1px solid rgba(255, 255, 255, 0.9)`.
*   **Shadow:** Soft drop shadow to lift from the region background.
*   **Avatar:** Centered image or initials.
*   **Size:** Scales slightly with "connection strength" (optional, keep subtle).

### The Link Emblem
*   When two people connect, draw a curved line between their spheres.
*   **Color:** `--turq-500`.
*   **Style:** Dashed line that animates in (stroke-dashoffset) when the explanation appears.
*   **Tooltip:** On hover, show the "Why you connect" summary.

## 5. Motion & Interaction

*   **Duration:** 200ms for micro-interactions, 400ms for transitions.
*   **Easing:** `ease-out` for entering elements, `ease-in` for exiting.
*   **Reduced Motion:** Respect `prefers-reduced-motion`. Disable atlas blob animations and line drawing if enabled.
*   **Loading:** Use skeleton screens with a shimmer effect (opacity pulse) rather than spinners where possible.

## 6. Do / Don't

### ✅ Do
*   Use whitespace generously. Let the atlas breathe.
*   Keep text high contrast (AA minimum).
*   Ensure all interactive elements have visible focus states (`--turq-300` outline).
*   Use consistent terminology: "Concepts," not "Tags"; "Connections," not "Links."

### ❌ Don't
*   Don't use pure black `#000000`. It’s too harsh.
*   Don’t clutter the atlas with more than 15 visible regions at once (zoom out to see more).
*   Don’t use hard edges on the concept regions. They should feel organic, like clouds or maps.
*   Don’t animate everything. Only animate what matters (new connections, hover states).

## 7. Component Notes

*   **Buttons:** Primary is `--turq-600` bg, white text. Secondary is transparent, `--turq-500` border/text.
*   **Input Fields:** White bg, `--ink-100` border, focus ring `--turq-300`.
*   **Cards:** White bg, `--ink-100` border, 8px radius, 16px padding.

---
*TODO: Add dark mode tokens once we decide if we support it (probably not for v1).*
*TODO: Get final feedback from Jane on the glassmorphism performance on low-end devices.*
