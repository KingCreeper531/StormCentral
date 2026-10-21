/**
 * The live stream's on-screen graphics, drawn into the Storm Central page the
 * director shows (page.evaluate(drawOverlay, state)): the station bug, the
 * clock and active-warnings panel, the lower third with a countdown to the
 * warning's end, the warnings ticker, captions of whatever is being read, the
 * full-width alert takeover, and a branded wipe that covers each scene while
 * it settles. drawOverlay runs inside the page, so it is self-contained: no
 * imports, no closures; call it again with a new state to update.
 */

export interface OverlayState {
  scene: {
    /** "TORNADO WARNING", "NATIONAL RADAR"… */
    title: string;
    subtitle: string;
    color: string;
    /** ISO end time: the lower third counts down to it. */
    ends?: string | null;
  };
  /** Active warnings by kind, most serious first (zero counts left out). */
  counts: { code: string; label: string; n: number; color: string }[];
  /** SPC's Day 1 category, when there's a severe risk. */
  outlook: { label: string; color: string } | null;
  ticker: { code: string; color: string; text: string }[];
  banner: { kicker: string; title: string; places: string; chips: string[]; color: string } | null;
  /** What the narrator is saying right now. */
  caption: string | null;
  /** A public camera near the storm, picture-in-picture. */
  camera?: { url: string; name: string; credit: string } | null;
  /** An answer to a viewer's chat command ("FORECAST", "Moore, OK", the answer). */
  card?: { kicker: string; title: string; text: string; color: string } | null;
}

