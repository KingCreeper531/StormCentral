/**
 * The Professional mode guide: an optional tour of the workspace and a
 * reference of what every product and tool shows, how to read it and what to
 * look for, step-by-step how-tos and a glossary. Nothing here opens on its
 * own: the toolbar's Guide button (which Settings can hide) is the only way
 * in. Every string is a translation key (lib/i18n/es/guide.ts).
 */
import type { ProTool } from "@/store/pro-store";
import { PRO_PRODUCT_IDS, PRO_PRODUCTS, type ProProductId } from "./products";

export interface GuideTopic {
  /** What it is. */
  what: string;
  /** How to read it: units, colours. */
  read?: string;
  /** What to look for. */
  look?: readonly string[];
}

export interface ToolTopic extends GuideTopic {
  steps: readonly string[];
}

export interface HowTo {
  id: string;
  title: string;
  steps: readonly string[];
}

export interface Term {
  term: string;
  meaning: string;
}

export interface TourStep {
  /** The `data-tour` element it points at; null for a step in the middle of the screen. Steps whose element isn't on screen are skipped. */
  target: string | null;
  title: string;
  body: string;
}

const REF_READ = "In dBZ. Greens are light rain, yellow to red heavy rain, purple and white very heavy rain or hail. Above about 55–60 dBZ in a storm's core, hail is likely.";
const VEL_READ = "In knots. Green is moving toward the radar, red away from it. It's only the part of the wind along the beam: wind blowing across the beam reads near zero. Purple (RF) is range folding, where the radar can't tell the distance, so there's no data.";
const CC_READ =
  "From 0 to about 1. 0.97 and above: rain or snow alone. 0.80–0.97: a mix, like hail with rain or melting snow. Below about 0.80: things that aren't weather, such as birds, insects, smoke and tornado debris.";
const ZDR_READ = "In dB. Near 0: round or tumbling targets (small drops, hail, dry snow). 1–4 dB: big, flattened raindrops. Very high values in weak echo: insects or birds.";

const INTL: GuideTopic = {
  what: "Another country's national radar composite, from its weather service: Canada (ECCC), Germany (DWD), Finland (FMI), the Netherlands (KNMI) and Japan (JMA), matched to the loop's times.",
  read: "In that service's own colours and units: reflectivity for Germany and Finland, precipitation rate for the others. The panel's colour bar shows the scale.",
};

const VOLUME_LOOK = [
  "Step up through the tilts to see a storm's structure: rotation from the ground to mid levels, a core leaning over its updraft, hail high up.",
  "The live volume arrives in pieces as the radar scans, so the newest tilts fill in first at the bottom.",
] as const;

