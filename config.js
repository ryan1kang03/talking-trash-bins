/* =============================================================================
   CONFIG — everything the team is likely to tweak lives in this one file.
   You should never need to touch audio.js / vision.js / app.js for normal changes.
   ============================================================================= */

const CONFIG = {

  /* ---------------------------------------------------------------------------
     1. MAKEY MAKEY WIRING
     The Makey Makey shows up as a USB keyboard. Each alligator-clip input
     "presses" a key while its circuit is closed.
       key DOWN = circuit closed (pedal stepped on / overflow contact touched)
       key UP   = circuit opened  (pedal released / contact no longer touched)

     Default Makey Makey keys (front):  ArrowUp ArrowDown ArrowLeft ArrowRight Space
     Back header keys:                  w a s d f g
     You can test everything with your laptop's arrow keys — no Makey Makey needed.
     --------------------------------------------------------------------------- */
  KEYS: {
    ArrowLeft:  { bin: 'recycle', input: 'pedal'    },
    ArrowUp:    { bin: 'recycle', input: 'overflow' },
    ArrowRight: { bin: 'waste',   input: 'pedal'    },
    ArrowDown:  { bin: 'waste',   input: 'overflow' },
  },

  /* ---------------------------------------------------------------------------
     2. THE TWO BINS
     The bin id ('recycle' / 'waste') is also the category of trash it accepts.
     Each bin gets its own voice so people can tell which one is talking.
       voiceHints: the first installed voice whose name contains one of these wins
       pitch: 0–2 (1 = normal)   rate: 0.1–10 (1 = normal)
     --------------------------------------------------------------------------- */
  BINS: {
    recycle: {
      name: 'Recycling bin',
      label: 'recycle',            // hand-lettered under the drawing
      color: '#4f7fe6',            // flat spot colour of the drawn bin
      items: ['art/bottle.png', 'art/can.png', 'art/paper.png'],   // what it's drawn swallowing
      voiceHints: ['Aria', 'Jenny', 'Zira', 'Samantha', 'Google US English'],
      pitch: 1.3,
      rate: 1.0,
    },
    waste: {
      name: 'Waste bin',
      label: 'waste',
      color: '#f2703f',
      items: ['art/banana.png', 'art/apple-core.png', 'art/chip-bag.png'],
      voiceHints: ['Guy', 'David', 'Mark', 'Daniel', 'Google UK English Male'],
      pitch: 0.8,
      rate: 0.95,
    },
  },

  /* ---------------------------------------------------------------------------
     2b. LOOK
     --------------------------------------------------------------------------- */
  LOOK: {
    LINE_BOIL: true,          // hand-animated "wobbly ink" effect (turn off if the laptop gets laggy)
    BOIL_MS: 160,             // how often the ink wobbles (lower = jitterier)
    BUBBLE_LINGER_MS: 700,    // speech bubble stays this long after the voice stops
  },

  /* ---------------------------------------------------------------------------
     3. SOUNDS
     For every event the program tries, in order:
       a) a recorded file from the /sounds folder (pick a random one if you list several)
       b) otherwise: the built-in synth effect (sfx) + text-to-speech (say)
     A recorded file REPLACES both the synth effect and the voice.

     priority: a higher-priority sound interrupts a lower one. A lower-priority sound
     that arrives while a higher one is playing waits for it to finish (up to
     QUEUE_MAX_WAIT_MS), then plays — e.g. "Please recycle!" ... "Gulp!".

     sfx options: 'gulp', 'uhoh', 'alarm', 'ready'  (or null for none)
     --------------------------------------------------------------------------- */
  SOUNDS: {
    // Pedal stepped on -> lid opens
    open: {
      files: ['ahhh.mp3'],
      say:   ['Ahhhhh!'],
      sfx:   null,
      priority: 1,
    },
    // Pedal released -> lid closes
    close: {
      files: ['gulp.mp3'],
      say:   ['Gulp!'],
      sfx:   'gulp',
      priority: 1,
    },
    // Overflow contact touched -> bin is too full
    full: {
      files: ['take-out-the-trash.mp3'],
      say:   ['Take out the trash!'],
      sfx:   'alarm',
      priority: 3,
    },
    // Said by the WASTE bin when the camera sees something recyclable
    pleaseRecycle: {
      files: ['please-recycle.mp3'],
      say:   ['Please recycle!'],
      sfx:   'uhoh',
      priority: 3,
    },
    // Said by the RECYCLING bin when the camera sees something that isn't recyclable
    pleaseWaste: {
      files: ['please-throw-in-waste.mp3'],
      say:   ['Please throw that in the waste bin!'],
      sfx:   'uhoh',
      priority: 3,
    },
  },

  VOLUME: 1.0,              // 0–1, starting master volume (there's also a slider on screen)
  QUEUE_MAX_WAIT_MS: 2500,  // a waiting sound older than this is dropped instead of played late

  /* ---------------------------------------------------------------------------
     4. TIMING (Makey Makey contacts are a bit noisy, so we smooth them out)
     --------------------------------------------------------------------------- */
  PEDAL_DEBOUNCE_MS: 120,          // pedal must be released this long before the lid counts as closed
  OVERFLOW_CONFIRM_MS: 600,        // overflow contact must be held this long to count as "full" (and released this long to clear)
  OVERFLOW_REMIND_EVERY_SEC: 20,   // repeat "Take out the trash!" while still full (0 = only say it once)

  /* ---------------------------------------------------------------------------
     5. CAMERA / RECYCLING DETECTION
     --------------------------------------------------------------------------- */
  VISION: {
    // OFF for now: audio + Makey Makey only (works without internet, no camera prompt).
    // Set to true when you're ready to add the camera.
    ENABLED: false,

    // OPTION A (default): built-in object detector (COCO-SSD). Works out of the box
    // for bottles, cups, food, utensils... but it doesn't know cans or paper well.
    //
    // OPTION B (recommended for the demo): train your own model on YOUR demo items at
    // https://teachablemachine.withgoogle.com (Image Project) with classes named
    // e.g. "Recycle", "Waste", "Nothing", click Export -> Upload, and paste the link here.
    TEACHABLE_MACHINE_URL: '',   // e.g. 'https://teachablemachine.withgoogle.com/models/AbC123xYz/'

    COCO_BASE: 'mobilenet_v2',   // 'lite_mobilenet_v2' = faster, 'mobilenet_v2' = more accurate
    INTERVAL_MS: 200,            // how often the camera is analysed
    MIN_SCORE: 0.55,             // ignore guesses less confident than this
    SURE_SCORE: 0.8,             // a single frame this confident is enough on its own
    MIN_FRAMES: 2,               // otherwise the item must be seen in at least this many frames
    LOOKBACK_MS: 2500,           // when a lid opens, use what the camera saw in the last 2.5 s
    LIVE_WINDOW_MS: 1200,        // while a lid is open, keep checking the last 1.2 s

    // COCO-SSD label -> which bin it belongs in. Labels not listed are ignored
    // (people, laptops, chairs...). Full label list: see README.
    COCO_MAP: {
      'bottle': 'recycle',
      'cup': 'recycle',          // soda cans are usually detected as "cup" or "bottle"
      'wine glass': 'recycle',   // clear plastic cups/bottles sometimes show up as this
      'book': 'recycle',         // paper / cardboard / magazines
      'banana': 'waste',
      'apple': 'waste',
      'orange': 'waste',
      'sandwich': 'waste',
      'hot dog': 'waste',
      'pizza': 'waste',
      'donut': 'waste',
      'cake': 'waste',
      'broccoli': 'waste',
      'carrot': 'waste',
      'fork': 'waste',           // plastic cutlery
      'spoon': 'waste',
      'knife': 'waste',
      'toothbrush': 'waste',
    },

    // Teachable Machine class name -> bin. Classes not listed here are guessed from
    // their name: contains "recycl" -> recycle; "waste"/"trash"/"garbage"/"landfill"
    // or "not recyclable" -> waste; anything else ("Nothing", "Background") -> ignored.
    TM_MAP: {
      // 'Plastic bottle': 'recycle',
      // 'Chip bag': 'waste',
    },
  },
};
