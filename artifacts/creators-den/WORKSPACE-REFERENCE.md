# Creator Den — Reference-App Workspace & Tool Catalogue

**Purpose:** Enrich each Creator Den role workspace ("leg") with the actual direct-manipulation tools, panels, and HCI patterns used in the premium reference apps, so the in-browser studio feels and behaves like the industry tools the roles borrow from.

**Reference apps per role**

| Creator Den leg (route) | Role | Reference app |
|---|---|---|
| 01 · Selects (`/selects`) | Story Architect | **Avid Media Composer** |
| 02 · Cut (`/cut`) | Visual Editor | **Adobe Premiere Pro** |
| 03 · Sound (`/sound`) | Sound Designer | **Avid Pro Tools** |
| 04 · Finish (`/finish`) | Motion & Color | **Adobe After Effects** (motion) + **DaVinci Resolve** (color) |

> Note: the four relay workspaces cover five reference apps today because the Finish leg currently merges motion (After Effects) and color (DaVinci Resolve). Keep both tool inventories in mind when designing the Finish leg; if the app is ever split into five legs, the mapping below still applies one-to-one.

Sources: Adobe After Effects / Premiere Pro user guides (helpx.adobe.com, archived), Avid Media Composer Editing Guide chapter index + What's New notes (resources.avid.com), Avid Pro Tools User Guide (avid.com/pro-tools/user-guide), Blackmagic Design product pages for DaVinci Resolve (blackmagicdesign.com/products/davinciresolve), Wikipedia (Media Composer, Pro Tools, DaVinci Resolve, Blackmagic Fusion, Adobe Premiere).

---

## 0. Shared HCI vocabulary across all five apps

These interaction patterns recur in every reference app and are the "feel" the Creator Den should reproduce per workspace:

1. **Panels dockable / floatable into a workspace** — every app is a set of panels (monitors, timeline, bins/effect lists, inspectors) that the user arranges per task. (Premiere: 15 default workspaces; AE: workspace bar; MC: toolsets; Resolve: pages; PT: Edit vs Mix windows.)
2. **Direct manipulation on the canvas/timeline** — drag to position, pull handle edges to trim, drag in/ruler to scrub, direct drag on wheels/curves to adjust values.
3. **Source ↔ program (record) dual-monitor discipline** — a "source" viewer shows raw footage/clips; a "program/record" viewer shows the timeline result (MC Source/Record, Premiere Source/Program, PT Edit+Mix, Resolve dual viewer).
4. **Timeline with per-clip/keyframe selection** — selecting a block reveals an inspector/effect controls where its parameters live and can be keyframed over time.
5. **Scrubber/playhead is the shared reference** — every panel (waveforms, scopes, transcripts, thumbnails) follows the playhead; clicking almost anywhere seeks it.
6. **Non-destructive work + versioned history** — edits never destroy media; a history/snapshots panel allows undo to any past state.
7. **Tool-specific cursors & keyboard shortcuts** — a selection tool is the default "safe" state; specialized tools (razor, trim, pen, hand, zoom) swap the cursor.
8. **In-place values & readouts** — timecode, duration, offset, meters always visible in mono/readout form so the UI is trustable for precision work.
9. **AI/assistive features are advisory and non-destructive** — auto-balance, auto-color, speech-to-text, smart trims suggest; the human applies.

---

## 1. Story Architect → Avid Media Composer (`/selects`)

### 1.1 What lives on the Media Composer workspace

**Task-oriented toolsets (workspaces):** Edit, Color, Effects, Audio — switching toolsets rearranges the same windows to surface the relevant tools. (Avid marketing + Editing Guide ch. 4 "Windows and Panels in the User Interface", ch. 5 "Using Tools".)

**Core windows:**
- **Project window** — the bin browser; holds clips, sequences, titles; organizes footage in **bins** (folder-like containers with text/frame views and sortable metadata columns).
- **Bin container** — dockable container hosting multiple bins as tabs/frames (2019+ paneled UI)
- **Source/Record (Composer) window** — the dual-monitor heart: **Source monitor** (open a raw clip, mark in/out, view it) and **Record monitor** (the timeline result, i.e., your sequence). Timecode + transport controls beneath.
- **Timeline window** — tracks (video V1..Vn, audio A1..A2…), clips as blocks, **Smart Tools** (drag-and-drop style segment editing directly on the timeline), track selectors, rulers, markers, segment mode, trim handles.
- **Command Palette** — searchable palette of every command/button; drag any command onto a toolbar, timeline button area, or the keyboard. ("There is a command palette for every button in the program.")

