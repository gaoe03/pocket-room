# Design

Pocket Room is built for one person coming home with a camera card full of short clips. They want to find the good ones, make them look right, send a few to friends, and sometimes play a trip back on a screen share. Every part of the window exists for one of those jobs, and anything that did not serve one was cut.

## The four jobs

1. **Browse a trip.** A card can hold thousands of clips from several trips. You need to see a whole chapter at once and jump between trips quickly.
2. **Pick and grade.** Most clips are recorded in a flat log profile. You choose the ones worth keeping and correct them, often many at a time.
3. **Send.** Graded clips leave the app as ordinary video files, usually to a friend in a chat.
4. **Watch together.** On a call, the window plays the clips in order, with nothing else on screen.

## Two modes instead of one busy screen

The first version showed the grid, the picture and the controls all at once. Each got a narrow strip, and the picture was the part that lost the most. The redesign splits the window into two modes, the same way Photos and Lightroom do.

- **Grid mode** is for jobs 1 and 3. Large thumbnails fill the window, and the inspector shows where the selected clips are going.
- **Viewer mode** is for jobs 2 and 4. The picture gets the most space in the app, 954 px wide in a normal window, up from 904 px before. A filmstrip under it keeps the browsing order, so you can step through clips while grading.

Double-click a clip or press Return to open it. Press G or V to switch. Both modes render the same clip card, so a checkmark or a favorite looks and behaves the same in the grid and in the filmstrip.

## Where things live

- **Sidebar: where you are.** The library shortcuts (All clips, Favorites, Selected) sit above the folders on the card. Trips open like folders in Finder, and nested chapters indent under their parent. The card name and Rescan sit at the bottom, because the source changes rarely.
- **Grid bar: what you see there.** Search, the Show menu, a filter menu for profile and date, and sort. These only narrow what the sidebar chose, so they sit next to the grid they change.
- **Toolbar: the window.** The view switch, Stream and Settings sit in the title bar next to the window controls, as in other Mac apps. The title names what the browser shows, so the sidebar selection never has to be repeated.
- **Inspector: the change.** A segmented control switches between Color and Send. Grid mode opens it on Send and viewer mode on Color, because those are the jobs each mode is for.
- **Selection bar: the selection.** Select range, Select all and Deselect sit under the clips, in the grid or under the filmstrip, so they are always next to what they act on.

## Rules

| Rule | What it means in practice |
| --- | --- |
| Footage first | The picture and the thumbnails are the only large bright things on screen. The rest of the window is three quiet grays. |
| One job per area | Each area of the window does one thing. Nothing does the job of another area. |
| Built from Mac parts | A sidebar list, segmented controls, popup menus, checkboxes and a toolbar in the title bar. No custom pills, chips or switches. |
| Weight follows use | Each area has at most one filled button. Tools are icons that only show a background on hover. Text labels are for actions you take every session. |
| One color | Everything is gray except the playhead and the streaming progress bar, which use the red from the app icon. The color always means "where you are in time". |
| One scale | Text is 13 px, and small labels are 11 px. Spacing moves in 4 and 8 px steps. Controls have 4 px corners and thumbnails 5 px. Only play buttons, slider knobs and the selection check are round. Numbers use even-width digits, so timecodes do not jitter. |

## Details that follow from the rules

