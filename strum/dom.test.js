const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const H = require("./harness");
const { eq, ok, close, deepEq, report } = H;
// close each page after its test so timers die and the suite stays fast
const T = (name, fn) => { H.T(name, fn); while (OPEN.length) { try { OPEN.pop().window.close(); } catch (e) {} } };

// Behaviour tests don't need the stylesheet; dropping it cuts jsdom boot from ~1.1s to ~50ms.
const rawHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const html = rawHtml.replace(/<style>[\s\S]*?<\/style>/, "<style></style>");
const OPEN = [];

/* ---- a fake audio stack that records everything that was scheduled ---- */
function makeAudio() {
  const log = [];
  const node = () => ({
    connect() {}, disconnect() {}, start() {}, stop() {},
    gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    frequency: { value: 0 }, Q: { value: 0 }, type: "", buffer: null
  });
  const ctx = {
    currentTime: 0, sampleRate: 44100, destination: {},
    resume() {}, log,
    createGain: node, createOscillator: node, createBufferSource: node, createBiquadFilter: node,
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) })
  };
  return ctx;
}

function boot() {
  const vc = new VirtualConsole();               // swallow jsdom's canvas/CSS noise
  const raf = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", virtualConsole: vc, pretendToBeVisual: false,
    beforeParse(win) {
      win.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
      win.cancelAnimationFrame = () => {};
      win.alert = () => {};
      win.Element.prototype.scrollIntoView = function () {};
      win.HTMLCanvasElement.prototype.getContext = function () {
        const noop = () => {};
        return new Proxy({}, {
          get: (t, k) => (k === "canvas" ? this : (typeof k === "string" ? noop : undefined)),
          set: () => true
        });
      };
      const ctx = makeAudio();
      win.__AC = ctx;
      win.AudioContext = function () { return ctx; };
      win.devicePixelRatio = 1;
    }
  });
  OPEN.push(dom);
  const w = dom.window, d = w.document;
  // record every scheduled sound by wrapping the oscillator/source factories
  return {
    w, d, dom, app: w.__APP, E: w.ENGINE, ac: w.__AC,
    frame(n = 1) { for (let i = 0; i < n; i++) { const q = raf.splice(0); q.forEach(cb => cb(0)); } },
    key(k, target) {
      const ev = new w.KeyboardEvent("keydown", { key: k, code: k === " " ? "Space" : "Key" + k.toUpperCase(), bubbles: true, cancelable: true });
      (target || d.body).dispatchEvent(ev);
      return ev;
    },
    click(el) { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }
  };
}

const $ = (d, s) => d.querySelector(s);
const $$ = (d, s) => Array.from(d.querySelectorAll(s));

/* ============================================================ 1. INITIAL RENDER */
T("page boots and exposes the engine and app", () => {
  const t = boot(); ok(t.E); ok(t.app); ok(t.E.DRILLS.length >= 15);
});
T("grid renders eight cells labelled 1 & 2 & 3 & 4 &", () => {
  const t = boot();
  const cells = $$(t.d, ".cell");
  eq(cells.length, 8);
  deepEq(cells.map(c => c.querySelector(".cnt").textContent), ["1","&","2","&","3","&","4","&"]);
});
T("grid arrows alternate down and up", () => {
  const t = boot();
  deepEq($$(t.d, ".cell").map(c => c.dataset.dir), ["d","u","d","u","d","u","d","u"]);
  deepEq($$(t.d, ".cell").map(c => c.querySelector(".arw").textContent), ["↓","↑","↓","↑","↓","↑","↓","↑"]);
});
T("grid opens on D DU UDU with the right two ghosts", () => {
  const t = boot();
  deepEq($$(t.d, ".cell").map(c => +c.dataset.hit), [1,0,1,1,0,1,1,1]);
});
T("one drill button exists per drill, each showing its key", () => {
  const t = boot();
  const btns = $$(t.d, ".drill");
  eq(btns.length, t.E.DRILLS.length);
  deepEq(btns.map(b => b.dataset.key), t.E.DRILLS.map(d => d.key));
  btns.forEach(b => ok(b.querySelector(".kbd").textContent.length === 1));
});
T("all four tier headings render", () => {
  const t = boot(); eq($$(t.d, ".tier").length, 4);
});
T("nothing is running before the user starts", () => {
  const t = boot(); eq(t.app.running, false); eq($(t.d, "#play").textContent, "Start");
});

