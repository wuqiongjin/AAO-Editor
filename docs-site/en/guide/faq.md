# FAQ

## Is this an official tool?

No. AAO Editor is a non-profit fan-made tool, not affiliated with Bushiroad, Craft Egg, or the official BanG Dream! Project. See [Legal](./legal.md).

## Which platforms are supported? Is there a mobile app?

Desktop builds cover Windows (NSIS), macOS (DMG, Intel and Apple silicon), and Linux (AppImage). There is no iOS / Android build.

## Do I need to be online?

Editing, previewing, and exporting all happen locally — no network needed. Network is used for importing from the catalog / community, publishing, and checking for updates.

## Where are chart projects stored?

In the desktop app they live in the local app data directory, never on a business server; there is no remote telemetry. The path and an **Open data directory** button are in **Settings › Storage & data**.

The web version stores them in the browser, so clearing site data removes them — see [web version vs desktop](./web-version.md).

## How do I move to another computer?

- **Settings**: export the settings JSON in Settings › Storage & data, then import it on the new machine.
- **Projects**: copy the whole data directory across, then point **Settings › Storage & data** at it with **Use an existing data directory**.

## Which audio formats are supported?

Any format the browser can decode, for example MP3, OGG, and WAV. When decoding fails, the app asks you to pick another file.

## Chart image / video export fails

- **Video** needs WebCodecs. Use the latest Chrome / Edge, or the desktop app.
- **Chart image**: above the canvas size limit the app lowers density first; if it still doesn't fit, the export fails. Turning off the header band may help.
- If the simulation reports missing assets, go back to Preview and let the assets load once before exporting.

More steps in [Troubleshooting](./troubleshooting.md).

## Can I edit a chart after publishing it?

Not the chart itself, and the post can't be deleted. On the community site only difficulty, level, and tags can change. To change the chart, copy it, edit the copy, and publish that. See the [Bestdori community](./bestdori.md).

## Can I change the shortcuts?

Yes. The **Shortcuts** page binds exactly one key per function, supports rebinding and temporarily disabling, and rejects conflicts. Defaults can be restored per function, per category, or globally.

## Can I change the UI language and text size?

Yes. **Settings › Appearance** offers 简体中文 / English, a 70%–150% UI scale, and three UI font stacks. These affect the editor chrome only, not the chart canvas.

## How do I report a problem?

Open a [GitHub Issue](https://github.com/wuqiongjin/AAO-Editor/issues). Attaching the in-app diagnostic bundle (**Settings › About › Diagnostic bundle**) speeds things up; it contains no credentials. See [Troubleshooting](./troubleshooting.md).
