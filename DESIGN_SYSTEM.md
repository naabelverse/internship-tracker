# Design System

The reference for how this product looks and why. `SPEC.md` owns scope; this owns
appearance. Where the two disagree about a colour or a size, this file is the one that
matches the code, because every value below is generated from or checked against source.

The product is an internship tracker: a dense, repeat-visit tool where the user's own
numbers are the content. Every decision here follows from that — tabular figures by
default, radii that encode hierarchy, colour used to mean something rather than to
decorate, and one loud typographic voice reserved for the few places that deserve it.

---

## 1. The token contract

Every colour in the app is a CSS custom property holding **space-separated RGB channels**,
never a hex string:

```css
--color-primary: 16 23 35;
```

That one shape works three ways, which is why it was chosen:

| Consumer            | How it reads the token                              |
| ------------------- | --------------------------------------------------- |
| A Tailwind utility  | `bg-primary` → `rgb(var(--color-primary) / 1)`      |
| An opacity modifier | `bg-primary/10` → `rgb(var(--color-primary) / 0.1)` |
| Chart.js at runtime | `getComputedStyle(document.documentElement)`        |

**`client/src/theme/tokens.json` is the single source.** `client/src/index.css` is
generated from it, `tailwind.config.ts` names the same tokens, and
`server/src/mail/palette.ts` is generated from it so transactional email matches the app.
A colour written by hand anywhere in `client/src` or `server/src` fails the build.

Themes swap on `data-theme` on `<html>`. That attribute is the only theme switch:
`darkMode` is `['selector', '[data-theme="dark"]']`, so the `dark:` variant and the
variable block cannot disagree. An inline classic script in `<head>` resolves it before
first paint, so there is no flash of the wrong theme.

---

## 2. Colour

### Semantic layer

The names say what a colour _is for_, not what it looks like. A component never reaches
past this layer.

| Token                             | Role                                 | Light         | Dark          |
| --------------------------------- | ------------------------------------ | ------------- | ------------- |
| `canvas`                          | The page behind everything           | `213 237 255` | `20 29 43`    |
| `surface`                         | A card or panel on the canvas        | `249 252 255` | `26 37 51`    |
| `surface-muted`                   | A recessed row, a chip, a track      | `231 237 246` | `35 45 60`    |
| `wash`                            | The auth split screen, and only it   | `166 196 232` | `26 44 74`    |
| `border`                          | The default rule                     | `216 223 233` | `43 54 70`    |
| `border-strong`                   | An input edge, a dashed empty state  | `159 176 198` | `58 74 96`    |
| `content`                         | Primary text                         | `6 10 18`     | `229 236 241` |
| `content-muted`                   | Secondary text, ledes, help          | `53 62 72`    | `155 166 177` |
| `content-subtle`                  | Metadata, timestamps, captions       | `68 78 89`    | `143 154 164` |
| `primary`                         | Neutral accent **as text or icon**   | `16 23 35`    | `215 223 229` |
| `primary-fill` / `-hover` / `-fg` | Neutral accent **as a solid button** | `16 23 35`    | `215 223 229` |
| `success`                         | Offer, completed                     | `8 102 48`    | `75 214 128`  |
| `warning`                         | Deadline approaching                 | `134 72 0`    | `255 186 51`  |
| `danger` / `-fg` / `-hover`       | Rejected, destructive                | `170 30 18`   | `255 131 119` |
| `info`                            | **Applied** status                   | `25 77 207`   | `139 178 255` |
| `ring`                            | Focus ring                           | `16 23 35`    | `215 223 229` |

**`primary` and `primary-fill` are still two tokens, but the blue-ground direction no
longer needs them to differ.** Under the violet palette one value could not do both jobs in
dark mode — a fill deep enough to carry white text was too dark to read as text on a card.
A neutral accent has no such problem: it is near-black in light and near-white in dark, and
reads correctly as both text and a slab, so the two tokens currently ship the same value in
each theme. They are kept apart because the gate measures them separately — `primary-fill`
against its own foreground, and as a shape on every surface — and collapsing them would
discard those assertions to save one line.

### Categorical series — `chart-1` … `chart-8`

The semantic tokens cannot carry a by-source or top-companies chart, because those need
colours that are _distinguishable from each other_ rather than colours that _mean
something_. Eight entries, each checked to be visually distinct from all the others.

### Heatmap — `heat-0` … `heat-4`

Activity intensity. `heat-0` is a day with nothing on it. The ends of the scale are
checked for 3:1 separation.

### Atmosphere — `atmos-*`

One light source and the texture it reveals. **Decorative only** — always painted on a
pseudo-element behind content or as a shadow around it, never as a text colour.

The two layers that _do_ fall under text (the hero lamp, the panel glaze) are checked at
peak alpha by the contrast gate.