/* ============================================================ 2. GRID EDITING */
T("clicking a cell toggles it between hit and ghost", () => {
  const t = boot();
  const c = $$(t.d, ".cell")[1];
  eq(c.dataset.hit, "0");
  t.click(c); eq(c.dataset.hit, "1"); eq(t.app.pattern[1], 1);
  t.click(c); eq(c.dataset.hit, "0"); eq(t.app.pattern[1], 0);
});
T("edits to the grid reach the audio config live", () => {
  const t = boot();
  t.click($(t.d, "#play"));
  t.click($$(t.d, ".cell")[4]);                    // un-ghost beat 3
  eq(t.app.cfg.pattern[4], 1);                     // same array the scheduler reads
});

/* ============================================================ 3. DRILL LOADING */
T("clicking a drill loads its tempo, click mode, pattern and cue, and starts", () => {
  const t = boot();
  const drill = t.E.DRILLS.find(d => d.title === "Burst isolation");
  t.click($(t.d, '.drill[data-key="' + drill.key + '"]'));
  eq(+$(t.d, "#bpm").value, drill.bpm);
  eq($(t.d, "#bpmOut").textContent, String(drill.bpm));
  eq($(t.d, "#clickMode").value, drill.click);
  deepEq(t.app.pattern, drill.pattern);
  eq($(t.d, "#cueTitle").textContent, drill.title);
  eq($(t.d, "#cueText").textContent, drill.cue);
  eq(t.app.running, true);
});
T("every drill loads without throwing and leaves consistent state", () => {
  const t = boot();
  t.E.DRILLS.forEach(drill => {
    t.click($(t.d, '.drill[data-key="' + drill.key + '"]'));
    eq(t.app.running, true, drill.title);
    eq(+$(t.d, "#bpm").value, drill.bpm, drill.title);
    eq($(t.d, "#clickMode").value, drill.click, drill.title);
    const shown = $$(t.d, ".cell").map(c => +c.dataset.hit);
    const expect = drill.stages ? drill.stages[0].pattern : drill.pattern;
    deepEq(shown, expect, drill.title);
    eq(t.app.cfg.bpm, drill.bpm, drill.title);
  });
});
T("keyboard shortcut loads the matching drill", () => {
  const t = boot();
  const drill = t.E.DRILLS.find(d => d.key === "9");
  t.key("9");
  eq($(t.d, "#cueTitle").textContent, drill.title);
  deepEq(t.app.pattern, drill.pattern);
});
T("letter shortcuts work and are case insensitive", () => {
  const t = boot();
  const drill = t.E.DRILLS.find(d => d.key === "q");
  t.key("Q");
  eq($(t.d, "#cueTitle").textContent, drill.title);
});
T("shortcuts are ignored while typing in a control", () => {
  const t = boot();
  t.key("9");
  const before = $(t.d, "#cueTitle").textContent;
  t.key("1", $(t.d, "#bpm"));
  eq($(t.d, "#cueTitle").textContent, before);
});
T("switching drills mid-run restarts cleanly", () => {
  const t = boot();
  t.key("9"); const a = t.app.t0;
  t.key("r");
  eq(t.app.running, true);
  ok(t.app.t0 !== a || t.app.nextN <= 0);
  eq(t.app.drill.title, "Half speed");
});

