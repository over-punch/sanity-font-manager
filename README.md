# @overpunch/sanity-font-manager

[![npm version](https://img.shields.io/npm/v/@overpunch/sanity-font-manager.svg)](https://www.npmjs.com/package/@overpunch/sanity-font-manager)
[![license](https://img.shields.io/npm/l/@overpunch/sanity-font-manager.svg)](#license)
[![Sanity v3 · v4 · v5 · v6](https://img.shields.io/badge/Sanity-v3%20%C2%B7%20v4%20%C2%B7%20v5%20%C2%B7%20v6-f03e2f.svg)](https://www.sanity.io/)
[![tests](https://img.shields.io/badge/tests-440%20passing-brightgreen.svg)](#testing)

Full font management suite for Sanity Studio. Handles batch upload, multi-format conversion, metadata extraction, CSS `@font-face` generation, collection and pair generation, and script variant management.

Drag a folder of font files onto a typeface document and the plugin parses each file, detects its weight and style, checks for an existing document, then — after you review and confirm — uploads every format, generates the `@font-face` CSS and metadata, creates or updates the font documents, and maps any variable-font instances.

### What it gives you, and what you provide

|  | |
|---|---|
| **The plugin provides** | The upload UI and its multi-step wizard, font parsing (`lib-font`, no native binaries), `@font-face` CSS + metadata generation, duplicate resolution, and ready-made schema field factories (`createStylesField`, `createFontFileFields`, `openTypeField`, …). |
| **Your studio provides** | The `typeface` and `font` **document types** themselves, plus the three `SANITY_STUDIO_*` env vars. The [Quickstart](#quickstart) below wires both documents end to end. |
| **Your site optionally provides** | A `POST /api/sanity/fontWorker` route — needed **only** for EOT/SVG conversion and DS-WEB/subset WOFF2s. TTF/OTF/WOFF/WOFF2 upload, parsing, CSS, and metadata all work without it. |

There is **no `plugins: []` entry to add to `sanity.config.js`** — this package ships input components and schema fields, and is wired up entirely from your schema definitions.

Compatible with Sanity Studio **v3 through v6** (`sanity` peer: `>=3 <7`).

<details>
<summary>How one build spans four majors</summary>

`@sanity/ui` v4 relocated `Tooltip`, `Menu`, `MenuButton`, `MenuItem`, `Code`, `Popover`,
`Autocomplete` and `useToast` to subpath entry points, and `@sanity/icons` v5 removed every
named `*Icon` export in favour of `<Icon symbol="…">`. Both packages still *declare* the
removed names in their `.d.ts`, typed `never` — so a plain named import type-checks, builds,
and then fails at runtime. The subpaths do not exist on v2 or v3, so neither import shape
works across the whole range.

This plugin therefore imports no `@sanity/ui` or `@sanity/icons` symbol directly. Everything
goes through [`@overpunch/sanity-ui-compat`](https://www.npmjs.com/package/@overpunch/sanity-ui-compat),
which reads the installed namespace at runtime and resolves each export against whichever
major is actually present. It also translates the props v4 renamed (`Stack`/`Inline` `space`
→ `gap`, `Grid` `columns` → `gridTemplateColumns`, `Badge` `mode` removed), which are ignored
silently rather than warned about.

**Note the `@sanity/ui` peer is `>=2 <5`, which is correct for Sanity v6** — Studio v6 ships
`@sanity/ui` v4, not v5.

**Verification status, stated plainly:** v6 support is established by the peer ranges, a
green build, and the [test suite](#testing) (440 passing) going green with the compat in place.
It has **not** yet been exercised in a running Sanity 6 Studio beyond three in-house studios.
On v3 and v4 the compat is a measured pass-through —
16 of 18 primitives resolve to the identical `@sanity/ui` object and `Stack`/`Grid` render
byte-identical markup — so the risk is concentrated in v6-specific fallback paths (tooltip
placement, menu focus handling), not in the majors already in production.

</details>

### Contents

**Get it running** — [Installation](#installation) · [Quickstart](#quickstart) · [Environment variables](#environment-variables)
**Understand it** — [How it works](#how-it-works) · [Upload workflow](#upload-workflow) *(start here if you curate fonts rather than write schemas)* · [Safety & reliability](#safety--reliability)
**Reference** — [Components](#components) · [Schema field definitions](#schema-field-definitions) · [Hooks](#hook) · [Utilities](#utilities) · [Document shapes](#schema-fields)
**Maintain it** — [Testing](#testing) · [Local development](#local-development)

## How it works

The upload flow is a two-phase **plan → execute** pipeline: phase 1 parses files and resolves duplicates with **reads only**, you review and edit the result, then phase 2 performs all **writes**. Font parsing runs on [`lib-font`](https://github.com/Pomax/lib-font) (WOFF/WOFF2 decompression is bootstrapped via `pako` + a vendored `unbrotli`), so no native binaries are required.

A third phase — building the derived web copies and display subsets — runs after the typeface patch **only if the studio opts in**, and can never fail the upload. It is drawn below because a stall in it used to look identical to a stall in the typeface patch; see [Web copies and display subsets](#web-copies-and-display-subsets-opt-in).

```mermaid
flowchart TD
    subgraph studio["Sanity Studio (typeface document)"]
        BUF["BatchUploadFonts<br/>(schema input field)"]
        BUF -->|opens| UM["UploadModal<br/>(lazy-loaded)"]
    end

    subgraph plan["Phase 1 — Plan (reads only)"]
        UM --> S1["Step 1 · Upload Files<br/>UploadStep1Settings"]
        S1 --> BUILD["buildUploadPlan()"]
        BUILD --> PF["parseFont() · lib-font<br/>setupDecompressors → pako + unbrotli"]
        PF --> FH["fontHelpers<br/>weight / style / axes / metrics"]
        FH --> RES["resolveExistingFont()<br/>exact / candidate / create"]
        RES --> S2["Step 2 · Review<br/>FontReviewCard · BulkActions · ExistingDocumentResolver"]
    end

    subgraph execute["Phase 2 — Execute (writes)"]
        S2 -->|user confirms| EXEC["executeUploadPlan()<br/>concurrency = 3 · 429 backoff + jitter"]
        EXEC --> UP["Upload assets<br/>ttf / otf / woff / woff2"]
        UP --> CSS["generateCssFile()<br/>@font-face + VF descriptors"]
        CSS --> META["generateFontData()<br/>metadata · metrics · glyphs · features"]
        META --> DOC["Create / update font documents"]
        DOC --> PATCH["Patch typeface styles.fonts"]
    end

    S3b["Step 3b · Map Instances<br/>UploadStep3bInstances (variable fonts)"] --> SUM["Summary<br/>UploadSummary"]

    subgraph derive["Phase 3 — Derived web files (opt-in · never fails the upload)"]
        GATE{"settings.webAndSubset"}
        GATE -->|on| COLL["collectFontsForGeneration()<br/>skips fonts already complete<br/>60s query deadline"]
        COLL --> REQ["requestWebAndSubset()<br/>POST /api/sanity/fontWorker · no-cors<br/>4 at a time · 60s AbortController"]
        REQ --> VER["verifyWebAndSubset()<br/>poll Sanity every 4s, up to 180s<br/>requireSubset ? web + subset : web only"]
    end

    PATCH --> GATE
    GATE -->|off| S3b
    VER -->|"warns, never throws"| S3b
```

Every phase boundary in that diagram logs its elapsed milliseconds to the browser console (`Upload phase: …`), so when a run is slow you can tell *which* phase is slow — and a phase that is hung rather than slow shows as a boundary that never prints. Paste the console output into a bug report and the phase is already narrowed down.

> The Mermaid source lives at [`assets/upload-pipeline.mmd`](assets/upload-pipeline.mmd) and renders inline on GitHub. **A maintainer screenshot or short GIF of the live upload modal** (drag → review table → execute → instance mapping) would make the workflow even clearer — these Studio components cannot be captured headlessly, so it is left as a follow-up. Drop the image into `assets/` and reference it with an absolute `raw.githubusercontent.com` URL.

---

## Installation

```bash
npm install @overpunch/sanity-font-manager
```

### Peer dependencies

```bash
npm install sanity @sanity/ui @sanity/icons react @overpunch/sanity-advanced-reference-array
```

| Peer | Required version | Notes |
|---|---|---|
| `sanity` | `>=3 <7` | Studio v3, v4, v5 and v6 |
| `@sanity/ui` | `>=2 <5` | **`<5` is correct for Sanity v6** — Studio v6 ships `@sanity/ui` v4 |
| `@sanity/icons` | `>=2 <6` | v5 dropped the named `*Icon` exports; resolved at runtime instead |
| `react` | `>=18` | Sanity v5+ requires React 19.2.2 or newer |
| `@overpunch/sanity-advanced-reference-array` | `>=1` | **Required for the [Quickstart](#quickstart) path.** `createStylesField` and the typeface reference-array fields import it at module load, so importing them without it installed will throw. You only need it if you wire fields the manual way and skip both. |

If you hit peer dependency conflicts, add `legacy-peer-deps=true` to your `.npmrc`.

### Parsing dependencies

Font parsing relies on [`lib-font`](https://github.com/Pomax/lib-font) and `pako` at runtime. If they are not already present in your studio's `node_modules`, install them alongside the plugin:

```bash
npm install lib-font pako
```

---

## Quickstart

Two document types, then three env vars. Nothing to register in `sanity.config.js`.

### 1 · The typeface document

Wire `BatchUploadFonts` onto the `styles` field of a typeface document and you get the full drag-and-drop upload modal. The fastest way to build the rest of the `styles` object is the `createStylesField` factory, which assembles the fonts/variable-font/collections/pairs reference arrays for you.

```jsx
// schemas/typeface.js
import {
  BatchUploadFonts,
  createStylesField,
  openTypeField,
  styleCountField,
} from '@overpunch/sanity-font-manager';

export const typeface = {
  name: 'typeface',
  type: 'document',
  groups: [
    { name: 'styles', title: 'Styles' },
    { name: 'openType', title: 'Open Type' },
  ],
  fields: [
    { name: 'title', type: 'string' },

    // The drag-and-drop batch uploader lives on the styles object.
    {
      ...createStylesField({ generateCollections: true, pairs: true, styleCount: true }),
      components: { input: BatchUploadFonts },
      // Optional per-foundry defaults, read from the field's schema options:
      options: {
        defaults: {
          price: 40,            // starting per-style price
          pricing: true,        // set false to hide every price control (see below)
          sell: true,           // what `sell` becomes on new fonts when pricing is off
          preserveFileNames: false,
          preserveShortenedNames: true,
        },
      },
    },

    // Spreadable pre-built fields (optional):
    styleCountField,
    openTypeField,
  ],
};
```

### 2 · The font document

The uploader **creates and patches `font` documents**, so that type has to exist before the first upload — this is the step most often missed. The per-format file set is the same at every foundry, so it ships as a factory: `createFontFileFields()` builds the whole `fileInput` object (TTF/OTF/WOFF/WOFF2/EOT/SVG/CSS, plus the two derived WOFF2s) and wires `SingleUploaderTool` into it.

```jsx
// schemas/font.js
import { createFontFileFields, SingleUploaderTool } from '@overpunch/sanity-font-manager';

export const font = {
  name: 'font',
  type: 'document',
  fields: [
    // Written by the uploader from the parsed font — the review step edits these.
    { name: 'title', type: 'string' },
    { name: 'slug', type: 'slug', options: { source: 'title' } },
    { name: 'typefaceName', type: 'string' },
    { name: 'weightName', type: 'string' },
    { name: 'weight', type: 'number' },
    { name: 'style', type: 'string' },        // 'Regular' | 'Italic'
    { name: 'subfamily', type: 'string' },
    { name: 'variableFont', type: 'boolean' },
    { name: 'normalWeight', type: 'boolean' },

    // The whole per-format file set, with the per-font file manager as its input.
    // `derived: false` omits woff2_web / woff2_subset if your site has no subset-capable worker.
    createFontFileFields({ input: SingleUploaderTool }),
  ],
};
```

Patched automatically by `generateFontData` after upload: `metaData`, `metrics`, `glyphCount`, `opentypeFeatures`, `characterSet`, and the variable-font axes/instances. Sanity accepts those patches whether or not you declare the fields, but an undeclared field shows in the Studio as an *unknown field* — declare the ones you want editors to see, using [Font document (`font`)](#font-document-font) as the contract.

Register both types in your schema:

```js
// sanity.config.js — schema types only; this package needs no `plugins` entry.
import { typeface } from './schemas/typeface';
import { font } from './schemas/font';

export default defineConfig({
  /* … */
  schema: { types: [typeface, font] },
});
```

### 3 · Environment, then run it

Then set the required environment variables in your studio (`SANITY_STUDIO_SITE_URL`, `SANITY_STUDIO_PROJECT_ID`, `SANITY_STUDIO_DATASET` — see [Environment variables](#environment-variables)). Multi-format conversion and subsetting additionally need a `/api/sanity/fontWorker` endpoint on the consuming site (see [`generateFontFile`](#css-and-file-generation) / [`generateSubset`](#css-and-file-generation)); TTF/OTF/WOFF/WOFF2 upload, parsing, CSS, and metadata work without it.

Open a typeface document, drag font files onto the styles field, review the detected weights/styles, resolve any duplicates, and confirm. See [Upload workflow](#upload-workflow) for the full step-by-step.

### Turning off per-style pricing

Not every foundry prices per font document. Where the price lives on the typeface or the licence
tier instead, a price per style is noise the curator has to fill in for nothing. Set
`options.defaults.pricing = false` on the uploader field to hide every price control — the wizard's
Settings price, the per-font price in the review preview, and the "Update Font Prices" utility.

```js
{
  ...createStylesField({ /* … */ }),
  components: { input: BatchUploadFonts },
  options: { defaults: { pricing: false, sell: true } },
}
```

**`sell` is deliberately separate from the price.** New font documents are normally written with
`sell: price > 0`, but with pricing hidden the price is always `0` — so deriving `sell` from it would
write `sell: false` on every upload and silently switch off whatever the consuming site gates on that
field (on Darden, the type-tester buy button). With `pricing: false`, `sell` comes from
`options.defaults.sell` instead, defaulting to `true`. Set it to `false` if new uploads should start
unsellable.

With `pricing` left on (the default), behaviour is unchanged.

### Web copies and display subsets (opt-in)

A batch upload stores the font files you dropped in. It does **not** build the two derived WOFF2s —
the DS-WEB fingerprinted `fileInput.woff2_web` used for web delivery, and the display
`fileInput.woff2_subset` — because both are produced server-side by the consuming site.

Switch it on per studio:

```js
{
  ...createStylesField({ /* … */ }),
  components: { input: BatchUploadFonts },
  options: { defaults: { webAndSubset: true } },
}
```

**Two prerequisites, both required.** Leave it off unless the studio has each:

1. The `font` schema defines `fileInput.woff2_web` and `fileInput.woff2_subset`.
   `createFontFileFields()` emits both by default — see [`createFontFileFields`](#createfontfilefields).
2. The site implements `POST /api/sanity/fontWorker` handling `code: 'generate-subset'`. One call
   is expected to produce *both* files and patch them onto the font document — but see
   **`requireSubset`** below: as of 2.21.0 the plugin no longer assumes the subset actually lands.

Behaviour, in `utils/generateWebAndSubset.js`:

- Runs after the fonts and the typeface document are written, so nothing above it can be affected.
- Reads back what actually landed and **skips any font that is already complete**, so re-running a
  partial upload only fills the gaps. Pass `force` to rebuild regardless.
- **A re-upload with a new WOFF2 rebuilds them (2.24.2).** The update patch drops the old
  `woff2_web`, `woff2_subset` and `css_subset`, which were built from the previous binary; carried
  over, they read as complete and the font was skipped. With `webAndSubset` off they are kept and a
  console warning says they are out of date.
- Requests are throttled (4 at a time) — the worker does real subsetting per font.
- The Studio and site are different origins, so the POST is `no-cors` and its response is opaque.
  Success is therefore confirmed by **polling Sanity** until the expected fields appear, not by the
  fetch.
- **Never fails the upload.** The fonts are already saved; a missing derived file is reported as a
  warning via `result.webAndSubset` (`{ requested, skipped, done, pending }`).

#### What counts as done — `requireSubset` (2.21.0)

Until 2.21.0 this phase waited for **both** `woff2_web` and `woff2_subset`. Subsetting is newer than
the web copy, and a `fontWorker` that writes only the web copy makes that predicate unsatisfiable:
every upload polled for the full timeout and then reported the whole batch pending — which the UI
rendered as the *typeface patch* still running. It looked exactly like a freeze.

The finish line is now the **web copy alone** unless the studio states otherwise:

| `requireSubset` | Confirms a font when | Use when |
|---|---|---|
| `false` *(default)* | `fileInput.woff2_web` is present | Your `fontWorker` writes the web copy, and the subset is best-effort or not implemented |
| `true` | **both** `woff2_web` and `woff2_subset` are present | You have verified your worker writes subsets |

The same predicate decides what still needs work on the way in, so with the old behaviour a partial
worker also re-ran server-side subsetting on every upload for fonts that had already finished.

> `requireSubset` is read from `plan.settings.requireSubset` by `executeUploadPlan`. It is **not yet
> forwarded from the field's `options.defaults`** — today it is reachable only when driving
> `executeUploadPlan` with a plan you built yourself. Studios using `BatchUploadFonts` get the
> default (`false`), which is the correct setting for every current consumer.

#### Timeouts, and reading the console

Every network step in this phase is bounded, because none of them can be trusted to answer:

| Step | Bound | Notes |
|---|---|---|
| `collectFontsForGeneration` — the "what still needs work" query | **60s** | Untimed until 2.20.1; it sat exactly where the UI goes quiet after the patch |
| `requestWebAndSubset` — each `fontWorker` POST | **60s** `AbortController` | The response is `no-cors`/opaque and is *never* the success signal, so aborting is safe: it does not cancel the server-side subsetting, and the poll still picks up whatever lands |
| `verifyWebAndSubset` — the confirmation poll | **180s**, polling every **4s** | Logs each confirmation, plus a heartbeat every fifth empty poll |

All of it narrates itself to the browser console with elapsed milliseconds — `Web/subset: …` per step
and `Upload phase: …` at each phase boundary. If a run ever stalls again, the last line printed names
the phase.

To backfill fonts uploaded before this existed, call `generateWebAndSubset` directly, or use the
consuming site's own backfill script if it has one.

### Trial fonts (env-gated)

Set `SANITY_STUDIO_TRIAL_UNICODE_RANGE` and every font gets a downloadable trial: its OTF — or its
TTF when there is no OTF — subset to that range and renamed so it cannot collide with a licensed
install. For a font "Romek Bold" that is family `Romek DEMO`, full name `Romek DEMO Bold`, PostScript
name `RomekDEMO-Bold`, file `DEMO_Romek-Bold.otf`. A trial keeps its source's extension, so one cut
from a TTF-only font is `DEMO_Romek-Bold.ttf` — which matters for variable fonts shipped as TTF.
**Leave it unset and nothing changes** — no field,
no row, no requests — so other foundries carry no cost.

```env
# Printable ASCII: A–Z, a–z, 0–9, space and punctuation
SANITY_STUDIO_TRIAL_UNICODE_RANGE=U+0020-007E
# Optional. Letters and digits only; defaults to DEMO
SANITY_STUDIO_TRIAL_LABEL=DEMO
```

With the range set:

- `createFontFileFields()` adds `fileInput.trial`, a file field that also stores the `unicodeRange` and
  `label` it was built with. Script variants (`derived: false`) do not get one.
- **Batch upload** rebuilds trials once the web/subset phase finishes ("Generating trial fonts…"), but
  only for fonts whose trial source was in the upload: an OTF, or a TTF for a font with no OTF. A batch
  of only web formats, or a TTF for a font that already has an OTF, leaves the trial alone; fill any
  missing trials with Generate Trial Fonts. Turn it off for one uploader with
  `options.defaults.trialFonts: false`.
- **`SingleUploaderTool`** shows a **TRIAL** row (Build / Upload / Delete) and rebuilds the trial when an
  OTF is uploaded or built, or when a TTF is uploaded to a font that has no OTF.
- The typeface **Utilities** panel gains **Generate Trial Fonts**, which fills in missing and *stale*
  trials, with a switch to rebuild current ones too. A trial is stale when its stored range or label no
  longer matches the env — so changing the range makes every existing trial eligible again.

The site does the actual build: implement `code: 'generate-trial'` on the fontWorker (see
[the contract](#the-fontworker-endpoint-multi-format-conversion--subsetting)). Fetch `srcUrl`, subset
it to `unicodes`, rename it with `label`, upload it with `sourceFormat` (`otf` or `ttf`) as its extension, and set `fileInput.trial` to
`{ _type: 'file', asset, unicodeRange: unicodes, label }`. Store `unicodes` and `label` exactly as
received, since that is what the Studio compares against.

Requests and verification follow the web/subset pattern, in `utils/trialFonts.js`: 4 fonts at a time,
90s per request (the first trial on a cold function also starts the subsetter), then a Sanity poll of
up to 180s that waits for a **new** asset, so a rebuild is never confirmed by the trial it replaces.
TDF's `lib/buildTrialFont.js` (fontTools under Pyodide) is a working reference, and its
`scripts/generate-trial-fonts.js` backfills an entire dataset locally.

### Prerequisites the consumer provides

This plugin supplies the upload UI, parsing, and field factories — it writes to `font` and `typeface` document types that **your studio defines**. Use the [Schema fields](#schema-fields) tables below as the contract for the document shapes the uploaders read and patch (the `font` document's `fileInput`/`metaData`/`metrics` objects, the `typeface` document's `styles.fonts`/`styles.variableFont` arrays). `createStylesField` builds the `styles` object for you; the surrounding `typeface` and `font` document types are yours to declare.

### The `fontWorker` endpoint (multi-format conversion / subsetting)

TTF/OTF/WOFF/WOFF2 upload, parsing, CSS, and metadata all work with no extra infrastructure. The additional conversions (`generateFontFile`, `generateSubset` — EOT/SVG and DS-WEB/subset WOFF2) are delegated to a `POST /api/sanity/fontWorker` route **you implement on the consuming site**, because the conversion runs server-side. The plugin sends a JSON body of:

```jsonc
{ "code": "generate-fonts", "srcUrl": "...", "filename": "...", "documentId": "...", "codes": ["woff", "eot", ...] }
```

(plus `documentTitle`, `documentVariableFont`, `documentStyle`, `documentWeight`, `fileInput`, `language`). The endpoint URL is derived from `SANITY_STUDIO_SITE_URL`. The request is fire-and-forget (`mode: 'no-cors'`), so the worker writes the converted assets back to the Sanity document itself.

[Trial fonts](#trial-fonts-env-gated) send their own body, and are only sent when `SANITY_STUDIO_TRIAL_UNICODE_RANGE` is set:

```jsonc
{ "code": "generate-trial", "srcUrl": "https://cdn.sanity.io/…/romek-bold.otf", "sourceFormat": "otf", "documentId": "romek-bold", "documentTitle": "Romek Bold", "unicodes": "U+0020-007E", "label": "DEMO" }
```

`unicodes` is always the canonical form (comma-separated `U+XXXX` / `U+XXXX-YYYY`, upper-case, no spaces). The worker writes `fileInput.trial` with `unicodeRange` and `label` copied from the request.

---

## Upload workflow

`BatchUploadFonts` opens `UploadModal`, a multi-step dialog that takes you from raw font files to linked Sanity documents. The flow is split into two phases — a preview you can edit, then the actual upload — so **nothing is written until you confirm**. Each step lists the component that implements it (in parentheses) for developers; the plain-language action comes first.

1. **Drag in your fonts** — drop TTF/OTF/WOFF/WOFF2 files onto the styles field and set defaults like price and how filenames map to titles. *(`UploadStep1Settings`)*
2. **Review what it detected** — the modal parses every file and shows a table of detected weight, style, and subfamily, all editable per font. Any font that already exists gets an **update existing vs create new** toggle so a re-upload updates the right document instead of duplicating it. This step only **reads** from Sanity. *(`UploadStep2Review` · `FontReviewCard` · `BulkActions` · `ExistingDocumentResolver`, driven by `buildUploadPlan` + `resolveExistingFont`)*
3. **Confirm to upload** — on your confirmation the assets are uploaded, `@font-face` CSS and metadata are generated, font documents are created or updated, and the typeface's `styles.fonts` array is patched. Progress is shown per font. *(`UploadStep3Execute`, driven by `executeUploadPlan`)*
4. **Map variable-font instances** — for a variable font, its named instances (e.g. *Light*, *Bold*) are matched to the matching static font documents; an **Autofill with Matching** action does this for you, and missing instances can be created. *(`UploadStep3bInstances` — see [`VariableInstanceReferencesInput`](#variableinstancereferencesinput))*
5. **Review the summary** — a per-font created / updated / failed report. *(`UploadSummary`)*

### Plan / Execute API

The pipeline is also exported as plain functions and reducers, so the upload engine can be driven or tested independently of the modal UI.

| Export | Description |
|---|---|
| `UploadModal` | The full multi-step modal dialog. Props: `open`, `onClose`, `client`, `docId`, `typefaceTitle`, `stylesObject`, `preferredStyleRef`, `slug`, `defaults`. Lazy-loaded by `BatchUploadFonts`. |
| `UploadStep1Settings`, `UploadStep2Review`, `UploadStep3Execute`, `UploadStep3bInstances`, `UploadSummary` | The individual step components, exported for custom modal layouts. |
| `FontReviewCard` | Collapsible per-font review row with editable weight/style/title/document-ID and a files indicator. |
| `BulkActions` | Sticky search/filter/expand-all bar for the review step, with create/update/error/conflict counts. |
| `ExistingDocumentResolver` | The update-existing vs create-new toggle and candidate picker for a single font. |
| `buildUploadPlan` | **Phase 1** — reads font files, parses with `lib-font`, resolves existing documents, and returns a complete `UploadPlan` for review. Performs Sanity reads only. |
| `executeUploadPlan` | **Phase 2** — uploads assets, generates CSS/metadata, creates/updates font documents, and patches the typeface. Skips fonts marked `error`; caches asset refs for idempotent retry. |
| `resolveExistingFont` | Resolves whether a font already exists — exact `_id`/slug match first, then content match by `typefaceName + weightName + style + subfamily + variableFont`. Returns `{ exact, candidates, recommendation, lookupFailed }`. |
| `planReducer` | Reducer driving the plan state machine (file processing, user edits, document resolution). |
| `executionReducer`, `createInitialExecutionState` | Reducer + initializer tracking per-font execution progress. |
| `createEmptyPlan`, `createFontDecisions` | Factories for an empty `UploadPlan` and a font's decision record. |
| `FONT_STATUS`, `PLAN_PHASE`, `RECOMMENDATION`, `EXECUTION_STATUS`, `PLAN_VERSION` | Enum constants for plan/execution state (single source of truth in `planTypes`). |

---

## Safety &amp; reliability

The upload engine is built to be pointed at a production dataset:

- **Review before write.** Phase 1 (`buildUploadPlan`) only **reads** — it parses files and looks up existing documents. No font document is created or modified until you confirm the plan and Phase 2 (`executeUploadPlan`) runs.
- **Duplicate resolution.** `resolveExistingFont` matches incoming fonts to existing documents (exact ID/slug, then content match) so a re-upload updates the right document instead of creating a duplicate.
- **Concurrency limit.** Asset uploads run at most `CONCURRENCY_LIMIT` (3) at a time.
- **Rate-limit handling.** `429` responses are retried up to `MAX_RETRIES` (3) with exponential backoff and ±25% jitter (`backoffWithJitter`), so large batches don't hammer the API. The retry is rate-limit-specific — other failures (a `500`, a network drop) fail that font rather than retrying, and it surfaces in the per-font summary.
- **Per-font isolation.** Uploads run via `Promise.allSettled`, so one font failing does not abort the rest of the batch; each font's outcome is tracked independently.
- **Idempotent retry.** Execution caches asset references in progress, so a partially failed batch can be retried without re-uploading assets that already succeeded; fonts marked `error` are skipped.
- **Long-upload guards.** The modal holds a Wake Lock and installs a `beforeunload` guard while executing, and confirms before closing mid-flight.

## Testing

The package ships a [Vitest](https://vitest.dev/) suite under `src/tests/` covering the reducers (`planReducer`, `executionReducer`), plan types, document resolution, font parsing/metadata, CSS generation, keyword expansion, and a `lib-font` integration test with a mock font fixture.

```bash
npm test          # vitest run
npm run test:watch
```

**440 tests across 25 files, green in under 3 seconds** as of 2.21.0 (35 further tests are skipped — environment-gated cases, not failures). It runs with no Sanity project, no network, and no fixtures to download, so it is a reasonable first thing to run when evaluating the package:

```
 Test Files  24 passed | 1 skipped (25)
      Tests  440 passed | 35 skipped (475)
   Duration  2.74s
```

The `build` script (`npm run build`) runs the test suite before bundling with `tsup`, so a broken test blocks publish. (The suite — like the runtime — requires `lib-font` and `pako` in `node_modules`; see [Parsing dependencies](#parsing-dependencies).)

The suite is also where regressions get pinned: the batch-upload hang fixed in 2.20.1–2.21.0 (see [`requireSubset`](#what-counts-as-done--requiresubset-2210)) is held down by cases in `generateWebAndSubset.test.js` covering the request timeout, the confirmation predicate, and the skip-already-complete path.

---

## Components

### `BatchUploadFonts`

Drag-and-drop batch uploader for a typeface document. Accepts TTF/OTF/WOFF/WOFF2 etc., shows a reviewable file list with count, confirm button, elapsed timer, Wake Lock, and `beforeunload` guard for long uploads. Calls `uploadFontFiles` for each batch.

```jsx
import { BatchUploadFonts } from '@overpunch/sanity-font-manager';

export const typefaceSchema = {
  name: 'typeface',
  type: 'document',
  fields: [
    {
      name: 'styles',
      type: 'object',
      components: { input: BatchUploadFonts },
      fields: [ /* see Schema fields below */ ],
    },
  ],
};
```

### `SingleUploaderTool`

Per-font file manager inside a font document. Shows TTF/OTF/WOFF/WOFF2/CSS rows always. EOT/SVG/WEB/SUBSET/DATA are hidden behind an advanced toggle (cog icon). Each row has Upload/Build/Delete controls. Handles CSS regeneration, font data extraction, and WEB+SUBSET building via fontWorker.

```jsx
import { SingleUploaderTool } from '@overpunch/sanity-font-manager';

{
  name: 'fileInput',
  type: 'object',
  components: { input: SingleUploaderTool },
  fields: [ /* format fields — see Schema fields below */ ],
}
```

### `GenerateCollectionsPairsComponent`

One-click generator for Full Family, Uprights, Italics, and Subfamily collections, plus Regular/Italic pairs matched by weight. Has configurable price inputs for collection-per-font and pair price.

```jsx
import { GenerateCollectionsPairsComponent } from '@overpunch/sanity-font-manager';
```

### `PrimaryCollectionGeneratorTypeface`

One-click generator for a single full-family collection that includes all fonts linked to the typeface. Prepends the new collection to the existing `styles.collections` array — non-destructive. Uses `SANITY_STUDIO_DEFAULT_COLLECTION_PRICE` as the default price, falling back to `100`.

Wire it up on a `string` field in the typeface schema:

```jsx
import { PrimaryCollectionGeneratorTypeface } from '@overpunch/sanity-font-manager';

{
  name: 'generateCollectionGroup',
  type: 'string',
  title: 'Generate Full Family Collection',
  description: 'Generate a collection that includes all the styles from this typeface.',
  components: { input: PrimaryCollectionGeneratorTypeface },
  hidden: ({ parent }) => !parent?.styles?.fonts?.length,
}
```

### `FontScriptUploaderComponent`

Script-aware uploader for per-script font file variants (Latin, Arabic, Hebrew, etc.) stored in `scriptFileInput` on the font document.

### `UploadScriptsComponent`

Batch uploader for script-specific font variants across multiple fonts at once.

### `UpdateScriptsComponent`

Updates and re-links existing script font variant references on font documents — used to fix or reassign script variant assignments.

### `RegenerateSubfamiliesComponent`

Recalculates and patches the `subfamily` field on all fonts linked to a typeface, based on the typeface's defined subfamily groups — without re-uploading any files.

### `SetOTF`

Detects which configured OpenType feature keys are supported by the typeface's first linked font. Reads `opentypeFeatures.chars` from the font document (populated by `generateFontData`) and patches the `features` array on the field. Shows a feature count when features are detected, and clear error messages when font data is missing.

Where the family ships a variable font, its labels win over the statics' — a VF is the whole family in one binary, while a static is one cut whose names may lag or be missing. Statics still fill in any tag the VF does not name.

Stylistic sets and character variants are titled with the foundry's own name where the font supplies one — `ss01` becomes "Alternate g" rather than "Stylistic Set 1" — read from `opentypeFeatures.featureList`. Features the font does not name keep their `OPENTYPE_FEATURE_TAGS` title, and a title an editor has typed is never overwritten. Because the label is stored per style at upload time, fonts uploaded before 2.18.0 need their data regenerated before their names appear.

Wire it up on the `openType` object field in the typeface schema:

```jsx
import { SetOTF } from '@overpunch/sanity-font-manager';

{
  name: 'openType',
  type: 'object',
  components: { input: SetOTF },
  options: { collapsible: true },
  fields: [ /* feature fields — each with a `feature` string e.g. 'liga', 'smcp' */ ],
}
```

### `StyleCountInput`

Displays the total number of font styles (static + variable) linked to a typeface. Reads `styles.fonts` and `styles.variableFont` arrays from the form context. Useful as a read-only display field in the typeface schema.

```jsx
import { StyleCountInput } from '@overpunch/sanity-font-manager';

{
  name: 'styleCount',
  type: 'number',
  readOnly: true,
  components: { input: StyleCountInput },
}
```

### `KeyValueInput`

Generic ordered key-value editor where both keys and values are plain strings. Supports add, remove, and reorder (up/down arrows). Values are stored as an array of `{ key, value }` objects.

```jsx
import { KeyValueInput } from '@overpunch/sanity-font-manager';

{
  name: 'aliases',
  type: 'array',
  of: [{ type: 'object', fields: [{ name: 'key', type: 'string' }, { name: 'value', type: 'string' }] }],
  components: { input: KeyValueInput },
}
```

### `KeyValueReferenceInput`

Generic key-value editor where keys are plain strings and values are weak Sanity document references. Supports searching by title via a popover picker, add/remove/reorder, and an optional `topActions` slot for action buttons above the list.

| Prop | Type | Description |
|---|---|---|
| `fetchReferences` | `async (client, doc) => [{_id, title}]` | Async function that returns candidate references for the picker. Receives the Sanity client and the current document. |
| `topActions` | `ReactNode` | Optional content rendered above the key-value rows (e.g. autofill buttons). |
| `referenceType` | `string` | Document type for the created weak references (default: `'font'`). |

```jsx
import { KeyValueReferenceInput } from '@overpunch/sanity-font-manager';

{
  name: 'instanceMap',
  type: 'array',
  of: [{ type: 'object', fields: [{ name: 'key', type: 'string' }, { name: 'value', type: 'reference', weak: true, to: [{ type: 'font' }] }] }],
  components: { input: KeyValueReferenceInput },
  // Pass props via options or a wrapper component:
  options: {
    fetchReferences: async (client, doc) => client.fetch('*[_type == "font"]{_id, title}'),
    referenceType: 'font',
  },
}
```

### `VariableInstanceReferencesInput`

Font-specific wrapper around `KeyValueReferenceInput` for mapping variable font instance names to their matching static font documents. Provides:

- A picker filtered to fonts sharing the same `typefaceName`, excluding variable fonts
- **Autofill with Matching** — calls `parseVariableFontInstances` to match instance names to existing font documents by weight/style heuristics
- **Autofill Keys Only** — populates instance name keys from the font's `variableInstances` metadata without resolving references
- Autofill buttons are shown only when the document is a variable font with parsed instance data
- Replace/merge confirmation dialog when pairs already exist

```jsx
import { VariableInstanceReferencesInput } from '@overpunch/sanity-font-manager';

{
  name: 'variableInstanceReferences',
  title: 'Variable Font Instances',
  type: 'array',
  hidden: ({ parent }) => !parent.variableFont,
  of: [
    {
      type: 'object',
      fields: [
        { name: 'key', type: 'string', title: 'Instance Name' },
        { name: 'value', type: 'reference', weak: true, to: [{ type: 'font' }], title: 'Matching Font' },
      ],
    },
  ],
  components: { input: VariableInstanceReferencesInput },
}
```

### `NestedObjectArraySelector`

Generic Sanity input that renders a searchable checkbox list of items pulled from a nested array field across documents of a given type (backed by [`useNestedObjects`](#usenestedobjects)). Configure entirely via schema `options`.

```jsx
import { NestedObjectArraySelector } from '@overpunch/sanity-font-manager';

{
  name: 'sections',
  type: 'array',
  of: [{ type: 'string' }],
  components: { input: NestedObjectArraySelector },
  options: {
    sourceType: 'licenseGroup',   // document type to query
    nestedField: 'sections',       // array field to extract
    titleField: 'title',           // GROQ expression for display text
    valueField: 'slug.current',    // GROQ expression for stored value
    filter: 'state == "published"',// optional GROQ filter
    sortBy: 'title asc',           // optional sort
    emptyMessage: 'No options found',
    searchPlaceholder: 'Search...',
  },
}
```

### `StatusDisplay`

Shared status bar used by all components. Shows `Status: [message]` in green on success and red on error, with an optional `action` element slot on the far right (used for the advanced toggle in `SingleUploaderTool`).

```jsx
import { StatusDisplay } from '@overpunch/sanity-font-manager';

<StatusDisplay status="ready" error={false} action={<Button ... />} />
```

### `PriceInput`

Reusable `$` + number input for collection and pair price fields.

### `UploadButton`

Label-wrapped button that triggers a hidden file input.

---

## Schema field definitions

Pre-built Sanity schema field objects that can be spread directly into a typeface schema's `fields` array. Eliminates hundreds of lines of repeated field definitions across consumer studios.

### `createStylesField`

Factory that builds the complete `styles` object field — the fonts, variable-font, collections, and pairs reference arrays plus the subfamily groups — for a typeface document. This is the field `BatchUploadFonts` reads and writes (see [Quickstart](#quickstart)). Call it with options to toggle optional sub-fields:

```js
import { createStylesField, BatchUploadFonts } from '@overpunch/sanity-font-manager';

{
  ...createStylesField({ generateCollections: true, pairs: true, styleCount: true }),
  components: { input: BatchUploadFonts },
}
```

| Option | Default | Description |
|---|---|---|
| `pairs` | `true` | Include the Regular/Italic pairs reference array. |
| `generateCollections` | `false` | Include the collections array + `GenerateCollectionsPairsComponent`. |
| `generateFullFamilyCollection` | `false` | Include the full-family collection generator (`PrimaryCollectionGeneratorTypeface`). |
| `regenerateSubfamilies` | `false` | Include the `RegenerateSubfamiliesComponent` action. |
| `styleCount` | `false` | Inject the read-only style-count field (`StyleCountInput`). |
| `displayStyles`, `free`, `serif`, `sortHeaviestFirst`, `buySectionColumns`, `fontSizeMultiplier`, `subfamily*` | various | Storefront/display toggles — see the source for the full set. |

> Uses `@overpunch/sanity-advanced-reference-array` (a peer dependency — see [Peer dependencies](#peer-dependencies)) for the typeface-scoped reference pickers.

### `createFontFileFields`

Factory that builds the **font** document's `fileInput` object — the per-format file set every foundry stores. Hand-copying it into each studio's schema let the shape drift, which matters because the uploader patches these exact paths. Spread the result into your `font` document's `fields` array (see [Quickstart](#quickstart)).

```js
import { createFontFileFields, SingleUploaderTool } from '@overpunch/sanity-font-manager';

createFontFileFields({ input: SingleUploaderTool, group: 'files' }),
```

| Option | Default | Description |
|---|---|---|
| `name` | `'fileInput'` | Field name. |
| `title` | `'Files'` | Field title. |
| `group` | *(omitted)* | Studio field group; left off the field entirely when not given. |
| `description` | a default help string | Help text under the field. Pass `null` to omit it. |
| `input` | *(none)* | Input component — normally [`SingleUploaderTool`](#singleuploadertool). |
| `derived` | `true` | Include `woff2_subset` and `woff2_web`. Set `false` when the site has no subset-capable `fontWorker`, so editors aren't shown fields nothing will ever fill. |
| `trial` | on when `SANITY_STUDIO_TRIAL_UNICODE_RANGE` is set and `derived` is on | Include the `trial` download file (with its `unicodeRange` / `label` sub-fields). See [Trial fonts](#trial-fonts-env-gated). |
| `formats` | *(all)* | Override the delivery format list, e.g. `['ttf', 'woff2', 'css']`. Validate against the exported `FONT_FILE_FORMATS`. |

Emits `ttf` (with an `.ttf` accept filter, since it is the source everything else converts from), `otf`, `woff`, `woff2`, `eot`, `svg`, `css`, plus `woff2_subset` and `woff2_web` when `derived` is on, plus `trial` when trial fonts are configured. `FONT_FILE_FORMATS` is exported alongside it as the list of names the factory can emit.

### `openTypeField`

A complete `openType` object field wired to the `openType` tab group. Includes the `features` checkbox array (all standard OpenType feature keys) plus per-feature sub-objects with `title`, `feature`, and `customText` fields. Uses `SetOTF` internally for auto-detection.

```js
import { openTypeField } from '@overpunch/sanity-font-manager';

// In your typeface schema fields array:
openTypeField,
```

Requires the `openType` group to be declared in your schema's `groups` array:
```js
{ name: 'openType', title: 'Open Type' }
```

### `createOpenTypeField`

Factory variant of `openTypeField`. Pass `{ customText: true }` to reveal a per-feature `customText` input on every feature object; pass `{ customText: true, customTextType: 'code' }` to make it a syntax-highlighted HTML `code` field (for `<span>`-wrapped sample text). Returns a plain `openTypeField` when `customText` is `false`.

```js
import { createOpenTypeField } from '@overpunch/sanity-font-manager';

// In your typeface schema fields array:
createOpenTypeField({ customText: true, customTextType: 'code' }),
```

### `styleCountField`

A read-only `number` field in the `styles` group that displays the total count of static + variable font styles linked to the typeface. Uses `StyleCountInput` internally.

```js
import { styleCountField } from '@overpunch/sanity-font-manager';

// In your typeface schema fields array:
styleCountField,
```

### `stylisticSetField`

A complete `stylisticSet` object field for the `stylisticSets` group. Contains two sub-arrays: `featured` (highlighted words/phrases with per-character backtick syntax, stylistic feature picker, size, and CSS overrides) and `sets` (full catalogue of feature → glyph mappings). Both include the full OpenType feature dropdown (44 named features + all 20 stylistic sets).

```js
import { stylisticSetField } from '@overpunch/sanity-font-manager';

// In your typeface schema fields array:
stylisticSetField,
```

Requires the `stylisticSets` group to be declared in your schema's `groups` array:
```js
{ name: 'stylisticSets', title: 'Stylistic Sets' }
```

New work should prefer `createOpenTypeShowcaseField` below — this field's cards each carry their own copy of the feature name and tag, which drifts from the reviewed `openType` field.

### `createOpenTypeShowcaseField`

An array of OpenType demo cards that **reference** the typeface's detected `openType` features instead of repeating them. The `openType` field stays the single source of truth — "Detect OTF" finds the features, the foundry reviews their titles and tags — and a card only adds what is its own: demo text (backtick syntax), the glyphs the feature affects, display size and default-off flags. The feature is picked with `OpenTypeFeaturePicker`, which lists only the features this typeface has detected and stores the openType key (`stylisticSet1`), never a CSS string.

```js
import { createOpenTypeField, createOpenTypeShowcaseField } from '@overpunch/sanity-font-manager';

// In your typeface schema fields array — keep the two together, openType first:
createOpenTypeField(),
createOpenTypeShowcaseField({ group: 'openType' }),
```

| Option | Default | |
|---|---|---|
| `name` | `'openTypeShowcase'` | field name |
| `title`, `description`, `group` | — | passed through |
| `memberName` | `'featuredWord'` | `_type` of the array members |
| `openTypePath` | `['openType']` | document path of the openType field |
| `sizes` | `true` | include the `xl`/`lg`/`md`/`sm` radio |
| `legacyFeatureField` | `false` | keep a hidden, read-only `stylisticFeature` string |

A card opens on the fields editors fill in — feature, content, glyphs, label override, size. The italics-only toggle (`italics`), the default-off toggles (`ligatures`, `calt`) and the CSS override (`specialtyCss`) sit in a collapsed **Options** fieldset; that is form layout only, the stored card stays flat.

**Adopting it in place of `stylisticSetField.featured`:** the member shape is compatible (`content`, `label`, `specialtyCss`, `ligatures`, `calt`, `italics`, `size` keep their names), so pass `{ name: 'featured', memberName: 'featuredWord', legacyFeatureField: true }` inside the existing `stylisticSet` object. Then migrate each card: `matchFeatureKey(card.stylisticFeature, openType)` returns the openType key when the tags match a detected feature exactly, and the matching `sets[].content` moves to the card's `glyphs`.

**Front end:** resolve each card against the same document's `openType` value.

```js
import { resolveShowcaseCard } from '@overpunch/sanity-font-manager';

const { label, css, detected } = resolveShowcaseCard(card, typeface.openType);
// label: card.label, else the reviewed openType title
// css:   card.specialtyCss, else the picked feature's tags ("'tnum' 1, 'lnum' 1"), else legacy stylisticFeature
```

The helpers (`resolveShowcaseCard`, `matchFeatureKey`, `listDetectedFeatures`, `featureTagsToCss`, `cssToFeatureTags`) live in `src/utils/openTypeShowcase.js` and import nothing from Sanity or React. A site that does not want the Studio package as a dependency can copy that one file.

---

## Hook

### `useSanityClient`

Returns the Sanity client instance from the studio context. Used internally by all components.

```js
import { useSanityClient } from '@overpunch/sanity-font-manager';

const client = useSanityClient();
```

### `useNestedObjects`

Fetches and flattens a nested array field across documents of a given type into a flat list of selectable items. Backs `NestedObjectArraySelector`.

```js
import { useNestedObjects } from '@overpunch/sanity-font-manager';

const { objects, loading, error } = useNestedObjects({
  sourceType: 'licenseGroup',   // document type to query
  nestedField: 'sections',      // array field to extract
  titleField: 'title',          // GROQ expression for display text
  valueField: 'slug.current',   // GROQ expression for stored value
  filter: 'state == "published"', // optional GROQ filter
  sortBy: 'title asc',          // optional sort
});
```

---

## Utilities

### Font parsing (lib-font)

Parsing runs on [`lib-font`](https://github.com/Pomax/lib-font). `parseFont` is the single entry point; the `fontHelpers` wrappers are the only code that touches `font.opentype.tables.*`. `setupDecompressors` registers `globalThis.pako` (WOFF) and `globalThis.unbrotli` (WOFF2) and is imported as a side effect by the package entry point and by `parseFont` — **import order matters**, so do not import `lib-font` directly before it.

| Export | Description |
|---|---|
| `parseFont` | `async (buffer, filename) => Font` — parses an `ArrayBuffer` into a `lib-font` `Font`. Enforces a 50 MB size limit and a 30 s timeout; throws on oversize/corrupt/timeout. |
| `getNameString` | Reads a name-table string by numeric name ID, preferring Windows/Unicode/English then Mac/Roman, with a per-font cache. |
| `getAllFeatureTags` | All OpenType feature tags from GSUB/GPOS (equivalent to fontkit's `availableFeatures`). |
| `getFeatureUiNames` | Foundry-authored labels for stylistic sets and character variants, read from each feature's FeatureParams — `[{ tag, title }]` sorted by tag. |
| `getCharacterSet` | Array of Unicode code points covered by the font. |
| `getVariationAxes` | Variation-axis map for variable fonts (`min`/`default`/`max` per axis). |
| `getNamedInstances` | Named instances of a variable font. |
| `getFontMetrics` | `unitsPerEm`, ascender/descender, cap/x-height, italic angle, etc. |
| `getFontMetadata` | `postscriptName`, `fullName`, `familyName`, `subfamilyName`, `copyright`, `version`. |
| `getWeightClass` | OS/2 `usWeightClass`. |
| `getFsSelection`, `getMacStyle`, `getItalicAngle`, `getGlyphCount`, `getFamilyClass` | Lower-level table accessors. |
| `escapeCssFontName` | Escapes a font family name for safe use in CSS. |

### Font processing

| Export | Description |
|---|---|
| `processFontFiles` | Reads font files via FileReader, parses with `lib-font` (via `parseFont`), and builds the `fontsObjects` map used by `uploadFontFiles` |
| `extractFontMetadata` | Extracts weight name, subfamily, style, and variable font flag from a `lib-font` parsed font |
| `extractWeightName` | Reads the weight name from `lib-font` name records, falling back through `preferredSubfamily → fontSubfamily` |
| `extractWeightFromFullName` | Strips the typeface title from the font's full name to isolate the weight/style suffix |
| `processSubfamilyName` | Strips weight and italic keywords from a subfamily string, preserving non-style words like "Condensed" |
| `formatFontTitle` | Normalises a font filename into a human-readable title — expands abbreviations, title-cases, collapses spaces |
| `addItalicToFontTitle` | Appends the detected italic keyword to a title when the font has a non-zero italic angle |
| `determineWeight` | Maps a weight name to a CSS numeric weight, preferring OS/2 `usWeightClass` when available |
| `sortFontObjects` | Sorts a `fontsObjects` map by ascending weight, placing Regular before Italic at equal weights |
| `createFontObject` | Builds the full font object (id, title, weight, style, files, etc.) for a single font file |
| `uploadFontFiles` | Core batch upload orchestrator — uploads each format to Sanity, generates CSS and metadata, then creates or updates font documents |
| `updateTypefaceDocument` | Patches the parent typeface document's `styles.fonts` array with newly uploaded font references |
| `renameFontDocuments` | Renames font document IDs across a typeface when a typeface slug changes |
| `updateFontPrices` | Bulk-updates the `price` field across all font documents linked to a typeface |
| `sanitizeForSanityId` | Converts arbitrary strings into valid Sanity document IDs (lowercase, hyphens, no special characters) |

### CSS and file generation

| Export | Description |
|---|---|
| `generateCssFile` | Builds a `@font-face` CSS file from a WOFF2 blob — URL or base64 `src`, variable font axis descriptors, and metric-tuned fallback `@font-face` for CLS reduction |
| `buildVFDescriptors` | Pure function — maps variation axes (from `getVariationAxes`) to CSS descriptors (`font-weight`, `font-stretch`, `font-style`), handling degenerate axes, `slnt`/`ital` priority, and `min > max` clamping |
| `generateFontData` | Fetches a TTF URL, parses with `lib-font`, and patches the Sanity font document with `metaData`, `metrics`, `glyphCount`, `opentypeFeatures`, `characterSet`, and variable axes/instances |
| `buildFontMetadata` | Pure function — extracts `metaData` and `metrics` from a `lib-font` parsed font without any Sanity side effects |
| `generateFontFile` | Fires a POST to the consuming site's `/api/sanity/fontWorker` endpoint with the format codes to convert (otf, woff, woff2, eot, svg, data) |
| `generateSubset` | Requests DS-WEB fingerprinted WOFF2 and display subset generation from an existing WOFF2 via fontWorker |
| `generateWebAndSubset` | The opt-in post-upload phase — collects the fonts still needing derived files, fans the requests out 4 at a time, then confirms by polling. Never throws; returns `{ requested, skipped, done, pending }`. See [Web copies and display subsets](#web-copies-and-display-subsets-opt-in) |
| `collectFontsForGeneration` | Reads back which fonts still need derived files (`{ client, ids, force, requireSubset }`), skipping those already complete. 60s query deadline |
| `requestWebAndSubset` | A single `no-cors` `fontWorker` POST for one font, bounded by a 60s `AbortController` |
| `verifyWebAndSubset` | Polls Sanity every 4s (up to 180s) until the expected derived fields land; `requireSubset` selects web-only vs web + subset |
| `parseVariableFontInstances` | Resolves named variable font instances into Sanity font document references, creating documents for missing instances |
| `getEmptyFontKit` | Returns a zeroed-out placeholder font object used when no font binary is available |

### Keyword utilities

| Export | Description |
|---|---|
| `generateStyleKeywords` | Builds weight and italic keyword lists (including abbreviation expansions like `Bd → Bold`, `Lt → Light`) for parsing font subfamily names |
| `reverseSpellingLookup` | Resolves a font name abbreviation to its canonical weight name |
| `expandAbbreviations` | Expands all known abbreviations in a string to full weight names |
| `removeWeightNames` | Strips weight and italic keywords from a string, leaving only non-style words |

### Constants

| Export | Description |
|---|---|
| `SCRIPTS` | Array of supported script variant names |
| `SCRIPTS_OBJECT` | Map of script names to their display labels |
| `HtmlDescription` | React component rendering the supported script list as formatted HTML |
| `DISCOUNT_REQUIREMENT_TYPES` | Array of supported discount-requirement type names |
| `DISCOUNT_REQUIREMENT_TYPES_OBJECT` | Map of discount-requirement type names to their display labels |

---

## Schema fields

### Font document (`font`)

| Field | Type | Description |
|---|---|---|
| `title` | `string` | Full font name (e.g. `MyFont SemiBold Italic`) |
| `slug` | `slug` | Sanitized document ID as a slug (`current` = document `_id`) |
| `typefaceName` | `string` | Name of the parent typeface |
| `style` | `string` | `'Regular'` or `'Italic'` |
| `weight` | `number` | Numeric CSS weight (100–900) |
| `weightName` | `string` | Human-readable weight name (e.g. `'SemiBold'`) |
| `subfamily` | `string` | Subfamily name (e.g. `'Condensed'`) |
| `variableFont` | `boolean` | `true` for variable fonts |
| `normalWeight` | `boolean` | `true` when the weight is the normal/regular weight |
| `fileInput` | `object` | Container for all uploaded format files |
| `fileInput.ttf` | `file` | Uploaded TTF file (Sanity asset reference) |
| `fileInput.otf` | `file` | OTF file (built from TTF or uploaded directly) |
| `fileInput.woff2` | `file` | WOFF2 file (built from TTF or uploaded directly) |
| `fileInput.woff` | `file` | WOFF file |
| `fileInput.eot` | `file` | EOT file (legacy) |
| `fileInput.svg` | `file` | SVG font file (legacy) |
| `fileInput.css` | `file` | Generated `@font-face` CSS file |
| `fileInput.woff2_web` | `file` | DS-WEB fingerprinted WOFF2 for web delivery |
| `fileInput.woff2_subset` | `file` | Display subset WOFF2 (Latin + Latin-1, fingerprinted) |
| `fileInput.trial` | `file` | Trial (DEMO) OTF, only when `SANITY_STUDIO_TRIAL_UNICODE_RANGE` is set. Sub-fields `unicodeRange` and `label` record what it was built with |
| `metaData` | `object` | Font metadata — `postscriptName`, `fullName`, `familyName`, `subfamilyName`, `copyright`, `version`, `genDate` |
| `metrics` | `object` | Font metrics — `unitsPerEm`, `ascender`, `descender`, `lineGap`, `capHeight`, `xHeight`, `italicAngle`, etc. |
| `glyphCount` | `number` | Total number of glyphs |
| `opentypeFeatures` | `object` | Available OpenType feature tags — `chars` (all tags) and `featureList` (`[{ tag, title }]`, the font's own names for its stylistic sets and character variants) |
| `characterSet` | `object` | Array of Unicode code points covered by the font |
| `variableInstanceReferences` | `array<object>` | Maps variable font instance names to static font document references — `[{ key: string, value: reference }]` |

### Typeface document (`typeface`)

| Field | Type | Description |
|---|---|---|
| `styles.fonts` | `array<reference>` | References to regular font documents |
| `styles.variableFont` | `array<reference>` | References to variable font documents |
| `styles.collections` | `array<reference>` | References to generated collection documents |
| `styles.pairs` | `array<reference>` | References to generated pair documents |
| `styles.subfamilies` | `array<object>` | Subfamily groups — each has `title`, `_key`, and `fonts: array<reference>` |
| `preferredStyle` | `reference` | Reference to the preferred regular-weight font document |

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SANITY_STUDIO_SITE_URL` | Yes | Base URL of the consuming site. Used by `generateFontFile` and `generateSubset` to call `/api/sanity/fontWorker`. |
| `SANITY_STUDIO_PROJECT_ID` | Yes | Sanity project ID. Used to build CDN file URLs inside the uploaders. |
| `SANITY_STUDIO_DATASET` | Yes | Sanity dataset name. Used alongside `PROJECT_ID` for CDN URLs. |
| `SANITY_STUDIO_SCRIPTS` | No | Comma-separated script variant names (e.g. `latin,greek,arabic`). Controls which script tabs appear. |
| `SANITY_STUDIO_DEFAULT_COLLECTION_PRICE` | No | Default per-font price for generated collections. |
| `SANITY_STUDIO_DEFAULT_PAIR_PRICE` | No | Default price for generated pairs. |
| `SANITY_STUDIO_TRIAL_UNICODE_RANGE` | No | Turns on [trial fonts](#trial-fonts-env-gated) and sets what they contain, e.g. `U+0020-007E`. Unset: no trial field, row or requests. |
| `SANITY_STUDIO_TRIAL_LABEL` | No | Trial label for family and file names; letters and digits only. Defaults to `DEMO`. |

---

## Local development

To use the local source instead of the published npm package, symlink it into a foundry repo:

```bash
# From the sanity-font-manager directory:
npm run link:darden   # symlink into Darden Studio
npm run link:tdf      # symlink into The Designers Foundry
npm run link:mckl     # symlink into MCKL CMS
npm run link:all      # symlink into all three at once
```

Then run the watch build so consumers pick up changes live:

```bash
npm run dev
```

To restore the published package in a consumer repo, run `npm install` inside that repo.

---

## License

[MIT](LICENSE) — [Liiift Studio](https://github.com/Liiift-Studio)
