# Troubleshooting

The fastest path is **export a diagnostic bundle first, then open an Issue**. The bundle already contains most of what's needed to diagnose a problem, so you don't have to dig through logs.

## Export a diagnostic bundle

Go to **Settings › About › Diagnostic bundle** and choose **Export diagnostic bundle**, then pick a location. You get a zip:

- `env.json`: app version, Electron / Chrome / Node versions, OS, data directory, current page and project.
- `settings.json`: the current settings object.
- `logs/`: the last 7 days of error logs and action trails.
- `chart/project.json`: only when **Include the current chart (no audio or cover)** is checked.

The bundle **contains no credentials** and never includes audio or covers. Logs roll per UTC day, cap at 5MB per file, and are kept for 7 days — nothing ancient accumulates in there.

The web version has no such entry in **Settings › About** (it needs the desktop runtime); include your browser version and reproduction steps instead.

Attach the zip to a [GitHub Issue](https://github.com/wuqiongjin/AAO-Editor/issues) along with the version, platform, and reproduction steps.

## A crash or a page that won't render

Errors are caught at three levels, each with its own dialog:

| Dialog | Scope | What you can do |
| --- | --- | --- |
| The app ran into a problem | Whole app | **Retry** rebuilds the UI; if it persists, export a bundle |
| This page can't be displayed | One page | Retry that page; other pages still work |
| The canvas can't be displayed | Workspace canvas | Retry the canvas; the rest of the workspace still works |

The action trail is flushed before the bundle is built, so a bundle exported right after a crash is the most valuable one.

## Common problems

### Audio import fails

If you see "Audio decoding failed" or "This file can't be decoded as audio", try another file — common formats such as MP3, OGG, and WAV work best.

### Audio file missing or out of sync

- **Missing**: the file the project points at is no longer on disk. Re-import it on the Audio page, or **Clear audio record** — note that clearing switches the song source to **custom**.
- **Out of sync**: the file on disk isn't the one recorded (durations differ). **Realign to audio** updates the chart duration and also switches the source to custom.

### The simulation or video export reports missing assets

The simulation field needs local field and background assets. Go back to **Preview**, let the assets load once, then export again. If it still fails, the assets are incomplete — report it with a bundle.

### Video export says this machine can't export

Video export relies on WebCodecs. Use the latest Chrome / Edge, or the desktop app.

### The data directory won't open, or moving it fails

- The destination must be an **empty folder**. If it already has content, it is treated as a parent directory and the app creates a same-named folder inside it.
- You can't move the data directory inside its current location or into a parent of it.
- Insufficient permissions (for example, a protected system folder) fails the move; pick a writable location.
- A failed move keeps the original location — you never end up with neither.

### Update check fails

"Can't check for updates right now" usually means a network problem. Updates come from GitHub Releases: retry later, or download the new installer from Releases directly. On slow networks in China, use CNB Releases for the installer.

### Changes weren't saved

A failed autosave of a chart project shows no dialog — it only leaves a line in the log. If work goes missing:

1. Stop making large edits and export a diagnostic bundle first (it carries the failure logs).
2. Check that the disk holding the data directory isn't full and the directory is writable (**Settings › Storage & data** opens it).
3. Open an Issue with the bundle and reproduction steps.

## What to include in an Issue

```text
Version: the number shown in Settings › About
Platform: Windows 11 / macOS 15 / Ubuntu 24.04 …
What happened: actual vs expected
Reproduction: 1. … 2. … 3. …
Bundle: attached (exported at …)
```

AAO Editor has **no remote telemetry** — maintainers only see what you choose to send.