export const PRODUCT_GUIDE: Record<ProProductId, GuideTopic> = {
  ref: {
    what: "How strongly the radar beam bounces back from rain, hail, snow and other targets, at the elevation tilt you pick. The lowest tilt is NOAA's super-resolution scan; higher tilts are decoded from the radar's Level III data.",
    read: REF_READ,
    look: [
      "Hook echo: a curl on the back side of a storm (often its southwest side), where a tornado can form.",
      "Inflow notch or weak-echo hole: a gap where strong rising air enters the storm.",
      "Bow echo: a line bulging forward. Damaging straight-line wind is likely at the front of the bulge.",
      "Hail spike: a faint streak of weak echo pointing away from the radar behind a very strong core. It means large hail.",
      "On higher tilts, a strong core above weaker echo near the ground means a strong updraft holding rain and hail up.",
    ],
  },
  vel: {
    what: "Doppler velocity: how fast targets move toward or away from the radar.",
    read: VEL_READ,
    look: [
      "Couplet: bright green right next to bright red. That's rotation. Tight and strong near the ground, it can be a tornado.",
      "Green and red facing each other is wind coming together; back to back near the ground, it's a downburst spreading out.",
      "A strong band of one colour behind a line of storms is a damaging-wind surge.",
    ],
  },
  srv: {
    what: "Storm-relative velocity: velocity with the radar's estimate of the storms' average motion taken out, so rotation inside a fast-moving storm stands out.",
    read: VEL_READ,
    look: [
      "Couplets often look tighter and stronger than on base velocity, especially when storms move fast.",
      "The motion taken out is an average for all storms; a storm moving differently can look a little off.",
    ],
  },
  cc: {
    what: "Correlation coefficient (ρHV): how alike the targets are in each spot.",
    read: CC_READ,
    look: [
      "Tornado debris signature: a small spot of low CC right on a velocity couplet, with echo still showing on reflectivity. A tornado is on the ground and throwing debris.",
      "Hail: CC dips into the 0.80s and low 0.90s in the core.",
      "A ring of lower CC around the radar is the melting layer, where snow turns to rain.",
    ],
  },
  zdr: {
    what: "Differential reflectivity: whether targets are wider than they are tall. Big raindrops flatten as they fall; hail tumbles and looks round.",
    read: ZDR_READ,
    look: [
      "ZDR column: positive ZDR reaching above the freezing level on higher tilts, where a strong updraft lifts raindrops. It often comes before hail and a stronger storm.",
      "ZDR arc: a band of high ZDR along the inflow edge of a supercell, a sign of strong low-level spin.",
      "Hail core: high reflectivity with ZDR near 0.",
    ],
  },
  hc: {
    what: "Hydrometeor classification: the radar's best guess of what fills each spot, worked out from all the dual-pol products together.",
    read: "One colour per class: biological, ground clutter, ice crystals, dry snow, wet snow, rain, heavy rain, big drops, graupel, hail with rain, large hail and giant hail.",
    look: ["It's an algorithm, not a measurement: check reflectivity, ZDR and CC yourself before trusting it, especially far from the radar."],
  },
  kdp: {
    what: "Specific differential phase: how much the radar's horizontal and vertical pulses fall out of step per kilometre. It follows how much liquid water is there.",
    read: "In °/km. Near 0 in light rain, snow and hail; 1–3 °/km in heavy rain; more in torrential rain.",
    look: [
      "Flash flooding: high KDP in a storm that barely moves.",
      "Hail doesn't raise KDP, so high KDP inside a hail core shows heavy rain falling with it.",
    ],
  },
  vil: {
    what: "Vertically integrated liquid: all the water in the column over each spot, added up from every tilt.",
    read: "In kg/m². Bigger numbers mean a taller, wetter storm.",
    look: ["A quick rise means a strengthening storm.", "A quick drop after a peak means the core is coming down: watch for a downburst."],
  },
  "eet-site": {
    what: "Enhanced echo tops from the radar: the highest point where it still sees 18 dBZ, i.e. how tall the storm is.",
    read: "In thousands of feet (kft).",
    look: ["Tops climbing fast mean a strengthening updraft.", "Very high tops (around 50 kft and up) mark the strongest storms."],
  },
  "vol-ref": {
    what: "The full Level II volume, decoded on your device: reflectivity at every tilt the radar scanned, not just the four Level III carries. Desktop only.",
    read: REF_READ,
    look: VOLUME_LOOK,
  },
  "vol-vel": {
    what: "Level II velocity at every tilt the radar scanned, decoded on your device. Desktop only.",
    read: VEL_READ,
    look: ["Follow a couplet up through the tilts: rotation that reaches from near the ground to mid levels is a deep, strong mesocyclone.", ...VOLUME_LOOK],
  },
  "vol-zdr": {
    what: "Level II differential reflectivity at every tilt, decoded on your device. Desktop only.",
    read: ZDR_READ,
    look: ["Find ZDR columns: step up the tilts and see how high positive ZDR reaches above the freezing level.", ...VOLUME_LOOK],
  },
  "vol-cc": {
    what: "Level II correlation coefficient at every tilt, decoded on your device. Desktop only.",
    read: CC_READ,
    look: ["A debris signature that reaches up several tilts means a strong tornado lofting debris high.", ...VOLUME_LOOK],
  },
  mosaic: {
    what: "Every radar in the country blended into one map near the ground (NOAA's MRMS).",
    read: REF_READ,
    look: ["The big picture: lines, clusters and what's coming. Then switch a panel to one radar site for detail."],
  },
  cref: {
    what: "Composite reflectivity (MRMS): the strongest echo anywhere in the column over each spot.",
    read: REF_READ,
    look: ["It shows cores that are still high up, so storms can look bigger and stronger than what's reaching the ground."],
  },
  eet: {
    what: "Echo tops for the whole country (MRMS): the highest point with 18 dBZ of echo.",
    read: "In thousands of feet (kft).",
    look: ["Compare storms at a glance: the tallest are usually the strongest."],
  },
  "mrms-mesh": {
    what: "Maximum expected size of hail (MRMS): the biggest hail likely at the ground, estimated from how much strong echo sits above the freezing level. Needs the Pro data server.",
    read: "Hail diameter. The colour bar shows the sizes.",
    look: ["It's an estimate: reports from the ground confirm it."],
  },
  "mrms-mesh60": {
    what: "The biggest MESH at each spot over the last hour: the path a storm's hail has taken. Needs the Pro data server.",
    read: "Hail diameter.",
    look: ["Long, wide swaths mark long-lived hail storms."],
  },
  "mrms-rotation": {
    what: "Rotation track (MRMS): the strongest low-level rotation at each spot over the last hour, from every radar. Needs the Pro data server.",
    read: "Brighter colours mean stronger rotation.",
    look: ["A long, narrow track is where a mesocyclone, and possibly a tornado, has travelled."],
  },
  "mrms-vil": {
    what: "Vertically integrated liquid for the whole country (MRMS). Needs the Pro data server.",
    read: "In kg/m².",
    look: ["Compare storms across states at once."],
  },
  "intl-eccc": INTL,
  "intl-dwd": INTL,
  "intl-fmi": INTL,
  "intl-knmi": INTL,
  "intl-jma": INTL,
  "sat-vis": {
    what: "Visible satellite (GOES ABI band 2): sunlight reflected off clouds. The sharpest band, but only in daylight.",
    look: [
      "Towers of cumulus going up along a boundary: storms about to start.",
      "Overshooting tops: bumpy domes above a storm's anvil, often casting a shadow.",
      "Arcs of low cloud racing out from storms: outflow boundaries.",
    ],
  },
  "sat-ir": {
    what: "Clean infrared (GOES ABI band 13): how cold cloud tops are, day and night.",
    read: "Colder tops are higher. The coldest colours are the tallest storms.",
    look: ["Tops cooling fast: a storm growing.", "A V of cold cloud spreading downwind of a storm's top (an enhanced V) marks a very strong updraft."],
  },
  "sat-wv": {
    what: "Water vapour: moisture in the middle and upper atmosphere, not clouds near the ground. Latest image only.",
    read: "Bright or coloured is moist, dark is dry.",
    look: ["Dark dry slots wrapping into a storm system, and the swirls of upper-level lows and jet streams."],
  },
  "sat-airmass": {
    what: "Air Mass RGB: colours the air by temperature and moisture.",
    read: "Green: warm, moist air. Blue and purple: cold air. Red and orange: dry air from high up sinking down, often near a strengthening low or jet. White: thick, high clouds.",
  },
  "sat-geocolor": {
    what: "GeoColor: true colour by day; at night, low clouds in a light blue over a picture of city lights.",
    look: ["An easy all-day view of where the clouds and storms are."],
  },
  "sat-dust": {
    what: "Dust RGB: blowing dust, day and night.",
    read: "Dust shows pink to magenta.",
  },
  "sat-firetemp": {
    what: "Fire Temperature RGB: hot spots from wildfires.",
    read: "Red is a cooler fire; orange, yellow and white are hotter and more intense.",
  },
  "goes-dcp": {
    what: "Day Cloud Phase Distinction: tells water clouds from ice clouds in daylight. Needs the Pro data server.",
    read: "Water clouds look cyan or lavender; ice clouds green, yellow or orange.",
    look: ["A cumulus tower turning from cyan to green and yellow is freezing at the top: a new storm going up."],
  },
  "goes-nightmicro": {
    what: "Night Fog (nighttime microphysics): picks out fog and low cloud at night. Needs the Pro data server.",
    read: "Fog and low cloud look aqua; high, cold clouds red; thin high cloud dark.",
  },
  "goes-sandwich": {
    what: "IR Sandwich: the detail of visible with infrared colours on top. Daytime only. Needs the Pro data server.",
    look: ["The texture of storm tops (overshooting tops, waves) together with how cold they are."],
  },
};

