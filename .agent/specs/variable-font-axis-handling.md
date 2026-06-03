# Variable Font Axis Handling

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [plan-types.md](./plan-types.md), [font-metadata-field-mapping.md](./font-metadata-field-mapping.md), [weight-classification-reference.md](./weight-classification-reference.md)

---

## Variable Font Detection

A font is classified as variable when:

```js
// Guard for TrueType Collections
const face = font.fonts ? font.fonts[0] : font;
const axes = face.variationAxes;
const hasRealVariation = axes
  && Object.keys(axes).length > 0
  && Object.values(axes).some(axis => axis.min !== axis.max);

fontEntry.variableFont = hasRealVariation;
```

**Key fix:** The current code checks only `Object.keys(axes).length > 0`, which misclassifies fonts with degenerate axes (min === max, e.g., static instances exported from a variable source with vestigial `fvar` table).

---

## Registered Axis Tags

| Tag | CSS Descriptor | Name | Range | Notes |
|---|---|---|---|---|
| `wght` | `font-weight` | Weight | 1-1000 | Maps directly to CSS font-weight |
| `wdth` | `font-stretch` | Width | 50%-200% | Percentage of normal width. Clamp values outside 50-200 range. |
| `ital` | *(see below)* | Italic | 0 or 1 | Binary toggle — requires two @font-face blocks, not a single descriptor |
| `slnt` | `font-style: oblique` | Slant | degrees | Continuous slant angle. **Requires sign negation** for CSS. |
| `opsz` | *(none — element-level only)* | Optical Size | point size | No @font-face descriptor. Controlled at element level via `font-optical-sizing: auto\|none` or `font-variation-settings`. |

> **Correction from panel review:** `font-optical-sizing` is a CSS property, NOT an @font-face descriptor. `opsz` has no @font-face descriptor equivalent. The `buildVFDescriptors()` switch statement should NOT emit anything for `opsz`.

### Custom / Unregistered Axes

Custom axes (uppercase tags like `GRAD`, `XTRA`, `XHGT`, `YOPQ`) have no CSS `@font-face` descriptor. They are:
- Listed as informational badges in the review UI
- Included in CSS comments in the generated `@font-face`
- Stored as `variableAxes` on the Sanity font document

---

## Axis Impact on Plan Fields

### `wght` axis → Weight field validation

When a VF has a `wght` axis:
- `FontPlanEntry.weight` should default to the axis `default` value (not OS/2 usWeightClass, which for VFs often reports the default instance weight)
- The review UI should show the axis range as context: "Weight: 400 (axis range: 100-900)"
- If the user overrides weight to a value outside the axis range, show a warning (non-blocking)

### `wdth` axis → Subfamily interaction

Width axes do NOT replace subfamilies. A VF with `wdth` axis but named "Halyard Condensed VF" should keep "Condensed" as its subfamily — the width axis provides continuous variation within that optical design.

**CSS clamping:** OpenType `wdth` values below 50 or above 200 are valid but outside the CSS `font-stretch` range (50%-200%). Clamp to CSS range when emitting descriptors.

### `ital` axis → Style field and CSS

| `ital` axis state | Style derivation |
|---|---|
| No `ital` axis | Use standard italic detection (fsSelection bit 0, macStyle bit 1, name, italicAngle) |
| `ital` axis with max > 0 | Font supports both Regular and Italic — style field is informational only |
| `ital` axis with max === 0 | Degenerate axis — ignore it, use standard detection |

**Important:** A VF with an `ital` axis produces both upright and italic from a single file. The current binary `'Regular' | 'Italic'` model cannot fully represent this. For v1, set style to `'Regular'` and note "Italic available via ital axis" in the review card.

**CSS output:** A single `font-style: italic` descriptor locks out the upright (ital=0) position. Generate **two** `@font-face` blocks:
```css
/* Upright */
@font-face {
  font-family: "MyFont VF";
  src: url("myfont-vf.woff2") format("woff2");
  font-style: normal;
  font-display: swap;
  font-variation-settings: 'ital' 0;
}
/* Italic */
@font-face {
  font-family: "MyFont VF";
  src: url("myfont-vf.woff2") format("woff2");
  font-style: italic;
  font-display: swap;
  font-variation-settings: 'ital' 1;
}
```

### `slnt` axis → Style field and CSS

| `slnt` axis state | Style derivation |
|---|---|
| No `slnt` axis | Use standard italic detection |
| `slnt` axis with actual range | Font supports continuous slant — set style to `'Regular'`, note slant range |
| `slnt` + `ital` coexist | `slnt` takes priority for CSS descriptors (more expressive) |

**CSS sign convention:** OpenType `slnt` values are counter-clockwise positive (negative = right-leaning italic-like slant). CSS `oblique` degrees are clockwise positive. The mapping must **negate** the values:

```js
// slnt axis: min=-12, max=0 → CSS: oblique 0deg 12deg
cssAxes['font-style'] = `oblique ${-hi}deg ${-lo}deg`;
```

### `opsz` axis → Subfamily preservation

This is the critical fix for the panel review finding about forcing VF subfamily to empty.

| Condition | Subfamily behavior |
|---|---|
| VF with `opsz` axis (min !== max) | Clear subfamily — the VF covers the full optical size range and replaces Display/Text/Micro distinctions |
| VF without `opsz` axis, but with subfamily (e.g., "Halyard Display VF") | PRESERVE subfamily — this VF represents one specific optical design within the family |
| VF without `opsz` axis, no subfamily detected | Subfamily stays empty (current behavior, correct) |

