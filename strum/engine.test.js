const fs = require("fs");
const path = require("path");
const { T, eq, ok, close, deepEq, throwsNot, report } = require("./harness");

// Extract the engine straight out of the shipped file so tests can never drift from it.
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/\/\* ENGINE:START[\s\S]*?\*\/([\s\S]*?)\/\* ENGINE:END \*\//);
if (!m) { console.error("FATAL: could not find ENGINE block in index.html"); process.exit(1); }
const E = eval(m[1] + "\nENGINE;");

const FULL = E.P_FULL, ALL = E.P_ALL, NONE = E.P_NONE;
const base = (o) => Object.assign({ bpm: 60, click: "beats", pattern: FULL, countIn: false }, o);

/* ============================================================ 1. TIMING MATH */
T("eighthDur: 60bpm -> 0.5s, 120bpm -> 0.25s, 50bpm -> 0.6s", () => {
  close(E.eighthDur(60), 0.5); close(E.eighthDur(120), 0.25); close(E.eighthDur(50), 0.6);
});
T("eighthDur is inversely proportional to bpm", () => {
  close(E.eighthDur(70) * 70, E.eighthDur(140) * 140);
});
T("dirOf: even index down, odd index up", () => {
  deepEq([0,1,2,3,4,5,6,7].map(E.dirOf), ["d","u","d","u","d","u","d","u"]);
});

/* ============================================================ 2. PENDULUM GEOMETRY */
T("theta is exactly 0 at every whole eighth (hand at the strings)", () => {
  for (let n = -4; n <= 16; n++) close(E.theta(n, 0.62), 0, 1e-12);
});
T("theta hits full extension at every half eighth", () => {
  for (let n = 0; n < 8; n++) close(Math.abs(E.theta(n + 0.5, 0.62)), 0.62, 1e-12);
});
T("extension is BELOW after a downstroke and ABOVE after an upstroke", () => {
  eq(E.handSide(0.5), "below");  // just past the down on "1"
  eq(E.handSide(1.5), "above");  // just past the up on "&"
  eq(E.handSide(2.5), "below");
  eq(E.handSide(7.5), "above");  // just past the up on "&4"
});
T("handSide is 'at' exactly on the counts", () => {
  eq(E.handSide(0), "at"); eq(E.handSide(3), "at"); eq(E.handSide(8), "at");
});
T("goingDown is true through downstrokes, false through upstrokes", () => {
  ok(E.goingDown(0.25) && E.goingDown(0.49));   // heading down after "1"
  ok(!E.goingDown(1.25) && !E.goingDown(1.49)); // heading up after the "&"
  ok(E.goingDown(2.1)); ok(!E.goingDown(3.1));
});
T("direction flips at full extension and nowhere else", () => {
  ok(E.goingDown(0.49) !== E.goingDown(0.51), "should flip at extension");
  eq(E.goingDown(0.1), E.goingDown(0.4));   // constant through the down half
  eq(E.goingDown(0.6), E.goingDown(0.9));   // constant through the up half
  ok(E.goingDown(0.9) !== E.goingDown(1.1) === false, "no flip at the strings");
  eq(E.goingDown(0.9), E.goingDown(1.1));   // crossing the strings does NOT flip direction
});
T("velocity is maximal at the strings and zero at extension", () => {
  const v = (e) => Math.abs(Math.cos(Math.PI * e));   // d(theta)/de up to constants
  ok(v(0) > v(0.4)); ok(v(0.4) > v(0.49)); close(v(0.5), 0, 1e-6);
});
T("contactIndex maps a moment to the stroke that just happened", () => {
  eq(E.contactIndex(0), 0); eq(E.contactIndex(0.9), 0);
  eq(E.contactIndex(1.0), 1); eq(E.contactIndex(7.99), 7); eq(E.contactIndex(8.0), 8);
});

/* ============================================================ 3. CLICK MODES */
const idx = (mode, bar = 0) => [0,1,2,3,4,5,6,7].filter(i => E.wantsClick(mode, i, bar));
T("click mode all8 fires on all eight", () => deepEq(idx("all8"), [0,1,2,3,4,5,6,7]));
T("click mode beats fires on 1 2 3 4", () => deepEq(idx("beats"), [0,2,4,6]));
T("click mode 24 fires only on beats 2 and 4", () => deepEq(idx("24"), [2,6]));
T("click mode off fires only on the &s", () => deepEq(idx("off"), [1,3,5,7]));
T("click mode burst fires only on the UDU (&3, 4, &4)", () => deepEq(idx("burst"), [5,6,7]));
T("click mode one fires only on beat 1", () => deepEq(idx("one"), [0]));
T("click mode none never fires", () => deepEq(idx("none"), []));
T("dropout: bars 0-1 click on beats, bars 2-3 silent, then repeats", () => {
  deepEq(idx("drop", 0), [0,2,4,6]);
  deepEq(idx("drop", 1), [0,2,4,6]);
  deepEq(idx("drop", 2), []);
  deepEq(idx("drop", 3), []);
  deepEq(idx("drop", 4), [0,2,4,6]);
  deepEq(idx("drop", 7), []);
});
T("unknown click mode is silent rather than throwing", () => {
  deepEq(idx("nonsense"), []);
});