/** Whether a product only shows on a desktop (Level II) or with the Pro data server, for a badge. */
export function productNeeds(id: ProProductId): "desktop" | "server" | null {
  const kind = PRO_PRODUCTS[id].kind;
  return kind === "l2" ? "desktop" : kind === "server" ? "server" : null;
}

export const TOOL_GUIDE: Record<ProTool, ToolTopic> = {
  inspect: {
    what: "The everyday tool: read values and inspect warnings.",
    steps: [
      "Move the pointer over any panel (on a phone, tap). The bar at the bottom shows every panel's value at that spot, and a crosshair marks the same spot on the other panels.",
      "The bar also shows the range and bearing from the radar, the ground height and the model's temperature, dew point, precipitable water and 0–3 km shear there.",
      "Click a warning's outline to open the warning inspector.",
    ],
    read: "The warning inspector lists the hazard, its source and impact, and the warning's impact-based tags: maximum hail size, maximum wind, the damage threat (considerable, destructive or catastrophic) and whether the tornado is radar-indicated or observed.",
  },
  sounding: {
    what: "A model sounding for any spot: the atmosphere's temperature, moisture and wind from the ground up.",
    steps: ["Pick Sounding, then click a spot on any panel. Click again anywhere to move it.", "Choose the parcel to lift: surface, mixed layer or most unstable."],
    read: "Skew-T: the red line is temperature, green is dew point and the dashed line is the rising parcel, with its cloud base (LCL) and level of free convection (LFC) marked on the right. The gap between the parcel and the red line is CAPE. Hodograph: the wind at each height, coloured 0–1 km pink, 1–3 km red, 3–6 km green, 6–9 km yellow and 9–12 km cyan. RM and LM are the expected right- and left-moving supercell motions, MW the mean wind and OBS the motion from your storm vector. A long, curved hodograph means strong, turning wind shear, which favours supercells. The numbers under it are explained in the glossary.",
    look: ["It's a model forecast for this hour (Open-Meteo's HRRR/NAM/GFS blend), not a weather balloon."],
  },
  meteogram: {
    what: "Every model's forecast for one spot over the coming days, side by side, or one ensemble's spread as a plume.",
    steps: [
      "Pick Meteogram, then click a spot on any panel. Click again anywhere to move it (Sounding uses the same spot).",
      "Choose what to plot: temperature, dew point, total rain and snow, gusts, CAPE or pressure, and how many days to show.",
      "Models: tap a model's name to show or hide its line. Ensemble: pick an ensemble to see all of its runs.",
    ],
    read: "Models: one line per model. Where the lines agree the forecast is more certain; where they split, it isn't. AI marks the machine-learning models (ECMWF's AIFS and NOAA's AI GFS). Ensemble: each faint line is one run of the same model started from slightly different conditions, the band holds the middle 80% of runs and the bold line is their average. A narrow plume is a confident forecast; a wide one means anything inside it can happen.",
    look: [
      "Before a severe weather day, compare CAPE and dew points: models that bring the moisture back sooner mean an earlier, bigger threat.",
      "For rain totals, the top of the plume is a realistic worst case, not the forecast.",
      "Short-range models (HRRR, NAM 3 km) only run two or three days ahead.",
    ],
  },
  xsect: {
    what: "A vertical slice of the model atmosphere along a line you draw.",
    steps: ["Pick Cross-section and click the start (A) on any panel.", "Click the end (A′). Clicking again starts a new line."],
    read: "Colours are θe (equivalent potential temperature): warm colours are warm, moist air; cool colours dry or cold air. The dashed lines are 0 °C (white) and −20 °C (blue); hail grows between them. The ground is shaded at the bottom.",
    look: ["A tongue of high θe below lower values: unstable air ready for storms.", "Draw it across a front or dry line to see its slope."],
  },
  vector: {
    what: "A storm's motion, from two clicks on its core at two loop times.",
    steps: [
      "Pick Storm vector and click the storm's core on any panel.",
      "Step the loop a few frames with ← or →, then click the same core again.",
      "The panel shows the direction it's coming from and its speed, and a ±20° fan shows where it's likely to go.",
    ],
    look: ["Times of arrival appear for your location, saved places and any TOA points inside the fan.", "Storms change course: redo the vector every few scans."],
  },
  toa: {
    what: "Time of arrival: when the storm reaches places you choose.",
    steps: ["Set a storm vector first.", "Pick TOA and click places on any panel (a town, a road, a chase target).", "Each gets an arrival time, or says it's off track or already passed."],
  },
  warngen: {
    what: "Draw and issue a warning to the StormCentral spotter network. These are unofficial: they go to signed-in spotters, not the public or the NWS. Needs a spotter account.",
    steps: [
      "Pick the product: tornado, severe thunderstorm, flash flood, snow squall or significant weather advisory.",
      "Click the storm's core, step the loop a few frames and click it again to set its motion (or type the motion).",
      "The polygon is drawn along the storm's track. Drag its corners to adjust it; drag a midpoint to add a corner.",
      "Fill in the duration, hail, wind and damage threat, read the product text, tick the confirmation and issue it.",
    ],
  },
};

