# Feature guide

This page walks through the five functional areas of the app. Button positions follow the app; the UI language can be switched in Settings.

## Projects

A **chart project** is one song: project info, audio, cover, and multiple charts (each with difficulty / level) stored together. Reopening the app returns you to the **project manager page** and its project hub, ready to continue.

**Project hub**

- **Continue**: recent projects, sortable by recently opened / recently modified / chart count / name. Click a cover to open project detail.
- **Four creation paths**: blank, duplicate, import from official chart, import from community chart. The last two need the desktop channel — see the [Bestdori community](./bestdori.md); the web version shows only the first two.
- **Duplicate**: copies audio, cover, and chart content; chart status resets to unfinished and upload records don't come along.

**Project detail**

- Manage every chart of the song, inspect cover and audio, and enter each chart's workspace.
- **Chart status** is derived: no upload record and not marked complete is *unfinished*; marked complete is *completed*; having an upload record is *uploaded*.
- **The chart itself is read-only once uploaded**: you can view, preview, and play it, but the note-editing entry tells you to **copy this chart** first. A copy carries no status and can be published again. **Difficulty, level and tags** can still be changed from the **Update** dialog in project detail.
- A project keeps at least one chart. Deleting a project also deletes its audio, cover, and all charts, behind a confirmation. Posts already published to the community are unaffected.

## Editing and slides

The workspace edits one chart of the current project: toolbar on the left, track in the middle, note info and playback controls on the right.

**Note types and placement**

- Full set: single, flick, skill, left/right directional, slide, long. BPM lines and negative-BPM backflow regions are supported natively.
- Note tools are modal: pick one, then click the track to place. Single, flick, and skill replace each other; placing a directional note repeatedly on the same spot cycles its width 1→2→3 lanes.
- **Snap**: 1/1, 1/2, 1/3, 1/4, 1/6, 1/8, 1/12, 1/16 — default 1/4. Placement, dragging, and pasting share the same snap; changing the snap never re-flows existing notes.
- Slides take two clicks: start node, then completion. Clicking the same beat again cancels. Dropping a directional note on a slide node splits it into two slides.

**Deep slide editing**

- Delete tool on a middle node turns it into a **hidden node** (the basis of SP segments); on an endpoint it removes the node.
- Delete tool on a connecting band **splits** the slide at that segment.
- Slide tool marquee, or Ctrl+E: **combine** selected endpoints into one slide.
- Mirror tool on a click or marquee: flip the whole slide across the track center.
- Curve tool: dragging on empty space in tool mode is the **brush** (real-time sampling along the path); Shift+drag marquees instead.

**SP curve tool**

- 10 easing families (Sine / Quad / Cubic / Quart / Quint / Expo / Circ / Back / Elastic / Bounce) × 4 types (In / Out / In-Out / Out-In).
- Three sampling precisions: 1/16, 1/32, or 1/64 per beat.
- Shape templates (S-curve, double wave, shake bar, arc, heart) and easing are mutually exclusive: picking a template disables family / type / precision.

**Selection, playback, history**

- Marquee, drag, copy / paste / cut, delete, and mirror all act on the selection; undo / redo covers edits and canvas operations.
- Space plays / pauses. With no audio, double-click the timecode in the playback bar and type `mm:ss` to set the chart length directly.
- Double-click the empty gutter left of the track to place a **playback start marker**. It is pinned to a time in seconds, so BPM changes don't move it.

**Chart code**

- The toolbar's **Chart code** opens the entire chart as Bestdori-style JSON, independent of the selection. The **Note code** tool (B; Ctrl+B for the note at the cursor) looks at a single note or segment.
- Before applying, the code is validated: it must be an array, beat 0 must hold a BPM note, lanes stay within 0–6, BPM can't be 0, directional `direction` / `width` must be valid, and so on. Errors are listed and the apply is refused.
- Unknown fields and extension data are preserved: they are written back verbatim, so nothing drifts from the community format.
- Unapplied drafts are never exported. **Save as** writes the original source text when the code hasn't been touched by canvas edits.

**Shortcuts**

