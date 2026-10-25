# Bestdori community

The song catalog and community charts come from [Bestdori](https://bestdori.com/). This path needs the desktop app: the web version has no channel to the community platform, so these entries don't appear there — see [web version vs desktop](./web-version.md).

## Creating projects from the catalog

Two of the project hub's creation paths come from the community:

- **Import from official chart**: browse the official song catalog, preview a song, then create a project from a difficulty.
- **Import from community chart**: browse charts posted by players; same flow.

Both let you:

- Search by title, band, or catalog / post ID. The official catalog also filters by band, level range, and difficulties that are actually implemented.
- Preview the audio and check difficulty and level before importing.
- Use **Import chart along with it** to decide whether chart data comes along: on, you get the chart at the chosen difficulty; off, you get an empty project with audio and cover only.

Import runs in stages (audio → cover → chart → write project) and reports a specific reason on failure. If the chart code doesn't pass the apply gate, or the song isn't in the catalog, the project may only be partially created — the message tells you which part failed.

## Signing in

Choose **Sign in** in the account area of the project manager page and use your Bestdori account. Sign-up and password recovery happen in Bestdori's own sign-in dialog on their site.

- The account belongs to Bestdori; your **password is sent only to Bestdori** and never stored on this machine.
- The session is stored encrypted locally and restored on the next launch. If the system can't store it securely, the app says so and you sign in again next time.
- Signing in is only needed for publishing. Browsing and importing work without it.

## Publishing a chart

Open a chart and choose **Publish**. The dialog runs a pre-check and lists anything missing:

| Item | Requirement |
| --- | --- |
| Title | Chart title, or the project name |
| Artist | The artist in project info |
| Difficulty / level | Difficulty 0–4; level 1–35 |
| Description | Required, up to 5000 characters |
| Notes | At least one publishable note |
| Audio | Import audio first for custom songs; official songs don't need it |

Audio, cover, and the post are uploaded in one go; cancelling midway leaves no half-post.

Before publishing, be sure: **once posted, the chart itself can't be edited or deleted** — only difficulty, level, and tags can change on the community site. To change a chart, copy it, edit the copy, and publish that. A chart can be published only once.

## Upload records and read-only charts

- Project detail's **Upload records** lists the posts this project published, with post IDs.
- A chart with an upload record shows as *uploaded* and becomes **read-only** in the editor: you can view, preview, and play it, and every edit entry asks you to copy the chart first.
- A copy carries no upload state; edit it freely and publish it as a new chart.

## Community asset cache

Audio and covers downloaded during import are cached locally, so importing the same song again doesn't re-download. Manage it in **Settings › Storage & data › Community asset cache**:

- Idle days: assets unused for longer than this are cleaned up automatically (default 30 days).
- Size cap: the cache is trimmed when it exceeds this (default 1024MB).
- **Clear cache** works too; it doesn't touch audio or covers already inside projects.

## When something goes wrong

| Message | Cause and fix |
| --- | --- |
| Can't reach the community platform / official catalog | Check your network and retry; if it hangs, refresh the song list |
| The community platform is rate-limiting | Too many requests — wait a bit and retry |
| Community charts / official catalog are desktop-only | The web version has no such channel; use the desktop app |
| Can't write the local asset cache | Disk full or the data directory isn't writable; free space or check the directory |
| Your sign-in has expired | Sign in again before publishing |
| The community platform rejected this publish | Check the chart and the form fields, then retry |
| This chart has already been published | Copy the chart, edit the copy, publish that |

Import and publish failures usually name the next step. If in doubt, attach a [diagnostic bundle](./troubleshooting.md) to an Issue.
