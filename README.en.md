<p align="center">
  <img src="./src/assets/brand/app-logo.png" alt="AAO Editor Logo" width="100" height="100" />
</p>

<h1 align="center">AAO Editor</h1>

<p align="center">
  <strong>Advanced Arrangement Organizer</strong><br />
  A desktop-grade chart editor built for BanG Dream! custom chart authors
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · English
</p>

From starting a project and editing the chart, to previewing it and exporting a sheet image or a gameplay video — every step of charting happens in one app.

![Project hub](./docs/media/readme/project-hub.png)

---

## Download

Get desktop installers from **[GitHub Releases](https://github.com/wuqiongjin/AAO-Editor/releases)** (Windows NSIS / macOS DMG / Linux AppImage, built with electron-builder). For networks with limited GitHub access, the same installers are mirrored to **[CNB Releases](https://cnb.cool/AsterPicker/AAO-Editor/-/releases)** shortly after each release. If in-app update checks cannot reach GitHub, install once from CNB, then set **Download source** to CNB in Settings → About.

Installers are not code-signed yet: on macOS, right-click (or Ctrl-click) the app and choose "Open" the first time; on Windows, if SmartScreen appears, choose "Run anyway".

AAO Editor is a non-profit, fan-made tool and the app bundle includes BanG Dream! game assets. Please read the [unofficial fan tool notice](#unofficial-fan-tool-notice) for copyright and disclaimer details before installing.

## Features

### Chart project management: one song, one project

A **chart project** is one song: project info, audio, cover art and multiple charts (each with its own difficulty / level) stay together on disk. When you reopen the app, you land on the **project hub** shown above and can pick up where you left off.

**Project hub**

- **Continue creating**: a list of recent projects — open one to return to that song's project detail.
- **New project** offers four sources: **blank project**, **duplicate project**, **import from official charts**, or **import from community charts**. Duplicating never copies upload records, so old projects work well as templates without colliding with publishing again.

**Project detail**

- Inside a song, manage every chart (difficulty / level), review cover art and audio, and open each chart's **workspace** from here.
- **Chart status** is derived automatically (in progress / completed / uploaded). An uploaded chart's **notes** are read-only — duplicate first, then edit the copy (difficulty / level / tags can still be changed from the **Update** dialog).

![Project detail: multiple charts under one song](./docs/media/readme/project-detail.png)

**Create from the song catalog (official import example)**

- From the hub, choose official or community import, search and preview, then create a project for one difficulty — BGM, cover art and chart code are written into the new project (screenshot below shows the official catalog; the community entry pulls from a post the same way).

![Pick a difficulty in the official catalog and create a project](./docs/media/readme/create-from-official-chart.png)

### Professional chart editing

- **All note types**: tap / flick / skill / directional (left / right) / slide / long; BPM events and negative-BPM backflow regions are first-class.
- **Deep slide editing**: add or remove nodes, split, combine endpoints, hidden nodes (SP spans), mirror whole slides; same-beat groups follow the author's ordering.
- **SP curve tool**: 10 easing families × 4 interpolation types with three sampling precisions; drag on empty canvas for the **freeform brush** that samples along your path in real time — bending a slide becomes drawing a curve instead of hand-placing hidden nodes.
- **Beat snapping** (1/1 – 1/16) and overwrite rules follow community conventions; placing, dragging and pasting share one set of semantics.
- **Shortcut system**: every function is bound to exactly one key ("switch / Ctrl+execute"), conflicts are rejected, and everything is rebindable.
- **Chart code is Bestdori-style JSON**: open the full chart code at any time to inspect or edit it; unknown fields and extension data are preserved verbatim.

![Workspace](./docs/media/readme/workspace.png)

**Placing slides**

![Quick slide placement](./docs/media/readme/place-slide.gif)

**SP curves and freeform brush**

![Drawing an SP curve with the brush](./docs/media/readme/curve-tool.gif)

**Drag editing**

![Dragging a note](./docs/media/readme/drag-note.gif)

![Dragging a curve](./docs/media/readme/drag-curve.gif)

![Dragging a selection of notes](./docs/media/readme/drag-a-selection-of-notes.gif)

### Chart preview and sheet image

- **Static preview**: the whole chart is sliced into panels, laid out horizontally and drawn lazily; zoom is continuously adjustable from 30% to 300%.
- **Marker profiles**: BPM labels / time labels / beat lines / combo labels / mirror — toggle what you need.
- **One-click sheet export**: a long image with a header band (cover + difficulty + BPM + duration + note count), ready to share.

![Static preview](./docs/media/readme/static-preview.png)

![Exported sheet image](./docs/media/readme/sheet-export.png)

### Bestdori community interop

- Browse the **official song catalog** and **community charts**: search, preview, import by difficulty, with audio and cover art brought along.
- Create a project directly from an official chart or a community post — the chart code lands in the editor as-is.
- Authorize your account to **publish** charts to the community; a published chart's **notes** can't be changed (duplicate it to revise them), while difficulty / level / tags can still be updated from the **Update** dialog.

> <!-- TODO(local capture): song picker / account authorization & upload screenshots -->

### Simulation field playback and video export

- **Game-style simulation field**: notes that scale along the approach model, hit effects, combo digits and hold rings; field skins and performance backgrounds are selectable.
- **Real-time playback**: 0.25× – 2× speed; with audio you get BGM + key sounds, without audio a synthetic timeline drives playback.
- **Offline video export**: frame-by-frame rendering with WebCodecs encoding — MP4 / WebM, 1080p / 720p, optional mute; a fixed 5-second song info opening (cover + difficulty + title + band) is prepended to every video.

![Simulation field playback](./docs/media/readme/simulation.png)

### Assets and personalization

- **Note skins**: one-click presets plus independent overrides for all six entries (tap / flick / skill / left & right directional / slide), with a live aggregate preview.
- **Key sound packs** switch as a whole; the rhythm-icon SE has its own volume.
- **Chart background skin**: any local image, with adjustable opacity / fill mode / display range.
- **Appearance**: light & dark themes, UI language (Simplified Chinese / English), font stack and type scale (70%–150%).

![Assets and appearance settings](./docs/media/readme/assets.png)

### Local-first

- Chart projects and settings live in a local data directory on your machine — no application business servers involved.
- **No remote telemetry**; troubleshooting relies on the in-app diagnostic bundle (version / environment / logs / operation trail).
- Settings are importable and exportable — moving machines is one JSON file.

## Unofficial fan tool notice

AAO Editor is a non-profit, fan-made tool. It is not affiliated with or endorsed by Bushiroad, Craft Egg, or the BanG Dream! project. In-app game assets such as note skins and key sounds are © BanG Dream! Project. The [MIT](./LICENSE) license in this repository covers only AAO Editor's own code, not those assets. If you believe any content here infringes your rights, please reach out via [GitHub Issues](https://github.com/wuqiongjin/AAO-Editor/issues).

## Local development

Requirements: Node.js ≥ 20.19 and npm.

```bash
git clone https://github.com/wuqiongjin/AAO-Editor.git
cd AAO-Editor
npm install
npm run assets:sync   # sync runtime assets (skins, key sounds, field art) — needs CNB credentials, ask the maintainer
bash scripts/dev.sh   # start the dev server (handles fd limits and the external address for you)
```

> **Repository layout**: development and CI live in the [CNB repository](https://cnb.cool/AsterPicker/AAO-Editor); GitHub is the publish mirror (releases + automatic code sync). Please file Issues / PRs in the GitHub repository; merges there are pulled back into CNB by the maintainer. Direct pushes to GitHub cannot enter the mirror (non-fast-forward pushes are rejected) — CNB is the source of truth. GitHub is gated as well: `main` only accepts pull requests that pass the required `gate` check (the CNB mirror account excepted), and `v*` tags can only be created by authorized identities; PRs from forks cannot fetch the private assets, so the maintainer pushes the branch into this repository to re-run the gate.

Common commands: `npm test` (unit tests + static lock tests), `npm run build` (web build), `npm run electron:dev` / `npm run electron:build` (desktop dev / packaging).

## Documentation

- Domain terminology and rules: [`CONTEXT.md`](./CONTEXT.md); architecture decision records: [`docs/adr/`](./docs/adr/)
- Product home: [wuqiongjin.github.io/AAO-Editor](https://wuqiongjin.github.io/AAO-Editor/); documentation: [guide](https://wuqiongjin.github.io/AAO-Editor/guide/)
- Issue tracker: [GitHub Issues](https://github.com/wuqiongjin/AAO-Editor/issues)

## License

The code in this repository is released under the [MIT](./LICENSE) license, Copyright © 2026 AAO Editor.

The MIT license covers only AAO Editor's own code; for the copyright of in-app game assets, see the unofficial fan tool notice above.
