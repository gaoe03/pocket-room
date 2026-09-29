# Pocket Room

Pocket Room is a Mac app for sorting, color correcting and exporting DJI Osmo Pocket clips. Everything runs on your Mac. It is an early work in progress, version 0.1.

## What it does

- Opens a camera card or any folder of MP4 and MOV files, subfolders included. The first folders become trips, and the folders inside them become chapters.
- Reads the recording profile from each file. Pocket 4P clips carry a color tag, and Pocket 3 clips record the mode in a DJI metadata track.
- Converts D-Log, D-Log2 and D-Log M footage with DJI's LUTs at an adjustable strength. You can then change exposure, brilliance, contrast, highlights, shadows, saturation, warmth and tint.
- Edits one clip or a whole selection at once, with undo. Each clip also has its own trim, volume and mute.
- Plays a graded preview on the GPU with the same color math as the export.
- Exports every selected clip as its own H.264 MP4 at 720p, 1080p or 2160p, with an optional size cap per clip.
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

`POCKET_SOURCE=1 node tests/folders-ui.cjs` and `node tests/audio-ui.cjs` drive the real app. Test runs stay hidden and use temporary data, so they never touch your library.

## Limits

- SDR only. HLG clips appear in the library, but they cannot be graded, played or exported.
- The LUT list covers the Osmo Pocket 3 and Pocket 4P. Log footage from other cameras has no conversion.
- macOS only. The app is not signed or notarized.

Third-party code and licenses are listed in [THIRD-PARTY.md](THIRD-PARTY.md).