Light mode is not dark mode with the numbers flipped, and it is not the same numbers
either. Both themes _add_ light at the lamp and fall back to their own canvas away from
it, so the atmosphere can only ever lift a pale canvas toward white or deepen a near-black
one toward black. Neither can push a background past a value the gate already checks.
That is a property, not a coincidence: under the violet palette a lamp that tinted the
light canvas _darker_ dropped `content-subtle` to 4.27:1, because it cleared that canvas by
only 4.90:1 and had nowhere to go. The pale blue canvas gives it far more room — 7.01:1 —
but the rule still holds where the ground is saturated: on `wash`, `content-subtle` clears
by 4.71:1, which is why nothing darkens that surface either.

---

## 3. Typography

**One superfamily, two voices.** Archivo Variable's `wdth` axis (62–125%) carries both
weight and width in a single file, so a heading set wide costs no extra request.

This is the part of the identity most easily broken by a well-meaning font swap: nearly
every typeface categorised for "productivity" or "data" is weight-only or condensed-only
(IBM Plex Sans and Roboto are both 75–100%), so replacing Archivo silently deletes the
wide display voice everywhere it is used.

### Width utilities

| Utility           | `font-stretch` | Used for                                          |
| ----------------- | -------------- | ------------------------------------------------- |
| `stretch-display` | 118%           | The landing hero, the loudest type in the product |
| `stretch-wide`    | 108%           | Page titles                                       |
| _(default)_       | 100%           | All body text                                     |

### Display scale

Picked off a scale, never reassembled from a size plus a tracking plus a weight. Tracking
tightens as size grows.

| Token             | Size                                     | Line height | Tracking | Weight |
| ----------------- | ---------------------------------------- | ----------- | -------- | ------ |
| `text-display-lg` | `clamp(2.5rem, 1.4rem + 4.6vw, 4.25rem)` | 0.94        | −0.032em | 700    |
| `text-display-md` | `clamp(1.75rem, 1.2rem + 2.2vw, 2.5rem)` | 1.04        | −0.022em | 650    |
| `text-display-sm` | 1.375rem                                 | 1.18        | −0.014em | 600    |
| `text-stat`       | 1.625rem                                 | 1.05        | −0.02em  | 700    |

`text-stat` exists because on this product **the counts are the content**.

### Body scale

Three sizes, on purpose. `text-sm` is the workhorse (the app is dense), `text-xs` is
metadata, `text-base` is for the rare piece of running prose.

### Roles

A role is a named combination that recurs. Reach for the name, not the string.

| Role        | Definition                                            | Where                        |
| ----------- | ----------------------------------------------------- | ---------------------------- |
| Page title  | `text-display-sm stretch-wide text-content`           | `PageHeader`                 |
| Page lede   | `mt-0.5 text-sm text-content-muted`                   | `PageHeader`                 |
| Panel title | `.panel-title` → `text-sm font-semibold text-content` | Any panel heading            |
| Body muted  | `text-sm text-content-muted`                          | Ordinary secondary copy      |
| Metadata    | `text-xs text-content-subtle`                         | Timestamps, counts, captions |

The last two are left as plain utility pairs deliberately: they are two utilities, they
read clearly at the call site, and they are used for genuinely different things. Naming
them would be abstraction without a role behind it.

### Figures

`font-variant-numeric: tabular-nums` is the **body default**. Archivo's proportional
figures make a column of dates or counts jitter as it updates, and nearly every number in
this product sits above or below another number. Running prose opts out with
`.nums-proportional`.

---

## 4. Radii, elevation, motion, spacing

### Radii encode hierarchy

One radius on every element regardless of weight is the flattest tell of a templated
interface. A dense data chip is squarer than a control; a control is squarer than a panel.

| Token             | Value    | For                            |
| ----------------- | -------- | ------------------------------ |
| `rounded-chip`    | 0.25rem  | A status chip, a checkbox      |
| `rounded-control` | 0.375rem | Buttons, inputs, inline alerts |
| `rounded-card`    | 0.625rem | A card in the page flow        |
| `rounded-panel`   | 0.875rem | A modal, a large surface       |

Components reach for one of these rather than for `rounded-xl`.

### Elevation

Used **sparingly**, and only where something genuinely floats. Grouping elsewhere comes
from rules and alignment, not from an identical soft shadow under every card.

| Token          | For                                                                        |
| -------------- | -------------------------------------------------------------------------- |
| `shadow-card`  | A card that needs the barest lift                                          |
| `shadow-panel` | A modal                                                                    |
| `shadow-float` | A popover: a lit top edge, a contact shadow, then a wide **coloured** cast |

`shadow-float`'s colour is load-bearing. A black shadow on a near-black canvas is
invisible, so a dark theme built on one reads flat however large the blur gets.
`--atmos-cast` is _lighter_ than the dark canvas, which makes one declaration read as a
shadow in light mode and as a glow in dark mode.

### Motion

| Token              | Duration | For                                                       |
| ------------------ | -------- | --------------------------------------------------------- |
| `duration-DEFAULT` | 150ms    | A control changing state under the cursor                 |
| `duration-panel`   | 200ms    | A panel or drawer — further to travel                     |
| `duration-data`    | 700ms    | A value animating into place, where motion is the message |