export const HOW_TOS: readonly HowTo[] = [
  {
    id: "rotation",
    title: "Check a storm for rotation",
    steps: [
      "Use a 2×2 layout with reflectivity, velocity, storm-relative velocity and CC, and zoom to the storm.",
      "On reflectivity, look for a hook or an inflow notch on the storm's back side.",
      "On velocity and storm-relative velocity, look there for a couplet: bright green right next to bright red.",
      "Add the strongest inbound and outbound speeds and halve the total: that's the rotational velocity. Around 40 kt or more near the ground is strong.",
      "Step through higher tilts to see how deep the rotation goes.",
    ],
  },
  {
    id: "debris",
    title: "Spot a tornado on the ground",
    steps: [
      "Put reflectivity, velocity and CC side by side at the lowest tilt.",
      "Find a tight couplet on velocity.",
      "Check CC right on the couplet: a small spot below about 0.80, with echo still showing on reflectivity, is a tornado debris signature.",
      "Watch the next scans; a debris signature reaching up several tilts means a strong tornado.",
      "If it threatens people, follow the official NWS warnings and call in what you see.",
    ],
  },
  {
    id: "hail",
    title: "Look for large hail",
    steps: [
      "On reflectivity, find cores of 60 dBZ or more, especially high up on higher tilts.",
      "Check ZDR (near 0 in the core) and CC (dropping into the 0.80s or low 0.90s).",
      "Look for a hail spike behind the core.",
      "Check MESH or VIL for a quick rise.",
      "In the sounding, steep 700–500 hPa lapse rates and plenty of CAPE between 0 °C and −20 °C mean big hail is possible.",
    ],
  },
  {
    id: "flood",
    title: "Gauge flash-flood risk",
    steps: [
      "Look at the mosaic for storms that move over the same place one after another (training).",
      "Set a storm vector: slow storms drop more rain in one place.",
      "Check KDP for heavy rain cores.",
      "In the sounding, high precipitable water (PWAT) means storms can rain very hard.",
    ],
  },
  {
    id: "arrival",
    title: "Find out when a storm reaches you",
    steps: [
      "Pick Storm vector and click the storm's core.",
      "Step the loop a few frames and click the same core again.",
      "Read the arrival times in the panel; add places with TOA.",
      "Redo the vector every few scans as the storm changes course.",
    ],
  },
  {
    id: "environment",
    title: "Read the environment before storms form",
    steps: [
      "Click a sounding ahead of where storms are expected.",
      "Check MLCAPE (fuel), MLCIN (the lid), 0–6 km shear (organisation) and 0–1 km SRH and the LCL (tornado potential).",
      "Look at the hodograph's shape: long and curved favours supercells.",
      "Draw a cross-section across a front or dry line.",
      "Watch visible satellite for towering cumulus along boundaries.",
    ],
  },
  {
    id: "warngen",
    title: "Issue a spotter-network warning",
    steps: [
      "Sign in with your spotter account.",
      "Pick WarnGen and choose the product.",
      "Click the storm, step the loop and click it again to set its motion.",
      "Adjust the polygon, fill in the hazards and read the text.",
      "Tick the confirmation and issue it. You can update or cancel it later from the same panel.",
    ],
  },
  {
    id: "archive",
    title: "Replay a past storm",
    steps: [
      "Press the archive button in the toolbar.",
      "Pick a date and time, or one of the famous storms.",
      "Panels load the radar from then; products with no archive say so.",
      "Press Back to live when you're done.",
    ],
  },
  {
    id: "monitors",
    title: "Spread the workspace over several monitors",
    steps: [
      "Press the window button on a panel's header, or on the side panel.",
      "It opens in a window of its own; the desktop app puts it on another monitor.",
      "It stays in step with the workspace: same map, loop and tools.",
      "Close the window, or press Bring it back, to return it.",
    ],
  },
];