/* ============================================================ 4. EVENT GENERATION */
const kinds = (n, d) => E.eventsForNote(n, d).map(e => e.type + ":" + (e.kind || e.dir));
T("count-in gives exactly 4 clicks and no strums", () => {
  const d = base({ countIn: true, playback: true, pattern: ALL });
  let clicks = 0, strums = 0;
  for (let n = -8; n < 0; n++) E.eventsForNote(n, d).forEach(e => e.type === "click" ? clicks++ : strums++);
  eq(clicks, 4); eq(strums, 0);
});
T("count-in starts with an accent then plain beats", () => {
  const d = base({ countIn: true });
  eq(E.eventsForNote(-8, d)[0].kind, "accent");
  eq(E.eventsForNote(-6, d)[0].kind, "beat");
});
T("beat 1 of every bar is accented", () => {
  const d = base({ click: "all8" });
  eq(E.eventsForNote(0, d)[0].kind, "accent");
  eq(E.eventsForNote(8, d)[0].kind, "accent");
  eq(E.eventsForNote(2, d)[0].kind, "beat");
  eq(E.eventsForNote(1, d)[0].kind, "sub");
});
T("with playback off, no strums are produced at all", () => {
  const d = base({ click: "none", playback: false, pattern: ALL });
  for (let n = 0; n < 8; n++) eq(E.eventsForNote(n, d).length, 0);
});
T("playback strums the hits with the right hand direction", () => {
  const d = base({ click: "none", playback: true, pattern: FULL });
  deepEq(kinds(0, d), ["strum:d"]);   // beat 1, down
  deepEq(kinds(3, d), ["strum:u"]);   // & of 2, up
  deepEq(kinds(6, d), ["strum:d"]);   // beat 4, down
  deepEq(kinds(7, d), ["strum:u"]);   // & of 4, up
});
T("ghosts are silent when ghostAudible is off", () => {
  const d = base({ click: "none", playback: true, pattern: FULL });
  deepEq(kinds(1, d), []);   // & of 1 is a ghost
  deepEq(kinds(4, d), []);   // beat 3 is a ghost
});
T("ghostAudible plays ghosts quietly and turns playback on by itself", () => {
  const d = base({ click: "none", playback: false, ghostAudible: true, pattern: FULL });
  const g = E.eventsForNote(1, d)[0], h = E.eventsForNote(0, d)[0];
  eq(g.type, "strum"); ok(g.gain < 0.1, "ghost should be quiet, got " + g.gain);
  eq(h.type, "strum"); ok(h.gain > 0.3, "hit should be loud, got " + h.gain);
});
T("accentUps makes upstrokes louder than downstrokes", () => {
  const d = base({ click: "none", playback: true, accentUps: true, pattern: ALL });
  ok(E.eventsForNote(1, d)[0].gain > E.eventsForNote(0, d)[0].gain);
});
T("the default pattern really is D DU UDU", () => {
  deepEq(FULL, [1,0,1,1,0,1,1,1]);
  const audible = FULL.map((v,i) => v ? E.dirOf(i).toUpperCase() : "-").join("");
  eq(audible, "D-DU-UDU");
});
T("burst isolation drill leaves exactly the three burst strokes", () => {
  const d = E.DRILLS.find(x => x.title === "Burst isolation");
  deepEq(d.pattern.map((v,i) => v ? i : null).filter(v => v !== null), [5,6,7]);
});
T("burst shifted keeps the same U-D-U hand sequence", () => {
  const a = E.DRILLS.find(x => x.title === "Burst isolation").pattern;
  const b = E.DRILLS.find(x => x.title === "Burst shifted early").pattern;
  const seq = p => p.map((v,i) => v ? E.dirOf(i) : null).filter(Boolean).join("");
  eq(seq(a), "udu"); eq(seq(b), "udu");
});

/* ============================================================ 5. LADDER STAGES */
const ladder = E.DRILLS.find(d => d.stages);
T("ladder holds each stage for 8 bars", () => {
  for (let b = 0; b < 8; b++)   eq(E.stageAt(b, ladder).index, 0);
  for (let b = 8; b < 16; b++)  eq(E.stageAt(b, ladder).index, 1);
  for (let b = 16; b < 24; b++) eq(E.stageAt(b, ladder).index, 2);
  eq(E.stageAt(24, ladder).index, 3);
});
T("ladder clamps at the final stage instead of wrapping", () => {
  eq(E.stageAt(200, ladder).index, 3);
  deepEq(E.stageAt(200, ladder).pattern, FULL);
});
T("ladder goes all-hits -> one ghost -> other ghost -> both", () => {
  const hits = i => E.stageAt(i * 8, ladder).pattern.reduce((a,b) => a+b, 0);
  deepEq([hits(0), hits(1), hits(2), hits(3)], [8, 7, 7, 6]);
});
T("each ladder stage removes sound but never changes stroke direction", () => {
  ladder.stages.forEach(s => {
    s.pattern.forEach((v, i) => { if (v) eq(E.dirOf(i), i % 2 === 0 ? "d" : "u"); });
  });
});
T("patternAtBar follows the ladder and ignores d.pattern", () => {
  deepEq(E.patternAtBar(0, ladder), ALL);
  deepEq(E.patternAtBar(24, ladder), FULL);
});
T("non-staged drills return their fixed pattern at any bar", () => {
  const d = base({});
  deepEq(E.patternAtBar(0, d), FULL);
  deepEq(E.patternAtBar(99, d), FULL);
});
T("events follow the ladder stage, not the starting pattern", () => {
  const d = Object.assign({}, ladder, { click: "none", playback: true, countIn: false });
  eq(E.eventsForNote(1, d).length, 1);          // bar 0, stage A: & of 1 is a hit
  eq(E.eventsForNote(24 * 8 + 1, d).length, 0); // bar 24, stage D: & of 1 is a ghost
});