- **Each folder remembers your place.** Going back to a trip or chapter returns to the clip you were on and the scroll position you left, also after a relaunch. Browsing a trip means jumping between chapters, and starting each chapter from the top again made that tiring.
- **Thumbnails show the grade.** A card's picture is made with the clip's own look, exposure, color and trim, so the grid shows what will be sent. Only the cards on screen are redrawn after an edit, and a clip with no color change keeps its existing thumbnail.
- **Cards show what tells clips apart.** A card is the thumbnail, the clip number and the length. The camera name and the detected profile used to sit on every card, and neither helps you choose a clip. A small tag appears only when a profile needs attention: HLG, unknown, or set by hand.
- **Profiles come from the file.** The camera writes its color mode into the file, and Pocket Room reads it. You never have to guess from how the picture looks, and a hint only speaks up when you have overridden the file. A hand-set profile that matches the file gets no comment either.
- **Right-click a card for its actions.** A native Mac menu gathers what otherwise lives in several places: open, favorite, select, copy and paste the grade, and show the original or its export in Finder. The clip becomes the current clip first, as Finder highlights what you click, so every action acts on what the inspector shows.
- **Trimming happens on the timeline.** Two wide buttons became handles you drag, with I and O as shortcuts. The playhead follows the handle, so you see the frame you are cutting on.
- **Color starts with a look you can see.** The top of the Color inspector is a row of small pictures of the current frame: Flat, the recording as it is, and Natural and Vivid, DJI's own conversions. You choose by looking, not by reading. The chosen tile wears the same white outline as the current clip. Normal footage has nothing to convert, so the row does not appear.
- **Three sliders, then More.** Exposure, Saturation and Warmth sit under the looks, because those are the changes a quick edit needs. The real library backs this up: of 324 edited clips, 52 changed exposure and 32 saturation, while brilliance, contrast, highlights, shadows and tint were each used on 13 clips or fewer. The profile picker sits above the looks, so a wrong detection is one click to fix. The other sliders, the look strength and sound wait under a closed More, which remembers whether you opened it.
- **HLG clips become normal video.** The camera records HLG for HDR screens, and friends watch on phones and Discord, so Pocket Room converts it when you send. A paused HLG clip shows the converted picture, made by the same code as the export. There is no Look row for HLG, because the unconverted picture is never what you want to send.
- **Exposure is in stops.** Plus one doubles the light, like a camera. Bright parts fade into white instead of cutting off flat, so a brighter clip keeps its sky and lamps. Clips edited before 0.4 keep their look, because their old values are converted to the new scale on first open.
- **Sliders fill from zero.** Two-sided controls like Warmth fill outward from the middle, so you can tell at a glance which way a clip was pushed.
- **Hints appear only when they add something.** The inspector says "This clip" or "3 selected clips" in one line. The longer explanation shows only while several clips change at once.
- **Send starts with where the clips are going.** Discord, Messages or Full quality sets the size, so nobody has to know what a bitrate is. Discord raised its free upload limit to 20 MB in August 2026, according to news reports, and the real library had its exports capped at 15 MB by hand before this existed. The resolution, quality, size limit, saved presets and folder are still there, under a closed More.
- **One button sends.** "Send 3 clips" saves each clip whose export is missing or out of date, then opens the Mac share menu with all of them. Clips already sent with these settings skip straight to the menu. Closing the menu still leaves the files in the export folder, and Show in Finder opens it. If you are in another app when the export ends, the notification says so and the menu waits for you.
- **A long export can run in the background.** Its progress shows on the Dock icon, and if you are in another app when it ends, a notification says how many clips were exported. A cancelled export stays quiet.
- **Drag a card to take its export.** A card whose export matches its current grade can be dragged into Finder, Messages or an editor, and a selected card carries every selected export. Only exports leave this way. The camera originals are never dragged, so a drop can never move them off the card.
- **Settings apply on Save.** Changes wait for Save, Cancel or Esc discards them, and Restore defaults fills in the defaults without saving them.
- **Zoom means thumbnails.** Cmd+Plus and Cmd+Minus size the grid's thumbnails, as in Photos, instead of scaling the whole window like a web page. The size is saved with the view.
- **The picture wins in small windows.** Below 1180 px the sidebar folds away before the picture shrinks. Once you show or hide it yourself, your choice sticks.
- **Streaming hides the app.** Streaming mode shows only the graded picture. Its controls appear while the mouse moves and fade after 2.5 seconds, along with the cursor.
- **First launch shows only the way in.** Until a card or folder is open, the window shows a single message and a Connect camera button instead of empty panels.

## What was cut

- **The filter stack.** Trips used to appear as a dropdown, a row of chapter pills, two toggle buttons, two more dropdowns and a sort menu. The sidebar tree and the grid bar replace all of it.
- **Repeated facts.** The profile used to show in four places at once. It now shows in the inspector, plus a tag on the card when it needs attention.
- **Editing folder trips in the app.** When the card is organized in folders, trips and chapters follow those folders. You change them in Finder, so there is one source of truth. Folders without subfolders still get simple trip labels.
- **Borders on everything.** Buttons, fields, chips and panels each had a bordered, rounded box, so every control carried the same weight. Surfaces are now separated by thin lines, and controls show a background only when they need to look pressable.

## Keyboard

| Key | Action |
| --- | --- |
| G, V | Grid mode, viewer mode |
| Return | Open the selected clip in the viewer |
| Space | Play or pause. In the grid it opens the clip in the viewer first. |
| Left, Right | Previous or next clip |
| Up, Down | The clip above or below, in the grid |
| Comma, Period | Step one frame back or forward. Steps can leave the trimmed range, so a new trim point can land outside it. |
| I, O | Set the trim start or end at the playhead |
| B (hold) | Show the original, before grading |
| F | Favorite |
| L | Turn D-Log2's vivid conversion on or off for the current clip. Works while streaming, so both looks can be compared on a call. |
| X | Select or deselect the current clip |
| Cmd+1, Cmd+2 | Grid, viewer |
| Cmd+Option+S | Show or hide the sidebar |
| Cmd+Plus, Cmd+Minus, Cmd+0 | Larger, smaller or default thumbnails in the grid. A trackpad pinch does the same. |
| Shift+Cmd+F | Streaming mode |
| Cmd+, | Settings |
