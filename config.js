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
     Optional per line: caption (bubble text, if it should differ from what's spoken)
                        rate    (speed multiplier on top of the bin's own rate)
     --------------------------------------------------------------------------- */
  SOUNDS: {
    // Pedal stepped on -> lid opens
    open: {
      files: ['ahhh.mp3'],
      say:   ['Aah!'],      // spelled for the speech engine: "Ahhhhh!" gets read as "a-h-h-h-h"
      caption: 'Ahhhhh!',   // what the speech bubble shows (optional; defaults to the spoken text)
      rate:  0.7,           // speak this line slower than the bin's normal voice, for a long "aah"
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
     5. CAMERA: "IS THIS THE RIGHT BIN?"
     When a pedal is pressed, the camera takes a photo of the item being held over
     the bins and a vision-language model (VLM) judges whether it belongs in THIS bin.
       right bin -> nothing extra (the usual "Ahhh" ... "Gulp")
       wrong bin -> "Please recycle!" / "Please throw that in the waste bin!"
     --------------------------------------------------------------------------- */
  VISION: {
    ENABLED: true,

    // Which model judges the photo:
    //   'auto'   - Claude if an Anthropic API key is saved in Backstage, otherwise CLIP
    //   'clip'   - CLIP, runs inside the browser: free, no key, photos never leave the laptop
    //              (first start downloads the model, ~150 MB; the website caches it afterwards)
    //   'claude' - Claude: understands tricky items much better; needs an API key, costs a
    //              fraction of a cent per photo, and sends each photo to Anthropic
    ENGINE: 'auto',

    // Photos taken after the pedal goes down. If the first one shows no item, try again.
    SNAPSHOT_DELAYS_MS: [150, 900],

    /* ---- CLIP settings ---- */
    CLIP_MODEL: 'Xenova/clip-vit-base-patch32',
    MIN_CONFIDENCE: 0.45,   // CLIP must be at least this sure (0-1) before a bin complains
    // CLIP compares the photo with every description below and picks the closest.
    // Add descriptions of YOUR demo items for better results.
    CLIP_LABELS: {
      recycle: ['a plastic water bottle', 'an aluminum soda can', 'a crumpled sheet of paper',
                'a cardboard box', 'a glass bottle', 'a newspaper'],
      waste:   ['a banana peel', 'an apple core', 'food scraps', 'a chip bag',
                'a candy wrapper', 'a used tissue', 'a plastic fork'],
      none:    ['a person with empty hands', 'an empty room', 'a person\'s face'],
    },

    /* ---- Claude settings ---- */
    CLAUDE_MODEL: 'claude-opus-5-5',
    // The rules Claude follows. Edit this to match your campus recycling rules.
    CLAUDE_PROMPT:
      'You are the camera for two talking trash bins in a classroom demo: a RECYCLING bin ' +
      'and a WASTE (landfill) bin. Find the single item a person is about to throw away ' +
      '(usually held in a hand near the bins) and decide which bin it belongs in. ' +
      'Recycle: empty plastic bottles and rigid plastic containers, aluminum and steel cans, ' +
      'glass bottles and jars, clean paper, cardboard. ' +
      'Waste: food scraps, chip bags and candy wrappers, plastic bags and film, used tissues ' +
      'and napkins, paper coffee cups, plastic utensils, styrofoam. ' +
      'If no item is clearly being thrown away, answer "none".',
  },
};