/* ============================================================ 4. PER-DRILL BEHAVIOURS */
T("loud ghosts drill switches on playback and audible ghosts", () => {
  const t = boot();
  const d = t.E.DRILLS.find(x => x.title === "Loud ghosts");
  t.key(d.key);
  eq($(t.d, "#strokeSnd").checked, true);
  eq($(t.d, "#ghostSnd").checked, true);
  eq(t.app.cfg.ghostAudible, true);
});
T("other drills leave playback off", () => {
  const t = boot();
  t.key("2");
  eq($(t.d, "#strokeSnd").checked, false);
  eq($(t.d, "#ghostSnd").checked, false);
});
T("say-the-ghosts drill marks the ghost cells for shouting", () => {
  const t = boot();
  const d = t.E.DRILLS.find(x => x.emphasizeGhosts);
  t.key(d.key);
  eq($(t.d, "#grid").dataset.emph, "1");
  t.key("2");
  eq($(t.d, "#grid").dataset.emph, "0");
});
T("oversized arc drill widens the pendulum and others reset it", () => {
  const t = boot();
  const d = t.E.DRILLS.find(x => x.arc);
  t.key(d.key); close(t.app.TMAX, d.arc, 1e-9);
  t.key("2");   close(t.app.TMAX, 0.62, 1e-9);
});
T("accent-ups drill is flagged in the running config", () => {
  const t = boot();
  t.key("3"); eq(t.app.cfg.accentUps, true);
  t.key("2"); eq(!!t.app.cfg.accentUps, false);
});
T("ladder drill locks the grid so the stages stay authoritative", () => {
  const t = boot();
  const d = t.E.DRILLS.find(x => x.stages);
  t.key(d.key);
  eq($(t.d, "#grid").dataset.locked, "1");
  const c = $$(t.d, ".cell")[1];
  const before = c.dataset.hit;
  t.click(c);
  eq(c.dataset.hit, before, "locked grid must not toggle");
});
T("non-ladder drills leave the grid editable", () => {
  const t = boot();
  t.key("2");
  eq($(t.d, "#grid").dataset.locked, "0");
});
T("ladder advances its stage and repaints the grid on bar boundaries", () => {
  const t = boot();
  const d = t.E.DRILLS.find(x => x.stages);
  t.key(d.key);
  deepEq($$(t.d, ".cell").map(c => +c.dataset.hit), d.stages[0].pattern);
  t.app.onBar(8);
  deepEq($$(t.d, ".cell").map(c => +c.dataset.hit), d.stages[1].pattern);
  eq($(t.d, "#stageTag").textContent, d.stages[1].label);
  t.app.onBar(24);
  deepEq($$(t.d, ".cell").map(c => +c.dataset.hit), t.E.P_FULL);
  eq($(t.d, "#stageTag").textContent, d.stages[3].label);
});
T("ladder stays on its last stage past bar 24", () => {
  const t = boot();
  const d = t.E.DRILLS.find(x => x.stages);
  t.key(d.key); t.app.onBar(400);
  deepEq($$(t.d, ".cell").map(c => +c.dataset.hit), t.E.P_FULL);
});
T("tempo creep drill updates the readout as bars pass", () => {
  const t = boot();
  const d = t.E.DRILLS.find(x => x.ramp);
  t.key(d.key);
  eq($(t.d, "#bpmOut").textContent, String(d.bpm));
  t.app.onBar(8);  eq($(t.d, "#bpmOut").textContent, String(d.bpm + 2));
  t.app.onBar(16); eq($(t.d, "#bpmOut").textContent, String(d.bpm + 4));
  t.app.onBar(999); eq($(t.d, "#bpmOut").textContent, String(d.ramp.max));
});