/* ============================================================ 6. FREEZE */
const fz = { freeze: { mode: "random" } };
T("freeze schedule is deterministic for a given seed", () => {
  deepEq(E.freezeSchedule(42, 10, fz), E.freezeSchedule(42, 10, fz));
});
T("different seeds give different freezes", () => {
  ok(JSON.stringify(E.freezeSchedule(1, 10, fz)) !== JSON.stringify(E.freezeSchedule(2, 10, fz)));
});
T("freezes always land at full extension (half-integer e)", () => {
  [1, 7, 99, 12345].forEach(seed =>
    E.freezeSchedule(seed, 30, fz).forEach(e => close(e % 1, 0.5, 1e-9)));
});
T("freezes are strictly increasing and 2-5 bars apart", () => {
  [3, 55, 777].forEach(seed => {
    const s = E.freezeSchedule(seed, 40, fz);
    for (let i = 1; i < s.length; i++) {
      ok(s[i] > s[i-1], "not increasing");
      const gap = Math.floor(s[i]/8) - Math.floor(s[i-1]/8);
      ok(gap >= 2 && gap <= 5, "bar gap out of range: " + gap);
    }
  });
});
T("freeze schedule returns the requested count", () => {
  eq(E.freezeSchedule(9, 40, fz).length, 40);
});
T("the 'freeze on &4' drill always stops just past the last upstroke", () => {
  const d = E.DRILLS.find(x => x.freeze && x.freeze.at === "end");
  E.freezeSchedule(0, 12, d).forEach(e => {
    eq(Math.floor(e) % 8, 7);          // index 7 is the & of 4
    eq(E.freezeInfo(e).count, "&");
    eq(E.freezeInfo(e).dir, "u");
    eq(E.freezeInfo(e).side, "above");
  });
});
T("'freeze on &4' fires once every 4 bars", () => {
  const d = E.DRILLS.find(x => x.freeze && x.freeze.at === "end");
  const s = E.freezeSchedule(0, 6, d).map(e => Math.floor(e / 8));
  deepEq(s, [3, 7, 11, 15, 19, 23]);
});
T("freezeInfo reports the correct side of the strings", () => {
  eq(E.freezeInfo(0.5).side, "below");  eq(E.freezeInfo(0.5).count, "1");
  eq(E.freezeInfo(1.5).side, "above");  eq(E.freezeInfo(1.5).count, "&");
  eq(E.freezeInfo(4.5).side, "below");  eq(E.freezeInfo(4.5).count, "3");
  eq(E.freezeInfo(6.5).side, "below");  eq(E.freezeInfo(6.5).count, "4");
});
T("freezeInfo agrees with handSide for every position", () => {
  for (let n = 0; n < 32; n++) eq(E.freezeInfo(n + 0.5).side, E.handSide(n + 0.5));
});
T("freezeInfo works in later bars, not just the first", () => {
  eq(E.freezeInfo(8 * 5 + 2.5).count, "2");
  eq(E.freezeInfo(8 * 5 + 2.5).side, "below");
});
T("freezeInfo text names the stroke you just played", () => {
  ok(/downstroke on "3"/.test(E.freezeInfo(4.5).text));
  ok(/upstroke on "&"/.test(E.freezeInfo(7.5).text));
});

/* ============================================================ 7. TEMPO RAMP */
const ramp = { bpm: 50, ramp: { every: 8, delta: 2, max: 80 }, click: "beats", pattern: FULL, countIn: false };
T("bpm holds for 8 bars then steps by 2", () => {
  eq(E.bpmAtBar(0, ramp), 50); eq(E.bpmAtBar(7, ramp), 50);
  eq(E.bpmAtBar(8, ramp), 52); eq(E.bpmAtBar(15, ramp), 52);
  eq(E.bpmAtBar(16, ramp), 54);
});
T("bpm ramp clamps at its maximum", () => {
  eq(E.bpmAtBar(1000, ramp), 80);
  eq(E.bpmAtBar(8 * 15, ramp), 80);
});
T("count-in bars stay at the base tempo", () => {
  eq(E.bpmAtBar(-1, ramp), 50);
});
T("drills without a ramp never change tempo", () => {
  const d = base({});
  eq(E.bpmAtBar(0, d), 60); eq(E.bpmAtBar(500, d), 60);
});
T("timeOfNote with no ramp equals n * eighth", () => {
  const d = base({ bpm: 60 });
  for (let n = 0; n < 40; n++) close(E.timeOfNote(n, d), n * 0.5, 1e-9);
});
T("timeOfNote is strictly increasing under a ramp", () => {
  let prev = -1;
  for (let n = 0; n < 200; n++) { const t = E.timeOfNote(n, ramp); ok(t > prev); prev = t; }
});
T("a ramped bar takes less time than the bar before it", () => {
  const bar = b => E.timeOfNote((b+1)*8, ramp) - E.timeOfNote(b*8, ramp);
  ok(bar(8) < bar(0), "tempo should have increased");
  close(bar(0), 8 * E.eighthDur(50), 1e-9);
  close(bar(8), 8 * E.eighthDur(52), 1e-9);
});
T("timeOfNote handles the count-in as negative time", () => {
  const d = base({ bpm: 60, countIn: true });
  close(E.timeOfNote(-8, d), -4, 1e-9);   // 8 eighths before zero at 0.5s each
  close(E.timeOfNote(0, d), 0, 1e-9);
});

