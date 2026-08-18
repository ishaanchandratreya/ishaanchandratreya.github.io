# Pendulum — strumming trainer

A single-page practice tool for one specific fault: the strumming hand executing
memorised stroke-groups instead of swinging continuously and placing hits into
that swing. It shows the hand as a real pendulum, marks ghost strokes as motion
without contact, and measures whether a three-stroke run compresses.

No build step, no dependencies. `index.html` is the whole app.

## Subdivisions

The **Subdivision** selector switches the grid and the pendulum between 8ths
(8 cells, `1 & 2 &`), 16ths (16 cells, `1 e & a`) and triplets (12 cells,
`1 t l`). A bar always lasts four beats, so beat 1 of the next bar lands at the
same instant whichever you pick — only the stroke rate changes.

Direction is strict alternation throughout: even cells are downstrokes, odd cells
are upstrokes. In triplets that means beat 2 begins on an *upstroke* and the hand
realigns every two beats. That is what a continuously swinging hand actually does
with three strokes to a beat, and it is deliberate rather than a bug.

The shipped drills are all 8th-note drills, so loading one returns the selector
to 8ths. Build 16th and triplet patterns by switching the subdivision and tapping
cells; the metronome, freeze test, ladder and compression test all follow.

## Local use

Open `index.html` in a browser. Everything works offline except **Mirror my hand**,
which needs a camera and therefore an `https://` origin — it works once published.

## Drills

Every drill has a keyboard key. Press it and the drill configures and starts itself.

| key | drill | what it does automatically |
|-----|-------|----------------------------|
| `1` | Silent pendulum | all ghosts, click on every 8th |
| `2` | Continuous 8ths, muted | all hits, click on every 8th |
| `3` | Accent the upstrokes | click moves to the offbeats |
| `4` | Freeze test | stops you every 2–5 bars and states where the hand should be |
| `5` | Wide rebound | slow continuous 8ths |
| `6` | Subtraction ladder | advances A→B→C→D every 8 bars on its own |
| `7` | Loud ghosts | plays ghosts as quiet brushes |
| `8` | Say the ghosts | marks the two ghost cells to shout |
| `9` | Burst isolation | only the UDU, one click per stroke |
| `0` | Burst shifted early | the same UDU on the & of 1 |
| `q` | Clicks on the UDU only | metronome marks only the burst |
| `w` | Freeze on the & of 4 | freezes every 4th bar after the last upstroke |
| `e` | Oversized arc | widens the target arc |
| `r` | Half speed | 50 bpm |
| `t` | Click on 2 and 4 | |
| `y` | Beat 1 only | |
| `u` | Dropout bars | 2 bars with click, 2 without |
| `i` | Tempo creep | +2 bpm every 8 bars, 50 → 80 |

`space` taps the compression test. Click any grid cell to switch it between a hit
and a ghost.

## Tests

```
npm install          # jsdom, only needed for the DOM suite
./run-tests.sh
```

131 engine tests and 69 DOM tests. `test/engine.test.js` extracts the engine block straight out of
`index.html` and checks the timing maths, pendulum geometry, click modes, ladder
stages, subdivisions, freeze scheduling, tempo ramps and compression analysis. `test/dom.test.js`
boots the real page in jsdom with a stubbed audio clock and checks the UI wiring,
drill loading, keyboard shortcuts, freeze overlay and tap recording.

## Editing

All colour, type and size tokens are CSS variables in the first 25 lines.
The drill catalogue is the `TIERS` array inside the `ENGINE` block — adding a
drill is one object, and the validation test will tell you if it's malformed.