Easing default is `cubic-bezier(0.2, 0, 0, 1)` — ease-**out**, not Tailwind's symmetric
ease-in-out. A state change should leave immediately and settle at the end; easing into
the start delays the feedback the user is waiting for.

Setting `DEFAULT` rather than leaving it implicit tokenises every existing `transition-*`
call site without touching one of them.

### Spacing rhythm

Concentrated on `1 / 2 / 3 / 4 / 6`, with `8`, `10` and `16` for section breaks. Nothing
enforces this, so it is a convention rather than a gate — but a new value outside it
should have a reason.

---

## 5. Components

### Primitives — `client/src/components/ui/`

`Badge` · `Button` · `Card` · `Checkbox` · `ConfirmDialog` · `EmptyState` · `ErrorState`
· `FormError` · `Modal` · `PageHeader` · `PasswordField` · `Popover` · `Select` ·
`Skeleton` · `TextArea` · `TextField` · `icons`

### Composition rules

**`Card`** is the one definition of a surface. `cardSurface` is exported as a string for
the three call sites that cannot be a `Card` for structural reasons — `SettingsSection`
owns a `<form>`, `Popover` is a floating overlay, `BoardCard` swaps to a `ring-2`
treatment mid-drag. Forcing those into `Card` would be a false consolidation: tidier
count, wrong description.

**`PageHeader`** owns the `<h1>` of a routed page, its lede, and its trailing actions. The
flex row is applied _only_ when there are actions, so the wrapper describes the layout
rather than being inherited. Four other places use the page-title type without being page
headers — `ErrorBoundary`, `NotFoundPage`, `AuthSplitLayout`, `DetailHeader` — and are
deliberately left alone for the same reason `Card` leaves three sites alone.

**`FormError`** renders `errors.root` for every form. It takes a message rather than a
react-hook-form error object, and returns `null` on an absent message, which moves the
`{errors.root && ...}` guard inside the component.

**`.marketing-shell`** is the landing pages' measure and gutter (`max-w-6xl`). The app
runs at `max-w-7xl` — two deliberately different measures. Vertical padding stays at the
call site, because a hero, a section and a footer want different amounts of it.

### Required states

Every async surface has an explicit **loading (skeleton)**, **empty**, and **error**
state. Every mutation toasts on success and on failure. Icon-only buttons carry an
`aria-label`. Modals trap focus and close on Escape.

---

## 6. The gates

The system is enforced by tests, not by discipline. All run in `npm run verify`.

| Test                                  | What it refuses                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/config/noRawColour.test.ts`    | Any hand-written hex or RGB triplet in either `src` tree                                                                               |
| `tests/config/tailwindTokens.test.ts` | A Tailwind key naming a token that does not exist, **and** a token no utility can reach                                                |
| `tests/config/themeTokens.test.ts`    | Drift between `tokens.json` and the generated CSS                                                                                      |
| `tests/config/brandPalette.test.ts`   | Brand assets diverging from the palette                                                                                                |
| `tests/a11y/tokenContrast.test.ts`    | Any text pair below **4.5:1**, any non-text pair below **3:1**, in _both_ themes — including under the atmosphere layers at peak alpha |

`noRawColour` deliberately scans `index.css` with only its two generated theme blocks
blanked out. Roughly 62% of that file is hand-written `@layer` CSS, which is exactly where
someone would type a colour by hand; excluding the file wholesale would leave the majority
of it unguarded.

---

## 7. Extending this

**Adding a colour.** Add it to `tokens.json` in _both_ themes → add a key in
`tailwind.config.ts` → run `npm run verify`. The parity test fails if you do one and not
the other, in either direction.

**Adding a component.** Check `components/ui/` first. If a string is about to be written
out a third time, name it — as a component when it has behaviour or structure, as a
`@layer components` class when it is purely a composition of utilities (`.skeleton`,
`.panel-title`).

**Changing type.** Read §3 first. The width axis is the identity, not the family name.

**Three constraints, all measured, that any new palette must clear:**

1. **A saturated page ground cannot carry a status pill.** This is the one that decided the
   current direction. A pill is `bg-<token>/15 text-<token>`, and the gate checks each
   semantic against its own tint on every surface. On the reference's `#a6c4e8` the tint
   lands so close to the token that passing forces every status to near-black — measured at
   1.86–1.95:1 from body text, where Offer-green and Rejected-red stop reading as colour.
   Sweeping canvas lightness, vivid semantics only survive at L≈0.94. So the canvas is pale
   and the saturated blue is `wash`, painted on the auth split screen alone.
2. **The hue wheel constrains an accent, not a ground.** Blue (~264) collides with `info`,
   the _Applied_ status, which is why the violet direction refused a blue primary. The
   current direction sidesteps it rather than solving it: the accent is neutral, so it
   occupies no hue at all and the wheel belongs entirely to the status system.
3. **Archivo is a width axis, not a pairing.** See §3. Unchanged by this redesign.

`DECISIONS.md` has the full record, including the six directions tried before this one.
