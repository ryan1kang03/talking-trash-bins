# trashy trashy: talking trash bins (Makey Makey prototype)

Two bins, one for recycling and one for waste, that talk:

| What happens | Makey Makey input | What the bin says |
|---|---|---|
| Step on the pedal (lid opens) | pedal key **down** | "Ahhhhh!" |
| Release the pedal (lid closes) | pedal key **up** | *gulp sound* + "Gulp!" |
| Trash reaches the overflow contact | overflow key **held** for 0.6 s | *beeps* + "Take out the trash!" (repeats every 20 s while still full) |
| Camera sees a recyclable item at the waste bin | camera | *uh-oh* + "Please recycle!" |
| Camera sees a non-recyclable item at the recycling bin | camera | *uh-oh* + "Please throw that in the waste bin!" |

If the camera sees the wrong kind of item when the lid opens, the bin says the warning instead of "Ahhh". The "Gulp!" still plays when the lid closes.

## What's on screen

The laptop shows two hand-inked bin characters on paper. They act out everything they say, and a speech bubble shows each line, which helps in a noisy room:

| Pose | When | What it looks like |
|---|---|---|
| napping | before you click "wake them up" | eyes closed, z z z |
| idle | waiting | breathing, small smile, googly eyes that rattle now and then |
| ahhh | pedal down | lid flips open, mouth wide open, arms up, pedal squashes, eyes roll up |
| gulp | pedal up | a trash doodle drops in, lid shuts, belly pat, squash-and-stretch, eyes bounce |
| full | overflow held | items poking out, lid ajar, stink lines, sweat drop, holding the lid down, eyes rattle nonstop |
| warn | wrong item (camera) | stern brows, shakes, points at the other bin and glares at it |

Tally marks under each bin count the items it has swallowed.