/* ============================================================ 8. SIMULATE (end to end) */
T("simulate emits one row per eighth including the count-in", () => {
  const d = base({ countIn: true });
  eq(E.simulate(d, 4).length, 8 + 32);
});
T("simulate timestamps are monotonic and put the count-in before zero", () => {
  const rows = E.simulate(base({ countIn: true, bpm: 60 }), 4);
  close(rows[0].t, -4, 1e-9);                       // 8 eighths at 0.5s, ahead of bar 1
  eq(rows.find(r => r.n === 0).t, 0);
  for (let i = 1; i < rows.length; i++) ok(rows[i].t > rows[i-1].t);
});
T("count-in occupies exactly one bar of real time", () => {
  const d = base({ countIn: true, bpm: 75 });
  close(E.timeOfNote(0, d) - E.timeOfNote(-8, d), 8 * E.eighthDur(75), 1e-9);
});
T("the audible pattern is not shifted by turning the count-in on", () => {
  const on = E.simulate(base({ countIn: true, click: "none", playback: true }), 2);
  const off = E.simulate(base({ countIn: false, click: "none", playback: true }), 2);
  const sig = rows => rows.filter(r => r.n >= 0).map(r => r.n + "@" + r.t.toFixed(6)).join("|");
  eq(sig(on), sig(off));
});
T("a full bar of D DU UDU produces exactly 6 strums", () => {
  const d = base({ click: "none", playback: true });
  const strums = E.simulate(d, 1).flatMap(r => r.events).filter(e => e.type === "strum");
  eq(strums.length, 6);
  deepEq(strums.map(s => s.dir), ["d","d","u","u","d","u"]);
});
T("the gaps between audible strokes are 2,1,2,1,1 eighths", () => {
  const d = base({ click: "none", playback: true });
  const times = E.simulate(d, 1).filter(r => r.events.length).map(r => r.n);
  deepEq(times.slice(1).map((n,i) => n - times[i]), [2,1,2,1,1]);
});
T("silent pendulum drill makes no sound but still occupies every eighth", () => {
  const d = base({ click: "none", pattern: NONE, playback: true });
  const rows = E.simulate(d, 2);
  eq(rows.length, 16);
  eq(rows.flatMap(r => r.events).length, 0);
});
T("dropout drill really goes quiet for bars 3 and 4", () => {
  const d = base({ click: "drop", playback: false });
  const perBar = [0,1,2,3].map(b =>
    E.simulate(d, 4).filter(r => Math.floor(r.n/8) === b).flatMap(r => r.events).length);
  deepEq(perBar, [4,4,0,0]);
});

/* ============================================================ 9. COMPRESSION ANALYSIS */
const e8 = 0.5;
const fromGaps = gaps => { const t = [0]; gaps.forEach(g => t.push(t[t.length-1] + g)); return t; };
T("perfectly even playing reads 100% across the board", () => {
  const a = E.analyze(fromGaps([1,0.5,1,0.5,0.5].map(x => x)), e8);
  a.rows.forEach(r => close(r.pct, 100, 1e-6));
  eq(a.verdict, "even");
});
T("nominal gap detection recognises 1-eighth and 2-eighth spacings", () => {
  const a = E.analyze(fromGaps([1.0, 0.5, 1.0, 0.5, 0.5]), e8);
  deepEq(a.rows.map(r => r.nom), [2,1,2,1,1]);
});
T("a compressed burst is detected and named", () => {
  // first half correct, burst 20% short
  const a = E.analyze(fromGaps([1.0, 0.5, 1.0, 0.40, 0.40]), e8);
  ok(a.late < a.early, "late should be tighter than early");
  ok(a.drift < -4);
  eq(a.verdict, "compressing");
});
T("dragging is detected as slowing, not compressing", () => {
  const a = E.analyze(fromGaps([1.0, 0.5, 1.0, 0.60, 0.60]), e8);
  ok(a.drift > 4); eq(a.verdict, "slowing");
});
T("small human wobble is not flagged", () => {
  const a = E.analyze(fromGaps([1.0, 0.49, 1.02, 0.5, 0.51]), e8);
  eq(a.verdict, "even");
});
T("percentages are correct in magnitude", () => {
  const a = E.analyze(fromGaps([0.5, 0.45]), e8);
  close(a.rows[0].pct, 100, 1e-6);
  close(a.rows[1].pct, 90, 1e-6);
});
T("fewer than three taps yields no verdict rather than a crash", () => {
  eq(E.analyze([], e8).rows.length, 0);
  eq(E.analyze([1], e8).rows.length, 0);
  eq(E.analyze([1, 1.5], e8).verdict, "more taps");
  eq(E.analyze([1, 1.5], e8).drift, null);
});
T("analysis is tempo independent", () => {
  const slow = E.analyze(fromGaps([1.0, 0.5, 1.0, 0.4, 0.4]), 0.5);
  const fast = E.analyze(fromGaps([0.5, 0.25, 0.5, 0.2, 0.2]), 0.25);
  close(slow.drift, fast.drift, 1e-6);
});
T("a realistic compressing bar reports both halves", () => {
  const a = E.analyze(fromGaps([1.0, 0.5, 0.98, 0.44, 0.42, 0.41]), e8);
  ok(a.early > 95 && a.early < 105);
  ok(a.late < 92);
  eq(a.verdict, "compressing");
});

