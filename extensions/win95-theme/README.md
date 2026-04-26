# Win95 Theme

A client-side extension for [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine) that re-skins the app as authentic Windows 95 — `#c0c0c0` gray fields, the classic blue title-bar gradient, MS Sans Serif everywhere, beveled buttons, inset inputs, chunky 16 px scrollbars, and a `#000080` selection highlight.

It's a theme, not a window manager. Marinara's layout, navigation, and iconography are left alone.

## Screenshots

> _Placeholder — drop screenshots here once installed._
>
> - `docs/conversation.png` — Conversation surface with titlebar + status bar
> - `docs/sidebar.png` — Left chat list with titlebar
> - `docs/modal.png` — A modal dialog with the Win95 frame
> - `docs/settings.png` — The Win95 Theme settings panel

## Installation

1. Open Marinara Engine.
2. Go to **Settings → Extensions → Add Extension**.
3. Open `win95-theme.json` from this folder, copy its full contents, and paste into the Add Extension dialog.
4. Save and confirm the extension is **enabled** in the extension list.

The skin takes effect immediately — no reload required.

## What it themes

- **Palette.** Overrides the engine's semantic CSS variables (`--background`, `--foreground`, `--card`, `--primary`, `--border`, etc.) at `:root`, so every component picks up the Win95 colors without selector wars. Both `[data-theme="dark"]` and `[data-theme="light"]` resolve to the same Win95 palette — toggling theme mode is a no-op while the extension is enabled.
- **Typography.** Re-points `--font-y2k` to `'MS Sans Serif', 'Pixelated MS Sans Serif', 'Microsoft Sans Serif', Tahoma, Geneva, sans-serif`. Body size is `0.75rem` (≈ 12 px) to stay close to the canonical 11 px without breaking flow on hi-DPI screens.
- **Buttons.** Raised bevel by default, pressed bevel on `:active`, dotted focus rectangle inside on `:focus-visible`. Disabled buttons get the etched gray text with the white shadow.
- **Form controls.** Inputs, textareas, and selects use the inset bevel. Checkboxes and radios are restyled to 13 × 13 px with the canonical checkmark / dot.
- **Scrollbars.** 16 px chunky webkit scrollbars with a patterned track, beveled thumb, and arrow buttons at each end (SVG triangles, no images bundled). Firefox falls back to its native scrollbars styled via `scrollbar-color`.
- **Selection highlight.** Classic `#000080` blue with white text everywhere `::selection` applies.
- **Window chrome.** A decorative Win95 titlebar is prepended to the chat surface (Conversation + Roleplay), the left chat list, and the right tools panel. The chat surface also gets a status bar at the bottom.
- **Status bar.** Shows `Ready` when idle and `Generating…` while a response is streaming, plus a fixed `Marinara Engine` label on the right. State is observed off the send / stop button — see "Streaming detection" below.
- **Modals.** The engine's modal dialogs (`[data-component="Modal"]`) get the bevel + a decorative blue title strip across the top.

## What it does NOT theme

- **Real window management.** The titlebar buttons (`_`, `□`, `×`) are decorative — they don't drag, minimize, maximize, or close anything. Clicks are swallowed.
- **A fake Start menu or taskbar.** Out of scope; would conflict with Marinara's real navigation.
- **Engine icons.** The engine's iconography (Lucide icons in messages, panels, the send button, etc.) is left alone.
- **Sounds.** No `chime.wav` is bundled. The original prompt offered system sounds as an optional toggle, but the extension would either need to bundle audio (size cost, plus the install path is "paste a JSON") or fetch them at runtime (forbidden — extensions must stay network-silent). Off the table for now.

## Settings

Open the settings panel any of three ways:

- **Desktop:** press **Ctrl+Shift+9**.
- **Mobile or anywhere without a keyboard:** add `#win95` to the URL and press Go. The hash is cleaned up automatically once the panel opens.
- Either way, press **Esc** or click **OK** / **×** to dismiss.

From the panel you can:

- Toggle **window chrome** (the decorative titlebars).
- Toggle the **chat status bar**.
- Click **Reset** to restore defaults.

There's no in-panel "disable the whole extension" toggle on purpose — use **Settings → Extensions** in Marinara to flip the extension off, which removes the styles and the chrome elements in one step.

All settings persist in `localStorage` and survive reloads.

## How it works

- **CSS does most of the work.** The engine's semantic tokens are re-pointed at the Win95 palette at `:root`, which paints every component automatically. Buttons, inputs, scrollbars, modals, and selection are styled directly — no JS required.
- **JS adds the elements CSS can't conjure.** Titlebars and the status bar are real DOM elements prepended / appended to the surface as siblings of React's content (never moving or removing React-managed nodes). They're positioned `absolute` inside a `position: relative` parent, so adding them doesn't disturb the inner flex layout.
- **Streaming detection.** Marinara's streaming flag lives in a Zustand store, not the DOM. The fallback is to observe the chat send button (`.mari-chat-send-btn`) for icon swaps — when streaming starts, Lucide replaces `lucide-send` with `lucide-stop-circle`, which the JS reads. If Lucide ever renames its classes, the status text silently degrades to a permanent `Ready` instead of throwing.
- **No body-wide observation.** A single 1 Hz `setInterval` reconciles which surfaces are mounted and (re-)attaches the send-button observer. This avoids the `MutationObserver(document.body, {subtree: true})` foot-gun that would tick on every streaming token.

## Known issues / limitations

- **DOM-dependent.** The extension targets stable selectors in Marinara Engine — `[data-component="ChatArea.Conversation"]`, `[data-component="ChatArea.Roleplay"]`, `[data-component="ChatSidebar"]`, `[data-component="RightPanel"]`, `[data-component="Modal"]`, `.mari-chat-send-btn`. If a future engine version renames or restructures these, the affected piece silently no-ops.
- **`!important` on `border-radius`.** Tailwind utility classes (`rounded-md`, `rounded-xl`, etc.) are baked into a lot of engine markup. The only practical defeat without per-component overrides is `border-radius: 0 !important` on buttons / inputs and the modal frame. Documented inline in `win95-theme.css`.
- **Modal backdrop.** `[data-component="Modal"]` ships with an inline-style backdrop blur. We override `background` with `!important` to make sure the Win95 face color wins.
- **Lucide-only streaming detection.** As above — the status bar reads off the send button's icon class. Native engine event would be cleaner if one is ever added.
- **Webkit-only scrollbar buttons.** Firefox keeps native scrollbars (styled via `scrollbar-color`). Webkit's `::-webkit-scrollbar-button:double-button` variants aren't reliable across versions, so we ship single arrows on each end.
- **Titlebar buttons are decorative.** Clicking `×` doesn't close anything; clicking `□` doesn't maximize. They're props.

## Compatibility

- Built against **Marinara Engine v1.5.5+**.
- Browser-sandboxed; runs in any browser Marinara supports.
- No Node, no filesystem, no external dependencies, no network calls, no schema changes.