export function drawOverlay(s: OverlayState) {
  const d = document;
  const w = window as unknown as { __scl?: { ends: string | null; tickerKey: string } };
  let root = d.getElementById("scl-live");
  if (!root) {
    const css = d.createElement("style");
    css.textContent = `
:root{--topbar-h:0px!important}
header.fixed.top-0{display:none!important}
/* The dot on the scene's place (components/map/layers/user-marker): the stream names the place instead. */
.maplibregl-marker[aria-label="Selected location"]{display:none!important}
/* No frosted glass: every blurred panel is redone on the CPU each time the radar under it changes, and that halved
   the map's frame rate on a 2-core server. The panels are nearly opaque, so the blur hardly showed. */
*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
#scl-live{position:fixed;inset:0;pointer-events:none;z-index:2147483647;color:#f4f6fb;
  font-family:var(--font-geist-sans,Inter),Inter,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-feature-settings:"tnum" 1;-webkit-font-smoothing:antialiased}
#scl-live .glass{background:linear-gradient(180deg,rgba(14,20,36,.86),rgba(7,11,22,.86));border:1px solid rgba(255,255,255,.09);
  box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06)}
/* station bug */
#scl-live .bug{position:absolute;left:18px;top:16px;display:flex;align-items:center;gap:12px;padding:8px 14px 8px 8px;border-radius:14px}
#scl-live .bug img{width:40px;height:40px;border-radius:10px}
#scl-live .bug b{display:block;font-size:17px;font-weight:800;letter-spacing:2.5px}
#scl-live .bug .row{display:flex;align-items:center;gap:8px;margin-top:3px}
#scl-live .live{display:inline-flex;align-items:center;gap:6px;background:#e5162b;color:#fff;font-size:11px;font-weight:800;letter-spacing:1.8px;padding:3px 8px 3px 7px;border-radius:5px}
#scl-live .live i{width:7px;height:7px;border-radius:50%;background:#fff;animation:scl-pulse 1.4s ease-in-out infinite}
#scl-live .bug small{font-size:11.5px;color:#9aa4b8;font-weight:600;letter-spacing:.4px}
@keyframes scl-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}
/* clock + warnings panel */
#scl-live .side{position:absolute;right:18px;top:16px;width:236px;border-radius:14px;overflow:hidden}
#scl-live .clock{padding:10px 14px 9px;border-bottom:1px solid rgba(255,255,255,.07)}
#scl-live .clock b{font-size:27px;font-weight:800;letter-spacing:.5px}
#scl-live .clock b span{font-size:13px;font-weight:700;color:#9aa4b8;margin-left:5px;letter-spacing:1px}
#scl-live .clock small{display:block;font-size:12px;color:#9aa4b8;font-weight:600;margin-top:1px}
#scl-live .counts{padding:9px 14px 11px}
#scl-live .counts h6{margin:0 0 7px;font-size:10.5px;letter-spacing:1.8px;color:#9aa4b8;font-weight:800}
#scl-live .count{display:flex;align-items:center;gap:9px;margin:5px 0}
#scl-live .count .code{min-width:42px;text-align:center;font-size:12px;font-weight:900;letter-spacing:1px;padding:3px 0;border-radius:5px;color:#0a0d14}
#scl-live .count .lbl{flex:1;font-size:12.5px;color:#cfd5e2;font-weight:600}
#scl-live .count .n{font-size:20px;font-weight:800}
#scl-live .none{font-size:13px;color:#cfd5e2;font-weight:600}
#scl-live .spc{margin:9px 0 1px;padding:6px 9px;border-radius:7px;font-size:11px;font-weight:900;letter-spacing:.6px;color:#0a0d14;white-space:nowrap}
/* lower third */
#scl-live .l3{position:absolute;left:18px;right:18px;bottom:46px;height:78px;border-radius:14px;display:flex;align-items:stretch;overflow:hidden;
  animation:scl-rise .7s cubic-bezier(.2,.8,.2,1) both}
#scl-live .l3 .bar{width:10px;background:var(--c)}
#scl-live .l3 .txt{flex:1;min-width:0;padding:11px 18px 0}
#scl-live .l3 .t{font-size:27px;font-weight:900;letter-spacing:.6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#scl-live .l3 .s{font-size:16.5px;color:#cfd5e2;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#scl-live .l3 .cd{display:flex;flex-direction:column;justify-content:center;align-items:flex-end;padding:0 18px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.05));border-left:1px solid rgba(255,255,255,.07)}
#scl-live .l3 .cd small{font-size:10.5px;letter-spacing:1.8px;color:#9aa4b8;font-weight:800}
#scl-live .l3 .cd b{font-size:26px;font-weight:900;color:var(--c)}
@keyframes scl-rise{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
/* ticker */
#scl-live .tick{position:absolute;left:0;right:0;bottom:0;height:36px;display:flex;background:#050810;border-top:1px solid rgba(255,255,255,.08)}
#scl-live .tick .lab{flex:none;display:flex;align-items:center;padding:0 14px;background:#e5162b;font-size:12px;font-weight:900;letter-spacing:2px;z-index:1;box-shadow:8px 0 16px #050810}
#scl-live .tick .win{position:relative;flex:1;overflow:hidden}
#scl-live .tick .run{position:absolute;top:0;left:0;height:36px;display:flex;align-items:center;white-space:nowrap;will-change:transform;animation:scl-tick var(--d,60s) linear infinite}
#scl-live .tick .it{display:inline-flex;align-items:center;gap:8px;margin-right:34px;font-size:15px;font-weight:600;color:#e8ecf4}
#scl-live .tick .it em{font-style:normal;font-size:11px;font-weight:900;letter-spacing:1px;padding:2px 6px;border-radius:4px;color:#0a0d14}
#scl-live .tick .it.note{color:#8f99ad}
@keyframes scl-tick{from{transform:translateX(var(--from,1200px))}to{transform:translateX(-100%)}}
/* live camera */
#scl-live .cam{position:absolute;right:18px;bottom:140px;width:304px;border-radius:12px;overflow:hidden;animation:scl-rise .6s cubic-bezier(.2,.8,.2,1) both}
#scl-live .cam img{display:block;width:304px;height:171px;object-fit:cover;background:#000}
#scl-live .cam .lab{display:flex;align-items:center;gap:7px;padding:6px 10px 7px;font-size:12px;font-weight:700}
#scl-live .cam .lab em{font-style:normal;font-size:10px;font-weight:900;letter-spacing:1.4px;background:#e5162b;padding:2px 6px;border-radius:4px}
#scl-live .cam .lab span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#scl-live .cam .lab small{font-size:10px;color:#9aa4b8;font-weight:600}
/* chat command answer */
#scl-live .card{position:absolute;left:18px;top:96px;width:380px;border-radius:12px;padding:12px 15px 13px;border-left:4px solid var(--c);
  animation:scl-rise .5s cubic-bezier(.2,.8,.2,1) both}
#scl-live .card .k{font-size:10.5px;font-weight:900;letter-spacing:1.8px;color:var(--c)}
#scl-live .card .h{font-size:20px;font-weight:800;margin-top:2px}
#scl-live .card .x{font-size:14.5px;line-height:1.42;color:#dfe5f0;margin-top:5px}
/* captions */
#scl-live .cap{position:absolute;left:50%;bottom:140px;transform:translateX(-50%);max-width:940px;padding:10px 18px;border-radius:10px;
  background:rgba(0,0,0,.74);font-size:21px;line-height:1.38;font-weight:600;text-align:center;transition:opacity .35s}
/* beside the camera, not over it */
#scl-live .cap.beside{left:18px;transform:none;max-width:calc(100% - 358px)}
/* alert takeover */
#scl-live .ban{position:absolute;left:18px;right:18px;top:84px;border-radius:16px;overflow:hidden;color:#fff;
  box-shadow:0 18px 60px rgba(0,0,0,.6);animation:scl-drop .6s cubic-bezier(.2,.9,.25,1.15) both}
#scl-live .ban .bg{position:absolute;inset:0;background:var(--b)}
#scl-live .ban .st{position:absolute;inset:0;opacity:.18;background:repeating-linear-gradient(-45deg,#000 0 18px,transparent 18px 36px);background-size:51px 51px;animation:scl-stripes 1.2s linear infinite}
#scl-live .ban .in{position:relative;display:flex;align-items:center;gap:20px;padding:18px 24px}
#scl-live .ban .ic{flex:none;width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.22);display:grid;place-items:center;font-size:36px;font-weight:900;animation:scl-throb 1s ease-in-out infinite}
#scl-live .ban .k{font-size:13px;font-weight:900;letter-spacing:3px;opacity:.9}
#scl-live .ban .h{font-size:42px;font-weight:900;letter-spacing:1px;line-height:1.05;text-shadow:0 2px 8px rgba(0,0,0,.35)}
#scl-live .ban .p{font-size:19px;font-weight:700;margin-top:4px}
#scl-live .ban .chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
#scl-live .ban .chips span{font-size:12px;font-weight:900;letter-spacing:1px;padding:4px 9px;border-radius:6px;background:rgba(0,0,0,.3)}
@keyframes scl-drop{from{transform:translateY(-30px) scale(.97);opacity:0}to{transform:none;opacity:1}}
@keyframes scl-stripes{to{background-position:51px 0}}
@keyframes scl-throb{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
/* scene wipe */
#scl-live .wipe{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 45%,#13213f,#03060d 70%);
  animation:scl-wipe .85s .12s cubic-bezier(.7,0,.3,1) both}
#scl-live .wipe div{display:flex;align-items:center;gap:16px;font-size:30px;font-weight:900;letter-spacing:5px}
#scl-live .wipe img{width:64px;height:64px;border-radius:14px}
@keyframes scl-wipe{to{transform:translateX(100%);opacity:.6;visibility:hidden}}
/* ── Vertical (9:16), for the Shorts feed. YouTube draws its own UI over the picture there: the top ~70 px,
   the bottom ~22% (title, channel, subscribe) and a column of buttons down the right of the lower half, so
   text stays out of those. The app's phone chrome (tab bar, bottom sheet, zoom buttons) is hidden. */
@media (orientation:portrait){
:root{--tabbar-h:0px!important}
[data-chrome],.maplibregl-ctrl-group,div:has(>[data-tour="layout"]),[data-tour="readout"]{display:none!important}
/* The bottom sheet is only made invisible: gone, its space would leave the app's map padding and move the storm. */
div.fixed.inset-x-0.z-30:has(>section[aria-label]){visibility:hidden!important}
/* Professional mode: its two stacked panes between the top row and the lower third. */
div.absolute.inset-0.flex.flex-col:has(>div>[data-tour="layout"]){top:148px!important;bottom:420px!important}
#scl-live .bug{left:16px;top:84px;gap:10px;padding:7px 12px 7px 7px}
#scl-live .bug img{width:36px;height:36px}
#scl-live .bug b{font-size:15px;letter-spacing:2px}
#scl-live .bug small{display:none}
#scl-live .side{left:236px;right:16px;top:84px;width:auto;display:flex;align-items:stretch}
#scl-live .clock{flex:none;display:flex;flex-direction:column;justify-content:center;border-bottom:0;border-right:1px solid rgba(255,255,255,.07);padding:7px 12px}
#scl-live .clock b{font-size:21px}
#scl-live .clock b span{font-size:11px;margin-left:4px}
#scl-live .clock small{font-size:10.5px}
#scl-live .counts{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;align-content:center;gap:5px 7px;padding:7px 10px}
#scl-live .counts h6{width:100%;margin:0;font-size:9.5px;letter-spacing:1.5px}
#scl-live .count{margin:0;gap:5px}
#scl-live .count .code{min-width:0;padding:2px 6px;font-size:11px}
#scl-live .count .lbl{display:none}
#scl-live .count .n{font-size:16px}
#scl-live .none{font-size:12px}
#scl-live .spc{margin:0;padding:3px 7px;font-size:10px;letter-spacing:.4px}
#scl-live .ban{left:16px;right:16px;top:152px}
#scl-live .ban .in{gap:14px;padding:15px 18px}
#scl-live .ban .ic{width:50px;height:50px;font-size:28px}
#scl-live .ban .k{font-size:11.5px;letter-spacing:2.5px}
#scl-live .ban .h{font-size:34px}
#scl-live .ban .p{font-size:16.5px}
#scl-live .ban .chips span{font-size:11px;padding:3px 8px}
#scl-live .cam{right:16px;top:152px;bottom:auto;width:236px}
#scl-live .cam img{width:236px;height:133px}
#scl-live .cam .lab{padding:5px 9px 6px;font-size:11.5px}
/* The takeover has the top while it's up; the camera comes back after it. */
#scl-live:has(.ban:not([hidden])) .cam{display:none}
#scl-live .card{left:16px;right:16px;top:152px;width:auto}
#scl-live:has(.cam:not([hidden])) .card{right:264px}
#scl-live .tick{right:110px;bottom:282px;border:1px solid rgba(255,255,255,.08);border-left:0;border-radius:0 10px 10px 0;overflow:hidden}
#scl-live .tick .lab{padding:0 10px;font-size:11px;letter-spacing:1.6px}
#scl-live .l3{left:16px;right:122px;bottom:328px;height:92px}
#scl-live .l3 .bar{width:8px}
#scl-live .l3 .txt{padding:10px 14px 0}
#scl-live .l3 .t{font-size:23px}
#scl-live .l3 .s{font-size:14.5px;line-height:1.3;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
#scl-live .l3 .cd{padding:0 12px}
#scl-live .l3 .cd small{font-size:9.5px;letter-spacing:1.4px}
#scl-live .l3 .cd b{font-size:19px}
#scl-live .cap,#scl-live .cap.beside{left:16px;right:122px;bottom:432px;transform:none;max-width:none;padding:9px 14px;font-size:19px;line-height:1.36}
}`;
    d.head.appendChild(css);
    root = d.createElement("div");
    root.id = "scl-live";
    root.innerHTML = `
<div class="wipe"><div><img src="/icon.svg" alt="">STORM CENTRAL</div></div>
<div class="bug glass"><img src="/icon.svg" alt=""><div><b>STORM CENTRAL</b><div class="row"><span class="live"><i></i>LIVE</span><small>Radar · Warnings · 24/7</small></div></div></div>
<div class="side glass"><div class="clock"><b class="time"></b><small class="date"></small></div><div class="counts"></div></div>
<div class="cam glass" hidden><img alt=""><div class="lab"><em>CAM</em><span></span><small></small></div></div>
<div class="cap" style="opacity:0"></div>
<div class="card glass" hidden><div class="k"></div><div class="h"></div><div class="x"></div></div>
<div class="ban" hidden><div class="bg"></div><div class="st"></div><div class="in"><div class="ic">!</div><div><div class="k"></div><div class="h"></div><div class="p"></div><div class="chips"></div></div></div></div>
<div class="l3 glass"><div class="bar"></div><div class="txt"><div class="t"></div><div class="s"></div></div><div class="cd"><small>ENDS IN</small><b></b></div></div>
<div class="tick"><div class="lab">WARNINGS</div><div class="win"><div class="run"></div></div></div>`;
    d.body.appendChild(root);
    w.__scl = { ends: null, tickerKey: "" };
    const time = root.querySelector(".time")!, date = root.querySelector(".date")!, cdBox = root.querySelector<HTMLElement>(".cd")!, cd = cdBox.querySelector("b")!;
    const tick = () => {
      const now = new Date();
      time.innerHTML = `${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}<span>ET</span>`;
      date.textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" });
      const ends = w.__scl?.ends ? Date.parse(w.__scl.ends) : NaN;
      const left = Math.round((ends - now.getTime()) / 60_000);
      cdBox.style.display = Number.isFinite(left) && left > 0 ? "" : "none";
      cd.textContent = left >= 60 ? `${Math.floor(left / 60)} HR ${left % 60} MIN` : `${left} MIN`;
    };
    tick();
    setInterval(tick, 5_000);
  }
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root!.querySelector<T>(sel)!;
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

  // Lower third.
  const l3 = $(".l3");
  if (l3.dataset.title !== s.scene.title) {
    l3.style.animation = "none";
    void l3.offsetWidth;
    l3.style.animation = "";
    l3.dataset.title = s.scene.title;
  }
  l3.style.setProperty("--c", s.scene.color);
  $(".l3 .t").textContent = s.scene.title;
  $(".l3 .s").textContent = s.scene.subtitle;
  w.__scl!.ends = s.scene.ends ?? null;
  const cdBox = $(".cd");
  const left = s.scene.ends ? Math.round((Date.parse(s.scene.ends) - Date.now()) / 60_000) : NaN;
  cdBox.style.display = Number.isFinite(left) && left > 0 ? "" : "none";
  $(".cd b").textContent = left >= 60 ? `${Math.floor(left / 60)} HR ${left % 60} MIN` : `${left} MIN`;

  // Active warnings and SPC's outlook.
  $(".counts").innerHTML =
    `<h6>ACTIVE WARNINGS</h6>` +
    (s.counts.length
      ? s.counts.map((c) => `<div class="count"><span class="code" style="background:${c.color}">${esc(c.code)}</span><span class="lbl">${esc(c.label)}</span><span class="n">${c.n}</span></div>`).join("")
      : `<div class="none">None in effect</div>`) +
    (s.outlook ? `<div class="spc" style="background:${s.outlook.color}">SPC TODAY · ${esc(s.outlook.label)}</div>` : "");

  // Ticker: rebuilt only when its items change, at a steady ~95 px/s whatever its length.
  const key = JSON.stringify(s.ticker);
  if (w.__scl!.tickerKey !== key) {
    w.__scl!.tickerKey = key;
    const run = $(".tick .run");
    run.innerHTML =
      `<span class="it note">Not an official warning source: follow the National Weather Service.</span>` +
      (s.ticker.length
        ? s.ticker.map((t) => `<span class="it"><em style="background:${t.color}">${esc(t.code)}</em>${esc(t.text)}</span>`).join("")
        : `<span class="it">No tornado, severe thunderstorm or flash flood warnings in effect right now.</span>`);
    const from = $(".tick .win").clientWidth;
    const dur = Math.round((run.scrollWidth + from) / 95);
    run.style.setProperty("--from", `${from}px`);
    run.style.setProperty("--d", `${dur}s`);
    // Timed off the clock, so a scene change (a new page) carries on where the ticker was instead of starting over.
    run.style.animationDelay = `-${((Date.now() / 1000) % dur).toFixed(2)}s`;
    run.style.animation = "none";
    void run.offsetWidth;
    run.style.animation = "";
    run.style.animationDelay = `-${((Date.now() / 1000) % dur).toFixed(2)}s`;
  }

  // Live camera.
  const cam = $(".cam");
  cam.hidden = !s.camera;
  if (s.camera) {
    const img = cam.querySelector("img")!;
    if (img.getAttribute("src") !== s.camera.url) img.setAttribute("src", s.camera.url);
    $(".cam .lab span").textContent = s.camera.name;
    $(".cam .lab small").textContent = s.camera.credit;
  }

  // Captions.
  const cap = $(".cap");
  if (s.caption) cap.textContent = s.caption;
  cap.classList.toggle("beside", !!s.camera);
  cap.style.opacity = s.caption ? "1" : "0";

  // A viewer's chat command, answered.
  const card = $(".card");
  card.hidden = !s.card;
  if (s.card) {
    card.style.setProperty("--c", s.card.color);
    $(".card .k").textContent = s.card.kicker;
    $(".card .h").textContent = s.card.title;
    $(".card .x").textContent = s.card.text;
  }

  // Alert takeover.
  const ban = $(".ban");
  if (s.banner) {
    if (ban.hidden || ban.dataset.title !== s.banner.title + s.banner.places) {
      ban.hidden = false;
      ban.style.animation = "none";
      void ban.offsetWidth;
      ban.style.animation = "";
      ban.dataset.title = s.banner.title + s.banner.places;
    }
    ban.style.setProperty("--b", s.banner.color);
    $(".ban .k").textContent = s.banner.kicker;
    $(".ban .h").textContent = s.banner.title;
    $(".ban .p").textContent = s.banner.places;
    $(".ban .chips").innerHTML = s.banner.chips.map((c) => `<span>${esc(c)}</span>`).join("");
  } else ban.hidden = true;
}