/* ============================================================ 10. DRILL CATALOGUE */
T("every drill passes validation", () => {
  E.DRILLS.forEach(d => {
    const errs = E.validateDrill(d);
    ok(errs.length === 0, d.title + " -> " + errs.join(","));
  });
});
T("drill keys are unique", () => {
  const keys = E.DRILLS.map(d => d.key);
  eq(new Set(keys).size, keys.length);
});
T("drill titles are unique", () => {
  const t = E.DRILLS.map(d => d.title);
  eq(new Set(t).size, t.length);
});
T("every drill has a cue line telling the player what to do", () => {
  E.DRILLS.forEach(d => ok(d.cue && d.cue.length > 15, d.title + " has no usable cue"));
});
T("every drill uses a click mode the UI actually offers", () => {
  E.DRILLS.forEach(d => ok(E.CLICK_MODES.indexOf(d.click) >= 0, d.title));
});
T("every drill tempo is inside the slider range", () => {
  E.DRILLS.forEach(d => ok(d.bpm >= 40 && d.bpm <= 140, d.title + " bpm " + d.bpm));
});
T("validateDrill rejects a bad pattern", () => {
  ok(E.validateDrill({ key:"z", title:"x", why:"y", click:"beats", bpm:60, pattern:[1,0,1] }).length > 0);
  ok(E.validateDrill({ key:"z", title:"x", why:"y", click:"beats", bpm:60, pattern:[1,0,1,1,0,1,1,2] }).length > 0);
});
T("validateDrill rejects a bad click mode, tempo, key and arc", () => {
  const g = o => E.validateDrill(Object.assign({ key:"z", title:"x", why:"y", click:"beats", bpm:60, pattern:FULL }, o));
  ok(g({ click:"wat" }).length > 0);
  ok(g({ bpm: 300 }).length > 0);
  ok(g({ key: "" }).length > 0);
  ok(g({ arc: 5 }).length > 0);
  ok(g({ ramp: { every: 0, delta: 2, max: 90 } }).length > 0);
});
T("every drill simulates a clean 4 bars without throwing", () => {
  E.DRILLS.forEach(d => {
    const cfg = Object.assign({}, d, { countIn: true, playback: true });
    const rows = E.simulate(cfg, 4);
    ok(rows.length === 8 + 32, d.title);
    rows.forEach(r => r.events.forEach(ev => {
      ok(ev.type === "click" || ev.type === "strum", d.title + " bad event");
      if (ev.type === "strum") ok(ev.gain > 0 && ev.gain <= 1, d.title + " bad gain");
    }));
  });
});
T("at least one drill exists per behaviour we advertise", () => {
  ok(E.DRILLS.some(d => d.stages), "no ladder drill");
  ok(E.DRILLS.some(d => d.ramp), "no tempo ramp drill");
  ok(E.DRILLS.some(d => d.freeze && d.freeze.mode === "random"), "no random freeze drill");
  ok(E.DRILLS.some(d => d.freeze && d.freeze.at === "end"), "no end-of-bar freeze drill");
  ok(E.DRILLS.some(d => d.accentUps), "no accent-ups drill");
  ok(E.DRILLS.some(d => d.emphasizeGhosts), "no say-the-ghosts drill");
  ok(E.DRILLS.some(d => d.ghostAudible), "no loud-ghosts drill");
  ok(E.DRILLS.some(d => d.arc), "no oversized-arc drill");
  ok(E.DRILLS.some(d => d.click === "burst"), "no burst-click drill");
});
T("tier structure covers every drill exactly once", () => {
  const flat = E.TIERS.flatMap(t => t.items);
  eq(flat.length, E.DRILLS.length);
  eq(new Set(flat).size, E.DRILLS.length);
});