**Backstage:** press the ` key (above Tab) or click the faint gear in the top-right corner. It holds the controls you don't want participants to see: volume, mute, the Makey Makey key check, sound check, and the event log.

If the laptop feels laggy, set `LINE_BOIL: false` in `config.js`. That turns off the wobbly-ink effect.

**About the art:** the trash doodles (`art/*.png`) and the title lettering were generated with Higgsfield (AI image generation), then recolored. The bin characters are SVG drawings in `stage.js`. Under the course AI policy, label any of these as AI-generated if they appear in your slides or video.

## Run it

**Get the code:** on the GitHub page, click the green **Code** button, then **Download ZIP**, and unzip it. If you use git, run `git clone` with the repo URL instead. Nothing needs installing.

1. Open `index.html` in **Chrome** or **Edge**. Edge has nicer built-in voices. You can also paste the file's path into the address bar, or right-click it and choose **Open with**, then Chrome.
2. Click **wake them up**, or anywhere on the screen. Browsers only allow sound after a click.
3. Keep the browser window in front. Key presses, including the Makey Makey's, only reach the page while its window is focused. A red banner appears if focus is lost.

**The camera is OFF for now** (`VISION.ENABLED: false` in `config.js`). In this mode the page is audio + Makey Makey only, needs no internet, and never asks for the camera. When you're ready for the camera, set it to `true` and see the camera section below. The camera model is downloaded the first time, so that part needs Wi-Fi.

If the camera doesn't work when you open the file directly, run a tiny local server from this folder instead and open http://localhost:8000:

```
python -m http.server 8000
```

## Makey Makey wiring (default)

| Input | Key | Clip it to |
|---|---|---|
| Recycling bin pedal | ← Left arrow | foil on the pedal's top/bottom plates (stepping closes the circuit) |
| Recycling bin overflow | ↑ Up arrow | contact near the top of the bin |
| Waste bin pedal | → Right arrow | waste pedal plates |
| Waste bin overflow | ↓ Down arrow | waste overflow contact |

Each circuit is one key clip on one side and an **EARTH** clip on the other side. When the two sides touch, the key is "pressed".

`setup-diagram-AI-generated.png` gives a rough overview of the whole setup, made with Higgsfield. Two things in it are wrong, so follow this section instead:
- Each pedal's floor pad must go to **EARTH**. All the EARTH sides can share one EARTH wire.
- One copper strip can't sense overflow on its own, because trash doesn't conduct. You need a key side and an EARTH side that touch when the bin gets too full.

To use different keys, edit `KEYS` in `config.js`. Backstage highlights each key as it's pressed, and "Last input" shows any key the page receives, so you can check each wire one at a time.

You can test everything without the Makey Makey. Use the arrow keys, and **hold** ↑/↓ to trigger "full".

## Wiring checklist

1. Plug in the Makey Makey, open `index.html`, click **wake them up**, and press ` to open Backstage.
2. Touch each key clip to the EARTH clip, one at a time. Under "Makey Makey check", the matching key should turn yellow, and "Last input" should name the right bin and input.
3. Step on each pedal. You should hear "Ahhh" on the step and "Gulp" when you lift your foot. If "Gulp" plays while your foot is still down, the foil isn't keeping contact under your weight. Use bigger foil pads or press them closer together.
4. Hold each overflow contact for about a second. You should hear "Take out the trash!", and the bin should show **FULL** until the contact is released.
5. Use the **Sound check** buttons in Backstage to hear every line without touching the hardware, and to set the volume. Close Backstage before participants arrive.

## Camera: recyclable or not?

The camera is turned off for now. To turn it on, set `ENABLED: true` under `VISION` in `config.js`.

**Default: COCO-SSD**, a ready-made object detector that works right away. It recognizes bottles, cups, books (paper), fruit, food and plastic cutlery. It does **not** know cans, chip bags, or paper scraps well. Cans usually show up as "cup" or "bottle". The boxes on the camera preview show what it sees (blue = recycle, orange = waste, gray = ignored). Edit `COCO_MAP` in `config.js` to change which label goes in which bin.

**Better for the demo: Teachable Machine.** Train it on the exact items you'll use in class:

1. Go to https://teachablemachine.withgoogle.com → *Get Started* → *Image Project* → *Standard*.
2. Make 3 classes: `Recycle`, `Waste`, `Nothing`. Use the webcam that'll be on the bins, in the same spot. Record each demo item held over the bins, from several angles. For `Nothing`, record the empty scene and people standing there with empty hands.
3. *Train Model* → *Export Model* → *Upload (shareable link)* → copy the link.
4. Paste it into `TEACHABLE_MACHINE_URL` in `config.js` and reload the page.

Class names are matched automatically: anything containing "recycl" goes to recycling, and "waste"/"trash"/"garbage"/"landfill" goes to waste. Use `TM_MAP` for other names.

**Camera placement:** point it at the space just above both bins, where people hold the item right before stepping on the pedal. When a lid opens, the program uses whatever it recognized in the last 2.5 s. If it saw nothing, it keeps watching while the lid is open.

## Use your own voices (recommended)

Text-to-speech works, but recordings of your team are more fun. See `sounds/README.txt`. Drop `ahhh.mp3`, `gulp.mp3`, etc. into the `sounds` folder and they replace the robot voice automatically.

Until you add them, the browser console shows "404 not found" for each missing sound file. That's normal: those sounds fall back to text-to-speech.

## For the observation sessions

These buttons are in Backstage (press `).

- **Next participant**: starts a new participant number and resets the on-screen counters.
- **Download CSV**: every lid open/close, wrong-bin warning, and overflow, with timestamps, participant number, what the camera saw, and how long each lid was open.
- The log is saved in the browser, so an accidental refresh doesn't lose it. **Clear** deletes it.

## How the code is organized

Every team member should be able to explain this:

| File | What it does |
|---|---|
| `config.js` | All settings: key mapping, what each bin says, voices, bin colors, timings, camera thresholds, which objects go in which bin. |
| `app.js` | The logic. It listens for key down/up from the Makey Makey. A pedal press opens the lid: it asks the camera what it saw and plays "ahhh" or a warning. A pedal release closes the lid and plays "gulp". A held overflow contact marks the bin full. It tells `audio.js` what to say and `stage.js` what to show, and keeps the event log. |
| `audio.js` | The sound engine. It plays a recorded file if one exists, otherwise a synthesized effect (Web Audio) plus text-to-speech (Web Speech API). Only one voice plays at a time: warnings interrupt "ahhh"/"gulp", and "gulp" waits until a warning finishes. It announces each line so the stage can show a matching speech bubble. |
| `stage.js` | The drawings. It builds the two bin characters as SVG and switches them between poses (napping, idle, ahhh, gulp, full, warn) with CSS animations. It also handles speech bubbles, the item dropping in, tally marks, floating doodles, and the wobbly-ink effect. |
| `art/` | Ink drawings of trash items and the title lettering (Higgsfield-generated, then recolored). |
| `vision.js` | The camera. About 5 times a second it runs the model (COCO-SSD or Teachable Machine via TensorFlow.js) and records the most confident item and its bin. `recentItem()` answers "what did you see lately?", and an item must be seen in 2+ frames (or once with 80%+ confidence) to count. |
| `index.html` / `style.css` | The page: the paper stage, the start note, and the Backstage drawer, plus the ink-and-riso look. |

Two details handle noisy hardware:
- **Debouncing.** Foil contacts flicker. A lid only counts as closed after the pedal is released for 120 ms. "Full" needs the overflow contact held for 600 ms.
- **Key repeat.** A held key makes the computer repeat key-down events. The code remembers which keys are down and ignores the repeats.
