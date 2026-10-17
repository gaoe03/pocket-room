# Pocket Room

Pocket Room is a Mac app for sorting, color correcting and exporting DJI Osmo Pocket clips. Everything runs on your Mac. It is an early work in progress, version 0.4.

## What it does

- Opens a camera card or any folder of MP4 and MOV files, subfolders included. The first folders become trips in the sidebar, and the folders inside them become chapters.
- Has two modes. Grid mode shows large thumbnails for picking, selecting and exporting. Viewer mode shows the graded picture with a filmstrip for grading and watching.
- Reads the recording profile from each file. Pocket 4P clips carry a color tag, and Pocket 3 clips record the mode in a DJI metadata track.
- Converts D-Log, D-Log2 and D-Log M footage with DJI's LUTs at an adjustable strength. You can then change exposure, brilliance, contrast, highlights, shadows, saturation, warmth and tint.
- Edits one clip or a whole selection at once, with undo. Each clip also has its own trim, set with handles on the timeline, and its own volume and mute.
- Plays a graded preview on the GPU with the same color math as the export.
- Sends every selected clip as its own H.264 MP4. Pick Discord, Messages or Full quality to set the size, or set the resolution and a size cap per clip yourself. Send saves the files and opens the Mac share menu for AirDrop, Messages or Mail. You can also drag sent clips out of the grid into Finder or another app.
- Has a streaming mode for screen sharing. It fills the window with the graded picture and plays the current clips in order.

Pocket Room only reads your footage. It never moves, renames or edits the original files. When you move clips between folders in Finder, they keep their edits after a rescan.

## Requirements

- A Mac with Apple silicon
- Node.js and npm, to build the app
- FFmpeg from Homebrew: `brew install ffmpeg`. The app looks in `/opt/homebrew/bin`. Set `POCKET_FFMPEG` and `POCKET_FFPROBE` to use other copies.
- DJI's conversion LUTs, which are not included. See [assets/luts/README.md](assets/luts/README.md).

## Build and run

```
npm ci
npm start
```

`npm run package` builds `dist/Pocket Room-darwin-arm64/Pocket Room.app`. Move it to Applications.

## Tests

`npm test` runs the unit tests. They make their own short clips with FFmpeg.

`POCKET_SOURCE=1 node tests/folders-ui.cjs`, `tests/settings-ui.cjs`, `tests/share-ui.cjs` and `node tests/audio-ui.cjs` drive the real app. Test runs stay hidden and use temporary data, so they never touch your library.

## Limits

- Exports are SDR. HLG clips are converted to normal video when they are exported. While an HLG clip is paused, the viewer shows the exported picture. During playback it shows the clip as macOS draws it, without your color changes.
- The LUT list covers the Osmo Pocket 3 and Pocket 4P. Log footage from other cameras has no conversion.
- macOS only. The app is not signed or notarized.

[DESIGN.md](DESIGN.md) explains the layout and the design rules behind it. Third-party code and licenses are listed in [THIRD-PARTY.md](THIRD-PARTY.md).