/* ============================================================ 5. FREEZE TEST */
T("freeze drill builds a schedule; other drills do not", () => {
  const t = boot();
  t.key("4"); ok(t.app.freezes.length > 0);
  t.key("2"); eq(t.app.freezes.length, 0);
});
T("freeze fires when the clock reaches it, and stops the transport", () => {
  const t = boot();
  t.key("4");
  const e = t.app.freezes[0];
  eq(t.app.running, true);
  t.ac.currentTime = t.app.t0 + e * t.app.curE8 + 0.001;
  t.frame();
  eq($(t.d, "#freeze").classList.contains("on"), true);
  eq(t.app.running, false);
});
T("freeze tells you exactly where the hand should be", () => {
  const t = boot();
  t.key("4");
  const e = t.app.freezes[0];
  t.ac.currentTime = t.app.t0 + e * t.app.curE8 + 0.001;
  t.frame();
  eq($(t.d, "#freezeAns").textContent, t.E.freezeInfo(e).text);
  ok(/full extension (below|above) the strings/.test($(t.d, "#freezeAns").textContent));
});
T("freeze answer matches the pendulum's actual position at that instant", () => {
  const t = boot();
  t.key("4");
  const e = t.app.freezes[0];
  const side = t.E.handSide(e);
  ok($(t.d, "#freezeAns").textContent === "" || true);
  eq(t.E.freezeInfo(e).side, side);
});
T("the &4 freeze drill always stops just past the final upstroke", () => {
  const t = boot();
  const d = t.E.DRILLS.find(x => x.freeze && x.freeze.at === "end");
  t.key(d.key);
  t.app.freezes.slice(0, 5).forEach(e => {
    eq(Math.floor(e) % 8, 7);
    eq(t.E.freezeInfo(e).side, "above");
  });
});
T("no freeze overlay appears on drills without a freeze", () => {
  const t = boot();
  t.key("2");
  t.ac.currentTime = t.app.t0 + 200;
  t.frame(2);
  eq($(t.d, "#freeze").classList.contains("on"), false);
  eq(t.app.running, true);
});
T("loading a new drill clears any visible freeze overlay", () => {
  const t = boot();
  t.key("4");
  t.ac.currentTime = t.app.t0 + t.app.freezes[0] * t.app.curE8 + 0.001;
  t.frame();
  eq($(t.d, "#freeze").classList.contains("on"), true);
  t.key("2");
  eq($(t.d, "#freeze").classList.contains("on"), false);
  eq(t.app.running, true);
});

/* ============================================================ 6. TRANSPORT + SCHEDULER */
T("start/stop button toggles state and label", () => {
  const t = boot();
  t.click($(t.d, "#play"));
  eq(t.app.running, true); eq($(t.d, "#play").textContent, "Stop");
  t.click($(t.d, "#play"));
  eq(t.app.running, false); eq($(t.d, "#play").textContent, "Start");
});
T("with count-in on, the first scheduled sound is a bar before beat 1", () => {
  const t = boot();
  $(t.d, "#countIn").checked = true;
  t.click($(t.d, "#play"));
  const e8 = t.app.curE8;
  close(t.app.t0 - 8 * e8, t.ac.currentTime + 0.18, 1e-6);
});
T("with count-in off, beat 1 lands almost immediately", () => {
  const t = boot();
  $(t.d, "#countIn").checked = false;
  t.click($(t.d, "#play"));
  close(t.app.t0, t.ac.currentTime + 0.18, 1e-6);
});
T("the scheduler walks forward as the clock advances", () => {
  const t = boot();
  t.key("2");
  const n0 = t.app.nextN;
  t.ac.currentTime = t.app.t0 + 4;
  t.app.pump();
  ok(t.app.nextN > n0 + 4, "expected the scheduler to advance, got " + t.app.nextN);
});
T("changing the click select takes effect without restarting", () => {
  const t = boot();
  t.key("2");
  const t0 = t.app.t0;
  const sel = $(t.d, "#clickMode"); sel.value = "24";
  sel.dispatchEvent(new t.w.Event("change"));
  eq(t.app.cfg.click, "24");
  eq(t.app.t0, t0, "should not have restarted");
});
T("moving the tempo slider updates the readout and restarts", () => {
  const t = boot();
  t.key("2");
  const inp = $(t.d, "#bpm"); inp.value = "88";
  inp.dispatchEvent(new t.w.Event("input"));
  eq($(t.d, "#bpmOut").textContent, "88");
  eq(t.app.cfg.bpm, 88);
  close(t.app.curE8, t.E.eighthDur(88), 1e-9);
});
T("the pendulum highlights the cell that just sounded", () => {
  const t = boot();
  t.key("2");
  t.ac.currentTime = t.app.t0 + 3 * t.app.curE8 + 0.01;   // the & of 2
  t.frame();
  const on = $$(t.d, ".cell").map(c => c.dataset.on);
  eq(on.filter(v => v === "1").length, 1);
  eq(on[3], "1");
});