/* ============================================================ 11. CANVAS LAYOUT */
const SIZES = [[912,300],[640,300],[340,260],[280,240],[1200,300]];
T("the bob never leaves the canvas, at any arc, at any size", () => {
  SIZES.forEach(([w,h]) => {
    [0.3, 0.62, 0.8, 1.0, 1.2].forEach(tmax => {
      const L = E.layout(w,h,tmax);
      for (let e = 0; e <= 4; e += 0.01) {
        const y = L.py + L.L * Math.sin(E.theta(e, tmax));
        ok(y - L.bob >= 0 && y + L.bob <= h,
           `w=${w} h=${h} arc=${tmax} e=${e.toFixed(2)} -> y=${y.toFixed(1)} outside 0..${h}`);
      }
    });
  });
});
T("full extension uses most of the available height without touching the edge", () => {
  const L = E.layout(912, 300, 0.62);
  const frac = L.reach / (300/2 - L.bob);
  ok(frac > 0.45 && frac < 0.9, "swing should fill 45-90% of the half canvas, got " + frac.toFixed(2));
});
T("a normal stroke passes only just beyond the strings", () => {
  // on a guitar: strings span ~5cm, a relaxed stroke goes 2-3cm past each end
  SIZES.forEach(([w,h]) => {
    const L = E.layout(w, h, E.REF_ARC);
    const ratio = L.reach / L.block;
    ok(ratio > 1.05 && ratio < 1.45,
       `travel:strings should be ~1.2x at the reference arc, got ${ratio.toFixed(2)}x at ${w}x${h}`);
  });
});
T("the overhang past the outer string is a fraction of the string block", () => {
  const L = E.layout(912, 300, E.REF_ARC);
  const overhang = L.reach - L.block / 2;      // past the outer string, not the centre
  ok(overhang > 0, "the stroke must clear the strings");
  ok(overhang < L.block * 0.9, "overhang should be under one string block, got " + (overhang/L.block).toFixed(2));
});
T("widening the arc grows the swing without shrinking the guitar", () => {
  const a = E.layout(912,300,E.REF_ARC), b = E.layout(912,300,1.0);
  close(a.block, b.block, 1e-9);               // the instrument does not change size
  close(a.gap, b.gap, 1e-9);
  ok(b.reach / b.block > 1.6, "oversized arc should read as clearly beyond normal");
});
T("the oversized arc drill really does look bigger", () => {
  const a = E.layout(912,300,0.62), b = E.layout(912,300,1.0);
  ok(b.reach > a.reach * 1.3, "oversized arc should be visibly wider");
});
T("the widest arc a drill may request still fits the canvas", () => {
  E.DRILLS.forEach(d => {
    const tmax = d.arc || 0.62;
    ok(tmax <= E.MAX_ARC, d.title + " asks for an arc beyond MAX_ARC");
    const L = E.layout(912,300,tmax);
    ok(L.py + L.reach + L.bob <= 300, d.title + " would clip");
  });
});
T("the arm stays positive and the strings stay on screen on a narrow phone", () => {
  const L = E.layout(300, 240, 0.62);
  ok(L.L >= 80); ok(L.right > L.left); ok(L.right <= 300);
});
T("string block is centred on the pivot height", () => {
  const L = E.layout(912,300,0.62);
  const top = L.py - L.block/2, bot = top + (L.strings-1)*L.gap;
  close((top+bot)/2, L.py, 1e-9);
});
T("layout is deterministic", () => {
  deepEq(E.layout(912,300,0.62), E.layout(912,300,0.62));
});

/* ============================================================ 12. SUBDIVISIONS */
const DIVS = ["8","16","12"];
const withDiv = (div, o) => Object.assign({ bpm: 60, click: "beats", countIn: false, div,
  pattern: E.defaultPattern(div) }, o);

