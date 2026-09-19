# DJI LUTs

Pocket Room converts log footage with DJI's own conversion LUTs. They belong to DJI and are not part of this repository. Download them from the DJI download page for your camera, then save them here with these names:

| File | LUT |
| --- | --- |
| `dlog2.cube` | Osmo Pocket 4P, D-Log2 to Rec.709 |
| `dlog2Vivid.cube` | Osmo Pocket 4P, D-Log2 to Rec.709 vivid |
| `dlog.cube` | Osmo Pocket 4P, D-Log to Rec.709 |
| `dlogm.cube` | Osmo Pocket 3, D-Log M to Rec.709 |

`npm run package` copies them into the app. You can also put them in `~/Library/Application Support/Pocket Room/luts/` after installing. A profile without its LUT keeps its color controls turned off.