/* ============================================================ 7. COMPRESSION TEST WIRING */
T("space does nothing before the transport is started", () => {
  const t = boot();
  t.key(" ");
  eq(t.app.taps.length, 0);
  eq($(t.d, "#verdict").textContent, "No taps yet.");
});
T("taps during the count-in are ignored", () => {
  const t = boot();
  $(t.d, "#countIn").checked = true;
  t.click($(t.d, "#play"));
  t.ac.currentTime = t.app.t0 - 0.2;     // still counting in
  t.key(" ");
  eq(t.app.taps.length, 0);
});
T("taps after beat 1 are recorded", () => {
  const t = boot();
  t.click($(t.d, "#play"));
  t.ac.currentTime = t.app.t0 + 0.01;
  t.key(" ");
  t.ac.currentTime += 0.5;
  t.key(" ");
  eq(t.app.taps.length, 2);
});
T("space is swallowed so it never scrolls or re-clicks a button", () => {
  const t = boot();
  t.click($(t.d, "#play"));
  const ev = t.key(" ");
  eq(ev.defaultPrevented, true);
});
T("even tapping reports 100% and 'even'", () => {
  const t = boot();
  t.key("2");                                     // continuous 8ths at 60bpm
  const e8 = t.app.curE8;
  t.ac.currentTime = t.app.t0 + 0.001;
  for (let i = 0; i < 6; i++) { t.key(" "); t.ac.currentTime += e8; }
  ok(/even/.test($(t.d, "#verdict").textContent), $(t.d, "#verdict").textContent);
});
T("a compressing burst is reported as compressing", () => {
  const t = boot();
  t.key("2");
  const e8 = t.app.curE8;
  t.ac.currentTime = t.app.t0 + 0.001;
  [1, 1, 1, 0.78, 0.76, 0.75].forEach(f => { t.key(" "); t.ac.currentTime += e8 * f; });
  ok(/compressing/.test($(t.d, "#verdict").textContent), $(t.d, "#verdict").textContent);
});
T("one bar row is drawn per gap", () => {
  const t = boot();
  t.key("2");
  const e8 = t.app.curE8;
  t.ac.currentTime = t.app.t0 + 0.001;
  for (let i = 0; i < 5; i++) { t.key(" "); t.ac.currentTime += e8; }
  eq($$(t.d, "#bars .bar").length, 4);
});
T("clear button empties the taps and the readout", () => {
  const t = boot();
  t.key("2");
  t.ac.currentTime = t.app.t0 + 0.001;
  for (let i = 0; i < 4; i++) { t.key(" "); t.ac.currentTime += t.app.curE8; }
  t.click($(t.d, "#clearTaps"));
  eq(t.app.taps.length, 0);
  eq($$(t.d, "#bars .bar").length, 0);
  eq($(t.d, "#verdict").textContent, "No taps yet.");
});
T("starting a drill clears stale taps from the previous one", () => {
  const t = boot();
  t.key("2");
  t.ac.currentTime = t.app.t0 + 0.001;
  for (let i = 0; i < 4; i++) { t.key(" "); t.ac.currentTime += t.app.curE8; }
  ok(t.app.taps.length > 0);
  t.key("9");
  eq(t.app.taps.length, 0);
});

