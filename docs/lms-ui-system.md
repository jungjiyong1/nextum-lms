# LMS UI System

NEXTUM LMS uses a quiet, flat 2D operator-tool UI with restrained color. The base surface is neutral, and color is reserved for action priority, selected state, and meaningful status.

## Canonical Tokens

- Use Tailwind classes backed by HSL CSS variables in `src/app/globals.css`.
- Keep Tailwind preflight enabled. LMS relies on the browser reset for links, buttons, form controls, and consistent 2D interaction states.
- Use `background`, `card`, `muted`, `border`, `foreground`, and `muted-foreground` for the default UI.
- Use `primary` for primary actions, active tabs, selected rows, and key metric accents.
- Use `success`, `warning`, `danger`/`destructive`, and `info` only when the color carries meaning.
- Do not use Tailwind color-family classes such as `bg-slate-50`, `text-emerald-700`, `border-red-200`, or arbitrary hex colors.

## Shared Components

Use `src/components/ui` first:

- `Button`: commands and icon buttons. Variants are `default`, `secondary`, `outline`, `ghost`, `destructive`, and `link`.
- `Input`, `Textarea`, `Select`, `SelectField`, `Checkbox`: form controls. `SelectField` is a compatibility wrapper for existing `<option>` children; prefer direct `Select` primitives for new complex selects.
- `Tabs`: page-level or panel-level tabs.
- `Card`: bounded repeated items, dialogs, and tool panels. Do not nest cards.
- `Dialog`: all modal interactions and destructive confirmations.
- `PageShell`, `PageHeader`, `PageStatusBar`: routed LMS page structure.
- `StatusBadge`: statuses, source labels, selected target tags.
- `DataTable`: tables with overflow and consistent headers.
- `EmptyState`, `ErrorState`: empty/error/loading-adjacent states.
- `Skeleton`, `SkeletonPanel`: route and first-load placeholders.
- `FormField`, `FormSection`: dense operational forms.
- `SelectableCard`: selectable choices where a card-like button is expected.
- `StatCard`: dashboard and summary metrics.

## Button Hierarchy

- Primary: one main action per page or form.
- Outline/secondary: common secondary actions such as refresh, cancel, edit.
- Ghost: low-emphasis toolbar and inline actions.
- Destructive: archive, hard-delete, reset, and irreversible actions.
- Icon buttons must use a known icon and an accessible label/title.
- Buttons do not use elevation, press-depth transforms, or mouse-click rings. Use color, border, and background only.
- Links, buttons, selects, and inputs must inherit the global interactive reset. Do not reintroduce browser-default underline, native button chrome, or click-time outlines.

## Elevation And Focus

- Default surfaces are flat: no `shadow-*` utilities on cards, buttons, tables, forms, toasts, dialogs, or selectable rows.
- Use `border`, `bg-muted`, `bg-primary-soft`, and status tokens for hierarchy and state.
- Focus should be subtle and keyboard-oriented. Avoid `focus:ring-2`, `focus-visible:ring-2`, `ring-offset-*`, and click-time open-state rings.
- Do not use active press transforms such as `active:translate-y-px`.

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
- Sensitive admin actions use `PasswordConfirmDialog` and the server reauthentication/confirmation flow. PIN and idle-lock overlays are not part of the web UI.
- Manual `fixed inset-0` modal overlays are not allowed.

## Route-Level States

- App Router owns global route states through `src/app/loading.tsx`, `src/app/error.tsx`, and `src/app/not-found.tsx`.
- Use `ErrorState` for recoverable feature-panel fetch failures. Let unexpected render/runtime errors reach the nearest App Router `error.tsx` boundary.
- Do not add a client-side global `ErrorBoundary` around the whole application. Authentication failures are handled by the protected server layout and redirect to `/login`.
- Route-level loading and error screens use the same tokens and shared primitives as operational pages.

## Prohibited Patterns

- Raw `button`, `select`, `table`, and checkbox input in governed UI files.
- Local duplicates named `PageShell`, `StatusBadge`, or `SelectBox`.
- Legacy global domain CSS under `src/styles`.
- Inline hex colors or Tailwind color-family utilities in governed UI files.
- Elevation shadows, strong focus rings, ring offsets, or press-depth transforms in governed UI files.
- Decorative gradient/orb backgrounds in operational screens.
- Global pointer-capture recovery layers, PIN screens, or idle-lock overlays.

Allowed exceptions must be documented here before merging. Current built-in exceptions:

- `src/components/ui/button.tsx` implements the raw button primitive.
- `src/components/ui/selectable-card.tsx` implements a selectable button-card primitive.
- `src/components/ui/data-table.tsx` implements the raw table primitive.
- `src/features/lms/pages.tsx` and `src/features/lms/classrooms-operations-page.tsx` may contain hex strings only for user-editable class/classroom color data and swatch fallbacks, not decorative UI styling.

## New Screen Checklist

1. Start with `PageShell`.
2. Use shared primitives from `src/components/ui`.
3. Use neutral surfaces and restrained primary/status accents.
4. Include loading, empty, error, disabled, and background-refresh states.
5. Run `npm run ui:check`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Current Scope

The current scope covers shared primitives and every routed LMS surface: dashboard, assignment list/create/detail, classroom overview/attendance/schedule/settings, student list/detail, instructor list/detail, accounting, settings, login, access-denied, and App Router loading/error/not-found states. New routed UI is governed by `npm run ui:check` from the start.
