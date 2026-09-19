# Reused rendering components

All runtime assets are local. No third-party service receives footage.

| Component | Pin and source | License | Use and modifications |
| --- | --- | --- | --- |
| Three.js | npm `three` 0.180.0, tag r180, commit `9e8635e2031c25859dc47ba07e72230dccb2682a`, https://github.com/mrdoob/three.js/tree/r180 | MIT, `node_modules/three/LICENSE` | WebGL renderer, VideoTexture, floating-point textures, LUTCubeLoader. Package code unchanged. Caller normalizes DJI tabs and CRLF, requests FloatType and validates every entry. No automatic sRGB decoding or display transfer chunks. |
| postprocessing LUT3DEffect sampler | v6.38.0, commit `d9b30856f7e28cab5f823229f2a08790d744acfd`, https://github.com/pmndrs/postprocessing/blob/d9b30856f7e28cab5f823229f2a08790d744acfd/src/effects/glsl/lut-3d.frag | zlib, `src/vendor/postprocessing-LICENSE.md` | `src/vendor/tetrahedral.js` extracts the tetrahedral interpolation branch and generalizes sampler/texel-width parameters. Math unchanged. The full postprocessing package is not a runtime dependency. |
| FFmpeg colorbalance | n8.0, commit `140fd653aed8cad774f991ba083e2d01e86420c7`, https://github.com/FFmpeg/FFmpeg/blob/140fd653aed8cad774f991ba083e2d01e86420c7/libavfilter/vf_colorbalance.c | LGPL-2.1-or-later, `src/vendor/FFmpeg-LGPL-2.1.txt` | `src/vendor/colorbalance.js` translates get_component, hfun and preservel into GLSL with shared range settings. Original corresponding source accompanies it. Preserve-lightness clipping behavior retained. The JS module remains editable source in app.asar and the project. |
| Libre Franklin Black | `assets/icon/LibreFranklin-Black.ttf`, https://github.com/googlefonts/Libre-Franklin | SIL Open Font License 1.1, `assets/icon/OFL.txt` | Used only to render the app icon letters in `assets/icon/glyph.html`. Not packaged into app.asar. |
| Installed FFmpeg | `/opt/homebrew/bin/ffmpeg`, 8.1.2 | Build reports and system package licenses govern the external binary | Existing export filter pipeline and exact 16-bit curve tables. Not bundled or modified. |

Native HTMLMediaElement decoding is used for original footage. LosslessCut was an architectural reference for native source playback. No LosslessCut code is copied.

DJI conversion LUTs are not included. They belong to DJI. See `assets/luts/README.md` for where to get them.

Build: `npm ci`, then `npm run package`.
