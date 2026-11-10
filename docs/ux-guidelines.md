# UX guidelines

Use MUI and the existing theme in `apps/web/src/app/theme.ts`. These rules guide
incremental UI work; they do not authorize redesigning existing feature screens.

## Spacing and page structure

Keep MUI's 8px spacing base. Use 4/8/12/16/24/32px (`0.5/1/1.5/2/3/4` in spacing
props): 4px for label details, 8px between related controls, 12px for compact
clusters, 16px within sections, 24px between sections, and 32px for major breaks.
The shell owns page gutters: 16px below `sm`, 24px from `sm`, with the existing
`lg` maximum width. Header and main content share these horizontal boundaries.

Use `PageHeader` for a page title, optional description and optional actions.
It stacks on mobile and aligns horizontally from `sm`, without adding gutters.
Keep specialized headers with badges, workflow state or tabs local. Do not add
another scroll owner or viewport-height calculation to a page header.

## Typography and icons

- Page title: `h4` rendered as `h1`, 24px, weight 600, line height 1.3.
- Section title: `h6` rendered as `h2`, 18px, weight 600, line height 1.5.
- Subsection: `subtitle1` rendered as `h3`, 16px; use local weight 600 for emphasis.
- Field/group label: `subtitle2`, 14px, weight 500.
- Body: `body1`, 15px, line height 1.5.
- Dense rows and supporting copy: `body2`, 14px, line height about 1.43.
- Metadata: `caption`, 12px, line height about 1.66; do not use for primary content.

Sizes are defined in rem. Preserve CV Match's existing score and local emphasis.
The app font is IBM Plex Sans, bundled locally through `@fontsource` (no runtime
font requests). CV previews own their presentation: Source Serif 4 on a paper
surface, set in the preview component rather than the app theme, so future CV
templates can change it independently. Job status uses `StatusChip` (dot plus
sentence-case label) so color is never the only cue.
Use 20px icons for standard inline controls and 24px for illustrative import
choices. Size icons at their use sites rather than globally resizing all MUI
icons. Decorative icons are hidden from assistive technology; icon-only actions
need an accessible name. A small icon does not imply a small interaction target.

## Buttons and forms

Use sentence case, one contained primary action per task area, outlined secondary
actions, and text tertiary actions. Theme button minimum heights are 32px small,
36px medium, and 44px large; allow growth for wrapping and zoom. Use at least 44px
targets for touch-oriented actions when adapting a screen. Buttons have no raised
shadow and retain ripple behavior plus a visible keyboard focus outline.

Keep labels visible, errors adjacent to fields, and helper text concise. Use
compact fields for filters and normal fields for editing; there is no global
TextField size override. Align adjacent actions to the input, not its helper text.
Retain entered values on failure. Do not replace explicit Save with autosave.

## Surfaces, tables, filters and pagination

Prefer outlined Paper and subtle dividers. Avoid nested borders and decorative
shadows without a grouping purpose. Use semantic palette colors and text labels;
color alone must not communicate status. No global Paper, Chip or Accordion
styling overrides are required.

Keep table structure and domain metadata local. Emphasize the primary identifier,
mute supporting metadata, and align dates and statuses consistently. If text is
abbreviated, keep its full value accessible by keyboard and on touch devices.
Place filters above results and pagination below. Keep control positions stable
and distinguish initial empty, filtered empty, loading and error states, with
appropriate Add, Clear filter or Retry actions.

Foundation does not change Inbox filtering, ten-row pagination, row order, table
height or existing P4.1/P4.2 semantics. Future table changes need their own checkpoint.

## Responsive behavior and accessibility

Stack controls when space is insufficient and allow long text to wrap. Keep
horizontal table overflow inside its container, not on the page. Preserve semantic
headings, field labels, keyboard access, focus visibility and status announcements.
Check narrow screens and 200% zoom; do not hide required actions or clip content.
Preserve the editor's existing single field-scroll region and separate action row.
Application keeps its header, tabs and provenance above a bounded desktop form
scroller with a separate Save footer. Narrow or short viewports use natural page
scrolling when there is insufficient form space. CV Match uses document scrolling.

For MVP, Edit JD is manual editing of saved job details and Job description.
Source import and AI extraction belong to Add Job only. Preserve original source
text/documents and evidence; manual edits must not clear conflict acknowledgements
except to reset acknowledgement of a conflicting field that was edited again.

## Motion and layout stability

Do not animate filtering or scroll automatically after filter changes. Retain
focus and inputs during updates. Loading feedback should avoid unnecessary layout
movement; choose reservations of space only within an approved screen checkpoint.
Respect reduced-motion preferences when introducing motion. Preserve CV Match's
intentional evidence reveal, instant targeted scroll and focus-without-second-scroll.
Do not globally disable transition callbacks that coordinate that behavior.

## Theme defaults versus local sx

Use theme defaults for genuinely shared typography, button casing, button sizing
and focus treatment. Use local sx for domain layouts, responsive grids, emphasis,
scroll ownership and evidence presentation. Preserve existing local overrides
until the owning screen is reviewed. Do not add global overrides just to remove
one repeated sx expression. Extract a component only when repeated structure and
behavior justify it; use MUI primitives directly otherwise.

## Semantic contrast and destructive actions

Keep the ink-blue primary (Ledger) and MUI's default warning orange fills. Normal-sized text must reach
at least 4.5:1 against its actual background. Filled warning Chips use
`palette.grey[900]` text on the existing `palette.warning.main` fill through a
narrow theme override; other Chip variants and warning Alerts retain their own
semantic treatments. Verify the foreground/background pair for each component
and variant rather than assuming every warning surface shares the same colors.
Do not use warning orange as normal text on white merely because it is a
semantic token.

Use explicit error semantics for destructive actions such as “Discard and leave.”
In the existing unsaved-change confirmation, keep “Stay and edit” first,
outlined primary and initially focused; keep Discard last as outlined error.
Ensure Stay receives focus as the dialog becomes visible, and retain native
button Enter/Space activation, focus trapping and focus return. Preserve the guard and its
Stay/Discard behavior. Reversible review actions such as Dismiss do not become
destructive solely for visual consistency.
