# LMS UI System

NEXTUM LMS uses a quiet operator-tool UI with restrained color. The base surface is neutral, and color is reserved for action priority, selected state, and meaningful status.

## Canonical Tokens

- Use Tailwind classes backed by HSL CSS variables in `src/app/globals.css`.
- Use `background`, `card`, `muted`, `border`, `foreground`, and `muted-foreground` for the default UI.
- Use `primary` for primary actions, active tabs, selected rows, and key metric accents.
- Use `success`, `warning`, `danger`/`destructive`, and `info` only when the color carries meaning.
- Do not use Tailwind color-family classes such as `bg-slate-50`, `text-emerald-700`, `border-red-200`, or arbitrary hex colors.

## Shared Components

Use `src/components/ui` first:

- `Button`: commands and icon buttons. Variants are `default`, `secondary`, `outline`, `ghost`, `destructive`, and `link`.
- `Input`, `Textarea`, `Select`, `SelectField`, `Checkbox`, `RadioGroup`: form controls. `SelectField` is a compatibility wrapper for existing `<option>` children; prefer direct `Select` primitives for new complex selects.
- `Tabs`: page-level or panel-level tabs.
- `Card`: bounded repeated items, dialogs, and tool panels. Do not nest cards.
- `Dialog`: all modal interactions and destructive confirmations.
- `PageShell`, `PageHeader`, `PageStatusBar`: routed LMS page structure.
- `StatusBadge`: statuses, source labels, selected target tags.
- `DataTable`: tables with overflow and consistent headers.
- `EmptyState`, `ErrorState`: empty/error/loading-adjacent states.
- `FormField`, `FormSection`: dense operational forms.
- `SelectableCard`: selectable choices where a card-like button is expected.
- `StatCard`: dashboard and summary metrics.

## Button Hierarchy

- Primary: one main action per page or form.
- Outline/secondary: common secondary actions such as refresh, cancel, edit.
- Ghost: low-emphasis toolbar and inline actions.
- Destructive: archive, hard-delete, reset, and irreversible actions.
- Icon buttons must use a known icon and an accessible label/title.

## Forms

- Prefer `FormField` for new forms.
- Use `Select` instead of raw `select`.
- Use `Checkbox` instead of raw checkbox inputs.
- Keep labels close to fields; helper text uses `text-muted-foreground`.
- Disabled/loading submit states must be visible.

## Tables And Lists

- Use `DataTable` for tabular data.
- Use `SelectableCard` for selectable row/card choices.
- Empty lists use `EmptyState`; fetch failures use `ErrorState`.
- Do not replace existing data with a full-page skeleton during background refresh. Use `PageStatusBar`.

## Dialogs

- Use `Dialog` primitives for all overlays.
- Destructive actions belong in a dialog or a guarded management tab.
- Manual `fixed inset-0` modal overlays are not allowed.

## Prohibited Patterns

- Raw `button`, `select`, `table`, and checkbox input in governed UI files.
- Local duplicates named `PageShell`, `StatusBadge`, or `SelectBox`.
- Legacy global domain CSS under `src/styles`.
- Inline hex colors or Tailwind color-family utilities in governed UI files.
- Decorative gradient/orb backgrounds in operational screens.

Allowed exceptions must be documented here before merging. Current built-in exceptions:

- `src/components/ui/button.tsx` implements the raw button primitive.
- `src/components/ui/selectable-card.tsx` implements a selectable button-card primitive.
- `src/components/ui/data-table.tsx` implements the raw table primitive.
- `src/features/lms/pages.tsx` may contain hex strings only for user-editable class/classroom color data and swatch fallbacks, not decorative UI styling.

## New Screen Checklist

1. Start with `PageShell`.
2. Use shared primitives from `src/components/ui`.
3. Use neutral surfaces and restrained primary/status accents.
4. Include loading, empty, error, disabled, and background-refresh states.
5. Run `npm run ui:check`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Current Scope

The current pass standardizes shared primitives plus all routed LMS screens: `/`, `/students`, `/assignments`, `/classrooms`, `/instructors`, `/accounting`, `/settings`, login, PIN, access-denied, no-academy, and error-boundary screens. New routed UI should be treated as governed by `npm run ui:check` from the start.
