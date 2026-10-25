# Quick start

This page covers the shortest path: create a project → place notes → preview → export. No network connection needed, and no need to read the [feature guide](./features.md) first.

## 1. Create a project

The app opens on the **project manager page**, on the project hub. Choose **New project**:

- **Blank project**: enter a project name and artist (both can be filled in later), pick the first chart's difficulty, then **Create**.
- **Duplicate project**: use an existing project as a template. Audio, cover, and chart content come along; chart status resets to unfinished.
- **Import from official chart / Import from community chart**: pick a song, preview it, then create a project from a chosen difficulty — audio and cover land in the project too. These two paths are desktop-only; see the [Bestdori community](./bestdori.md).

You land on the **project detail** view: every chart of that song, plus cover and audio. Choose **Open** (or **Open in workspace**) on a chart to enter the workspace.

## 2. Import audio (optional)

You can edit and preview without audio — the chart duration defaults to 30 seconds and can be edited by hand. Import audio and the chart duration is locked to the actual audio length.

Go to **Audio** and choose **Import audio**, then pick a local file. Any format your browser can decode works.

## 3. Place notes

The toolbar on the left of the workspace holds the pointer, BPM, single, flick, skill, left/right directional, slide, and curve tools, followed by editing tools (copy / cut / paste / delete / mirror / note code / undo / redo).

1. Pick a note type (say, **Single**).
2. Click on the track; the note lands on the nearest beat line. Snap is chosen in the toolbar (default 1/4, options 1/1 – 1/16).
3. Drag notes to move them, or marquee-select a group. The right panel shows the selection count and offers delete / mirror.
4. Slides take **two clicks**: the first sets the start node, the second completes the slide. To draw a curved band, switch to the **Curve** tool and drag on empty space — that's the brush.
5. Press Space to play / pause. Double-click the empty gutter left of the track to drop a **playback start marker**, then jump back to it with the shortcut.

Changes save automatically; there is no save button.

## 4. Preview

Open the **Preview** page:

- **Static preview** shows the whole chart: panels laid out horizontally, scrolled sideways. Zoom ranges 30%–300% continuously (slider or Ctrl/⌘ + wheel). Fullscreen is available; Esc exits.
- **Dynamic preview** is the simulation field — it plays like the game and is the better way to check feel and hit effects. Playback speed is adjustable.

The **Settings** panel toggles markers: BPM marks, time marks, beat lines, combo marks, and mirror. They only affect the preview, never the chart.

## 5. Export

- **Chart image**: in the static preview toolbar, choose **Export image** to get a header-band chart image (cover + song info + every panel), ready to post.
- **Video**: in the dynamic preview, choose **Export video**, pick a resolution and format, and the app renders it offline. A 5-second song-info intro is prepended automatically.

Export is independent of the preview's current zoom and toggles — the export profile is fixed so output sizes stay stable.

## Sample chart: paste and go

If you'd rather not place notes from scratch, paste a ready-made chart:

1. On **project detail**, choose **Add chart**.
2. Expand **Chart code (optional)** and paste the JSON below.
3. Choose **Add**, then open the chart in the workspace.

```json
[
  { "beat": 0, "type": "BPM", "bpm": 160 },
  { "beat": 0, "lane": 3, "type": "Single" },
  { "beat": 1, "lane": 2, "type": "Single" },
  { "beat": 1, "lane": 4, "type": "Single" },
  { "beat": 1.5, "lane": 4, "type": "Single", "flick": true },
  { "beat": 2, "lane": 1, "type": "Single" },
  { "beat": 2, "lane": 5, "type": "Single" },
  { "beat": 3, "lane": 2, "type": "Directional", "direction": "Left", "width": 2 },
  {
    "type": "Slide",
    "connections": [
      { "beat": 4, "lane": 5 },
      { "beat": 4.5, "lane": 4, "hidden": true },
      { "beat": 5, "lane": 3 }
    ]
  },
  {
    "type": "Long",
    "connections": [
      { "beat": 6, "lane": 0 },
      { "beat": 7, "lane": 0 }
    ]
  },
  { "beat": 8, "lane": 6, "type": "Single", "skill": true }
]
```

What it demonstrates:

- `beat` is the position in beats and may be fractional; `lane` is the track, 0–6.
- `type` is one of `BPM` / `Single` / `Directional` / `Slide` / `Long` / `System`.
- Add `"flick": true` for a flick, `"skill": true` for a skill note.
- Directional notes use `direction` (`Left` / `Right`) and `width` (1–3).
- Slides and longs list nodes in `connections`; `"hidden": true` on a middle node makes it an SP segment.

Beat 0 must contain a BPM note, or the app rejects the code — that is a hard rule of the chart format, not something specific to this sample.

## Next

- What every button does: [feature guide](./features.md)
- Using it in a browser: [web version vs desktop](./web-version.md)
- Publishing to the community: [Bestdori community](./bestdori.md)