/** The basics of the workspace, for the guide's first page. */
export const BASICS: readonly { title: string; body: string }[] = [
  {
    title: "Quick start",
    body: "Pick a layout and a radar site in the toolbar. Set each panel's product from its header, and for radar the elevation tilt. Press Space to play the loop. Move the pointer over a panel to read every panel at that spot. Pick a tool to analyse.",
  },
  {
    title: "Panels move together",
    body: "All panels share one map: pan or zoom one and the others follow. A crosshair shows where your pointer is on the other panels.",
  },
  {
    title: "Time basis (TB)",
    body: "The loop steps through the scan times of one panel, marked TB: the first radar panel. Every other panel shows its newest frame at or before that time, so products that update at different rates (radar every 4–6 minutes, MRMS every 2, satellite every 10) line up. Each panel's header shows its own scan time.",
  },
  {
    title: "Times are in UTC (Z)",
    body: "Pro mode shows times in UTC with a Z, like the NWS and AWIPS. 18:00Z is 2 PM Eastern daylight time.",
  },
  {
    title: "Elevation tilts",
    body: "The radar scans a stack of cones at rising angles. 0.5° is the lowest and closest to the ground; higher tilts look higher into a storm, and the farther the storm, the higher the beam.",
  },
  {
    title: "Where the data comes from",
    body: "Single-site radar comes from NOAA and the Iowa Environmental Mesonet, plus Level III and Level II data decoded in the app. National products come from NOAA's MRMS, satellite from GOES-East and -West. Level II volumes need a desktop; a few products need the Pro data server, and they're only listed when one is connected.",
  },
  {
    title: "Keyboard",
    body: "Space: play or pause. ← and →: step one frame. Esc: close the warning inspector.",
  },
];