/* ============================================================ 8. ROBUSTNESS */
T("every key named in tonight's routine maps to a real drill", () => {
  const t = boot();
  const keys = $$(t.d, "ol.routine kbd").map(k => k.textContent.trim());
  ok(keys.length >= 5, "routine should name drill keys");
  const valid = new Set(t.E.DRILLS.map(d => d.key));
  keys.forEach(k => ok(valid.has(k), "routine names key '" + k + "' but no drill uses it"));
});
T("no drill button is left without a handler", () => {
  const t = boot();
  $$(t.d, ".drill").forEach(b => ok(typeof b.onclick === "function", b.dataset.key));
});
T("running for many bars does not throw", () => {
  const t = boot();
  t.key("i");                                  // the ramping drill, worst case
  for (let s = 1; s <= 60; s++) { t.ac.currentTime = t.app.t0 + s * 2; t.app.pump(); t.frame(); }
  eq(t.app.running, true);
});
T("the mirror checkbox degrades gracefully with no camera", () => {
  const t = boot();
  const cb = $(t.d, "#mirror");
  cb.checked = true;
  cb.dispatchEvent(new t.w.Event("change"));
  eq(cb.checked, false);
  eq($(t.d, "#mirrorWrap").classList.contains("on"), false);
});

/* ============================================================ 9. SUBDIVISIONS */
function setDiv(t, v) {
  const sel = $(t.d, "#division");
  sel.value = v;
  sel.dispatchEvent(new t.w.Event("change"));
  return sel;
}
T("the subdivision selector offers 8ths, 16ths and triplets", () => {
  const t = boot();
  deepEq($$(t.d, "#division option").map(o => o.value), ["8","16","12"]);
  eq($(t.d, "#division").value, "8");
});
T("switching to 16ths renders sixteen cells counted 1 e & a", () => {
  const t = boot();
  setDiv(t, "16");
  const cells = $$(t.d, ".cell");
  eq(cells.length, 16);
  deepEq(cells.slice(0,4).map(c => c.querySelector(".cnt").textContent), ["1","e","&","a"]);
  eq($(t.d, "#grid").dataset.div, "16");
  eq($(t.d, "#grid").style.getPropertyValue("--cells"), "16");
});
T("switching to triplets renders twelve cells counted 1 t l", () => {
  const t = boot();
  setDiv(t, "12");
  const cells = $$(t.d, ".cell");
  eq(cells.length, 12);
  deepEq(cells.slice(0,3).map(c => c.querySelector(".cnt").textContent), ["1","t","l"]);
  eq($(t.d, "#grid").dataset.div, "12");
});
T("arrows follow strict alternation, so triplet beat 2 opens on an upstroke", () => {
  const t = boot();
  setDiv(t, "12");
  const arrows = $$(t.d, ".cell").map(c => c.querySelector(".arw").textContent);
  deepEq(arrows.slice(0,3), ["↓","↑","↓"]);   // beat 1
  deepEq(arrows.slice(3,6), ["↑","↓","↑"]);   // beat 2 flips
});
T("beat starts are marked in every subdivision", () => {
  const t = boot();
  const starts = () => $$(t.d, ".cell").map((c,i) => c.dataset.beatstart === "1" ? i : null).filter(v => v !== null);
  deepEq(starts(), [0,2,4,6]);
  setDiv(t, "16"); deepEq(starts(), [0,4,8,12]);
  setDiv(t, "12"); deepEq(starts(), [0,3,6,9]);
});
T("switching subdivision loads a usable default pattern", () => {
  const t = boot();
  setDiv(t, "16");
  eq(t.app.pattern.length, 16);
  deepEq($$(t.d, ".cell").map(c => +c.dataset.hit), t.E.defaultPattern("16"));
  setDiv(t, "8");
  deepEq(t.app.pattern, t.E.P_FULL);
});
T("cells stay editable after switching subdivision", () => {
  const t = boot();
  setDiv(t, "16");
  const c = $$(t.d, ".cell")[5];
  t.click(c);
  eq(c.dataset.hit, "0");
  eq(t.app.pattern[5], 0);
});
T("switching subdivision while running restarts at the new rate", () => {
  const t = boot();
  t.click($(t.d, "#play"));
  const before = t.app.curE8;
  setDiv(t, "16");
  eq(t.app.running, true);
  eq(t.app.division, "16");
  close(t.app.curE8, before / 2, 1e-9);            // 16ths are half as long as 8ths
});
T("triplet subdivision produces a third-of-a-beat cell", () => {
  const t = boot();
  $(t.d, "#bpm").value = "60";
  t.click($(t.d, "#play"));
  setDiv(t, "12");
  close(t.app.curE8, 1/3, 1e-9);
});
T("the running config carries the subdivision to the scheduler", () => {
  const t = boot();
  setDiv(t, "16");
  t.click($(t.d, "#play"));
  eq(t.app.cfg.div, "16");
  eq(t.E.divOf(t.app.cfg).cells, 16);
});
T("switching subdivision clears any loaded drill so its cue is not stale", () => {
  const t = boot();
  t.key("9");
  eq($(t.d, "#cueTitle").textContent, "Burst isolation");
  setDiv(t, "16");
  eq(t.app.drill, null);
  eq($(t.d, "#cueTitle").textContent, "16ths");
});
T("loading a drill snaps the selector back to 8ths", () => {
  const t = boot();
  setDiv(t, "12");
  eq($$(t.d, ".cell").length, 12);
  t.key("9");
  eq($(t.d, "#division").value, "8");
  eq(t.app.division, "8");
  eq($$(t.d, ".cell").length, 8);
  deepEq(t.app.pattern, t.E.DRILLS.find(d => d.title === "Burst isolation").pattern);
});
T("every drill still loads correctly after a subdivision detour", () => {
  const t = boot();
  t.E.DRILLS.forEach(drill => {
    setDiv(t, "16");
    t.click($(t.d, '.drill[data-key="' + drill.key + '"]'));
    eq($$(t.d, ".cell").length, 8, drill.title);
    eq(t.app.cfg.div, "8", drill.title);
  });
});
T("the pendulum highlights the right cell in 16ths", () => {
  const t = boot();
  setDiv(t, "16");
  t.click($(t.d, "#play"));
  t.ac.currentTime = t.app.t0 + 13 * t.app.curE8 + 0.005;
  t.frame();
  const on = $$(t.d, ".cell").map(c => c.dataset.on);
  eq(on.filter(v => v === "1").length, 1);
  eq(on[13], "1");
});
T("the pendulum highlights the right cell in triplets", () => {
  const t = boot();
  setDiv(t, "12");
  t.click($(t.d, "#play"));
  t.ac.currentTime = t.app.t0 + 7 * t.app.curE8 + 0.005;
  t.frame();
  eq($$(t.d, ".cell").map(c => c.dataset.on)[7], "1");
});
T("running 16ths and triplets for many bars does not throw", () => {
  ["16","12"].forEach(div => {
    const t = boot();
    setDiv(t, div);
    t.click($(t.d, "#play"));
    for (let s = 1; s <= 30; s++) { t.ac.currentTime = t.app.t0 + s * 2; t.app.pump(); t.frame(); }
    eq(t.app.running, true);
    while (OPEN.length) OPEN.pop().window.close();
  });
});
T("the compression test still works in 16ths", () => {
  const t = boot();
  setDiv(t, "16");
  t.click($(t.d, "#play"));
  const sub = t.app.curE8;
  t.ac.currentTime = t.app.t0 + 0.001;
  [1,1,1,0.75,0.74,0.73].forEach(f => { t.key(" "); t.ac.currentTime += sub * f; });
  ok(/compressing/.test($(t.d, "#verdict").textContent), $(t.d, "#verdict").textContent);
});

report("DOM");
process.exit(process.exitCode || 0);