T("the three subdivisions have the right shape", () => {
  eq(E.divisionOf("8").cells, 8);   eq(E.divisionOf("8").perBeat, 2);
  eq(E.divisionOf("16").cells, 16); eq(E.divisionOf("16").perBeat, 4);
  eq(E.divisionOf("12").cells, 12); eq(E.divisionOf("12").perBeat, 3);
  DIVS.forEach(d => eq(E.divisionOf(d).cells, E.divisionOf(d).perBeat * 4));
});
T("every subdivision labels all of its cells", () => {
  DIVS.forEach(d => eq(E.divisionOf(d).counts.length, E.divisionOf(d).cells));
});
T("counts read the way players say them", () => {
  deepEq(E.divisionOf("16").counts.slice(0,4), ["1","e","&","a"]);
  deepEq(E.divisionOf("12").counts.slice(0,3), ["1","t","l"]);
  deepEq(E.divisionOf("8").counts.slice(0,2), ["1","&"]);
});
T("an unknown subdivision falls back to 8ths rather than throwing", () => {
  eq(E.divisionOf("7").cells, 8);
  eq(E.divisionOf(undefined).cells, 8);
});
T("subdivision duration divides the beat correctly", () => {
  close(E.subDur(60, "8"),  0.5);      // 2 per beat
  close(E.subDur(60, "16"), 0.25);     // 4 per beat
  close(E.subDur(60, "12"), 1/3);      // 3 per beat
  close(E.subDur(90, "12"), (60/90)/3);
});
T("subDur with no argument matches the old eighthDur", () => {
  [50, 60, 88, 140].forEach(b => close(E.subDur(b), E.eighthDur(b)));
});
T("a bar lasts the same wall-clock time in every subdivision", () => {
  DIVS.forEach(div => {
    const d = withDiv(div);
    close(E.timeOfNote(E.divisionOf(div).cells, d), 4 * (60/60), 1e-9);   // 4 beats
  });
});
T("beat 1 of bar 2 lands at the same moment in every subdivision", () => {
  const t = DIVS.map(div => E.timeOfNote(E.divisionOf(div).cells, withDiv(div)));
  close(t[0], t[1], 1e-9); close(t[1], t[2], 1e-9);
});
T("16ths alternate down-up so downs land on the beat and the &", () => {
  const dirs = E.divisionOf("16").counts.map((c,i) => E.dirOf(i));
  deepEq(dirs.slice(0,4), ["d","u","d","u"]);       // 1 e & a
  eq(E.dirOf(0), "d"); eq(E.dirOf(2), "d");         // "1" and "&" are downstrokes
  eq(E.dirOf(1), "u"); eq(E.dirOf(3), "u");         // "e" and "a" are upstrokes
});
T("triplets make beat 2 start on an upstroke, and realign every two beats", () => {
  eq(E.dirOf(0), "d");   // beat 1
  eq(E.dirOf(3), "u");   // beat 2 — odd strokes per beat flips the hand
  eq(E.dirOf(6), "d");   // beat 3
  eq(E.dirOf(9), "u");   // beat 4
  eq(E.dirOf(12), "d");  // next bar starts down again: 12 cells is even
});
T("every subdivision loops cleanly, i.e. the bar length is even", () => {
  DIVS.forEach(d => eq(E.divisionOf(d).cells % 2, 0, "subdivision " + d + " would flip hands each bar"));
});
T("default patterns are the right length for their subdivision", () => {
  DIVS.forEach(d => eq(E.defaultPattern(d).length, E.divisionOf(d).cells));
  deepEq(E.defaultPattern("8"), FULL);
  ok(E.defaultPattern("16").every(v => v === 1));
  ok(E.defaultPattern("12").every(v => v === 1));
});
T("defaultPattern returns a fresh array each time", () => {
  const a = E.defaultPattern("8"); a[0] = 0;
  eq(E.defaultPattern("8")[0], 1);
  eq(FULL[0], 1, "the shared constant must not be mutated");
});

/* --- click modes across subdivisions --- */
const idxD = (mode, div, bar = 0) =>
  Array.from({length: E.divisionOf(div).cells}, (_,i) => i).filter(i => E.wantsClick(mode, i, bar, div));
T("beats fire four times a bar in every subdivision", () => {
  deepEq(idxD("beats","8"),  [0,2,4,6]);
  deepEq(idxD("beats","16"), [0,4,8,12]);
  deepEq(idxD("beats","12"), [0,3,6,9]);
});
T("2-and-4 lands on the real beats 2 and 4 in every subdivision", () => {
  deepEq(idxD("24","8"),  [2,6]);
  deepEq(idxD("24","16"), [4,12]);
  deepEq(idxD("24","12"), [3,9]);
});
T("the offbeat mode marks the upbeat of each beat", () => {
  deepEq(idxD("off","8"),  [1,3,5,7]);          // the &s
  deepEq(idxD("off","16"), [2,6,10,14]);        // the &s again, not e or a
  deepEq(idxD("off","12"), [1,4,7,10]);         // middle of each triplet
});
T("burst mode marks the last three strokes of the bar", () => {
  deepEq(idxD("burst","8"),  [5,6,7]);
  deepEq(idxD("burst","16"), [13,14,15]);
  deepEq(idxD("burst","12"), [9,10,11]);
});
T("all, one and none behave in every subdivision", () => {
  DIVS.forEach(div => {
    eq(idxD("all8",div).length, E.divisionOf(div).cells);
    deepEq(idxD("one",div), [0]);
    deepEq(idxD("none",div), []);
  });
});
T("dropout still silences bars 3 and 4 in every subdivision", () => {
  DIVS.forEach(div => {
    eq(idxD("drop",div,0).length, 4);
    eq(idxD("drop",div,2).length, 0);
  });
});