**Tool families the Story Architect uses daily:**
- **Marking & logging** — mark in/out (I/O), add markers, subclips from source, Add Edit (split a clip), "Filler"/transitions, Locators window for cued notes (MC's locator markers list); logging from capture (ch. 6).
- **Selects & subclip editing** — drag clips from bin to source monitor, refine in/out, then edit into the timeline via the classic **three-point editing** (mark source in/out + record mark, then splice/overwrite ✓). Synchronize marked footage into a fresh sequence (stringout).
- **Timeline segment tools (Smart Tools)** — yellow/red Smart Tool combo: trim (red), segment move (yellow), segment overwrite (also yellow) — dragging directly on blocks.
- **Trim mode / trim tools** — dedicated trim mode with dual-roller, ripple, and overwrite trims (`Trim` tab in toolsets); fine frame nudging.
- **Effects (segment-based)** — apply segment/transition effects, open **Effect Editor** (parameter controls for the selected effect), keyframe graph editing in the timeline, **effect mode** toggle.
- **Color Correction toolset** — Color Correction tool with **primary/secondary color wheels**, HSL qualification, scopes (waveform/vectorscope/histogram), the classic **"Correct" monitor layout** (source left, corrected right, plus scopes). "Natural Match" auto-balance.
- **Audio mixer toolset** — real-time track-based Audio Mixer with faders, pan, mute/solo, automation modes and ganged groups (up to ten).
- **ScriptSync AI / PhraseFind AI** — transcript/script-based editing: click a word in the script/transcript and jump to the footage where it is spoken ("Script-Based Editing"). PhraseFind indexes dialogs for text search of spoken words.
- **Multicam editing** — group cameras into a multicam bin, view all angles in the Source monitor, cut live to the Record monitor.
- **Media management** — bins with metadata columns, smart user sort, "Select Media Offline" awareness, consolidating/transcoding, relink.

**Direct-manipulation verbs central to MC:**
- Drag clip from bin → source monitor; mark in/out; drag into Record monitor area to splice/overwrite.
- On timeline: drag segment to move, drag segment edge to trim, drag up/down between segments to re-order (segment move).
- In Effect Editor: drag parameter values; draw keyframe curves on the timeline.
- On color wheels: drag inside a wheel to shift color balance; drag the slider below to raise/lower that tonal range.

### 1.2 What the Creator Den `/selects` already has

| Ref-app tool | Current leg equivalent |
|---|---|
| Source/Record monitors | Single **Proxy player** (source footage) — no Record monitor for the selects timeline yet |
| Transcript/script-based editing (ScriptSync/PhraseFind) | **TranscriptPanel** — searchable transcript, click to seek, "mark select" / "comment" per line; AI "Suggest selects from transcript" |
| Bins / project window | The board (**vault**) holds assets; selects built on a timeline rail |
| Timeline with Smart Tools | **Selects** Timeline: drag to move, pull edges to trim, ruler scrub, active-block highlight; **Scene blocks** rail (Hook→Setup→Core→Payoff→CTA) |
| Mark in/out + three-point edit | Partial — selects are added from transcript lines or AI ranges; no source-monitor in/out three-point workflow |
| Effect Editor | Not present |
| Color Correction toolset / scopes | Not present (color is the Finish leg's job) |
| Audio Mixer toolset | Not present (Sound leg's job) |
| Command palette | Not present (actions are explicit buttons) |
| Version history | **HistoryPanel** — Git-style snapshots, restore to any version, submit for review |
| Timecode notes | **CommentsPanel** — pin notes at timecode, resolve/reopen |
| AI advisory | **RoleOracle** + quick actions (suggest selects, place 5-beat spine) with Apply buttons |

### 1.3 Gap list — worth adding to `/selects`

1. **Source/Record split with three-point marking** — a Source monitor (per asset) where you mark in/out and press *Splice / Overwrite* into the selects rail at the playhead; this is Avid's signature HCI and the biggest missing interaction.
2. **Locators/markers rail + cue list panel** — MC's Locators window: a scrollable list of markers that jumps the playhead when clicked (the transcript already approximates this; add a dedicated markers list on the timeline).
3. **Command Palette** — a searchable "insert any action" overlay (⌘K-style) that maps to the existing buttons.
4. **Per-segment Effect Editor** — select a scene block and open a parameter panel (e.g., edit its label/type, place a marker note) instead of only drag/trim.
5. **Multicam-style angle grid** — a "compare takes" strip showing several RAW_VIDEO assets as thumbnails to click-seek, echoing MC's multicam source view.
6. **ScriptSync style click-to-play transcript highlight** — make the active transcript line highlight live as playback progresses (currently click-to-seek only).

---

## 2. Visual Editor → Adobe Premiere Pro (`/cut`)

### 2.1 What lives on the Premiere Pro workspace

**Workspaces (15 default):** Essentials, Starter, Vertical, Learning, Assembly (large Project panel, hover scrub, mark in/out, rough cuts), Captions and Graphics, Text-Based Editing, Review (Frame.io), Production (team), color/audio/graphics task workspaces — plus custom, dockable panels. (Adobe helpx Workspaces page.)

**Core panels:**
- **Project panel** — asset/bin browser with hover scrub, metadata columns, search, bins.
- **Source Monitor & Program Monitor** — the dual-viewer (clip in/out vs sequence result); Reference Monitor for scopes/color views; "Maximize Video Output" button.
- **Timeline panel** — multi-track sequence (video + audio tracks), clips as blocks, playhead, source patching & track targeting, markers, per-clip keyframes (v-shaped connectors), Trim mode.
- **Tools panel / Toolbox** — **Selection, Track Select/Multi-track (A), Ripple Edit (B), Rolling Edit (N), Rate Stretch (X), Razor (C), Slip (S), Slide (Y), Pen (P), Hand (H), Zoom (Z)** — each tool changes the cursor and semantics (from Adobe helpx "Working with Panels").
- **Effect Controls panel** — inspector for the selected clip: Motion (position/scale/rotation/anchor), Opacity, transforms + every applied effect's parameters, with keyframe diamonds on a mini timeline.
- **Effects panel + FX badges** — searchable library of video/audio effects & transitions; applied effects show as "FX" badges on clips; Effect presets.
- **Lumetri Color panel** — color wheels, sliders (temperature, tint, exposure, contrast, highlights/shadows, whites/blacks), curves (RGB + Hue Saturation Curves), HSL Secondary qualifier, vignette, looks & LUTs; **Lumetri Scopes** panel.
- **Essential Sound panel** — category tagging (Dialogue/Music/SFX/Ambience), repair (reduce noise/reverb/hum, de-ess), EQ, dynamics, loudness, ducking (auto-duck music under dialogue with keyframes), Remix.
- **Audio Track Mixer / Audio Clip Mixer** — channel-strip console: inserts, sends, pan, fader, meters, automation; also "Essential Sound" panel repair.
- **Text-Based Editing** — automatic transcription; select/cut/trim/delete directly from the transcript text ("select, cut, and trim directly from transcript", Premiere Pro 2024).
- **Essential Graphics / Properties panel** — title, shapes, captions, Motion Graphics templates (MOGRTs), text styles, align/distribute, responsive design.
- **Other useful panels** — Media Browser, Libraries, History (undo states), Info/Options panels, Metadata editor, Captions (speech-to-text, styles), Markers, Scene Edit Detection, Warp Stabilizer (stabilize footage), Auto Reframe (AI reframe for social), Merge Clips (sync audio/video by waveform).

**Tools & interactions signature to Premiere:**
- **Trim mode** — dedicated trim monitors for precise rolling/ripple/rate-stretch trims on frame boundaries (J/L cuts).
- **Razor** — cut clips at the playhead (C), split-fast workflow; **Slip/Slide** — keep duration, shift in/out or swap neighborhood.
- **Track select** — select the clip and everything to its right; **source patching** maps which source tracks land on which timeline tracks.
- **Pen tool on timeline** — set/drag keyframes on effect connector lines (the classic "keyframe rubber band").
- **Effects as non-destructive stack** — apply multiple effects, reorder, toggle visibility with the FX badge, copy/paste across clips.
- **Text-based editing** — treat transcript like an editable document to rebuild the sequence.
- **Multi-camera** — group clips, and cut angles live in the Program Monitor.
- **Proxy workflow & Media Encoder** — proxy toggle for performance; queue exports to Adobe Media Encoder.

### 2.2 What the Creator Den `/cut` already has

| Ref-app tool | Current leg equivalent |
|---|---|
| Source/Program monitors | **Proxy player** (single) with beat markers |
| Timeline + clips | **Main track** Timeline (drag/trim/scrub, sync offsets shown) |
| Overlay / b-roll layers (V2-style) | **Overlay layer** rail with draggable b-roll bin chips + drop at position |
| Multi-cam sync | **Multi-cam sync** panel (waveform align, offset readout, method) |
| Toolbox | Not present — single implicit selection+trim interaction |
| Effect Controls | Not present — per-clip camera reassign + remove only |
| Trim mode / J-L cuts / slip-slide | Not present |
| Razor cut at playhead | Not present (no split action) |
| Text-based editing | The selects leg has transcript editing; cut leg only shows beat chips |
| Marker/beat rail from selects | **Beat markers** chips (click to seek) |
| Version history | **HistoryPanel** + Render preview + submit |
| AI advisory | RoleOracle quick actions (review cut, suggest trims, apply) |

### 2.3 Gap list — worth adding to `/cut`

1. **Toolbox** — a real tool strip (Selection / Ripple / Rolling / Razor / Slip / Slide / Hand / Zoom) that changes cursor and semantics on the main-track Timeline; the shared `Timeline` component is already tool-ready (drag=move, edge=trim).
2. **Razor ("split clip")** — split the clip under the playhead into two clips at that exact timecode.
3. **Slip & Slide** tempo tools — slip (shift only in/out within the same duration) and slide (move clip while neighbors trim) on the main track.
4. **Effect Controls-style inspector** — click a clip → panel with its Motion (position/scale on a mini frame), Opacity, and a keyframe button; even a simple per-clip "notes + scale + rotate" readout would mirror Premiere's Effect Controls.
5. **Ripple/roll trim mode** — clicking an edit point opens a dual "before/after" trim view (or at least ripple buttons: "close gap" after a delete — Ripple Delete).
6. **Essential Sound-style audio strip** — quick per-clip "reduce noise / duck under music" apply directly in the cut (feed-forward to the Sound leg).
7. **Markers layer on the timeline** — dedicated marker pins rail with a list panel (Premiere's marker panel), so beats/comments show on the cut timeline itself, not only as chips.

---

## 3. Sound Designer → Avid Pro Tools (`/sound`)

### 3.1 What lives on the Pro Tools workspace

Two primary task windows (**Edit window** = structure/arrangement; **Mix window** = virtual console); plus **Transport**, **Session Setup**, and windows for editing/automation/MIDI.

**Edit window** (Avid Pro Tools User Guide, "Edit Window in Pro Tools"):
- **Tracks** — horizontal rows per instrument/source; **Track controls** on the left: Record Enable, Input Monitoring (I), Solo/Mute (S/M), Track View Selector (waveform vs volume vs automation display).
- **Clips** — containers for recorded/imported Audio & MIDI arranged along the timeline.
- **Inserts & I/O** — can display key Mix-window elements inline (option to show them in the Edit window).
- **Rulers** — Bars|Beats, Timecode, Tempo, Markers rulers at top for navigation/sync.
- **Edit Tools** — **Trim, Selector, Grabber, Zoomer, Pencil, Smart Tool** (Smart Tool = contextual trim/grab/scrubfly when near boundaries).
- **Edit Modes** — Shuffle, Slip, Spot, Grid (determine how clips move/place/trim/snap).
- **Clip (Region) list** — the bin of clips available to the session (per audio file, with info).
- **Playlists** — alternate takes/comping takes of the same track (loop recording + comping workflow).

**Edit/audio-processing tools (from the Pro Tools User Guide "Editing" section):**
- Smart Tool, Edit Modes, Zoom; **Cutting/trimming clips**; **Fades & crossfades**; **Reversing clips**; **Nudging** clips by frame/sample; **Clip Gain** (per-clip volume trim); **Consolidating** clips; **Pitch Correction**; **Muting clips**; **Clip Effects**; **AudioSuite** (offline processing); **MIDI to Audio / Audio to MIDI**; **Beat Detective** (quantize/align beats); **Elastic Audio** (time/pitch warping flexible audio); **Tempo extraction**; **Pitch Shift and Transpose**; **Strip Silence** (auto-cut silence between transients); **Time Stretching**; **Track Freeze**.
- **Clip Gain line, hidden fades, crossfade editor, scrub tool, hit/quantize, tab-to-transient** (tab key jumps between transients for fast editing).

**Mix window** (Avid Pro Tools User Guide, "Mix Window in Pro Tools"):
- **Channel strips** — each track as a vertical strip with **Inserts** (plugin slots: EQ, compression, reverb), **Sends** (route to reverb/delay/headphone mixes), **I/O section** (input/output assignment), **Pan control**, **Fader & Meter**, **Automation Mode** (write/read automation over time), **Solo Safe**.
- **Busses, Aux tracks, Master fader; Sidechaining**; **Automation** (volume/pan/plugin parameter automation lanes); **Adding plug-ins**; **Bouncing** (stems, full mix, individual tracks).

**Recording (Session Setup section):** Assigning input/output, Record Enable, basic/countoff/loop recording modes, click track/metronome, BPM/tempo, time signature, importing audio/video, color coding, markers, transport controls.

### 3.2 What the Creator Den `/sound` already has

| Ref-app tool | Current leg equivalent |
|---|---|
| Edit window (tracks, clips, rulers) | **The mix — waveform scrub** strip + **Music & score** + **Pickup VO pins** timelines (drag/trim/scrub) |
| Monitor / source listening | **Monitor** panel — audio proxy player synced to playhead |
| Audio passes (noise reduction, EQ, ducking, leveling) | **Audio passes** panel — queue background worker passes (NOISE_REDUCTION, EQ, DUCKING, LEVELING), applied-state badges |
| Pickup VO re-recording | **Pickup voiceover** — browser mic → upload as VO_PICKUP, pinned at timecode |
| Music scoring with ducking | **Add music** — pick asset, place track, **duck under speech** toggle per track |
| Mix window (faders) | Partial — no fader console; track rows show in/out ranges only |
| Automation lanes | Not present |
| Fades/crossfades | Not present |
| Strip silence / transient tools | Not present |
| Elastic Audio / pitch / time stretch | Not present |
| Meters (visual signal level) | Not present |
| Playlists/takes comping | Not present (pickups are separate pins) |
| Version history + submit | **HistoryPanel** + save mix |
| AI advisory | RoleOracle (review mix, suggest music placement → auto-places ranges) |

### 3.3 Gap list — worth adding to `/sound`

1. **Channel-strip Mix window** — a vertical mixer (even 4–8 strips: Dialogue, Music, SFX, Pickups, Master) with fader, pan, mute/solo, and a level meter readout; interacting mirrors Pro Tools' Mix window.
2. **Automation lanes** — per-track volume/duck automation readout on the timelines (the music tracks already carry `duckUnderSpeech`; visualize it as a lane).
3. **Fades & crossfades on clips** — a small "apply 0.5s fade in/out" per clip + a crossfade at edit points.
4. **Strip-silence style auto-gap** — "trim silence" action over a pickup/music track so noise between phrases drops out (worker/AI pass).
5. **Per-clip gain (Clip Gain line)** — drag a horizontal gain line on a pickup/music block, with a dB readout.
6. **Elastic-style time/pitch stagger** — "nudge clip +150ms" (fine time) and "pitch correction" pass button (reuse oracle/AI pass infra).
7. **Transport + rulers** — a small transport bar (play/stop/record/scrub + ruler showing Bars|Timecode/Markers) shared with the other legs.
8. **Level meters during playback** — visual meter bars on the Monitor player so the designer sees signal level (mirrors PT meters).

---

## 4. Motion Editor → Adobe After Effects (part of `/finish`)

### 4.1 What lives on the After Effects workspace

From Adobe helpx "Workspaces, panels, and viewers" + "General user interface items":

**Panels:** Project panel (asset list w/ search & columns), **Composition panel** (the canvas viewer), **Timeline panel** (layers + property keyframes + graph editor), **Layer / Footage panels**, **Flowchart** (node-like comp structure), **Effect Controls** (parameters of selected effects), **Effects & Presets** (searchable effect/animation-preset library), **Character & Paragraph** panels, **Paint & Brushes** panels, **Tracker** panel, **Preview** panel (RAM preview + audio), **Audio** panel (audio meters), **Info** panel, **Align** panel, **Smoother/Wiggler** (keyframe helpers), **Content-Aware Fill** panel, **Properties** panel, **Learn** panel, **Render Queue** and **Composition Profiler**, Creative Cloud Libraries.

**Viewers:** Composition, Layer, Footage, Flowchart, and Effect Controls panels are all viewers; viewers lock to keep a fixed comp visible (ETLAT workflow).

**Tools (Tools panel):** **Selection (V), Hand (H), Zoom (Z), Rotation (W), Pan Behind (Y), Anchor Point (Y-adjacent), Shape tools (Q — rectangle/rounded/ellipse/polygon/star), Pen tool (G — bezier paths), Type tool (Cmd+T / horizontal+vertical), Brush (Cmd+B), Clone Stamp (Cmd+B), Eraser (Cmd+B), Puppet tools (Pin/Starch/Overlap), Roto Brush & Refine Edge (Alt+W), Unified/Orbit camera (C)** — from AE shortcut maps & helpx tool docs.

**Motion-graphics machinery (the toolset the Motion Editor lives in):**
- **Layers & property keyframes** — every layer has transform (position/scale/rotation/opacity/anchor) animatable with keyframes; **Graph Editor** (value + speed) for organic motion.
- **Shape layers & vector paths** — draw shapes, add stroke/fill/gradient, path operations (offset paths, merge, trim paths), animate.
- **Text animation** — character/paragraph formatting + text animators (position, opacity, blur per-character).
- **Masks & rotoscoping** — bezier masks, feather, mask tracking, **Roto Brush**, Refine Matte.
- **Effects palette (roughly 270)** — categorized: Blur & Sharpen, Stylize, Distort, Perspective, Generate, Simulation, Time, Transition, Keying, Matte, Noise & Grain, 3D Channel, Utility, Color Correction; **animation presets** for one-click motion.
- **Tracking & stabilization** — point tracker, **motion tracking/stabilizing**, **Face Tracking**, **Mask Tracking**, **Camera tracking** (3D), warp stabilization.
- **Keying & compositing** — Keylight etc., track mattes, traveling mattes, blend modes, precompose/nesting, alpha channels.
- **3D layers, cameras, lights, advanced 3D renderer / C4D renderer**; **expressions** (JavaScript) for procedural animation; **data-driven animation**; **time remapping / time-stretch**; **content-aware fill** (object removal); **motion graphics templates (MOGRT)** reusable export for Premiere.
- **Previewing** — RAM preview (space/numpad 0), audio preview, scrub, snapshots/A/B compare, Mercury Transmit video-out.

**Direct-manipulation verbs:**
- Draw on the Composition canvas (shapes, masks, pens) and drag to position layers live.
- Drag keyframes on the timeline; drag graph-editor curves to shape motion.
- Roto/brush paint directly over the footage in the Layer panel.
- Track: place a track point on the layer and press "Analyze" — motion follows.
- Drag handles to resize/rotate; the Pan Behind tool moves the anchor point.

### 4.2 What the Creator Den `/finish` currently has (motion slice)

| Ref-app tool | Current leg equivalent |
|---|---|
| Composition canvas with overlays | **Lower-thirds canvas board** — drag cards to position (%), resize by corner handle, click to scrub to their time |
| Text/styled captions | **Captions panel** — burn-in toggle + style chips (BOTTOM_CENTER/SPLIT/MINIMAL); captions derived from Leg 1 transcript |
| Keyframes / animation | Not present (cards are static positions; no time animation) |
| Shape tools / masks / rotoscoping | Not present |
| Effects palette | Not present (grade LUT presets only) |
| Tracking & stabilization | Not present (cut leg has multi-cam sync only) |
| Motion graphs/templates | Not present |
| Thumbnail/export | **Multi-format export** panel + thumbnail frame scrub + queue exports; **Grade clips** rail |

### 4.3 Gap list — worth adding for the motion slice of `/finish`

1. **Per-card keyframe animation** — animate a lower-third's position/opacity over `[startMs, endMs]` (e.g., slide-in between start and end) with a simple keyframe readout; mirrors AE's transform animation.
2. **Opacity/scale properties per overlay card** — AE-style transform properties (x, y, scale, opacity, rotation) on each canvas item, editable in a **Properties/Effect Controls-style inspector**.
3. **Simple shape/mask drawing on the canvas** — a Pen/Shape tool that draws a rectangle/ellipse overlay (with fill opacity + border) that can also be animated.
4. **Morph-cut style transition presets** — one-click entry/exit animations (fade, slide, scale) applied to any lower-third.
5. **Preview split/wipe compare** — AE snapshot-style "before/after" of the grade on the same frame (wipe divider on the player).
6. **Content-aware fill / object removal** — AI-assisted pass (role oracle) that suggests an overlay/badge placement instead of full object removal.

---

## 5. Color Editor → DaVinci Resolve (part of `/finish`)

### 5.1 What lives on the DaVinci Resolve workspace

**The "pages" concept** — one app, task-specific workspaces, switched with one click: **Media, Photo, Cut, Edit, Fusion, Color, Fairlight, Deliver**. The **Color page** is the grading workspace; **Fusion** is the motion/VFX page (after-effects-class node compositor); **Fairlight** is the audio page (Pro Tools-class mixer).

**Color page layout (documented by Blackmagic):**
- **Viewer (large, top-center)** — the graded image; toolbar: eyedropper/qualifier sampler, magic-wand "key" view, color match, auto-balance, wipe/split-screen compare modes, stereoscopic controls, Lightbox toggle.
- **Node editor (top-right)** — "the building blocks of color correction": a flow chart where the image enters left, passes through corrector/effect nodes, exits right. Node types: **serial (corrector), parallel, layer mixer, key mixers**; drag output→input to connect; **shared nodes** reused across clips; right-click "add node".
- **Palettes (bottom-left)**:
  - **Primaries → Color Wheels** — lift/shadows, gamma/midtones, gain/highlights wheels (drag inside = color balance; slider below = level), plus **Offset** wheel (whole image).
  - **Primary Bars** — alternative fine control per RGB/luma channel.
  - **Primary adjustment controls** — contrast, saturation, hue, temperature, tint, midtone detail, color boost (vibrance), shadow/highlight adjustments.
  - **Log wheels** — tighter tonal ranges for film-style grading.
  - **HDR wheels** (Studio) — zone-based exposure/color for HDR; **Color Warper** — hue-vs-hue grid to drag colors to new hues/sats.
  - **Curves** — custom RGB/luma curves w/ live histogram; + Hue vs Hue, Hue vs Sat, Hue vs Lum, Lum vs Sat, Sat vs Sat curves.
  - **Qualifier** (secondary color) — pick a hue/sat/luma range with the eyedropper; refine selection; then grade the selected region.
  - **Power Windows** — geometric shapes (circle, rectangle, polygon, curve, gradient) drawn on the image; drag/resize/rotate/soften on-screen; grade inside or outside, then **Tracker** automatically animates the window to follow the object (pan/tilt/zoom/rotation/perspective analysis) — or **Magic Mask / IntelliTrack AI** (Studio).
  - **Tracker palette** — playhead + analyze controls for windows; also used to attach FX to objects and for stabilization.
  - **Blur / Key / Sizing / Stereoscopic 3D palettes** — blur, view keys, resizing (reframing), stereo tools.
  - **Motion effects palette** — temporal + spatial **noise reduction**, motion effects, speed warp (Studio).
  - **RAW palette** — native RAW develop controls (white balance, exposure, gamma, highlight recovery) processed before the node chain.
- **Scopes (bottom-right)** — five objective meters: **Parade** (RGB/YRGB/YCrCb channels), **Waveform Monitor** (luma/chroma), **Vectorscope** (hue/sat graph — skin-tone line), **Histogram** (tonal distribution), **CIE Chromaticity** (gamut bounds). 
- **Gallery & Lightbox (top-left)** — save/still grades into albums ("stills"), copy grades across clips/reels, **Shot Match / auto balance**, grouped clips (grade pre-clip/post-clip groups), Lightbox shows the whole timeline as graded thumbnails to spot mismatches, wipe/split-screen comparisons.
- **Resolve FX library** — 100+ GPU effects (blur, light effects, lens flare, stylize, image restoration/Revival, beauty/face retouch, object removal, patch replacer, RGB mixer, HDR tools) draggable onto nodes; OpenFX 3rd-party support.

**Other pages relevant to the collaboration:** Fusion page (nodes for VFX/motion graphics: 2D/3D workspace, camera/planar tracking, rotoscoping, keying, particles, titles, deep compositing) and Fairlight page (2000-track mixer, ADR/Foley, Fairlight FX + AI (voice isolation, music remix), ambisonics, elastic wave retiming) — useful because Finish receives sound-locked, picture-locked material and adds graphics + master.

### 5.2 What the Creator Den `/finish` currently has (color slice)

| Ref-app tool | Current leg equivalent |
|---|---|
| Per-clip grades (node-like) | **Per-clip grade nodes** — each clip has LUT preset + exposure + warmth sliders (a mini node), applied live via CSS filter on the proxy |
| Primary wheels | Partial — exposure + warmth ranges only; no lift/gamma/gain or offset |
| Curves / qualifier / power windows | Not present |
| Scopes | Not present (no waveform/vectorscope/parade readouts) |
| Node editor flow | **Grade clips** rail — each clip is a block on the timeline; no visual node graph |
| Match shots (shot match/auto balance) | Not present |
| Gallery/stills/lightbox | Not present |
| Resolve FX / noise reduction | Not present (LUT presets only) |
| Compare/wipe | Not present |
| Deliver page (formats, queue, upload) | **Multi-format export** (16:9/9:16/1:1), thumbnail extraction, queue jobs with status — closest to the Deliver page already |

### 5.3 Gap list — worth adding for the color slice of `/finish`

1. **Color wheels (lift/gamma/gain + offset)** — replace/augment the single exposure+warmth sliders with a DaVinci-style three-wheel interaction: drag inside a wheel for color balance, slider below for level. This is *the* signature Resolve HCI and is very buildable in-browser (canvas or SVG wheel → CSS filter already wired).
2. **Curves editor** — a tiny RGB+luma curve canvas (drag points, histogram behind) to sculpt contrast/tint per clip; cheapest high-impact addition.
3. **Scopes readout** — a mini waveform/vectorscope drawn from the proxy frame (canvas-based) next to the graded preview; even a histogram would transmit "objective control" instantly.
4. **Shot match / auto-balance** — "Match to previous clip" button (copy grade parameters with one click) and an auto-balance action that nudges exposure/warmth toward neutral; echoes Resolve's shot match & auto color.
5. **Power-window-esque masks** — a second canvas layer where a drawn circle/rectangle applies a localized exposure/warmth change (the lower-thirds drag canvas infra can be reused as a "grading window" canvas).
6. **Lightbox strip** — render all grade-clips as thumbnails in a strip to compare continuity (already have asset thumbnails; add a per-format aspect toggle).
7. **Before/after wipe** — hold-to-compare button on the player (show unfiltered proxy vs filtered) — the cheapest version of Resolve's wipe.
8. **More LUT presets with onboarding copy** — LUTs are fine as product; add a "look" gallery with names (CINEMA, WARM, etc. exists) + custom LUT upload later.

---

## 6. Cross-cutting improvements (benefit every role)

1. **Role-based workspace switcher, reference-app style** — a toolbar chip in the relay tabs that swaps panel emphasis; simplest version: per-leg default panel order + "reset layout" (a `Reset to saved layout` like Premiere/Essential workspace resets).
2. **Shared transport bar** — play/stop/scrub + timecode readout used by all four legs, with a shared playhead store (currently each page manages its own playhead; a tiny `useProjectPlayhead` hook would unify it).
3. **Keyboard shortcuts** — at minimum: Space (play/pause), I/O (mark in/out where applicable), C (razor in cut leg), V/Z/H (selection/zoom/hand in timeline panels), Ctrl+Z (undo history), accent-key maximize panel; surfaced in a ⌘K command palette.
4. **Dockable panels / focus mode** — allow collapsing the sidebar (already mobile-responsive) and maximizing a panel (accent-key style) for precision work.
5. **Every clickable timeline already has hover-tip timecode + duration** — keep this pattern in new rails (it matches the reference apps' readout discipline).
6. **AI stays advisory** — new AI-assisted tools (match grade, strip silence, auto-duck) must keep the existing "suggest → review → apply" pattern used by RoleOracle.

## 7. Suggested implementation order

1. **Cut leg toolbox (high bang/buck)** — Selection/Razor/Ripple/Slip/Slide on the existing main track; uses the already-shared `Timeline` component.
2. **Finish leg color wheels + curves** (signature Resolve HCI) — replaces exposure/warmth sliders; CSS filter pipeline already exists.
3. **Selects leg Source/Record marking** — three-point in/out workflow feeding the selects rail.
4. **Sound leg channel-strip mixer + faders/meters** — vertical strips + gain, reusing existing pass/music data.
5. **Finish leg motion animation (keyframes on lower-thirds) + scopes** — then polish passes.