export const GLOSSARY: readonly Term[] = [
  { term: "AGL / MSL", meaning: "Above ground level / above mean sea level: two ways to give a height." },
  { term: "Bow echo", meaning: "A line of storms bulging forward like a bow. The strongest straight-line winds are at the front of the bulge." },
  { term: "Bright band", meaning: "A ring of stronger echo and lower CC around the radar where falling snow melts into rain. It isn't a storm." },
  { term: "Bunkers RM / LM", meaning: "The expected motion of a right-moving (RM) or left-moving (LM) supercell, worked out from the wind profile." },
  { term: "BWER", meaning: "Bounded weak echo region: a hole of weak echo under a strong core on higher tilts, made by an updraft too strong for rain to fall through." },
  { term: "CAPE", meaning: "Convective available potential energy, in J/kg: the fuel for updrafts. Around 1,000–2,500 is moderate, above 2,500 high." },
  { term: "CIN", meaning: "Convective inhibition, in J/kg: the lid that keeps storms from starting. Near 0 storms form easily; below about −100 J/kg it takes a strong push." },
  { term: "Couplet", meaning: "Strong inbound (green) right next to strong outbound (red) on velocity: rotation." },
  { term: "Critical angle", meaning: "The angle between the low-level inflow and the low-level wind shear. Close to 90° favours tornadoes." },
  { term: "dBZ", meaning: "Decibels of reflectivity: how strongly targets return the radar's signal. Higher is heavier rain or hail." },
  { term: "Dual-pol", meaning: "Dual polarisation: the radar sends horizontal and vertical pulses, which gives CC, ZDR, KDP and the classification." },
  { term: "Ensemble", meaning: "The same model run many times from slightly different starting conditions. How far the runs spread shows how certain the forecast is." },
  { term: "Echo tops", meaning: "The highest point where the radar still sees a set amount of echo (18 dBZ): the storm's height." },
  { term: "Hail growth zone", meaning: "The layer between 0 °C and −20 °C where hail grows fastest." },
  { term: "Hodograph", meaning: "A plot of the wind at each height, joined from the ground up. Its length is the wind shear, its curve the turning." },
  { term: "Hook echo", meaning: "A curl of echo on the back side of a supercell, wrapped around its rotation." },
  { term: "IBW", meaning: "Impact-based warnings: NWS warnings tagged with the hail size, wind speed and damage threat." },
  { term: "Inflow notch", meaning: "A notch in the echo where warm, moist air flows into the updraft." },
  { term: "kft / kt", meaning: "Thousands of feet / knots (1 kt ≈ 1.15 mph)." },
  { term: "Lapse rate", meaning: "How fast temperature drops with height. Steep lapse rates (above about 7 °C/km between 700 and 500 hPa) help strong updrafts and hail." },
  { term: "LCL", meaning: "Lifted condensation level: the height of the cloud base. Low bases (below about 1,000 m) favour tornadoes." },
  { term: "LFC", meaning: "Level of free convection: where a rising parcel starts rising on its own." },
  { term: "LI", meaning: "Lifted index: how much warmer a lifted surface parcel is than the air at 500 hPa. Negative is unstable; −6 or lower is very unstable." },
  { term: "Meteogram", meaning: "A chart of one place's forecast over time, here for several models or an ensemble at once." },
  { term: "Mesocyclone", meaning: "The rotating updraft of a supercell, a few kilometres across." },
  { term: "MRMS", meaning: "Multi-Radar Multi-Sensor: NOAA's system that blends every radar into national products." },
  { term: "Outflow boundary", meaning: "The edge of rain-cooled air spreading out from storms. New storms often form along it." },
  { term: "Overshooting top", meaning: "A dome of cloud pushed above a storm's anvil by a very strong updraft." },
  { term: "Parcel (SB / ML / MU)", meaning: "The bit of air the sounding lifts: from the surface (SB), the average of the lowest 100 hPa (ML), or the most unstable one near the ground (MU, for storms above a cool layer)." },
  { term: "PDS", meaning: "Particularly dangerous situation: wording the NWS adds to its most serious watches and warnings." },
  { term: "PWAT", meaning: "Precipitable water: all the water vapour in the column. High values mean very heavy rain is possible." },
  { term: "QLCS", meaning: "Quasi-linear convective system: a line of storms. Brief tornadoes can form along it, often at kinks in the line." },
  { term: "Range folding (RF)", meaning: "Where the radar can't tell how far away an echo is, so velocity has no data. Shown in purple." },
  { term: "RFD", meaning: "Rear-flank downdraft: air sinking on the back side of a supercell, wrapping around the tornado area." },
  { term: "Rotational velocity", meaning: "Half the sum of the strongest inbound and outbound speeds across a couplet: how fast it spins." },
  { term: "Shear", meaning: "How the wind changes with height. 0–6 km shear of 40 kt or more supports supercells; 0–1 km shear helps tornadoes." },
  { term: "Skew-T", meaning: "The sounding chart: temperature and dew point against height, with lines skewed so the layers are easy to compare." },
  { term: "SRH", meaning: "Storm-relative helicity, in m²/s²: how much the low-level wind spins into a moving storm. Above about 100–150 in the lowest 1 km favours tornadoes." },
  { term: "Supercell", meaning: "A storm with a long-lived rotating updraft. It makes most large hail and strong tornadoes." },
  { term: "TDS", meaning: "Tornado debris signature: low CC on a velocity couplet with echo present. Debris in the air from a tornado on the ground." },
  { term: "θe", meaning: "Equivalent potential temperature: a measure of air's heat and moisture together. High θe air is fuel for storms." },
  { term: "Tilt", meaning: "One of the radar's scan angles. The lowest, 0.5°, is closest to the ground." },
  { term: "TOA", meaning: "Time of arrival: when a storm on its current track reaches a place." },
  { term: "Training", meaning: "Storms moving over the same place one after another, which can cause flash floods." },
  { term: "VIL", meaning: "Vertically integrated liquid, in kg/m²: all the water in the column, from reflectivity at every tilt." },
  { term: "WSR-88D / ICAO", meaning: "The NEXRAD radars, each named by a four-letter code like KTLX." },
  { term: "Z (Zulu)", meaning: "UTC time, the standard in weather. 00Z is 8 PM Eastern daylight time the day before." },
];