/* --- events and simulation --- */
T("the count-in is one bar of four clicks in every subdivision", () => {
  DIVS.forEach(div => {
    const d = withDiv(div, { countIn: true, playback: true });
    const cells = E.divisionOf(div).cells;
    let clicks = 0, strums = 0;
    for (let n = -cells; n < 0; n++)
      E.eventsForNote(n, d).forEach(e => e.type === "click" ? clicks++ : strums++);
    eq(clicks, 4, "subdivision " + div);
    eq(strums, 0, "subdivision " + div);
  });
});
T("the count-in opens with an accent in every subdivision", () => {
  DIVS.forEach(div => {
    const d = withDiv(div, { countIn: true });
    eq(E.eventsForNote(-E.divisionOf(div).cells, d)[0].kind, "accent");
  });
});
T("bar boundaries fall at the right note number", () => {
  DIVS.forEach(div => {
    const d = withDiv(div, { click: "one" });
    const cells = E.divisionOf(div).cells;
    eq(E.eventsForNote(0, d).length, 1);
    eq(E.eventsForNote(cells, d).length, 1);       // beat 1 of bar 2
    eq(E.eventsForNote(cells - 1, d).length, 0);
  });
});
T("a bar of continuous 16ths plays sixteen strums", () => {
  const d = withDiv("16", { click: "none", playback: true });
  eq(E.simulate(d, 1).flatMap(r => r.events).filter(e => e.type === "strum").length, 16);
});
T("a bar of continuous triplets plays twelve strums, alternating throughout", () => {
  const d = withDiv("12", { click: "none", playback: true });
  const dirs = E.simulate(d, 1).flatMap(r => r.events).map(e => e.dir);
  eq(dirs.length, 12);
  deepEq(dirs.slice(0,6), ["d","u","d","u","d","u"]);
});
T("simulate returns one row per cell in every subdivision", () => {
  DIVS.forEach(div => {
    const cells = E.divisionOf(div).cells;
    eq(E.simulate(withDiv(div, { countIn: true }), 3).length, cells + 3 * cells);
  });
});
T("triplet timestamps are evenly spaced", () => {
  const rows = E.simulate(withDiv("12"), 1);
  const gaps = rows.slice(1).map((r,i) => r.t - rows[i].t);
  gaps.forEach(g => close(g, 1/3, 1e-9));
});

/* --- geometry and freeze carry over --- */
T("the pendulum still crosses the strings on every subdivision", () => {
  DIVS.forEach(div => {
    for (let n = 0; n < E.divisionOf(div).cells; n++) close(E.theta(n, 0.62), 0, 1e-12);
  });
});
T("freezes stay at full extension in every subdivision", () => {
  DIVS.forEach(div => {
    const d = withDiv(div, { freeze: { mode: "random" } });
    E.freezeSchedule(11, 25, d).forEach(e => close(e % 1, 0.5, 1e-9));
  });
});
T("freeze spacing is 2-5 bars measured in that subdivision's bars", () => {
  DIVS.forEach(div => {
    const cells = E.divisionOf(div).cells;
    [11, 404, 7777].forEach(seed => {
      const s = E.freezeSchedule(seed, 40, withDiv(div, { freeze: { mode: "random" } }));
      for (let i = 1; i < s.length; i++) {
        ok(s[i] > s[i-1], "not increasing at " + div);
        const gap = Math.floor(s[i]/cells) - Math.floor(s[i-1]/cells);
        ok(gap >= 2 && gap <= 5, `subdivision ${div}: bar gap ${gap} outside 2-5`);
      }
    });
  });
});
T("freezes can land anywhere in the bar, including the second half", () => {
  DIVS.forEach(div => {
    const cells = E.divisionOf(div).cells;
    const hit = new Set(E.freezeSchedule(3, 300, withDiv(div, { freeze: { mode: "random" } }))
      .map(e => Math.floor(e) % cells));
    ok(hit.size >= cells - 1, `subdivision ${div} only reaches ${hit.size} of ${cells} cells`);
    ok(Math.max(...hit) === cells - 1, `subdivision ${div} never reaches the last cell`);
  });
});
T("the end-of-bar freeze targets the last cell of the bar in every subdivision", () => {
  DIVS.forEach(div => {
    const cells = E.divisionOf(div).cells;
    const d = withDiv(div, { freeze: { at: "end" } });
    E.freezeSchedule(0, 5, d).forEach(e => eq(Math.floor(e) % cells, cells - 1));
  });
});
T("freezeInfo names the right count in each subdivision", () => {
  eq(E.freezeInfo(1.5, "16").count, "e");
  eq(E.freezeInfo(2.5, "16").count, "&");
  eq(E.freezeInfo(3.5, "16").count, "a");
  eq(E.freezeInfo(1.5, "12").count, "t");
  eq(E.freezeInfo(2.5, "12").count, "l");
  eq(E.freezeInfo(1.5).count, "&");            // defaults to 8ths
});
T("freezeInfo side still agrees with the pendulum in every subdivision", () => {
  DIVS.forEach(div => {
    for (let n = 0; n < 24; n++) eq(E.freezeInfo(n + 0.5, div).side, E.handSide(n + 0.5));
  });
});

/* --- the existing drills are untouched --- */
T("every shipped drill is still an 8th-note drill", () => {
  E.DRILLS.forEach(d => ok(d.div === undefined || String(d.div) === "8", d.title));
});
T("every shipped drill still validates under the generalised rules", () => {
  E.DRILLS.forEach(d => eq(E.validateDrill(d).length, 0, d.title));
});
T("validation checks pattern length against the drill's own subdivision", () => {
  const g = o => E.validateDrill(Object.assign({ key:"z", title:"x", why:"y", click:"beats", bpm:60 }, o));
  eq(g({ pattern: FULL }).length, 0);                              // 8 cells, 8ths
  ok(g({ div:"16", pattern: FULL }).length > 0);                   // 8 cells in a 16th drill
  eq(g({ div:"16", pattern: E.defaultPattern("16") }).length, 0);
  eq(g({ div:"12", pattern: E.defaultPattern("12") }).length, 0);
  ok(g({ div:"5", pattern: FULL }).length > 0);                    // no such subdivision
});

report();
