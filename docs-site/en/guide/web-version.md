# Web version vs desktop

The web version shares the same editing capabilities as the desktop build: editing, chart code, preview and chart images, the simulation field and video export, skins and appearance are all there. The only differences come from the environment — the browser has no desktop channels.

## The three lines shown in the app

The first visit to the web version shows an **About the web version** dialog, **once per browser**. Dismiss it with **Got it**; after that the same text lives in **Settings › About**. The three lines, verbatim:

> Some features are available only in the desktop app, for example catalog browsing and chart import.
>
> Project data is stored only in this browser; clearing site data will delete it.
>
> Use the desktop app for the full feature set.

Each line is expanded below. The dialog and this page say the same thing on purpose — when the app's wording changes, this page changes with it.

## 1. Some features are available only in the desktop app

What the web version lacks are **capabilities that need the desktop runtime**, not removed features:

- **Catalog browsing and signing in**: the official song catalog, community posts, accounts, and uploads all go through the desktop channel, which the browser doesn't have.
- **Importing official or community charts, and publishing**: same reason. New projects in the web version only offer **blank** and **duplicate**.
- **Diagnostic bundle export**: **Settings › About** has no diagnostic bundle entry. When reporting a web-version problem, include your browser version and reproduction steps instead.

"Desktop-only" is the rule to remember — you don't need a list: anything added exclusively to the desktop build later won't appear here on its own. See the [Bestdori community](./bestdori.md) page for how these work on desktop.

## 2. Project data is stored only in this browser

The web version keeps project data in **this browser on this machine**: another browser, another computer, or clearing site data and your projects are gone. The browser has no notion of a data directory either, so the web version's settings show no storage location.

For long-term charting, use the [desktop build](./install.md): projects live in a local data directory you can back up, move, and relocate.

## 3. Use the desktop app for the full feature set

Install the desktop app when you need the catalog, chart import and export, publishing, or durable project storage — see [Install](./install.md). The desktop and web versions can be used side by side without interfering.

## Updates

The web version is released together with the site, so **a refresh already gets you the latest build** — no manual check needed.

Desktop **app updates** (auto check at startup, manual check in About, download then restart) exist only in the installed build — no installer, no updater.