- The Shortcuts page lists every function with exactly one key. Rebinding rejects conflicts, and each function can be temporarily disabled.
- Page switching: Ctrl+Shift+1…6 for workspace, audio, preview, assets, shortcuts, settings; Ctrl+Shift+0 returns to the project manager.
- Common defaults: Space play / pause, Ctrl+Space jump to the playback marker, Ctrl+Z / Ctrl+Y undo / redo, Ctrl+Shift+B collapse the sidebar.
- Note tools: F single, G flick, A skill, S left directional, D right directional, E slide, W curve, R pointer, T delete, Q mirror, V paste.
- The shortcut table writes the modifier as Ctrl; on macOS that's ⌘.

## Preview and chart images

**Static preview**

- The chart is sliced into panels laid out horizontally and scrolled sideways; the wheel scrolls, Ctrl/⌘ + wheel zooms.
- Zoom is 30%–300% in 5% steps, default 100%. Fullscreen is available from the last toolbar slot; Esc exits.
- Markers live in the **Settings** panel: BPM marks, time marks (off / 1 / 2 / 5 / 10 s), beat lines (off / 1÷1 / 1÷2 / 1÷3 / 1÷4 / 1÷6), combo marks (every 50 combo), and mirror. Defaults: BPM and combo on, 5-second marks, whole-beat lines.

**Chart image export**

- Exports a PNG from the static preview. The filename is `<chart title>-<difficulty>-chart.png`; in the Chinese UI the suffix is `谱面图`.
- The header band is on by default and can be turned off entirely; its items are project name, chart title, difficulty + level, duration, note count, BPM, and export time, each toggleable.
- The export profile is fixed (panel size and density are decoupled from preview zoom). Above the canvas limit it first lowers density; if it still doesn't fit, the export fails with a message.
- The header band is a toggle: turn it off and you get a plain panel-only chart image.

## Simulation and video export

**Simulation playback**

- Plays like the game: scaled notes, hit effects, combo numbers, simultaneous-hit rings.
- Field skin pack and performance background are chosen independently — **use the packs actually listed in the preview** (assets change between versions); the lane asset picker displays in a 4-column grid with live hover and focus previews.
- Background brightness is adjustable 0%–100% (default 70%), dimming the background to enhance note visibility across both live playback and video export.
- Note speed is adjustable 1–12 (default 9.5) and only affects the dynamic view.
- Speed presets run 0.25×–2×; custom input is clamped to 0.1×–4×.

**Video export**

- 1080p or 720p, fixed at 60fps.
- Format **Auto** prefers MP4 + AAC; if this machine can't encode AAC it falls back to WebM. You can also force MP4 or WebM. Forcing MP4 with only an Opus track warns that some players may not handle it.
- Audio can be disabled for a silent video.
- The song-info intro is a fixed 5 seconds (difficulty / title / artist, each toggleable).
- Export runs in five phases: prepare assets → mix audio → encode audio → render frames → mux the file. It can be cancelled midway.
- Requires WebCodecs. When unsupported, the app suggests the latest Chrome / Edge or the desktop app.

## Skins and appearance

**Note skins**

- A whole-pack preset writes all six categories at once: single, flick, skill, left directional, right directional, slide.
- Each of the six can be overridden individually; the preview composes the current combination live and shows how many items differ from the preset.

**Key sound packs**

- Switch whole packs; the change applies to subsequent playback immediately, and keys already sounding pick up the new material after the next pause / replay.
- Every hit style can be previewed; directional keys are previewed at 1 / 2 / 3-note lengths.
- Key sound volume (rhythm-icon SE volume) runs 0%–100%, default 100%, and doesn't affect BGM.

**Canvas background**

- A local image, PNG / JPEG / WebP, up to 20MB; stored locally only.
- Scope: outside the track only (default — the track area keeps its original dark tone) or the full canvas (track area dimmed).
- Fit: cover (default) or contain (letterboxed).
- Opacity 0%–100%, default 55%.
- **Hide** keeps the image for one-click restore; **Clear** deletes it.

**Appearance and canvas display**

- Theme: light / dark / follow system. UI language: 简体中文 / English.
- UI scale 70%–150% (default 100%) and three UI font stacks (Geist / Microsoft YaHei / Noto Sans CJK). These affect the editor chrome only, never the chart canvas.
- Canvas display group: rhythm icon size, long-hold line opacity, simultaneous-click lines, color assist, vertical ratio, image quality (smooth / standard / HD), track color (mono / amber / cyan / vivid), line shape tiers, track line opacity, label size.
- Each group has **Restore defaults**, which resets that group only.