> **Audit trail note:** When opsz clears the subfamily, `SubfamilyDecision.source` should be `'cleared-by-opsz'` and `SubfamilyDecision.detected` should store the pre-clearing value so the user can see what was removed and override if needed.

```js
// Updated logic (replaces unconditional subfamily clearing)
if (variableFont) {
  const hasOpszAxis = font.variationAxes?.opsz
    && font.variationAxes.opsz.min !== font.variationAxes.opsz.max;

  if (hasOpszAxis) {
    subfamilyName = ''; // VF covers full optical range
  }
  // Otherwise: preserve detected subfamilyName
}
```

---

## CSS @font-face Generation for Variable Fonts

### Axis → CSS descriptor mapping

```js
// From buildVFDescriptors() in generateCssFile.js
const cssAxes = {};
for (const [tag, axis] of Object.entries(variationAxes)) {
  const lo = Math.min(axis.min, axis.max);
  const hi = Math.max(axis.min, axis.max);

  if (lo === hi) continue; // Degenerate axis — skip

  switch (tag) {
    case 'wght':
      cssAxes['font-weight'] = `${lo} ${hi}`;
      break;
    case 'wdth':
      // Clamp to CSS font-stretch range (50-200%)
      cssAxes['font-stretch'] = `${Math.max(50, lo)}% ${Math.min(200, hi)}%`;
      break;
    case 'slnt':
      // OpenType slnt is counter-clockwise positive; CSS oblique is clockwise positive
      // Negate values and ensure ascending order for CSS
      cssAxes['font-style'] = `oblique ${-hi}deg ${-lo}deg`;
      break;
    case 'ital':
      // Do NOT emit a single font-style descriptor — handled by generating
      // two separate @font-face blocks (see ital axis section above)
      break;
    case 'opsz':
      // No @font-face descriptor — opsz is element-level only
      // Add as CSS comment for documentation
      break;
    default:
      // GRAD, XTRA, etc. — no CSS descriptor
      break;
  }
}
```

### Required: `font-display: swap`

All generated `@font-face` blocks must include `font-display: swap` to prevent invisible text during font loading. Without it, browsers default to `auto` (typically `block`), blocking text rendering for up to 3 seconds.

### Format hint

Use `format('woff2')` as the primary format hint. The legacy `format('woff2-variations')` was deprecated in CSS Fonts Level 4 and is not recognized by older Chromium builds (pre-83), causing the `src:` descriptor to be skipped. If backward compatibility with very old browsers is needed, include both:

```css
src: url("font.woff2") format("woff2"),
     url("font.woff2") format("woff2-variations");
```

### Fallback @font-face block ordering

For axes with limited browser support (`wdth` range, `slnt` range), generate the **simple fallback block FIRST**, then the range-syntax block SECOND. CSS cascade rule: last matching block wins. Capable browsers match the range-syntax block (last); incapable browsers ignore it and use the simple fallback (first).

```css
/* Fallback block — emitted first, used by browsers that don't support range syntax */
@font-face {
  font-family: "MyFont VF";
  src: url("myfont-vf.woff2") format("woff2");
  font-weight: normal;
  font-stretch: normal;
  font-style: normal;
  font-display: swap;
}

/* Range-syntax block — emitted second, overrides the above in capable browsers */
@font-face {
  font-family: "MyFont VF";
  src: url("myfont-vf.woff2") format("woff2");
  font-weight: 100 900;
  font-stretch: 75% 125%;
  font-style: oblique 0deg 12deg;
  font-display: swap;
}
```

### Browser compatibility

| Feature | Chrome | Firefox | Safari | Fallback needed |
|---|---|---|---|---|
| `font-weight: 100 900` | Yes | Yes | Yes | No |
| `font-stretch: 75% 125%` | Yes | Partial | Partial (Safari 15- ignores) | Yes — simple fallback block |
| `font-style: oblique 0deg 12deg` | Yes | No | No | Yes — simple fallback block |
| Two `@font-face` blocks for `ital` axis | Yes | Yes | Yes | No |
| `format('woff2')` | Yes | Yes | Yes | No |

---

## VF Title Convention

Current behavior: append "VF" to title if not present.

**Recommended change:** Make "VF" suffix opt-out rather than forced:
- System suggestion: add "VF" suffix (matches current behavior)
- `decisions.title.alternatives` includes both "Halyard Display Bold VF" and "Halyard Display Bold"
- User can remove the suffix via title edit
- `resolveExistingFont` should check for matches both with and without "VF" suffix

---

## Variable Instance Mapping

Handled by `parseVariableFontInstances.js` — NOT exposed in the review UI for v1.

The 6-strategy matching system remains internal:
1. Exact title match
2. Title normalization (strip VF/var/variable prefixes)
3. Abbreviation expansion
4. Weight + style matching
5. weightName comparison
6. metaData.fullName fallback

> **Known inconsistency:** Strategies 4 and 5 use the old inline `weightTerms` array, not the new `resolveWeight()` function. This should be updated to ensure consistent weight mapping. See [weight-classification-reference.md](./weight-classification-reference.md) review amendments.

**v2 consideration:** The review UI could expose instance mappings as a sub-section of the VF review card, showing each named instance with its matched static font (or "No match"). This would let users manually fix broken mappings.

---

## Review UI for Variable Fonts

The VF review card should show additional read-only information:

| Field | Display |
|---|---|
| Variation axes | Badges per axis: `wght 100-900`, `ital 0-1`, `opsz 8-144` |
| Named instances | Count: "24 named instances" |
| Instance mapping status | "22/24 matched to static fonts" (informational) |
| Axis range vs. weight | Warning if assigned weight is outside wght range |
