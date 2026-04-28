# Custom Notification Sound

A client-side extension for [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine) that replaces the built-in synthesized "new message" ping with an audio file you upload yourself.

Marinara's default notification ping is generated procedurally via the Web Audio API (a two-tone sine ding at 880 Hz + 1320 Hz with a quick decay). This extension hooks the Web Audio path, suppresses that synthesized ping, and plays your sample in its place. It works for every code path that fires the ping — chat replies, autonomous messages, generation completion, and message stagger reveals.

## Installation

1. Open Marinara Engine.
2. Go to **Settings → Extensions → Add Extension**.
3. Open `custom-notification-sound.json` from this folder, copy its full contents, and paste into the Add Extension dialog.
4. Save and confirm the extension is **enabled** in the extension list.

The extension takes effect immediately — no reload required. With no sound uploaded yet, the default ping continues to play; the moment you upload one, your sample takes over.

## Usage

**Desktop:** press **Ctrl+Shift+M** anywhere in the app to open the settings panel.

**Mobile (or any device without a keyboard):** type `#cns` at the end of the URL in your browser's address bar and submit. The panel opens and the hash is cleared, so you can repeat with the same `#cns` whenever you want.

From there you can:

- **Enabled** — toggle the override on/off without removing the extension. When off, the default ping plays.
- **Upload audio…** — choose a local audio file (`.mp3`, `.wav`, `.ogg`, `.m4a` — anything the browser can play). The file is read as a data URL and stored in `localStorage`.
- **Test** — preview the loaded sound at the current volume.
- **Volume** — playback volume from 0.00 to 1.00 (default `0.70`).
- **Clear sound** — wipe the saved sound. The default ping returns immediately.
- **Close** — dismiss the panel.

Press **Esc** or click **Close** to dismiss.

All settings are saved per-browser via `localStorage` and persist across reloads.

### File size

Audio is stored inline in `localStorage`, which has a ~5 MB per-origin cap shared across all extensions. Keep clips under ~1 MB (a few seconds of mp3 is plenty). If a file is too large the panel will say so — pick a shorter or lower-bitrate clip.

### Browser shortcut conflict

`Ctrl+Shift+M` is used by some browsers (Chrome's "switch profile", Edge's menu shortcut). The extension intercepts the keystroke when Marinara is focused, so the panel opens instead. If the override is undesirable, set values manually via `localStorage` (see below) and ignore the shortcut.

### Setting values without the panel

If you'd rather skip the panel — useful for sharing a config or scripting setup — open DevTools and run:

```js
// Sound must be a data URL (data:audio/...;base64,...). The panel does the
// FileReader conversion for you; this is only needed for scripted setup.
localStorage.setItem('marinara-cns-sound', 'data:audio/mp3;base64,...');
localStorage.setItem('marinara-cns-name', 'my-ping.mp3');
localStorage.setItem('marinara-cns-volume', '0.7');
localStorage.setItem('marinara-cns-enabled', 'true');
```

Then refresh the page (or toggle the extension off and on in **Settings → Extensions**) so the values take effect.

## How it works

- The default ping is synthesized at runtime in `packages/client/src/lib/notification-sound.ts` using Web Audio oscillators. There is no asset file to swap and no `window`-level hook to monkey-patch directly.
- The extension wraps `AudioContext.prototype.createOscillator` with a thin shim. Each oscillator returned by the wrapper has its `frequency.setValueAtTime` recorded so the patched `start()` knows the scheduled frequency before playback begins.
- When `start()` is called and the recorded frequency matches the ping signature (880 Hz or 1320 Hz), the original `start()` is skipped, and — for the 880 Hz oscillator only — the user's uploaded sample plays via a transient `<audio>` element. The 1320 Hz shimmer is suppressed silently so only one custom sound fires per ping.
- All other Web Audio usage in the app (game-mode SFX, music, etc.) is unaffected because the suppression is gated on the exact ping frequencies.
- If the extension is disabled or no sound is uploaded, the patch falls through to the original `start()` and the default ping plays unchanged.
- On unload, the prototype patch is restored.

## Persisted localStorage keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `marinara-cns-enabled` | `"true"` / `"false"` | `"true"` | Toggle without uninstalling |
| `marinara-cns-sound` | data URL string | `""` | Base64-encoded audio, written by the panel's file picker |
| `marinara-cns-name` | string | `""` | Original filename, shown in the panel |
| `marinara-cns-volume` | number `0..1` | `0.7` | Playback volume |

## Known limitations

- **Frequency-pinned detection.** The hook fires on oscillators created with initial frequencies of exactly 880 Hz or 1320 Hz, matching the current Marinara ping signature. If the engine ever retunes the ping or moves to a sample-based notification, the extension will silently fall back to no-op until updated.
- **Browser autoplay policy.** Some browsers block audio playback until the user has interacted with the page at least once. The first ping after a fresh page load may be silent; subsequent pings work normally. This is a browser constraint, not a bug in the extension.
- **Single sound.** One sample is stored at a time; per-character or per-mode sounds are out of scope.
- **localStorage size cap.** ~5 MB total per origin, shared with other extensions. Long or high-bitrate clips will fail to save.
- **Shortcut override.** `Ctrl+Shift+M` is preempted while Marinara is focused. There is no in-app way to rebind it; edit the `.js` source and re-import if you need a different combo.
- **Hash trigger collisions.** The `#cns` URL hash opens the panel. If a future Marinara version uses hash-based routing for a path literally named `cns`, this will collide. Currently safe (Marinara uses path-based routing).

## Compatibility

- Built and tested against **Marinara Engine v1.5.5+**.
- Browser-sandboxed; runs in any browser Marinara supports.
- No Node, no filesystem, no external dependencies, no new API endpoints, no schema changes.