export const TOUR: readonly TourStep[] = [
  {
    target: null,
    title: "Professional mode tour",
    body: "A quick walk around the workspace: about two minutes. Use Next and Back, or the arrow keys; Esc ends it any time.",
  },
  { target: "layout", title: "Layout", body: "Show 1, 2, 4 or 9 panels. Each panel is a map with its own product; they all pan, zoom and loop together." },
  { target: "site", title: "Radar site", body: "The radar the single-site panels use. Nearest follows your location; pick one to pin it." },
  { target: "tools", title: "Tools", body: "What clicking a panel does: read values, a sounding, a cross-section, storm motion and arrival times. Their results show in the side panel." },
  { target: "pane-product", title: "Product", body: "Each panel's product: radar at one site, volume scans, national mosaics, other countries' radar and satellite." },
  { target: "pane-tilt", title: "Elevation tilt", body: "For radar, which scan angle to show. 0.5° is the lowest; higher tilts look higher into storms." },
  { target: "pane-basis", title: "Time basis", body: "TB marks the panel whose scan times the loop steps through. Next to it is this panel's own scan time in UTC." },
  { target: "pane-settings", title: "Panel settings", body: "Opacity, warnings, storm cells and the cloud-free satellite map, for this panel only." },
  { target: "pane-popout", title: "Pop out", body: "Open this panel in a window of its own, for another monitor. It stays in step with the workspace." },
  { target: "pane-legend", title: "Colour scale", body: "What the colours mean, with the unit in the middle." },
  { target: "loop", title: "Loop", body: "Step, play and pause; the clock shows the loop time in UTC and the frame number. Pick how many frames to loop and how fast." },
  { target: "archive", title: "Radar archive", body: "Look back at any date since 1995, or replay a famous storm." },
  { target: "readout", title: "Readout", body: "Move the pointer over a panel and this bar reads every panel at that spot, with the range from the radar and the model's conditions there." },
  { target: "panel", title: "Side panel", body: "Results of the tool you picked: soundings, cross-sections, storm motion, warnings. Hide it, or open it in its own window." },
  {
    target: "guide",
    title: "That's the tour",
    body: "The guide is here whenever you want it, with what every product and tool shows, step-by-step how-tos and a glossary. If you don't need it, you can hide this button.",
  },
];

/** Every string in the guide (the translations must cover them all). */
export function guideStrings(): string[] {
  const out = new Set<string>();
  const topic = (g: GuideTopic) => {
    out.add(g.what);
    if (g.read) out.add(g.read);
    g.look?.forEach((s) => out.add(s));
  };
  PRO_PRODUCT_IDS.forEach((id) => topic(PRODUCT_GUIDE[id]));
  Object.values(TOOL_GUIDE).forEach((g) => {
    topic(g);
    g.steps.forEach((s) => out.add(s));
  });
  HOW_TOS.forEach((h) => [h.title, ...h.steps].forEach((s) => out.add(s)));
  BASICS.forEach((b) => [b.title, b.body].forEach((s) => out.add(s)));
  GLOSSARY.forEach((g) => out.add(g.meaning));
  TOUR.forEach((s) => [s.title, s.body].forEach((x) => out.add(x)));
  return [...out];
}

/** Case- and accent-insensitive: does `text` contain every word of `query`? */
export function matchesQuery(query: string, ...texts: string[]): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(texts.join(" "));
  return words.every((w) => hay.includes(w));
}
