import { useState, useEffect, useMemo, useRef } from "react";

// ------- design tokens: "parks department field guide" -------
const C = {
  bg: "#16211c",      // ink spruce
  panel: "#22302a",   // deep moss
  line: "#31423a",
  cream: "#ece5cf",   // field khaki
  dim: "#b9b19a",
  orange: "#f2762e",  // road-cone orange
  red: "#e2574c",
  amber: "#e8b04b",
  green: "#8fc07a",
  grass: ["#6f9d5f", "#77a566", "#689459"],
  plot: "#587f4a",
  asphalt: "#3d443f",
  dash: "#d8cfae",
  ink: "#1b130c",
  water: "#3d6b7a",
  beat: "#6fa8c4",    // patrol blue, only ever seen through the coverage lens
  school: "#d97a94",  // schoolhouse rose, same lens, different roster
  woods: "#3f6b3c",
};

const SIZE = 12;
const N = SIZE * SIZE;
const at0 = (r, c) => r * SIZE + c;

// ---- terrain ----
// A seeded PRNG so a seed always regenerates the same map.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Terrain lives in a parallel array: 0 plain, 1 woods, 2 water.
const PLAIN = 0, WOODS = 1, WATER = 2;
const CLEAR_COST = 25;   // to build on woods

function makeTerrain(seed) {
  const rnd = mulberry32(seed);
  const t = new Array(N).fill(PLAIN);

  // a river: a wandering vertical or horizontal channel that skirts the centre
  const vertical = rnd() < 0.5;
  let pos = 1 + Math.floor(rnd() * (SIZE - 2));
  for (let step = 0; step < SIZE; step++) {
    pos += Math.floor(rnd() * 3) - 1;
    pos = Math.max(0, Math.min(SIZE - 1, pos));
    const cells = vertical ? [[step, pos]] : [[pos, step]];
    if (rnd() < 0.35) cells.push(vertical ? [step, Math.min(SIZE - 1, pos + 1)] : [Math.min(SIZE - 1, pos + 1), step]);
    cells.forEach(([r, c]) => { t[at0(r, c)] = WATER; });
  }

  // a couple of woodland clumps
  const clumps = 2 + Math.floor(rnd() * 3);
  for (let k = 0; k < clumps; k++) {
    const cr = Math.floor(rnd() * SIZE), cc = Math.floor(rnd() * SIZE);
    const size = 3 + Math.floor(rnd() * 5);
    for (let n = 0; n < size; n++) {
      const r = cr + Math.floor(rnd() * 3) - 1, c = cc + Math.floor(rnd() * 3) - 1;
      const i = at0(r, c);
      if (r >= 0 && c >= 0 && r < SIZE && c < SIZE && t[i] === PLAIN) t[i] = WOODS;
    }
  }

  // Two loose trees on top of the clumps, so no map is entirely bare between
  // its woodlands. Placed last so a given seed keeps the river and clumps it
  // always had.
  for (let k = 0; k < 2; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const i = Math.floor(rnd() * N);
      if (t[i] === PLAIN) { t[i] = WOODS; break; }
    }
  }

  // City Hall's own 2x2 is always dry land; the rest is cleared by freshState
  // once it knows which side the town starts on.
  [[5,5],[5,6],[6,5],[6,6]].forEach(([r, c]) => { t[at0(r, c)] = PLAIN; });
  return t;
}

const BUILD = {
  road:    { name: "Road",        cost: 10,  icon: "🛣️", upkeep: 1, hint: "The backbone. Every building must touch one. Costs $1/day to maintain. Potholes open at random; a well-funded budget means fewer of them." },
  bridge:  { name: "Bridge",      cost: 60,  icon: "🌉", hint: "A road across water. Carries 60% of a road, so crossings jam first." },
  line:    { name: "Power Line",  cost: 5,   icon: "🗼", hint: "Carries power. Can cross roads without blocking them." },
  house:   { name: "House",       cost: 50,  icon: "🏠", pow: 1, cap: 4, hint: "Homes 4 residents and pays tax. Upgrades raise capacity to 7, 12, then 18." },
  shop:    { name: "Shop",        cost: 75,  icon: "🏪", pow: 1, jobs: 3, rev: 7, hint: "Trade income, 3 jobs. Earns most when there is 1 shop per 10 residents." },
  factory: { name: "Factory",     cost: 340, icon: "🏭", pow: 2, jobs: 10, upkeep: 5, rev: 25, pollute: true, hint: "Big industrial income, 10 jobs. Pollutes 2 tiles hard. Takes 9 days to build." },
  plant:   { name: "Power Plant", cost: 260, icon: "⚡", gen: 10, jobs: 1, upkeep: 12, pollute: true, hint: "Powers 10 units across its wires. Needs 1 operator. Pollutes 2 tiles; keeps running while upgrading." },
  park:    { name: "Park",        cost: 40,  icon: "🌳", upkeep: 1, hint: "Lifts mood for homes within 2 tiles. No road, power, or staff needed." },
  tavern:  { name: "Tavern",      cost: 90,  icon: "🍺", pow: 1, jobs: 2, rev: 4, hint: "Cheer townwide, but +2 crime and adjacent homes lose 9 mood." },
  church:  { name: "Church",      cost: 110, icon: "⛪", pow: 1, jobs: 2, upkeep: 3, faith: 1.3, hint: "Quiets crime townwide (-1.3/day), at a small cost to the town\u2019s mood. Loudspeakers within 2 tiles drown it out entirely. Maximum of 3." },
  police:  { name: "Police",      cost: 120, icon: "🚓", pow: 1, jobs: 4, upkeep: 9, hint: "Cuts crime within 3 tiles. 4 officers. Coverage scales with staffing, and sharpens a lot once the chief has new equipment." },
  camera:  { name: "Cameras",     cost: 105, icon: "📷", pow: 3, upkeep: 4, watch: 0.6, reach: 2,
    hint: "Watches 2 tiles in every direction, cutting crime where no patrol reaches. No staff and no road needed, but a heavy power draw, and the town does not love being filmed." },
  school:  { name: "School",      cost: 130, icon: "🏫", pow: 1, jobs: 4, upkeep: 5, learn: 1, hint: "Draws newcomers, +approval, -0.6 crime, and raises the tax take from homes within 3 tiles. Maximum of 3." },
  mansion: { name: "Governor's Mansion", cost: 740, icon: "\uD83C\uDFDB\uFE0F", pow: 3, jobs: 5, upkeep: 26,
    hint: "Needs to stand inside a police beat or the state will not use it. Sanders is a Conservative Tax man. Keep the city on Conservative Tax and the mansion earns you standing with him every day it stands; switch to No Tax or Progressive Tax and it earns you nothing, and provides a wonderful field trip destination for local schools. One only." },
  histcenter:{ name: "History Center", cost: 420, icon: "🏛", pow: 2, jobs: 4, upkeep: 11, edu: 0.6,
    hint: "An archive, a reading room, and the town's own story under one roof. Sharpens every school in Luckhead. Needs 4 staff." },
  stadium: { name: "Stadium",     cost: 1400, icon: "🏟️", pow: 4, jobs: 10, upkeep: 20, rev: 120, crime: 5,
    hint: "A big commercial draw and a jobs engine, but crowds bring crime. Upgrades once to a retractable roof for higher year-round revenue. Maximum of 1." },
  hall:    { name: "City Hall",   cost: 0,   icon: "🏛️", upkeep: 4, hint: "Your seat of government. Carries power through, generates none. Tap it for the budget and tax policy." },
  hallpart:{ name: "City Hall",   cost: 0,   icon: "",   hint: "Part of City Hall." },
  speaker: { name: "Loudspeakers", cost: 90, icon: "📢", pow: 1, upkeep: 3, message: 1, hint: "+2.2 approval, no staff, no road needed. Taverns and Schools within 2 tiles lose 30%; Churches within 2 tiles go silent entirely and sour the mood nearby. Maximum of 3." },
  billboard:{ name: "Campaign Billboard", cost: 70, icon: "🪧", upkeep: 1, message: 0.75, hint: "A political billboard: +1.7 approval, no staff, no power, no road. A dollar a day. PR campaigns boost it further. Maximum of 3." },
  theatre: { name: "Luckhead Theatre", cost: 900, icon: "🎭", pow: 3, jobs: 6, upkeep: 12, cheer: 8, rev: 25, trips: 20,
    hint: "The grand old stage, one of a kind. Sells out most nights, lifts the whole town's spirits. The Music Venues lose 15% of their door to it." },
  golf:    { name: "Golf Course", cost: 1600, icon: "⛳", jobs: 6, upkeep: 34, cheer: 10,
    hint: "Eighteen holes of civic vanity. Lifts the whole town's mood and greens the environment like three parks, at the steepest upkeep in Luckhead. Needs a crew of 6 and a road; no power. Maximum of 2." },
  statue:  { name: "Unity Monument", cost: 0, icon: "🏆", upkeep: 0, approval: 5,
    hint: "Raised by the town itself at 100 residents. +5 approval for as long as it stands. No upkeep, no staff, no road. Survives every successor." },
  monument:{ name: "Chief's Park",  cost: 0,   icon: "🗿", upkeep: 2, mood: 12,
    hint: "A memorial park honoring a departed police chief. Lifts nearby mood and the town's spirits. Free, but you maintain it." },
  fastpark:{ name: "Faststain Park", cost: 975, icon: "⛲", upkeep: 8, mood: 16,
    hint: "The park, singular. The whole town is proud of it, the homes beside it pay a premium in taxes, and every other park looks 5% shabbier by comparison." },
  hideaway:{ name: "Tommy's Hideaway", cost: 1050, icon: "🥃", pow: 2, jobs: 5, upkeep: 10, rev: 55, trips: 16,
    hint: "Everyone who matters drinks here, and there is only one. Big money, word of mouth that draws newcomers, and a little trouble." },
  plaza:   { name: "Pipp's Plaza", cost: 1250, icon: "🏬", pow: 4, jobs: 8, upkeep: 16, rev: 95, trips: 34,
    hint: "The biggest commercial address in Luckhead, singular. Eats 20% of every shop's trade, and will not open without a Police Station next door." },
  bank:    { name: "Bank",        cost: 340, icon: "🏦", pow: 2, jobs: 2, upkeep: 7,
    hint: "+5% industrial and commercial revenue, -4% build costs, -5% bribe cost. Stacks to 3." },
  clinic:  { name: "Clinic",      cost: 150, icon: "🩺", pow: 1, jobs: 2, upkeep: 7, care: 1, hint: "+1 care: happiness and approval. A quarter of a Hospital at a third the cost." },
  hospital:{ name: "Hospital",    cost: 420, icon: "🏥", pow: 3, jobs: 8, upkeep: 26, care: 4, hint: "Serious medicine. Lifts the whole town's health and its opinion of you." },
  prison:  { name: "Prison",      cost: 260, icon: "🏛", pow: 2, jobs: 4, upkeep: 13, hold: 2.6, gloom: 7, hint: "Calms crime townwide. Homes within 2 tiles lose 7 mood, and the grounds cost the town clean air." },
  venue:   { name: "Music Venue", cost: 180, icon: "🎸", pow: 2, jobs: 5, upkeep: 4, rev: 18, cheer: 6, rowdy: 2.5, trips: 26, hint: "Cheer and good money, but heavy traffic, +2.5 crime, and homes within 2 tiles lose mood to the noise." },
  subway:  { name: "Subway Stop",  cost: 260, icon: "🚇", pow: 2, jobs: 2, upkeep: 14, relief: 0.85,
    hint: "Cuts traffic hard on nearby roads and townwide. Needs a partner stop, like buses." },
  bus:     { name: "Bus Station", cost: 100, icon: "🚌", pow: 1, jobs: 2, upkeep: 6, relief: 0.5, hint: "Cuts traffic on roads it touches and townwide. Useless alone; needs a partner." },
};

// Upgrades apply cumulatively. Police get exactly one.
const UPGRADES = {
  house:   [{ name: "Duplex",          cost: 60,  set: { cap: 7 } },
            { name: "Row Houses",      cost: 110, set: { cap: 11, pow: 2 } },
            { name: "Apartments",      cost: 200, set: { cap: 18, pow: 3 } }],
  shop:    [{ name: "Corner Store",    cost: 80,  set: { jobs: 5, rev: 13 } },
            { name: "Market",          cost: 150, set: { jobs: 8, pow: 2, rev: 20 } },
            { name: "Galleria",        cost: 260, set: { jobs: 12, pow: 3, rev: 30 } }],
  factory: [{ name: "Assembly Line",   cost: 280, set: { jobs: 16, upkeep: 7, rev: 48 } },
            { name: "Foundry",         cost: 460, set: { jobs: 24, pow: 3, upkeep: 10, rev: 74 } },
            { name: "Industrial Park", cost: 720, set: { jobs: 34, pow: 4, upkeep: 14, rev: 112 } }],
  plant:   [{ name: "Second Turbine",  cost: 180, set: { gen: 18, jobs: 2, upkeep: 16 } },
            { name: "Gas Conversion",  cost: 320, set: { gen: 30, jobs: 3, upkeep: 21 } },
            { name: "Solar Retrofit",  cost: 520, set: { gen: 44, jobs: 2, upkeep: 18, clean: true } }],
  park:    [{ name: "Playground",      cost: 45,  set: { mood: 14, upkeep: 2 } },
            { name: "Botanical Garden",cost: 90,  set: { mood: 19, upkeep: 3 } },
            { name: "Central Park",    cost: 170, set: { mood: 25, upkeep: 5 } }],
  tavern:  [{ name: "Alehouse",        cost: 95,  set: { jobs: 3, rev: 8, cheer: 3 } },
            { name: "Music Hall",      cost: 170, set: { jobs: 5, rev: 13, cheer: 5, pow: 2 } },
            { name: "Grand Saloon",    cost: 290, set: { jobs: 7, rev: 19, cheer: 7, pow: 2 } }],
  church:  [{ name: "Parish Hall",     cost: 120, set: { jobs: 3, upkeep: 4, faith: 2.3 } },
            { name: "Cathedral",       cost: 220, set: { jobs: 5, upkeep: 6, faith: 5, pow: 2 } },
            { name: "Basilica",        cost: 380, set: { jobs: 7, upkeep: 8, faith: 7, pow: 2 } }],
  hall:    [{ name: "Secured City Hall", cost: 260, set: { upkeep: 11, jobs: 2, guard: 3 } }],
  police:  [{ name: "RoboCops",        cost: 300, set: { jobs: 1, upkeep: 16, reach: 4 } }],
  school:  [{ name: "Middle School",   cost: 140, set: { jobs: 6, upkeep: 7, learn: 1.6, reach: 4 } },
            { name: "High School",     cost: 240, set: { jobs: 9, upkeep: 10, learn: 2.3, pow: 2 } },
            { name: "Community College", cost: 400, set: { jobs: 13, upkeep: 14, learn: 3.2, pow: 2, reach: 5 } }],
  speaker: [{ name: "Public Address",  cost: 100, set: { upkeep: 4, message: 1.6 } },
            { name: "Civic Broadcast", cost: 170, set: { upkeep: 6, message: 2.2, pow: 2 } },
            { name: "The Voice of Luckhead", cost: 280, set: { upkeep: 9, message: 3, pow: 2 } }],
  clinic:  [{ name: "Health Center", cost: 160, set: { jobs: 3, upkeep: 9, care: 1.5 } },
            { name: "Medical Practice", cost: 260, set: { jobs: 4, upkeep: 12, care: 2, pow: 2 } },
            { name: "Urgent Care",   cost: 400, set: { jobs: 6, upkeep: 16, care: 2.75, pow: 2 } }],
  hospital:[{ name: "Regional Hospital", cost: 460, set: { jobs: 11, upkeep: 33, care: 5.5 } },
            { name: "Medical Center", cost: 700, set: { jobs: 15, upkeep: 42, care: 7.5, pow: 4 } },
            { name: "Teaching Hospital", cost: 980, set: { jobs: 20, upkeep: 55, care: 10, pow: 4 } }],
  prison:  [{ name: "County Jail",    cost: 290, set: { jobs: 6, upkeep: 17, hold: 6, gloom: 9 } },
            { name: "Penitentiary",  cost: 470, set: { jobs: 9, upkeep: 24, hold: 8.5, pow: 3, gloom: 11 } },
            { name: "Correctional Campus", cost: 720, set: { jobs: 13, upkeep: 32, hold: 11, pow: 3, gloom: 13 } }],
  venue:   [{ name: "Concert Hall",   cost: 200, set: { jobs: 7, upkeep: 6, rev: 30, cheer: 9, rowdy: 3.5, trips: 38 } },
            { name: "Amphitheater",  cost: 330, set: { jobs: 10, upkeep: 9, rev: 46, cheer: 12, rowdy: 4.5, trips: 52, pow: 3 } },
            { name: "Arena",         cost: 520, set: { jobs: 14, upkeep: 13, rev: 68, cheer: 15, rowdy: 6, trips: 72, pow: 3 } }],
  subway:  [{ name: "Second Platform", cost: 300, set: { jobs: 3, upkeep: 19, relief: 1.05 } },
            { name: "Interchange",     cost: 480, set: { jobs: 4, upkeep: 25, relief: 1.3, pow: 3 } },
            { name: "Metro Line",      cost: 720, set: { jobs: 6, upkeep: 33, relief: 1.6, pow: 3 } }],
  bus:     [{ name: "Transit Hub",     cost: 130, set: { jobs: 3, upkeep: 8, relief: 0.68 } },
            { name: "Rail Link",       cost: 230, set: { jobs: 5, upkeep: 6, relief: 0.68, pow: 2 } },
            { name: "Central Station", cost: 380, set: { jobs: 7, upkeep: 8, relief: 0.8, pow: 2 } }],
  stadium: [{ name: "Retractable Roof", cost: 700, set: { rev: 175, upkeep: 26, pow: 5 } }],
};

// Construction time in days. Upgrades take half as long, rounded up.
const BUILD_DAYS = { house: 3, park: 3, factory: 9, road: 0, line: 0, bridge: 3, theatre: 7, hideaway: 7, plaza: 7, fastpark: 7, mansion: 7, histcenter: 8, stadium: 10, hall: 0, hallpart: 0 };
const SPECIALTY = new Set(["theatre", "hideaway", "plaza", "fastpark", "mansion"]);
// Buildings the town will only tolerate so many of.
const BUILD_CAP = { church: 3, speaker: 3, bank: 3, billboard: 3, school: 3, stadium: 1, histcenter: 1, mansion: 1, golf: 2 };
const buildDays = (t) => (BUILD_DAYS[t] !== undefined ? BUILD_DAYS[t] : 5);
const upgradeDays = (t) => Math.ceil(buildDays(t) / 2);

const maxLevel = (t) => (UPGRADES[t] ? UPGRADES[t].length : 0);
// During an upgrade a Power Plant keeps running at its previous tier; the new
// capacity arrives only when the crew finishes.
const plantStats = (cell) =>
  cell.build > 0 && cell.up ? statsOf({ ...cell, lv: (cell.lv || 1) - 1 }) : statsOf(cell);
const INFRA = new Set(["road", "line", "bridge"]);
// A single dial for how expensive building is overall.
// ---- difficulty ----
// Three independent dials chosen at the start. Medium is the tuned baseline
// (all multipliers 1.0); Easy softens, Hard sharpens, and each contributes to
// the final score. The three score multipliers multiply together.
const DIFFICULTY = {
  economy: {
    easy:   { label: "Easy",   score: 0.8, cash: 9000, cost: 0.9,  upkeep: 0.85, blurb: "More cash, cheaper building and upkeep." },
    medium: { label: "Medium", score: 1.0, cash: 6000, cost: 1.0,  upkeep: 1.0,  blurb: "The standard economy." },
    hard:   { label: "Hard",   score: 1.6, cash: 3000, cost: 1.15, upkeep: 1.2,  blurb: "Lean treasury, pricier everything." },
  },
  politics: {
    easy:   { label: "Easy",   score: 0.8, honeymoon: 38, fatigue: 1.5, inertia: 0.04, blurb: "Bigger honeymoon, slower fatigue, steadier approval." },
    medium: { label: "Medium", score: 1.0, honeymoon: 31, fatigue: 2.5, inertia: 0.05, blurb: "The standard electorate. Still 51% to win." },
    hard:   { label: "Hard",   score: 1.6, honeymoon: 21, fatigue: 3.5, inertia: 0.07, blurb: "Short honeymoon, fast fatigue, twitchier approval." },
  },
  crime: {
    easy:   { label: "Easy",   score: 0.8, pressure: 0.75, heat: 0.7, mob: 0.8, blurb: "Crime builds slowly, federal heat runs cool." },
    medium: { label: "Medium", score: 1.0, pressure: 1.0,  heat: 1.0, mob: 1.0, blurb: "The standard underworld." },
    hard:   { label: "Hard",   score: 1.7, pressure: 1.3,  heat: 1.35, mob: 1.25, blurb: "Crime spikes fast, the Bureau is relentless." },
  },
};
const START_ENV = 88;        // a young town starts nearly clean
const DEFAULT_DIFF = { economy: "medium", politics: "medium", crime: "medium" };
// Resolve a diff selection into the concrete numbers the engine reads.
function diffOf(diff) {
  const d = diff || DEFAULT_DIFF;
  return {
    economy: DIFFICULTY.economy[d.economy] || DIFFICULTY.economy.medium,
    politics: DIFFICULTY.politics[d.politics] || DIFFICULTY.politics.medium,
    crime: DIFFICULTY.crime[d.crime] || DIFFICULTY.crime.medium,
  };
}
function scoreMult(diff) {
  const r = diffOf(diff);
  return r.economy.score * r.politics.score * r.crime.score;
}

const HEAD_TAX = 1.15;       // residents pay slightly better than they used to
const COST_SCALE = 1.12;
const LOAN_PENALTY = 0.05;   // each loan raises build costs 5%, permanently
const GRAFT_PENALTY = 0.07;  // score lost per dollar of Tsui money taken
const DEBT_FLOOR = -3000;    // past this the state takes the city off your hands
const MODAL_GAP = 7;         // quiet days after something that could end the run
const MODAL_GAP_SOFT = 17;   // and a longer breather after routine business
// Interruptions that genuinely cannot wait. Everything else is business.
const URGENT_MODALS = new Set(["heir", "vote", "fed", "indict", "chief", "arson", "shooting", "tsuiloan", "hush", "potus", "audit", "rally", "slander", "marla", "votes"]);
const costOf = (t, taxKey, banks = 0, loans = 0, costMul = 1) => {
  const base = Math.round(BUILD[t].cost * COST_SCALE * costMul * (1 + LOAN_PENALTY * (loans || 0)) * (1 - 0.04 * Math.min(3, banks)));
  const T = TAX[taxKey] || TAX.normal;
  return INFRA.has(t) ? Math.max(1, Math.round(base * T.infra)) : base;
};
const upCostOf = (cell, banks = 0, loans = 0, costMul = 1) => {
  const up = nextUp(cell);
  return up ? Math.round(up.cost * COST_SCALE * costMul * (1 + LOAN_PENALTY * (loans || 0)) * (1 - 0.04 * Math.min(3, banks))) : 0;
};

const statsOf = (cell) => {
  const base = BUILD[cell.type];
  const lv = cell.lv || 0;
  if (!lv || !UPGRADES[cell.type]) return base;
  let out = { ...base };
  for (let k = 0; k < lv; k++) out = { ...out, ...UPGRADES[cell.type][k].set };
  return out;
};

const labelOf = (cell) => {
  if (cell.type === "statue") return "Unity Monument";
  if (cell.type === "monument") return cell.name || "Chief's Park";
  const lv = cell.lv || 0;
  return lv && UPGRADES[cell.type] ? UPGRADES[cell.type][lv - 1].name : BUILD[cell.type].name;
};

const nextUp = (cell) => {
  const lv = cell.lv || 0;
  return UPGRADES[cell.type] && lv < maxLevel(cell.type) ? UPGRADES[cell.type][lv] : null;
};

const investedIn = (cell) => {
  let total = BUILD[cell.type].cost;
  for (let k = 0; k < (cell.lv || 0); k++) total += UPGRADES[cell.type][k].cost;
  return Math.round(total * COST_SCALE);
};
const BUILD_KEYS = ["road", "bridge", "line", "house", "shop", "factory", "plant", "park", "tavern", "church", "police", "camera", "school", "bus", "venue", "clinic", "hospital", "prison", "histcenter", "mansion", "stadium", "golf", "speaker", "billboard", "bank", "subway", "theatre", "hideaway", "plaza", "fastpark"];
const UNLOCK_DAY = { speaker: 40, billboard: 40, camera: 100, bank: 70 };
// Day-gated unlocks, announced the same way population ones are. Keep this in
// ascending day order for the same reason the population list is ordered: the
// counter walks it front to back.
const DAY_MILESTONES = [
  { day: 40, title: "A VOICE FROM ABOVE", keys: ["speaker", "billboard"],
    body: "A contractor has offered the city a network of civic loudspeakers, and the print shop on Third will run campaign billboards for anyone who pays. Both talk to the town for you. Neither is subtle.",
    tip: "Keep loudspeakers away from Taverns and Schools. Nobody learns or drinks well over a public address system." },
  { day: 70, title: "THE BANK OPENS", keys: ["bank"],
    body: "Luckhead is finally worth a branch. A Bank shaves the cost of everything you build, up to three of them, and a city with one can borrow honestly when the treasury runs dry.",
    tip: "The alternative to a bank loan is somebody else's money, and that comes with conditions." },
  { day: 100, title: "EYES ON THE STREET", keys: ["camera"],
    body: "Street cameras watch a small patch of ground without a single officer on the payroll. They cost power and they cost goodwill, but they never call in sick.",
    tip: "Weaker than a Police Station and cheaper to staff, which is none. Use them to patch the corners a patrol misses." },
];
// Some buildings unlock only after a prerequisite building exists.
const UNLOCK_AFTER = {};
const UNLOCK = { church: 15, factory: 15, school: 26, clinic: 34, prison: 34, bus: 40, subway: 64, hospital: 52, venue: 52, theatre: 58, hideaway: 70, plaza: 70, fastpark: 46 };
// Popups fire the first time the town reaches each milestone. Keep this list in
// ascending population order: the unlock counter walks it front to back and
// stops at the first entry it has not reached, so an out-of-order threshold is
// held hostage and then swallows the popup listed before it.
const MILESTONES = [
  { pop: 15, title: "FAITH AND INDUSTRY", keys: ["church", "factory"],
    body: "Luckhead can support industry and a congregation. Factories export goods for real money but demand a small army of workers and foul the air for two tiles. Churches quiet crime across the whole town.",
    tip: "Keep factories away from housing. Churches work from anywhere." },
  { pop: 26, title: "SCHOOLS OPEN", keys: ["school"],
    body: "Schools draw families to Luckhead, lift approval, and keep young people out of trouble. They cost real upkeep and need a full staff.",
    tip: "Their pull on newcomers compounds. Build early." },
  { pop: 34, title: "ORDER AND MEDICINE", keys: ["prison", "clinic"],
    body: "Two institutions a real town needs. A Prison calms crime across the whole map wherever you put it. A Clinic keeps people well, lifting both happiness and your approval.",
    tip: "Both cost real upkeep. Neither works next to a factory." },
  { pop: 40, title: "PUBLIC TRANSIT", keys: ["bus"],
    body: "Bus Stations shed traffic from every road they touch, and a working network eases congestion across the entire town.",
    tip: "A lone station does nothing. Build at least two." },
  { pop: 46, title: "THE PARK, SINGULAR", keys: ["fastpark"],
    body: "Faststain Park is the first landmark Luckhead can claim. No staff, no power lines, nothing but ground and civic pride. The homes beside it pay a premium in tax, and every other park in town looks a little shabbier from the day it opens.",
    tip: "It asks for money and space and nothing else. Put it where people live." },
  { pop: 52, title: "A SCENE AND A HOSPITAL", keys: ["hospital", "venue"],
    body: "A Hospital is four times the Clinic in every direction: happiness, approval, staffing, and cost. A Music Venue lifts the town's mood and earns well, but draws crowds, cars, and trouble.",
    tip: "Keep both out of the smog, and the venue away from housing." },
  { pop: 59, title: "THE GRAND OLD STAGE", keys: ["theatre"],
    body: "The Luckhead Theatre sells out most nights and lifts the spirits of the whole town. It wants real power and a real staff, and every Music Venue you own loses 15% of its door to it.",
    tip: "Worth it for the mood alone. Your venues will not see it that way." },
  { pop: 63, title: "WORTH REMEMBERING", keys: ["histcenter"],
    body: "Luckhead has been around long enough to have a story about itself. A History Center gives the town somewhere to keep it, teaches the young, and quietly tells everyone the place is permanent.",
    tip: "One only. It earns nothing and it is worth building anyway." },
  { pop: 67, title: "UNDERGROUND", keys: ["subway", "stadium"],
    body: "Luckhead can dig. Subway Stops clear traffic far harder than buses, near and townwide, but cost real money to run and need a partner stop like any transit.",
    tip: "Two stops minimum. They share the network with your buses." },
  { pop: 72, title: "THE LAST ADDRESSES", keys: ["hideaway", "plaza"],
    body: "The two landmarks a town only builds when it has arrived. Tommy's Hideaway pours real money and pulls newcomers in by word of mouth, with a little trouble behind it. Pipp's Plaza is the biggest commercial address in Luckhead, and it takes 20% of every shop's trade to be there.",
    tip: "The Plaza will not open without a Police Station beside it." },
  { pop: 80, title: "EIGHTEEN HOLES", keys: ["golf"],
    body: "Luckhead is prosperous enough to waste ground beautifully. A Golf Course lifts the whole town's mood and does the environmental work of three parks, at the steepest upkeep on the books. Nothing in town costs more to keep mowed.",
    tip: "Governor Sanders plays. That will come up." },
];
// The popup, not raw population, gates a building. This map ties each key to the
// milestone that introduces it, so availability and the popup are the same event.
const MILESTONE_POP = {};
MILESTONES.forEach((m) => (m.keys || []).forEach((k) => { MILESTONE_POP[k] = m.pop; }));
const CONDUCT = new Set(["line", "plant", "house", "shop", "factory", "police", "tavern", "church", "school", "bus", "venue", "prison", "clinic", "hospital", "speaker", "camera", "bank", "subway", "theatre", "hideaway", "plaza", "histcenter", "mansion", "stadium", "golf", "hall", "hallpart"]);
const conducts = (cell) => !!cell && (CONDUCT.has(cell.type) || cell.wire === true);
const isCarriageway = (cell) => !!cell && (cell.type === "road" || cell.type === "bridge");
const econOf = (t, cell) => {
  const b = cell ? statsOf(cell) : BUILD[t];
  const bits = [];
  if (b.cap) bits.push(`+$${b.cap}/day tax potential`);
  if (b.rev) bits.push(`+$${b.rev}/day revenue at full demand`);
  if (b.upkeep) bits.push(`-$${b.upkeep}/day upkeep`);
  return bits.join(", ");
};

const TIERS = [
  { min: 0,   name: "Settlement" },
  { min: 10,  name: "Village" },
  { min: 25,  name: "Town" },
  { min: 60,  name: "City" },
  { min: 120, name: "Metropolis" },
];

// Read out at every promotion. Five quotations across four possible tier-ups,
// so a single run never hears the same one twice and no two runs are alike.
const GOV_QUOTES = [
  { text: "Under socialism all will govern in turn and will soon become accustomed to no one governing.",
    who: "Vladimir Lenin", src: "The State and Revolution, 1917" },
  { text: "The whole art of government consists in the art of being honest.",
    who: "Thomas Jefferson", src: "A Summary View of the Rights of British America, 1774" },
  { text: "I have simplified my politics into an utter detestation of all existing governments.",
    who: "Lord Byron", src: "Letters and Journals" },
  { text: "It is much more important to kill bad bills than to pass good ones.",
    who: "Calvin Coolidge", src: "The Autobiography of Calvin Coolidge, 1929" },
  { text: "All forms of the state have democracy for their truth, and for that reason are false to the extent that they are not democracy.",
    who: "Karl Marx", src: "Critique of Hegel's Philosophy of Right, 1843" },
  { text: "I would not vote for the mayor. It's not just because he didn't invite me to dinner, but because on my way into town from the airport there were such enormous potholes.",
    who: "Fidel Castro", src: "Interview with the New York Times, 1995" },
  { text: "You never agree with any one candidate 100 percent. I don't agree with myself 100 percent.",
    who: "Rudy Giuliani", src: "" },
  { text: "Don't blame the boss. He has enough problems.",
    who: "Donald Rumsfeld", src: "Rumsfeld's Rules" },
  { text: "Every anarchist is a baffled dictator.",
    who: "Benito Mussolini", src: "Attributed" },
  { text: "When the burdens of the presidency seem unusually heavy, I always remind myself it could be worse. I could be a mayor.",
    who: "Lyndon B. Johnson", src: "" },
  { text: "It makes no difference if I burn my bridges behind me. I never retreat.",
    who: "Fiorello La Guardia", src: "Mayor of New York, 1934 to 1945" },
  { text: "Chicago is the largest city in the country without mayoral term limits. This has led to entrenched leaders, a lack of new ideas and creative thinking, and a city government that works for the few, not the many.",
    who: "Lori Lightfoot", src: "Mayor of Chicago, 2019 to 2023" },
  { text: "I'm serving people. I'm saving taxpayers money. And you know what, I made mistakes. What can I say? I made a mistake, I'm human.",
    who: "Rob Ford", src: "Mayor of Toronto, at a toy drive, 2013" },
];

const FLAVOR = [
  "A citizen suggested the factory could smell less like regret.",
  "Roads to nowhere are still roads. Philosophically.",
  "Parks: nature's customer service.",
  "The pigeons have unionized. No demands yet.",
  "Approval rating: you. You are the approval rating.",
  "Someone painted the water tower. We do not have a water tower.",
  "The pigeons approve of the new perches.",
];

// Three ways to run Luckhead. Chosen once, at the door.
const MAYORS = {
  jenkins: { name: "Mayor Jenkins", icon: "🎩",
    blurb: "The Jenkins name is notorious in Luckhead. With the influence comes baggage, but the family has learned some tricks along the way.",
    effects: ["Starts in business with the Tsui family: a flat $20 a day, and Vincent never renegotiates",
              "Federal heat builds 35% slower",
              "The family name keeps crime a little warmer",
              "Family loyalty: Leroy and Sylvester Jenkins both work harder for a brother"],
    heat: 0.65, crimeRow: 1.2 },
  mulaney: { name: "Mayor Mulaney", icon: "🤵",
    blurb: "Charismatic and big business. His don't-rock-the-boat attitude plays well in every room.",
    effects: ["Industrial revenue +10%",
              "Starts at +1 standing with the Governor",
              "Nothing quite boils over: protests, strikes and public outcries are 30% rarer"],
    ind: 1.1, govRel: 1, calm: 0.7 },
  debbs: { name: "Mayor Debbs", icon: "✊",
    blurb: "A firebrand with a leftward lean. The program is the program, and the program is not negotiable.",
    effects: ["Tax policy locked to High Tax",
              "Commercial and industrial revenue -10%",
              "Clinics, hospitals, schools, transit, loudspeakers and billboards all work 25% better",
              "The city runs visibly well: a standing mood bump that softens the tax bite",
              "The President has decided she is a socialist: starts at -1 federal standing"],
    ind: 0.9, shop: 0.9, care: 1.25, learn: 1.25, msg: 1.25, relief: 1.25, mood: 4, fedFavor: -1, taxLock: "high" },
};

const TSUI_LOAN_TRIGGER = 500;   // treasury low-water mark that brings the offer
const TSUI_LOAN_AMOUNT = 2000;
const TSUI_LOAN_DAYS = 90;       // how long the force stays gutted afterward
const TSUI_LOAN_COOL = 120;      // decent interval before he raises it again
const TSUI_LOAN_ODDS = 0.008;    // daily chance a partner gets asked, broke or not
// The governor keeps his own file on Luckhead. He is business-friendly, church-
// going, and no friend of city government on principle, but he can be dealt
// with. Four moments across a long administration: three asks and a reckoning.
// Money taken from the Tsuis does not stay secret from a statehouse, so graft
// quietly eats the goodwill whatever the mayor says to his face.
const GOV_ASK_DAY = 85;             // when the statehouse first writes: late enough in a
                                    // first term that the mayor has a city worth courting
const GOV_DEADLINE = 120;           // how long he waits for a residence before giving up
const GOV_BEAT_GAP = 90;            // days between his letters once the house is standing
const GOV_BREAKFAST_DAYS = 90;      // how long the prayer breakfast moves the congregations
const GOV_GRAFT_PER_DOUBT = 2500;   // dollars of graft that cost one point of standing
const GOV_BACKING_DRAG = 3;         // extra daily approval bleed once he funds your rival
const MAFIA_POP = 30;

// Tax policy. Multipliers apply to revenue, police reach, plant output and upkeep,
// infrastructure cost, approval drift, and migration speed.
const TAX = {
  none: {
    name: "No Tax", short: "None", icon: "🕊️",
    taxRate: 0, approval: +9, police: 0.7, plantUpkeep: 1.35, plantGen: 1, civic: 1.35,
    infra: 1.5, growth: 1.3, potholeMul: 1.6,
    blurb: "No tax revenue at all. The town adores you. Police lose their edge, roads and plants cost more to run, potholes open more often, and newcomers pour in.",
  },
  normal: {
    name: "Conservative Tax", short: "Conservative", icon: "⚖️",
    taxRate: 1, approval: 0, police: 1, plantUpkeep: 1, plantGen: 1, civic: 1,
    infra: 1, growth: 1, potholeMul: 1,
    blurb: "The default. Standard revenue, no bonuses, no penalties. Nobody writes songs about it.",
  },
  high: {
    name: "High Tax", short: "High", icon: "🏛️",
    taxRate: 1.5, approval: -7, police: 1, plantUpkeep: 0.8, plantGen: 1.2, civic: 0.8,
    infra: 0.75, growth: 0.85, potholeMul: 0.55,
    blurb: "More revenue per resident. Plants run better, roads and lines are cheaper to build, and better-funded crews mean fewer potholes. The town resents you for it.",
  },
};
const TAX_KEYS = ["none", "normal", "high"];

// Police funding. Staff delta changes the roster per station.
const FUND = {
  lean:   { name: "Shoestring", icon: "🪙", staff: -1, upkeep: 0.5, crime: +2.5, approval: -3,
            blurb: "Half the upkeep and one fewer officer per station. Crime creeps up and nobody is impressed." },
  normal: { name: "Normal Funding", icon: "🚓", staff: 0, upkeep: 1, crime: 0, approval: 0,
            blurb: "Standard rosters, standard cost. No bonuses either way." },
  max:    { name: "Maximum Funding", icon: "🛡️", staff: +1, upkeep: 1.25, crime: -3, approval: +3,
            blurb: "An extra officer per station and 25 percent more upkeep. Crime falls and the town feels safer." },
};
const FUND_KEYS = ["lean", "normal", "max"];

// Public works: where the road money goes. Paving buys traffic relief with
// money and clean air; thrift buys money with congestion; transit bets the
// budget on buses and subways and lets the asphalt fend for itself.
const WORKS = {
  thrift:  { name: "Bare Minimum", icon: "\uD83E\uDE99", roadUp: 0.55, roadFlow: 0.86, transit: 0.9, env: +2, approval: -2, potholeMul: 1.7,
             blurb: "Roads cost 45 percent less to maintain and carry noticeably less. Potholes everywhere, and the town notices." },
  balanced:{ name: "Balanced", icon: "\uD83D\uDEA7", roadUp: 1, roadFlow: 1, transit: 1, env: 0, approval: 0, potholeMul: 1,
             blurb: "Standard maintenance on roads and transit alike. No bonuses either way." },
  paving:  { name: "Pave Everything", icon: "\uD83D\uDEA7", roadUp: 1.5, roadFlow: 1.22, transit: 0.95, env: -5, approval: +2, potholeMul: 0.6,
             blurb: "Half again the road upkeep. Traffic flows far better, the air gets worse, and drivers are happy." },
  transit: { name: "Transit First", icon: "\uD83D\uDE87", roadUp: 0.85, roadFlow: 0.9, transit: 1.45, env: +5, approval: 0, potholeMul: 1.2,
             blurb: "Buses and subways work 45 percent harder and the roads are left to age. Cleaner air, rougher asphalt." },
};
const WORKS_KEYS = ["thrift", "balanced", "paving", "transit"];

// The city's lawyer, hired once the mayor has survived a re-election and has
// something worth defending. Federal heat has never had an answer other than
// stepping aside; each of these is a different kind of answer, and each costs
// something the other two do not.
const LAWYERS = {
  nace: { name: "Nancy Nace", icon: "\u2696\uFE0F",
    line: "Litigates everything, apologises for nothing, and has never lost to the state.",
    fee: 9, heat: 0.55, gov: -1, approval: +2, graftShield: 0,
    effects: ["Federal heat builds 45% slower", "+2 approval", "The governor finds her impossible", "$9 a day"] },
  jenkins: { name: "Sylvester Jenkins", icon: "\uD83D\uDDDC\uFE0F",
    line: "Leroy Jenkins's brother. Files things where nobody looks, and does not ask what he is filing.",
    fee: 14, heat: 0.4, gov: 0, approval: -3, graftShield: 1, tsuiCover: 1,
    effects: ["Federal heat builds 60% slower", "Sanders never hears about the family's money", "The arrangement stays out of the papers", "-3 approval, people talk", "$14 a day", "With a Jenkins in City Hall: heat builds 70% slower"] },
  ginsberg: { name: "Judy Ginsberg", icon: "\uD83D\uDCD8",
    line: "By the book, every page, whether or not the book helps you.",
    fee: 6, heat: 0.9, gov: +1, approval: +4, graftShield: 0,
    effects: ["Federal heat builds 10% slower", "+4 approval", "The statehouse trusts her", "$6 a day, the cheapest honest counsel"] },
};
const LAWYER_KEYS = ["nace", "jenkins", "ginsberg"];
const FED_GRANT_RATE = 10;      // dollars a day at neutral standing in a town of forty
const FED_FAVOR_MIN = -2, FED_FAVOR_MAX = 2;
// What each level of presidential regard is worth as a multiple of the rate.
const FED_FAVOR_MULT = { "-2": 0, "-1": 0.5, "0": 1, "1": 1.5, "2": 2.2, "3": 3 };
// How often Washington remembers Luckhead exists when handing out cheques.
const FED_GRANT_WEIGHT = { "-2": 0.2, "-1": 0.5, "0": 1, "1": 1.8, "2": 2.6, "3": 3.4 };
const FED_FAVOR_NAME = { "-2": "cut off", "-1": "reduced", "0": "standard", "1": "favoured", "2": "a personal friend", "3": "immune to federal scrutiny" };
// Hosted, allowed ICE in, let him have Nace. Undo any one and the immunity is
// gone; it was his patience, not a trophy that stays earned.
const fedComplete = (st) => st.stolenVotes === 2
  || (st.pvisit === 2 && st.ice === 2 && !!st.lawyerLocked);
const fedFavorOf = (st) => {
  const cap = fedComplete(st) ? 3 : FED_FAVOR_MAX;
  return Math.max(FED_FAVOR_MIN, Math.min(cap, st.fedFavor || 0));
};
// Sanders keeps a discretionary line for towns he likes. Small next to
// Washington's, and a statehouse that has gone cool on you simply stops writing.
const GOV_GRANT_RATE = 6;       // dollars a day at solid standing in a town of forty
const GOV_GRANT_MULT = { "-3": 0, "-2": 0, "-1": 0, "0": 0.35, "1": 0.7, "2": 1, "3": 1.4, "4": 1.8 };
const govStandingOf = (st) => {
  const LW = LAWYERS[st.lawyerId];
  const heard = (st.graft || 0) * (LW && LW.graftShield ? 0 : 1) * (st.testified ? 0.35 : 1);
  return (st.govRel || 0) - Math.floor(heard / GOV_GRAFT_PER_DOUBT) + (LW ? LW.gov : 0);
};
const govGrantOf = (st, pop) => {
  if (st.schoolAudit) return 0;                  // the education audit stops everything
  if (!st.govAsk || st.govAsk === 4) return 0;   // he has to be dealing with you at all
  const scale = Math.max(0.4, Math.min(3, Math.floor(pop || 0) / 40));
  const key = String(Math.max(-3, Math.min(4, govStandingOf(st))));
  return Math.round(GOV_GRANT_RATE * scale * (GOV_GRANT_MULT[key] || 0));
};
const fedGrantOf = (st, pop) => {
  if (st.schoolAudit) return 0;   // the education audit stops everything
  const scale = Math.max(0.4, Math.min(3, Math.floor(pop || 0) / 40));
  return Math.round(FED_GRANT_RATE * scale * FED_FAVOR_MULT[String(fedFavorOf(st))]);
};
// Nobody stops moving to a town the moment it dips. Between the floor and here
// arrivals thin out steeply; below the floor the place is emptying anyway.
const GROWTH_FLOOR = 30;
const GROWTH_EASY = 45;
const glumGrowth = (hap) => hap >= GROWTH_EASY ? 1
  : Math.max(0.12, 0.12 + 0.88 * ((hap - GROWTH_FLOOR) / (GROWTH_EASY - GROWTH_FLOOR)));
const JUDY_ODDS = 0.006;        // daily chance the campaign finds her
const JUDY_DAYS = 90;           // how long the goodwill lasts
const JUDY_APPROVAL = 2;
const FEUD_ODDS = 0.005;        // daily chance the two of them go public
const FEUD_MIN_DAY = 100;       // but never before this, so the question lands late in a
                                // first term rather than before the mayor has a record
const SCHOOL_AUDIT_FRAC = 0.85; // coverage the audit expects
const SCHOOL_AUDIT_DAYS = 30;   // days below it before Washington acts
const STAFF_OFFER_DAY = 35;     // when City Hall points out the empty desks
const COMMS_SIGNING = 30;       // signing fee, in days of the new director's rate
const COMMS = {
  krauthammer: { name: "Marla Krauthammer", icon: "\uD83D\uDCBC", fee: 12,
    line: "Twenty years of corporate PR. Knows which numbers a board wants to hear.",
    trade: 1.1, growth: 1, mood: 0, approval: 0,
    effects: ["Commercial and industrial revenue +10%", "$12 a day"] },
  klein: { name: "Ross Klein", icon: "\uD83D\uDCF1", fee: 8,
    line: "Young, quick, and never off his phone. People move to towns they have heard of.",
    trade: 1, growth: 1.18, mood: 4, approval: 0,
    effects: ["Newcomers arrive 18% faster", "+4 town mood", "$8 a day"] },
  stoneman: { name: "Richard Stoneman", icon: "\uD83C\uDFAC", fee: 10,
    line: "Managed actors for thirty years. Will make you look good on camera and says so.",
    trade: 1, growth: 1, mood: 0, approval: 3,
    effects: ["+3 approval", "$10 a day"] },
};
const COMMS_KEYS = ["krauthammer", "klein", "stoneman"];
const LAWYER_SIGNING = 45;      // the signing fee, in days of the new attorney's rate
const LAWYER_HANDOVER = 15;     // days before new counsel is any use on a live file
const HONEYMOON = 20;   // goodwill during the first term, fading after
const APPROVAL_INERTIA = 0.05;   // how fast approval chases its target; lower = steadier
const CRIME_APPROVAL = 0.06;     // approval lost per point of crime over the threshold
const FATIGUE = 2.5;    // approval target lost per term already served
const FATIGUE_CAP = 15; // levels off after six terms
const SUCCESSION_EVERY = 2;
const ICE_RAID_DAYS = 60;    // how long the streets stay quiet after the raids
const ICE_RAID_CRIME = 9;    // crime removed while the agents are still working
const ICE_GROWTH = 0.35;     // what is left of normal arrivals once ICE is invited in

// ---- random events ----
// One lands every EVENT_EVERY days and runs for its duration. Effects are read
// out of the active event by derive() and step(), so nothing is permanent.
// ---- persistence ----
// One key, whole state, versioned so future format changes start clean
// rather than loading garbage. window.storage is the artifact storage API;
// localStorage does not exist here.
// ---- police chiefs ----
// One chief at a time, effects only while seated. Changing chiefs throws the
// whole department into a 15-day shakeup at half effectiveness.
const CHIEF_SHAKE_DAYS = 15;
const CHIEFS = {
  jenkins: { name: "Leroy Jenkins", icon: "🤝", salary: 6,
    line: "Came up through the neighborhoods, knows everyone, owes most of them.",
    staff: +2, police: 1, entRev: 1, mood: 0, approval: -2, crime: 3, tsuiStations: 2,
    crimeLabel: "Chief Jenkins, looking the other way",
    effects: ["Tsui family pays the build cost AND upkeep of 2 Police Stations", "+2 staff needed at every Station and Prison", "+3 crime", "-2 approval", "Counts as a federal entanglement", "$6 a day", "With a Jenkins in City Hall: the family covers a third station"] },
  mcgurk: { name: "Dirk McGurk", icon: "🔨", salary: 15,
    line: "Kicks doors first. The doors have stopped complaining.",
    staff: 0, police: 1.15, entRev: 0.9, mood: 0, approval: -4, crime: 0,
    effects: ["Police and Prisons 15% harder on crime", "Venues and Taverns earn 10% less", "-4 approval", "$15 a day"] },
  quietmilk: { name: "Charles Quietmilk", icon: "🕊️", salary: 10,
    line: "Believes in second chances, block parties, and a light touch.",
    staff: -1, police: 1, entRev: 1.1, mood: +2, approval: 0, crime: 2.5,
    crimeLabel: "Chief Quietmilk, community first",
    effects: ["1 fewer staff at every Station and Prison", "Venues and Taverns earn 10% more", "+2 happiness", "+2.5 crime", "$10 a day"] },
};

// ---- election challengers ----
// Each cycle the opposition runs someone whose platform is your worst number.
// If their issue is still bad on election day, the bar to win rises.
const CHALLENGER_FIRST = ["Marlene", "Dez", "Harriet", "Cole", "Priya", "Antoine", "June", "Wallace", "Rosa", "Emory", "Bea", "Terrence"];
const CHALLENGER_LAST = ["Okafor", "Whitfield", "Cho", "Delgado", "Pruitt", "Mabry", "Sandoval", "Greer", "Tookes", "Lindqvist", "Abernathy", "Fox"];
const AXES = {
  // These name the single worst true thing on the record, if there is one.
  // They outrank the generic six: a specific scandal beats a vague number.
  votes: { label: "Ask About the Recount",
    test: (c) => c.stolenVotes,
    sev: () => 6 },
  scandal: { label: (c) => (c.deadChiefCount > 0 ? "Who Killed the Chief" : "Who Killed the Counsel"),
    test: (c) => c.deadChiefCount > 0 || c.deadLawyerCount > 0,
    sev: (c) => 3 + c.deadChiefCount + c.deadLawyerCount },
  brokenPromise: { label: "A Promise Made and Broken",
    test: (c) => c.golfBroken || c.ecoBrokenNow,
    sev: () => 4 },
  vandalism: { label: "Broken Glass, Broken Promises",
    test: (c) => c.vandalNow,
    sev: () => 3 },
  corruption: { label: "Clean Out City Hall",
    test: (c) => (c.ties || 0) >= 2 || (c.rigged || 0) > 0,
    sev: (c) => 2 + (c.ties || 0) + (c.rigged || 0) },
  crime: { label: "Safe Streets Now",
    test: (c) => c.crime > 45,
    sev: (c) => (c.crime - 35) / 10 },
  traffic: { label: "Unclog Luckhead",
    test: (c) => c.traffic > 0.5,
    sev: (c) => c.traffic * 7 },
  jobs: { label: "Put Luckhead to Work",
    test: (c) => c.unemp > 0.25,
    sev: (c) => c.unemp * 12 },
  mood: { label: "A Town Worth Living In",
    test: (c) => c.hap < 48,
    sev: (c) => (52 - c.hap) / 3 },
  change: { label: "Time for a Change",
    test: () => true,
    sev: () => 1 },
};
const AXIS_ORDER = ["votes", "scandal", "brokenPromise", "vandalism", "corruption", "crime", "traffic", "jobs", "mood", "change"];
function challengerCtx(pop, d, hap, S) {
  const fp = Math.floor(pop);
  const emp = Math.min(fp, d.jobs);
  const day = S.day || 0;
  return { crime: S.crime, ties: S.ties || 0, rigged: S.testified ? 0 : (S.rigged || 0),
           traffic: d.traffic || 0, unemp: fp > 0 ? Math.max(0, fp - emp) / fp : 0, hap,
           // The specific, citable facts: read straight off raw state, not
           // pre-summarized, so each stays true (or stops being true) on its
           // own terms rather than borrowing another system's arithmetic.
           stolenVotes: S.stolenVotes === 2,
           deadChiefCount: (S.deadChiefs || []).length,
           deadLawyerCount: (S.deadLawyers || []).length,
           golfBroken: S.golfAsk === 4,
           ecoBrokenNow: S.eco === 5 && day < (S.ecoUntil || 0),
           vandalNow: (S.grid || []).some((c) => c && c.vandal && day < c.vandal) };
}
function makeChallenger(seed, cycle, ctx) {
  const rnd = mulberry32((seed || 1) * 104729 + cycle * 131);
  const name = CHALLENGER_FIRST[Math.floor(rnd() * CHALLENGER_FIRST.length)] + " " +
               CHALLENGER_LAST[Math.floor(rnd() * CHALLENGER_LAST.length)];
  const axis = AXIS_ORDER.find((k) => AXES[k].test(ctx)) || "change";
  const L = AXES[axis].label;
  return { name, axis, label: typeof L === "function" ? L(ctx) : L };
}
function challengerAttack(ch, ctx) {
  if (!ch || !AXES[ch.axis]) return { drag: 0, live: false };
  const live = AXES[ch.axis].test(ctx);
  const drag = live ? Math.max(1, Math.min(6, Math.round(AXES[ch.axis].sev(ctx)))) : 0;
  return { drag, live };
}


// ---- the approval ledger ----
// Every term in the approval target, itemized. step() sums these rows and the
// PR Panel prints them, so the two can never disagree.
function approvalRows(S, d, hap) {
  const T = TAX[S.tax] || TAX.normal;
  const F = FUND[S.fund] || FUND.normal;
  const H = HEIRS[S.heir] || null;
  const CHF = CHIEFS[S.chiefId] || null;
  const EV = eventById(S.event);
  const rows = [];
  const push = (label, v) => { if (Math.abs(v) >= 0.05) rows.push([label, v]); };

  push("Town happiness", hap);
  if (H && H.mood) push(`Doctrine mood: ${H.name}`, H.mood);
  if (CHF && CHF.mood) push(`Chief ${CHF.name.split(" ").pop()}, mood`, CHF.mood);
  if (EV && EV.mood) push(`Event mood: ${EV.name}`, EV.mood);
  const DP = diffOf(S.diff);
  const HM = DP.politics.honeymoon, FT = DP.politics.fatigue;
  const since = S.dictator
    ? Math.floor((S.day - 1) / TERM_DAYS)
    : (S.elected || 0) - (S.honeymoonAt || 0);
  // A successor inherits the chair, not the benefit of the doubt.
  const inherited = (S.heirCount || 0) > 0 ? 0.7 : 1;
  push("New administration goodwill", (since === 0 ? HM
    : since === 1 ? Math.max(0, HM * (1 - ((S.day % TERM_DAYS) / TERM_DAYS))) : 0) * inherited);
  push(`Time in office (${since} term${since === 1 ? "" : "s"})`, -Math.min(FATIGUE_CAP, FT * since));
  push(`Tax policy: ${T.name}`, T.approval);
  push(`Police funding: ${F.name}`, F.approval);
  const WKA = WORKS[S.works] || WORKS.balanced;
  if (WKA.approval) push(`Public works: ${WKA.name}`, WKA.approval);
  const LW = LAWYERS[S.lawyerId];
  if (LW && LW.approval) push(`${LW.name}, city attorney`, LW.approval);
  if (S.day < (S.judyUntil || 0)) push("Judy Ginsberg is a sensation", JUDY_APPROVAL);
  const CD = COMMS[S.commsId];
  if (CD && CD.approval) push(`${CD.name}, communications`, CD.approval);
  if (H) push(`Doctrine: ${H.name}`, H.approval);
  if (CHF) push(`Chief ${CHF.name.split(" ").pop()}`, CHF.approval);
  if (EV && EV.approval) push(`Event: ${EV.name}`, EV.approval);
  push("Schools", Math.min(8, 1.2 * (d.learning || 0)));
  push("Clinics and hospitals", Math.min(8, 1.4 * (d.care || 0)));
  push("Loudspeakers", Math.min(7, 2.2 * (d.message || 0)));
  if (d.fastparkOn) push("Faststain Park", 4);
  if (d.mansionOn && S.tax === "normal") push("Governor Sanders's friendship", 3);
  // Standing with the statehouse, less whatever the family has paid you. He
  // hears things.
  const LWG = LAWYERS[S.lawyerId];
  const heardGraft = (S.graft || 0) * (LWG && LWG.graftShield ? 0 : 1) * (S.testified ? 0.35 : 1);
  const govStanding = (S.govRel || 0) - Math.floor(heardGraft / GOV_GRAFT_PER_DOUBT)
    + (LWG ? LWG.gov : 0);
  if (govStanding >= 2) push("The statehouse is friendly", 2);
  else if (govStanding <= -2) push("The statehouse is hostile", -5);
  if (S.govBacked && !S.tsuiBound) push("Sanders funds your rival", -GOV_BACKING_DRAG);
  if (S.tsuiBound && !(LAWYERS[S.lawyerId] || {}).tsuiCover) push("The arrangement holds", -2);
  if (d.monumentCount) push(`Chief memorials (${d.monumentCount})`, d.monumentCount);
  if (d.statueUp) push("The Unity Monument", 5);
  if (d.cameras) push(`Cameras watching (${d.cameras})`, -Math.min(5, 0.9 * d.cameras));
  if (S.blackmail === 3 && S.day < (S.blackmailUntil || 0) && !(LAWYERS[S.lawyerId] || {}).tsuiCover) push("The Tsuis are talking to reporters", -7);
  if (S.doctrine === 4) push(`Condemned from the pulpit (${d.churchCount || 1} church${(d.churchCount || 1) === 1 ? "" : "es"})`, -3 * Math.max(1, d.churchCount || 1));
  if (S.testified && (S.testifiedDay || 0) > 0) {
    const elapsed = (S.day || 0) - S.testifiedDay;
    const bite = 3.2 * (S.testifiedTies || 1);
    const left = Math.max(0, 1 - elapsed / SCANDAL_FADE);
    if (bite * left >= 0.05) push(`The testimony, and what it revealed (${S.testifiedTies})`, -bite * left);
  }
  if (S.promiseBroken) push("The promise you did not keep", -PROMISE_BROKEN);
  if (S.river === 3) push("The river, and what you knew", -Math.min(12, 4 + 0.05 * Math.max(0, (S.day || 0) - (S.riverBuriedDay || 0))));
  if ((S.riversCleaned || 0) > 0 && S.river !== 3) push("Cleaned up the river", 4);
  if (S.schoolDemand === 2) push("No school in Luckhead", -SCHOOL_DEMAND_HIT);
  if (S.protest === 2) push("Stood against harsh policing", 3);
  if (S.protest === 3) push("Defended the police's tactics", -2);
  if (MAYORS[S.mayor] && MAYORS[S.mayor].approval) push("Mayor Mulaney's steady hand", MAYORS[S.mayor].approval);
  if (S.slander === 3 && S.day < (S.slanderUntil || 0)) push("Told Washington where to go", 4);
  if (S.slander === 2 && S.day < (S.slanderUntil || 0)) push("Agreed Luckhead is a dump", -3);
  if (S.rallyMood && S.day < (S.rallyUntil || 0)) push("The town rallies together", S.rallyMood);
  if (S.survOutcryUntil && S.day < S.survOutcryUntil) push("Outcry over the camera deal", -2);
  if (S.stolenVotes === 2) push("Whispers about the recount", -3);
  if (S.stolenVotes === 3) push("Said no to the recount men", 2);
  if (S.rally === 2) push("Hosted the President's rally", -4);
  if (S.rally === 3) push("Refused the President a stage", 3);
  if (S.eco === 3 && S.day < (S.ecoUntil || 0)) push("Environmental protests in the streets", -6);
  if (S.eco === 5 && S.day < (S.ecoUntil || 0)) push("Broke the environmental pledge", -8);
  if (S.eco === 4) push("Kept the environmental pledge", 7);
  const fpopA = Math.floor(S.pop || 0);
  const idleA = fpopA > 0 ? Math.max(0, (fpopA - (d.jobs || 0)) / fpopA) : 0;
  const gr = earlyGrace(S.day || 999);
  if (idleA > 0.10) push(`Unemployment (${Math.round(idleA * 100)}%)`, -Math.min(11, (idleA - 0.10) * 42) * gr);
  const hr = homelessRate(S.pop, d);
  if (hr > 0.05) push(`Homelessness (${Math.round(hr * 100)}%)`, -Math.min(17, (hr - 0.05) * 130) * gr);
  if (S.money < 0) push("Treasury in deficit", -6);
  const localN = (S.bribeLocal || []).filter((d) => d > S.day).length;
  const stainN = (S.bribeStain || []).filter((d) => d > S.day).length;
  if (localN) push(`Ward bosses delivering (${localN})`, 10 * localN);
  if (stainN) push(`Envelopes, lately (${stainN})`, -4 * stainN);
  if (S.pvisit === 2) push("Hosted the President", -3);
  if (S.pvisit === 3) push("Snubbed the President", 1.5);
  if (S.ice === 2) push("Let ICE into the city", -6);
  if (S.ice === 2 && S.day < (S.iceUntil || 0)) push("ICE raids on the streets", -ICE_RAID_CRIME);
  if (S.graffiti === 1) push("Defaced billboards", -1.5);
  if (S.viral === 1) push("That video of the mayor", -2.5);
  if (S.faithStance === "refuse") push("Taxed the churches", -1);
  if (S.challengerDrag) push(`Opposition: "${S.challengerLabel}"`, -S.challengerDrag);
  return rows;
}

// ---- the crime ledger ----
// The single source of truth for what moves crime each day. step() sums these
// rows, and the Crime Report shows them, so the two can never disagree.
function crimeLedgerRows(S, d) {
  const F = FUND[S.fund] || FUND.normal;
  const H = HEIRS[S.heir] || null;
  const EV = eventById(S.event);
  const rows = [];
  const push = (label, v) => { if (Math.abs(v) >= 0.01) rows.push([label, v]); };
  if (MAYORS[S.mayor] && MAYORS[S.mayor].crimeRow) push("The Jenkins name", MAYORS[S.mayor].crimeRow);
  if (S.mafia === "refused") push("War with the Tsui family", 5);
  else if (S.mafia === "allied") push("The Tsui presence", 1);
  if (S.reprisal > 0) push("Tsui reprisals", 7);
  if (!S.testified && S.rigged) push(`Rigged elections (${S.rigged})`, 1.5 * S.rigged);
  push(`Population (${Math.floor(S.pop)})`, 0.8 * Math.floor(S.pop) / 12);
  const fpop = Math.floor(S.pop);
  const idle = fpop > 0 ? Math.max(0, fpop - Math.min(fpop, d.jobs)) / fpop : 0;
  if (idle > 0.08) push(`Unemployment (${Math.round(idle * 100)}%)`, Math.min(9, (idle - 0.08) * 26));
  const roofless = fpop > 0 ? Math.max(0, fpop - (d.housing || 0)) / fpop : 0;
  if (roofless > 0.05) push(`Homelessness (${Math.round(roofless * 100)}%)`, Math.min(6, (roofless - 0.05) * 30));
  if (d.taverns) push(`Taverns (${d.taverns})`, 2 * d.taverns);
  if (d.shops) push(`Shops (${d.shops})`, 0.12 * d.shops);
  if (d.traffic > 0.15) push(`Traffic (${Math.round(d.traffic * 100)}%)`, 2.5 * d.traffic);
  if (d.highwayOn) push("Interstate access", HIGHWAY_CRIME);
  if (d.stadiumCrime) push("Stadium crowds", d.stadiumCrime);
  if (d.rowdiness) push("Venue crowds", d.rowdiness);
  if (d.smuggling) push(`Smuggling factories (${d.smuggling})`, 2.5 * d.smuggling);
  if (S.backroom) push("The venue back room", 2);
  if (S.bustUntil && S.day < S.bustUntil) push("The pardon, on every front page", 3);
  if (d.hideawayOn) push("Tommy's Hideaway", 1.5);
  if (d.plazaOn) push("Pipp's Plaza", 1.5);
  if (F.crime) push(`Police funding: ${F.name}`, F.crime);
  if (H && H.crime) push(`Doctrine: ${H.name}`, H.crime);
  if (EV && EV.crime) push(`Event: ${EV.name}`, EV.crime);
  const CHR = CHIEFS[S.chiefId] || null;
  if (CHR && CHR.crime) push(CHR.crimeLabel || `Chief ${CHR.name.split(" ").pop()}`, CHR.crime);
  if (S.gear) push("The chief's new equipment", -2);
  if (d.faith) push("Churches", -d.faith);
  if (d.learning) push("Schools", -0.6 * d.learning);
  if (d.held) push("Prison capacity", -d.held);
  if (S.riot === 1) push("Prison riot fallout", 4);
  if (S.blackmail === 3) push("Refused the Tsui blackmail", 8);
  if (d.policeFrac) push(`Police coverage (${Math.round(d.policeFrac * 100)}%)`, -(S.gear ? 15 : 11) * d.policeFrac);
  return rows;
}

// ---- the legacy ----
// Everything a mayoralty amounts to, itemized like The Books and summed.
const LANDMARKS_BUILD = ["theatre", "hideaway", "plaza", "fastpark"];

function legacyScore(st) {
  const items = [];
  const add = (label, val) => items.push([label, Math.round(val)]);
  add(`Days in office (${st.day})`, st.day * 0.6);
  if (st.elected) add(`Terms won (${st.elected})`, st.elected * 600);
  add(`Peak population (${st.peakPop || 0})`, (st.peakPop || 0) * 8);
  if (st.money > 0) add(`Treasury left behind ($${st.money})`, st.money * 0.12);
  if (st.money < 0) add(`Debt left behind ($${Math.abs(st.money)})`, st.money * 0.45);
  if (st.heirCount) add(`Successors named (${st.heirCount})`, st.heirCount * 300);
  // The air you leave behind. Fifty is neutral ground: cleaner earns, dirtier costs.
  const envEnd = Math.round(st.env === undefined ? START_ENV : st.env);
  if (envEnd !== 50) add(`Environment left at ${envEnd}`, (envEnd - 50) * 4);
  // The best the town ever thought of you, not the day they threw you out.
  if (st.peakApproval) add(`Best polling (${st.peakApproval}%)`, (st.peakApproval - 51) * 5);
  // Institutions outlive administrations. Only what is standing and finished counts.
  const LANDMARKS = ["theatre", "hideaway", "plaza", "fastpark", "mansion", "stadium", "histcenter", "statue"];
  const monuments = (st.grid || []).filter((c) => c && !c.build && LANDMARKS.indexOf(c.type) >= 0).length;
  if (monuments) add(`Landmarks standing (${monuments})`, monuments * 90);
  if (st.rigged) add(`Elections rigged (${st.rigged})`, -st.rigged * 250);
  if (st.graft) add(`Tsui money pocketed ($${st.graft})`, -st.graft * GRAFT_PENALTY);
  if (st.testified) add(`Testified against the family (${st.testifiedTies || 1} arrangement${(st.testifiedTies || 1) === 1 ? "" : "s"} confessed)`, -220 - (st.testifiedTies || 1) * 160);
  let base = items.reduce((a, [, v]) => a + v, 0);
  const halved = st.fed === 2 || st.broke;
  if (halved) base = Math.round(base * 0.5);
  base = Math.max(0, base);
  const mult = scoreMult(st.diff);
  const total = Math.round(base * mult);
  const title = st.broke ? "THE LIQUIDATOR"
    : st.fed === 2 ? "THE DEFENDANT"
    : st.testified ? "THE WITNESS"
    : total >= 6000 ? "A LUCKHEAD LEGEND"
    : total >= 3500 ? "THE INSTITUTION"
    : total >= 1800 ? "A RESPECTABLE RUN"
    : total >= 800 ? "ONE OF THE BRIEFER MAYORS"
    : "A FOOTNOTE";
  return { items, base, mult, total, halved, title };
}

const SAVE_KEY = "buckhead-save";  // unchanged so saves from before the rename still load
const SAVE_VERSION = 1;
// Storage that works everywhere the game runs. The Claude artifact sandbox has
// window.storage and no localStorage; a normal browser (the Vercel deploy, and
// the eventual Capacitor webview) has localStorage and no window.storage.
async function storePut(key, value) {
  if (typeof window === "undefined") return;
  if (window.storage) { await window.storage.set(key, value); return; }
  if (window.localStorage) window.localStorage.setItem(key, value);
}
async function storeGet(key) {
  if (typeof window === "undefined") return null;
  if (window.storage) {
    const r = await window.storage.get(key);
    return r && r.value != null ? r.value : null;
  }
  if (window.localStorage) return window.localStorage.getItem(key);
  return null;
}
async function saveGame(st) {
  try {
    await storePut(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, st }));
  } catch (e) { /* storage is best-effort */ }
}

const HISCORE_KEY = "luckhead-hiscores";
const HISCORE_MAX = 5;
async function loadHiscores() {
  try {
    const raw = await storeGet(HISCORE_KEY);
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a; }
  } catch (e) { /* best effort */ }
  return [];
}
// Fold a finished run into the table and persist. Returns the new table plus
// the rank this run earned (1-based) or 0 if it did not place, so the game-over
// screen can call out a personal best.
async function recordHiscore(entry) {
  let list = await loadHiscores();
  list = list.concat([entry]).sort((a, b) => b.total - a.total).slice(0, HISCORE_MAX);
  const rank = list.findIndex((e) => e === entry) + 1;
  try {
    await storePut(HISCORE_KEY, JSON.stringify(list));
  } catch (e) { /* best effort */ }
  return { list, rank };
}

// What buying out of a crisis actually costs, given how big the town has grown.
// The number on the event is the mid-game price at about forty residents.
const choiceCost = (ev, pop) => {
  if (!ev || !ev.choice) return 0;
  const scale = Math.min(3.5, Math.max(0.5, Math.floor(pop || 0) / 40));
  return Math.round((ev.choice.pay * scale) / 10) * 10;
};

const EVENT_EVERY = 58;   // spaced wider so crises have room to breathe between arrivals

// ---- opening tutorial ----
// Short, one at a time, each triggered by a condition rather than a timer so
// they arrive when they are actually relevant.
const HINTS = [
  { id: "epigraph", day: 1, title: "ON GOVERNING", icon: "🐟",
    body: "\u201CGoverning is like cooking a small fish.\u201D",
    tip: "\u2014 Tao Te Ching" },
  { id: "welcome", day: 2, title: "WELCOME TO LUCKHEAD", icon: "🏛️",
    body: "You have City Hall, one house, and the plant that lights it. Four residents, one of them running the turbine.",
    tip: "Tap 🔍 Inspect and then any tile to see exactly what it is doing." },
  { id: "wires", day: 3, title: "ROADS CARRY PEOPLE, LINES CARRY POWER", icon: "🔌",
    body: "Two separate networks. Most buildings need BOTH: a road touching them, and power reaching them. Roads must connect back to your main road network. Power flows from a Plant through Power Lines, and through most buildings, spreading tile to tile.",
    tip: "A 🚧 badge means no road. A ⚡ badge means no power. Tap 🔍 Inspect and then the tile to see which." },
  { id: "pausetip", day: 5, title: "IT IS ALL RIGHT TO STOP THE CLOCK", icon: "⏸️",
    body: "Luckhead keeps running while you look at it. If you want to plan a layout, compare prices, or just think, tap ⏸️ Pause. Nothing in the city moves until you tap ▶ Play again.",
    tip: "There is no penalty for pausing. Take the time you need." },
  { id: "crimewatch", when: (st) => st.crime >= 12, title: "WATCH THE CRIME NUMBER", icon: "🚨",
    body: "Crime is the quiet killer in Luckhead. It drags down mood, and mood is the biggest single thing setting your approval. Let crime run and you will lose an election without ever knowing why.",
    tip: "Police cut it. So do Churches, Schools, and jobs. City Hall → Crime Report shows every single thing pushing it up or down." },
  { id: "transit", when: (st, d, fp) => fp >= 40,
    body: "Buses and Subways help most when they sit across the street from the busiest buildings: fully upgraded Houses (Apartments), Music Venues, and Factories. Those send the most trips onto the road, so relieving them does the most good.",
    title: "PUT TRANSIT WHERE THE CROWDS ARE", icon: "🚌",
    tip: "A stop next to a quiet corner of the map does almost nothing. Put it where the traffic is." },
  { id: "hall", day: 4, title: "CITY HALL IS YOUR DESK", icon: "🏛️",
    body: "Tap City Hall in the middle of the map. Everything you govern with is in there: the books, tax policy, police funding, and the field manual.",
    tip: "The map seed and your current administration are listed there too." },
  { id: "jobs", when: (st, d, fp) => (st.sIdle || 0) >= 3,
    title: "PEOPLE NEED WORK", icon: "🏪",
    body: "The LABOR bar is red, which means residents with nothing to do. Unemployment drags happiness down and stalls immigration.",
    tip: "A Shop gives 3 jobs. Buildings only work if they touch a road and have power." },
  { id: "notconnected", when: (st) => (st.sDisc || 0) >= 5,
    title: "SOMETHING IS NOT CONNECTED", icon: "\uD83D\uDEA7",
    body: "A building has been sitting idle for the best part of a week. It costs upkeep every day and returns nothing until a road links it back to the network your City Hall is on.",
    tip: "Look for the tiles marked with a warning. A road that touches nothing is not a road." },
  { id: "nopower", when: (st) => (st.sPower || 0) >= 5,
    title: "THE LIGHTS ARE OFF SOMEWHERE", icon: "\u26A1",
    body: "Something has wanted power for days and has not had it, either because no line reaches it or because the plants cannot cover the demand. Unpowered buildings still bill you.",
    tip: "Check the \u26A1 figure at the top. If demand is above capacity, build another Plant before anything else." },
  { id: "district", when: (st, d, fp) => fp >= 18 && st.grid.filter((c) => c && c.type === "shop" && !c.build).length >= 2,
    title: "SHOPS LIKE COMPANY", icon: "\uD83C\uDFEA",
    body: "Where you put things matters as much as what you build. Shops earn more standing near other shops and near homes, factories cost less to run when they sit together, and taverns sour the houses beside them.",
    tip: "Tap any shop or factory to see exactly what its neighbours are worth to it." },
  { id: "works", when: (st, d, fp) => fp >= 30 && st.grid.filter((c) => c && (c.type === "road" || c.type === "bridge")).length >= 14,
    title: "THE ROAD BUDGET IS YOURS", icon: "\uD83D\uDEA7",
    body: "City Hall has a Public Works setting beside Police Funding. It decides what your roads cost to keep and how much traffic they carry, and whether the money goes to asphalt or to buses and subways instead.",
    tip: "Transit First is worth it only if you have a network to spend it on. Bare Minimum is cheap and it shows." },
  { id: "gridlock", when: (st, d) => (d.traffic || 0) > 0.5,
    title: "THE TOWN IS GRIDLOCKED", icon: "\uD83D\uDEA6",
    body: "Traffic is over half of what Luckhead's roads can carry, and it is costing you on every front at once: trade revenue, clean air, and crime all get worse the longer it holds. Red streets on the map are the ones over capacity. Four things help. Parallel roads, because one route carrying everything jams while two carrying half each do not. Bus Stations or Subway Stops, at least two or the network does nothing, placed across from Apartments, Factories and Music Venues. Public Works in City Hall, where Pave Everything buys 22% more capacity for half again the upkeep and Transit First makes buses and subways work 45% harder instead.",
    tip: "And check the interstate. If you have connected to the off-ramp, some of this is through traffic. Tearing up the road cuts traffic and improves the environment at the cost of revenue." },
  { id: "coverage", when: (st, d, fp) => fp >= 12 && st.grid.some((c) => c && c.type === "police" && !c.build),
    title: "SEE WHO IS COVERED", icon: "\uD83D\uDC6E",
    body: "The \uD83D\uDC6E button above the map shades every tile your stations reach and rings the buildings nobody is watching. Once schools exist it does the same for them in rose.",
    tip: "Two stations on the same block cover no more than one. Spread them." },
  { id: "ramp", when: (st, d, fp) => fp >= 20 && st.interstate >= 0,
    title: "THE ROAD OUT OF TOWN", icon: "\uD83D\uDEE3\uFE0F",
    body: "One square on the edge of the map is an interstate off-ramp. Run your roads to it and shops and factories earn more, at the cost of crime, traffic and clean air.",
    tip: "Inspect the marked square to see the exact trade before you connect it." },
  { id: "banks", day: 70, title: "THE BANKS ARRIVE", icon: "🏦",
    body: "Luckhead can support a financial district. Each Bank lifts industrial and commercial revenue 5 percent, shaves 4 percent off construction, and makes envelopes 5 percent cheaper. Up to three, and they stack.",
    tip: "Two staff each. They pay for themselves in a big town and bleed you in a small one." },
  { id: "honeymoon", day: 8, title: "THE TOWN LIKES YOU", icon: "🌤️",
    body: "New mayors get the benefit of the doubt. Your approval runs about 20 points higher through this first term, and it fades across your second.",
    tip: "Build something lasting while the polling is kind. It gets harder every term you serve." },
  { id: "books", when: (st) => (st.sRed || 0) >= 3, title: "MIND THE BOOKS", icon: "$",
    body: "Every building costs upkeep daily. Open The Books from City Hall to see what is earning and what is bleeding.",
    tip: "Income is taxes from homes, commercial trade, and industrial goods." },
  // The day here must match TERM_DAYS. HINTS is defined above it, so it
  // cannot read the constant without a load-order crash.
  { id: "election", when: (st) => st.day >= 60 && st.elected === 0,
    title: "THE VOTE IS COMING", icon: "🗳️",
    body: "Luckhead votes on day 140 against a real opponent. Winning always takes 51 percent, but while their attack line about your town is true, it drains your approval every single day.",
    tip: "The pollsters will tell you who is running and on what. Fix the issue and the bleeding stops." },
  { id: "upgrade", when: (st) => st.day >= 18 && st.grid.some((c) => c && !c.build && nextUp(c)),
    title: "DON'T FORGET TO UPGRADE", icon: "\u2b06\ufe0f",
    body: "Most buildings can be leveled up, and the upgrade is almost always a better deal than a second building: more output, more capacity, the same footprint. A leveled-up House holds far more residents; an upgraded Plant powers far more of the map.",
    tip: "Tap \u2b06\ufe0f Upgrade, then any building, to see its next tier and price. Make this a habit." },
  { id: "steady", when: (st) => st.day >= 45,
    title: "STEADY WINS IN LUCKHEAD", icon: "\u2696\ufe0f",
    body: "Big changes cost more than they look. Swapping a police chief throws the department into a 15-day slump. A new doctrine, a new tax, a bulldozed district, all of it unsettles the town at once and approval takes the hit. Luckhead rewards patience over sudden reinvention.",
    tip: "Change one thing, let it settle, then judge it. Do not overhaul the whole city in a week." },
];
const EVENTS = [
  { id: "recession", name: "Economic Recession", icon: "📉", days: 60, weight: 1.5,
    body: "Orders have dried up nationwide. Factory output is worth far less until the market turns.",
    tag: "Industrial revenue -40%", goods: 0.6,
    choice: { pay: 500, label: "PROP THEM UP", done: "Emergency contracts keep the lines running. The recession moves on without you." } },
  { id: "boom", name: "Economic Boom", icon: "📈", days: 60, weight: 1.5,
    body: "Luckhead's factories cannot fill orders fast enough. Everything they ship is worth more.",
    tag: "Industrial revenue +20%", goods: 1.2, good: true },
  { id: "strike", name: "Bus Drivers' Strike", icon: "🚏", days: 60,
    // Nobody can strike a transit system you have not built yet.
    needs: (st) => st.grid.filter((c) => c && (c.type === "bus" || c.type === "subway") && !c.build).length >= 2,
    body: "The transit union has walked out. Every Bus Station sits idle and the traffic they were absorbing is back on your streets.",
    tag: "Bus network offline", noTransit: true,
    choice: { pay: 450, label: "MEET THEIR TERMS", done: "The drivers are back on the road by morning. The union will remember this." } },
  { id: "heatwave", name: "Heat Wave", icon: "🌡️", days: 30,
    body: "Air conditioners everywhere. Power plants strain to keep up and tempers are short.",
    tag: "Plant output -25%, happiness -6", plantGen: 0.75, mood: -6 },
  { id: "flu", name: "Flu Season", icon: "🤒", days: 40,
    body: "Half the town is out sick. Businesses run short-handed and clinics are overwhelmed.",
    tag: "Workforce -20%, care halved", labor: 0.8, care: 0.5,
    choice: { pay: 300, label: "FUND A CLINIC DRIVE", done: "Shots on every corner for a week. The season burns itself out early." } },
  { id: "boomtown", name: "Boomtown", icon: "🧳", days: 45,
    body: "Luckhead is suddenly the place to be. Newcomers are arriving faster than you can house them.",
    tag: "Immigration +60%", growth: 1.6, good: true },
  { id: "scandal", name: "Newspaper Investigation", icon: "📰", days: 45,
    body: "The Luckhead Sentinel has been going through the city's books. It is not flattering, whatever they find.",
    tag: "Approval -8", approval: -8 },
  { id: "harvest", name: "Bumper Harvest", icon: "🌾", days: 45,
    body: "A spectacular growing season. Shops are full, prices are low, and everyone is in a good mood.",
    tag: "Commercial revenue +30%, happiness +5", trade: 1.3, mood: 5, good: true },
  { id: "crimewave", name: "Crime Wave", icon: "🔦", days: 40,
    body: "Something has emboldened the criminal element. Your police are stretched thin.",
    tag: "Crime pressure +5", crime: 5,
    choice: { pay: 550, label: "FLOOD THE STREETS", done: "Every officer on doubles until it passes. The overtime bill is enormous." } },
  { id: "grant", name: "Federal Grant", icon: "\uD83C\uDFE6", days: 1,
    body: "A state infrastructure program has selected Luckhead. The cheque cleared this morning.",
    tag: "One-time payment", cash: 400, good: true,
    // Washington gives to the towns it likes. Standing with the President moves
    // this from almost never to better than three times the usual odds.
    weight: (st) => FED_GRANT_WEIGHT[String(fedFavorOf(st))] },
  { id: "terror", name: "Terrorist Attack", icon: "💥", days: 40,
    body: "A local terrorist group destroyed a Power Plant overnight. The lights went out across the grid, and the town is demanding to feel safe again.",
    tag: "One plant destroyed · policing demand up for 40 days", crime: 6, plantLost: true, disaster: true,
    needs: (st) => (st.grid || []).some((c) => c && c.type === "plant" && !c.build),
    weight: 0.55 },
  { id: "terror2", name: "Stadium Attack", icon: "💥", days: 40,
    body: "A local terrorist group bombed Luckhead Stadium on a game day. Fifteen people are dead, the stands are gone, and the town is holding vigils by candlelight.",
    tag: "The Stadium is destroyed · 15 dead · policing demand up for 40 days", crime: 6, stadiumLost: true, kills: 15, disaster: true,
    needs: (st) => (st.grid || []).some((c) => c && c.type === "stadium" && !c.build),
    weight: 0.4 },
  { id: "heist", name: "Bank Robbery", icon: "\uD83D\uDCB8", days: 1,
    body: "City funds were among those pillaged by masked gunmen.",
    tag: "City funds taken", cash: -500, cashScale: true,
    // Nobody holds up a bank in a town where the family has an arrangement with
    // City Hall. Vincent's people would get there first, and everyone knows it.
    needs: (st) => st.mafia !== "allied"
      && (st.grid || []).some((c) => c && c.type === "bank" && !c.build),
    // More vaults and a rougher town both mean more of this.
    weight: (st) => {
      const banks = (st.grid || []).filter((c) => c && c.type === "bank" && !c.build).length;
      return (0.55 + 0.35 * banks) * (0.7 + Math.min(1, (st.crime || 0) / 70));
    } },
  { id: "storm", name: "Severe Storm", icon: "⛈️", days: 25,
    body: "Wind damage across the city. Roads are half blocked and crews are working around the clock.",
    tag: "Traffic +50%, upkeep +30%", traffic: 1.5, upkeep: 1.3,
    choice: { pay: 350, label: "PAY THE CREWS", done: "Overtime for every crew in the county. The roads are clear ahead of schedule." } },
  { id: "festival", name: "Founders' Festival", icon: "🎪", days: 20,
    body: "The whole town turns out. Bunting everywhere, and for a few weeks nobody minds the potholes.",
    tag: "Happiness +10, approval +5", mood: 10, approval: 5, good: true },
  { id: "snow", name: "Snowpocalypse", icon: "❄️", days: 5,
    body: "Two inches of snow. Two. Every driver in Luckhead has forgotten how roads work, half of them are sideways in a ditch, and the entire city has stopped moving.",
    tag: "City-wide gridlock for five days", traffic: 1.8, trafficFloor: 0.92,
    choice: { pay: 400, label: "CALL IN THE PLOWS", done: "Every plow within fifty miles, at holiday rates. Luckhead moves again." } },
  { id: "film", name: "Movie Filming in Luckhead", icon: "🎬", days: 30,
    body: "A production has taken over half the city. Shops cannot keep up with the crews and the streets are closed at random, half of them at once, for a month. Nobody in Luckhead can get anywhere, and every one of them has an opinion about the catering truck.",
    tag: "Commercial +20%, streets closed at random", trade: 1.2, traffic: 1.55, good: true },
];
const eventById = (id) => EVENTS.find((e) => e.id === id) || null;

// Successors carry a permanent doctrine into the office they inherit.
const HEIRS = {
  populist: {
    name: "The Populist", icon: "🎤",
    line: "Promises everything, means most of it, delivers what he can.",
    approval: +5, crime: +2, mood: 0, pollution: 1, leisure: 1, industry: 0.9,
    effects: ["+5 approval", "+2 crime", "-10% industrial revenue"],
  },
  conservative: {
    name: "The Conservative", icon: "⚖️",
    line: "Order first, warmth later, if there is time.",
    approval: 0, crime: -4, mood: -4, pollution: 1, leisure: 1, industry: 1.15,
    effects: ["+15% industrial revenue", "-4 crime", "-4 happiness"],
  },
  green: {
    name: "The Environmentalist", icon: "🌿",
    line: "Cleaner air, better parks, and a quieter kind of politics.",
    approval: -3, crime: 0, mood: 0, pollution: 0.6, leisure: 1.25, industry: 0.65,
    effects: ["40% less pollution", "+25% Parks, Taverns, Venues", "-35% industrial revenue", "-3 approval"],
  },
};
const HEIR_KEYS = ["populist", "conservative", "green"];

// Federal interest. Every standing arrangement with the Tsuis counts; at
// FED_TRIGGER the Bureau opens a file and heat starts accumulating.
// Standing with the crowd lifts the town and sours the department; backing the
// police does the reverse. Both hold until the next vote.
const protestFlags = (st) => ({
  protestMood: (st.protest === 2 ? 9 : 0)
    - (st.day < (st.shootingUntil || 0) ? 5 : 0),
  // Agreeing with the President that your own town is a dump does not go down
  // well at roll call. It stacks with whatever the protests have already done.
  protestMul: (st.protest === 2 ? 0.7 : st.protest === 3 ? 1.25 : 1)
    * (st.slander === 2 && st.day < (st.slanderUntil || 0) ? SLANDER_MORALE : 1),
});
// Schools go dark while an unanswered strike runs; a settled contract costs
// more forever. Both read from one place so step and the UI never disagree.
// Cleaning the river costs output while the work is done, then leaves the
// district permanently less filthy. Burying it changes nothing but your soul.
const riverFlags = (st) => ({
  envCleaned: (st.riversCleaned || 0) > 0,
  // The Environmentalist genuinely runs a cleaner city; the Conservative does not.
  envDirty: st.heir === "green" ? 0.55 : st.heir === "conservative" ? 1.2 : 1,
  retrofit: st.river === 2 && st.day < (st.riverUntil || 0) ? RIVER_RETRO_OUT : 1,
  pollCut: (st.riversCleaned || 0) > 0 ? 0.65 : 1,
});
const copFlags = (st) => ({
  copsOut: st.cop === 3 && st.day < (st.copUntil || 0),
  copWage: st.copWage || 1,
});
// Refusing the interfaith council, or refusing their curriculum, both bite.
const faithFlags = (st) => ({
  churchMul: (st.faithStance === "refuse" ? 0.7 : 1) * (st.day < (st.churchGovUntil || 0) ? (st.churchGov || 1) : 1),
  doctrineSchools: st.doctrine === 3 ? 0.6 : 1,
});
const strikeFlags = (st) => ({
  schoolsShut: st.strike === 3 && st.day < (st.strikeUntil || 0),
  wageMul: st.wageMul || 1,
});
const LOW_APPROVAL_WARN = 30;   // below this the game stops and offers a plan
const HOMELESS_WARN = 0.05;     // rough sleeping past this gets a warning
const SCHOOL_DEMAND_DAY = 69;   // by now the town expects somewhere to send the kids
const SCHOOL_DEMAND_HIT = 8;    // standing approval penalty until one is planned
const COP_ODDS = 1 / 220;      // the police contract comes up about this often
const COP_SHUT = 20;           // days the beat goes uncovered if you refuse
const COP_COOL = 160;          // quiet stretch before they ask again
const COP_RAISE = 1.45;        // what a settled police contract does to upkeep
const DOCTRINE_ODDS = 1 / 240; // how often the pulpit asks for the curriculum
const DOCTRINE_COOL = 170;
const STRIKE_ODDS = 1 / 200;   // a walkout lands roughly every 200 days
const STRIKE_SHUT = 60;        // days the schools stay dark if you wait it out
const STRIKE_COOL = 150;       // quiet stretch before the union can strike again
const STRIKE_RAISE = 1.5;      // what a settled contract does to school upkeep
const RIVER_ODDS = 1 / 200;     // per factory-pair, past RIVER_DAY
const RIVER_DAY = 80;
const RIVER_COOL = 220;         // a long quiet stretch; this is not a recurring tax
const RIVER_RETRO = 30;         // days the retrofitted factories run at reduced output
const RIVER_RETRO_OUT = 0.6;    // what they manage while the work is done
const RIVER_STAIN_DAYS = 30;    // how long a buried spill still looks orange
const RIVER_SELF_CLEAR = 90;    // days before an untreated spill finally runs clear
const INVEST_ODDS = 1 / 210;    // how often a foreign investor comes calling
const INVEST_DAY = 90;          // not before the city is worth investing in
const INVEST_COOL = 200;        // and not again for a good while
const SPEECH_BEFORE = 10;       // days before a vote that the podium goes up
const PROMISE_DAYS = 60;        // how long the town remembers what you said
const PROMISE_ODDS = 0.5;       // the speech lands with the crowd this often
const PROMISE_BOOST = 9;        // approval if it does land
const PROMISE_BROKEN = 16;      // and what it costs when you break your word
const POTHOLE_ODDS = 1 / 260;   // baseline odds a stretch of road gives out; tax policy scales this
const POTHOLE_MIN_ROADS = 8;    // needs a real road network for one to open in
const STATUE_POP = 100;         // the town votes itself a monument at this size
const ECO_FACTORIES = 2;        // it takes a second chimney before anyone organises
const ECO_ENV = 70;             // and an environment score bad enough to point at
const ECO_ODDS = 0.01;          // daily chance the meeting turns into a movement
const ECO_PLEDGE_DAYS = 30;     // how long you have to make good on the promise
const ECO_PARKS = 3;            // parks demanded, on top of whatever already stands
const ECO_PROTEST_DAYS = 30;    // how long the streets stay angry
const ECO_COOL = 200;           // and how long before they organise again
const SPEAKER_MIN = 2;          // one is a nuisance; two is a campaign
const SPEAKER_ODDS = 0.006;     // daily chance the town has had enough of it
const SPEAKER_DAYS = 30;        // how long the poles stay silent afterward
const SPEAKER_COOL = 150;       // and how long before it is worth doing again
const POTHOLE_COOL = 120;
const NOTICE_DAYS = 8;       // a banner stays up this long: 24s at normal speed
const NOTICE_MAX = 3;        // never stack more than this many at once
const LOG_KEEP = 60;         // how much history the newspaper remembers
const SCANDAL_FADE = 200;    // how long the stain from testifying takes to wash out
const PRESS_DELAY = 26;      // days before the papers run the retrospective
const GRACE_DAYS = 60;       // a new town gets the benefit of the doubt this long
// Nobody blames a mayor on day 10 for a town that has not finished being built.
// Full forgiveness at the start, tapering to none by GRACE_DAYS.
const earlyGrace = (day) => (day >= GRACE_DAYS ? 1 : 0.45 + 0.55 * (day / GRACE_DAYS));
const ENV_DRIFT = 0.04;      // the environment moves slowly, like a real one
const ENV_ALARM = 30;        // below this the whole town notices
// One square on the edge of every map is an interstate off-ramp. Running the
// town's road network up to it opens Luckhead to through traffic: money moves,
// and so does everything else that travels a highway.
const HIGHWAY_TRADE = 1.12;     // shops and factories earn this much more
const HIGHWAY_TRAFFIC = 1.12;   // and the roads carry this much more
const HIGHWAY_CRIME = 3;        // crime that arrives with the trucks
const HIGHWAY_ENV = 4;          // environment given up to the exhaust
// School coverage mirrors police coverage exactly, same reach-and-strength
// math, but the targets are houses only and the consequence is happiness, not
// crime. Gated on the school unlock so a brand new town isn't punished for a
// building it cannot legally own yet.
const SCHOOL_REACH = 3;
const SCHOOL_UNCOVERED_WEIGHT = 8;    // happiness left on the table when schools exist but do not reach
const SHOOTING_ODDS = 1 / 150;   // a bad night, roughly this often
const SHOOTING_WAR = 3.6;        // and far more often once the family is at odds with you
const SHOOTING_POP = 45;         // a town smaller than this cannot absorb a night like that
const SHOOTING_POP_WAR = 34;     // except in a feud, when the shooting comes anyway
const SHOOTING_SHOCK = 20;       // days of frozen immigration and a subdued town
const VANDAL_DAYS = 30;      // a smashed shopfront stays boarded this long
const PROTEST_MOOD = 20;     // below this the town starts gathering
const PROTEST_DAYS = 3;      // consecutive days of it before they march
const INDICT_WARN_HEAT = 80;   // last call before the file closes
const FED_TRIGGER = 3;
const BUYOUT_ODDS = 0.7;  // paying to make a crisis go away works seven times in ten
const VOTES_MIN_DAY = 220;     // the midnight call only comes deep into a run
const VOTES_ODDS = 0.01;       // daily chance once it can
const SLANDER_CRIME = 50;      // the President only says it once the numbers back him
const SLANDER_ODDS = 0.012;    // daily chance he says it out loud
const SLANDER_DAYS = 30;       // how long either answer hangs around
const SLANDER_COOL = 200;      // and how long before the subject comes up again
const SLANDER_MORALE = 0.75;   // what agreeing does to every beat in the city
const RALLY_WAIT = 25;         // days a finished stadium stands before the advance team calls
const SURV_ODDS = 0.009;       // daily chance the Governor's security friend calls
const SURV_MIN_DAY = 70;       // mid-game onward
const SURV_COOL = 150;         // and he calls back if you turned him down before
const SURV_OUTCRY_DAYS = 30;   // how long the town grumbles about being filmed
const GOLF_ODDS = 0.011;       // daily chance the Governor brings up his handicap
const GOLF_DAYS = 60;          // days to deliver the course once promised
const GOLF_NEAR = 2;           // it must sit within this many tiles of the mansion
const POL_CIRCLE_GAP = 45;     // no two asks from the same patron land close together
const MARLA_ODDS = 0.011;      // daily chance Sanders makes the ask
const MARLA_MIN_DAY = 120;     // never in the first months of a first term
const PVISIT_HEAT = 60;   // heat at which Washington calls

// Envelopes. Each one costs more than the last and leaves a mark on the polls.
const BRIBE_BASE = 1000, BRIBE_STEP = 500;
const bribeCost = (n, banks = 0) => Math.round((BRIBE_BASE + BRIBE_STEP * (n || 0)) * (1 - 0.05 * Math.min(3, banks)));
const BRIBES = {
  fed:   { name: "Federal Prosecutors", icon: "⚖️", blurb: "Halves the federal heat on your file, today." },
  local: { name: "Local Power Brokers", icon: "🎩", blurb: "+10 approval for 30 days. The ward bosses deliver." },
  trade: { name: "Foreign Trade Officials", icon: "🌐", blurb: "+10% industrial revenue for 90 days." },
};
function entanglements(st) {
  return (st.mafia === "allied" ? 1 : 0)
       // Once you have testified, the rigged elections are confessed and
       // cooperated on: they stop feeding a new file the way the old one did.
       + (st.testified ? 0 : (st.rigged || 0))
       + (st.smuggleOffer === 3 ? 1 : 0)
       + (st.backroom ? 1 : 0)
       // Cash off the books, and a police department deliberately thinned to
       // suit the man who provided it. The Bureau reads that as one thing.
       + (st.tsuiLoanTook ? 1 : 0)
       + (st.chiefId === "jenkins" ? 1 : 0)
       + (st.river === 3 ? 1 : 0)
       + (st.investTook ? 1 : 0);
}

// Kickbacks shrink each renegotiation. Once they hit zero the family starts
// demanding tribute instead, rising 5 a day-rate with every further deal.
function kickbackFor(deal, rigged) {
  // Kickbacks fall 35, 25, 15, 10. After that the family demands tribute
  // instead: 10 a day, rising 5 with every further renegotiation.
  const steps = deal + Math.round(rigged * 1.2);
  const PAY = [55, 40, 28, 18, 10];
  if (steps < PAY.length) return PAY[steps];
  return -(10 + 5 * (steps - PAY.length));
}



const CRIME_THRESHOLD = 28;

// ---- crime as a level, not a running total ----
// The ledger rows describe the town Luckhead is today. Summing them gives a
// target the bar walks toward, the way environment and approval already work.
// Suppression is multiplicative, so no institution ever zeroes a city and each
// one keeps earning its upkeep at any size.
const GROSS_K = 2.6;      // row-units of pressure per point of crime level
const CRIME_CHASE = 0.06; // how fast the bar walks to its target
const CRIME_RISE2 = 0.7;  // trouble arrives at this fraction of clearing speed

const CRIME_SUPPRESS = [
  { m: /^Police coverage/, max: 0.45, half: 7.0 },
  { m: /^Churches$/,       max: 0.30, half: 8.0 },
  { m: /^Prison capacity$/,max: 0.35, half: 14.0 },
  { m: /^Schools$/,        max: 0.12, half: 2.5 },
  { m: /equipment/,        max: 0.06, half: 1.0 },
];

// Distress was capped for a rate model, where +9 a day was already crushing.
// As a level it has to be able to define a broken town outright.
const CRIME_RETUNE = [
  { m: /^Unemployment/, cap: 18, was: 9 },
  { m: /^Homelessness/, cap: 14, was: 6 },
];

// Sins do not add crime. They cap how much good your institutions can do.
// The war already triples the town's crime through its own pressure rows. The
// ceiling is a light second touch on top of that, not a second punishment: it
// only bites a mayor who has stacked several sins AND built everything.
const CRIME_SUPP_CAP = 0.75;   // the best any clean city can ever suppress
const CRIME_SUPP_MIN = 0.30;   // even the worst record leaves this much traction
const CRIME_SIN_SCALE = 0.7;   // these rows were sized as daily rates, not levels

const CRIME_MARKS = [
  { m: /^War with the Tsui family/, drop: 0.08 },
  { m: /^Tsui reprisals/,           drop: 0.05 },
  { m: /^Rigged elections/,         drop: 0.02, per: 1.5 },
  { m: /pardon, on every front page/, drop: 0.03 },
  { m: /^Refused the Tsui blackmail/, drop: 0.02 },
  { m: /^Prison riot fallout/,      drop: 0.02 },
];

function crimeTargetOf(rows) {
  let gross = 0, keep = 1, cap = CRIME_SUPP_CAP;
  for (let [label, v] of rows) {
    if (v > 0) {
      const mk = CRIME_MARKS.find((x) => x.m.test(label));
      if (mk) {
        cap -= mk.per ? mk.drop * (v / mk.per) : mk.drop;
        v *= CRIME_SIN_SCALE;
      } else {
        const rt = CRIME_RETUNE.find((x) => x.m.test(label));
        if (rt) v = Math.min(rt.cap, v * (rt.cap / rt.was));
      }
      gross += v;
    } else {
      const sp = CRIME_SUPPRESS.find((x) => x.m.test(label));
      if (sp) { const mg = Math.abs(v); keep *= 1 - sp.max * (mg / (mg + sp.half)); }
    }
  }
  cap = Math.max(CRIME_SUPP_MIN, cap);
  const suppression = Math.min(1 - keep, cap);
  return { gross, cap, suppression, target: Math.max(0, Math.min(100, gross * GROSS_K * (1 - suppression))) };
}
const TERM_DAYS = 140;
const WARN_DAY = 20;    // poll lands twenty days before each vote
const LOSS_WARN_DAY = 15;   // sharper alert if you are behind with the vote near
const MAFIA_FLAVOR = [
  "Vincent says the books look beautiful. He has not seen the books.",
  "A man in a very nice suit waved at you today. Wave back.",
  "The Tsui family repaved Elm Street overnight. Do not ask which crew.",
];

// City Hall occupies a 2x2 block. The top-left tile is the anchor and carries
// the type; the other three are "hall" stubs pointing back at it.
const HALL_ANCHOR = at0(5, 5);

function freshState(seed, diff) {
  const useSeed = seed === undefined ? Math.floor(Math.random() * 1e9) : seed;
  const terrain = makeTerrain(useSeed);
  const rnd = mulberry32(useSeed ^ 0x5f3759df);
  const grid = Array(N).fill(null);

  // City Hall, always centred on its 2x2
  const [hr, hc] = [5, 5];
  grid[at0(hr, hc)] = { type: "hall", seq: 0 };
  [[0, 1], [1, 0], [1, 1]].forEach(([dr, dc]) => {
    grid[at0(hr + dr, hc + dc)] = { type: "hallpart", seq: 0, anchor: at0(hr, hc) };
  });

  // The founding block, described relative to City Hall, then rotated so the
  // town grows out of a different side of the square on every map.
  //  u runs along the main street, v runs away from City Hall.
  const layout = [
    // main street in front of City Hall, wired where the founders ran power
    { u: -2, v: 2, type: "road", wire: true },
    { u: -1, v: 2, type: "road", wire: true },
    { u:  0, v: 2, type: "road" },
    { u:  1, v: 2, type: "road" },
    { u:  2, v: 2, type: "road" },
    { u:  3, v: 2, type: "road" },
    // a short spur back along the side of the square
    { u:  2, v: 0, type: "road" },
    { u:  2, v: 1, type: "road" },
    // the founding house, the plant that lights it, and the wire between
    { u: -1, v: 1, type: "house" },
    { u: -2, v: 1, type: "line" },
    { u: -2, v: 3, type: "plant" },
  ];


  // Rotate (u, v) around the 2x2 block. v is distance out from City Hall, so
  // each facing puts the founding street on a different side of the square.
  // The block spans rows/cols hr..hr+1, so mirrored facings offset by 1.
  const facing = Math.floor(rnd() * 4);
  const place = (u, v) => {
    if (facing === 0) return [hr + 1 + v, hc + u];       // south
    if (facing === 1) return [hr - v, hc + u];           // north
    if (facing === 2) return [hr + u, hc + 1 + v];       // east
    return [hr + u, hc - v];                             // west
  };

  // shift the whole block a little along the street so it is not always centred
  const slide = Math.floor(rnd() * 3) - 1;

  let k = 1;
  const claimed = [];
  layout.forEach(({ u, v, type, wire }) => {
    const [r, c] = place(u + slide, v);
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return;
    const i = at0(r, c);
    if (grid[i] && (grid[i].type === "hall" || grid[i].type === "hallpart")) return;
    terrain[i] = PLAIN;                       // the founders cleared this ground
    claimed.push(i);
    grid[i] = wire ? { type, seq: k++, wire: true } : { type, seq: k++ };
  });

  const DF = diff || DEFAULT_DIFF;
  // Pick the off-ramp: a dry square somewhere on the rim. The road network has
  // to be run out to it before any of it means anything.
  const rim = [];
  for (let k = 0; k < SIZE; k++) {
    [[0, k], [SIZE - 1, k], [k, 0], [k, SIZE - 1]].forEach(([r, c]) => {
      const idx = at0(r, c);
      if (terrain[idx] !== WATER && rim.indexOf(idx) < 0) rim.push(idx);
    });
  }
  const interstate = rim.length ? rim[Math.floor(rnd() * rim.length)] : -1;

  return { grid, terrain, seed: useSeed, interstate, diff: DF, money: DIFFICULTY.economy[DF.economy].cash, pop: 4, day: 1, seq: 20, mafia: "none", crime: 0, calm: 0, approval: 60, env: START_ENV, over: false, elected: 0, deal: 0, nextTalk: 0, ledger: [], tax: "normal", fund: "normal", polled: 0, rigged: 0, unlocked: 0, gear: false, chief: 0, smuggleOffer: 0, venueDay: 0, venueOffer: 0, backroom: false, fed: 0, heat: 0, ties: 0, testified: false, reprisal: 0, dayUnlocked: 0, heir: null, succession: 0, honeymoonAt: 0, tsuiReturn: 0, event: null, eventEnds: 0, eventSeen: 0, nextEvent: EVENT_EVERY, hintsSeen: [], lossWarned: 0, peakPop: 4, graft: 0, heirCount: 0, challenger: null, lastElection: null, electionSeen: 0, tsuiWar: 0, chiefHit: 0, chiefKilled: 0, deadChiefs: [], vacancyReason: "opening", justBroke: false, pendingMonument: null, monuments: [], broke: false, theatreDay: 0, bust: 0, bustUntil: 0, chiefId: null, chiefShake: 0, pvisit: 0, faithMeet: 0, faithStance: "none", loans: 0, loanOffer: 0, bribes: 0, bribeLocal: [], bribeTrade: [], bribeStain: [], campaign: 0, campaignUntil: 0, modalGap: 0, ice: 0, iceUntil: 0, graffiti: 0, graffitiUntil: 0, graffitiSeen: 0, billboardDay: 0, riot: 0, riotUntil: 0, riotSeen: 0, prisonDay: 0, viral: 0, viralSeen: 0, viralAck: 0, hideawayFirstDay: 0, blackmail: 0, blackmailSeen: 0, blackmailUntil: 0, firstHeirDay: 0, arsonDay: 0, arsonCount: 0, lastArson: null, arsonAck: 0, indictWarn: 0, protest: 0, protestUntil: 0, moodLowDays: 0, protestsSeen: 0, strike: 0, strikeUntil: 0, strikeCool: 0, wageMul: 1, strikesSeen: 0, schoolDemand: 0, cop: 0, copUntil: 0, copCool: 0, copWage: 1, doctrine: 0, doctrineCool: 0, lowWarn: 0, envWarn: 0, homelessWarn: 0, shooting: 0, shootingUntil: 0, shootingDead: 0, shootingsSeen: 0, river: 0, riverUntil: 0, riverCool: 0, riversSeen: 0, riversCleaned: 0, riverBuriedDay: 0, pothole: 0, potholeCool: 0, potholeTile: null, potholesSeen: 0, testifiedDay: 0, testifiedTies: 0, press: 0, pressDue: 0, hintsOn: null, soundOn: true, musicOn: true, musicSet: -1, dictator: false, scored: 0, peakApproval: 0,
    govStage: 0, govRel: 0, govPending: 0, govBacked: 0, govShield: 0, govTrade: 1,
    govAsk: 0, govAskDay: 0, govBuiltDay: 0, govTraffic: 1, churchGov: 1, churchGovUntil: 0, works: "balanced", lawyerId: null, lawyerOffer: 0, lawyerFrom: 0, deadLawyers: [],
    fedFavor: 0, lawyerLocked: 0, potus: 0, judyUntil: 0, judySeen: 0, commsId: null,
    feud: 0, marla: 0, marlaCool: 0, commsLocked: 0, rally: 0, stadiumDay: 0, slander: 0, slanderUntil: 0, slanderCool: 0, schoolAudit: 0, sSchool: 0, schoolNotice: 0, staffOffer: 0, govYes: 0, freeLandmark: 0, freeApartment: 0, buyoutFailed: 0, everRefused: 0, everAllied: 0,
    sIdle: 0, sRed: 0, sDisc: 0, sPower: 0, mayor: null, stolenVotes: 0, vandalMark: 0, campaignResponded: false, govCircleCool: 0, fedCircleCool: 0, surv: 0, survCool: 0, survOutcryUntil: 0, freeCameras: 0, rallyMood: 0, rallyUntil: 0, tsuiHush: 0, tsuiBound: 0, golfAsk: 0, golfUntil: 0, statueOffer: 0, eco: 0, ecoUntil: 0, ecoCool: 0, ecoParks: 0, speakerDown: 0, speakerUntil: 0, speakerCool: 0, tsuiLoan: 0, tsuiLoanUntil: 0, tsuiLoanCool: 0, tsuiLoanTook: 0, tierSeen: 0, tierUp: 0, tierQuote: 0, quotesUsed: [], invest: 0, investCool: 0, investTook: 0, pendingFactory: 0, speech: 0, promise: null, promiseDay: 0, promiseSeq: 0, promiseBroken: 0, promiseKept: 0, log: [], logSeq: 0, dismissed: [] };
}

const rc = (i) => [Math.floor(i / SIZE), i % SIZE];
const at = (r, c) => (r < 0 || c < 0 || r >= SIZE || c >= SIZE ? -1 : r * SIZE + c);

function derive(grid, workforce = Infinity, taxKey = "normal", fundKey = "normal", terrain = null, heirKey = null, eventId = null, flags = {}) {
  const EV = eventById(eventId);
  const fastparkBuilt = grid.some((c) => c && c.type === "fastpark" && !c.build);
  const monumentCount = grid.filter((c) => c && c.type === "monument").length;
  // What the city does to the air and water. Industry is the weight; green
  // space and transit are the counterweight.
  const envStacks = grid.filter((c) => c && c.type === "factory" && !c.build).length;
  const envPrisons = grid.filter((c) => c && c.type === "prison" && !c.build).length;
  const envPlants = grid.filter((c) => c && c.type === "plant" && !c.build
    && (c.lv || 0) < maxLevel("plant")).length;          // a fully upgraded plant runs clean
  const envGreen = grid.filter((c) => c && !c.build
    && (c.type === "park" || c.type === "fastpark" || c.type === "monument")).length
    + 3 * grid.filter((c) => c && !c.build && c.type === "golf").length;
  const envTransit = grid.filter((c) => c && !c.build
    && (c.type === "bus" || c.type === "subway")).length;
  const CH = CHIEFS[flags.chiefId] || null;
  const chiefStaff = CH ? CH.staff : 0;
  const copMul = (CH ? CH.police : 1) * (flags.shake ? 0.5 : 1) * (flags.protestMul || 1) * (flags.leaderless ? 0.85 : 1);
  const entRevMul = CH ? CH.entRev : 1;
  let waivedStations = 0, churchTax = 0;
  const H = HEIRS[heirKey] || null;
  if (EV && EV.labor && workforce !== Infinity) workforce = Math.floor(workforce * EV.labor);
  const pollMul = (H ? H.pollution : 1) * (flags.pollCut || 1);
  const leisure = H ? H.leisure : 1;
  const T = TAX[taxKey] || TAX.normal;
  const F = FUND[fundKey] || FUND.normal;
  const WK = WORKS[flags.works] || WORKS.balanced;
  const MY = MAYORS[flags.mayor] || {};
  const upkeepMul = flags.upkeepMul || 1;
  const civicCost = (n) => Math.round(n * (T.civic ?? 1) * upkeepMul);
  const indUp = (n) => Math.round(n * upkeepMul);
  const isRoadTile = (i) => i >= 0 && isCarriageway(grid[i]);

  // Road network: only the largest connected run of road counts as the town's
  // main network. Isolated stubs are orphans and serve nothing.
  const roadComp = new Array(N).fill(-1);
  const roadGroups = [];
  grid.forEach((cell, i) => {
    if (!isRoadTile(i) || roadComp[i] !== -1) return;
    const list = [];
    const q = [i];
    roadComp[i] = roadGroups.length;
    while (q.length) {
      const cur = q.pop();
      list.push(cur);
      const [r, c] = rc(cur);
      [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].forEach((nb) => {
        if (isRoadTile(nb) && roadComp[nb] === -1) { roadComp[nb] = roadComp[i]; q.push(nb); }
      });
    }
    roadGroups.push(list);
  });
  let mainRoad = -1, best = 0;
  roadGroups.forEach((g, k) => { if (g.length > best) { best = g.length; mainRoad = k; } });
  const orphanRoads = roadGroups.reduce((a, g, k) => a + (k === mainRoad ? 0 : g.length), 0);
  const isRoad = (i) => isRoadTile(i) && roadComp[i] === mainRoad;
  // The ramp counts as connected when the town's main road network reaches it,
  // either by paving the square itself or by bringing a road up alongside.
  let highwayOn = false;
  if (flags.interstate !== undefined && flags.interstate >= 0) {
    const hi = flags.interstate;
    const [hr, hc] = rc(hi);
    highwayOn = isRoad(hi)
      || [at(hr - 1, hc), at(hr + 1, hc), at(hr, hc - 1), at(hr, hc + 1)]
           .some((nb) => nb >= 0 && isRoad(nb));
  }
  const highwayTrade = highwayOn ? HIGHWAY_TRADE : 1;

  const status = {};
  let powerCap = 0, powerDemand = 0, popCap = 0, jobs = 0, upkeep = 0, revenue = 0;
  let roadUpkeep = 0;   // summed as fractions, settled once in whole dollars
  let billboardMsg = 0;   // accumulated in pass 1; folded into message below
  let upPower = 0, upIndustry = 0, upCivic = 0, goods = 0, smuggling = 0;
  let guard = null, hallJobs = 0, mansionOn = false, statueUp = false;
  const mansions = [];
  let anyDisc = false, anyUnwired = false, anyOverload = false, anyUnstaffed = false, plantBuilt = false, anyBuilding = false;
  const parks = [], houses = [];

  // pass 1: road access, operating plants
  grid.forEach((cell, i) => {
    if (!cell) return;
    const [r, c] = rc(i);
    if (cell.type === "plant") plantBuilt = true;
    if (cell.type === "hall") {
      const hb = statsOf(cell);
      const hu = civicCost(hb.upkeep || 0);
      upkeep += hu; upCivic += hu;
      if (hb.guard) guard = [r, c, hb.guard];
      hallJobs = hb.jobs || 0;
      status[i] = { connected: true, powered: true, functioning: true, staffed: true };
      return;
    }
    if (cell.type === "road" || cell.type === "bridge") { const ru = (statsOf(cell).upkeep || 0) * WK.roadUp; roadUpkeep += ru; }
    if (cell.type === "road" || cell.type === "bridge" || cell.type === "line" || cell.type === "hallpart") {
      status[i] = { connected: true, powered: true, functioning: true, staffed: true };
      return;
    }
    // Loudspeakers are bolted to poles, not visited. They need power, not a road.
    const connected = cell.type === "speaker" || cell.type === "billboard" || cell.type === "camera"
      || isRoad(at(r - 1, c)) || isRoad(at(r + 1, c)) || isRoad(at(r, c - 1)) || isRoad(at(r, c + 1));
    status[i] = { connected, powered: false, functioning: false, staffed: true, building: (cell.build || 0) > 0 };
    // A plant being upgraded keeps running on its old tier, so it is the one
    // thing that must not be short-circuited by the construction check.
    if (cell.build > 0 && !(cell.type === "plant" && cell.up)) { anyBuilding = true; return; }
    if (cell.type === "monument") {
      const mm = statsOf(cell); status[i] = { connected: true, powered: true, functioning: true, staffed: true };
      const mu = civicCost(mm.upkeep); upkeep += mu; upCivic += mu;
      parks.push([r, c, (mm.mood || 12) * leisure]);
      return;
    }
    if (cell.type === "statue") {
      // No wires, no crew, no bill. It simply stands.
      status[i] = { connected: true, powered: true, functioning: true, staffed: true };
      statueUp = true;
      return;
    }
    if (cell.type === "billboard") {
      if (cell.build > 0) { status[i] = { connected: true, powered: true, functioning: false, staffed: true, building: true }; anyBuilding = true; return; }
      const bb = statsOf(cell); status[i] = { connected: true, powered: true, functioning: !flags.graffiti, staffed: true };
      const bu = civicCost(bb.upkeep); upkeep += bu; upCivic += bu;
      if (!flags.graffiti) billboardMsg += (bb.message || 0.75) * (flags.campaign ? 1.3 : 1) * (MY.msg || 1);
      return;
    }
    if (cell.type === "golf") {
      // Grass does not draw from the grid. A course needs a road and a crew,
      // nothing else; power is not part of the game it plays.
      if (status[i]) { status[i].powered = true; status[i].functioning = status[i].connected && status[i].staffed && !(cell.build > 0); }
      return;
    }
    if (cell.type === "park") { if (cell.build > 0) { status[i] = { connected: true, powered: true, functioning: false, staffed: true, building: true }; anyBuilding = true; return; }
      const pk = statsOf(cell); status[i].powered = true; status[i].functioning = true; const pu = civicCost(pk.upkeep); upkeep += pu; upCivic += pu; parks.push([r, c, (pk.mood || 10) * leisure * (fastparkBuilt ? 0.95 : 1)]); return; }
    if (cell.type === "fastpark") {
      if (cell.build > 0) { status[i] = { connected: true, powered: true, functioning: false, staffed: true, building: true }; anyBuilding = true; return; }
      const fp2 = statsOf(cell); status[i].powered = true; status[i].functioning = true;
      const fu = civicCost(fp2.upkeep); upkeep += fu; upCivic += fu;
      parks.push([r, c, (fp2.mood || 16) * leisure]);
      return;
    }
    if (!connected) anyDisc = true;
    if (cell.type === "plant") {
      if (cell.build > 0 && !cell.up) { status[i] = { connected, powered: false, functioning: false, staffed: true, building: true }; anyBuilding = true; return; }
      if (cell.build > 0) anyBuilding = true;   // upgrading: still a site, but still generating
      const ps = plantStats(cell);
      if (connected) { const gen = Math.round(ps.gen * T.plantGen * (EV && EV.plantGen ? EV.plantGen : 1)), up = Math.round(ps.upkeep * T.plantUpkeep * upkeepMul);
        status[i].powered = true; status[i].functioning = true; powerCap += gen; upkeep += up; upPower += up; }
      return;
    }
    if (connected && !cell.build) powerDemand += statsOf(cell).pow;
  });

  // pass 1b: plant crews. Operators are hired first. A short-handed plant still
  // runs, just at reduced output, so the grid never goes fully dark.
  let labor = workforce;
  grid.forEach((cell, i) => {
    if (!cell || cell.type !== "plant" || !status[i].functioning) return;
    const ps = plantStats(cell);
    const need = ps.jobs || 0;
    const hired = Math.min(need, Math.max(0, labor));
    labor -= hired;
    // never below 40% of rated output: a skeleton crew keeps the turbines turning
    const ratio = need === 0 ? 1 : Math.max(0.4, hired / need);
    status[i].crew = ratio;
    status[i].staffed = ratio >= 1;
    if (ratio < 1) anyUnstaffed = true;
    const full = Math.round(ps.gen * T.plantGen);
    powerCap -= full - Math.round(full * ratio);
  });
  // pass 2: power networks. Plants, lines, and buildings conduct; roads and parks do not.
  const comp = new Array(N).fill(-1);
  const nets = [];
  grid.forEach((cell, i) => {
    if (!conducts(cell) || comp[i] !== -1) return;
    const list = [];
    const q = [i];
    comp[i] = nets.length;
    while (q.length) {
      const cur = q.pop();
      list.push(cur);
      const [r, c] = rc(cur);
      [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].forEach((nb) => {
        if (nb >= 0 && conducts(grid[nb]) && comp[nb] === -1) { comp[nb] = comp[i]; q.push(nb); }
      });
    }
    nets.push(list);
  });

  nets.forEach((list) => {
    let cap = 0;
    list.forEach((i) => { if (grid[i].type === "plant" && status[i].functioning) cap += Math.round(statsOf(grid[i]).gen * T.plantGen * (EV && EV.plantGen ? EV.plantGen : 1)); });
    const consumers = list
      .filter((i) => (statsOf(grid[i]).pow || 0) > 0 && status[i].connected && !grid[i].build)
      .sort((a, b) => grid[a].seq - grid[b].seq);
    let used = 0;
    consumers.forEach((i) => {
      const need = statsOf(grid[i]).pow;
      if (used + need <= cap) { used += need; status[i].powered = true; status[i].functioning = true; }
      else if (cap === 0) anyUnwired = true;
      else anyOverload = true;
    });
  });

  // pass 2a-and-a-half: Pipp's Plaza only operates with the law next door.
  grid.forEach((cell, i) => {
    if (!cell || cell.type !== "plaza" || !status[i].functioning) return;
    const [r, c] = rc(i);
    const guarded = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([rr, cc]) => {
      if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) return false;
      const n = grid[at0(rr, cc)], ns = status[at0(rr, cc)];
      return n && n.type === "police" && !n.build && ns && ns.connected && ns.powered;
    });
    if (!guarded) { status[i].functioning = false; status[i].unguarded = true; }
  });

  // pass 2b: everyone else. Jobs fill in build order; a building that cannot
  // fill its roster opens anyway, producing in proportion to the crew it has.
  const employers = grid
    .map((cell, i) => (cell && cell.type !== "plant" && (statsOf(cell).jobs || 0) > 0 && status[i].functioning ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => grid[a].seq - grid[b].seq);
  employers.forEach((i) => {
    const need = grid[i].type === "police" ? Math.max(1, statsOf(grid[i]).jobs + F.staff + chiefStaff)
      : grid[i].type === "prison" ? Math.max(1, statsOf(grid[i]).jobs + chiefStaff)
      : statsOf(grid[i]).jobs;
    const hired = Math.min(need, Math.max(0, labor));
    labor -= hired;
    const ratio = need === 0 ? 1 : hired / need;
    status[i].crew = ratio;
    status[i].staffed = ratio >= 1;
    if (ratio <= 0) { status[i].functioning = false; anyUnstaffed = true; }
    else if (ratio < 1) anyUnstaffed = true;
  });

  // Landmarks change the rules for everyone else, so their state is settled
  // before the tally begins.
  let theatreOn = false, hideawayOn = false, plazaOn = false, schoolsWorking = 0;
  grid.forEach((cell, i) => {
    if (!cell || !status[i] || !status[i].functioning) return;
    const cw = status[i].crew === undefined ? 1 : status[i].crew;
    if (cw <= 0) return;
    if (cell.type === "theatre") theatreOn = true;
    if (cell.type === "hideaway") hideawayOn = true;
    if (cell.type === "plaza") plazaOn = true;
    if (cell.type === "school" && !flags.schoolsShut) schoolsWorking++;
  });
  const venueRevMul = theatreOn ? 0.85 : 1;
  const bankCount = Math.min(3, grid.filter((c, i) => c && c.type === "bank" && !c.build
    && status[i].functioning && (status[i].crew === undefined || status[i].crew > 0)).length);
  const shopRevMul = (plazaOn ? 0.8 : 1) * (1 + 0.05 * bankCount);
  let fastparkOn = false, fastparkTax = 0;
  grid.forEach((cell, i) => {
    if (!cell || cell.type !== "fastpark" || cell.build > 0) return;
    fastparkOn = true;
    const [r, c] = rc(i);
    let capSum = 0;
    [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([rr, cc]) => {
      if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) return;
      const n = grid[at0(rr, cc)];
      if (n && n.type === "house" && status[at0(rr, cc)].functioning) capSum += statsOf(n).cap || 0;
    });
    fastparkTax = Math.round(0.5 * capSum);
  });

  // pass 3: tallies
  const targets = [], cops = [], taverns = [], polluterList = [];
  let faith = 0, cheer = 0, learning = 0, eduBuff = 0, stadiumCrime = 0, cameras = 0, churchWeight = 0, loudChurches = 0;
  const buses = [], shops = [], venues = [], schools = [], prisons = [], schoolCov = [], factories = [];
  let rowdiness = 0, held = 0, care = 0, message = billboardMsg;
  const medical = [];

  // polluters must be known before revenue, so collect them first
  grid.forEach((cell, i) => {
    if (!cell || !status[i] || !status[i].functioning) return;
    const [r, c] = rc(i);
    const b = statsOf(cell);
    if (cell.type === "factory") polluterList.push([r, c]);
    if (cell.type === "plant") { const pb = plantStats(cell); jobs += pb.jobs || 0; if (!pb.clean) polluterList.push([r, c]); }
  });
  const smogAt = (r, c) => Math.min(polluterList.filter(([pr, pc]) => Math.abs(pr - r) + Math.abs(pc - c) <= 2).length, 3);

  // Poles the protesters got to are dead: no message, and nothing to drown out.
  if (flags.speakersDown) {
    grid.forEach((cell, i) => {
      if (cell && cell.type === "speaker" && status[i]) {
        status[i].functioning = false;
        status[i].dismantled = true;
      }
    });
  }

  // Loudspeakers drown out anything sociable within 2 tiles.
  const speakerList = [];
  grid.forEach((cell, i) => {
    if (!cell || cell.type !== "speaker" || !status[i] || !status[i].functioning) return;
    speakerList.push(rc(i));
  });
  const noiseAt = (r, c) => Math.min(2, speakerList.filter(([sr, sc]) => Math.abs(sr - r) + Math.abs(sc - c) <= 2).length);

  grid.forEach((cell, i) => {
    if (!cell || !status[i] || !status[i].functioning) return;
    const [r, c] = rc(i);
    const b = statsOf(cell);
    const smogPenalty = 1 - 0.2 * pollMul * smogAt(r, c);
    const crew = status[i].crew === undefined ? 1 : status[i].crew;
    if (cell.type === "house") { popCap += b.cap; houses.push([r, c]); targets.push([r, c]); }
    if (cell.type === "shop") {
      if (cell.vandal && (flags.day || 0) < cell.vandal) {
        // Boarded up. No staff, no till, nothing to tax; the glazier comes eventually.
        status[i].vandalized = true;
        return;
      }
      jobs += b.jobs; shops.push([i, b.rev || 0, smogPenalty * crew * shopRevMul]); targets.push([r, c]); }
    if (cell.type === "factory") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      goods += Math.round((b.rev || 0) * (cell.smuggle ? 2 : 1) * crew * (flags.retrofit || 1) * highwayTrade * (flags.commsTrade || 1) * (MY.ind || 1)); if (cell.smuggle) smuggling += 1;
      factories.push([r, c, indUp(b.upkeep)]); targets.push([r, c]); }
    if (cell.type === "police") { const cu = Math.round(civicCost(b.upkeep) * F.upkeep * (flags.copWage || 1));
      jobs += Math.max(1, b.jobs + F.staff + chiefStaff);
      const tsuiCap = CH && CH.tsuiStations ? CH.tsuiStations + (flags.mayor === "jenkins" && CH.name === "Leroy Jenkins" ? 1 : 0) : 0;
      if (waivedStations < tsuiCap) waivedStations++;
      else { upkeep += cu; upCivic += cu; }
      if (!flags.copsOut) cops.push([r, c, (b.reach || 3) + (T.police > 1 ? 1 : 0), crew]); }
    // Cameras watch a smaller radius at partial strength. They fill the gaps a
    // patrol never reaches, but never match an officer standing there.
    if (cell.type === "camera") { const cu = Math.round(civicCost(b.upkeep) * F.upkeep); upkeep += cu; upCivic += cu;
      if (!flags.copsOut) { cameras += 1; cops.push([r, c, b.reach || 2, b.watch || 0.6]); } }
    if (cell.type === "tavern") { const q = smogPenalty * crew * (1 - 0.3 * noiseAt(r, c));
      jobs += b.jobs; revenue += Math.round(b.rev * q * leisure * entRevMul); cheer += (b.cheer || 2) * q * leisure; taverns.push([r, c]); targets.push([r, c]); }
    if (cell.type === "church") { const cu = civicCost(b.upkeep); jobs += b.jobs; upkeep += cu; upCivic += cu;
      // A congregation cannot hear itself think next to a loudspeaker. The
      // church goes dark rather than merely discounted, like a tavern is.
      const silenced = noiseAt(r, c) > 0;
      if (!silenced) {
        faith += (b.faith || 2) * 0.65 * crew * (flags.faithStance === "attend" ? 1.25 : 1) * (flags.churchMul || 1);
        churchWeight += crew;
      } else {
        loudChurches += 1;
      }
      if (flags.faithStance === "refuse") churchTax += Math.round(5 * crew); }
    if (cell.type === "school") {
      // A struck school still costs the town money; it just teaches nobody.
      const cu = Math.round(civicCost(b.upkeep) * (flags.wageMul || 1));
      upkeep += cu; upCivic += cu;
      if (!flags.schoolsShut) {
        jobs += b.jobs;
        learning += (b.learn || 1) * smogPenalty * crew * (1 - 0.3 * noiseAt(r, c)) * (flags.doctrineSchools || 1);
        schools.push([r, c]);
        schoolCov.push([r, c, b.reach || SCHOOL_REACH, crew]);
      }
    }
    if (cell.type === "mansion") { const cu = civicCost(b.upkeep); jobs += b.jobs; upkeep += cu; upCivic += cu; mansionOn = true; mansions.push([i, r, c]); }
    if (cell.type === "histcenter") { const cu = civicCost(b.upkeep); jobs += b.jobs; upkeep += cu; upCivic += cu; eduBuff += (b.edu || 0.35) * crew; }
    if (cell.type === "stadium") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      revenue += Math.round((b.rev || 0) * smogPenalty * crew * leisure * entRevMul);
      stadiumCrime += (b.crime || 4) * crew; targets.push([r, c]); }
    if (cell.type === "venue") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      revenue += Math.round(b.rev * smogPenalty * crew * leisure * venueRevMul * entRevMul); cheer += (b.cheer || 6) * smogPenalty * crew * leisure; rowdiness += (b.rowdy || 2.5) * crew;
      venues.push([r, c]); targets.push([r, c]); }
    if (cell.type === "speaker") { const cu = Math.round(civicCost(b.upkeep) * (flags.campaign ? 2 : 1));
      upkeep += cu; upCivic += cu; message += (b.message || 1) * (flags.campaign ? 1.3 : 1) * (MY.msg || 1); }
    if (cell.type === "golf") { const gu = civicCost(b.upkeep); jobs += b.jobs; upkeep += gu; upCivic += gu;
      cheer += (b.cheer || 10) * crew * leisure;
      targets.push([r, c]); }
    if (cell.type === "theatre") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      cheer += (b.cheer || 12) * smogPenalty * crew * leisure;
      revenue += Math.round((b.rev || 0) * smogPenalty * crew * leisure * (flags.bustPardon ? 1.05 : 1));
      targets.push([r, c]); }
    if (cell.type === "hideaway") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      revenue += Math.round((b.rev || 0) * smogPenalty * crew); targets.push([r, c]); }
    if (cell.type === "plaza") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      revenue += Math.round((b.rev || 0) * smogPenalty * crew); targets.push([r, c]); }
    if (cell.type === "bank") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep); targets.push([r, c]); }
    if (cell.type === "clinic" || cell.type === "hospital") { const cu = civicCost(b.upkeep); jobs += b.jobs; upkeep += cu; upCivic += cu;
      care += (b.care || 1) * smogPenalty * crew * (MY.care || 1); medical.push([r, c]); }
    if (cell.type === "prison") { const cu = civicCost(b.upkeep); jobs += Math.max(1, b.jobs + chiefStaff); upkeep += cu; upCivic += cu; held += flags.riotOn ? 0 : (b.hold || 4) * crew * (flags.bustArrest ? 1.1 : 1) * copMul; if (b.gloom) prisons.push([r, c, b.gloom]); }
    if (cell.type === "bus" || cell.type === "subway") { const cu = civicCost(b.upkeep); jobs += b.jobs; upkeep += cu; upCivic += cu;
      buses.push([r, c, (b.relief || 0.4) * crew * WK.transit * (MY.relief || 1), (b.relief || 0.4) * crew * WK.transit * (MY.relief || 1) * (cell.type === "subway" ? 0.165 : 0.14)]); }
  });

  // Libraries and the History Center sharpen every school. The buff scales the
  // learning already produced, capped so a stack of archives can't run away.
  const eduMul = 1 + Math.min(0.6, eduBuff);
  learning = learning * eduMul * (MY.learn || 1);

  // Shop demand: the town supports one shop per 10 residents at full price.
  // Each shop past that captures a shrinking slice of what is left.
  const SHOP_CATCHMENT = 10;
  const supported = (workforce === Infinity ? 0 : workforce) / SHOP_CATCHMENT;
  let shopDemand = 0;
  const shopAt = shops.map(([i]) => rc(i));
  shops
    .sort((a, b) => grid[a[0]].seq - grid[b[0]].seq)
    .forEach(([i, rev, smogPenalty], k) => {
      // full rate while shops still fit inside the catchment, then taper
      const share = k < supported ? 1 : Math.max(0.15, supported / (k + 1));
      // A high street beats a lone corner store, and customers help more than
      // company does. Both are capped so a district pays and a monoculture does not.
      const [sr, sc] = rc(i);
      const near = ([ar, ac]) => Math.abs(ar - sr) + Math.abs(ac - sc);
      const mates = Math.min(3, shopAt.filter((p) => p[0] !== sr || p[1] !== sc).filter((p) => near(p) <= 2).length);
      const custom = Math.min(4, houses.filter((p) => near(p) <= 2).length);
      const district = (1 + 0.06 * mates + 0.05 * custom) * (flags.govTrade || 1) * (flags.commsTrade || 1);
      const earned = Math.round(rev * share * smogPenalty * highwayTrade * district * (MY.shop || 1));
      status[i].demand = share;
      status[i].earned = earned;
      status[i].mates = mates;
      status[i].custom = custom;
      revenue += earned;
      shopDemand += share;
    });
  const roadBill = Math.round(roadUpkeep);
  upkeep += roadBill;
  upCivic += roadBill;

  // Never refused, never testified: their people cover the crime spike and
  // the trail, not the money. One refusal, ever, and this is gone for good.
  const tsuiLoyal = flags.mafia === "allied" && !flags.everRefused && !flags.testified;

  const shopSaturation = shops.length ? shopDemand / shops.length : 1;

  // The city attorney is on retainer whether or not anyone is suing this week.
  if (flags.lawyerFee) { upkeep += flags.lawyerFee; upCivic += flags.lawyerFee; }
  if (flags.commsFee) { upkeep += flags.commsFee; upCivic += flags.commsFee; }
  if (flags.chiefFee) { upkeep += flags.chiefFee; upCivic += flags.chiefFee; }

  // Industrial neighbours share the cost of everything that serves them.
  let industrialRebate = 0;
  factories.forEach(([fr, fc, cost]) => {
    const mates = Math.min(3, factories.filter(([or_, oc]) => (or_ !== fr || oc !== fc)
      && Math.abs(or_ - fr) + Math.abs(oc - fc) <= 2).length);
    industrialRebate += cost * 0.06 * mates;
  });
  industrialRebate = Math.round(industrialRebate);
  upkeep -= industrialRebate;
  upIndustry -= industrialRebate;

  let envAvg = 0;
  grid.forEach((cell, i) => {
    if (!cell || !status[i] || !status[i].functioning) return;
    if (!["house", "shop", "tavern", "school", "clinic", "hospital", "venue", "theatre", "hideaway", "plaza"].includes(cell.type)) return;
    const [r, c] = rc(i);
    status[i].smog = smogAt(r, c);
    if (cell.type === "house") {
      status[i].rowdy = Math.min(taverns.filter(([tr, tc]) => Math.abs(tr - r) + Math.abs(tc - c) === 1).length, 2);
    }
  });
  const scenery = [];
  if (terrain) {
    terrain.forEach((g, i) => {
      if (!grid[i] && (g === WOODS || g === WATER)) scenery.push(rc(i));
    });
  }
  // A house in the catchment of a school is worth more to the tax office.
  // Two schools reaching the same block is plenty; a third adds nothing.
  let schoolTax = 0, waterTax = 0;
  if (houses.length) {
    let sum = 0;
    houses.forEach(([r, c]) => {
      const dist = ([pr, pc]) => Math.abs(pr - r) + Math.abs(pc - c);
      const parkMood = parks.filter((p) => dist(p) <= 2).slice(0, 3).reduce((a, p) => a + p[2], 0);
      const view = Math.min(3, scenery.filter((p) => dist(p) <= 2).length) * 2.5;
      const gloom = prisons.reduce((a, [pr, pc, g]) => a + (Math.abs(pr - r) + Math.abs(pc - c) <= 2 ? g : 0), 0);
      sum += parkMood + view - gloom - 11 * pollMul * smogAt(r, c)
                      - 9 * Math.min(taverns.filter((t) => dist(t) === 1).length, 2)
                      - 7 * Math.min(venues.filter((v) => dist(v) <= 2).length, 2);
      schoolTax += Math.min(2, schools.filter((sc) => dist(sc) <= 3).length) * 2;
      // A house that actually touches the water pays a little more: it's the
      // view, not the school district, doing the work here.
      const onWater = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
        .some(([rr, cc]) => rr >= 0 && cc >= 0 && rr < SIZE && cc < SIZE && terrain
          && terrain[at(rr, cc)] === WATER);
      if (onWater) waterTax += 3;
    });
    envAvg = sum / houses.length;
  }
  schoolTax = Math.round(schoolTax * (T.taxRate > 0 ? T.taxRate : 0));
  waterTax = Math.round(waterTax * (T.taxRate > 0 ? T.taxRate : 0));
  const tavernMood = Math.min(12, cheer);

  // Traffic: every working building sends trips onto the road tiles it touches.
  // Roads carry 6 trips comfortably; past that, congestion sets in.
  const ROAD_CAPACITY = 6 * WK.roadFlow;
  const load = new Array(N).fill(0);
  grid.forEach((cell, i) => {
    if (!cell || !status[i] || !status[i].functioning) return;
    if (cell.type === "road" || cell.type === "bridge" || cell.type === "line" || cell.type === "park" || cell.type === "hall" || cell.type === "hallpart") return;
    const b = statsOf(cell);
    const trips = b.trips !== undefined ? b.trips : (b.cap || 0) + (b.jobs || 0);
    if (!trips) return;
    const [r, c] = rc(i);
    const touching = [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].filter(isRoad);
    if (!touching.length) return;
    const share = trips / touching.length;
    touching.forEach((nb) => { load[nb] += share; });
  });

  // Bus stations shed trips from the roads they touch, but a lone station has
  // nowhere to send anyone: you need at least two on the network.
  const transit = buses.length >= 2 && !(EV && EV.noTransit);
  const relief = new Array(N).fill(0);
  if (transit) {
    buses.forEach(([r, c, amt]) => {
      [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].forEach((nb) => {
        if (isRoad(nb)) relief[nb] = Math.max(relief[nb], amt);
      });
    });
  }

  // Spread each tile's load with its neighbours so a lone connector street
  // carrying a whole district actually shows as a bottleneck.
  const flow = new Array(N).fill(0);
  grid.forEach((cell, i) => {
    if (!isRoad(i)) return;
    const [r, c] = rc(i);
    const nbs = [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].filter(isRoad);
    const raw = load[i] + nbs.reduce((a, nb) => a + load[nb], 0) / Math.max(1, nbs.length) * 0.5;
    flow[i] = raw * (1 - relief[i]);
  });

  let congested = 0, roadCount = 0, jamSum = 0;
  grid.forEach((cell, i) => {
    if (!isRoad(i)) return;
    roadCount += 1;
    const cap = grid[i].type === "bridge" ? ROAD_CAPACITY * 0.6 : ROAD_CAPACITY;
    const jam = Math.max(0, flow[i] - cap) / cap;
    status[i].jam = jam;
    status[i].flow = flow[i];
    if (jam > 0.15) congested += 1;
    jamSum += Math.min(1.5, jam);
  });
  const globalRelief = transit ? Math.min(0.5, buses.reduce((a, b) => a + (b[3] || 0.07), 0)) : 0;
  let traffic = roadCount ? Math.min(1, (jamSum / roadCount) * (1 - globalRelief) * (EV && EV.traffic ? EV.traffic : 1) * (flags.iceOn ? 1.15 : 1) * (highwayOn ? HIGHWAY_TRAFFIC : 1) * (flags.govTraffic || 1) * (flags.protestTraffic || 1)) : 0;
  // Some events do not scale what you had, they simply stop the city.
  if (EV && EV.trafficFloor && roadCount) traffic = Math.max(traffic, EV.trafficFloor);

  // Same computation as police coverage: each house takes the strength of its
  // best nearby school, never the sum, so a second school over already-covered
  // ground adds nothing. The targets are houses only, not every building.
  // The Governor's Mansion only operates inside a police beat. This is
  // coverage rather than adjacency, so a station a few streets away will do.
  mansions.forEach(([i, mr, mc]) => {
    const covered = cops.some(([pr, pc, reach]) => Math.abs(pr - mr) + Math.abs(pc - mc) <= reach);
    if (!covered) { status[i].functioning = false; status[i].unpoliced = true; mansionOn = false; }
  });

  let schoolFrac = 0;
  if (houses.length) {
    let covered = 0;
    houses.forEach(([r, c]) => {
      let best = 0;
      schoolCov.forEach(([pr, pc, reach, cw]) => {
        if (Math.abs(pr - r) + Math.abs(pc - c) <= reach) best = Math.max(best, cw === undefined ? 1 : cw);
      });
      covered += Math.min(1, best);
    });
    schoolFrac = covered / houses.length;
  }

  let policeFrac = 0;
  if (cops.length && targets.length) {
    let covered = 0;
    targets.forEach(([r, c]) => {
      let best = 0;
      cops.forEach(([pr, pc, reach, cw]) => {
        if (Math.abs(pr - r) + Math.abs(pc - c) <= reach) best = Math.max(best, cw === undefined ? 1 : cw);
      });
      covered += best;
    });
    policeFrac = (covered / targets.length) * T.police;
    if (flags.bustArrest) policeFrac = Math.min(1.2, policeFrac * 1.1);
    policeFrac = Math.min(1.2, policeFrac * copMul);
  }
  if (guard && targets.length) {
    const [gr, gc, rad] = guard;
    const near = targets.filter(([r, c]) => Math.abs(gr - r) + Math.abs(gc - c) <= rad).length;
    policeFrac = Math.min(1.2, policeFrac + (near / targets.length) * 0.5);
  }

  if (EV && EV.care) care *= EV.care;
  if (EV && EV.upkeep) {
    const extra = Math.round(upkeep * (EV.upkeep - 1));
    upkeep += extra; upCivic += extra;
  }
  if (H && H.industry) goods = Math.round(goods * H.industry);
  if (flags.tradeBribes) goods = Math.round(goods * Math.pow(1.1, flags.tradeBribes));
  goods = Math.round(goods * (1 + 0.05 * bankCount));
  if (EV && EV.goods) goods = Math.round(goods * EV.goods);
  if (flags.iceOn) goods = Math.round(goods * 0.85);
  upkeep = Math.round(upkeep);
  const revenueNet = Math.round(revenue * (1 - 0.35 * traffic) * (EV && EV.trade ? EV.trade : 1) * (flags.iceOn ? 0.85 : 1));

  // Where the environment is heading. 100 is pristine. Industry drags it down,
  // green space pulls it back, and the doctrine you govern under colours all of
  // it. The bar itself drifts toward this in step() rather than snapping.
  if (mansionOn) learning *= 1.12;

  const envTarget = Math.max(0, Math.min(100,
    100
    - 7 * envStacks * (flags.envDirty || 1)
    - 3 * envPrisons
    - 9 * envPlants * (flags.envDirty || 1)
    - 24 * traffic
    + 4 * envGreen
    + 1.5 * envTransit
    + (flags.envCleaned ? 8 : 0)
    - (highwayOn ? HIGHWAY_ENV : 0)
    + WK.env
  ));
  return { status, powerCap, powerDemand, popCap, housing: popCap, jobs, upkeep, upPower, upIndustry, upCivic,
           revenue: revenueNet, revenueGross: revenue, traffic, congested, orphanRoads, envAvg, tavernMood,
           goods, learning, held, care, message, theatreOn, hideawayOn, plazaOn, fastparkOn, fastparkTax, churchTax, schoolTax, waterTax, bankCount, monumentCount, transit, buses: buses.length, venues: venues.length, rowdiness, smuggling, hallJobs, globalRelief, shops: shops.length, shopSaturation, supported,
           anyDisc, anyUnwired, anyOverload, anyUnstaffed, anyBuilding, plantBuilt, policeFrac,
           copPosts: cops, crimeTargets: targets, hallGuard: guard,
           schoolFrac, schoolCov, houseTargets: houses, tsuiLoyal,
           taverns: taverns.length, stadiumCrime, eduBuff, schoolCount: schools.length, cameras, churchWeight, churchCount: Math.round(churchWeight), loudChurches,
           highwayOn, mansionOn, statueUp,
           envTarget, env: flags.env === undefined ? START_ENV : flags.env,
           commsMood: flags.commsMood || 0, mayorMood: (MAYORS[flags.mayor] || {}).mood || 0,
           envStacks, envPlants, envPrisons, envGreen, envTransit,
           protestMood: flags.protestMood || 0, grace: flags.grace === undefined ? 1 : flags.grace, faith };
}

const homelessRate = (pop, d) => {
  const fp = Math.floor(pop);
  return fp > 0 ? Math.max(0, fp - (d.housing || 0)) / fp : 0;
};

// What the town's mood is made of. Mirrors calcHap term for term; if one
// changes the other has to follow.
function moodRows(pop, d, mafia, crime) {
  const rows = [];
  const push = (l, v) => { if (Math.abs(v) >= 0.05) rows.push([l, v]); };
  const fp = Math.floor(pop);
  const gr = d.grace === undefined ? 1 : d.grace;
  push("Baseline", 56);
  if (d.commsMood) push("Communications director", d.commsMood);
  if (d.mayorMood) push("Civic services", d.mayorMood);
  push("Environment", d.envAvg);
  push("Taverns", d.tavernMood);
  push("Clinics and hospitals", Math.min(10, 1.6 * (d.care || 0)));
  if (d.protestMood) push("Protests", d.protestMood);
  const unemp = fp > 0 ? Math.max(0, (fp - d.jobs) / fp) * 32 * Math.min(1, fp / 12) : 0;
  push("Idle residents", -unemp * gr);
  const hr = homelessRate(pop, d);
  push("Rough sleeping", -(hr <= 0.05 ? hr * 46 : 2.3 + (hr - 0.05) * 175) * gr);
  push("Congregations", -1.2 * (d.churchWeight || 0));
  push("Churches drowned out", -2 * (d.loudChurches || 0));
  const envNow = d.env === undefined ? 100 : d.env;
  push("Air quality alarm", -(envNow >= ENV_ALARM ? 0 : (ENV_ALARM - envNow) * 0.45));
  push("Traffic", -24 * (d.traffic || 0));
  const hasSchool = (d.schoolCov || []).length > 0;
  const schoolGate = hasSchool && fp >= (MILESTONE_POP.school || 26) ? 1 : 0;
  push("Homes outside a school district", -schoolGate * SCHOOL_UNCOVERED_WEIGHT * (1 - Math.min(1, d.schoolFrac || 0)) * gr);
  if (mafia === "allied") push("The family's presence", -3);
  if (crime > CRIME_THRESHOLD) push("Crime on the street", -(crime - CRIME_THRESHOLD) * 0.25);
  return rows;
}

// Why newcomers are or are not arriving. Multipliers are shown as percentages
// so the whole thing reads on one screen.
function growthRows(st, d, hap) {
  const rows = [];
  const T = TAX[st.tax] || TAX.normal;
  const EV = eventById(st.event);
  const CM = COMMS[st.commsId];
  const blocked = [];
  if (hap < GROWTH_FLOOR) blocked.push(`Mood is under ${GROWTH_FLOOR}. The town is emptying, not filling.`);
  if (Math.floor(st.pop) >= Math.floor(d.popCap)) blocked.push("Every home is full. Build housing.");
  if (st.day < (st.shootingUntil || 0)) blocked.push("A shooting has frozen arrivals for " + Math.ceil((st.shootingUntil || 0) - st.day) + " more days.");
  if ((st.tsuiWar || 0) > 0 && st.day < st.tsuiWar + 40) blocked.push("The feud with the family has frozen arrivals.");
  const pct = (l, m) => { if (Math.abs(m - 1) >= 0.005) rows.push([l, Math.round((m - 1) * 100)]); };
  rows.push(["Base rate from mood", Math.round((0.22 + hap / 100) * 100) / 100]);
  pct("An unhappy town", glumGrowth(hap));
  pct(`Tax policy: ${T.name}`, T.growth || 1);
  if (CM) pct(`${CM.name}, communications`, CM.growth || 1);
  if (EV && EV.growth) pct(`Event: ${EV.name}`, EV.growth);
  pct("Tommy's Hideaway", d.hideawayOn ? 1.12 : 1);
  pct("Sunday attendance", st.faithStance === "attend" ? 0.94 : 1);
  pct("Schooling", 1 + Math.min(0.45, 0.06 * (d.learning || 0)));
  pct("ICE in the city", st.ice === 2 ? ICE_GROWTH : 1);
  return { rows, blocked };
}

// What the air is answering to.
function envRows(d) {
  const rows = [];
  const push = (l, v) => { if (Math.abs(v) >= 0.05) rows.push([l, v]); };
  push("Clean slate", 100);
  push(`Factories (${d.envStacks || 0})`, -7 * (d.envStacks || 0));
  push(`Power plants (${d.envPlants || 0})`, -9 * (d.envPlants || 0));
  push(`Prisons (${d.envPrisons || 0})`, -3 * (d.envPrisons || 0));
  push("Traffic", -24 * (d.traffic || 0));
  push(`Parks and woodland (${d.envGreen || 0})`, 4 * (d.envGreen || 0));
  push(`Transit stops (${d.envTransit || 0})`, 1.5 * (d.envTransit || 0));
  return rows;
}

function calcHap(pop, d, mafia, crime) {
  const fp = Math.floor(pop);
  const unemp = fp > 0 ? Math.max(0, (fp - d.jobs) / fp) * 32 * Math.min(1, fp / 12) : 0;
  // Rough sleeping is tolerated up to 5% of the town, then it is a crisis.
  const hr = homelessRate(pop, d);
  const homeless = hr <= 0.05 ? hr * 46 : 2.3 + (hr - 0.05) * 175;
  // Every congregation asks something of the town it sits in. Slight alone,
  // noticeable once all three are ringing their bells.
  const piety = 1.2 * (d.churchWeight || 0);
  // A church drowned out by loudspeakers isn't just quiet, it's a small
  // civic irritant: people notice a silenced sanctuary.
  const loudPenalty = 2 * (d.loudChurches || 0);
  // Below the alarm line the whole town feels it, and it steepens all the way down.
  const envNow = d.env === undefined ? 100 : d.env;
  const envPain = envNow >= ENV_ALARM ? 0 : (ENV_ALARM - envNow) * 0.45;
  const gr = d.grace === undefined ? 1 : d.grace;
  // Nothing to answer for before the building exists: gated on the same
  // unlock that lets a school be built at all, then eased in like the other
  // structural pains while the town is young.
  const hasSchool = (d.schoolCov || []).length > 0;
  const schoolGate = hasSchool && Math.floor(pop) >= (MILESTONE_POP.school || 26) ? 1 : 0;
  const schoolPain = schoolGate * SCHOOL_UNCOVERED_WEIGHT * (1 - Math.min(1, d.schoolFrac || 0)) * gr;
  let h = 56 + (d.commsMood || 0) + (d.mayorMood || 0) + d.envAvg + d.tavernMood + Math.min(10, 1.6 * (d.care || 0)) + (d.protestMood || 0) - unemp * gr - homeless * gr - piety - loudPenalty - envPain - 24 * (d.traffic || 0) - schoolPain;
  if (mafia === "allied") h -= 10;
  if (mafia === "refused") h -= (crime || 0) * 0.25;
  return Math.round(Math.min(100, Math.max(5, h)));
}

function step(prev) {
  if (prev.over) return prev;
  let built = false;
  const grid = prev.grid.map((c) => {
    if (!c || !c.build) return c;
    built = true;
    const left = c.build - 1;
    const n = { ...c, build: left };
    if (left <= 0) { delete n.build; delete n.up; }
    return n;
  });
  if (built) prev = { ...prev, grid };
  const T = TAX[prev.tax] || TAX.normal;
  // Under Mulaney, grievances lose steam before they find the street. Read
  // here, at the top, because unrest checks are scattered all through step.
  const mCalm = (MAYORS[prev.mayor] || {}).calm || 1;

  // The Governor's circle and the President's circle each get to raise one
  // thing with the mayor at a time. A resolved ask buys the whole circle a
  // quiet spell, so five separate anxieties don't all come due the same week.
  // The feud is a fight between the two of them, so it occupies both.
  const govCircleCool = prev.govCircleCool || 0;
  const fedCircleCool = prev.fedCircleCool || 0;
  const feudPending = prev.feud === 1;
  const govCirclePending = feudPending || prev.marla === 1
    || prev.golfAsk === 1 || prev.golfAsk === 2 || prev.surv === 1;
  const fedCirclePending = feudPending || prev.rally === 1 || prev.slander === 1 || prev.stolenVotes === 1
    || ((prev.slander === 2 || prev.slander === 3) && prev.day < (prev.slanderUntil || 0));
  // The family's arrangement, read before anything that depends on the police
  // budget: while it holds, the force runs on a shoestring no matter what the
  // menu last said.
  let tsuiLoan = prev.tsuiLoan || 0;
  let tsuiLoanUntil = prev.tsuiLoanUntil || 0;
  const fundKeyNow = tsuiLoanUntil > (prev.day + 1) ? "lean" : prev.fund;
  const F = FUND[fundKeyNow] || FUND.normal;
  const H = HEIRS[prev.heir] || null;
  const CHF = CHIEFS[prev.chiefId] || null;
  const EV = eventById(prev.event);
  const DP = diffOf(prev.diff);
  const d = derive(prev.grid, Math.floor(prev.pop), prev.tax, prev.fund, prev.terrain, prev.heir, prev.event, { interstate: prev.interstate, works: prev.works, govTraffic: prev.govTraffic, mafia: prev.mafia, everRefused: prev.everRefused, testified: prev.testified, lawyerFee: LAWYERS[prev.lawyerId] ? LAWYERS[prev.lawyerId].fee : 0,
      commsFee: COMMS[prev.commsId] ? COMMS[prev.commsId].fee : 0, commsTrade: COMMS[prev.commsId] ? COMMS[prev.commsId].trade : 1,
      commsMood: COMMS[prev.commsId] ? COMMS[prev.commsId].mood : 0,
      chiefFee: CHIEFS[prev.chiefId] ? (CHIEFS[prev.chiefId].salary || 0) : 0, govTrade: prev.govTrade, bustArrest: prev.bust === 2, bustPardon: prev.bust === 3, chiefId: prev.chiefId, mayor: prev.mayor, day: prev.day, leaderless: !prev.chiefId && (prev.deadChiefs || []).length >= Object.keys(CHIEFS).length, speakersDown: (prev.speakerDown || 0) === 1,
      protestTraffic: ((prev.eco === 3 || prev.eco === 5) && prev.day < (prev.ecoUntil || 0)) ? 2 : 1, shake: (prev.chiefShake || 0) > prev.day, faithStance: prev.faithStance, campaign: (prev.campaignUntil || 0) > prev.day, tradeBribes: (prev.bribeTrade || []).filter((d) => d > prev.day).length, upkeepMul: DP.economy.upkeep, graffiti: prev.graffiti === 1, riotOn: prev.riot === 1, iceOn: prev.ice === 2, ...protestFlags(prev), ...strikeFlags(prev), ...copFlags(prev), ...faithFlags(prev), ...riverFlags(prev), grace: earlyGrace(prev.day), env: prev.env });
  const baseHap = calcHap(prev.pop, d, prev.mafia, prev.crime);
  const hap = baseHap + (H ? H.mood : 0) + (CHF ? CHF.mood : 0) + (EV && EV.mood ? EV.mood : 0);
  let pop = prev.pop;
  const overCap = pop >= d.popCap;
  if (overCap && hap >= 30) {
    // People keep arriving even with nowhere to live, just far more slowly.
    const room = Math.max(0, d.popCap * 1.35 - pop);
    if (room > 0) pop = Math.min(d.popCap * 1.35, pop + Math.min(room, 0.06 * T.growth));
  } else if (pop > d.popCap * 1.35) pop = Math.max(d.popCap * 1.35, pop - 2);
  else if (hap >= GROWTH_FLOOR && pop < d.popCap
      && (prev.day + 1) >= (prev.shootingUntil || 0)
      && !((prev.tsuiWar || 0) > 0 && (prev.day + 1) < prev.tsuiWar + 40))
    pop = Math.min(d.popCap, pop + (0.22 + hap / 100) * glumGrowth(hap) * (COMMS[prev.commsId] ? COMMS[prev.commsId].growth : 1) * T.growth * (EV && EV.growth ? EV.growth : 1) * (d.hideawayOn ? 1.12 : 1) * (prev.faithStance === "attend" ? 0.94 : 1) * (1 + Math.min(0.45, 0.06 * d.learning)) * (prev.ice === 2 ? ICE_GROWTH : 1));
  else if (hap < 28 && pop > 0) pop = Math.max(0, pop - 1);
  const employed = Math.min(Math.floor(pop), d.jobs);

  let mafia = prev.mafia, calm = prev.calm, mafiaMoney = 0;
  let tsuiReturn = prev.tsuiReturn || 0;
  if (mafia === "none" && tsuiReturn > 0 && prev.day + 1 >= tsuiReturn) { mafia = "choice"; tsuiReturn = 0; }
  else if (mafia === "none" && tsuiReturn === 0 && Math.floor(pop) >= MAFIA_POP) mafia = "choice";
  if (mafia === "allied") mafiaMoney = (prev.mayor === "jenkins" ? 20 : kickbackFor(prev.deal, prev.rigged)) + (prev.backroom ? 10 : 0);

  // Crime exists in every state. The mob just makes it much worse.
  const reprisal = prev.reprisal > 0 ? prev.reprisal - 1 : 0;
  const crimeRows = crimeLedgerRows({ mafia, reprisal, testified: prev.testified, rigged: prev.rigged,
    pop, backroom: prev.backroom, fund: prev.fund, heir: prev.heir, event: prev.event, gear: prev.gear,
    day: prev.day, bustUntil: prev.bustUntil, chiefId: prev.chiefId }, d);
  const crimeAim = crimeTargetOf(crimeRows);
  const aim = crimeAim.target * DP.crime.pressure;
  // Rising is damped, falling is not: a spike takes time to bite, and a fix
  // still works the day you make it.
  const crimeRate = CRIME_CHASE * (aim > prev.crime ? CRIME_RISE2 : 1);
  // Nothing happens in the first ten days. Nobody has had time to do anything.
  const CRIME_GRACE = 10;
  let crime = prev.day + 1 <= CRIME_GRACE ? 0
    : Math.min(100, Math.max(0, prev.crime + (aim - prev.crime) * crimeRate));
  if (mafia === "refused") {
    mafiaMoney = -Math.round(crime / 6 * DP.crime.mob);
    if (crime <= 5) { calm += 1; if (calm >= 12) { mafia = "defeated"; crime = 0; } }
    else calm = 0;
  }

  // A declared challenger's attack line drains approval every day it stays
  // true, and stops the day the issue is fixed.
  const attackCtx = challengerCtx(pop, d, hap,
    { crime, ties: entanglements({ ...prev, mafia }), rigged: prev.rigged, testified: prev.testified, day: prev.day + 1,
      stolenVotes: prev.stolenVotes, deadChiefs: prev.deadChiefs, deadLawyers: prev.deadLawyers,
      golfAsk: prev.golfAsk, eco: prev.eco, ecoUntil: prev.ecoUntil, grid: prev.grid });
  const attack = challengerAttack(prev.challenger, attackCtx).drag * (prev.campaignResponded ? 0.5 : 1);
  // The presidential visit lingers with the base either way, until a
  // successor gives the town somebody new to judge.
  const apRows = approvalRows({ ...prev, pop, crime, mafia,
    challengerDrag: attack, challengerLabel: prev.challenger ? prev.challenger.label : "" }, d, baseHap);
  const target = apRows.reduce((a, [, v]) => a + v, 0);
  // Approval rises at the tuned inertia but sinks at two-thirds of it, so the
  // mood is quicker to forgive than to sour. Crime's daily drag below is
  // separate and still bites at full strength.
  const APPROVAL_FALL = 0.66;
  const gap = target - prev.approval;
  const rate = DP.politics.inertia * (gap < 0 ? APPROVAL_FALL : 1);
  let approval = prev.approval + gap * rate;
  if (crime > CRIME_THRESHOLD) approval -= (crime - CRIME_THRESHOLD) * CRIME_APPROVAL;
  approval = Math.min(100, Math.max(0, approval));
  const day = prev.day + 1;
  const evRoll = (salt) => mulberry32((prev.seed || 1) * 104729 + day * 31 + salt)();

  // The environment answers slowly. You cannot fix it in a week and you cannot
  // ruin it in one either, which is exactly what makes neglect expensive.
  const envPrev = prev.env === undefined ? START_ENV : prev.env;
  const env = envPrev + ((d.envTarget === undefined ? envPrev : d.envTarget) - envPrev) * ENV_DRIFT;

  // Everything worth remembering goes in the paper. Banners read the fresh end
  // of this list; the newspaper panel reads all of it.
  let logSeq = prev.logSeq || 0;
  const newEntries = [];
  const note = (icon, title, text, kind) => {
    logSeq += 1;
    newEntries.push({ n: logSeq, d: day, i: icon, t: title, x: text, k: kind || "news" });
  };

  // A bad night. Not under McGurk, whose department kicks doors before anyone
  // gets that far; the other two run a lighter touch and it shows. A city at
  // odds with the Tsuis sees it far more often.
  let shooting = prev.shooting || 0;
  let shootingUntil = prev.shootingUntil || 0;
  let shootingDead = prev.shootingDead || 0;
  let shootingsSeen = prev.shootingsSeen || 0;
  if (shooting >= 2 && day >= shootingUntil) shooting = 0;
  const atWarWithTsui = mafia === "refused" || mafia === "defeated";
  const shootFloor = atWarWithTsui ? SHOOTING_POP_WAR : SHOOTING_POP;
  if (prev.chiefId && prev.chiefId !== "mcgurk" && day > CRIME_GRACE && Math.floor(pop) >= shootFloor && shooting === 0
      && day >= shootingUntil) {
    const feud = atWarWithTsui ? SHOOTING_WAR : 1;
    if (evRoll(113) < SHOOTING_ODDS * feud) {
      // One to eight, and never more people than the town actually has.
      const toll = Math.min(Math.floor(pop), 1 + Math.floor(evRoll(127) * 8));
      if (toll >= 1) {
        shootingDead = toll;
        shootingUntil = day + SHOOTING_SHOCK;
        shootingsSeen = shootingsSeen + 1;
        shooting = 2;
        note("🕯️", "GANG SHOOTING", `${toll} dead overnight on the east side. Nobody is moving here for ${SHOOTING_SHOCK} days.`, "bad");
        pop = Math.max(0, pop - toll);
      }
    }
  }
  if (mafia === "allied" && prev.mayor !== "jenkins" && prev.nextTalk > 0 && day >= prev.nextTalk) mafia = "renegotiate";
  // Federal heat. Opens once you are deep enough in, then tracks how visible
  // the arrangement is: more deals and more crime mean faster.
  const ties = entanglements({ ...prev, mafia });
  let fed = prev.fed || 0;          // 0 none, 1 open file, 2 indicted
  let heat = prev.heat || 0;
  if (fed === 0 && ties >= FED_TRIGGER) fed = 1;
  if (fed === 1) {
    // Roughly 100 days of exposure at three ties with no defences, and a
    // committed law-and-order town can hold the line indefinitely.
    // A governor who has taken your side makes the state's cooperation slower
    // and the paperwork heavier. It never closes the file.
    // The votes deal is unconditional: no favor threshold, no expiry, ever.
    if (prev.stolenVotes === 2 || (fedComplete(prev) && (prev.fedFavor || 0) >= 3)) { heat = 0; fed = 0; }
    const settled = prev.lawyerId && day >= (prev.lawyerFrom || 0) + LAWYER_HANDOVER;
    const lwHeat = settled
      ? (prev.lawyerId === "jenkins" && prev.mayor === "jenkins" ? 0.3 : LAWYERS[prev.lawyerId].heat)
      : 1;
    const shield = (prev.govShield ? 0.6 : 1) * lwHeat;
    const exposure = (0.32 * ties + crime / 90) * DP.crime.heat * (prev.viral === 1 ? 1.4 : 1) * shield * (MAYORS[prev.mayor] ? (MAYORS[prev.mayor].heat || 1) : 1);
    // Defences slow the file but never close it: the deals are the evidence.
    const cool = Math.min(exposure * 0.75,
      0.09 * (d.held || 0) + 0.35 * (d.policeFrac || 0)
      + (prev.fund === "max" ? 0.2 : prev.fund === "lean" ? -0.2 : 0));
    heat = Math.min(100, Math.max(0, heat + exposure - cool));
    if (heat >= 100) fed = 2;
  }
  // One warning shot before the file closes: past the threshold, the Bureau
  // stops being hypothetical. Fires once per investigation, and only if the
  // indictment has not already landed.
  let indictWarn = prev.indictWarn || 0;
  if (fed === 1 && heat >= INDICT_WARN_HEAT && indictWarn === 0) indictWarn = 1;
  // If the heat is beaten well back, re-arm: a second approach to the brink
  // deserves its own warning rather than a silent walk into handcuffs.
  if (indictWarn === 2 && heat < INDICT_WARN_HEAT - 15) indictWarn = 0;
  if (fed === 0) indictWarn = 0;   // a cleared file resets the warning
  // Five days after every election the interfaith council requests a meeting,
  // provided the town has a church for anyone to lead.
  let faithMeet = prev.faithMeet || 0;
  if (day > TERM_DAYS && (day - 5) % TERM_DAYS === 0 && faithMeet !== 1
      && prev.grid.some((c) => c && c.type === "church" && !c.build)) faithMeet = 1;

  // With two or more Loudspeakers, the agency pitches a campaign each term,
  // 30 days before the vote.
  let campaign = prev.campaign || 0;
  const speakerCount = prev.grid.filter((c) => c && c.type === "speaker" && !c.build).length;
  const toVote = TERM_DAYS - ((day - 1) % TERM_DAYS) - 1;

  // Ten days out, the podium goes up. Whatever you say from it, the town holds
  // you to for PROMISE_DAYS afterwards.
  let speech = prev.speech || 0;
  let promise = prev.promise || null;
  let promiseDay = prev.promiseDay || 0;
  let promiseSeq = prev.promiseSeq || 0;
  let promiseBroken = prev.promiseBroken || 0;
  let promiseKept = prev.promiseKept || 0;
  if (!prev.dictator && speech === 0 && toVote === SPEECH_BEFORE && day > CRIME_GRACE) speech = 1;
  if (speech >= 2 && toVote > SPEECH_BEFORE) speech = 0;   // re-arm for the next cycle

  // A promise in flight. Two of the three can be broken the moment you slip;
  // the housing one is judged when the deadline arrives.
  if (promise && !promiseBroken && !promiseKept) {
    const due = promiseDay + PROMISE_DAYS;
    if (promise === "nodev" && prev.seq > promiseSeq) {
      promiseBroken = 1;
      note("🏗️", "PROMISE BROKEN", "You said no new development, then broke ground anyway. Nobody missed it.", "bad");
    } else if (promise === "power" && d.anyOverload) {
      promiseBroken = 1;
      note("🔌", "PROMISE BROKEN", "You promised a grid that would hold. The lights went out anyway.", "bad");
    } else if (day >= due) {
      const roofless = homelessRate(pop, d);
      if (promise === "housing" && roofless > 0.05) {
        promiseBroken = 1;
        note("🏠", "PROMISE BROKEN", `You promised every family a roof. ${Math.round(roofless * 100)}% still have nowhere to sleep.`, "bad");
      } else {
        promiseKept = 1;
        note("🤝", "PROMISE KEPT", "You said you would, and you did. The town noticed that too.", "good");
      }
    }
  }

  if (!prev.dictator && campaign !== 1 && speakerCount >= 2 && toVote === 30
      && (prev.campaignUntil || 0) < day) campaign = 1;

  // A miserable town does not stay quiet forever. Three straight days below
  // the line and they are in the street. Any stance you took before expires
  // at the vote, so each term you answer for it again.
  // The teachers' contract. A walkout needs teachers to walk out, so it only
  // lands once a school is standing, and the union waits a while between fights.
  let strike = prev.strike || 0;
  let strikeUntil = prev.strikeUntil || 0;
  let strikeCool = prev.strikeCool || 0;
  let strikesSeen = prev.strikesSeen || 0;
  const anySchool = prev.grid.some((c) => c && c.type === "school" && !c.build);
  if (strike >= 2 && day >= strikeCool) strike = 0;      // contract settled, tempers cooled
  if (strike === 0 && anySchool && day > strikeCool && evRoll(71) < STRIKE_ODDS * mCalm) {
    strike = 1;
    strikesSeen = strikesSeen + 1;
    note("🍎", "THE TEACHERS ARE OUT", "The union wants a contract. The classrooms are empty until you answer.", "bad");
  }

  // Parents want somewhere to send the children. The complaint only lands once
  // a school is actually buildable, so the penalty is never one you cannot fix,
  // and it lifts the moment ground is broken rather than when the doors open.
  // The police contract. Refuse and the beat goes uncovered for a while.
  let cop = prev.cop || 0;
  let copUntil = prev.copUntil || 0;
  let copCool = prev.copCool || 0;
  const anyStation = prev.grid.some((c) => c && c.type === "police" && !c.build);
  if (cop >= 2 && day >= copCool) cop = 0;
  if (cop === 0 && anyStation && day > copCool && evRoll(83) < COP_ODDS) {
    cop = 1;
    note("🚓", "THE POLICE WANT A RAISE", "Every officer signed it. Refuse and the cars stay in the lot.", "news");
  }

  // The pulpit wants the curriculum. Needs a church to ask from.
  let doctrine = prev.doctrine || 0;
  let doctrineCool = prev.doctrineCool || 0;
  const anyChurch = prev.grid.some((c) => c && c.type === "church" && !c.build);
  if (doctrine >= 2 && day >= doctrineCool && doctrine !== 3 && doctrine !== 4) doctrine = 0;
  if (doctrine === 0 && anyChurch && anySchool && day > doctrineCool && evRoll(97) < DOCTRINE_ODDS) doctrine = 1;

  // Two standing alarms: an approval slump, and rough sleeping getting away
  // from the town. Each re-arms once the situation genuinely recovers.
  let envWarn = prev.envWarn || 0;
  if (envWarn === 0 && env < ENV_ALARM && day > CRIME_GRACE) {
    envWarn = 1;
    note("🌫️", "THE AIR IS BAD", `Environment ${Math.round(env)} of 100. Below ${ENV_ALARM} the whole town feels it. Parks help most; a fully upgraded Power Plant runs clean.`, "bad");
  }
  if (envWarn === 1 && env > ENV_ALARM + 12) envWarn = 0;

  let lowWarn = prev.lowWarn || 0;
  if (lowWarn === 0 && approval < LOW_APPROVAL_WARN && day > CRIME_GRACE) {
    lowWarn = 2;
    note("📉", "YOU ARE LOSING THE TOWN", `Approval ${Math.round(approval)}%. Jobs and housing move it fastest; Parks, Clinics and Loudspeakers are cheap. City Hall \u2192 PR Panel shows every number.`, "bad");
  }
  if (lowWarn === 2 && approval > LOW_APPROVAL_WARN + 12) lowWarn = 0;
  let homelessWarn = prev.homelessWarn || 0;
  const roofless = homelessRate(pop, d);
  if (homelessWarn === 0 && roofless > HOMELESS_WARN) {
    homelessWarn = 2;
    note("🏠", "LUCKHEAD IS OUT OF ROOM", `${Math.round(roofless * 100)}% have nowhere to live. Upgrading a House holds far more people than building another.`, "bad");
  }
  if (homelessWarn === 2 && roofless <= 0.01) homelessWarn = 0;

  // The river below the industrial district has changed colour. The more
  // factories are pouring into it, the sooner somebody notices.
  // Somebody with an accent and a very good suit would like to build you a
  // factory for nothing. There is, of course, a reason it is free.
  let invest = prev.invest || 0;
  let investCool = prev.investCool || 0;
  if (invest >= 2 && day >= investCool) invest = 0;
  if (invest === 0 && day > INVEST_DAY && day > investCool && evRoll(173) < INVEST_ODDS) {
    invest = 1;
    note("🛩️", "A FOREIGN INVESTOR", "Somebody wants to build Luckhead a factory. For free.", "news");
  }

  let river = prev.river || 0;
  let riverUntil = prev.riverUntil || 0;
  let riverCool = prev.riverCool || 0;
  let riversSeen = prev.riversSeen || 0;
  const stacks = prev.grid.filter((c) => c && c.type === "factory" && !c.build).length;
  if (river === 2 && day >= riverCool) river = 0;   // cleaned rivers can foul again
  // An untreated spill dilutes out after three months. Nobody thanks you for it.
  if (river === 1 && riverUntil > 0 && day >= riverUntil) {
    river = 0;
    riverUntil = 0;
    riverCool = day + 40;
    note("\uD83C\uDF0A", "THE WATER RUNS CLEAR", "Three months of current has finally carried the last of it downstream. No thanks to anyone at City Hall.", "good");
  }
  if (river === 0 && stacks >= 2 && day > RIVER_DAY && day > riverCool
      && evRoll(139) < RIVER_ODDS * (stacks / 2)) {
    river = 1;
    riverUntil = day + RIVER_SELF_CLEAR;   // it will clear itself in the end
    riversSeen = riversSeen + 1;
    note("🌊", "THE RIVER RUNS ORANGE", `The state lab has named what is in the water below your ${stacks} factories.`, "bad");
  }

  // The ground gives way somewhere under the road network.
  let pothole = prev.pothole || 0;
  let potholeCool = prev.potholeCool || 0;
  let potholeTile = null;
  let potholesSeen = prev.potholesSeen || 0;
  let potholeGrid = null;
  if (pothole >= 2 && day > potholeCool) pothole = 0;
  if (pothole === 0 && day > potholeCool && day > CRIME_GRACE && evRoll(151) < POTHOLE_ODDS * (T.potholeMul || 1) * ((WORKS[prev.works] || {}).potholeMul || 1)) {
    // Only ordinary road, never a bridge, and never the last link to City Hall's door.
    const roads = [];
    prev.grid.forEach((c, i) => { if (c && c.type === "road" && !c.build) roads.push(i); });
    if (roads.length >= POTHOLE_MIN_ROADS) {
      const victim = roads[Math.floor(evRoll(157) * roads.length)];
      potholeGrid = prev.grid.slice();
      potholeGrid[victim] = null;
      potholeTile = { r: Math.floor(victim / SIZE), c: victim % SIZE };
      pothole = 2;
      potholeCool = day + POTHOLE_COOL;
      note("🕳️", "POTHOLE", `A stretch of road out past row ${potholeTile.r + 1} caved in. Traffic will climb until it is paved again.`, "bad");
      potholesSeen = potholesSeen + 1;
    }
  }
  if (potholeGrid) prev = { ...prev, grid: potholeGrid };

  // The papers let it lie for a few weeks, then run the retrospective.
  let press = prev.press || 0;
  if (press === 0 && prev.testified && (prev.pressDue || 0) > 0 && day >= prev.pressDue) {
    press = 2;
    // the retrospective's one-time cost, applied here now that no modal collects it
    approval = Math.max(0, approval - (6 + (prev.testifiedTies || 1) * 2));
    note("🗞️", "\u201cWHAT DID THE MAYOR KNOW?\u201d", `The Sentinel lays out all ${prev.testifiedTies || 1} arrangements you confessed to, and how long you kept them. \u2212${6 + (prev.testifiedTies || 1) * 2} approval.`, "bad");
  }

  let schoolDemand = prev.schoolDemand || 0;
  const schoolPlanned = prev.grid.some((c) => c && c.type === "school");
  if (schoolDemand === 0 && day >= SCHOOL_DEMAND_DAY && !schoolPlanned
      && Math.floor(pop) >= (MILESTONE_POP.school || 25)) {
    schoolDemand = 2;
    note("🏫", "WHERE ARE THE SCHOOLS?", `${Math.floor(pop)} people and not one classroom. Costs you ${SCHOOL_DEMAND_HIT} approval a day until you break ground.`, "bad");
  }
  if (schoolDemand === 2 && schoolPlanned) schoolDemand = 3;   // answered, for good

  let protest = prev.protest || 0;  let protestUntil = prev.protestUntil || 0;
  let moodLowDays = prev.moodLowDays || 0;
  let protestsSeen = prev.protestsSeen || 0;
  if (protestUntil > 0 && day >= protestUntil) { protest = 0; protestUntil = 0; }
  moodLowDays = baseHap < PROTEST_MOOD ? moodLowDays + mCalm : 0;
  // Nobody marches against Quietmilk. If he already runs the department, the
  // grievance has no target and the crowd never forms.
  if (prev.chiefId === "quietmilk") moodLowDays = 0;
  if (protest === 0 && moodLowDays >= PROTEST_DAYS && day > CRIME_GRACE
      && prev.chiefId !== "quietmilk") {
    protest = 1;
    protestsSeen = protestsSeen + 1;
    note("✊", "LUCKHEAD IS PROTESTING", "A crowd on the City Hall steps, chanting about harsh policing.", "news");
    moodLowDays = 0;
  }

  // The banks notice an overdrawn city. They always do.
  // The family reads a balance sheet as well as anyone. They make the offer
  // once, the first time the town is genuinely short, and never again. A
  // family that has been beaten or testified against does not come calling.
  let tsuiLoanCool = prev.tsuiLoanCool || 0;
  // The arrangement lapses and, after a decent interval, he raises it again.
  if (tsuiLoan >= 2 && day > tsuiLoanUntil && day > tsuiLoanCool) tsuiLoan = 0;
  // He comes to a mayor who is broke. He also comes to a partner who is not,
  // because a thin police department is worth more to him than the money is.
  if (tsuiLoan === 0 && day > CRIME_GRACE && day > tsuiLoanCool
      && prev.mafia !== "defeated" && !prev.testified
      && (prev.money < TSUI_LOAN_TRIGGER
          || (prev.mafia === "allied" && evRoll(199) < TSUI_LOAN_ODDS))) tsuiLoan = 1;

  // Growing into a new tier is the one milestone the town reaches on its own
  // rather than being handed. Caught once, held until acknowledged, and never
  // re-fired if the population later falls back below the line.
  let tierSeen = prev.tierSeen || 0;
  let tierUp = prev.tierUp || 0;
  let tierQuote = prev.tierQuote || 0;
  let quotesUsed = prev.quotesUsed || [];
  const tierNow = tierIdx(Math.floor(pop));
  if (tierNow > tierSeen && !tierUp) {
    tierUp = tierNow;
    // Draw from the quotations this run has not used yet, refilling only if a
    // town somehow outlives the whole list.
    const unused = GOV_QUOTES.map((_, i) => i).filter((i) => quotesUsed.indexOf(i) < 0);
    const pool = unused.length ? unused : GOV_QUOTES.map((_, i) => i);
    tierQuote = pool[Math.floor(Math.random() * pool.length)];
    quotesUsed = (unused.length ? quotesUsed : []).concat([tierQuote]);
  }

  // The governor wants a residence in Luckhead before he wants anything else.
  // Build it and the correspondence begins; leave him waiting and he takes the
  // silence for an answer.
  // The two of them fall out in public, and Luckhead is asked to pick.
  let feud = prev.feud || 0;
  if (feud === 0 && (prev.govAsk || 0) >= 2 && !prev.dictator && day >= FEUD_MIN_DAY
      && !govCirclePending && !fedCirclePending && day > govCircleCool && day > fedCircleCool
      && evRoll(191) < FEUD_ODDS) feud = 1;

  // Another of the Governor's golfing circle owns a private security firm, and
  // Sanders is happy to make the introduction. Recurs if turned down, because
  // salesmen do.
  let surv = prev.surv || 0;
  let survCool = prev.survCool || 0;
  let survOutcryUntil = prev.survOutcryUntil || 0;
  if (surv === 0 && day >= SURV_MIN_DAY && day > survCool && !prev.dictator
      && (prev.govAsk || 0) >= 1 && (prev.govAsk || 0) !== 4 && !govCirclePending && day > govCircleCool
      && evRoll(229) < SURV_ODDS) surv = 1;
  if (survOutcryUntil && day >= survOutcryUntil) survOutcryUntil = 0;

  // The Governor golfs. Once the town can build a course and his house stands,
  // sooner or later he mentions it.
  let golfAsk = prev.golfAsk || 0;
  let golfUntil = prev.golfUntil || 0;
  const mansionIdx = prev.grid.findIndex((c) => c && c.type === "mansion" && !c.build);
  const golfUnlocked = Math.floor(prev.peakPop || 0) >= (MILESTONE_POP.golf || 80);
  if (golfAsk === 0 && mansionIdx >= 0 && golfUnlocked && !prev.dictator
      && (prev.govAsk || 0) === 3 && !govCirclePending && day > govCircleCool
      && evRoll(227) < GOLF_ODDS) golfAsk = 1;
  if (golfAsk === 2) {
    const [mr, mc] = [Math.floor(mansionIdx / SIZE), mansionIdx % SIZE];
    const nearCourse = prev.grid.some((c, i) => c && c.type === "golf" && !c.build
      && Math.abs(Math.floor(i / SIZE) - mr) + Math.abs((i % SIZE) - mc) <= GOLF_NEAR);
    if (nearCourse) {
      golfAsk = 3;
      note("⛳", "THE GOVERNOR HAS A TEE TIME",
        "The course opened within sight of his porch, exactly as promised. Sanders is as warm as he gets. +2 standing.", "good");
    } else if (day >= golfUntil) {
      golfAsk = 4;
      note("⛳", "THE PROMISED COURSE NEVER CAME",
        "Sixty days, and the Governor's view is still an empty lot. He does not mention it again, and that is worse. -3 standing.", "bad");
    }
  }

  // Sanders would like a favour that is not about Luckhead at all.
  let marla = prev.marla || 0;
  const marlaCool = prev.marlaCool || 0;
  if (marla === 0 && (prev.govAsk || 0) >= 2 && (prev.govAsk || 0) !== 4 && !prev.dictator
      && !prev.commsLocked && (prev.staffOffer || 0) >= 2 && !govCirclePending && day > govCircleCool
      && day >= MARLA_MIN_DAY && day > marlaCool && evRoll(193) < MARLA_ODDS) marla = 1;

  // A finished stadium is a venue, and a venue is a stage.
  let stadiumDay = prev.stadiumDay || 0;
  let rally = prev.rally || 0;
  if (stadiumDay === 0 && prev.grid.some((c) => c && c.type === "stadium" && !c.build)) stadiumDay = day;
  if (rally === 0 && stadiumDay > 0 && !prev.dictator && day >= stadiumDay + RALLY_WAIT
      && !fedCirclePending && day > fedCircleCool) rally = 1;

  // The night a protest takes the streets, somebody puts a brick through a
  // shopfront. One per protest, and only if the town has a shop to smash.
  {
    // A window is identified by the day it ends, which is unique per protest.
    // One brick per window, however the window was opened.
    const winId = ((protest === 2 || protest === 3) && day < protestUntil) ? protestUntil
      : ((prev.eco === 3 || prev.eco === 5) && day < (prev.ecoUntil || 0)) ? prev.ecoUntil : 0;
    if (winId && (prev.vandalMark || 0) !== winId) {
      const shopsUp = [];
      prev.grid.forEach((c, i) => { if (c && c.type === "shop" && !c.build && !(c.vandal && day < c.vandal)) shopsUp.push(i); });
      if (shopsUp.length) {
        const hit = shopsUp[Math.floor(evRoll(241) * shopsUp.length)];
        const g2 = prev.grid.slice();
        g2[hit] = { ...g2[hit], vandal: day + VANDAL_DAYS };
        prev = { ...prev, grid: g2 };
        note("🪟", "SHOP VANDALIZED", `A shopfront was smashed and looted in the unrest. Boarded up for ${VANDAL_DAYS} days: no jobs, no revenue.`, "bad");
      }
      prev = { ...prev, vandalMark: winId };
    }
  }

  // Deep into a run, the phone rings after midnight. He needs votes found,
  // and he is asking the kind of mayor who might know where to look.
  let stolenVotes = prev.stolenVotes || 0;
  if (stolenVotes === 0 && day >= VOTES_MIN_DAY && !prev.dictator
      && !fedCirclePending && day > fedCircleCool
      && evRoll(239) < VOTES_ODDS) stolenVotes = 1;

  // Once the crime numbers are bad enough to quote, Washington quotes them.
  let slander = prev.slander || 0;
  let slanderUntil = prev.slanderUntil || 0;
  let slanderCool = prev.slanderCool || 0;
  if (slander >= 2 && day >= slanderUntil && day > slanderCool) { slander = 0; slanderUntil = 0; }
  if (slander === 0 && !prev.dictator && crime > SLANDER_CRIME && day > slanderCool
      && day > CRIME_GRACE && !fedCirclePending && day > fedCircleCool
      && evRoll(197) < SLANDER_ODDS) slander = 1;

  // A clip of Judy Ginsberg explaining a filing deadline gets away from
  // somebody, and for three months honest government is briefly fashionable.
  let judyUntil = prev.judyUntil || 0, judySeen = prev.judySeen || 0;
  if (!judySeen && prev.lawyerId === "ginsberg" && day > (prev.lawyerFrom || 0) + LAWYER_HANDOVER
      && evRoll(181) < JUDY_ODDS) {
    judySeen = 1;
    judyUntil = day + JUDY_DAYS;
    note("\uD83D\uDCF1", "JUDY GINSBERG GOES VIRAL",
      `A clip of Luckhead's city attorney patiently explaining a filing deadline has been watched four million times. Honest government is briefly fashionable, and you are standing next to it for the next ${JUDY_DAYS} days.`, "good");
  }

  // Washington has been reading the filings, and has opinions about who signs
  // them. Offered once, and only to a mayor with a file open and counsel who
  // is not Nancy Nace.
  let potus = prev.potus || 0;
  if (potus === 0 && fed === 1 && prev.lawyerId && prev.lawyerId !== "nace" && !(prev.deadLawyers || []).includes("nace") && !prev.dictator) potus = 1;

  // The family reads the papers. A mayor with the statehouse against him and
  // the Tsuis already at his table is a mayor with one obvious way out.
  let tsuiHush = prev.tsuiHush || 0;
  if (tsuiHush === 0 && prev.govBacked && prev.mafia === "allied" && !prev.dictator) tsuiHush = 1;

  // City Hall has desks nobody sits at, and mentions it once.
  // At a hundred residents the town takes a vote nobody loses: Luckhead wants
  // to put something up, and it wants the mayor to choose the corner.
  let statueOffer = prev.statueOffer || 0;
  if (statueOffer === 0 && Math.floor(pop) >= STATUE_POP
      && !prev.grid.some((c) => c && c.type === "statue")) {
    statueOffer = 1;
    note("🏆", "THE TOWN VOTES A MONUMENT",
      "A hundred residents, and the council floor wants it marked. Tap empty ground to raise the Unity Monument: +5 approval for as long as it stands.", "good");
  }

  // Two chimneys and a falling environment score is enough to organise around.
  let eco = prev.eco || 0;
  let ecoUntil = prev.ecoUntil || 0;
  let ecoCool = prev.ecoCool || 0;
  const ecoParksAt = prev.ecoParks || 0;
  const parksNow = prev.grid.filter((c) => c && c.type === "park" && !c.build).length;
  const chimneys = prev.grid.filter((c) => c && c.type === "factory" && !c.build).length;
  if (eco === 0 && chimneys >= ECO_FACTORIES && env < ECO_ENV && day > CRIME_GRACE
      && day > ecoCool && evRoll(223) < ECO_ODDS * mCalm) eco = 1;
  if (eco === 2) {
    // Every plant on solar, and three more parks than the day you promised.
    const plants = prev.grid.filter((c) => c && c.type === "plant" && !c.build);
    const allSolar = plants.length > 0 && plants.every((c) => plantStats(c).clean);
    if (allSolar && parksNow >= ecoParksAt + ECO_PARKS) {
      eco = 4; ecoUntil = 0;
      note("\uD83C\uDF3F", "THE PLEDGE IS KEPT",
        "Every plant runs on the sun and the parks are open. The organisers go home satisfied.", "good");
    } else if (day >= ecoUntil) {
      eco = 5; ecoUntil = day + ECO_PROTEST_DAYS; ecoCool = day + ECO_PROTEST_DAYS + ECO_COOL;
      note("\uD83E\uDEA7", "THE PLEDGE IS BROKEN",
        "Thirty days, and the chimneys still smoke. They are angrier now than if you had simply said no.", "bad");
    }
  }
  if ((eco === 3 || eco === 5) && day >= ecoUntil) { eco = 0; ecoUntil = 0; }

  // Two poles is a policy. Sooner or later somebody brings a ladder.
  let speakerDown = prev.speakerDown || 0;
  let speakerUntil = prev.speakerUntil || 0;
  let speakerCool = prev.speakerCool || 0;
  const poles = prev.grid.filter((c) => c && c.type === "speaker" && !c.build).length;
  if (speakerDown === 1 && day >= speakerUntil) speakerDown = 2;
  if (speakerDown === 0 && poles >= SPEAKER_MIN && day > CRIME_GRACE && day > speakerCool
      && evRoll(211) < SPEAKER_ODDS * mCalm) {
    speakerDown = 1;
    speakerUntil = day + SPEAKER_DAYS;
    speakerCool = day + SPEAKER_DAYS + SPEAKER_COOL;
    note("\uD83D\uDCE2", "LOUDSPEAKERS DISMANTLED BY PROTESTERS",
      "Protestors have had it with the incessant drone of the city's propaganda. All loudspeakers inactive for " + SPEAKER_DAYS + " days.");
  }
  if (speakerDown === 2 && day > speakerCool) { speakerDown = 0; speakerUntil = 0; }

  let staffOffer = prev.staffOffer || 0;
  if (staffOffer === 0 && !prev.dictator && day >= STAFF_OFFER_DAY) staffOffer = 1;

  let govStage = prev.govStage || 0, govPending = prev.govPending || 0;
  let govAsk = prev.govAsk || 0, govAskDay = prev.govAskDay || 0, govBuiltDay = prev.govBuiltDay || 0;
  let govRelStep = prev.govRel || 0;
  if (!prev.dictator) {
    // he writes once
    if (govAsk === 0 && day >= GOV_ASK_DAY) { govAsk = 1; govAskDay = day; }
    // the house goes up: the arc opens and the clock starts from completion
    else if (govAsk === 2 && d.mansionOn) { govAsk = 3; govBuiltDay = day; }
    // or it does not, and he stops asking
    else if (govAsk === 2 && day > govAskDay + GOV_DEADLINE) {
      govAsk = 4; govRelStep = -2; govStage = 3; govPending = 1;
    }
    // The golf pledge settles through the same ledger his letters use.
    if (golfAsk === 3 && (prev.golfAsk || 0) === 2) govRelStep = (prev.govRel || 0) + 2;
    if (golfAsk === 4 && (prev.golfAsk || 0) === 2) govRelStep = (prev.govRel || 0) - 3;
    // Build it late anyway and the penalty lifts: he has his house, and a man
    // with a house in your town writes letters again. Unless what he has heard
    // about the family's money already has him cold, in which case he takes the
    // building and keeps his distance.
    else if (govAsk === 4 && d.mansionOn) {
      govAsk = 3; govBuiltDay = day; govRelStep = 0;
      const doubtNow = Math.floor((prev.graft || 0) / GOV_GRAFT_PER_DOUBT);
      govStage = doubtNow >= 1 ? 3 : 0;
    }
    // his letters, once there is somewhere to send them
    if (govAsk === 3 && !govPending && govStage < 4
        && day >= govBuiltDay + GOV_BEAT_GAP * (govStage + 1)) govPending = 1;
  }

  let loanOffer = prev.loanOffer || 0;
  const hasBank = prev.grid.some((c) => c && c.type === "bank" && !c.build);
  if (loanOffer === 0 && hasBank && prev.money < -50) loanOffer = 1;
  if (loanOffer === 2 && prev.money >= 0) loanOffer = 0;   // re-arms once solvent

  // Washington notices a mayor in trouble, once per administration.
  let pvisit = prev.pvisit || 0;
  if (fed === 1 && heat >= PVISIT_HEAT && pvisit === 0) {
    pvisit = 1;
  }

  // Random events: one lands every EVENT_EVERY days and expires on schedule.
  // Events recycle freely, weighted so the economy swings turn up most often,
  // and skipping any whose preconditions the city has not met yet.
  let event = prev.event, eventEnds = prev.eventEnds || 0, eventSeen = prev.eventSeen || 0;
  if (event && day >= eventEnds) { event = null; eventEnds = 0; }
  let nextEvent = prev.nextEvent || EVENT_EVERY;
  if (!event && day > 1 && day >= nextEvent) {
    const pool = EVENTS.filter((e) => !e.needs || e.needs(prev));
    // A weight may be a number or a function of the city, so an event can get
    // rarer or likelier as standings move.
    const wOf = (e) => (typeof e.weight === "function" ? e.weight(prev) : (e.weight || 1));
    const total = pool.reduce((a, e) => a + wOf(e), 0);
    let roll = mulberry32((prev.seed || 1) * 7919 + day)() * total;
    let pick = pool[pool.length - 1];
    for (const e of pool) { roll -= wOf(e); if (roll <= 0) { pick = e; break; } }
    event = pick.id;
    eventEnds = day + pick.days;
    eventSeen = eventSeen + 1;
    nextEvent = day + EVENT_EVERY;
    note(pick.icon, pick.name.toUpperCase(), pick.tag, pick.good ? "good" : "bad");
  }

  // Day-gated unlocks announce themselves once.
  let dayUnlocked = prev.dayUnlocked || 0;
  while (dayUnlocked < DAY_MILESTONES.length && day >= DAY_MILESTONES[dayUnlocked].day) dayUnlocked += 1;

  // Police chief shows up the first time crime maxes out.
  let chief = prev.chief || 0;
  if (crime >= 100 && chief === 0 && !prev.gear && day > 50) chief = 1;

  // The moment you break with the family: freeze immigration, tear up every
  // arrangement, and put a clock on the chief's life.
  let tsuiWar = prev.tsuiWar || 0;
  let chiefHit = prev.chiefHit || 0;
  const justRefused = !!prev.justBroke;
  if (justRefused) {
    tsuiWar = day;
    // Vincent kills a chief over a betrayal, not a refusal. Turn him down at
    // the door and the department is left alone.
    const wasPartner = (prev.everAllied || 0) === 1 || (prev.graft || 0) > 0;
    chiefHit = (prev.chiefId || prev.lawyerId) && wasPartner ? day + 5 : 0;
  }
  // Severing agreements: the back room closes and factory smuggling stops.
  let backroom = justRefused ? false : prev.backroom;

  // The hit lands. The chief is gone; the mayor must appoint another, and the
  // fallen chief gets a park.
  let chiefId = prev.chiefId;
  let lawyerId = prev.lawyerId;
  let lawyerLocked = prev.lawyerLocked || 0;
  let deadLawyers = prev.deadLawyers || [];
  let pendingMonument = prev.pendingMonument || null;
  let chiefKilled = prev.chiefKilled || 0;
  let deadChiefs = prev.deadChiefs || [];
  let vacancyReason = prev.vacancyReason || (prev.chiefId ? "" : "opening");
  if (chiefHit > 0 && day >= chiefHit && (chiefId || lawyerId)) {
    // The family settles with whoever carried the mayor's business: the chief
    // who policed for them, or the attorney who papered over them. If both are
    // in office, the coin is Vincent's.
    const pool = [chiefId ? "chief" : null, lawyerId ? "lawyer" : null].filter(Boolean);
    const pick = pool[Math.floor(evRoll(243) * pool.length)];
    if (pick === "chief") {
      pendingMonument = CHIEFS[chiefId] ? CHIEFS[chiefId].name : null;
      chiefKilled = (prev.chiefKilled || 0) + 1;
      note("🔪", "THE CHIEF IS DEAD", `${CHIEFS[chiefId] ? CHIEFS[chiefId].name : "The chief"} was killed in a Tsui reprisal. Name a successor.`, "bad");
      deadChiefs = [...deadChiefs, chiefId];       // barred for the rest of the game
      vacancyReason = "assassinated";
      chiefId = null;
    } else {
      const LWK = LAWYERS[lawyerId];
      pendingMonument = LWK ? LWK.name : null;
      chiefKilled = (prev.chiefKilled || 0) + 1;
      note("🔪", "THE CITY ATTORNEY IS DEAD", `${LWK ? LWK.name : "The city attorney"} was killed in a Tsui reprisal. The office stands empty, and every arrangement ${LWK && LWK.name ? LWK.name.split(" ").pop() : ""} kept quiet is loose in the world.`, "bad");
      deadLawyers = [...deadLawyers, lawyerId];    // barred for the rest of the game
      lawyerId = null;
      lawyerLocked = 0;   // an immunity built on a dead retainer does not hold
    }
    chiefHit = 0;
  }

  // While the family holds a grudge, Vincent's people set fires. Every couple
  // of weeks there is a chance an arsonist levels a building, favoring police
  // stations and then the most expensive targets. City Hall is untouchable.
  let arsonDay = prev.arsonDay || 0;
  let arsonCount = prev.arsonCount || 0;
  let lastArson = prev.arsonAck === 1 ? (prev.lastArson || null) : null;
  let arsonAck = prev.arsonAck || 0;
  let arsonGrid = null;
  // The family burns things whenever you are not actually in business together:
  // open war, a refusal, or simply having never come to terms. Only a standing
  // alliance keeps the matches in the box.
  // ...but only once they are actually a presence in the city. Nobody burns
  // down a town Vincent has never visited.
  const metTsui = mafia === "refused" || mafia === "defeated"
    || tsuiWar > 0 || (prev.tsuiReturn || 0) > 0 || (prev.heirCount || 0) > 0;
  const atOddsWithTsui = metTsui
    && mafia !== "allied" && mafia !== "choice" && mafia !== "renegotiate";
  const sinceWar = tsuiWar > 0 ? day - tsuiWar : -1;
  // Turning Vincent down is not the same as taking his money and then turning
  // on him. A mayor who never came to terms gets one fire and that is the end
  // of it. Only a partner who broke faith earns a standing grudge. Taking their
  // loan counts as coming to terms: it is still their money.
  const everInLeague = (prev.everAllied || 0) === 1 || (prev.graft || 0) > 0;
  const mayBurn = everInLeague || arsonCount < 1;
  // Fifteen days after you break with them, one goes up. Not a roll, a promise.
  const reprisalDue = mayBurn && tsuiWar > 0 && sinceWar === 15 && arsonDay !== day;
  // Otherwise the fires come every couple of weeks, hotter while the war is
  // fresh, and never as a certainty.
  const warHeat = sinceWar >= 0 && sinceWar <= 60 ? 0.24 : 0.14;
  const weeklyDue = atOddsWithTsui && mayBurn
    && day % 14 === 0 && arsonDay !== day
    && evRoll(53) < warHeat;
  if (reprisalDue || weeklyDue) {
      // Score every standing, finished building. Police first, then by the
      // dollars sunk into it, so the arsonist always takes something that hurts.
      const candidates = [];
      prev.grid.forEach((c, i) => {
        if (!c || c.build) return;
        if (c.type === "hall" || c.type === "hallpart") return;   // never City Hall
        if (c.type === "road" || c.type === "bridge" || c.type === "line") return;  // infrastructure, not a "building"
        if (c.type === "plant") return;   // they are gangsters, not terrorists; the lights stay on
        const priority = (c.type === "police" ? 100000 : 0) + investedIn(c);
        candidates.push([i, priority]);
      });
      if (candidates.length > 0) {
        candidates.sort((a, b) => b[1] - a[1]);
        // Pick among the top few so it isn't perfectly deterministic, but always
        // something valuable. Weight toward the very top.
        const topN = Math.min(3, candidates.length);
        const pickIdx = Math.floor(evRoll(59) * topN);
        const [target] = candidates[pickIdx];
        const victim = prev.grid[target];
        lastArson = { type: victim.type, day,
          name: victim.type === "police" ? "Police Station" : BUILD[victim.type].name };
        arsonAck = 1;   // waits for the player to acknowledge it
        arsonGrid = prev.grid.slice();
        arsonGrid[target] = null;   // burned to the ground, tile left empty
        arsonCount = arsonCount + 1;
        note("🔥", "ARSON", `The ${lastArson.name} burned to the ground overnight. The tile is cleared.`, "bad");
      }
      arsonDay = day;   // one attempt per cadence day regardless of outcome
  }
  if (arsonGrid) prev = { ...prev, grid: arsonGrid };

  // A terrorist attack takes its target on the day it lands. Not the Tsuis'
  // work, and not their style; the town reads it as a policing failure anyway.
  let disasterAid = 0;
  const landedEv = event && event !== prev.event ? eventById(event) : null;
  if (landedEv && (landedEv.plantLost || landedEv.stadiumLost)) {
    const targetType = landedEv.plantLost ? "plant" : "stadium";
    const spots = [];
    prev.grid.forEach((c, i) => { if (c && c.type === targetType && !c.build) spots.push(i); });
    if (spots.length) {
      const hit = spots[Math.floor(evRoll(233) * spots.length)];
      const g2 = prev.grid.slice(); g2[hit] = null;
      prev = { ...prev, grid: g2 };
      if (landedEv.kills) {
        pop = Math.max(0, pop - landedEv.kills);
        note("💥", "STADIUM BOMBED", `${landedEv.kills} dead at Luckhead Stadium. The stands are gone; the vigils go on all week.`, "bad");
      } else {
        note("💥", "POWER PLANT DESTROYED", "A local terrorist group levelled a Power Plant overnight. The tile is cleared and the grid is short.", "bad");
      }
    }
  }
  // After a disaster, friends in high places write cheques: $500 from the
  // statehouse and $500 from Washington, each only if they think well of you.
  // And the town itself pulls together for a month.
  let rallyMood = prev.rallyMood || 0;
  let rallyUntil = prev.rallyUntil || 0;
  if (landedEv && landedEv.disaster) {
    const govFriend = govStandingOf(prev) >= 1 && (prev.govAsk || 0) > 0 && (prev.govAsk || 0) !== 4;
    const fedFriend = fedFavorOf(prev) >= 1;
    disasterAid = (govFriend ? 500 : 0) + (fedFriend ? 500 : 0);
    if (disasterAid > 0)
      note("🤝", "ASSISTANCE PACKAGES", `${govFriend && fedFriend ? "The Governor and the President each send" : govFriend ? "Governor Sanders sends" : "The President sends"} $500 in disaster assistance.`, "good");
    rallyMood = 6;
    rallyUntil = day + 30;
  }
  if (rallyUntil && day >= rallyUntil) { rallyMood = 0; rallyUntil = 0; }

  // Ten days after the Theatre opens, a local rapper gets caught there
  // with more contraband than a tour bus should hold.
  let theatreDay = prev.theatreDay || 0;
  let bust = prev.bust || 0;
  const hasTheatre = prev.grid.some((c) => c && c.type === "theatre" && !c.build);
  if (hasTheatre && theatreDay === 0) theatreDay = day;
  if (bust === 0 && theatreDay > 0 && day >= theatreDay + 10) bust = 1;

  // Vincent takes an interest in the music venue a week after it opens.
  let venueDay = prev.venueDay || 0;
  let venueOffer = prev.venueOffer || 0;
  const hasVenue = prev.grid.some((c) => c && c.type === "venue" && !c.build);
  if (hasVenue && venueDay === 0) venueDay = day;
  if (venueOffer === 0 && venueDay > 0 && day >= venueDay + 7 && mafia === "allied") venueOffer = 1;

  // The family eyes a second factory once you are on good terms.
  let smuggleOffer = prev.smuggleOffer || 0;
  if (justRefused && smuggleOffer === 3) smuggleOffer = 0;
  const factoryCount = prev.grid.filter((c) => c && c.type === "factory" && !c.build).length;
  if (smuggleOffer === 0 && mafia === "allied" && factoryCount >= 2) smuggleOffer = 1;

  // --- new triggered events ---

  // The President demands ICE be let into the city. Only after day 200, and
  // never while a federal investigation is already open. A pending choice.
  let ice = prev.ice || 0, iceUntil = prev.iceUntil || 0;
  if (ice === 0 && day > 200 && fed === 0 && evRoll(11) < 0.014) ice = 1;

  // Graffiti hits the billboards 15 days after the second one is standing.
  let billboardDay = prev.billboardDay || 0, graffiti = prev.graffiti || 0;
  let graffitiUntil = prev.graffitiUntil || 0, graffitiSeen = prev.graffitiSeen || 0;
  const billboardCount = prev.grid.filter((c) => c && c.type === "billboard" && !c.build).length;
  if (billboardCount >= 2 && billboardDay === 0) billboardDay = day;
  if (graffiti === 0 && billboardDay > 0 && day >= billboardDay + 15 && graffitiSeen === 0) {
    graffiti = 1; graffitiUntil = day + 60; graffitiSeen = 1;
    note("🖍️", "BILLBOARDS DEFACED", "Local teens covered them in something obscene. They are down for 60 days.", "bad");
  }
  if (graffiti === 1 && day >= graffitiUntil) graffiti = 0;

  // A prison riot, at least 30 days after a prison is built.
  let prisonDay = prev.prisonDay || 0, riot = prev.riot || 0;
  let riotUntil = prev.riotUntil || 0, riotSeen = prev.riotSeen || 0;
  const hasPrison = prev.grid.some((c) => c && c.type === "prison" && !c.build);
  if (hasPrison && prisonDay === 0) prisonDay = day;
  if (riot === 0 && prisonDay > 0 && day >= prisonDay + 30 && riotSeen === 0 && evRoll(23) < 0.02) {
    riot = 1; riotUntil = day + 20; riotSeen = 1;
    crime = Math.min(100, crime + 18);   // the night itself, before the long tail
    note("🚨", "PRISON RIOT", "Inmates are loose, the block is offline for 20 days, and crime spiked overnight.", "bad");
  }
  if (riot === 1 && day >= riotUntil) riot = 0;

  // A viral video of the mayor, at least 40 days after Tommy's Hideaway opens.
  let hideawayFirstDay = prev.hideawayFirstDay || 0, viral = prev.viral || 0, viralSeen = prev.viralSeen || 0;
  let viralAck = prev.viralAck || 0;
  const hasHideaway = prev.grid.some((c) => c && c.type === "hideaway" && !c.build);
  if (hasHideaway && hideawayFirstDay === 0) hideawayFirstDay = day;
  if (viral === 0 && hideawayFirstDay > 0 && day >= hideawayFirstDay + 40 && viralSeen === 0 && evRoll(37) < 0.018) {
    viral = 1; viralSeen = 1; viralAck = 1;
    note("📹", "THAT VIDEO OF THE MAYOR", "You, dancing, glassy-eyed. It is everywhere this morning.", "bad");
  }

  // The Tsuis try blackmail 15 days after the first successor is chosen.
  let blackmail = prev.blackmail || 0, blackmailSeen = prev.blackmailSeen || 0;
  if (blackmail === 0 && blackmailSeen === 0 && (prev.heirCount || 0) >= 1
      && (prev.firstHeirDay || 0) > 0 && day >= prev.firstHeirDay + 15) {
    blackmail = 1; blackmailSeen = 1;
  }

  let unlocked = prev.unlocked || 0;
  while (unlocked < MILESTONES.length && Math.floor(pop) >= MILESTONES[unlocked].pop) unlocked += 1;

  const cycle = Math.floor((day - 1) / TERM_DAYS);
  const untilVote = TERM_DAYS - ((day - 1) % TERM_DAYS) - 1;
  let lossWarned = prev.lossWarned || 0;
  if (!prev.dictator && untilVote <= LOSS_WARN_DAY && lossWarned <= cycle && Math.round(prev.approval) < 51) {
    lossWarned = cycle + 1;
  }
  let polled = prev.polled, challenger = prev.challenger;
  let campaignResponded = prev.campaignResponded || false;
  if (!prev.dictator && untilVote <= WARN_DAY && polled <= cycle) {
    polled = cycle + 1;
    challenger = makeChallenger(prev.seed, cycle,
      challengerCtx(pop, d, hap, { crime, ties, rigged: prev.rigged, testified: prev.testified, day: prev.day + 1,
        stolenVotes: prev.stolenVotes, deadChiefs: prev.deadChiefs, deadLawyers: prev.deadLawyers,
        golfAsk: prev.golfAsk, eco: prev.eco, ecoUntil: prev.ecoUntil, grid: prev.grid }));
    campaignResponded = false;   // a new opponent, a clean slate to respond to
  }
  let over = prev.over, elected = prev.elected, succession = prev.succession || 0;
  let musicSet = prev.musicSet === undefined ? 0 : prev.musicSet;
  let broke = prev.broke || false;
  if (fed === 2) over = true;
  let lastElection = prev.lastElection, electionSeen = prev.electionSeen || 0;
  if (!prev.dictator && day % TERM_DAYS === 0) {
    const atk = challengerAttack(challenger, attackCtx);
    const youPct = Math.round(approval);
    const won = youPct >= 51;
    lastElection = { day, name: challenger ? challenger.name : "the empty ballot line",
      label: challenger ? challenger.label : "", axis: challenger ? challenger.axis : null,
      live: atk.live, drag: atk.drag, youPct, won };
    electionSeen += 1;
    note(won ? "🗳️" : "🧳", won ? "RE-ELECTED" : "VOTED OUT",
      `${youPct}% of the vote against ${challenger ? challenger.name : "the field"}.`, won ? "good" : "bad");
    if (won) { elected += 1; if (elected % SUCCESSION_EVERY === 0) succession = 1; challenger = null; campaign = 0;
      campaignResponded = false;
      musicSet = pickMusicSet(prev.musicSet); }
    else over = true;
  }

  const taxes = Math.round(Math.floor(pop) * T.taxRate * HEAD_TAX) + (d.fastparkTax || 0) + (d.churchTax || 0) + (d.schoolTax || 0) + (d.waterTax || 0);
  // A one-off cheque or a one-off loss, on the day the event lands. Some scale
  // with the town the same way a buy-out does: $500 is a wound at forty
  // residents and a rounding error at three hundred.
  const windfallEv = event && event !== prev.event ? eventById(event) : null;
  const windfall = !windfallEv || !windfallEv.cash ? 0
    : windfallEv.cashScale
      ? Math.round((windfallEv.cash * Math.min(3.5, Math.max(0.5, Math.floor(pop || 0) / 40))) / 10) * 10
      : windfallEv.cash;
  // Why the numbers moved today, so a bad week is legible in The Books.
  const notes = [];
  if (EV && (EV.goods || EV.trade || EV.upkeep)) notes.push(`${EV.icon} ${EV.name}`);
  { const n = (prev.bribeTrade || []).filter((d) => d > prev.day).length; if (n) notes.push(`🌐 trade envelope${n > 1 ? " x" + n : ""}`); }
  if (H && H.industry && H.industry !== 1) notes.push(`${H.icon} ${H.name}`);
  if (d.bankCount) notes.push(`🏦 ${d.bankCount} bank${d.bankCount > 1 ? "s" : ""}`);
  if (d.schoolTax) notes.push(`🏫 school catchment +$${d.schoolTax}`);
  if (d.smuggling) notes.push("🏭 smuggling");
  if (d.plazaOn) notes.push("🏬 Pipp's Plaza");
  if (d.theatreOn) notes.push("🎭 Theatre");
  if (prev.faithStance === "refuse") notes.push("⛪ church tax");
  if (T.taxRate !== TAX.normal.taxRate) notes.push(`${T.icon} ${T.name}`);
  const grant = fedGrantOf(prev, pop);
  const stategrant = govGrantOf(prev, pop);
  const entry = { day, taxes, trade: d.revenue, goods: d.goods, power: -d.upPower,
    industry: -d.upIndustry, civic: -d.upCivic, mob: mafiaMoney, windfall: windfall + disasterAid, grant, stategrant, notes };
  const ledger = [...(prev.ledger || []), entry].slice(-7);

  const net = taxes + d.revenue + d.goods - d.upkeep + mafiaMoney + windfall + disasterAid + grant + stategrant;

  // Streaks of unanswered trouble. A new mayor finds out a fortnight before the
  // vote does, instead of on election night.
  const idleNow = Math.max(0, Math.floor(pop) - Math.min(Math.floor(pop), d.jobs));
  const sIdle = idleNow >= 3 ? (prev.sIdle || 0) + 1 : 0;
  const sRed = net < 0 ? (prev.sRed || 0) + 1 : 0;
  const sDisc = d.anyDisc ? (prev.sDisc || 0) + 1 : 0;
  const sPower = (d.anyUnwired || d.anyOverload) ? (prev.sPower || 0) + 1 : 0;

  // Washington's education audit: are the town's children within reach of a
  // school, and is that school staffed to teach them. Both, or neither counts.
  const schoolAge = Math.floor(pop) >= (MILESTONE_POP.school || 26);
  const schoolRoster = (d.schoolCov || []);
  const schoolsOk = schoolRoster.length > 0
    && (d.schoolFrac || 0) >= SCHOOL_AUDIT_FRAC
    && schoolRoster.every(([, , , crew]) => (crew === undefined ? 1 : crew) >= 1);
  const sSchool = (schoolAge && !schoolsOk) ? (prev.sSchool || 0) + 1 : 0;
  let schoolAudit = prev.schoolAudit || 0, schoolNotice = prev.schoolNotice || 0;
  if (schoolAudit === 0 && sSchool >= SCHOOL_AUDIT_DAYS) { schoolAudit = 1; schoolNotice = 1; }
  else if (schoolAudit === 1 && schoolsOk) { schoolAudit = 0; schoolNotice = 2; }
  const money = prev.money + net;
  if (money <= DEBT_FLOOR) { over = true; broke = true; }
  const log = newEntries.length ? [...(prev.log || []), ...newEntries].slice(-LOG_KEEP) : (prev.log || []);
  return { ...prev, musicSet, stolenVotes, campaignResponded, govCircleCool: prev.govCircleCool || 0, fedCircleCool: prev.fedCircleCool || 0,
    // He remembers who helped, and who did not, for the rest of the game.
    fedFavor: stolenVotes === 2 ? 3 : stolenVotes === 3 ? FED_FAVOR_MIN : prev.fedFavor,
    surv, survCool, survOutcryUntil, rallyMood, rallyUntil, golfAsk, golfUntil, statueOffer, eco, ecoUntil, ecoCool, speakerDown, speakerUntil, speakerCool, tsuiLoan, tsuiLoanUntil, tsuiLoanCool, tsuiHush, staffOffer, potus, judyUntil, judySeen,
    feud, marla, marlaCool, rally, stadiumDay, slander, slanderUntil, slanderCool,
    sSchool, schoolAudit, schoolNotice, sIdle, sRed, sDisc, sPower, govStage, govPending, govAsk, govAskDay, govBuiltDay,
    govRel: govAsk === 4 || govRelStep !== (prev.govRel || 0) ? govRelStep : (prev.govRel || 0), fund: fundKeyNow, tierSeen, tierUp, tierQuote, quotesUsed, log, logSeq, env, speech, promise, promiseDay, promiseSeq, promiseBroken, promiseKept, pop, money, broke, day, mafia, crime, calm, approval, over, elected, ledger, polled, lossWarned, unlocked, chief, smuggleOffer, venueDay, venueOffer, fed, heat, ties, reprisal, dayUnlocked, succession, tsuiReturn, event, eventEnds, eventSeen, nextEvent, challenger, lastElection, electionSeen, theatreDay, bust, pvisit, faithMeet, campaign, loanOffer, tsuiWar, chiefHit, chiefKilled, deadChiefs, vacancyReason, pendingMonument, chiefId, lawyerId, lawyerLocked, deadLawyers, backroom, justBroke: false, ice, iceUntil, graffiti, graffitiUntil, graffitiSeen, billboardDay, riot, riotUntil, riotSeen, prisonDay, viral, viralSeen, viralAck, hideawayFirstDay, blackmail, blackmailSeen, blackmailUntil: prev.blackmailUntil || 0, arsonDay, arsonCount, lastArson, arsonAck, indictWarn, protest, protestUntil, moodLowDays, protestsSeen, strike, strikeUntil, strikeCool, strikesSeen, schoolDemand, cop, copUntil, copCool, doctrine, doctrineCool, lowWarn, envWarn, homelessWarn, shooting, shootingUntil, shootingDead, shootingsSeen, invest, investCool, river, riverUntil, riverCool, riversSeen, pothole, potholeCool, potholeTile, potholesSeen, press,
    peakPop: Math.max(prev.peakPop || 0, Math.floor(pop)),
    peakApproval: Math.max(prev.peakApproval || 0, Math.round(approval)), graft: (prev.graft || 0) + (mafiaMoney > 0 ? mafiaMoney : 0) };
}

const tierIdx = (p) => TIERS.reduce((t, x, i) => (p >= x.min ? i : t), 0);


// ---- sound ----
// Effects are synthesised on the fly with the Web Audio API: oscillators and
// envelopes, nothing fetched. Music is different: two composed loops embedded
// below as base64 mp3, decoded once and looped forever. Browsers will not let
// audio start before the player touches the screen, so the context is created
// lazily on the first interaction and reused after that.
const MUSIC_BUS_VOL = 0.30;   // whole-music level into the speakers
const MUSIC_MAIN_VOL = 0.55;  // main theme within the music bus
const MUSIC_TENSE_VOL = 0.6;  // tense layer at full tilt
const MUSIC_FADE_IN = 5;      // seconds for trouble to swell in
const MUSIC_FADE_OUT = 8;     // seconds for trouble to drain away
// Loop geometry, measured from the masters to the sample. The exports carry a
// hair of silence at each end and the mp3 frames add padding of their own, so
// the loop runs on this window instead of the file bounds: the wrap lands on
// music, not dead air.
// The loops live on a CDN rather than inside this file: stereo tracks as base64
// came to four fifths of the source. Each term gets its own pair, main plus
// tense, and the pair swaps every time the mayor wins re-election, cycling back
// to the first after four. If any fetch fails the game runs on in silence and
// says so on the chip.
const MUSIC_BASE = "https://cdn.jsdelivr.net/gh/mherring0817/luckheadaudio@main/";
const MUSIC_ENC_DELAY = 0.030952;   // LAME lead-in, if this decoder leaves it
const MUSIC_ENC_PAD = 0.030952;     // LAME tail padding, likewise
// Per-set loop geometry, each measured from its own masters. trueLen is the
// gapless decoded length; loopStart is the first audible sample shared by both
// stems; loopLen is the window they both loop on. A term picks one of these at
// random on each win, never the one it just played, so the score keeps turning
// over indefinitely without a set ever following itself.
const MUSIC_SETS = [
  { main: "main.mp3",  tense: "tense.mp3",  trueLen: 45.244082, loopStart: 0.008118, loopLen: 45.210249 },
  { main: "main2.mp3", tense: "tense2.mp3", trueLen: 54.909388, loopStart: 0.024059, loopLen: 54.875397 },
  { main: "main3.mp3", tense: "tense3.mp3", trueLen: 45.244082, loopStart: 0.035601, loopLen: 45.186349 },
  { main: "main4.mp3", tense: "tense4.mp3", trueLen: 52.427755, loopStart: 0.007075, loopLen: 52.396236 },
  { main: "main5.mp3", tense: "tense5.mp3", trueLen: 61.492245, loopStart: 0.005805, loopLen: 61.471247 },
  { main: "main6.mp3", tense: "tense6.mp3", trueLen: 64.052245, loopStart: 0.034603, loopLen: 64.009796 },
];
// Pick a set index other than the one now playing. With four sets this draws
// evenly from the other three; the guard also covers the degenerate one-set
// case so it can never loop forever looking for an alternative.
const pickMusicSet = (avoid) => {
  if (MUSIC_SETS.length <= 1) return 0;
  let n = Math.floor(Math.random() * MUSIC_SETS.length);
  if (n === avoid) n = (n + 1 + Math.floor(Math.random() * (MUSIC_SETS.length - 1))) % MUSIC_SETS.length;
  return n;
};
function makeAudio() {
  let ctx = null, master = null;
  let muted = false;
  let armed = false;   // flipped by the first real tap; nothing sounds before it

  const build = () => {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  };

  // Called only from a genuine user gesture. Creating the context here rather
  // than on mount is the whole trick: a context born outside a gesture starts
  // suspended and most browsers will not let it out again.
  const arm = () => {
    armed = true;
    const c = build();
    if (c && c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c;
  };

  const wake = () => {
    if (!armed) return null;
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx || build();
  };

  // One voice: a shaped tone. Everything in the game is built out of these.
  const tone = (freq, dur, type = "sine", vol = 0.5, delay = 0, glide = 0) => {
    if (muted) return;
    const c = wake(); if (!c || !master) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t0 + dur);
    // quick attack, gentle tail: keeps clicks from sounding like pops
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  };

  // Filtered noise, for anything that should sound like matter rather than pitch.
  const noise = (dur, vol = 0.3, freq = 900, delay = 0) => {
    if (muted) return;
    const c = wake(); if (!c || !master) return;
    const t0 = c.currentTime + delay;
    const frames = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource(); src.buffer = buf;
    const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = freq;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t0);
  };

  const chord = (freqs, dur, type = "triangle", vol = 0.28, spread = 0.05) =>
    freqs.forEach((f, i) => tone(f, dur, type, vol, i * spread));

  // The library. Named for the moment, not the sound.
  const SFX = {
    tap:        () => tone(430, 0.05, "square", 0.16),
    place:      () => { tone(320, 0.07, "square", 0.22); tone(480, 0.09, "square", 0.16, 0.05); },
    denied:     () => { tone(180, 0.12, "sawtooth", 0.2); tone(120, 0.16, "sawtooth", 0.18, 0.09); },
    upgrade:    () => chord([392, 523, 659], 0.34, "triangle", 0.2, 0.06),
    money:      () => { tone(880, 0.05, "square", 0.14); tone(1170, 0.07, "square", 0.12, 0.04); },
    milestone:  () => chord([523, 659, 784, 1047], 0.5, "triangle", 0.2, 0.07),
    alert:      () => { tone(660, 0.14, "square", 0.2); tone(495, 0.2, "square", 0.2, 0.14); },
    bad:        () => { tone(300, 0.3, "sawtooth", 0.22, 0, 140); noise(0.3, 0.16, 700, 0.02); },
    fire:       () => { noise(0.9, 0.34, 480); tone(160, 0.7, "sawtooth", 0.2, 0.05, 60); },
    gunshot:    () => { noise(0.22, 0.42, 2200); noise(0.5, 0.2, 400, 0.04); },
    win:        () => chord([523, 659, 784, 1047, 1319], 0.85, "triangle", 0.22, 0.1),
    lose:       () => { chord([392, 311, 262], 1.1, "sawtooth", 0.18, 0.16); noise(0.8, 0.1, 300, 0.2); },
    quake:      () => { tone(70, 1.0, "sine", 0.3, 0, 35); noise(0.9, 0.26, 260); },
  };

  // ---- music ----
  // Two loops of identical length, started on the same clock tick and looped
  // natively so they can never drift. The main theme always plays; the tense
  // layer is a gain fader that rises when the city is in trouble and drains
  // slowly once it is not. Mute and game-over ride a shared bus gain.
  let musicMuted = false, musicOver = false, musicStarted = false;
  let onMusicFail = null;
  let musicBus = null, mainGain = null, tenseGain = null, tenseOn = false;
  let bufSources = [], streamEls = [], curSetIdx = -1;
  const stopAllMusic = () => {
    bufSources.forEach((s) => { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} });
    bufSources = [];
    streamEls.forEach((el) => { try { el.pause(); } catch (e) {} el.src = ""; });
    streamEls = [];
    if (musicBus) { try { musicBus.disconnect(); } catch (e) {} musicBus = null; }
    mainGain = null; tenseGain = null;
  };

  const grab = (c, url) => {
    const tail = url.slice(url.lastIndexOf("/") + 1);
    return fetch(url, { mode: "cors" })
      .catch((e) => { throw new Error("blocked or offline: " + (e && e.message ? e.message : e)); })
      .then((r) => { if (!r.ok) throw new Error(tail + " returned http " + r.status); return r.arrayBuffer(); })
      .then((bytes) => new Promise((res, rej) => {
        try { c.decodeAudioData(bytes, res, (e) => rej(new Error(tail + " would not decode"))); }
        catch (e) { rej(new Error(tail + " would not decode")); }
      }));
  };

  const musicTarget = () => (musicMuted || musicOver ? 0.0001 : MUSIC_BUS_VOL);
  const rampBus = (secs) => {
    if (!musicBus || !ctx) return;
    const g = musicBus.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(musicTarget(), t + secs);
  };

  // Bus, main fader and tense fader. Both loading paths hang off these.
  const buildBus = (c) => {
    musicBus = c.createGain();
    musicBus.gain.value = musicTarget();
    musicBus.connect(c.destination);
    mainGain = c.createGain();
    mainGain.gain.value = tenseOn ? 0.0001 : MUSIC_MAIN_VOL;
    mainGain.connect(musicBus);
    tenseGain = c.createGain();
    tenseGain.gain.value = tenseOn ? MUSIC_TENSE_VOL : 0.0001;
    tenseGain.connect(musicBus);
  };

  // Preferred path. Whole files decoded into memory, looped by the audio clock,
  // so the two layers are locked to the sample and the seam is exact.
  const startBuffered = (c, set) =>
    Promise.all([grab(c, MUSIC_BASE + set.main), grab(c, MUSIC_BASE + set.tense)])
      .then(([mainBuf, tenseBuf]) => {
        buildBus(c);
        // Decoders that honour the LAME tag hand back the true length; those
        // that do not leave the encoder delay parked at the head. The clamp
        // measures which case this browser is and shifts the window to match.
        const t0 = c.currentTime + 0.08;
        [[mainBuf, mainGain], [tenseBuf, tenseGain]].forEach(([buf, g]) => {
          const headJunk = Math.min(MUSIC_ENC_DELAY,
            Math.max(0, buf.duration - set.trueLen - MUSIC_ENC_PAD));
          const ls = headJunk + set.loopStart;
          const srcNode = c.createBufferSource();
          srcNode.buffer = buf;
          srcNode.loop = true;
          srcNode.loopStart = ls;
          srcNode.loopEnd = Math.min(buf.duration, ls + set.loopLen);
          srcNode.connect(g);
          srcNode.start(t0, ls);
          bufSources.push(srcNode);
        });
      });

  // Fallback. Streamed through <audio>, which some sandboxes permit even when
  // they block fetch. Two elements cannot be clock-locked the way buffers can,
  // so the tense layer is nudged back into line only while it is silent: any
  // correction is inaudible because there is nothing to hear yet.
  const startStreamed = (c, set) => new Promise((res, rej) => {
    const mk = (url) => {
      const el = new Audio();
      el.crossOrigin = "anonymous"; // without this the graph reads as silence
      el.loop = true;
      el.preload = "auto";
      el.src = url;
      return el;
    };
    const mainEl = mk(MUSIC_BASE + set.main), tenseEl = mk(MUSIC_BASE + set.tense);
    streamEls = [mainEl, tenseEl];
    let settled = false;
    const fail = () => { if (!settled) { settled = true; rej(new Error("media blocked too")); } };
    mainEl.addEventListener("error", fail);
    tenseEl.addEventListener("error", fail);
    const ready = () => {
      if (settled) return;
      if (mainEl.readyState < 3 || tenseEl.readyState < 3) return;
      settled = true;
      buildBus(c);
      try {
        c.createMediaElementSource(mainEl).connect(mainGain);
        c.createMediaElementSource(tenseEl).connect(tenseGain);
      } catch (e) { return rej(new Error("media blocked too")); }
      Promise.all([mainEl.play(), tenseEl.play()])
        .then(() => {
          // Drag the silent layer back onto the beat when it slips.
          setInterval(() => {
            if (tenseOn || mainEl.paused) return;
            const drift = Math.abs(tenseEl.currentTime - mainEl.currentTime);
            if (drift > 0.02) { try { tenseEl.currentTime = mainEl.currentTime; } catch (e) {} }
          }, 4000);
          res();
        })
        .catch(() => rej(new Error("media blocked too")));
    };
    mainEl.addEventListener("canplay", ready);
    tenseEl.addEventListener("canplay", ready);
    setTimeout(fail, 12000);
  });

  const startMusic = (setIdx) => {
    if (!armed) return;
    const idx = setIdx || 0;
    if (musicStarted && idx === curSetIdx) return; // already on this set
    const c = wake(); if (!c) return;
    if (musicStarted) stopAllMusic();              // switching sets: hard restart
    musicStarted = true;
    curSetIdx = idx;
    const set = MUSIC_SETS[idx % MUSIC_SETS.length];
    startBuffered(c, set)
      .catch(() => startStreamed(c, set))
      .catch((e) => { musicStarted = false; curSetIdx = -1; if (onMusicFail) onMusicFail(e && e.message ? e.message : String(e)); });
  };

  const setTense = (on) => {
    tenseOn = !!on;
    if (!tenseGain || !mainGain || !ctx) return;
    const t = ctx.currentTime, dur = on ? MUSIC_FADE_IN : MUSIC_FADE_OUT;
    const ramp = (param, to) => {
      param.cancelScheduledValues(t);
      param.setValueAtTime(Math.max(0.0001, param.value), t);
      param.linearRampToValueAtTime(to, t + dur);
    };
    // Cross-fade: as the tense track rises the main theme falls away to silence,
    // so only one is ever really heard. Clearing trouble brings the theme back.
    ramp(tenseGain.gain, on ? MUSIC_TENSE_VOL : 0.0001);
    ramp(mainGain.gain, on ? 0.0001 : MUSIC_MAIN_VOL);
  };

  return {
    play(name) { const f = SFX[name]; if (f) { try { f(); } catch (e) {} } },
    startMusic,
    setTense,
    setMusicMuted(m) { musicMuted = !!m; rampBus(0.4); },
    onMusicFail(fn) { onMusicFail = fn; },
    setMusicOver(o) { musicOver = !!o; rampBus(o ? 3 : 1.2); },
    setMuted(m) { muted = m; },
    arm,
    isArmed: () => armed,
    wake,
  };
}

export default function Luckhead() {
  const [st, setSt] = useState(freshState);
  const [booted, setBooted] = useState(false);
  const [needsDiff, setNeedsDiff] = useState(false);
  const [pickDiff, setPickDiff] = useState(DEFAULT_DIFF);
    const [pickMayor, setPickMayor] = useState("mulaney");
  const [pickHints, setPickHints] = useState(true);
  const [pickDictator, setPickDictator] = useState(false);
  const [showHall, setShowHall] = useState(false);
  const lastSave = useRef(0);

  // Load a saved city once, on launch. Anything malformed starts fresh.
  useEffect(() => {
    let alive = true;
    let loadedSave = false;
    (async () => {
      try {
        if (typeof window !== "undefined") {
          const raw = await storeGet(SAVE_KEY);
          const r = raw != null ? { value: raw } : null;
          if (r && r.value) {
            const data = JSON.parse(r.value);
            if (data && data.v === SAVE_VERSION && data.st && Array.isArray(data.st.grid) && data.st.grid.length === N) {
              if (alive) {
                const L = data.st;
                prevPolled.current = L.polled || 0;
                prevLossWarn.current = L.lossWarned || 0;
                prevChiefKilled.current = L.chiefKilled || 0;
                prevGraffiti.current = L.graffitiSeen || 0;
                prevRiot.current = L.riotSeen || 0;
                prevViral.current = L.viralSeen || 0;
                prevUnlocked.current = L.unlocked || 0;
                prevDayUnlocked.current = L.dayUnlocked || 0;
                prevFed.current = L.fed > 0 ? 1 : 0;
                prevEvent.current = L.eventSeen || 0;
                prevVote.current = L.electionSeen || 0;
                setSt(L);
                loadedSave = true;
              }
            }
          }
        }
      } catch (e) { /* no save yet */ }
      if (alive) { setBooted(true); if (!loadedSave) setNeedsDiff(true); }
    })();
    return () => { alive = false; };
  }, []);

  // Autosave: on day ticks and construction, throttled so fast-forward does
  // not hammer storage. Game over always writes.
  useEffect(() => {
    if (!booted) return;
    const now = Date.now();
    if (!st.over && now - lastSave.current < 4000) return;
    lastSave.current = now;
    saveGame(st);
  }, [st.day, st.seq, st.over, booted]);
  const [tool, setTool] = useState(null); // null = inspect
  const [beat, setBeat] = useState(false); // police coverage lens over the board
  const [musicDead, setMusicDead] = useState(false); // the CDN never answered
  const [speed, setSpeed] = useState("play"); // pause | play | fast
  const [note, setNote] = useState(null);
  const [toast, setToast] = useState(null);
  const [audioReady, setAudioReady] = useState(false);
  const audio = useRef(null);
  if (!audio.current && typeof window !== "undefined") audio.current = makeAudio();
  const sfx = (name) => { if (audio.current && st.soundOn !== false) audio.current.play(name); };
  const [help, setHelp] = useState(false);
  const [books, setBooks] = useState(false);
  const [rates, setRates] = useState(false);
  const [hallMenu, setHallMenu] = useState(false);
  const [funding, setFunding] = useState(false);
  const [worksPanel, setWorksPanel] = useState(false);
  const [lawyerPanel, setLawyerPanel] = useState(false);
  const [commsPanel, setCommsPanel] = useState(false);
  const [crimeReport, setCrimeReport] = useState(false);
  const [statPanel, setStatPanel] = useState(null);   // 'approval' | 'mood' | 'growth' | 'env'
  const [tiesPanel, setTiesPanel] = useState(false);
  const [chiefPanel, setChiefPanel] = useState(false);
  const [bribePanel, setBribePanel] = useState(false);
  const [prPanel, setPrPanel] = useState(false);
  const [statePanel, setStatePanel] = useState(false);
  const [paper, setPaper] = useState(false);
  const prevUnlocked = useRef(0);
  const prevDayUnlocked = useRef(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const prevTier = useRef(0);
  const prevMafia = useRef("none");
  const prevChiefKilled = useRef(0);
  const prevGraffiti = useRef(0);
  const prevRiot = useRef(0);
  const prevViral = useRef(0);
  const prevElected = useRef(0);
  const [hiscores, setHiscores] = useState([]);
  const [hiRank, setHiRank] = useState(0);
  const hiRecorded = useRef(false);
  // Load the table once on boot so it can show on the game-over screen even
  // before this run is folded in.
  useEffect(() => { loadHiscores().then(setHiscores); }, []);
  const prevPolled = useRef(0);
  const prevLossWarn = useRef(0);
  const prevFed = useRef(0);
  const prevEvent = useRef(0);
  const prevVote = useRef(0);
  const apTrend = useRef({ mark: 60, at: 0 });
  const [apArrow, setApArrow] = useState("");

  useEffect(() => {
    if (speed === "pause" || st.over) return;
    const id = setInterval(() => setSt((s) => step(s)), speed === "fast" ? 1200 : 3000);
    return () => clearInterval(id);
  }, [speed, st.over]);

  const T = TAX[st.tax] || TAX.normal;
  const F = FUND[st.fund] || FUND.normal;
  const EV = eventById(st.event);
  const ecoCost = diffOf(st.diff).economy.cost;
  const d = useMemo(() => derive(st.grid, Math.floor(st.pop), st.tax, st.fund, st.terrain, st.heir, st.event, { interstate: st.interstate, works: st.works, govTraffic: st.govTraffic, mafia: st.mafia, everRefused: st.everRefused, testified: st.testified, lawyerFee: LAWYERS[st.lawyerId] ? LAWYERS[st.lawyerId].fee : 0,
      commsFee: COMMS[st.commsId] ? COMMS[st.commsId].fee : 0, commsTrade: COMMS[st.commsId] ? COMMS[st.commsId].trade : 1,
      commsMood: COMMS[st.commsId] ? COMMS[st.commsId].mood : 0,
      chiefFee: CHIEFS[st.chiefId] ? (CHIEFS[st.chiefId].salary || 0) : 0, govTrade: st.govTrade, bustArrest: st.bust === 2, bustPardon: st.bust === 3, chiefId: st.chiefId, mayor: st.mayor, day: st.day, leaderless: !st.chiefId && (st.deadChiefs || []).length >= Object.keys(CHIEFS).length, speakersDown: (st.speakerDown || 0) === 1,
      protestTraffic: ((st.eco === 3 || st.eco === 5) && st.day < (st.ecoUntil || 0)) ? 2 : 1, shake: (st.chiefShake || 0) > st.day, faithStance: st.faithStance, campaign: (st.campaignUntil || 0) > st.day, tradeBribes: (st.bribeTrade || []).filter((d) => d > st.day).length, upkeepMul: diffOf(st.diff).economy.upkeep, graffiti: st.graffiti === 1, riotOn: st.riot === 1, iceOn: st.ice === 2, ...protestFlags(st), ...strikeFlags(st), ...copFlags(st), ...faithFlags(st), ...riverFlags(st), grace: earlyGrace(st.day), env: st.env }), [st.grid, st.pop, st.tax, st.fund, st.terrain, st.heir, st.event, st.bust, st.chiefId, st.chiefShake, st.day, st.faithStance, st.bribeTrade, st.campaignUntil, st.diff, st.graffiti, st.riot, st.ice, st.protest, st.strike, st.strikeUntil, st.wageMul, st.cop, st.copUntil, st.copWage, st.doctrine, st.faithStance, st.river, st.riverUntil, st.riversCleaned, st.env]);
  const hap = calcHap(st.pop, d, st.mafia, st.crime);
  const fp = Math.floor(st.pop);
  const employed = Math.min(fp, d.jobs);
  const kick = kickbackFor(st.deal, st.rigged);
  const newKick = kickbackFor(st.deal + 1, st.rigged);
  const mafiaMoney = st.mafia === "allied" ? (st.mayor === "jenkins" ? 20 : kick) : st.mafia === "refused" ? -Math.round(st.crime / 6) : 0;
  const fedGrant = fedGrantOf(st, fp);
  const stateGrant = govGrantOf(st, fp);
  const net = Math.round(fp * T.taxRate * HEAD_TAX) + d.revenue + d.goods - d.upkeep + mafiaMoney + fedGrant + stateGrant;
  const tier = tierIdx(fp);
  const toElection = st.day % TERM_DAYS === 0 ? TERM_DAYS : TERM_DAYS - (st.day % TERM_DAYS);

  useEffect(() => {
    if (tier > prevTier.current) setToast(`🎉 ${TIERS[tier].name}! Population ${TIERS[tier].min}. Luckhead grows.`);
    prevTier.current = tier;
  }, [tier]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  // Browsers will not let a page make noise until the person has touched it.
  // Arm the engine on the very first interaction anywhere on the document, then
  // tear the listeners down: after this the context is live and stays live.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const go = () => {
      if (audio.current) { audio.current.arm(); setAudioReady(true); }
      document.removeEventListener("pointerdown", go);
      document.removeEventListener("touchstart", go);
      document.removeEventListener("keydown", go);
    };
    document.addEventListener("pointerdown", go);
    document.addEventListener("touchstart", go);
    document.addEventListener("keydown", go);
    return () => {
      document.removeEventListener("pointerdown", go);
      document.removeEventListener("touchstart", go);
      document.removeEventListener("keydown", go);
    };
  }, []);

  // Effects are discrete moments; music is the continuous bed underneath.
  // The two are muted separately, so a player can keep the theme and lose the
  // beeps, or the other way round.
  useEffect(() => {
    if (audio.current) audio.current.setMuted(st.soundOn === false);
  }, [st.soundOn]);

  // Music starts the moment the first tap arms the context: title screen and
  // city alike get the main theme.
  useEffect(() => {
    if (audioReady && audio.current) {
      audio.current.onMusicFail((why) => setMusicDead(why || "unknown"));
      const first = st.musicSet >= 0 ? st.musicSet : Math.floor(Math.random() * MUSIC_SETS.length);
      if (first !== st.musicSet) setSt((x) => ({ ...x, musicSet: first }));
      audio.current.startMusic(first);
    }
  }, [audioReady]);

  // New term, new theme. The set is chosen on each win and stored in state;
  // startMusic ignores a repeat index, so this only ever fires a real switch.
  useEffect(() => {
    if (audioReady && audio.current && st.musicSet >= 0) audio.current.startMusic(st.musicSet);
  }, [st.musicSet, audioReady]);

  // The tense layer rises when any of these is true and drains once all clear:
  // crime past 50, approval under 50, or an election ten days out or closer.
  const tenseMusic = st.crime > 50 || st.approval < 50 || (!st.dictator && toElection <= 10);
  useEffect(() => {
    if (audio.current) audio.current.setTense(tenseMusic && !st.over);
  }, [tenseMusic, st.over]);

  useEffect(() => {
    if (audio.current) audio.current.setMusicMuted(st.musicOn === false);
  }, [st.musicOn]);

  // Losing office fades the whole bed out; a fresh start brings it back.
  useEffect(() => {
    if (audio.current) audio.current.setMusicOver(!!st.over);
  }, [st.over]);

  useEffect(() => {
    const tr = apTrend.current;
    if (st.day - tr.at >= 2) {
      const delta = st.approval - tr.mark;
      setApArrow(delta > 0.4 ? "\u2191" : delta < -0.4 ? "\u2193" : "");
      tr.mark = st.approval;
      tr.at = st.day;
    }
  }, [st.day]);

  useEffect(() => {
    if ((st.chiefKilled || 0) > prevChiefKilled.current) {
      setToast("🔪 The chief was killed in a Tsui reprisal. Name a successor, and honor the fallen.");
      setSpeed("pause");
    }
    prevChiefKilled.current = st.chiefKilled || 0;
  }, [st.chiefKilled]);

  useEffect(() => {
    if ((st.graffitiSeen || 0) > prevGraffiti.current) {
      setToast("🖍️ Local teens covered the billboards in something obscene. They are down for a while.");
      setSpeed("pause");
    }
    prevGraffiti.current = st.graffitiSeen || 0;
  }, [st.graffitiSeen]);

  useEffect(() => {
    if ((st.riotSeen || 0) > prevRiot.current) {
      setToast("🚨 A riot broke out at the prison. Inmates are loose and the block is offline.");
      setSpeed("pause");
    }
    prevRiot.current = st.riotSeen || 0;
  }, [st.riotSeen]);

  useEffect(() => {
    if ((st.viralSeen || 0) > prevViral.current) {
      setToast("📹 A video of you dancing, glassy-eyed, is everywhere this morning.");
      setSpeed("pause");
    }
    prevViral.current = st.viralSeen || 0;
  }, [st.viralSeen]);


  useEffect(() => {
    if (st.mafia === "choice" || st.mafia === "renegotiate") setSpeed("pause");
    if (st.mafia === "defeated" && prevMafia.current === "refused") {
      setToast("🕊️ The Tsuis left town. The pigeons take credit.");
      setSt((x) => {
        const n = (x.logSeq || 0) + 1;
        return { ...x, logSeq: n, log: [...(x.log || []),
          { n, d: x.day, i: "🕊️", t: "THE WAR IS OVER", x: "The Tsuis have finally left Luckhead alone.", k: "good" }].slice(-LOG_KEEP) };
      });
    }
    prevMafia.current = st.mafia;
  }, [st.mafia]);

  const dayMilestone = (st.dayUnlocked || 0) > prevDayUnlocked.current && !st.over
    ? DAY_MILESTONES[(st.dayUnlocked || 0) - 1] : null;
  const newMilestone = dayMilestone || ((st.unlocked || 0) > prevUnlocked.current && !st.over
    ? MILESTONES[(st.unlocked || 0) - 1] : null);
  // A population building is available only after its milestone popup has been
  // seen and dismissed, never the instant population ticks past.
  const crossedMilestone = (k) => {
    const idx = MILESTONES.findIndex((m) => (m.keys || []).includes(k));
    if (idx < 0) return true;
    if ((st.unlocked || 0) <= idx) return false;               // not yet reached
    if (newMilestone && MILESTONES[idx] === newMilestone) return false; // popup still open
    return true;
  };
  useEffect(() => {
    if (newMilestone) setSpeed("pause");
  }, [newMilestone]);

  const showChief = st.chief === 1 && !st.over;
  const showSmuggle = st.smuggleOffer === 1 && !st.over;
  const showVenue = st.venueOffer === 1 && !st.over;
  const showFed = st.fed === 1 && prevFed.current === 0 && !st.over;
  const showHeir = st.succession === 1 && !st.over;
  const showVote = (st.electionSeen || 0) > prevVote.current && st.lastElection && st.lastElection.won && !st.over;
  const showBust = st.bust === 1 && !st.over;
  const showPvisit = st.pvisit === 1 && !st.over;
  const showFaith = st.faithMeet === 1 && !st.over;
  const showCampaign = st.campaign === 1 && !st.over;
  const showLoan = st.loanOffer === 1 && !st.over;
  const showTsuiLoan = st.tsuiLoan === 1 && !st.over;
  const showGov = st.govPending === 1 && !st.over;
  const showGovAsk = st.govAsk === 1 && !st.over;
  const showStaff = st.staffOffer === 1 && !st.over;
  const showHush = st.tsuiHush === 1 && !st.over;
  const showPotus = st.potus === 1 && !st.over;
  const showFeud = st.feud === 1 && !st.over;
  const showMarla = st.marla === 1 && !st.over;
  const showGolf = st.golfAsk === 1 && !st.over;
  const showSurv = st.surv === 1 && !st.over;
  const showVotes = st.stolenVotes === 1 && !st.over;
  const showRally = st.rally === 1 && !st.over;
  const showSlander = st.slander === 1 && !st.over;
  const showEco = st.eco === 1 && !st.over;
  const showAudit = (st.schoolNotice || 0) > 0 && !st.over;
  const showIndict = st.indictWarn === 1 && st.fed === 1 && !st.over;
  const showProtest = st.protest === 1 && !st.over;
  const showStrike = st.strike === 1 && !st.over;
  const showRiver = st.river === 1 && !st.over;
  const showSpeech = st.speech === 1 && !st.over;
  const showInvest = st.invest === 1 && !st.over;
  const showArson = st.arsonAck === 1 && !!st.lastArson && !st.over;
  const showViral = st.viralAck === 1 && !st.over;
  const showCop = st.cop === 1 && !st.over;
  const showDoctrine = st.doctrine === 1 && !st.over;
  const showIce = st.ice === 1 && !st.over;
  const showBlackmail = st.blackmail === 1 && !st.over;
  const showEvent = (st.eventSeen || 0) > prevEvent.current && !!EV && !st.over;

  // The day-7 appointment is mandatory and outranks every other interruption.
  const mustPickChief = st.day >= 7 && !st.chiefId && !st.over
    && (st.deadChiefs || []).length < Object.keys(CHIEFS).length;   // nobody left to appoint

  // One interruption at a time, and never two within MODAL_GAP days. Anything
  // held back keeps its flag and simply waits its turn.
  const pendingModals = [
    ["heir", showHeir], ["vote", showVote], ["fed", showFed], ["indict", showIndict], ["protest", showProtest], ["arson", showArson], ["viral", showViral], ["speech", showSpeech], ["invest", showInvest], ["river", showRiver], ["strike", showStrike], ["cop", showCop], ["doctrine", showDoctrine], ["chief", showChief],
    ["ice", showIce], ["blackmail", showBlackmail],
    ["potus", showPotus], ["votes", showVotes], ["eco", showEco], ["surv", showSurv], ["golf", showGolf], ["rally", showRally], ["slander", showSlander], ["marla", showMarla], ["feud", showFeud], ["audit", showAudit], ["hush", showHush], ["staff", showStaff], ["govask", showGovAsk], ["gov", showGov], ["tsuiloan", showTsuiLoan], ["loan", showLoan], ["pvisit", showPvisit], ["bust", showBust],
    ["smuggle", showSmuggle], ["venue", showVenue], ["faith", showFaith],
    ["campaign", showCampaign], ["event", showEvent],
  ].filter(([, on]) => on).map(([k]) => k);
  const queueLen = pendingModals.length;
  const cooling = (st.modalGap || 0) > st.day;
  // A fire, a killing, an indictment: these show the day they happen, cooldown
  // or not. Routine business still waits its turn.
  const urgentUp = pendingModals.find((k) => URGENT_MODALS.has(k));
  const active = mustPickChief ? null
    : urgentUp ? urgentUp
    : (queueLen && !cooling ? pendingModals[0] : null);
  const show = (k) => active === k;

  // Banners: the newest few log entries the player has not waved away yet.
  // They linger NOTICE_DAYS so they can actually be read, then retire quietly
  // into the newspaper.
  const notices = (st.log || [])
    .filter((e) => st.day - e.d < NOTICE_DAYS && !(st.dismissed || []).includes(e.n))
    .slice(-NOTICE_MAX)
    .reverse();

  // Discrete moments worth hearing. Declared here, after `active` and
  // `newMilestone` exist, because effect bodies referencing them any earlier
  // hit the temporal dead zone at runtime even though it compiles fine.
  useEffect(() => { if (newMilestone) sfx("milestone"); }, [newMilestone]);

  // The promotion waits behind any milestone, chief appointment or queued
  // modal, so two windows never stack on top of each other.
  const showTierUp = (st.tierUp || 0) > 0 && !st.over && !newMilestone && !active && !mustPickChief;
  useEffect(() => { if (showTierUp) { setSpeed("pause"); sfx("milestone"); } }, [showTierUp]);
  useEffect(() => { if (active) sfx(
    active === "arson" ? "fire"
    : active === "shooting" ? "gunshot"
    : active === "pothole" ? "quake"
    : active === "indict" || active === "fed" || active === "lowwarn" ? "bad"
    : "alert"); }, [active]);
  useEffect(() => { if (st.over) sfx("lose"); }, [st.over]);

  // Record the finished run exactly once. legacyScore is the same figure the
  // game-over screen shows, so the table and the screen never disagree.
  useEffect(() => {
    if (!st.over || st.scored || hiRecorded.current || st.dictator) return;
    hiRecorded.current = true;
    setSt((s) => ({ ...s, scored: 1 }));
    const L = legacyScore(st);
    const d = st.diff || DEFAULT_DIFF;
    const entry = {
      total: L.total, title: L.title, days: st.day,
      diff: `${DIFFICULTY.economy[d.economy].label[0]}/${DIFFICULTY.politics[d.politics].label[0]}/${DIFFICULTY.crime[d.crime].label[0]}`,
      when: Date.now(),
    };
    recordHiscore(entry).then(({ list, rank }) => { setHiscores(list); setHiRank(rank); });
  }, [st.over]);

  // A fresh game re-arms the recorder for next time.
  useEffect(() => { if (!st.over) { hiRecorded.current = false; setHiRank(0); } }, [st.over]);

  // Tutorial hints: shown one at a time, never blocking, and only while the
  // player is still finding their feet.
  const seenHints = st.hintsSeen || [];
  const pendingHint = (() => {
    if (st.over || st.hintsOn === false) return null;
    for (const hnt of HINTS) {
      if (seenHints.includes(hnt.id)) continue;
      const ready = hnt.day !== undefined ? st.day >= hnt.day : hnt.when(st, d, fp);
      if (ready) return hnt;
    }
    return null;
  })();
  useEffect(() => { if (active || mustPickChief) setSpeed("pause"); }, [active, mustPickChief]);

  // When an interruption clears, the town gets a few quiet days before the
  // next one is allowed to surface.
  const wasActive = useRef(null);
  useEffect(() => {
    if (wasActive.current && !active) {
      const gap = URGENT_MODALS.has(wasActive.current) ? MODAL_GAP : MODAL_GAP_SOFT;
      setSt((x) => ({ ...x, modalGap: x.day + gap }));
    }
    wasActive.current = active;
  }, [active]);

  const testify = () => {
    setSt((s) => {
      const grid = s.grid.map((c) => (c && c.smuggle ? { ...c, smuggle: false } : c));
      // How deep you actually were is the thing you have to answer for. Count it
      // now, before the arrangements are wiped, because afterwards nobody can tell.
      const ties = entanglements(s) + (s.bribes ? 1 : 0);
      return { ...s, grid, mafia: "defeated", testified: true, backroom: false,
               smuggleOffer: 4, venueOffer: 4, deal: 0, nextTalk: 0,
               fed: 0, heat: 0, reprisal: 30,
               testifiedDay: s.day, testifiedTies: Math.max(1, ties),
               press: 0, pressDue: s.day + PRESS_DELAY,
               crime: Math.min(100, s.crime + 25),
               approval: Math.max(0, s.approval - 26) };
    });
    setToast("⚖️ You testified. The Tsuis are finished, and so is your quiet life.");
    setSpeed("play");
  };

  const showPoll = st.polled > prevPolled.current && !st.over;
  const showLossWarn = (st.lossWarned || 0) > prevLossWarn.current && !st.over;
  useEffect(() => {
    if (showPoll || showLossWarn) setSpeed("pause");
  }, [showPoll, showLossWarn]);

  useEffect(() => {
    if (st.elected > prevElected.current) { setToast(`🗳️ Re-elected with ${Math.round(st.approval)}%. Another year in office.`); sfx("win"); }
    prevElected.current = st.elected;
  }, [st.elected]);

  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => { setConfirmReset(false); setNote(null); }, 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  const doReset = (seed, diff) => {
    // Keep whatever theme is already playing; a new game should not interrupt
    // the song the title screen started on. Only a re-election changes it.
    const keepSet = st.musicSet;
    const next = { ...freshState(seed, diff || pickDiff), hintsOn: pickHints, musicSet: keepSet, dictator: pickDictator,
        mayor: pickMayor,
        ...(pickMayor === "jenkins" ? { mafia: "allied", everAllied: 1 } : {}),
        ...(pickMayor === "mulaney" ? { govRel: 1 } : {}),
        ...(pickMayor === "debbs" ? { tax: "high", fedFavor: -1 } : {}) };
    lastSave.current = Date.now();
    saveGame(next);
    setSt(next);
    setTool(null);
    setNote(null);
    setToast(null);
    setSpeed("play");
    setConfirmReset(false);
    setBooks(false);
    setRates(false);
    setHallMenu(false);
    setFunding(false);
    setCrimeReport(false);
    setChiefPanel(false);
    setBribePanel(false);
    setPrPanel(false);
    setStatePanel(false);
    setPaper(false);
    prevTier.current = 0;
    prevMafia.current = "none";
    prevElected.current = 0;
    prevPolled.current = 0;
    prevLossWarn.current = 0;
    prevFed.current = 0;
    prevEvent.current = 0;
    prevVote.current = 0;
    wasActive.current = null;
    prevUnlocked.current = 0;
    prevDayUnlocked.current = 0;
    setNeedsDiff(false);
  };

  const advice = () => {
    if (!d.plantBuilt) return "Nothing runs without power. Place a Power Plant next to a road.";
    if (d.popCap === 0) return "Now homes. Houses must touch a road.";
    if (d.anyDisc) return "A 🚧 badge means no road access. Roads must also link back to the main network.";
    if (d.orphanRoads > 0) return `${d.orphanRoads} road tile${d.orphanRoads > 1 ? "s are" : " is"} cut off from the main network and serving nobody. Connect or bulldoze.`;
    if (d.anyUnwired) return "A ⚡ badge means off the grid. String Power Lines back to a plant.";
    if (d.anyOverload) return "The grid is over capacity. Another Power Plant, mayor.";
    if (d.anyBuilding) return "🔨 marks a site under construction. It does nothing until the crew finishes.";
    if (d.anyUnstaffed) return "A 👤 badge means short-handed. Those buildings produce only what their crew can manage.";
    if (d.buses === 1) return "A single Bus Station has nowhere to send anyone. Build a second one.";
    if (d.shops > 1 && d.shopSaturation < 0.6) return `${d.shops} shops are splitting the trade of ${fp} residents. More houses, or fewer shops.`;
    if (d.traffic > 0.35) return `Traffic is choking ${d.congested} street${d.congested > 1 ? "s" : ""}. Add parallel roads so trips spread out.`;
    if (hap < 45 && fp < d.popCap) return `Happiness is ${hap}, so nobody is moving in. A ☣️ badge means pollution. Parks help, distance helps more.`;
    if (st.crime > CRIME_THRESHOLD) return `Crime is at ${Math.round(st.crime)} and dragging approval down. Police cover a radius, Churches calm the whole town.`;
    if (!st.dictator && Math.round(st.approval) < 51 && toElection <= WARN_DAY) return `Approval is under 51 with the election in ${toElection} days. Parks, jobs, and prayers.`;
    if (fp >= 6 && d.jobs < fp * 0.7) return "Unemployment is brewing. Shops and Factories make jobs.";
    if (hap < 40) return "Morale is low. Parks near homes, factories far from them.";
    if (st.money < 50 && net <= 0) return st.tax === "none" ? "The treasury is empty and you collect no taxes. Something has to give." : "The treasury is thin. Residents and jobs pay taxes.";
    const pool = st.mafia === "allied" ? FLAVOR.concat(MAFIA_FLAVOR) : FLAVOR;
    return pool[Math.floor(st.day / 2) % pool.length];
  };

  const describe = (cell, s, i) => {
    if (cell.type === "shop" && cell.vandal && s.day < cell.vandal)
      return `Boarded up after the unrest. No jobs, no revenue for ${cell.vandal - s.day} more day${cell.vandal - s.day === 1 ? "" : "s"}. The glazier is booked solid.`;
    const b = statsOf(cell);
    const up = nextUp(cell);
    const tail = up ? ` Upgrade to ${up.name}: $${upCostOf(cell, d.bankCount, st.loans, ecoCost)}.`
                    : maxLevel(cell.type) ? " Fully upgraded." : "";
    if (cell.type === "bridge") {
      const wired = cell.wire ? " Power lines run across it." : "";
      if (s.jam === undefined) return `Orphaned bridge, connected to nothing.${wired}`;
      const level = s.jam > 0.6 ? "gridlocked" : s.jam > 0.15 ? "congested" : "flowing";
      return `Bridge: ${level}. Carrying ${Math.round(s.flow)} trips a day against a capacity of 4.${wired}`;
    }
    if (cell.type === "road") {
      const wired = cell.wire ? " Power lines overhead." : "";
      if (s.jam === undefined) return `Orphaned road, cut off from the main network. Serves nobody.${wired}`;
      const level = s.jam > 0.6 ? "gridlocked" : s.jam > 0.15 ? "congested" : "flowing";
      return `Road: ${level}. Carrying ${Math.round(s.flow)} trips a day against a capacity of 6.${wired}`;
    }
    if (cell.type === "line") return "Power Line. Humming with purpose.";
    if (cell.type === "park") return `${labelOf(cell)}. -$${statsOf(cell).upkeep}/day upkeep. ${BUILD.park.hint}${tail}`;
    if (cell.build > 0) return cell.up && cell.type === "plant"
      ? `${labelOf(cell)}: upgrading, ${cell.build} day${cell.build > 1 ? "s" : ""} to go. Running at the previous tier meanwhile.`
      : `${labelOf(cell)}: under construction, ${cell.build} day${cell.build > 1 ? "s" : ""} to go.`;
    if (s.unguarded) return `${labelOf(cell)}: closed. It will not open without a working Police Station on an adjacent tile.`;
    if (s.unpoliced) return `${labelOf(cell)}: shut up and empty. The state will not use a residence outside a police beat. Bring a Station's coverage to it.`;
    const pct = s.crew === undefined ? 1 : s.crew;
    const state = !s.connected ? "no road access" : !s.powered ? "no power"
      : pct <= 0 ? "no staff at all, closed"
      : pct < 1 ? `running at ${Math.round(pct * 100)}% staffing`
      : "running";
    const econ = econOf(cell.type, cell);
    const crew = b.jobs ? ` Needs ${b.jobs} workers${pct < 1 && pct > 0 ? `, has ${Math.round(b.jobs * pct)}` : ""}.` : "";
    let extra = (cell.type === "bus" || cell.type === "subway") ? (d.transit ? " Transit network active." : " Idle: needs a second stop somewhere in town.") : "";
    if (cell.type === "shop" && s.demand !== undefined) {
      const lift = Math.round((0.06 * (s.mates || 0) + 0.05 * (s.custom || 0)) * 100);
      extra = ` Earning $${s.earned}/day at ${Math.round(s.demand * 100)}% of full demand.` +
              (lift > 0
                ? ` +${lift}% from its neighbourhood: ${s.mates || 0} shop${s.mates === 1 ? "" : "s"} and ${s.custom || 0} home${s.custom === 1 ? "" : "s"} within 2 tiles.`
                : " Standing alone. Shops earn more beside other shops and near homes.") +
              (s.demand < 0.99 ? " Too many shops for the population." : "");
    }
    if (cell.type === "factory") {
      const mates = st.grid.filter((o, oi) => o && o.type === "factory" && !o.build && oi !== i
        && Math.abs(Math.floor(oi / SIZE) - Math.floor(i / SIZE)) + Math.abs((oi % SIZE) - (i % SIZE)) <= 2).length;
      const cap = Math.min(3, mates);
      extra += cap > 0
        ? ` Sharing yards with ${cap} nearby factor${cap === 1 ? "y" : "ies"}: ${Math.round(cap * 6)}% off its upkeep.`
        : " Standing alone. Factories built close together share upkeep.";
    }
    const smogPct = s.smog ? Math.round(20 * s.smog) : 0;
    const smog = s.smog
      ? (["house"].includes(cell.type)
          ? ` Polluted by ${s.smog} source${s.smog > 1 ? "s" : ""} nearby (-${11 * s.smog} mood).`
          : ` Polluted by ${s.smog} source${s.smog > 1 ? "s" : ""} nearby, losing ${smogPct}% of its effect.`)
      : "";
    const rowdy = s.rowdy ? ` Tavern next door (-${9 * s.rowdy} mood).` : "";
    return `${labelOf(cell)}: ${state}.${smog}${rowdy} ${econ ? econ + ". " : ""}${BUILD[cell.type].hint}${crew}${extra}${tail}`;
  };

  const tap = (i) => {
    const cell = st.grid[i];
    // The investor's factory is waiting on a site, same as a memorial.
    if (st.pendingFactory) {
      const g = (st.terrain || [])[i] || PLAIN;
      if (cell) { setNote("That tile is taken. Choose empty ground for the factory."); return; }
      if (g === WATER) { setNote("You cannot build on the water. Choose dry ground."); return; }
      setSt((s) => {
        const grid = s.grid.slice();
        grid[i] = { type: "factory", seq: s.seq, build: buildDays("factory") };
        return { ...s, grid, seq: s.seq + 1, pendingFactory: 0 };
      });
      sfx("place");
      setToast("🏭 His crews are on site by morning. Nobody asks who they work for.");
      return;
    }
    // A monument to a departed chief must be placed before anything else.
    if (st.pendingMonument) {
      const g = (st.terrain || [])[i] || PLAIN;
      if (cell) { setNote("That tile is taken. Choose empty ground for the memorial."); return; }
      if (g === WATER) { setNote("You cannot pave the river. Choose dry ground."); return; }
      setSt((s) => {
        const grid = s.grid.slice();
        grid[i] = { type: "monument", seq: s.seq, chief: s.pendingMonument, name: `${s.pendingMonument.split(" ").pop()} Park` };
        return { ...s, grid, seq: s.seq + 1, monuments: [...(s.monuments || []), s.pendingMonument], pendingMonument: null };
      });
      setToast(`🗿 ${st.pendingMonument.split(" ").pop()} Park dedicated.`);
      return;
    }
    // The town's own monument goes wherever the mayor points.
    if (st.statueOffer === 1) {
      const g = (st.terrain || [])[i] || PLAIN;
      if (cell) { setNote("That tile is taken. Choose empty ground for the monument."); return; }
      if (g === WATER) { setNote("Not in the river. Choose dry ground."); return; }
      setSt((s) => {
        const grid = s.grid.slice();
        grid[i] = { type: "statue", seq: s.seq };
        return { ...s, grid, seq: s.seq + 1, statueOffer: 2 };
      });
      sfx("place");
      setToast("🏆 The Unity Monument stands. Luckhead is rather pleased with itself.");
      return;
    }
    if (cell && (cell.type === "hall" || cell.type === "hallpart")) {
      setHallMenu(true);
      return;
    }
    if (tool === null) {
      const g = (st.terrain || [])[i] || PLAIN;
      if (st.interstate === i && !cell) {
        setNote(d.highwayOn
          ? `Interstate access, open. Shops and factories earn ${Math.round((HIGHWAY_TRADE - 1) * 100)}% more, and the through traffic costs you ${HIGHWAY_CRIME} crime, dirtier air, and busier roads. Tear up the connecting road to close it.`
          : `Interstate access. Run a road here, or up alongside it, and Luckhead joins the highway: shops and factories earn ${Math.round((HIGHWAY_TRADE - 1) * 100)}% more, at the cost of ${HIGHWAY_CRIME} crime, dirtier air, and busier roads.`);
        return;
      }
      setNote(cell ? describe(cell, d.status[i], i)
        : g === WATER ? ((st.river === 1
            || (st.river === 3 && st.day < (st.riverBuriedDay || 0) + RIVER_STAIN_DAYS)
            || (st.river === 2 && st.day < (st.riverUntil || 0)))
            ? "The water has turned the colour of a warning label. Nothing can be built here."
            : "Open water. Nothing can be built here.")
        : g === WOODS ? `Woodland. Building here costs an extra $${CLEAR_COST} to clear. Homes within 2 tiles enjoy the view.`
        : "Empty ground. Pick a building below, then tap the map.");
      return;
    }
    if (tool === "up") {
      if (!cell) { setNote("Tap a building to upgrade it."); return; }
      const up = nextUp(cell);
      if (!up) { setNote(maxLevel(cell.type) ? `${labelOf(cell)} is fully upgraded.` : `${BUILD[cell.type].name}s can't be upgraded.`); return; }
      const upPrice = upCostOf(cell, d.bankCount, st.loans, ecoCost);
      if (st.money < upPrice) { setNote(`Not enough funds. ${up.name} costs $${upPrice}.`); sfx("denied"); return; }
      setSt((s) => {
        const grid = s.grid.slice();
        const days = upgradeDays(grid[i].type);
        grid[i] = { ...grid[i], lv: (grid[i].lv || 0) + 1, ...(days > 0 ? { build: days, up: true } : {}) };
        return { ...s, grid, money: s.money - upPrice };
      });
      sfx("upgrade");
      setNote(`Upgraded to ${up.name}.`);
      return;
    }
    if (tool === "doze") {
      if (!cell) return;
      if (cell.type === "statue") { setNote("The town raised this, not you. It stays."); return; }
      const refund = Math.floor((investedIn(cell) + (cell.wire ? costOf("line", st.tax, d.bankCount, st.loans, ecoCost) : 0)) / 2);
      setSt((s) => {
        const grid = s.grid.slice();
        grid[i] = null;
        return { ...s, grid, money: s.money + refund };
      });
      setNote(`Demolished. Salvage: $${refund}.`);
      return;
    }
    if ((st.terrain || [])[i] === WATER && tool && tool !== "doze" && tool !== "up" && tool !== "bridge") { setNote("Only a Bridge can cross water."); return; }
    if (tool === "line" && cell && (cell.type === "road" || cell.type === "bridge")) {
      if (cell.wire) { setNote("Already wired."); return; }
      const lc = costOf("line", st.tax, 0, 0, ecoCost);
      if (st.money < lc) { setNote(`Not enough funds. Power Line costs $${lc}.`); return; }
      setSt((s) => {
        const grid = s.grid.slice();
        grid[i] = { ...grid[i], wire: true };
        return { ...s, grid, money: s.money - lc };
      });
      setNote("Wires strung across the road.");
      return;
    }
    if (cell) { setNote("Occupied. Bulldoze it first."); return; }
    const b = BUILD[tool];
    const ground = (st.terrain || [])[i] || PLAIN;
    if (tool === "bridge") {
      if (ground !== WATER) { setNote("Bridges only go over water. Use a Road on land."); return; }
    } else if (ground === WATER) { setNote("Only a Bridge can cross water."); return; }
    if (SPECIALTY.has(tool) && st.grid.some((c) => c && c.type === tool)) {
      setNote(`Luckhead already has ${BUILD[tool].name}. There is only one.`);
      return;
    }
    if (BUILD_CAP[tool] && st.grid.filter((c) => c && c.type === tool).length >= BUILD_CAP[tool]) {
      setNote(`Luckhead will not support more than ${BUILD_CAP[tool]} ${BUILD[tool].name}s.`);
      return;
    }
    const usesLandmarkCredit = st.freeLandmark && LANDMARKS_BUILD.includes(tool);
    const usesApartment = !!st.freeApartment && tool === "house";
    const usesFreeCamera = (st.freeCameras || 0) > 0 && tool === "camera";
    // Leroy's arrangement: the family pays for the first N stations outright.
    const tsuiCapUI = st.chiefId === "jenkins"
      ? (CHIEFS.jenkins.tsuiStations || 0) + (st.mayor === "jenkins" ? 1 : 0) : 0;
    const usesTsuiStation = tool === "police"
      && st.grid.filter((c) => c && c.type === "police").length < tsuiCapUI;
    const clearing = ground === WOODS ? CLEAR_COST : 0;
    const price = (usesLandmarkCredit || usesApartment || usesFreeCamera || usesTsuiStation) ? 0
      : costOf(tool, st.tax, d.bankCount, st.loans, ecoCost) + clearing;
    if (st.money < price) {
      setNote(clearing
        ? `Not enough funds. ${b.name} costs $${costOf(tool, st.tax, d.bankCount, st.loans, ecoCost)} plus $${clearing} to clear the trees.`
        : `Not enough funds. ${b.name} costs $${price}.`);
      sfx("denied");
      return;
    }
    sfx("place");
    setSt((s) => {
      const grid = s.grid.slice();
      const days = buildDays(tool);
      // The statehouse's block arrives finished and fully built out.
      grid[i] = usesApartment ? { type: "house", lv: 3, seq: s.seq }
        : days > 0 ? { type: tool, seq: s.seq, build: days } : { type: tool, seq: s.seq };
      // A felled stand of trees is a direct hit, not something the slow drift
      // toward a target would ever register on its own.
      const env = clearing ? Math.max(0, (s.env === undefined ? START_ENV : s.env) - 5) : s.env;
      return { ...s, grid, env, money: s.money - price, seq: s.seq + 1,
               freeLandmark: usesLandmarkCredit ? 0 : s.freeLandmark,
               freeApartment: usesApartment ? 0 : s.freeApartment,
               freeCameras: usesFreeCamera ? Math.max(0, (s.freeCameras || 0) - 1) : (s.freeCameras || 0) };
    });
    if (usesLandmarkCredit) setToast("\uD83C\uDFDB\uFE0F The statehouse pays for it, as promised.");
    if (usesApartment) setToast("\uD83C\uDFDB\uFE0F The developer's crew was already on site. Apartments, finished, no charge.");
    if (usesFreeCamera) setToast(`\uD83D\uDCF7 Installed on the firm's dime.${(st.freeCameras || 0) > 1 ? " One more to place." : ""}`);
    if (usesTsuiStation) setToast("\uD83D\uDC6E The family picked up the tab for this one. Ask nothing.");
    setNote(null);
  };

  const disp = { fontFamily: "'Staatliches', 'Arial Narrow', sans-serif", letterSpacing: "0.08em" };
  const mono = { fontFamily: "ui-monospace, Menlo, monospace" };

  // Which tiles a patrol reaches, and which of the buildings crime is measured
  // against are standing outside all of them, plus the same question asked of
  // schools against houses instead. One lens, two rosters: coverage is the
  // answer, uncovered targets are the question, for police and schools alike.
  const reachMap = (posts) => {
    const strength = new Map();
    posts.forEach(([pr, pc, reach, cw]) => {
      const s = cw === undefined ? 1 : cw;
      for (let r = pr - reach; r <= pr + reach; r++) {
        for (let cc = pc - reach; cc <= pc + reach; cc++) {
          if (r < 0 || cc < 0 || r >= SIZE || cc >= SIZE) continue;
          if (Math.abs(pr - r) + Math.abs(pc - cc) > reach) continue;
          const k = at0(r, cc);
          if (s > (strength.get(k) || 0)) strength.set(k, s);
        }
      }
    });
    return strength;
  };
  const beatMap = useMemo(() => {
    if (!beat) return null;
    const strength = reachMap(d.copPosts || []);
    const guarded = new Set();
    if (d.hallGuard) {
      const [gr, gc, rad] = d.hallGuard;
      for (let r = gr - rad; r <= gr + rad; r++) {
        for (let cc = gc - rad; cc <= gc + rad; cc++) {
          if (r < 0 || cc < 0 || r >= SIZE || cc >= SIZE) continue;
          if (Math.abs(gr - r) + Math.abs(gc - cc) <= rad) guarded.add(at0(r, cc));
        }
      }
    }
    const targs = d.crimeTargets || [];
    const naked = new Set();
    targs.forEach(([r, c]) => { const k = at0(r, c); if (!strength.has(k)) naked.add(k); });

    // Nothing about schooling is shown, or counted against the town, until the
    // town is big enough to build a school. Same threshold the mood penalty
    // uses, so the lens and the ledger always agree.
    const schoolsOpen = Math.floor(st.pop) >= (MILESTONE_POP.school || 26);
    const schoolStrength = schoolsOpen ? reachMap(d.schoolCov || []) : new Map();
    const houseTargs = schoolsOpen ? (d.houseTargets || []) : [];
    const schoolNaked = new Set();
    houseTargs.forEach(([r, c]) => { const k = at0(r, c); if (!schoolStrength.has(k)) schoolNaked.add(k); });

    return { strength, guarded, naked, targets: targs.length,
             schoolStrength, schoolNaked, houses: houseTargs.length, schoolsOpen };
  }, [beat, d.copPosts, d.crimeTargets, d.hallGuard, d.schoolCov, d.houseTargets, st.pop]);

  const Tile = ({ i }) => {
    const cell = st.grid[i];
    const [r, c] = rc(i);
    const jam = cell && (cell.type === "road" || cell.type === "bridge") ? (d.status[i]?.jam || 0) : 0;
    const orphan = cell && (cell.type === "road" || cell.type === "bridge") && d.status[i]?.jam === undefined;
    const roadShade = orphan ? "#4a4038" : jam > 0.6 ? "#6b3b34" : jam > 0.15 ? "#57493a" : C.asphalt;
    const isHall = cell && (cell.type === "hall" || cell.type === "hallpart");
    const ground = (st.terrain || [])[i] || PLAIN;
    // The buried spill still looks orange, but only for a while. Nobody
    // wants to stare at neon water for the rest of the game.
    const spillOn = st.river === 1
      || (st.river === 3 && st.day < (st.riverBuriedDay || 0) + RIVER_STAIN_DAYS)
      || (st.river === 2 && st.day < (st.riverUntil || 0));
    const natural = ground === WATER ? (spillOn ? "#ff6a1f" : C.water)
      : ground === WOODS ? C.woods
      : C.grass[(r * 7 + c * 13) % 3];
    const base = cell
      ? cell.type === "bridge" ? (jam > 0.6 ? "#7a4a40" : "#6d5f4a")
      : cell.type === "road" ? roadShade
      : cell.type === "line" ? natural
      : isHall ? "#8d7f63" : C.plot
      : natural;
    let stripes = null, badge = null;
    if (cell && (cell.type === "road" || cell.type === "bridge")) {
      const g = st.grid;
      const e = at(r, c + 1) >= 0 && isCarriageway(g[at(r, c + 1)]);
      const w = at(r, c - 1) >= 0 && isCarriageway(g[at(r, c - 1)]);
      const n = at(r - 1, c) >= 0 && isCarriageway(g[at(r - 1, c)]);
      const s2 = at(r + 1, c) >= 0 && isCarriageway(g[at(r + 1, c)]);
      const h = e || w || (!n && !s2);
      stripes = (
        <>
          {cell.type === "bridge" && (
            <>
              <span style={{ position: "absolute", top: 1, left: 0, right: 0, height: 1.5, background: "#cbb994", opacity: 0.85 }} />
              <span style={{ position: "absolute", bottom: 1, left: 0, right: 0, height: 1.5, background: "#cbb994", opacity: 0.85 }} />
            </>
          )}
          {h && <span style={{ position: "absolute", top: "50%", left: "12%", right: "12%", borderTop: `2px dashed ${C.dash}`, opacity: 0.7 }} />}
          {(n || s2) && <span style={{ position: "absolute", left: "50%", top: "12%", bottom: "12%", borderLeft: `2px dashed ${C.dash}`, opacity: 0.7 }} />}
        </>
      );
    }
    if (cell && (cell.type === "line" || cell.wire)) {
      const g = st.grid;
      const cond = (j) => j >= 0 && conducts(g[j]);
      const e = cond(at(r, c + 1)), w = cond(at(r, c - 1)), n = cond(at(r - 1, c)), s2 = cond(at(r + 1, c));
      stripes = (
        <>
          {stripes}
          {(e || w) && <span style={{ position: "absolute", top: "calc(50% - 1px)", left: 0, right: 0, height: 2, background: "#9aa7ad" }} />}
          {(n || s2) && <span style={{ position: "absolute", left: "calc(50% - 1px)", top: 0, bottom: 0, width: 2, background: "#9aa7ad" }} />}
          <span style={{ position: "absolute", top: "calc(50% - 3px)", left: "calc(50% - 3px)", width: 6, height: 6, background: "#5b4632", borderRadius: 2 }} />
        </>
      );
    }
    if (cell && cell.type !== "road" && cell.type !== "park" && cell.type !== "line") {
      const s = d.status[i];
      if (cell.build > 0) badge = ["🔨", C.cream];
      else if (!s.connected) badge = ["🚧", C.amber];
      else if (!s.powered) badge = ["⚡", C.red];
      else if (s.unguarded || s.unpoliced) badge = ["👮", C.red];
      else if (s.crew !== undefined && s.crew <= 0) badge = ["👤", C.red];
      else if (!s.staffed) badge = ["👤", C.amber];
      else if (s.smog >= 2) badge = ["☣️", C.red];
      else if (s.smog === 1) badge = ["☣️", C.amber];
    }
    return (
      <div
        onClick={() => tap(i)}
        style={{
          position: "relative", aspectRatio: "1", borderRadius: isHall ? 0 : 4, background: base,
          zIndex: cell && cell.type === "hall" ? 2 : 1,
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.10)", display: "flex",
          alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}
      >
        {beatMap && (() => {
          const s = beatMap.strength.get(i);
          const g = beatMap.guarded.has(i);
          const bare = beatMap.naked.has(i);
          if (s === undefined && !g && !bare) return null;
          return (
            <>
              {/* patrolled ground, brighter where the roster is full */}
              {s !== undefined && (
                <span style={{ position: "absolute", inset: 0, borderRadius: isHall ? 0 : 4,
                  background: C.beat, opacity: 0.12 + 0.30 * Math.min(1, s),
                  pointerEvents: "none", zIndex: 4 }} />
              )}
              {/* the hall's own detail: real coverage, different rules */}
              {s === undefined && g && (
                <span style={{ position: "absolute", inset: 0, borderRadius: isHall ? 0 : 4,
                  background: C.amber, opacity: 0.16, pointerEvents: "none", zIndex: 4 }} />
              )}
              {/* a building crime is counted against, with nobody watching it */}
              {/* school catchment, rose instead of blue so the two never read as one thing */}
              {beatMap.schoolStrength.get(i) !== undefined && (
                <span style={{ position: "absolute", inset: 0, borderRadius: isHall ? 0 : 4,
                  background: C.school, opacity: 0.12 + 0.30 * Math.min(1, beatMap.schoolStrength.get(i)),
                  pointerEvents: "none", zIndex: 4 }} />
              )}
              {/* uncovered rings, combined in one shadow so a house missing both stays
                  legible as both: police hugs the edge, school sits just inside it. */}
              {(bare || beatMap.schoolNaked.has(i)) && (
                <span style={{ position: "absolute", inset: 0, borderRadius: isHall ? 0 : 4,
                  boxShadow: [
                    bare ? `inset 0 0 0 2px ${C.red}` : null,
                    beatMap.schoolNaked.has(i) ? `inset 0 0 0 4px ${C.school}` : null,
                  ].filter(Boolean).join(", "),
                  pointerEvents: "none", zIndex: 5 }} />
              )}
            </>
          );
        })()}
        {st.interstate === i && (
          <>
            <span style={{ position: "absolute", inset: 0, borderRadius: isHall ? 0 : 4,
              boxShadow: `inset 0 0 0 2px ${d.highwayOn ? C.orange : C.dash}`,
              background: d.highwayOn ? "rgba(242,118,46,0.18)" : "rgba(216,207,174,0.10)",
              pointerEvents: "none", zIndex: 3 }} />
            {!cell && (
              <span style={{ fontSize: "clamp(8px, 2.8vw, 12px)", opacity: d.highwayOn ? 1 : 0.7 }}>
                {"\uD83D\uDEE3\uFE0F"}
              </span>
            )}
          </>
        )}
        {stripes}
        {!cell && ground === WOODS && (
          <span style={{ fontSize: "clamp(9px, 3.2vw, 14px)", opacity: 0.55 }}>🌲</span>
        )}
        {!cell && ground === WATER && (
          <span style={{ position: "absolute", inset: "34% 22%", borderTop: `1.5px solid rgba(255,255,255,0.28)`, borderRadius: "40%" }} />
        )}
        {cell && cell.type === "hall" && (
          <span
            style={{
              position: "absolute", top: 0, left: 0,
              width: "calc(200% + 2px)", height: "calc(200% + 2px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "clamp(22px, 8.4vw, 38px)", lineHeight: 1, zIndex: 3, pointerEvents: "none",
            }}
          >
            🏛️
          </span>
        )}
        {cell && cell.type !== "road" && cell.type !== "line" && cell.type !== "hall" && cell.type !== "hallpart" && (
          <span key={cell.seq} className="pop" style={{ fontSize: "clamp(12px, 4.6vw, 20px)", lineHeight: 1, opacity: cell.build > 0 ? 0.35 : (cell.vandal && st.day < cell.vandal) ? 0.55 : 1,
                         filter: (cell.vandal && st.day < cell.vandal) ? "grayscale(1)" : "none" }}>
            {BUILD[cell.type].icon}
          </span>
        )}
        {cell && (cell.lv || 0) > 0 && (
          <span style={{ position: "absolute", bottom: 1, left: 2, display: "flex", gap: 1 }}>
            {Array.from({ length: cell.lv }).map((_, k) => (
              <span key={k} style={{ width: 3, height: 3, borderRadius: 3, background: C.amber, boxShadow: "0 0 0 0.5px rgba(0,0,0,0.5)" }} />
            ))}
          </span>
        )}
        {badge && (
          <span style={{ position: "absolute", top: 1, right: 1, fontSize: 8, background: "rgba(0,0,0,0.55)", color: badge[1], borderRadius: 4, padding: "0px 2px" }}>
            {badge[0]}
          </span>
        )}
      </div>
    );
  };

  const PaletteBtn = ({ id, icon, label, sub, active, onPick, dimmed }) => (
    <div
      onClick={onPick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        padding: "7px 4px", borderRadius: 10, background: C.panel, cursor: "pointer",
        border: `1px solid ${active ? C.orange : C.line}`,
        boxShadow: active ? `0 0 0 1px ${C.orange}` : "none",
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      <span style={{ ...disp, fontSize: 11, color: C.cream }}>{label}</span>
      <span style={{ ...mono, fontSize: 9.5, color: dimmed ? C.red : C.dim }}>{sub}</span>
    </div>
  );

  const boardW = "min(94vw, 420px)";

  if (!booted) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...disp, fontSize: 16, color: C.dim, letterSpacing: "0.15em" }}>OPENING CITY HALL…</div>
      </div>
    );
  }

  if (needsDiff) {
    const cats = [
      ["economy", "ECONOMY", "💰"],
      ["politics", "POLITICS", "🗳️"],
      ["crime", "CRIME", "🚔"],
    ];
    const mult = scoreMult(pickDiff);
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.cream, display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 12px 32px", fontFamily: "-apple-system, 'Segoe UI', Roboto, sans-serif", overflowY: "auto" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Staatliches&display=swap');`}</style>
        <div style={{ width: "min(94vw, 460px)" }}>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1, marginBottom: 4 }}>
            <span style={{ ...disp, fontSize: 12, color: C.dim, letterSpacing: "0.28em" }}>MAYOR OF</span>
            <span style={{ ...disp, fontSize: 34 }}>LUCKHEAD</span>
          </div>
          <div style={{ ...mono, fontSize: 11, color: C.dim, marginBottom: 18, lineHeight: 1.5 }}>
            Set the terms of your administration. Each dial is independent, and harder settings are worth more when the history books are written. You cannot change these once the city opens.
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ ...disp, fontSize: 14, letterSpacing: "0.1em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <span>🗳️</span><span>THE CANDIDATE</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {Object.entries(MAYORS).map(([k, M]) => {
                const on = pickMayor === k;
                return (
                  <div key={k} onClick={() => setPickMayor(k)}
                    style={{ flex: 1, cursor: "pointer", padding: "8px 6px", borderRadius: 10, textAlign: "center",
                             background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}>
                    <div style={{ fontSize: 17 }}>{M.icon}</div>
                    <div style={{ ...disp, fontSize: 11.5, color: on ? C.orange : C.cream, marginTop: 2 }}>{M.name}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 5, lineHeight: 1.45 }}>
              {MAYORS[pickMayor].blurb}
            </div>
            <div style={{ ...mono, fontSize: 9, color: C.amber, marginTop: 4, lineHeight: 1.5 }}>
              {MAYORS[pickMayor].effects.map((e, i) => <span key={i} style={{ display: "block" }}>· {e}</span>)}
            </div>
          </div>

          {cats.map(([key, title, icon]) => (
            <div key={key} style={{ marginBottom: 16 }}>
              <div style={{ ...disp, fontSize: 14, letterSpacing: "0.1em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{icon}</span><span>{title}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {["easy", "medium", "hard"].map((lv) => {
                  const on = pickDiff[key] === lv;
                  const info = DIFFICULTY[key][lv];
                  return (
                    <div key={lv}
                      onClick={() => setPickDiff((p) => ({ ...p, [key]: lv }))}
                      style={{ flex: 1, cursor: "pointer", padding: "8px 6px", borderRadius: 10, textAlign: "center",
                               background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}>
                      <div style={{ ...disp, fontSize: 13, color: on ? C.orange : C.cream }}>{info.label}</div>
                      <div style={{ ...mono, fontSize: 8.5, color: on ? C.orange : C.dim, marginTop: 2 }}>×{info.score}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 5, lineHeight: 1.4, minHeight: 26 }}>
                {DIFFICULTY[key][pickDiff[key]].blurb}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: 16 }}>
            <div style={{ ...disp, fontSize: 14, letterSpacing: "0.1em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <span>👑</span><span>MODE</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["mayor", "Mayor", false], ["dictator", "Dictator", true]].map(([k, label, val]) => {
                const on = pickDictator === val;
                return (
                  <div key={k} onClick={() => setPickDictator(val)}
                    style={{ flex: 1, cursor: "pointer", padding: "8px 6px", borderRadius: 10, textAlign: "center",
                             background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}>
                    <div style={{ ...disp, fontSize: 13, color: on ? C.orange : C.cream }}>{label}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 5, lineHeight: 1.4, minHeight: 26 }}>
              {pickDictator
                ? "No elections, ever. Rule until the treasury runs dry or the feds close in. Nobody hands you a fresh start, so old trouble never gets amnestied. No score at the end, just how far you got."
                : "Face the voters every term. Fall under 51% and it's over."}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ ...disp, fontSize: 14, letterSpacing: "0.1em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <span>💡</span><span>FIRST TIME HERE?</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["yes", "Show hints", true], ["no", "No hints", false]].map(([k, label, val]) => {
                const on = pickHints === val;
                return (
                  <div key={k} onClick={() => setPickHints(val)}
                    style={{ flex: 1, cursor: "pointer", padding: "8px 6px", borderRadius: 10, textAlign: "center",
                             background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}>
                    <div style={{ ...disp, fontSize: 13, color: on ? C.orange : C.cream }}>{label}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 5, lineHeight: 1.4 }}>
              {pickHints
                ? "Short tips appear as you go, explaining each system the first time it matters. You can switch them off later in City Hall."
                : "No tips. Luckhead will not explain itself."}
            </div>
          </div>

          {pickDictator ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, marginBottom: 16, padding: "10px 12px",
                          background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10 }}>
              <span style={{ ...mono, fontSize: 10, color: C.dim }}>SCORING</span>
              <span style={{ flex: 1 }} />
              <span style={{ ...disp, fontSize: 13, color: C.dim }}>none — this is a sandbox</span>
            </div>
          ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, marginBottom: 16, padding: "10px 12px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10 }}>
            <span style={{ ...mono, fontSize: 10, color: C.dim }}>SCORE MULTIPLIER</span>
            <span style={{ flex: 1 }} />
            <span style={{ ...disp, fontSize: 22, color: mult >= 1 ? C.green : C.amber }}>×{mult.toFixed(2)}</span>
          </div>

          )}
          <div onClick={() => doReset(undefined, pickDiff)}
            style={{ ...disp, fontSize: 18, textAlign: "center", background: C.orange, color: C.ink, borderRadius: 12, padding: "12px 0", cursor: "pointer", letterSpacing: "0.08em" }}>
            TAKE OFFICE
          </div>
          <div onClick={() => setShowHall(true)}
            style={{ ...disp, fontSize: 13, textAlign: "center", color: C.cream, border: `1px solid ${C.line}`,
                     borderRadius: 11, padding: "9px 0", cursor: "pointer", letterSpacing: "0.08em", marginTop: 8 }}>
            HALL OF FAME{hiscores.length ? ` (${hiscores.length})` : ""}
          </div>
          <div style={{ ...mono, fontSize: 9, color: C.dim, textAlign: "center", marginTop: 8 }}>
            All-Medium is the standard game. Winning always takes 51%.
          </div>

          {showHall && (
            <div onClick={() => setShowHall(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 16 }}>
              <div onClick={(e) => e.stopPropagation()}
                style={{ width: "min(90vw, 360px)", background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 16, padding: 18 }}>
                <div style={{ ...mono, fontSize: 10, color: C.orange, letterSpacing: "0.2em", marginBottom: 10 }}>HALL OF FAME</div>
                {hiscores.length === 0 ? (
                  <div style={{ ...mono, fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
                    No runs recorded yet. Finish a game as Mayor and the best five land here.
                  </div>
                ) : hiscores.map((h, i) => (
                  <div key={h.when + "-" + i} style={{ display: "flex", alignItems: "baseline", gap: 8, ...mono, fontSize: 10.5, padding: "3px 4px" }}>
                    <span style={{ color: C.dim, width: 16 }}>{i + 1}</span>
                    <span style={{ color: C.cream, ...disp, fontSize: 13, width: 54 }}>{h.total}</span>
                    <span style={{ color: C.dim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</span>
                    <span style={{ color: C.dim }}>{h.diff}</span>
                  </div>
                ))}
                <div style={{ display: "flex", marginTop: 14 }}>
                  <span style={{ flex: 1 }} />
                  <span onClick={() => setShowHall(false)}
                    style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 14px" }}>CLOSE</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh", background: C.bg, color: C.cream, display: "flex",
        flexDirection: "column", alignItems: "center", padding: "10px 0 18px",
        touchAction: "manipulation", userSelect: "none",
        fontFamily: "-apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Staatliches&display=swap');
        @media (prefers-reduced-motion: no-preference) {
          .pop { animation: pop .24s ease-out; }
          .toast { animation: drop .3s ease-out; }
        }
        @keyframes pop { 0% { transform: scale(.2); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
        @keyframes drop { from { transform: translateY(-14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>

      {toast && (
        <div className="toast" style={{ position: "fixed", top: 12, zIndex: 40, background: C.orange, color: C.ink, borderRadius: 999, padding: "8px 16px", ...disp, fontSize: 14 }}>
          {toast}
        </div>
      )}

      {/* header */}
      <div style={{ width: boardW, display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span style={{ ...disp, fontSize: 10, color: C.dim, letterSpacing: "0.28em" }}>MAYOR OF</span>
          <span style={{ ...disp, fontSize: 22 }}>LUCKHEAD</span>
        </span>
        <span style={{ ...disp, fontSize: 13, color: C.orange }}>{TIERS[tier].name}</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...mono, fontSize: 11, color: C.dim }}>DAY {st.day}</span>
        <span
          onClick={() => { if (confirmReset) { setConfirmReset(false); setPickDiff(st.diff || DEFAULT_DIFF); setNeedsDiff(true); } else { setConfirmReset(true); setNote("Tap ↺ again to flatten Luckhead and choose a new difficulty."); } }}
          style={{ ...disp, fontSize: 13, border: `1px solid ${confirmReset ? C.red : C.line}`, color: confirmReset ? C.red : C.cream, borderRadius: 999, minWidth: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: confirmReset ? "0 8px" : 0 }}
        >
          {confirmReset ? "SURE?" : "↺"}
        </span>
        <span
          onClick={() => setHelp(true)}
          style={{ ...disp, fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 999, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          ?
        </span>
      </div>

      {/* stats + speed */}
      <div style={{ width: boardW, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "6px 0 8px", ...mono, fontSize: 12 }}>
        <span style={{ color: st.money < 0 ? C.red : undefined }}>💰{st.money} <span style={{ color: net >= 0 ? C.green : C.red }}>({net >= 0 ? "+" : ""}{net}/d)</span></span>
        <span>👥{fp}/{d.popCap}</span>
        <span>🙂{hap}</span>
        <span style={{ color: (st.env === undefined ? 100 : st.env) < ENV_ALARM ? C.red
                            : (st.env === undefined ? 100 : st.env) < 55 ? C.amber : C.green }}>
          🌱{Math.round(st.env === undefined ? 100 : st.env)}
        </span>
        <span style={{ color: Math.round(st.approval) >= 51 ? C.green : C.red }}>🗳️{Math.round(st.approval)}%{apArrow}·{toElection}d</span>
        {st.mafia === "allied" && <span style={{ color: C.amber }}>🤝{kick >= 0 ? `+${kick}` : kick}</span>}
        <span>⚡{d.powerDemand}/{d.powerCap}</span>
        <span style={{ flex: 1 }} />
        <span
          onClick={() => setBeat((b) => !b)}
          title={beat ? "Hide coverage" : "Show coverage (police & schools)"}
          style={{ cursor: "pointer", padding: "2px 6px", borderRadius: 7,
                   border: `1px solid ${beat ? C.orange : C.line}`,
                   background: beat ? C.orange : "transparent",
                   color: beat ? C.ink : C.dim, marginRight: 2 }}
        >
          {"\uD83D\uDC6E"}
        </span>
        <span
          onClick={() => { if (musicDead) setToast("\u266a Music failed: " + musicDead);
                           else setSt((x) => ({ ...x, musicOn: x.musicOn === false })); }}
          title={musicDead ? "Music failed: " + musicDead
                 : st.musicOn === false ? "Music off" : "Music on"}
          style={{ cursor: musicDead ? "default" : "pointer", padding: "2px 6px", borderRadius: 7,
                   border: `1px solid ${musicDead ? C.red : C.line}`,
                   color: musicDead ? C.red : st.musicOn === false ? C.dim : C.cream,
                   opacity: musicDead ? 0.5 : st.musicOn === false ? 0.55 : 1, marginRight: 2 }}
        >
          {"\uD83C\uDFB5"}
        </span>
        <span
          onClick={() => {
            const turningOn = st.soundOn === false;
            setSt((x) => ({ ...x, soundOn: turningOn }));
            if (turningOn && audio.current) { audio.current.setMuted(false); audio.current.play("tap"); }
          }}
          title={st.soundOn === false ? "Sound off" : "Sound on"}
          style={{ cursor: "pointer", padding: "2px 6px", borderRadius: 7, border: `1px solid ${C.line}`,
                   color: st.soundOn === false ? C.dim : C.cream, marginRight: 4 }}
        >
          {st.soundOn === false ? "🔇" : "🔊"}
        </span>
        {[["pause", "⏸"], ["play", "▶"], ["fast", "⏩"]].map(([k, s]) => (
          <span
            key={k}
            onClick={() => setSpeed(k)}
            style={{ cursor: "pointer", padding: "5px 11px", borderRadius: 8, fontSize: 14, lineHeight: 1,
                     border: `1px solid ${C.line}`, background: speed === k ? C.orange : "transparent",
                     color: speed === k ? C.ink : C.cream }}
          >
            {s}
          </span>
        ))}
      </div>

      {speed === "pause" && !st.over && !active && !mustPickChief && !newMilestone && !pendingHint && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>⏸️</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.orange, display: "block" }}>PAUSED</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>Day {st.day} · tap ▶ to let Luckhead run</span>
          </span>
        </div>
      )}

      {st.schoolDemand === 2 && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.red}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🏫</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.red, display: "block" }}>THE TOWN WANTS A SCHOOL</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>−{SCHOOL_DEMAND_HIT} approval until you break ground on one</span>
          </span>
        </div>
      )}

      {notices.map((e) => (
        <div key={e.n}
          onClick={() => setSt((x) => ({ ...x, dismissed: [...(x.dismissed || []), e.n].slice(-60) }))}
          style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
                   background: C.panel, borderRadius: 10, padding: "7px 10px",
                   border: `1px solid ${e.k === "good" ? C.green : e.k === "bad" ? C.red : C.amber}` }}>
          <span style={{ fontSize: 15, lineHeight: 1.2 }}>{e.i}</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, display: "block",
                           color: e.k === "good" ? C.green : e.k === "bad" ? C.red : C.amber }}>{e.t}</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim, lineHeight: 1.45 }}>{e.x}</span>
          </span>
          <span style={{ ...mono, fontSize: 9, color: C.line }}>✕</span>
        </div>
      ))}

      {st.promise && !st.promiseBroken && !st.promiseKept && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🎤</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.orange, display: "block" }}>
              {st.promise === "housing" ? "YOU PROMISED EVERY FAMILY A ROOF"
                : st.promise === "nodev" ? "YOU PROMISED NO NEW DEVELOPMENT"
                : "YOU PROMISED A GRID THAT HOLDS"}
            </span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>
              {Math.max(0, st.promiseDay + PROMISE_DAYS - st.day)} day{Math.max(0, st.promiseDay + PROMISE_DAYS - st.day) === 1 ? "" : "s"} left
              {st.promise === "housing" ? ` · ${Math.round(homelessRate(st.pop, d) * 100)}% homeless now` : ""}
            </span>
          </span>
        </div>
      )}

      {st.promiseBroken > 0 && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.red}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🤥</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.red, display: "block" }}>YOU BROKE YOUR PROMISE</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>−{PROMISE_BROKEN} approval until a successor takes over</span>
          </span>
        </div>
      )}

      {st.mafia === "refused" && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.red}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>⚔️</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.red, display: "block" }}>AT WAR WITH THE TSUI FAMILY</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>Arson, an unsettled department, and no end date. Twelve calm days in a row ends it.</span>
          </span>
        </div>
      )}

      {st.river === 2 && st.day < (st.riverUntil || 0) && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🌊</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.amber, display: "block" }}>SCRUBBERS GOING IN</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>Factories at {Math.round(RIVER_RETRO_OUT * 100)}% · {st.riverUntil - st.day} day{st.riverUntil - st.day === 1 ? "" : "s"} left</span>
          </span>
        </div>
      )}

      {(st.shooting || 0) >= 2 && st.day < (st.shootingUntil || 0) && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.red}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🕯️</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.red, display: "block" }}>THE CITY IS IN MOURNING</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>No newcomers · subdued mood · {st.shootingUntil - st.day} day{st.shootingUntil - st.day === 1 ? "" : "s"} left</span>
          </span>
        </div>
      )}

      {st.strike === 3 && st.day < (st.strikeUntil || 0) && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.red}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🏫</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.red, display: "block" }}>SCHOOLS CLOSED</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>Teachers still out · {st.strikeUntil - st.day} day{st.strikeUntil - st.day === 1 ? "" : "s"} left</span>
          </span>
        </div>
      )}

      {st.pendingFactory > 0 && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🏭</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.amber, display: "block" }}>SITE THE INVESTOR'S FACTORY</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>Tap any empty ground. It costs you nothing, and it is already on a list.</span>
          </span>
        </div>
      )}

      {st.statueOffer === 1 && !st.pendingMonument && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🏆</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.orange, display: "block" }}>Unity Monument</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>The town voted it. Tap empty ground to raise it · +5 approval, forever</span>
          </span>
        </div>
      )}

      {st.pendingMonument && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>🗿</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: C.orange, display: "block" }}>{st.pendingMonument.split(" ").pop()} Park</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>Tap empty ground to dedicate the memorial</span>
          </span>
        </div>
      )}

      {EV && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                      background: C.panel, border: `1px solid ${EV.good ? C.green : C.amber}`,
                      borderRadius: 10, padding: "6px 10px" }}>
          <span style={{ fontSize: 15 }}>{EV.icon}</span>
          <span style={{ flex: 1 }}>
            <span style={{ ...disp, fontSize: 12, color: EV.good ? C.green : C.amber, display: "block" }}>{EV.name}</span>
            <span style={{ ...mono, fontSize: 9.5, color: C.dim }}>{EV.tag}</span>
          </span>
          {EV.days > 1 && (
            <span style={{ ...mono, fontSize: 10, color: C.dim }}>{Math.max(0, st.eventEnds - st.day)}d left</span>
          )}
        </div>
      )}

      {/* labor market: a centre line with surplus workers left, unfilled jobs right */}
      {(() => {
        const idle = Math.max(0, fp - employed);        // people without work
        const openings = Math.max(0, d.jobs - employed); // work without people
        const scale = Math.max(6, fp, d.jobs);
        const idlePct = Math.min(50, (idle / scale) * 50);
        const openPct = Math.min(50, (openings / scale) * 50);
        const balanced = idle === 0 && openings === 0 && fp > 0;
        const label = fp === 0 ? "no residents"
          : idle > 0 ? `${idle} unemployed`
          : openings > 0 ? `${openings} unfilled`
          : "balanced";
        const tone = idle > 0 ? C.red : openings > 0 ? C.amber : C.green;
        return (
          <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...mono, fontSize: 10, color: C.dim, width: 40 }}>LABOR</span>
            <span style={{ flex: 1, position: "relative", height: 9, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 5, overflow: "hidden" }}>
              {/* left of centre: idle residents */}
              <span style={{ position: "absolute", top: 0, bottom: 0, right: "50%", width: `${idlePct}%`,
                background: C.red, transition: "width .4s ease" }} />
              {/* right of centre: unfilled jobs */}
              <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: `${openPct}%`,
                background: C.amber, transition: "width .4s ease" }} />
              {balanced && <span style={{ position: "absolute", inset: 0, background: C.green, opacity: 0.55 }} />}
              <span style={{ position: "absolute", top: -1, bottom: -1, left: "calc(50% - 0.5px)", width: 1, background: C.cream, opacity: 0.8 }} />
            </span>
            <span style={{ ...mono, fontSize: 10.5, width: 74, textAlign: "right", color: tone }}>{label}</span>
          </div>
        );
      })()}

      {/* crime + traffic */}
      <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...mono, fontSize: 10, color: C.dim, width: 40 }}>CRIME</span>
        <span style={{ flex: 1, position: "relative", height: 9, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 5, overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: 0, width: `${st.crime}%`,
            background: st.crime > CRIME_THRESHOLD ? C.red : st.crime > CRIME_THRESHOLD * 0.6 ? C.amber : C.green,
            transition: "width .4s ease" }} />
          <span style={{ position: "absolute", top: -1, bottom: -1, left: `${CRIME_THRESHOLD}%`, width: 1, background: C.cream, opacity: 0.75 }} />
        </span>
        <span style={{ ...mono, fontSize: 10.5, width: 74, textAlign: "right", color: st.crime > CRIME_THRESHOLD ? C.red : C.dim }}>
          {Math.round(st.crime)}{st.crime > CRIME_THRESHOLD ? " ⚠" : ""}
        </span>
      </div>

      <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...mono, fontSize: 10, color: C.dim, width: 40 }}>TRAFFIC</span>
        <span style={{ flex: 1, position: "relative", height: 9, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 5, overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: 0, width: `${Math.round(d.traffic * 100)}%`,
            background: d.traffic > 0.5 ? C.red : d.traffic > 0.2 ? C.amber : C.green,
            transition: "width .4s ease" }} />
        </span>
        <span style={{ ...mono, fontSize: 10.5, width: 74, textAlign: "right", color: d.traffic > 0.5 ? C.red : C.dim }}>
          {d.congested ? `${d.congested} jam${d.congested > 1 ? "s" : ""}` : "clear"}
        </span>
      </div>

      {st.fed > 0 && (
        <div style={{ width: boardW, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...mono, fontSize: 10, color: C.dim, width: 40 }}>FEDS</span>
          <span style={{ flex: 1, position: "relative", height: 9, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 5, overflow: "hidden" }}>
            <span style={{ position: "absolute", inset: 0, width: `${st.heat}%`,
              background: st.heat > 70 ? C.red : st.heat > 35 ? C.amber : C.green, transition: "width .4s ease" }} />
          </span>
          <span style={{ ...mono, fontSize: 10.5, width: 74, textAlign: "right", color: st.heat > 70 ? C.red : C.dim }}>
            {Math.round(st.heat)}{st.heat > 70 ? " ⚠" : ""}
          </span>
        </div>
      )}

      {/* board */}
      <div style={{ position: "relative", width: boardW }}>
        <div style={{ width: "100%", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 6, display: "grid", gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gap: 2, boxSizing: "border-box" }}>
          {st.grid.map((_, i) => <Tile key={i} i={i} />)}
        </div>
        {speed === "pause" && !st.over && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        pointerEvents: "none", zIndex: 8 }}>
            <span style={{ ...disp, fontSize: "clamp(26px, 9vw, 46px)", letterSpacing: "0.22em",
                           color: C.cream, opacity: 0.22, textShadow: `0 2px 14px ${C.bg}` }}>
              PAUSED
            </span>
          </div>
        )}
      </div>

      {beatMap && (
        <div style={{ width: boardW, marginTop: 6, display: "flex", flexDirection: "column", gap: 4,
                      ...mono, fontSize: 9.5, color: C.dim }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: C.beat, opacity: 0.6 }} />
              patrolled
            </span>
            {d.hallGuard && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: C.amber, opacity: 0.5 }} />
                hall detail
              </span>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, boxShadow: `inset 0 0 0 2px ${C.red}` }} />
              {beatMap.naked.size} unwatched
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: d.policeFrac >= 0.9 ? C.green : d.policeFrac >= 0.5 ? C.amber : C.red }}>
              police {Math.round((d.policeFrac || 0) * 100)}%
            </span>
          </div>
          {beatMap.schoolsOpen && (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: C.school, opacity: 0.6 }} />
              school district
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, boxShadow: `inset 0 0 0 2px ${C.school}` }} />
              {beatMap.schoolNaked.size} unenrolled
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: d.schoolFrac >= 0.9 ? C.green : d.schoolFrac >= 0.5 ? C.amber : C.red }}>
              school {Math.round((d.schoolFrac || 0) * 100)}%
            </span>
          </div>
          )}
        </div>
      )}

      {/* advisor */}
      <div style={{ width: boardW, marginTop: 8, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px", fontSize: 12.5, lineHeight: 1.4 }}>
        <span style={{ ...disp, color: C.orange, fontSize: 11, marginRight: 6 }}>CITY HALL</span>
        <span style={{ color: C.dim }}>{note ?? advice()}</span>
      </div>

      {pendingHint && (
        <div style={{ width: boardW, marginTop: 8, background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <span style={{ fontSize: 14 }}>{pendingHint.icon}</span>
            <span style={{ ...disp, fontSize: 12.5, color: C.orange, flex: 1 }}>{pendingHint.title}</span>
            <span
              onClick={() => setSt((x) => ({ ...x, hintsSeen: [...(x.hintsSeen || []), pendingHint.id] }))}
              style={{ ...mono, fontSize: 10, color: C.dim, cursor: "pointer", padding: "0 4px" }}
            >
              GOT IT ✕
            </span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.45, color: C.cream }}>{pendingHint.body}</div>
          <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 5 }}>{pendingHint.tip}</div>
        </div>
      )}

      {/* palette */}
      <div style={{ width: boardW, marginTop: 8, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {BUILD_KEYS.filter((k) => (k !== "mansion" || (st.govAsk || 0) >= 2)
          && (!MILESTONE_POP[k] || (fp >= MILESTONE_POP[k] && crossedMilestone(k))) && (!UNLOCK_DAY[k] || st.day >= UNLOCK_DAY[k]) && (!UNLOCK_AFTER[k] || st.grid.some((c) => c && c.type === UNLOCK_AFTER[k])) && !(SPECIALTY.has(k) && st.grid.some((c) => c && c.type === k))
              && !(BUILD_CAP[k] && st.grid.filter((c) => c && c.type === k).length >= BUILD_CAP[k])).map((k) => (
          <PaletteBtn
            key={k}
            icon={BUILD[k].icon}
            label={BUILD[k].name === "Power Plant" ? "Plant" : BUILD[k].name === "Power Line" ? "Line" : BUILD[k].name === "Campaign Billboard" ? "Billboard" : BUILD[k].name}
            sub={(k === "police" && st.chiefId === "jenkins"
                  && st.grid.filter((c) => c && c.type === "police").length < (CHIEFS.jenkins.tsuiStations || 0) + (st.mayor === "jenkins" ? 1 : 0))
                ? "FREE · the family pays"
              : (k === "camera" && (st.freeCameras || 0) > 0) ? `FREE · ${st.freeCameras} left`
              : (k === "house" && st.freeApartment) ? "FREE · Apartments"
              : (st.freeLandmark && LANDMARKS_BUILD.includes(k)) ? "FREE · statehouse"
              : `$${costOf(k, st.tax, d.bankCount, st.loans, ecoCost)}${BUILD[k].jobs ? `·${BUILD[k].jobs}👤` : ""}${buildDays(k) ? `·${buildDays(k)}d` : ""}`}
            active={tool === k}
            dimmed={!(k === "camera" && (st.freeCameras || 0) > 0)
              && !(k === "house" && st.freeApartment)
              && !(st.freeLandmark && LANDMARKS_BUILD.includes(k))
              && st.money < costOf(k, st.tax, d.bankCount, st.loans, ecoCost)}
            onPick={() => {
              const next = tool === k ? null : k;
              setTool(next);
              if (next === "police" || next === "camera" || next === "school") setBeat(true);
              setNote(BUILD[k].hint);
            }}
          />
        ))}
        <PaletteBtn icon="🔨" label="Upgrade" sub="varies" active={tool === "up"} onPick={() => { setTool(tool === "up" ? null : "up"); setNote("Tap a building to upgrade it. Three levels each, one for Police."); }} />
        <PaletteBtn icon="🚜" label="Bulldoze" sub="+50%" active={tool === "doze"} onPick={() => { setTool(tool === "doze" ? null : "doze"); setNote("Tap a building to demolish it for half back."); }} />
        <PaletteBtn icon="🔍" label="Inspect" sub="free" active={tool === null} onPick={() => { setTool(null); setNote("Tap anything on the map for details."); }} />
      </div>

      {/* new buildings unlocked */}
      {showTierUp && (() => {
        const q = GOV_QUOTES[st.tierQuote || 0] || GOV_QUOTES[0];
        const name = (TIERS[st.tierUp] || {}).name || "";
        const was = (TIERS[(st.tierUp || 1) - 1] || {}).name || "";
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 66, padding: 16 }}>
            <div style={{ width: "min(88vw, 350px)", background: C.panel, border: `1px solid ${C.green}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.green, letterSpacing: "0.2em", marginBottom: 3 }}>
                {was ? `${was.toUpperCase()} NO LONGER` : "LUCKHEAD GROWS"}
              </div>
              <div style={{ ...disp, fontSize: 22, marginBottom: 4 }}>LUCKHEAD IS A {name.toUpperCase()}</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 14 }}>
                Population {Math.floor(st.pop)}. The sign on the road needs repainting.
              </div>
              <div style={{ borderLeft: `2px solid ${C.green}`, paddingLeft: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: C.cream, fontStyle: "italic" }}>{q.text}</div>
                <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 6 }}>{q.who}</div>
                {q.src ? <div style={{ ...mono, fontSize: 9, color: C.dim, opacity: 0.75 }}>{q.src}</div> : null}
              </div>
              <div style={{ display: "flex" }}>
                <span style={{ flex: 1 }} />
                <span
                  onClick={() => { setSt((s) => ({ ...s, tierSeen: s.tierUp, tierUp: 0 })); setSpeed("play"); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.green, color: C.ink, borderRadius: 9, padding: "6px 14px" }}
                >CARRY ON</span>
              </div>
            </div>
          </div>
        );
      })()}

      {newMilestone && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 61 }}>
          <div style={{ width: "min(88vw, 350px)", background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.orange, letterSpacing: "0.2em", marginBottom: 3 }}>
              {newMilestone.pop ? `POPULATION ${newMilestone.pop}` : `DAY ${newMilestone.day}`}
            </div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 12 }}>{newMilestone.title}</div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {newMilestone.keys.map((k) => (
                <div key={k} style={{ flex: 1, textAlign: "center", padding: "10px 4px", borderRadius: 11, background: C.bg, border: `1px solid ${C.line}` }}>
                  <div style={{ fontSize: 22, lineHeight: 1.2 }}>{BUILD[k].icon}</div>
                  <div style={{ ...disp, fontSize: 12, color: C.cream }}>{BUILD[k].name}</div>
                  <div style={{ ...mono, fontSize: 9.5, color: C.dim }}>${BUILD[k].cost}{BUILD[k].jobs ? `·${BUILD[k].jobs}👤` : ""}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.dim }}>{newMilestone.body}</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.amber, marginTop: 8 }}>{newMilestone.tip}</div>

            <div style={{ display: "flex", marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { if (dayMilestone) prevDayUnlocked.current = st.dayUnlocked; else prevUnlocked.current = st.unlocked; setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                GET TO WORK
              </span>
            </div>
          </div>
        </div>
      )}

      {/* pre-election polling */}
      {showPoll && (() => {
        const pollCtx = challengerCtx(st.pop, d, calcHap(st.pop, d, st.mafia, st.crime), st);
        const pollAtk = challengerAttack(st.challenger, pollCtx);
        const ahead = Math.round(st.approval) >= 51;
        const riggedAlready = st.rigged;
        // Rigging is a favour the family does for a friend. A mayor at war with
        // them has nobody left in town who will touch the count.
        const canRig = st.mafia === "allied" || st.mafia === "defeated";
        const respondCost = Math.round(150 + 3 * st.pop);
        const canRespond = !!st.challenger && pollAtk.drag > 0;
        const canAffordRespond = st.money >= respondCost;
        const dismiss = () => { prevPolled.current = st.polled; setSpeed("play"); };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 62 }}>
            <div style={{ width: "min(90vw, 370px)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18, marginBottom: 4 }}>THE POLLSTERS ARE HERE</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 10 }}>{toElection} days until the vote</div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                <span style={{ ...disp, fontSize: 34, color: ahead ? C.green : C.red }}>{Math.round(st.approval)}%</span>
                <span style={{ ...disp, fontSize: 13, color: ahead ? C.green : C.red }}>
                  {ahead ? "ON TRACK" : "LOSING"}
                </span>
              </div>

              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                {ahead
                  ? "You are above the 51 percent you need. Hold this and the seat is yours."
                  : "You are below the 51 percent you need. If nothing changes, the town replaces you."}
              </div>

              {st.challenger && (
                <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 11, border: `1px solid ${C.line}` }}>
                  <div style={{ ...mono, fontSize: 9.5, color: C.dim, letterSpacing: "0.15em" }}>THE OPPOSITION</div>
                  <div style={{ ...disp, fontSize: 14, color: C.cream, marginTop: 2 }}>{st.challenger.name}</div>
                  <div style={{ fontSize: 11.5, color: C.dim, fontStyle: "italic" }}>"{st.challenger.label}"</div>
                  <div style={{ ...mono, fontSize: 10, marginTop: 5, color: pollAtk.drag ? C.amber : C.dim }}>
                    {pollAtk.drag
                      ? `The attack is landing: about ${pollAtk.drag} points of approval, every day, until the issue is fixed.`
                      : "Nothing much to attack right now. The line is not landing."}
                  </div>
                </div>
              )}

              {canRespond && (
                <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 11, border: `1px solid ${C.line}`, background: C.bg }}>
                  <div style={{ ...disp, fontSize: 13, color: C.green, marginBottom: 4 }}>BUY AIRTIME</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: C.dim }}>
                    A real answer to "{st.challenger.label}", run everywhere the attack ran. Halves the daily drag for the rest of this campaign.
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: canAffordRespond ? C.dim : C.red, marginTop: 6 }}>
                    ${respondCost.toLocaleString()}{!canAffordRespond ? " · Luckhead does not have it" : ""}
                  </div>
                </div>
              )}

              {canRig && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 11, border: `1px solid ${C.line}`, background: C.bg }}>
                  <div style={{ ...disp, fontSize: 13, color: C.amber, marginBottom: 4 }}>A QUIET OFFER</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: C.dim }}>
                    Certain friends can make the count more favorable. Worth about 12 points, and nobody has to know.
                    {riggedAlready > 0 && " They remember the last time. Their price has gone up."}
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: C.red, marginTop: 6 }}>
                    +12 approval · +8 crime · the Tsui family's cut grows by $12/day, permanently
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                {canRespond && (
                  <span
                    onClick={() => {
                      if (!canAffordRespond) { setToast("Not enough in the treasury to buy the airtime."); return; }
                      setSt((s) => ({ ...s, money: s.money - respondCost, campaignResponded: true }));
                      setToast(`📺 The response airs tonight. "${st.challenger.label}" lands for half as much, the rest of the way.`);
                      dismiss();
                    }}
                    style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.green, border: `1px solid ${C.green}`, borderRadius: 9, padding: "6px 10px" }}
                  >
                    BUY AIRTIME
                  </span>
                )}
                {canRig && (
                  <span
                    onClick={() => {
                      setSt((s) => ({ ...s, approval: Math.min(100, s.approval + 12), crime: Math.min(100, s.crime + (d.tsuiLoyal ? 0 : 8)), rigged: s.rigged + (d.tsuiLoyal ? 0 : 1) }));
                      setToast("🗳️ The count will be favorable. Nobody has to know.");
                      dismiss();
                    }}
                    style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 9, padding: "6px 10px" }}
                  >
                    MAKE THE CALL
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <span onClick={dismiss} style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                  RUN CLEAN
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* election loss */}
      {st.over && (() => {
        const L = legacyScore(st);
        const el = st.lastElection;
        const biscuit = st.fed !== 2 && el && el.youPct < 25;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 12 }}>
            <div style={{ width: "min(90vw, 372px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18, marginBottom: 6, color: C.red }}>{st.broke ? "BANKRUPT" : st.fed === 2 ? "INDICTED" : "VOTED OUT"}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.dim, marginBottom: 12 }}>
                {st.broke
                  ? `Luckhead owes $${Math.abs(st.money).toLocaleString()} it cannot pay. The state has appointed an emergency financial manager, who will not be needing a mayor. The nameplate came off the door before lunch.`
                  : st.fed === 2
                  ? "Federal agents took the filing cabinets out through the front door, in daylight, past the press. Vincent Tsui was photographed shaking someone's hand. It was not yours."
                  : biscuit
                  ? `You polled ${el.youPct} percent. Rather than elect ${el.name}, the town wrote in a golden retriever named Biscuit. He ran on parks.`
                  : el
                  ? `${el.name} won it ${100 - el.youPct} to ${el.youPct} on "${el.label}". The concession call was short.`
                  : "Luckhead went to the polls and chose somebody else."}
              </div>
              {st.dictator ? (
                <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 8 }}>
                  <div style={{ ...mono, fontSize: 9.5, color: C.orange, letterSpacing: "0.2em", marginBottom: 6 }}>THE REGIME, IN NUMBERS</div>
                  <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                    <span style={{ color: C.dim }}>Days in power</span><span style={{ color: C.cream }}>{st.day}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                    <span style={{ color: C.dim }}>Peak population</span><span style={{ color: C.cream }}>{st.peakPop || 0}</span>
                  </div>
                  <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 8, lineHeight: 1.4 }}>
                    No score. No election ever asked what Luckhead thought of you.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ ...mono, fontSize: 9.5, color: C.orange, letterSpacing: "0.2em", marginBottom: 4 }}>THE LEGACY</div>
                  {L.items.map(([label, v]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                      <span style={{ color: C.dim }}>{label}</span>
                      <span style={{ color: v < 0 ? C.red : C.cream }}>{v >= 0 ? "+" : ""}{v}</span>
                    </div>
                  ))}
                  {L.halved && (
                    <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0", color: C.red }}>
                      <span>{st.broke ? "Municipal bankruptcy" : "Federal indictment"}</span><span>score halved</span>
                    </div>
                  )}
                  {L.mult !== 1 && (
                    <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0", color: L.mult > 1 ? C.green : C.amber }}>
                      <span>Difficulty ({DIFFICULTY.economy[(st.diff || DEFAULT_DIFF).economy].label[0]}/{DIFFICULTY.politics[(st.diff || DEFAULT_DIFF).politics].label[0]}/{DIFFICULTY.crime[(st.diff || DEFAULT_DIFF).crime].label[0]})</span><span>{L.base} × {L.mult.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ ...disp, fontSize: 13, color: C.dim }}>{L.title}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ ...disp, fontSize: 24, color: C.orange }}>{L.total}</span>
                  </div>
                </>
              )}
              {!st.dictator && hiscores.length > 0 && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
                  <div style={{ ...mono, fontSize: 9.5, color: C.orange, letterSpacing: "0.2em", marginBottom: 6 }}>
                    {hiRank === 1 ? "A NEW BEST" : hiRank > 0 ? `HALL OF FAME \u00b7 YOU PLACED #${hiRank}` : "HALL OF FAME"}
                  </div>
                  {hiscores.map((h, i) => {
                    const mine = hiRank > 0 && i === hiRank - 1;
                    return (
                      <div key={h.when + "-" + i} style={{ display: "flex", alignItems: "baseline", gap: 8, ...mono, fontSize: 10.5,
                        padding: "2px 4px", borderRadius: 4, background: mine ? "rgba(242,118,46,0.16)" : "transparent" }}>
                        <span style={{ color: C.dim, width: 16 }}>{i + 1}</span>
                        <span style={{ color: mine ? C.orange : C.cream, ...disp, fontSize: 13, width: 54 }}>{h.total}</span>
                        <span style={{ color: C.dim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</span>
                        <span style={{ color: C.dim }}>{h.diff}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", marginTop: 12 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => { setPickDiff(st.diff || DEFAULT_DIFF); setNeedsDiff(true); }} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                  RUN AGAIN
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* mafia arrival */}
      {st.mafia === "choice" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ width: "min(88vw, 360px)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>{(st.heirCount || 0) > 0 ? "HE CAME BACK" : "A KNOCK AT CITY HALL"}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              {(st.heirCount || 0) > 0
                ? <p style={{ margin: "0 0 8px" }}>Vincent Tsui is in the outer office again, older, unhurried, holding his hat. He congratulates you on the new administration and says he worked well with this city once. He would like to pick up where he left off.</p>
                : <p style={{ margin: "0 0 8px" }}>Luckhead is big enough to get noticed. Vincent Tsui, who speaks for the Tsui crime family, would like to invest in local government.</p>}
              <p style={{ margin: 0 }}>Take the deal and $55 a day in kickbacks starts arriving. It will <b style={{ color: C.red }}>cost you about 10 points of approval</b> for as long as the arrangement stands, and crime will rise <b style={{ color: C.cream }}>slightly</b>. Refuse, and the family will make crime rise a <b style={{ color: C.red }}>great deal</b> more &mdash; and Vincent, on his way out, will mention that he would hate to see anything happen to a city as flammable as this one. They have <b style={{ color: C.red }}>threatened to burn Luckhead to the ground</b>.</p>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, mafia: "refused", everRefused: 1, crime: 15, justBroke: true })); setToast("🚨 Vincent didn't take it well. Build up your police."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "6px 12px" }}
              >
                REFUSE
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, mafia: "allied", everAllied: 1, nextTalk: s.day + 60, approval: Math.max(0, s.approval - 15), crime: Math.min(100, s.crime + 10) })); setToast("🤝 The Tsuis send their regards. The papers noticed, and so did everyone else."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                TAKE THE DEAL
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 15-day loss warning */}
      {showLossWarn && (() => {
        const gap = 51 - Math.round(st.approval);
        const ch = st.challenger;
        const dismiss = () => { prevLossWarn.current = st.lossWarned; setSpeed("play"); };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
            <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3 }}>15 DAYS TO THE VOTE</div>
              <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>YOU ARE LOSING</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ ...disp, fontSize: 32, color: C.red }}>{Math.round(st.approval)}%</span>
                <span style={{ ...mono, fontSize: 11, color: C.dim }}>need 51% · short by {gap}</span>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.dim }}>
                {ch && ch.axis && challengerAttack(ch, challengerCtx(st.pop, d, calcHap(st.pop, d, st.mafia, st.crime), st)).drag > 0
                  ? `${ch.name} is landing blows on "${ch.label}", and it is costing you every day. Take the issue away and the bleeding stops.`
                  : "Approval drifts toward happiness. Parks, jobs, medicine, and lower crime all move it, but slowly. Fifteen days is enough time if you act now."}
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8 }}>
                Check the PR Panel in City Hall to see exactly what is dragging you down.
              </div>
              <div style={{ display: "flex", marginTop: 14 }}>
                <span style={{ flex: 1 }} />
                <span onClick={dismiss} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                  TO WORK
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* renegotiation */}
      {st.mafia === "renegotiate" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ width: "min(88vw, 360px)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>VINCENT TSUI RETURNS</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>The Tsui family's expenses have grown, and so has their affection for you. New terms: {newKick > 0 ? `$${newKick} a day in kickbacks` : newKick === 0 ? "no more kickbacks, just friendship" : `you pay the Tsuis $${-newKick} a day`}.</p>
              <p style={{ margin: 0 }}>Accepting dents your approval again. Walking away starts a war, and they have <b style={{ color: C.red }}>threatened to burn the city to the ground</b>. Testifying ends all of it, at a price.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8 }}>
              <span style={{ color: C.red }}>TESTIFY</span> · -26 approval · +25 crime · 30 days of reprisals · the family never returns
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, mafia: "refused", everRefused: 1, crime: 30, heat: Math.max(0, s.heat * 0.45), justBroke: true })); setToast("🚨 The deal is off. Vincent is not sentimental, but the Bureau is interested."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "6px 10px" }}
              >
                WALK AWAY
              </span>
              <span
                onClick={testify}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.cream}`, borderRadius: 9, padding: "6px 10px" }}
              >
                TESTIFY
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, mafia: "allied", everAllied: 1, deal: s.deal + 1, nextTalk: s.day + 60, approval: Math.max(0, s.approval - 6) })); setToast("🤝 New terms accepted. The papers noticed. Again."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                ACCEPT TERMS
              </span>
            </div>
          </div>
        </div>
      )}

      {/* city hall menu */}
      {hallMenu && (() => {
        const L = legacyScore(st);
        const heat = Math.round(st.heat || 0);
        // Grouped so the eye lands somewhere. Money, then the numbers that
        // explain your standing, then the levers, then reference.
        const groups = [
          ["THE BUDGET", [
            ["$", "The Books", "7-day income & expenses", C.green, () => { setHallMenu(false); setBooks(true); }],
            [T.icon, "Tax Policy", T.name, C.cream, () => { setHallMenu(false); setRates(true); }],
            [F.icon, "Police Funding", F.name, C.cream, () => { setHallMenu(false); setFunding(true); }],
            [(WORKS[st.works] || WORKS.balanced).icon, "Public Works", (WORKS[st.works] || WORKS.balanced).name, C.cream,
              () => { setHallMenu(false); setWorksPanel(true); }],
          ]],
          ["WHERE YOU STAND", [
            ["🗳️", "PR Panel", `${Math.round(st.approval)}% approval`,
              st.approval >= 51 ? C.green : C.red, () => { setHallMenu(false); setPrPanel(true); }],
            ["🤝", "Relationships", (() => {
                const f = fedFavorOf(st);
                const g = (st.govRel || 0) - Math.floor((st.graft || 0) * ((LAWYERS[st.lawyerId] || {}).graftShield ? 0 : 1) * (st.testified ? 0.35 : 1) / GOV_GRAFT_PER_DOUBT) + (LAWYERS[st.lawyerId] ? LAWYERS[st.lawyerId].gov : 0);
                const warm = (f >= 1 ? 1 : 0) + (g >= 2 ? 1 : 0) + (st.mafia === "allied" ? 1 : 0);
                const cold = (f <= -1 ? 1 : 0) + (g <= -1 ? 1 : 0) + (st.mafia === "refused" ? 1 : 0);
                return cold > warm ? "more enemies than friends" : warm > cold ? `${warm} of 3 on your side` : "nobody owes you anything";
              })(), C.cream, () => { setHallMenu(false); setTiesPanel(true); }],
            ["🔦", "Crime Report", `${Math.round(st.crime)} on the street`,
              st.crime >= 60 ? C.red : st.crime >= 30 ? C.amber : C.green, () => { setHallMenu(false); setCrimeReport(true); }],
            ["📋", "State of the City", `score ${L.total}`, C.cream, () => { setHallMenu(false); setStatePanel(true); }],
            ["🗞️", "The Sentinel", `${(st.log || []).length} stories`, C.cream, () => { setHallMenu(false); setPaper(true); }],
          ]],
          ["YOUR PEOPLE", [
            [CHIEFS[st.chiefId]?.icon || "👮", "Police Chief", CHIEFS[st.chiefId]?.name || "None appointed",
              st.chiefId ? C.cream : C.amber, () => { setHallMenu(false); setChiefPanel(true); }],
            ...((st.staffOffer || 0) >= 2 ? [
            [COMMS[st.commsId]?.icon || "📣", "Communications",
              COMMS[st.commsId] ? `${COMMS[st.commsId].name} · $${COMMS[st.commsId].fee}/day` : "Nobody speaking for you",
              st.commsId ? C.cream : C.dim, () => { setHallMenu(false); setCommsPanel(true); }],
            [LAWYERS[st.lawyerId]?.icon || "⚖️", "City Attorney",
              LAWYERS[st.lawyerId] ? `${LAWYERS[st.lawyerId].name} · $${LAWYERS[st.lawyerId].fee}/day` : "None retained",
              st.lawyerId ? C.cream : C.dim, () => { setHallMenu(false); setLawyerPanel(true); }],
            ] : []),
            ["✉️", "Envelopes", st.fed === 1 ? `heat ${heat}/100` : `$${bribeCost(st.bribes, d.bankCount)} each`,
              st.fed === 1 ? C.red : C.amber, () => { setHallMenu(false); setBribePanel(true); }],
          ]],
        ];
        return (
          <div onClick={() => setHallMenu(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 58, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 390px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 22, letterSpacing: "0.04em" }}>CITY HALL</div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginBottom: 4 }}>
                Day {st.day} · {TIERS[tier].name}{!st.dictator ? ` · ${st.elected} term${st.elected === 1 ? "" : "s"} served` : ""}
              </div>
              {st.heir && (
                <div style={{ ...mono, fontSize: 10, color: C.amber, marginBottom: 4 }}>
                  {HEIRS[st.heir].icon} {HEIRS[st.heir].name} administration
                </div>
              )}

              {/* the three numbers you actually watch, big enough to read */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 4px" }}>
                {(() => {
                  const envNow = Math.round(st.env === undefined ? 100 : st.env);
                  const g = growthRows(st, d, hap);
                  const arrivals = g.blocked.length ? 0
                    : (0.22 + hap / 100) * glumGrowth(hap) * (TAX[st.tax] || TAX.normal).growth
                      * (COMMS[st.commsId] ? COMMS[st.commsId].growth : 1)
                      * (d.hideawayOn ? 1.12 : 1) * (st.faithStance === "attend" ? 0.94 : 1)
                      * (1 + Math.min(0.45, 0.06 * (d.learning || 0))) * (st.ice === 2 ? ICE_GROWTH : 1);
                  return [
                    ["APPROVAL", `${Math.round(st.approval)}%`, st.approval >= 51 ? C.green : C.red, "approval"],
                    ["CRIME", `${Math.round(st.crime)}`, st.crime >= 60 ? C.red : st.crime >= 30 ? C.amber : C.green, "crime"],
                    ["MOOD", `${Math.round(hap)}`, hap >= 55 ? C.green : hap >= 40 ? C.amber : C.red, "mood"],
                    ["ARRIVALS", g.blocked.length ? "\u2014" : `+${arrivals.toFixed(1)}`,
                      g.blocked.length ? C.red : arrivals >= 0.7 ? C.green : C.amber, "growth"],
                    ["ENVIRON", `${envNow}`, envNow < ENV_ALARM ? C.red : envNow < 55 ? C.amber : C.green, "env"],
                  ];
                })().map(([lab, val, col, key]) => (
                  <div key={lab}
                    onClick={() => { if (key === "crime") { setHallMenu(false); setCrimeReport(true); } else { setHallMenu(false); setStatPanel(key); } }}
                    style={{ flex: "1 1 30%", background: C.bg, borderRadius: 10, padding: "8px 6px", textAlign: "center",
                             cursor: "pointer", border: `1px solid ${C.line}` }}>
                    <div style={{ ...disp, fontSize: 19, color: col, lineHeight: 1.1 }}>{val}</div>
                    <div style={{ ...mono, fontSize: 8, color: C.dim, letterSpacing: "0.12em" }}>{lab}</div>
                  </div>
                ))}
              </div>
              <div style={{ ...mono, fontSize: 9, color: C.dim, textAlign: "center", marginBottom: 2 }}>Tap any figure for what is behind it.</div>

              {groups.map(([head, rows]) => (
                <div key={head} style={{ marginTop: 14 }}>
                  <div style={{ ...mono, fontSize: 9, color: C.orange, letterSpacing: "0.2em", marginBottom: 6 }}>{head}</div>
                  {rows.map(([ic, title, sub, col, go]) => (
                    <div key={title} onClick={go}
                      style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", marginBottom: 6,
                               borderRadius: 11, cursor: "pointer", background: C.bg, border: `1px solid ${C.line}` }}>
                      <span style={{ fontSize: 17, width: 22, textAlign: "center" }}>{ic}</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ ...disp, fontSize: 14, display: "block", lineHeight: 1.25 }}>{title}</span>
                        <span style={{ ...mono, fontSize: 10.5, color: col }}>{sub}</span>
                      </span>
                      <span style={{ color: C.line, fontSize: 15 }}>›</span>
                    </div>
                  ))}
                </div>
              ))}

              {/* settings and reference, smaller because you need them rarely */}
              <div style={{ ...mono, fontSize: 9, color: C.orange, letterSpacing: "0.2em", margin: "14px 0 6px" }}>SETTINGS</div>
              <div style={{ display: "flex", gap: 6 }}>
                <span onClick={() => { setHallMenu(false); setHelp(true); }}
                  style={{ flex: 1, textAlign: "center", cursor: "pointer", padding: "9px 6px", borderRadius: 10,
                           background: C.bg, border: `1px solid ${C.line}`, ...mono, fontSize: 10.5, color: C.cream }}>
                  📖 Manual
                </span>
                <span onClick={() => { setSt((x) => ({ ...x, hintsOn: !(x.hintsOn !== false) })); setNote(st.hintsOn === false ? "Tips back on." : "Tips off."); }}
                  style={{ flex: 1, textAlign: "center", cursor: "pointer", padding: "9px 6px", borderRadius: 10,
                           background: C.bg, border: `1px solid ${C.line}`, ...mono, fontSize: 10.5,
                           color: st.hintsOn === false ? C.dim : C.green }}>
                  💡 Tips {st.hintsOn === false ? "off" : "on"}
                </span>
              </div>

              <div style={{ display: "flex", marginTop: 14 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setHallMenu(false)} style={{ ...disp, cursor: "pointer", fontSize: 14, background: C.orange, color: C.ink, borderRadius: 9, padding: "8px 16px" }}>
                  CLOSE
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* envelopes */}
      {bribePanel && (() => {
        const price = bribeCost(st.bribes, d.bankCount);
        const canPay = st.money >= price;
        const pay = (kind) => {
          if (!canPay) { setNote(`Not enough in the treasury. That envelope costs $${price}.`); return; }
          let caught = false;
          setSt((x) => {
            const n = { ...x, money: x.money - price, bribes: (x.bribes || 0) + 1,
              bribeStain: [...(x.bribeStain || []), x.day + 90] };
            if (kind === "fed") n.heat = Math.round(x.heat * 0.5);
            if (kind === "local") n.bribeLocal = [...(x.bribeLocal || []), x.day + 30];
            if (kind === "trade") n.bribeTrade = [...(x.bribeTrade || []), x.day + 90];
            // Paying anyone but the Bureau leaves a trail, and each envelope
            // after the first leaves a wider one.
            if (kind !== "fed") n.heat = Math.min(100, (n.heat || 0) + 4 + 2 * (x.bribes || 0));
            // Passing an envelope is itself a risk: a 1-in-5 chance it puts you
            // on the Bureau's radar, if they were not already watching.
            if ((x.fed || 0) === 0 && Math.random() < 0.2) { n.fed = 1; n.heat = Math.max(n.heat || 0, 15); caught = true; }
            return n;
          });
          setToast(caught
            ? `✉️ Delivered, but someone was watching. The Bureau opens a file.`
            : `✉️ Delivered. $${price} left the treasury and nobody wrote it down.`);
        };
        return (
          <div onClick={() => setBribePanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 384px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>ENVELOPES</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>
                ${price} each · rises ${BRIBE_STEP} every time · every envelope costs 4 approval for 90 days
                {d.bankCount ? ` · banks shave ${5 * d.bankCount}%` : ""}
              </div>
              {Object.keys(BRIBES).map((k) => {
                const b = BRIBES[k];
                return (
                  <div key={k} onClick={() => pay(k)}
                    style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: canPay ? "pointer" : "not-allowed",
                             opacity: canPay ? 1 : 0.45, border: `1px solid ${C.line}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{b.icon}</span>
                      <span style={{ ...disp, fontSize: 14, color: C.cream }}>{b.name}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ ...mono, fontSize: 10.5, color: canPay ? C.orange : C.red }}>${price}</span>
                    </div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.4, color: C.dim, marginTop: 4 }}>{b.blurb}</div>
                    {k === "fed" && <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 4 }}>current heat {Math.round(st.heat)} → {Math.round(st.heat * 0.5)}</div>}
                  </div>
                );
              })}
              <div style={{ display: "flex", marginTop: 6 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setBribePanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>DONE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* police chief */}
      {show("chief") && (() => {
        const officers = st.grid.reduce((a, c) => a + (c && c.type === "police" && !c.build
          ? Math.max(1, statsOf(c).jobs + F.staff + (CHIEFS[st.chiefId]?.staff || 0)) : 0), 0);
        const bill = officers * 100;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
            <div style={{ width: "min(88vw, 352px)", background: C.panel, border: `1px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18, marginBottom: 4 }}>THE CHIEF WANTS A WORD</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.red, marginBottom: 10 }}>Crime has maxed out at 100</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>The chief says his people are outgunned and out of radios. He wants a full equipment overhaul: <b style={{ color: C.cream }}>${bill}</b> for {officers} officer{officers === 1 ? "" : "s"} on the roster.</p>
                <p style={{ margin: 0 }}>Fund it and the town sees you act. Refuse and they see that too.</p>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <span
                  onClick={() => { setSt((s) => ({ ...s, chief: 2, approval: Math.max(0, s.approval - 3) })); setToast("🚔 The chief walked out without his radios."); setSpeed("play"); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "6px 10px" }}
                >
                  DECLINE
                </span>
                <span style={{ flex: 1 }} />
                <span
                  onClick={() => {
                    if (st.money < bill) { setNote(`The treasury is short. The overhaul costs $${bill}.`); return; }
                    setSt((s) => ({ ...s, chief: 2, gear: true, money: s.money - bill, approval: Math.min(100, s.approval + 6) }));
                    setToast("🚔 New equipment all round. Crime pressure eased.");
                    setSpeed("play");
                  }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: st.money < bill ? C.line : C.orange, color: st.money < bill ? C.dim : C.ink, borderRadius: 9, padding: "6px 12px" }}
                >
                  PAY ${bill}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* event announcement */}
      {show("event") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
          <div style={{ width: "min(88vw, 348px)", background: C.panel, border: `1px solid ${EV.good ? C.green : C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.2em", marginBottom: 3 }}>DAY {st.day}</div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>{EV.icon} {EV.name}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>{EV.body}</div>
            <div style={{ ...mono, fontSize: 10.5, color: EV.good ? C.green : C.amber, marginTop: 8 }}>
              {EV.tag}{EV.days > 1 ? ` · ${EV.days} days` : ""}
            </div>
            {EV.choice && (
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8 }}>
                The city can throw ${choiceCost(EV, st.pop).toLocaleString()} at this one. It works about {Math.round(BUYOUT_ODDS * 100)} times out of a hundred. Spend it and it does not work, the money is gone and so is your week.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              {EV.choice && (
                <span
                  onClick={() => {
                    const price = choiceCost(EV, st.pop);
                    if (st.money < price) { setNote(`You do not have $${price.toLocaleString()} for that.`); return; }
                    const done = EV.choice.done;
                    // Money buys you a good chance, not an outcome. The roll is
                    // pinned to the event so it cannot be re-rolled by reopening.
                    const worked = mulberry32((st.seed || 1) * 6113 + st.day * 31 + (st.eventSeen || 0))() < BUYOUT_ODDS;
                    setSt((s) => (worked
                      ? { ...s, money: s.money - price, event: null, eventEnds: 0 }
                      : { ...s, money: s.money - price, buyoutFailed: (s.buyoutFailed || 0) + 1 }));
                    prevEvent.current = st.eventSeen;
                    setToast(worked
                      ? `\uD83D\uDCB8 ${done}`
                      : `\uD83D\uDCB8 The money went out the door and the problem stayed. ${EV.name} runs its course.`);
                    setSpeed("play");
                  }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5,
                           background: st.money < choiceCost(EV, st.pop) ? C.line : C.amber,
                           color: st.money < choiceCost(EV, st.pop) ? C.dim : C.ink,
                           borderRadius: 9, padding: "6px 12px" }}>
                  {EV.choice.label}
                </span>
              )}
              <span onClick={() => { prevEvent.current = st.eventSeen; setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                {EV.good ? "GOOD NEWS" : EV.choice ? "RIDE IT OUT" : "DEAL WITH IT"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* election night */}
      {show("vote") && (() => {
        const el = st.lastElection;
        const margin = el.youPct - 51;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64 }}>
            <div style={{ width: "min(88vw, 352px)", background: C.panel, border: `1px solid ${C.green}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.2em", marginBottom: 3 }}>ELECTION NIGHT · DAY {el.day}</div>
              <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>FOUR MORE YEARS</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <span style={{ ...disp, fontSize: 30, color: C.green }}>{el.youPct}%</span>
                <span style={{ ...mono, fontSize: 11, color: C.dim }}>you</span>
                <span style={{ flex: 1 }} />
                <span style={{ ...mono, fontSize: 11, color: C.dim }}>{el.name.split(" ").pop()}</span>
                <span style={{ ...disp, fontSize: 30, color: C.red }}>{100 - el.youPct}%</span>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.dim }}>
                {el.live
                  ? `${el.name} ran hard on "${el.label}", and every day it stayed true it drained your standing. You cleared 51 by ${margin} anyway.`
                  : el.axis && el.axis !== "change"
                  ? `${el.name} built a campaign around "${el.label}", and you took the issue away before the vote. The attack never landed.`
                  : `${el.name} never found an issue that stuck. You cleared 51 by ${margin}.`}
              </div>
              <div style={{ display: "flex", marginTop: 14 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => { prevVote.current = st.electionSeen; setSpeed("play"); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                  BACK TO WORK
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* succession */}
      {show("heir") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 65 }}>
          <div style={{ width: "min(90vw, 372px)", background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.orange, letterSpacing: "0.2em", marginBottom: 3 }}>
              {st.elected} TERMS SERVED
            </div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 6 }}>TIME TO STEP ASIDE</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.dim, marginBottom: 12 }}>
              Luckhead has had enough of you, in the affectionate way. Name your successor and the goodwill starts fresh. Their politics become the city's, permanently.
            </div>
            <div style={{ ...mono, fontSize: 9.5, lineHeight: 1.6, color: C.amber, marginBottom: 12,
                          border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px" }}>
              WHAT DOES NOT CARRY OVER<br />
              <span style={{ color: C.dim }}>
                Standing with Governor Sanders and with the President each move one step toward
                neutral. A friend leaves a warm statehouse behind; an enemy leaves a thaw. Every
                Tsui arrangement is torn up and the family will come calling again. Federal heat
                clears and the file closes. A communications director the statehouse placed on you
                goes free. The buildings, the money and the town's memory of your worst days all
                stay exactly where they are.
              </span>
            </div>

            {HEIR_KEYS.map((k) => {
              const heir = HEIRS[k];
              return (
                <div
                  key={k}
                  onClick={() => {
                    setSt((s) => {
                      // A new administration inherits the city, not the arrangements.
                      const grid = s.grid.map((c) => (c && c.smuggle ? { ...c, smuggle: false } : c));
                      return { ...s, grid, heir: k, succession: 0, honeymoonAt: s.elected, heirCount: (s.heirCount || 0) + 1,
                        firstHeirDay: (s.firstHeirDay || 0) === 0 ? s.day : s.firstHeirDay,
                        approval: Math.min(100, Math.max(0, s.approval + 8)),
                        mafia: "none", deal: 0, rigged: 0, nextTalk: 0,
                        tsuiBound: 0, tsuiHush: 0, govBacked: 0, everAllied: 0, everRefused: 0,
                        // Standings are personal. They belong to the mayor who earned
                        // them, not to Luckhead, and they do not transfer.
                        // Standings are personal, but they are not erased. Each one
                        // moves a single step toward neutral: a friend of the
                        // statehouse leaves a warm one, an enemy leaves a thaw.
                        govRel: (s.govRel || 0) - Math.sign(s.govRel || 0),
                        fedFavor: (s.fedFavor || 0) - Math.sign(s.fedFavor || 0),
                        // These were arrangements with the last mayor personally.
                        feud: 0, marla: 0, marlaCool: 0, commsLocked: 0,
                        rally: 0, slander: 0, slanderUntil: 0, slanderCool: 0,
                        backroom: false, smuggleOffer: 0, venueOffer: 0, venueDay: 0,
                        fed: 0, heat: 0, ties: 0, testified: false, pvisit: 0, viral: 0, graffiti: 0,
                        doctrine: 0, doctrineCool: 0, faithStance: "none", blackmailUntil: 0,
                        river: 0, riverBuriedDay: 0,
                        promise: null, promiseBroken: 0, promiseKept: 0, promiseDay: 0, speech: 0,
                        investTook: 0, invest: 0, investCool: 0,
                        tsuiReturn: s.day + 3 };
                    });
                    setToast(`${heir.icon} ${heir.name} takes office. A fresh start, more or less.`);
                    setSpeed("play");
                  }}
                  style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: "pointer", border: `1px solid ${C.line}` }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{heir.icon}</span>
                    <span style={{ ...disp, fontSize: 14, color: C.cream }}>{heir.name}</span>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.4, color: C.dim, marginTop: 4, fontStyle: "italic" }}>{heir.line}</div>
                  <div style={{ ...mono, fontSize: 10, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {heir.effects.map((e) => (
                      <span key={e} style={{ color: e.startsWith("-") && !e.includes("pollution") ? C.red : C.green }}>{e}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* federal file opened */}
      {show("fed") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64 }}>
          <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3 }}>FIELD OFFICE, ATLANTA</div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>A FILE HAS BEEN OPENED</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>Someone downtown counted your arrangements with the Tsui family and did not like the total. A federal investigation is now open on the mayor's office.</p>
              <p style={{ margin: 0 }}>A new bar tracks how much they have. It climbs with every standing deal and with the crime they generate. Prisons and full police funding slow it. If it fills, you are indicted, and no election will save you.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.amber, marginTop: 8 }}>
              You can end this at any renegotiation by testifying.
            </div>
            <div style={{ display: "flex", marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { prevFed.current = 1; setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                UNDERSTOOD
              </span>
            </div>
          </div>
        </div>
      )}

      {/* the loan */}
      {show("loan") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64 }}>
          <div style={{ width: "min(88vw, 352px)", background: C.panel, border: `1px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3 }}>THE TREASURY IS EMPTY</div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>AN OFFER OF CREDIT</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>Luckhead is overdrawn, and the bank on your own map has noticed. They will wire $2,000 into the city account this afternoon.</p>
              <p style={{ margin: 0 }}>In exchange, every contractor in town learns what the city's credit is worth. Construction costs rise 5 percent, permanently, and again with every loan you take.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8 }}>
              {st.loans ? `You have already borrowed ${st.loans} time${st.loans === 1 ? "" : "s"}: costs are +${5 * st.loans}% today.` : "Your first loan."}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span onClick={() => { setSt((x) => ({ ...x, loanOffer: 2 })); setToast("🏦 You declined. The city stays broke and proud."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 10px" }}>
                DECLINE
              </span>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((x) => ({ ...x, loanOffer: 2, loans: (x.loans || 0) + 1, money: x.money + 2000 })); setToast("🏦 $2,000 in the account. Everything costs more now."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                TAKE $2,000
              </span>
            </div>
          </div>
        </div>
      )}

      {/* image campaign */}
      {show("campaign") && (() => {
        const left = TERM_DAYS - ((st.day - 1) % TERM_DAYS) - 1;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
            <div style={{ width: "min(88vw, 352px)", background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.orange, letterSpacing: "0.2em", marginBottom: 3 }}>30 DAYS TO THE VOTE</div>
              <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>A POSITIVE IMAGE CAMPAIGN</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>An agency has drafted a campaign for the loudspeaker network: warmer music, softer voices, your name said more often and more fondly.</p>
                <p style={{ margin: 0 }}>Run it and the speakers work 30 percent harder until the term ends. The electricity and airtime cost double while it runs.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8 }}>
                {left} day{left === 1 ? "" : "s"} left in the term · speaker upkeep doubles for the duration
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <span onClick={() => { setSt((x) => ({ ...x, campaign: 2 })); setToast("📢 The speakers keep to the weather and the bin schedule."); setSpeed("play"); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 10px" }}>
                  NO THANKS
                </span>
                <span style={{ flex: 1 }} />
                <span onClick={() => { setSt((x) => ({ ...x, campaign: 2, campaignUntil: x.day + left })); setToast("📢 Warmer music, softer voices, your name rather a lot."); setSpeed("play"); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                  RUN IT
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* meeting with religious leaders */}
      {show("faith") && (() => {
        const nCh = st.grid.filter((c) => c && c.type === "church" && !c.build).length;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
            <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.cream}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.2em", marginBottom: 3 }}>MONDAY, FIRST THING</div>
              <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>MEETING WITH RELIGIOUS LEADERS</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>The interfaith council would like the new term to begin with the mayor in a pew. They have blessings to offer, opinions about how fast Luckhead is changing, and one standing question about the property tax rolls.</p>
                <p style={{ margin: 0 }}>Attend, and the congregations work wonders this term. Decline, and they will remember it: the exemption goes, and so does their enthusiasm for helping you keep order.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                <span style={{ color: C.green }}>ATTEND</span> · Churches 25% more effective this term · immigration -6% this term<br />
                <span style={{ color: C.amber }}>DECLINE</span> · tax the churches, +$5/day each · -1 approval<br />
                <span style={{ ...mono, color: C.red }}>· and every Church is 30% less effective against crime, until a successor takes over</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <span
                  onClick={() => { setSt((s) => ({ ...s, faithMeet: 2, faithStance: "refuse" })); setToast(`⛪ The exemption is revoked. ${nCh} congregation${nCh === 1 ? " is" : "s are"} on the tax rolls.`); setSpeed("play"); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 10px" }}
                >
                  DECLINE
                </span>
                <span style={{ flex: 1 }} />
                <span
                  onClick={() => { setSt((s) => ({ ...s, faithMeet: 2, faithStance: "attend" })); setToast("⛪ You attended. The congregations are energized, and watching the newcomers."); setSpeed("play"); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.cream, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
                >
                  ATTEND
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the presidential visit */}
      {show("pvisit") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
          <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.cream}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.cream, letterSpacing: "0.2em", marginBottom: 3 }}>THE WHITE HOUSE, SWITCHBOARD</div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>PRESIDENTIAL VISIT</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>The President wants to visit Luckhead next month. The President is, unfortunately, from the other party, and your base has opinions about handshakes.</p>
              <p style={{ margin: 0 }}>But it is very hard for the Justice Department to raid a mayor the President was just photographed hugging. Your lawyer says take the call. Your pollster says do not.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.green }}>HOST</span> · federal heat -45 · -3 approval until your successor takes office<br />
              <span style={{ color: C.amber }}>SEND REGRETS</span> · +1.5 approval until your successor takes office
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, pvisit: 3, fedFavor: Math.max(FED_FAVOR_MIN, (s.fedFavor || 0) - 1) })); setToast("🇺🇸 Regrets, respectfully. The base is pleased with you."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 10px" }}
              >
                SEND REGRETS
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => { const cap = fedComplete({ ...s, pvisit: 2 }) ? 3 : FED_FAVOR_MAX; return { ...s, pvisit: 2, heat: Math.max(0, s.heat - 45), fedFavor: Math.min(cap, (s.fedFavor || 0) + 1) }; }); setToast("🇺🇸 Motorcade, handshake, front page. The file goes quiet."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.cream, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                HOST THE PRESIDENT
              </span>
            </div>
          </div>
        </div>
      )}

      {/* the President's ICE demand */}
      {/* last call before the indictment */}
      {show("indict") && (() => {
        const price = bribeCost(st.bribes, d.bankCount);
        const canPay = st.money >= price;
        const clear = () => setSt((s) => ({ ...s, indictWarn: 2 }));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 12 }}>
            <div style={{ width: "min(90vw, 372px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `2px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3 }}>THE FILE IS ALMOST CLOSED</div>
              <div style={{ ...disp, fontSize: 20, marginBottom: 8 }}>YOU ARE ABOUT TO BE INDICTED</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                <span style={{ ...disp, fontSize: 34, color: C.red }}>{Math.round(st.heat)}</span>
                <span style={{ ...mono, fontSize: 11, color: C.dim }}>/ 100 · indicted at 100</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>Prosecutors have enough to move. When the heat reaches 100 your term ends in handcuffs and your legacy is cut in half.</p>
                <p style={{ margin: 0 }}>There are two ways out, and one of them is expensive.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
                <span style={{ color: C.amber }}>AN ENVELOPE</span> · ${price} · halves the heat, buys time, does not close the file<br />
                <span style={{ color: C.green }}>TESTIFY</span> · clears the heat entirely and ends the family<br />
                <span style={{ ...mono, color: C.dim }}>· costs 26 approval, +25 crime, 30 days of reprisals</span>
              </div>
              {(st.ties || 0) > 0 && (
                <div style={{ ...mono, fontSize: 9.5, color: C.red, marginTop: 8 }}>
                  {st.ties} entanglement{st.ties === 1 ? "" : "s"} still feeding the file. Cutting them slows the heat.
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
                <span
                  onClick={() => { clear(); setBribePanel(true); setSpeed("pause"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13,
                           background: canPay ? C.amber : C.line, color: C.ink, borderRadius: 9, padding: "8px 12px" }}
                >
                  {canPay ? `OPEN THE ENVELOPES · $${price}` : `NOT ENOUGH FOR AN ENVELOPE · $${price}`}
                </span>
                <span
                  onClick={() => {
                    if (st.tsuiBound) { setNote("You asked them to handle Sanders. There is nothing left to testify to that does not end with you."); return; }
                    clear(); testify();
                  }}
                  style={{ ...disp, textAlign: "center", cursor: st.tsuiBound ? "default" : "pointer", fontSize: 13,
                           opacity: st.tsuiBound ? 0.45 : 1,
                           color: st.tsuiBound ? C.dim : C.green, border: `1px solid ${st.tsuiBound ? C.line : C.green}`, borderRadius: 9, padding: "8px 12px" }}
                >
                  {st.tsuiBound ? "YOU CANNOT TESTIFY" : "TESTIFY AGAINST THE FAMILY"}
                </span>
                <span
                  onClick={() => { clear(); setSpeed("play"); }}
                  style={{ ...mono, textAlign: "center", cursor: "pointer", fontSize: 10.5, color: C.dim, padding: "4px 0" }}
                >
                  RIDE IT OUT ✕
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the town in the street */}
      {show("protest") && (() => {
        const untilVote = TERM_DAYS - ((st.day - 1) % TERM_DAYS) - 1;
        const endsOn = st.day + untilVote;
        const decide = (stance) => (extra) => setSt((s) => ({ ...s, protest: stance, protestUntil: endsOn, ...extra }));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 12 }}>
            <div style={{ width: "min(90vw, 372px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>THEY ARE OUTSIDE CITY HALL</div>
              <div style={{ ...disp, fontSize: 20, marginBottom: 8 }}>LUCKHEAD IS PROTESTING</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>Three days of misery and the town has had enough. The crowd on the steps is chanting about harsh policing: stops, sweeps, and a department they say treats the town like a suspect. There is a bank of cameras, and no version of today where you say nothing.</p>
                <p style={{ margin: 0 }}>Whatever you choose holds until the next election{untilVote > 0 ? `, ${untilVote} day${untilVote === 1 ? "" : "s"} out` : ""}.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
                <span style={{ color: C.green }}>STAND WITH THEM</span> · you back the protesters against the tactics<br />
                {!(st.deadChiefs || []).includes("quietmilk") && (
                  <>· Quietmilk takes over the department, 15-day shakeup<br /></>
                )}
                · police, prisons, and cameras all lose 30% bite<br />
                <span style={{ color: C.red }}>CONDEMN THE CROWD</span> · you back the police&rsquo;s methods · they gain 25%<br />
                · and the town takes it out of your hide today
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
                <span
                  onClick={() => {
                    const outgoing = st.chiefId ? CHIEFS[st.chiefId] : null;
                    const canInstall = !(st.deadChiefs || []).includes("quietmilk");
                    setSt((s) => ({
                      ...s, protest: 2, protestUntil: endsOn,
                      ...(canInstall ? {
                        chiefId: "quietmilk",
                        vacancyReason: "",
                        chiefShake: s.chiefId ? s.day + CHIEF_SHAKE_DAYS : (s.chiefShake || 0),
                        pendingMonument: outgoing ? outgoing.name : (s.pendingMonument || null),
                      } : {}),
                    }));
                    setToast(canInstall
                      ? `✊ You stood with them, and Quietmilk takes the department.${outgoing ? ` ${outgoing.name} gets a park.` : ""}`
                      : "✊ You stood with them against the tactics. The chief did not applaud.");
                    setSpeed("play");
                  }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, background: C.green, color: C.ink, borderRadius: 9, padding: "8px 12px" }}
                >
                  STAND WITH THE PROTESTERS
                </span>
                <span
                  onClick={() => { decide(3)({ approval: Math.max(0, st.approval - 14) }); setToast("📢 You defended the department's tactics. The town took note."); setSpeed("play"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "8px 12px" }}
                >
                  CONDEMN THE PROTEST · −14 APPROVAL
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the teachers walk */}
      {show("strike") && (() => {
        const schoolCount = st.grid.filter((c) => c && c.type === "school" && !c.build).length;
        const nowUp = Math.round(BUILD.school.upkeep * (st.wageMul || 1));
        const thenUp = Math.round(BUILD.school.upkeep * (st.wageMul || 1) * STRIKE_RAISE);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 12 }}>
            <div style={{ width: "min(90vw, 372px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>NOBODY CROSSED THE LINE THIS MORNING</div>
              <div style={{ ...disp, fontSize: 20, marginBottom: 8 }}>THE TEACHERS ARE OUT</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>Luckhead&rsquo;s {schoolCount === 1 ? "school is" : `${schoolCount} schools are`} standing empty. The union wants a contract, and the parents want to know what you intend to do about it.</p>
                <p style={{ margin: 0 }}>You can pay them, or you can wait them out. Waiting is cheaper right up until it isn&rsquo;t.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
                <span style={{ color: C.green }}>RAISE WAGES</span> · schools reopen at once<br />
                <span style={{ ...mono, color: C.dim }}>· upkeep per school ${nowUp} &rarr; ${thenUp}, permanently</span><br />
                <span style={{ color: C.red }}>WAIT THEM OUT</span> · costs you nothing today<br />
                <span style={{ ...mono, color: C.dim }}>· schools closed {STRIKE_SHUT} days: no learning, no jobs, no calm</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
                <span
                  onClick={() => { setSt((x) => ({ ...x, strike: 2, strikeCool: x.day + STRIKE_COOL, wageMul: (x.wageMul || 1) * STRIKE_RAISE })); setToast("🍎 Contract signed. The classrooms fill back up, and so does the payroll."); setSpeed("play"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, background: C.green, color: C.ink, borderRadius: 9, padding: "8px 12px" }}
                >
                  RAISE WAGES
                </span>
                <span
                  onClick={() => { setSt((x) => ({ ...x, strike: 3, strikeUntil: x.day + STRIKE_SHUT, strikeCool: x.day + STRIKE_COOL })); setToast(`🏫 You said nothing. The schools stay dark for ${STRIKE_SHUT} days.`); setSpeed("play"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "8px 12px" }}
                >
                  WAIT THEM OUT
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the parents want a school */}
            {/* the police contract */}
      {show("cop") && (() => {
        const nowUp = Math.round(BUILD.police.upkeep * (st.copWage || 1));
        const thenUp = Math.round(BUILD.police.upkeep * (st.copWage || 1) * COP_RAISE);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 12 }}>
            <div style={{ width: "min(90vw, 368px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>THE UNION REP IS IN YOUR OFFICE</div>
              <div style={{ ...disp, fontSize: 20, marginBottom: 8 }}>THE POLICE WANT A RAISE</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>Every officer in Luckhead signed it. They want more money, and they have picked a week when you cannot afford trouble.</p>
                <p style={{ margin: 0 }}>Say no and the cars stay in the lot.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
                <span style={{ color: C.green }}>PAY THEM</span> · station upkeep ${nowUp} &rarr; ${thenUp}, permanently<br />
                <span style={{ color: C.red }}>REFUSE</span> · stations <em>and</em> cameras dark for {COP_SHUT} days
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
                <span onClick={() => { setSt((x) => ({ ...x, cop: 2, copCool: x.day + COP_COOL, copWage: (x.copWage || 1) * COP_RAISE })); setToast("🚓 Contract signed. The cars stay on the road."); setSpeed("play"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, background: C.green, color: C.ink, borderRadius: 9, padding: "8px 12px" }}>
                  PAY THE RAISE
                </span>
                <span onClick={() => { setSt((x) => ({ ...x, cop: 3, copUntil: x.day + COP_SHUT, copCool: x.day + COP_COOL })); setToast(`🚔 The department walked. Nobody is watching for ${COP_SHUT} days.`); setSpeed("play"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "8px 12px" }}>
                  REFUSE THEM
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the pulpit wants the curriculum */}
      {show("doctrine") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 12 }}>
          <div style={{ width: "min(90vw, 368px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>THE INTERFAITH COUNCIL, AGAIN</div>
            <div style={{ ...disp, fontSize: 20, marginBottom: 8 }}>DOCTRINE IN THE SCHOOLS</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>The council wants their teaching in every Luckhead classroom, and they would like your public backing for it.</p>
              <p style={{ margin: 0 }}>Refuse and you will hear about it every Sunday, from every pulpit in town.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
              <span style={{ color: C.amber }}>AGREE</span> · schools teach 40% less until a successor takes over<br />
              <span style={{ color: C.red }}>REFUSE</span> · condemned from the pulpit, worse with every church
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
              <span onClick={() => { setSt((x) => ({ ...x, doctrine: 3, doctrineCool: x.day + DOCTRINE_COOL })); setToast("⛪ The curriculum changes. Test scores will not thank you."); setSpeed("play"); }}
                style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, background: C.amber, color: C.ink, borderRadius: 9, padding: "8px 12px" }}>
                AGREE TO THE CURRICULUM
              </span>
              <span onClick={() => { setSt((x) => ({ ...x, doctrine: 4, doctrineCool: x.day + DOCTRINE_COOL })); setToast("📿 You said no. They have your name and a microphone."); setSpeed("play"); }}
                style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "8px 12px" }}>
                REFUSE THEM
              </span>
            </div>
          </div>
        </div>
      )}

      {/* approval slump: a plan, not just bad news */}
            {/* rough sleeping */}
            {/* a bad night */}
            {/* a building burns */}
      {show("arson") && (() => {
        const A = st.lastArson || {};
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 65, padding: 12 }}>
            <div style={{ width: "min(90vw, 372px)", background: C.panel, border: `2px solid ${C.red}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 44, textAlign: "center", lineHeight: 1, marginBottom: 6 }}>🔥</div>
              <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3, textAlign: "center" }}>THREE IN THE MORNING</div>
              <div style={{ ...disp, fontSize: 22, marginBottom: 10, textAlign: "center" }}>ARSON</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>The <b style={{ color: C.cream }}>{A.name}</b> is gone. It went up fast and it went up clean, and the fire marshal is not going to find anything, because there is nothing to find.</p>
                <p style={{ margin: 0 }}>{st.mafia === "refused"
                  ? "Vincent told you he would hate to see anything happen to this city. He was not making conversation."
                  : "Nobody in Luckhead needs to be told who did this."}</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.red, marginTop: 10, lineHeight: 1.6 }}>
                Tile cleared · rebuild at full price · {st.arsonCount} fire{st.arsonCount === 1 ? "" : "s"} so far
              </div>
              <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 8 }}>
                They stop when you come to terms with the family, and not before.
              </div>
              <div style={{ display: "flex", marginTop: 16 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => { setSt((x) => ({ ...x, arsonAck: 0 })); setSpeed("play"); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.red, color: C.cream, borderRadius: 9, padding: "7px 14px" }}>
                  SURVEY THE DAMAGE
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the river runs orange */}
      {/* the papers come back to it */}
            {/* the video */}
      {show("viral") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 12 }}>
          <div style={{ width: "min(90vw, 364px)", background: C.panel, border: `1px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
            <div style={{ fontSize: 40, textAlign: "center", lineHeight: 1, marginBottom: 4 }}>📹</div>
            <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3, textAlign: "center" }}>SOMEBODY HAD A PHONE OUT</div>
            <div style={{ ...disp, fontSize: 20, marginBottom: 8, textAlign: "center" }}>THE VIDEO</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>Forty seconds of you at Tommy&rsquo;s Hideaway, dancing, glassy-eyed, somewhere past two in the morning. It is on every phone in Luckhead by breakfast.</p>
              <p style={{ margin: 0 }}>Nobody can prove anything. Nobody needs to.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.red, marginTop: 10, lineHeight: 1.6 }}>
              Approval suffers until a successor takes over
              {st.fed === 1 ? " · and the Bureau is watching more closely now" : ""}
            </div>
            <div style={{ display: "flex", marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((x) => ({ ...x, viralAck: 0 })); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                IT WAS THE LIGHTING
              </span>
            </div>
          </div>
        </div>
      )}

      {/* the podium */}
      {show("speech") && (() => {
        const roofless = homelessRate(st.pop, d);
        const give = (key) => {
          const landed = Math.random() < PROMISE_ODDS;
          setSt((x) => ({
            ...x, speech: 2, promise: key, promiseDay: x.day, promiseSeq: x.seq,
            promiseBroken: 0, promiseKept: 0,
            approval: landed ? Math.min(100, x.approval + PROMISE_BOOST) : x.approval,
          }));
          setToast(landed
            ? `🎤 They loved it. +${PROMISE_BOOST} approval, and ${PROMISE_DAYS} days to make it true.`
            : `🎤 Polite applause. No bounce, and ${PROMISE_DAYS} days to make it true anyway.`);
          setSpeed("play");
        };
        const opt = (key, icon, title, body) => (
          <div onClick={() => give(key)}
            style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: "pointer",
                     background: "transparent", border: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15 }}>{icon}</span>
              <span style={{ ...disp, fontSize: 13, color: C.cream }}>{title}</span>
            </div>
            <div style={{ ...mono, fontSize: 9.5, lineHeight: 1.45, color: C.dim, marginTop: 4 }}>{body}</div>
          </div>
        );
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 12 }}>
            <div style={{ width: "min(90vw, 380px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.orange}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.orange, letterSpacing: "0.2em", marginBottom: 3 }}>TEN DAYS TO THE VOTE</div>
              <div style={{ ...disp, fontSize: 20, marginBottom: 8 }}>THE SPEECH</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>They have set up a podium outside City Hall and the whole town has turned out. You get one promise. Make it count.</p>
                <p style={{ margin: 0 }}>It might move the room and it might not, but either way Luckhead will hold you to it for {PROMISE_DAYS} days.</p>
              </div>
              <div style={{ ...mono, fontSize: 9.5, color: C.dim, margin: "10px 0 8px", lineHeight: 1.5 }}>
                Roughly even odds of a <span style={{ color: C.green }}>+{PROMISE_BOOST} approval</span> bounce ·
                breaking your word costs <span style={{ color: C.red }}>−{PROMISE_BROKEN}</span> until a successor takes over
              </div>
              {opt("housing", "🏠", "EVERY FAMILY GETS A ROOF",
                `Homelessness under 5% within ${PROMISE_DAYS} days. Right now it is ${Math.round(roofless * 100)}%.`)}
              {opt("nodev", "🏗️", "NO NEW DEVELOPMENT",
                `The city is growing faster than the infrastructure can carry. Not one new building for ${PROMISE_DAYS} days. Upgrades are still fair game.`)}
              {opt("power", "🔌", "A GRID THAT HOLDS",
                `Not a single power shortage for ${PROMISE_DAYS} days. One overloaded moment and the promise is gone.`)}
              <div
                onClick={() => { setSt((x) => ({ ...x, speech: 2 })); setToast("🎤 You skipped the podium. Nobody promises anything."); setSpeed("play"); }}
                style={{ ...mono, textAlign: "center", cursor: "pointer", fontSize: 10.5, color: C.dim, padding: "6px 0" }}>
                SAY NOTHING ✕
              </div>
            </div>
          </div>
        );
      })()}

      {/* the man with the very good suit */}
      {show("invest") && (() => {
        const ties = entanglements(st);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 12 }}>
            <div style={{ width: "min(90vw, 376px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>HE FLEW IN THIS MORNING</div>
              <div style={{ ...disp, fontSize: 20, marginBottom: 8 }}>FOREIGN INVESTMENT</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>He will build Luckhead a factory. Fully staffed, fully equipped, at no cost to the city, and he would like to break ground this week.</p>
                <p style={{ margin: "0 0 8px" }}>His holding company has been asked some pointed questions in three other countries. He is not asking you to answer them. He is asking you not to.</p>
                <p style={{ margin: 0 }}>A free factory is a free factory. It is also a name on a list.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
                <span style={{ color: C.green }}>TAKE THE DEAL</span> · a free Factory to place wherever you like<br />
                <span style={{ ...mono, color: C.red }}>· counts as a federal entanglement, permanently</span><br />
                <span style={{ ...mono, color: C.dim }}>· you have {ties} · {FED_TRIGGER} opens an investigation</span><br />
                <span style={{ color: C.cream }}>DECLINE</span> · costs you nothing but the factory
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
                <span
                  onClick={() => { setSt((x) => ({ ...x, invest: 2, investTook: 1, pendingFactory: 1, investCool: x.day + INVEST_COOL }));
                    setToast("🏭 He shakes your hand too long. Tap empty ground to site the factory."); setSpeed("play"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, background: C.green, color: C.ink, borderRadius: 9, padding: "8px 12px" }}
                >
                  TAKE THE DEAL
                </span>
                <span
                  onClick={() => { setSt((x) => ({ ...x, invest: 2, investCool: x.day + INVEST_COOL }));
                    setToast("🛩️ He is gracious about it. He always is."); setSpeed("play"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 12px" }}
                >
                  DECLINE
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {show("river") && (() => {
        const stacks = st.grid.filter((c) => c && c.type === "factory" && !c.build).length;
        const bill = 1000;
        const canPay = st.money >= bill;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 12 }}>
            <div style={{ width: "min(90vw, 372px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>THE STATE LAB CALLED FIRST</div>
              <div style={{ ...disp, fontSize: 20, marginBottom: 8 }}>THE RIVER RUNS ORANGE</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>The water below your {stacks} factor{stacks === 1 ? "y" : "ies"} has changed colour, and the lab has put a name to what is in it. The Sentinel already has a copy of the report. They are holding the front page for your comment.</p>
                <p style={{ margin: 0 }}>You can fix it, or you can make the report go away.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
                <span style={{ color: C.green }}>CLEAN IT UP</span> · ${bill}, and the stacks run at {Math.round(RIVER_RETRO_OUT * 100)}% for {RIVER_RETRO} days<br />
                <span style={{ ...mono, color: C.dim }}>· the district stays permanently cleaner, and the town remembers</span><br />
                <span style={{ color: C.red }}>BURY THE REPORT</span> · costs nothing today<br />
                <span style={{ ...mono, color: C.dim }}>· federal heat rises, it becomes one more thread for the Bureau,</span><br />
                <span style={{ ...mono, color: C.dim }}>· and it weighs on you more every week until a successor takes over</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
                <span
                  onClick={() => {
                    if (!canPay) { setNote(`The cleanup costs $${bill}. You do not have it.`); return; }
                    setSt((x) => ({ ...x, river: 2, money: x.money - bill,
                      riverUntil: x.day + RIVER_RETRO, riverCool: x.day + RIVER_COOL,
                      riversCleaned: (x.riversCleaned || 0) + 1,
                      approval: Math.max(0, x.approval - 4) }));
                    setToast("🌊 Crews are in the water by noon. The Sentinel runs it on page four.");
                    setSpeed("play");
                  }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13,
                           background: canPay ? C.green : C.line, color: C.ink, borderRadius: 9, padding: "8px 12px" }}
                >
                  {canPay ? `CLEAN IT UP · $${bill}` : `CANNOT AFFORD THE CLEANUP · $${bill}`}
                </span>
                <span
                  onClick={() => { setSt((x) => ({ ...x, river: 3, riverBuriedDay: x.day,
                      heat: Math.min(100, (x.heat || 0) + 14), riverCool: x.day + RIVER_COOL }));
                    setToast("🗞️ The report is in a drawer. Somebody, somewhere, kept a copy."); setSpeed("play"); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "8px 12px" }}
                >
                  BURY THE REPORT
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the ground gives way */}
            {show("ice") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
          <div style={{ width: "min(88vw, 360px)", background: C.panel, border: `1px solid ${C.cream}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.cream, letterSpacing: "0.2em", marginBottom: 3 }}>THE WHITE HOUSE, ON THE LINE</div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>A FEDERAL DEMAND</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>The President wants immigration officers working Luckhead's streets, and wants your public cooperation. The call is not really a request.</p>
              <p style={{ margin: 0 }}>Go along and the raids will empty your labor force and rattle the whole city. Refuse the President of the United States, and a very different set of federal officials will start reading your files.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.amber }}>ALLOW</span> · crime -{ICE_RAID_CRIME} for {ICE_RAID_DAYS} days, then nothing · immigration slows for good · commercial &amp; industrial revenue -15% · traffic up · approval hit<br />
              <span style={{ color: C.red }}>REFUSE</span> · a federal investigation opens against you
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, ice: 3, fed: s.fed === 0 ? 1 : s.fed, heat: s.fed === 0 ? Math.max(s.heat, 12) : s.heat, fedFavor: FED_FAVOR_MIN })); setToast("🚔 You told the President no. The Bureau opens a file."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "6px 10px" }}
              >
                REFUSE
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, ice: 2, iceUntil: s.day + ICE_RAID_DAYS, fedFavor: Math.min(FED_FAVOR_MAX, (s.fedFavor || 0) + 1) })); setToast("🚔 ICE moves into Luckhead. The city goes quiet and cold."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.cream, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                ALLOW THE RAIDS
              </span>
            </div>
          </div>
        </div>
      )}

      {/* the two of them fall out in public */}
      {/* the midnight call */}
      {show("votes") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 65, padding: 16 }}>
          <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3 }}>THE WHITE HOUSE, AFTER MIDNIGHT</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>THE MISSING VOTES</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              The President is on the line himself. His reelection bid has come up short, and he would like your help to "find" the missing votes he needs. He does not say how. He says he will remember who helped, and he says it twice.
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.amber }}>FIND THE VOTES</span> · federal immunity, forever · his friendship at its ceiling for the rest of the game · the town whispers: -3 approval, permanently<br />
              <span style={{ color: C.green }}>REFUSE HIM</span> · +2 approval, permanently · +1 with Governor Sanders · he cuts every federal dollar and opens an investigation into you personally
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, stolenVotes: 3, govRel: (s.govRel || 0) + 1,
                                       fedFavor: FED_FAVOR_MIN, fed: Math.max(1, s.fed || 0),
                                       heat: Math.min(100, (s.heat || 0) + 20), fedCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP }));
                                     setToast("\u260E\uFE0F You hang up. By morning, Washington has forgotten Luckhead exists, except for the subpoenas."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.green, color: C.ink, borderRadius: 9, padding: "7px 12px" }}>REFUSE HIM</span>
              <span onClick={() => { setSt((s) => ({ ...s, stolenVotes: 2, fedFavor: 3, fedCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP }));
                                     setToast("\u260E\uFE0F The votes are found. Nobody will ever look at Luckhead's books again."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "7px 12px" }}>FIND THE VOTES</span>
            </div>
          </div>
        </div>
      )}

      {/* the town wants regulations */}
      {show("eco") && (() => {
        const parksNow = st.grid.filter((c) => c && c.type === "park" && !c.build).length;
        const plants = st.grid.filter((c) => c && c.type === "plant" && !c.build).length;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
            <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.green}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.green, letterSpacing: "0.2em", marginBottom: 3 }}>A PACKED ROOM AT THE LIBRARY</div>
              <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>ECO PROTEST</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                Luckhead residents demand city environmental regulations. They have written their terms down, and they have given you a month.
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                <span style={{ color: C.green }}>ACCEPT THE DEMANDS</span> · within {ECO_PLEDGE_DAYS} days, every Power Plant on a Solar Retrofit ({plants} to convert) and {ECO_PARKS} new Parks ({parksNow} standing today). Keep it and the town remembers. Miss it and they take the streets angrier than if you had refused.<br />
                <span style={{ color: C.red }}>REFUSE</span> · {ECO_PROTEST_DAYS} days of protest. Approval down and every road jammed.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => { setSt((s) => ({ ...s, eco: 3, ecoUntil: s.day + ECO_PROTEST_DAYS,
                                         ecoCool: s.day + ECO_PROTEST_DAYS + ECO_COOL, modalGap: s.day + MODAL_GAP_SOFT }));
                                       setToast("\uD83E\uDEA7 You say no. They are outside City Hall by lunchtime."); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 12px" }}>REFUSE</span>
                <span onClick={() => { setSt((s) => ({ ...s, eco: 2, ecoUntil: s.day + ECO_PLEDGE_DAYS,
                                         ecoParks: s.grid.filter((c) => c && c.type === "park" && !c.build).length,
                                         modalGap: s.day + MODAL_GAP_SOFT }));
                                       setToast(`\uD83C\uDF3F You sign it. ${ECO_PLEDGE_DAYS} days to make it true.`); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.green, color: C.ink, borderRadius: 9, padding: "7px 12px" }}>ACCEPT THE DEMANDS</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the Governor's security friend */}
      {show("surv") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
          <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>A CALL FROM THE STATEHOUSE</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>A PRIVATE SURVEILLANCE PROPOSAL</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              A golfing buddy of Governor Sanders owns a private security company, and he is offering to front the cost of two surveillance Cameras for Luckhead. The Governor would consider it a personal courtesy.
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.green }}>ACCEPT THE CAMERAS</span> · two free Cameras to place · +1 standing with Sanders · public outcry: -2 approval for {SURV_OUTCRY_DAYS} days<br />
              <span style={{ color: C.red }}>DECLINE</span> · -1 standing with Sanders
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, surv: 3, govRel: (s.govRel || 0) - 1,
                                       survCool: s.day + SURV_COOL, govCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast("\uD83D\uDCF7 You pass. The Governor's friend will call again; his kind always do."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 12px" }}>DECLINE</span>
              <span onClick={() => { setSt((s) => ({ ...s, surv: 2, govRel: (s.govRel || 0) + 1,
                                       freeCameras: (s.freeCameras || 0) + 2,
                                       survOutcryUntil: s.day + SURV_OUTCRY_DAYS,
                                       survCool: s.day + 9999, govCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast("\uD83D\uDCF7 Two Cameras, on the firm's dime. The town has opinions about it."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.amber, color: C.ink, borderRadius: 9, padding: "7px 12px" }}>ACCEPT THE CAMERAS</span>
            </div>
          </div>
        </div>
      )}

      {/* the Governor wants a tee time */}
      {show("golf") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
          <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>A CALL FROM THE STATEHOUSE</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>THE GOVERNOR WANTS A TEE TIME</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              Governor Sanders golfs every Sunday, two counties over, and he is tired of the drive. He would like a course he can see from his porch: a Golf Course within {GOLF_NEAR} tiles of the Governor's Mansion, and he would like it inside {GOLF_DAYS} days.
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.green }}>PROMISE HIM THE COURSE</span> · deliver within {GOLF_DAYS} days for +2 standing (and the fatter state grant that follows). Fail and it is -3: worse than never promising.<br />
              <span style={{ color: C.red }}>TELL HIM TO KEEP DRIVING</span> · -1 standing, and the subject is closed.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, golfAsk: 5, govRel: (s.govRel || 0) - 1, govCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast("⛳ You pass. Sanders takes it about as well as he takes a double bogey."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 12px" }}>TELL HIM TO KEEP DRIVING</span>
              <span onClick={() => { setSt((s) => ({ ...s, golfAsk: 2, golfUntil: s.day + GOLF_DAYS, govCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast(`⛳ Promised. ${GOLF_DAYS} days to break ground within sight of his porch.`); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.amber, color: C.ink, borderRadius: 9, padding: "7px 12px" }}>PROMISE HIM THE COURSE</span>
            </div>
          </div>
        </div>
      )}

      {/* the Governor asks a personal favour */}
      {show("marla") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
          <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>A CALL FROM THE STATEHOUSE</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>A PERSONAL FAVOUR</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              Governor Sanders and Marla Krauthammer frequently socialize. This is known to insiders and unknown to Mrs. Sanders. The Governor is now asking that you hire her for communications director.
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.green }}>HIRE HER</span> · +2 with Sanders · no signing fee · she cannot be replaced until a successor takes office<br />
              <span style={{ color: C.red }}>DECLINE</span> · -2 with Sanders
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, marla: 3, govRel: (s.govRel || 0) - 2,
                                       marlaCool: s.day + 400, govCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast("\uD83D\uDCBC You pass. The statehouse is briefly, coldly polite."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 12px" }}>DECLINE</span>
              <span onClick={() => { setSt((s) => ({ ...s, marla: 2, govRel: (s.govRel || 0) + 2,
                                       commsId: "krauthammer", commsLocked: 1, govCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast("\uD83D\uDCBC Marla Krauthammer starts Monday. Sanders is delighted."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.amber, color: C.ink, borderRadius: 9, padding: "7px 12px" }}>HIRE HER</span>
            </div>
          </div>
        </div>
      )}

      {/* the President wants the stadium */}
      {show("rally") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
          <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.cream}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.cream, letterSpacing: "0.2em", marginBottom: 3 }}>ADVANCE TEAM, WASHINGTON</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>A STAGE AT LUCKHEAD STADIUM</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              The President intends to announce his reelection campaign, and his people have chosen Luckhead Stadium for it. They need the permits, the road closures and the parking, and they need them this week.
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.green }}>GRANT THE PERMITS</span> · federal standing up sharply · -4 approval until your successor takes office<br />
              <span style={{ color: C.amber }}>DENY, PUBLICLY</span> · federal standing down · +3 approval until your successor takes office
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, rally: 3, fedFavor: Math.max(FED_FAVOR_MIN, (s.fedFavor || 0) - 1),
                                       fedCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast("\uD83C\uDDFA\uD83C\uDDF8 You say no on camera. Luckhead enjoys that a great deal."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 12px" }}>DENY, PUBLICLY</span>
              <span onClick={() => { setSt((s) => { const cap = fedComplete(s) ? 3 : FED_FAVOR_MAX;
                                       return { ...s, rally: 2, fedFavor: Math.min(cap, (s.fedFavor || 0) + 2), fedCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }; });
                                     setToast("\uD83C\uDDFA\uD83C\uDDF8 Motorcades, bunting, helicopters. Washington will not forget it."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.cream, color: C.ink, borderRadius: 9, padding: "7px 12px" }}>GRANT THE PERMITS</span>
            </div>
          </div>
        </div>
      )}

      {/* the President has opinions about your town */}
      {show("slander") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
          <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3 }}>REPORTERS ON THE CITY HALL STEPS</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>THE PRESIDENT CALLED LUCKHEAD FILTHY</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              The President has been telling rallies that Luckhead is a filthy, crime ridden city that nobody in their right mind would visit. Reporters outside City Hall want your reaction, and they want it now.
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.cream }}>HE IS RIGHT</span> · federal standing up · every beat in the city works {Math.round((1 - SLANDER_MORALE) * 100)}% worse for {SLANDER_DAYS} days<br />
              <span style={{ color: C.green }}>HE IS WRONG</span> · federal standing down · +4 approval for {SLANDER_DAYS} days
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => { const cap = fedComplete(s) ? 3 : FED_FAVOR_MAX;
                                       return { ...s, slander: 2, slanderUntil: s.day + SLANDER_DAYS, slanderCool: s.day + SLANDER_COOL,
                                                fedFavor: Math.min(cap, (s.fedFavor || 0) + 1), fedCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }; });
                                     setToast("\uD83D\uDDDE\uFE0F You agree with him. The department reads it in the morning paper."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 12px" }}>HE IS RIGHT</span>
              <span onClick={() => { setSt((s) => ({ ...s, slander: 3, slanderUntil: s.day + SLANDER_DAYS, slanderCool: s.day + SLANDER_COOL,
                                       fedFavor: Math.max(FED_FAVOR_MIN, (s.fedFavor || 0) - 1), fedCircleCool: s.day + POL_CIRCLE_GAP, modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast("\uD83D\uDDDE\uFE0F You defend the town by name. Luckhead notices."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.green, color: C.ink, borderRadius: 9, padding: "7px 12px" }}>HE IS WRONG</span>
            </div>
          </div>
        </div>
      )}

      {/* the feud */}
      {show("feud") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
          <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>REPORTERS ON THE CITY HALL STEPS</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>THE PRESIDENT AND THE GOVERNOR ARE FIGHTING</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              Washington and the statehouse have been trading insults in public for a week, and reporters outside City Hall want to know which one Luckhead stands behind.
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.cream }}>STAND WITH THE PRESIDENT</span> · federal standing up · one federal entanglement disappears · -1 with Sanders<br />
              <span style={{ color: C.cream }}>STAND WITH THE GOVERNOR</span> · +2 with Sanders · federal standing down
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, feud: 2, govRel: (s.govRel || 0) + 2,
                                       fedFavor: Math.max(FED_FAVOR_MIN, (s.fedFavor || 0) - 1),
                                       govCircleCool: s.day + POL_CIRCLE_GAP, fedCircleCool: s.day + POL_CIRCLE_GAP,
                                       modalGap: s.day + MODAL_GAP_SOFT }));
                                     setToast("\uD83C\uDFDB\uFE0F You back Sanders. Washington notes it."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 12px" }}>THE GOVERNOR</span>
              <span onClick={() => { setSt((s) => {
                       const n = { ...s, feud: 2, govRel: (s.govRel || 0) - 1,
                                   fedFavor: Math.min(FED_FAVOR_MAX, (s.fedFavor || 0) + 1),
                                   govCircleCool: s.day + POL_CIRCLE_GAP, fedCircleCool: s.day + POL_CIRCLE_GAP,
                                   modalGap: s.day + MODAL_GAP_SOFT };
                       // one entanglement, whichever is nearest to hand
                       if (n.rigged) n.rigged = Math.max(0, n.rigged - 1);
                       else if (n.backroom) n.backroom = false;
                       else if (n.investTook) n.investTook = 0;
                       else if (n.smuggleOffer === 3) { n.smuggleOffer = 0; n.grid = s.grid.map((c) => (c && c.smuggle ? { ...c, smuggle: false } : c)); }
                       else if (n.river === 3) n.river = 0;
                       return n;
                     });
                     setToast("\uD83C\uDDFA\uD83C\uDDF8 You back the President. A file gets thinner overnight."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.amber, color: C.ink, borderRadius: 9, padding: "7px 12px" }}>THE PRESIDENT</span>
            </div>
          </div>
        </div>
      )}

      {/* the education audit */}
      {show("audit") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
          <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${st.schoolNotice === 1 ? C.red : C.green}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: st.schoolNotice === 1 ? C.red : C.green, letterSpacing: "0.2em", marginBottom: 3 }}>
              {st.schoolNotice === 1 ? "A LETTER FROM THE DEPARTMENT" : "THE AUDIT IS CLOSED"}
            </div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>
              {st.schoolNotice === 1 ? "THE STATE PULLS LUCKHEAD'S FUNDING" : "FEDERAL FUNDING RESUMES"}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              {st.schoolNotice === 1
                ? "A federal education audit has found that Luckhead's schools do not reach the town's children and are not staffed to do it if they did. Every federal dollar stops until that changes."
                : "The auditors have been back. Luckhead's schools now reach its children and have the teachers to teach them. The federal line is restored from today."}
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
              The standard is {Math.round(SCHOOL_AUDIT_FRAC * 100)}% of homes inside a school's reach, with every school fully staffed.
            </div>
            <div style={{ display: "flex", marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => setSt((s) => ({ ...s, schoolNotice: 0, modalGap: s.day + MODAL_GAP }))}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "7px 14px" }}>UNDERSTOOD</span>
            </div>
          </div>
        </div>
      )}

      {/* the President has a preferred attorney */}
      {show("potus") && (() => {
        const cur = LAWYERS[st.lawyerId];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
            <div style={{ width: "min(88vw, 362px)", background: C.panel, border: `1px solid ${C.cream}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.2em", marginBottom: 3 }}>THE WHITE HOUSE, ON THE LINE</div>
              <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>THE PRESIDENT LIKES NANCY NACE</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 8px" }}>The President has been following Luckhead's difficulties and wants you to know he is a tremendous admirer of Nancy Nace. Enormous fan. Watched her work for years.</p>
                <p style={{ margin: 0 }}>Put her on the city's payroll for good and the file goes away this afternoon. Whatever you have arranged with the Tsuis is your business and stays your business. Keep {cur ? cur.name : "your own counsel"} and he will find the money for Luckhead's grant somewhere more appreciative.</p>
              </div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                <span style={{ color: C.green }}>APPOINT NACE</span> · the file is closed and the heat wiped · everything the Bureau could prove goes away, but the family stays where it is · she is your attorney permanently and cannot be replaced<br />
                <span style={{ color: C.amber }}>KEEP YOUR COUNSEL</span> · the grant stops today
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => { setSt((s) => ({ ...s, potus: 2, fedFavor: FED_FAVOR_MIN, modalGap: s.day + MODAL_GAP }));
                                       setToast("\uD83C\uDDFA\uD83C\uDDF8 You keep your lawyer. Luckhead's federal grant is not renewed."); }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 13px" }}>KEEP YOUR COUNSEL</span>
                <span onClick={() => {
                    setSt((s) => {
                      const grid = s.grid.map((c) => (c && c.smuggle ? { ...c, smuggle: false } : c));
                      const cap = fedComplete({ ...s, lawyerLocked: 1 }) ? 3 : FED_FAVOR_MAX;
                      return { ...s, potus: 2, lawyerId: "nace", lawyerFrom: s.day, lawyerLocked: 1,
                               grid, fed: 0, heat: 0, rigged: 0, backroom: false, smuggleOffer: 0,
                               investTook: 0, tsuiBound: 0, fedFavor: Math.min(cap, (s.fedFavor || 0) + 1),
                               modalGap: s.day + MODAL_GAP };
                    });
                    setToast("\uD83C\uDDFA\uD83C\uDDF8 Nancy Nace is sworn in. The file is gone by dinner.");
                  }}
                  style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.green, color: C.ink, borderRadius: 9, padding: "7px 13px" }}>APPOINT NACE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the family offers to handle the governor */}
      {show("hush") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 64, padding: 16 }}>
          <div style={{ width: "min(88vw, 360px)", background: C.panel, border: `1px solid ${C.red}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.red, letterSpacing: "0.2em", marginBottom: 3 }}>VINCENT TSUI CALLS AT NIGHT</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>THEY CAN QUIET SANDERS</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>The family has watched the governor spend money against you and finds it disrespectful. Vincent says the problem can be made to go away. He does not say how, and he is careful not to be asked.</p>
              <p style={{ margin: 0 }}>What he wants in return is not money. He wants it understood that Luckhead belongs to them, permanently, and that no mayor of this town will ever sit in front of a grand jury.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.red }}>LET THEM HANDLE IT</span> · Sanders stops funding your rival · you can never testify · a federal entanglement, and the file grows faster while one is open · only a successor undoes it<br />
              <span style={{ color: C.green }}>REFUSE</span> · the governor keeps paying, and you keep your options
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, tsuiHush: 2, modalGap: s.day + MODAL_GAP })); setToast("\uD83D\uDD4A\uFE0F You send Vincent home. Sanders keeps writing cheques."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 13px" }}>REFUSE</span>
              <span onClick={() => { setSt((s) => ({ ...s, tsuiHush: 2, tsuiBound: 1, ties: (s.ties || 0) + 1, modalGap: s.day + MODAL_GAP }));
                                     setToast("\uD83D\uDD74\uFE0F The governor's office goes quiet. Luckhead belongs to the family now."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.red, color: C.cream, borderRadius: 9, padding: "7px 13px" }}>LET THEM HANDLE IT</span>
            </div>
          </div>
        </div>
      )}

      {/* City Hall mentions the empty desks, once */}
      {show("staff") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 16 }}>
          <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.cream}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.2em", marginBottom: 3 }}>THE DESKS DOWN THE HALL</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>YOUR OWN PEOPLE</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              Replacing current staff with your own people could be advantageous to your goals. Both positions can be filled at City Hall.
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.cream }}>CITY ATTORNEY</span> &middot; handles what arrives in envelopes<br />
              <span style={{ color: C.cream }}>COMMUNICATIONS</span> &middot; decides how Luckhead sounds when it speaks<br />
              Each wants a wage every day, and a fee to change your mind later.
            </div>
            <div style={{ display: "flex", marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, staffOffer: 2, modalGap: s.day + MODAL_GAP_SOFT })); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "7px 14px" }}>UNDERSTOOD</span>
            </div>
          </div>
        </div>
      )}

      {/* the statehouse opens with a request for a house */}
      {show("govask") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 16 }}>
          <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.cream}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.2em", marginBottom: 3 }}>A LETTER FROM THE STATEHOUSE</div>
            <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>THE GOVERNOR WANTS A HOUSE</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>Governor Sonny Sanders has no particular affection for city government, but he has an eye for towns that make themselves useful. He would like a residence in Luckhead. At Luckhead's expense, naturally.</p>
              <p style={{ margin: 0 }}>Build it and his office will be in touch. Leave it unbuilt and he will draw his own conclusions.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.amber, marginTop: 8, lineHeight: 1.5 }}>
              The Governor's Mansion is now available to build. Sanders will wait about {GOV_DEADLINE} days for it.
            </div>
            <div style={{ display: "flex", marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { setSt((s) => ({ ...s, govAsk: 2, modalGap: s.day + MODAL_GAP })); setToast("\uD83C\uDFDB\uFE0F The Governor's Mansion is available to build."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "7px 14px" }}>UNDERSTOOD</span>
            </div>
          </div>
        </div>
      )}

      {/* the statehouse: three asks and a reckoning */}
      {show("gov") && (() => {
        const stage = st.govStage || 0;
        const doubt = Math.floor((st.graft || 0) / GOV_GRAFT_PER_DOUBT);
        const standing = (st.govRel || 0) - doubt;
        const close = (patch, msg) => {
          setSt((s) => {
            // The developer's block is no longer dropped on the map for the
            // mayor. It rides on the House button until there is somewhere
            // worth putting it.
            const p = { ...patch };
            return { ...s, govPending: 0, govStage: (s.govStage || 0) + 1, modalGap: s.day + MODAL_GAP, ...p };
          });
          if (msg) setToast(msg);
        };
        const ASKS = [
          { tag: "A LETTER FROM THE STATEHOUSE",
            title: "THE GOVERNOR WANTS A PHOTO",
            body: "Governor Sonny Sanders is coming through the district and would like to be photographed shaking your hand outside City Hall. The state keeps $600 in a discretionary fund for towns that cooperate.",
            yes: { label: "DO THE PHOTO OP", note: "$600 now, +1 standing, -4 approval for a handshake with an unpopular Governor.",
                   patch: (s) => ({ govRel: (s.govRel || 0) + 1, money: s.money + 600, approval: Math.max(0, s.approval - 4) }),
                   toast: "\uD83C\uDFDB\uFE0F Six hundred dollars and a photograph nobody in Luckhead wanted." },
            no:  { label: "DECLINE", note: "Nothing gained, -1 standing.",
                   patch: (s) => ({ govRel: (s.govRel || 0) - 1 }),
                   toast: "\uD83C\uDFDB\uFE0F You send regrets. The statehouse files the letter." } },
          { tag: "A DEVELOPER ON THE GOVERNOR'S FOURSOME",
            title: "THE GOVERNOR'S GOLFING BUDDY",
            body: "A developer who golfs with Sonny Sanders would like to put up another apartment complex, on roads that are already crowded. He would like your assistance in making it a smooth process, and a fee-free one.",
            yes: { label: "WAVE IT THROUGH", note: "Your next House is free and goes up as finished Apartments. +1 standing. Traffic rises for good.",
                   patch: (s) => ({ govRel: (s.govRel || 0) + 1, govTraffic: 1.1, freeApartment: 1 }),
                   toast: "\uD83C\uDFDB\uFE0F The permits clear in a week. Eighteen more front doors on the same road." },
            no:  { label: "MAKE HIM PAY", note: "+3 approval, -1 standing. The rules hold.",
                   patch: (s) => ({ govRel: (s.govRel || 0) - 1, approval: Math.min(100, s.approval + 3) }),
                   toast: "\uD83C\uDFDB\uFE0F He pays the fees like everyone else. Luckhead approves." } },
          { tag: "AN INVITATION TO THE PRAYER BREAKFAST",
            title: "THE STATE PRAYER BREAKFAST",
            body: "Sanders wants the annual state prayer breakfast held in Luckhead, at Luckhead's expense. Every camera in the district will be there, and so will every congregation in town.",
            yes: { label: "HOST IT ($700)", note: "+1 standing. Every Church works 10% better for " + GOV_BREAKFAST_DAYS + " days.",
                   patch: (s) => ({ govRel: (s.govRel || 0) + 1, money: s.money - 700,
                                    churchGov: 1.1, churchGovUntil: s.day + GOV_BREAKFAST_DAYS }),
                   toast: "\uD83C\uDFDB\uFE0F A full hall and a good photograph. The pews are busy for months." },
            no:  { label: "DECLINE", note: "Keep the $700. -1 standing. Every Church works 15% worse for " + GOV_BREAKFAST_DAYS + " days.",
                   patch: (s) => ({ govRel: (s.govRel || 0) - 1,
                                    churchGov: 0.85, churchGovUntil: s.day + GOV_BREAKFAST_DAYS }),
                   toast: "\uD83C\uDFDB\uFE0F The breakfast is held two counties over. Word gets round the parishes." } },
        ];
        const btn = (bg, fg) => ({ ...disp, cursor: "pointer", fontSize: 12.5, background: bg, color: fg, borderRadius: 9, padding: "7px 13px" });

        if (stage < ASKS.length) {
          const A = ASKS[stage];
          const canPay = A.yes.label.indexOf("$700") < 0 || st.money >= 700;
          return (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 16 }}>
              <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.cream}`, borderRadius: 16, padding: 18 }}>
                <div style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.2em", marginBottom: 3 }}>{A.tag}</div>
                <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>{A.title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>{A.body}</div>
                {doubt > 0 && (
                  <div style={{ ...mono, fontSize: 10, color: C.amber, marginTop: 8, lineHeight: 1.5 }}>
                    He has heard where some of Luckhead's money comes from. Whatever you decide today, he will trust you less than he otherwise would. Breaking with the family and testifying against them would put most of it behind you.
                  </div>
                )}
                <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                  <span style={{ color: C.green }}>{A.yes.label}</span> · {A.yes.note}<br />
                  <span style={{ color: C.amber }}>{A.no.label}</span> · {A.no.note}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <span style={{ flex: 1 }} />
                  <span onClick={() => { const p = A.no.patch(st); close(p, A.no.toast); }}
                    style={btn("transparent", C.cream)}>{A.no.label}</span>
                  <span onClick={() => {
                      if (!canPay) { setNote("Luckhead cannot afford to host it."); return; }
                      const p = A.yes.patch(st);
                      const yesNow = (st.govYes || 0) + 1;
                      p.govYes = yesNow;
                      const earned = yesNow === ASKS.length;
                      if (earned) p.freeLandmark = 1;
                      close(p, earned ? "\uD83C\uDFDB\uFE0F The statehouse will cover Luckhead's next landmark in full. Build it whenever you like."
                                       : A.yes.toast);
                    }}
                    style={btn(canPay ? C.green : C.line, canPay ? C.ink : C.dim)}>{A.yes.label}</span>
                </div>
              </div>
            </div>
          );
        }

        // The reckoning. Standing is what he thinks of you, less what he has
        // heard about the family's money.
        if (standing >= 2) {
          return (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 16 }}>
              <div style={{ width: "min(90vw, 366px)", background: C.panel, border: `1px solid ${C.green}`, borderRadius: 16, padding: 18 }}>
                <div style={{ ...mono, fontSize: 10, color: C.green, letterSpacing: "0.2em", marginBottom: 3 }}>THE STATEHOUSE PAYS ITS DEBTS</div>
                <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>NAME YOUR PROJECT</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim, marginBottom: 12 }}>
                  Governor Sanders has a discretionary fund and a short list of towns he trusts with it. Luckhead is on the list. He will do one thing for you, and he would like you to choose it yourself.
                </div>
                {[
                  ["A STATE GRANT", "$2,500 into the treasury, no conditions anyone will write down.",
                    (s) => ({ money: s.money + 2500 }), "\uD83C\uDFDB\uFE0F Twenty-five hundred dollars, and no paperwork worth the name."],
                  ["THE STATE'S PROTECTION", "Federal heat wiped, and the file builds far slower from here.",
                    (s) => ({ heat: 0, govShield: 1 }), "\uD83C\uDFDB\uFE0F The file goes quiet. Somebody made a call."],
                  ["A STATE HIGHWAY PROJECT", "Trade rises 15% for good and the town grows into it.",
                    (s) => ({ govTrade: Math.max(s.govTrade || 1, 1.15), pop: s.pop + 6 }), "\uD83C\uDFDB\uFE0F Ground breaks within the month. Luckhead is on the map."],
                ].map(([label, note, patch, toast]) => (
                  <div key={label} onClick={() => close(patch(st), toast)}
                    style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: "pointer",
                             border: `1px solid ${C.line}`, background: "transparent" }}>
                    <div style={{ ...disp, fontSize: 13, color: C.green }}>{label}</div>
                    <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 2 }}>{note}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        const hostile = standing <= -1;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 16 }}>
            <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${hostile ? C.red : C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...mono, fontSize: 10, color: hostile ? C.red : C.dim, letterSpacing: "0.2em", marginBottom: 3 }}>FROM THE STATEHOUSE</div>
              <div style={{ ...disp, fontSize: 17, marginBottom: 10 }}>
                {hostile ? "HE HAS FOUND SOMEBODY ELSE" : "NO HARD FEELINGS"}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                {hostile
                  ? (st.govAsk === 4
                      ? "The house was never built and the letters stopped coming. Governor Sanders has decided Luckhead needs new leadership, and he is willing to pay for it. Your next opponent will have money you cannot match and a friend in the capitol."
                      : "Governor Sanders has decided Luckhead needs new leadership, and he is willing to pay for it. Your next opponent will have money you cannot match and a friend in the capitol.")
                  : "The governor's office thanks you for your time and wishes the city well. Nothing more is offered and nothing more is expected."}
              </div>
              {hostile && (
                <div style={{ ...mono, fontSize: 10, color: C.red, marginTop: 8 }}>
                  Approval bleeds {GOV_BACKING_DRAG} a day for as long as he is funding your rival.
                </div>
              )}
              <div style={{ display: "flex", marginTop: 14 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => close(hostile ? { govBacked: 1 } : {},
                        hostile ? "\uD83C\uDFDB\uFE0F The governor is funding your opponent." : null)}
                  style={btn(C.orange, C.ink)}>UNDERSTOOD</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the family's emergency loan, offered once when the treasury runs dry */}
      {show("tsuiloan") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63, padding: 16 }}>
          <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>A CAR OUTSIDE CITY HALL</div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>THE FAMILY HEARD YOU WERE SHORT</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>Somebody has been reading Luckhead's books, and it was not the auditor. A man you have never met offers ${TSUI_LOAN_AMOUNT.toLocaleString()} in cash, today, no paperwork.</p>
              <p style={{ margin: 0 }}>He asks only that the police run on a shoestring for the next {TSUI_LOAN_DAYS} days. Fewer officers on the street, he says, is simply good economy.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.amber }}>TAKE IT</span> · ${TSUI_LOAN_AMOUNT.toLocaleString()} now · police locked to Shoestring for {TSUI_LOAN_DAYS} days · counts against your legacy · the Bureau counts it as an arrangement, permanently<br />
              <span style={{ color: C.green }}>REFUSE</span> · the treasury stays empty and the streets stay yours
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, tsuiLoan: 3, tsuiLoanCool: s.day + TSUI_LOAN_COOL, modalGap: s.day + MODAL_GAP })); setToast("\uD83D\uDE97 You sent him away. The books stay empty and honest."); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: "transparent", color: C.cream, border: `1px solid ${C.line}`, borderRadius: 10, padding: "7px 14px" }}
              >REFUSE</span>
              <span
                onClick={() => { setSt((s) => ({ ...s, tsuiLoan: 2, tsuiLoanUntil: s.day + TSUI_LOAN_DAYS, fund: "lean",
                                                 tsuiLoanTook: 1, tsuiLoanCool: s.day + TSUI_LOAN_COOL,
                                                 money: s.money + TSUI_LOAN_AMOUNT, graft: (s.graft || 0) + TSUI_LOAN_AMOUNT,
                                                 modalGap: s.day + MODAL_GAP }));
                                 setToast(`🚗 $${TSUI_LOAN_AMOUNT.toLocaleString()} in the treasury. The night shift is cancelled.`); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.amber, color: C.ink, borderRadius: 10, padding: "7px 14px" }}
              >TAKE IT</span>
            </div>
          </div>
        </div>
      )}

      {/* Tsui blackmail after the first successor */}
      {show("blackmail") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
          <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>A PLAIN ENVELOPE, NO STAMP</div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>THE FAMILY REMEMBERS</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>The Tsuis have photographs, or say they do, from before the handover. They would hate for the new administration to inherit a scandal.</p>
              <p style={{ margin: 0 }}>Five thousand dollars makes it go away. Refuse, and they will find other ways to keep you busy.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.amber }}>PAY $2,000</span> · the photographs disappear<br />
              <span style={{ color: C.red }}>REFUSE</span> · crime climbs hard, and they spend a month smearing you
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, blackmail: 3, crime: Math.min(100, s.crime + 22), blackmailUntil: s.day + 30 })); setToast("🚨 You told them to go to hell. They get to work, and they get loud about it."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "6px 10px" }}
              >
                REFUSE
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { if (st.money < 2000) { setNote("You do not have $2,000 to give them."); return; } setSt((s) => ({ ...s, blackmail: 2, money: s.money - 2000 })); setToast("🤝 The envelope is collected. The photographs are gone."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: st.money < 2000 ? C.line : C.amber, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                PAY $2,000
              </span>
            </div>
          </div>
        </div>
      )}

      {/* the bust at the Luckhead */}
      {show("bust") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
          <div style={{ width: "min(88vw, 356px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...mono, fontSize: 10, color: C.amber, letterSpacing: "0.2em", marginBottom: 3 }}>BREAKING, EVERYWHERE</div>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>BUSTED AT THE LUCKHEAD</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>A beloved local rapper was caught backstage at the Luckhead Theatre with a quantity of contraband the police report describes as "commercial." Half the town wants him freed by morning. The other half wants a statement.</p>
              <p style={{ margin: 0 }}>Either way, it is your name in the story.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ color: C.amber }}>PARDON</span> · +5 approval · Theatre sells 5% better forever · crime spikes for 30 days<br />
              <span style={{ color: C.green }}>ARREST</span> · Prisons and Police 10% more effective, permanently
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, bust: 2 })); setToast("⚖️ The perp walk ran on every channel. The chief approves."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 10px" }}
              >
                ARREST
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, bust: 3, bustUntil: s.day + 30, crime: Math.min(100, s.crime + 15), approval: Math.min(100, s.approval + 5) })); setToast("🎤 Pardoned. The show goes on, and so does everything else."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.amber, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                PARDON
              </span>
            </div>
          </div>
        </div>
      )}

      {/* backroom entertainment */}
      {show("venue") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
          <div style={{ width: "min(88vw, 352px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18, marginBottom: 4 }}>AFTER THE LAST SET</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.amber, marginBottom: 10 }}>Vincent Tsui, by the stage door</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>Vincent has been to every show that week. He would like the room after closing, for entertainment the town has no license to host.</p>
              <p style={{ margin: 0 }}>Ten dollars a day, quietly. Crime rises a little, and it stays risen.</p>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.red, marginTop: 8 }}>+$10/day · +2 crime pressure, permanently</div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, venueOffer: 2 })); setToast("🎸 The venue closes at closing time."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 10px" }}
              >
                LIGHTS OUT
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, venueOffer: 3, backroom: true, crime: Math.min(100, s.crime + 5) })); setToast("🎸 The back room stays open. +$10 a day."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.amber, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                HAND HIM THE KEYS
              </span>
            </div>
          </div>
        </div>
      )}

      {/* smuggling offer */}
      {show("smuggle") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 63 }}>
          <div style={{ width: "min(88vw, 352px)", background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18, marginBottom: 4 }}>A BUSINESS PROPOSAL</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.amber, marginBottom: 10 }}>Vincent Tsui, informally</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
              <p style={{ margin: "0 0 8px" }}>Now that Luckhead has a second factory, the Tsui family would like to run certain goods through it. Nothing you would need to see.</p>
              <p style={{ margin: 0 }}>Every factory in town doubles its output. Crime rises sharply and permanently, and the arrangement ends only when the family does.</p>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, smuggleOffer: 2 })); setToast("🏭 You told Vincent the factories run clean."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 10px" }}
              >
                KEEP IT CLEAN
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => {
                  setSt((s) => {
                    const grid = s.grid.map((c) => (c && c.type === "factory" ? { ...c, smuggle: true } : c));
                    return { ...s, grid, smuggleOffer: 3, crime: Math.min(100, s.crime + 12) };
                  });
                  setToast("🏭 The night shift is not on any payroll. Output doubled.");
                  setSpeed("play");
                }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.amber, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                OPEN THE DOORS
              </span>
            </div>
          </div>
        </div>
      )}

      {/* envelopes */}
      {bribePanel && (() => {
        const price = bribeCost(st.bribes, d.bankCount);
        const canPay = st.money >= price;
        const pay = (kind) => {
          if (!canPay) { setNote(`Not enough in the treasury. That envelope costs $${price}.`); return; }
          let caught = false;
          setSt((x) => {
            const n = { ...x, money: x.money - price, bribes: (x.bribes || 0) + 1,
              bribeStain: [...(x.bribeStain || []), x.day + 90] };
            if (kind === "fed") n.heat = Math.round(x.heat * 0.5);
            if (kind === "local") n.bribeLocal = [...(x.bribeLocal || []), x.day + 30];
            if (kind === "trade") n.bribeTrade = [...(x.bribeTrade || []), x.day + 90];
            // Paying anyone but the Bureau leaves a trail, and each envelope
            // after the first leaves a wider one.
            if (kind !== "fed") n.heat = Math.min(100, (n.heat || 0) + 4 + 2 * (x.bribes || 0));
            // Passing an envelope is itself a risk: a 1-in-5 chance it puts you
            // on the Bureau's radar, if they were not already watching.
            if ((x.fed || 0) === 0 && Math.random() < 0.2) { n.fed = 1; n.heat = Math.max(n.heat || 0, 15); caught = true; }
            return n;
          });
          setToast(caught
            ? `✉️ Delivered, but someone was watching. The Bureau opens a file.`
            : `✉️ Delivered. $${price} left the treasury and nobody wrote it down.`);
        };
        return (
          <div onClick={() => setBribePanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 384px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>ENVELOPES</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>
                ${price} each · rises ${BRIBE_STEP} every time · every envelope costs 4 approval for 90 days
                {d.bankCount ? ` · banks shave ${5 * d.bankCount}%` : ""}
              </div>
              {Object.keys(BRIBES).map((k) => {
                const b = BRIBES[k];
                return (
                  <div key={k} onClick={() => pay(k)}
                    style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: canPay ? "pointer" : "not-allowed",
                             opacity: canPay ? 1 : 0.45, border: `1px solid ${C.line}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{b.icon}</span>
                      <span style={{ ...disp, fontSize: 14, color: C.cream }}>{b.name}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ ...mono, fontSize: 10.5, color: canPay ? C.orange : C.red }}>${price}</span>
                    </div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.4, color: C.dim, marginTop: 4 }}>{b.blurb}</div>
                    {k === "fed" && <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 4 }}>current heat {Math.round(st.heat)} → {Math.round(st.heat * 0.5)}</div>}
                  </div>
                );
              })}
              <div style={{ display: "flex", marginTop: 6 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setBribePanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>DONE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* police chief */}
      {(chiefPanel || mustPickChief) && (() => {
        const shakeLeft = Math.max(0, (st.chiefShake || 0) - st.day);
        return (
          <div onClick={() => { if (!mustPickChief) setChiefPanel(false); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: mustPickChief ? 66 : 55, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 384px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>POLICE CHIEF</div>
              <div style={{ ...mono, fontSize: 10.5, color: (mustPickChief && st.vacancyReason === "assassinated") ? C.red : shakeLeft ? C.amber : C.dim, marginBottom: 12 }}>
                {!st.chiefId && (st.deadChiefs || []).length >= Object.keys(CHIEFS).length
                  ? "Every chief Luckhead had is dead. The department runs itself at 85% until a successor brings a new slate."
                  : mustPickChief && st.vacancyReason === "assassinated"
                  ? `The Tsuis had your chief killed. ${st.deadChiefs && st.deadChiefs.length ? CHIEFS[st.deadChiefs[st.deadChiefs.length - 1]].name : "The chief"} will not be replaced by anyone who saw what happened. Name one of the remaining candidates.`
                  : mustPickChief
                  ? "Day 7. The acting chief has retired to a lake, and the council will not adjourn until you name a replacement."
                  : shakeLeft
                  ? `Department in transition: half effectiveness for ${shakeLeft} more day${shakeLeft === 1 ? "" : "s"}`
                  : "A new chief means a 15-day shakeup at half effectiveness"}
              </div>
              {Object.keys(CHIEFS).map((k) => {
                const c = CHIEFS[k];
                const on = st.chiefId === k;
                const dead = (st.deadChiefs || []).includes(k);
                return (
                  <div key={k}
                    onClick={() => {
                      if (dead) { setNote(`${c.name} is dead. The Tsuis saw to that.`); return; }
                      if (on) { setNote(`${c.name} already runs the department.`); return; }
                      const outgoing = st.chiefId ? CHIEFS[st.chiefId] : null;
                      setSt((s) => ({ ...s, chiefId: k, vacancyReason: "",
                        chiefShake: s.chiefId ? s.day + CHIEF_SHAKE_DAYS : (s.chiefShake || 0),
                        pendingMonument: outgoing ? outgoing.name : (s.pendingMonument || null) }));
                      setToast(outgoing
                        ? `👮 ${c.name} takes over. ${outgoing.name} is honored with a park.`
                        : `👮 ${c.name} is sworn in.`);
                    }}
                    style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: dead ? "not-allowed" : "pointer",
                             opacity: dead ? 0.5 : 1,
                             background: on ? C.bg : "transparent", border: `1px solid ${dead ? C.red : on ? C.orange : C.line}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16, filter: dead ? "grayscale(1)" : "none" }}>{c.icon}</span>
                      <span style={{ ...disp, fontSize: 14, color: dead ? C.red : on ? C.orange : C.cream, textDecoration: dead ? "line-through" : "none" }}>{c.name}</span>
                      {dead && <span style={{ ...mono, fontSize: 9, color: C.red }}>✕ DECEASED</span>}
                      {on && <span style={{ ...mono, fontSize: 9, color: C.orange }}>· CURRENT</span>}
                    </div>
                    {dead ? (
                      <div style={{ fontSize: 11.5, lineHeight: 1.4, color: C.red, marginTop: 4, fontStyle: "italic" }}>Killed in a Tsui reprisal. Honored with a park.</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 11.5, lineHeight: 1.4, color: C.dim, marginTop: 4, fontStyle: "italic" }}>{c.line}</div>
                        <div style={{ ...mono, fontSize: 10, marginTop: 6, display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                          {c.effects.map((e) => (
                            <span key={e} style={{ color: e.startsWith("+") && (e.includes("crime") || e.includes("staff")) ? C.red
                              : e.startsWith("-") && !e.includes("fewer") ? C.red : C.green }}>{e}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              {!mustPickChief && (
                <div style={{ display: "flex", marginTop: 6 }}>
                  <span style={{ flex: 1 }} />
                  <span onClick={() => setChiefPanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>DONE</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* the archive */}
      {paper && (() => {
        const all = [...(st.log || [])].reverse();
        return (
          <div onClick={() => setPaper(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(92vw, 400px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 20 }}>THE LUCKHEAD SENTINEL</div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginBottom: 12 }}>
                Day {st.day} · {all.length} stor{all.length === 1 ? "y" : "ies"} on file
                {all.length >= LOG_KEEP ? ` · only the last ${LOG_KEEP} are kept` : ""}
              </div>
              {all.length === 0 && (
                <div style={{ ...mono, fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
                  Nothing has happened in Luckhead yet. Give it time.
                </div>
              )}
              {all.map((e) => (
                <div key={e.n} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 14, lineHeight: 1.3 }}>{e.i}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ ...disp, fontSize: 11.5, display: "block",
                                   color: e.k === "good" ? C.green : e.k === "bad" ? C.red : C.cream }}>{e.t}</span>
                    <span style={{ ...mono, fontSize: 9.5, color: C.dim, lineHeight: 1.45 }}>{e.x}</span>
                  </span>
                  <span style={{ ...mono, fontSize: 9, color: C.line, whiteSpace: "nowrap" }}>d{e.d}</span>
                </div>
              ))}
              <div style={{ display: "flex", marginTop: 14 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setPaper(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>DONE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* state of the city */}
      {statePanel && (() => {
        const L = legacyScore(st);
        const ties = entanglements(st);
        const CH = CHIEFS[st.chiefId], HR = HEIRS[st.heir];
        const line = (label, value, tone) => (
          <div key={label} style={{ display: "flex", ...mono, fontSize: 10.5, padding: "2px 0" }}>
            <span style={{ color: C.dim }}>{label}</span><span style={{ flex: 1 }} />
            <span style={{ color: tone || C.cream }}>{value}</span>
          </div>
        );
        return (
          <div onClick={() => setStatePanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 384px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>STATE OF THE CITY</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 10 }}>
                Day {st.day} · {TIERS[tier].name} · map seed {st.seed}
              </div>

              <div style={{ ...mono, fontSize: 9.5, color: C.orange, letterSpacing: "0.18em", margin: "6px 0 3px" }}>YOUR DECISIONS</div>
              {line("Police chief", CH ? `${CH.icon} ${CH.name}` : "none appointed")}
              {line("Administration", HR ? `${HR.icon} ${HR.name}` : "founding mayor")}
              {line("Tax policy", `${T.icon} ${T.name}`)}
              {line("Police funding", `${F.icon} ${F.name}`)}
              {line("Religious leaders", st.faithStance === "attend" ? "attending" : st.faithStance === "refuse" ? "churches taxed" : "not yet asked")}
              {st.bust >= 2 && line("The rapper", st.bust === 3 ? "pardoned" : "arrested", st.bust === 3 ? C.amber : C.green)}
              {line("Federal grant", `$${fedGrant}/day \u00b7 ${FED_FAVOR_NAME[String(fedFavorOf(st))]}`,
                    fedGrant > 0 ? (fedFavorOf(st) > 0 ? C.green : C.cream) : C.red)}
              {st.golfAsk === 2 && line("Golf pledge",
                    `course within ${GOLF_NEAR} tiles of the mansion \u00b7 ${Math.max(0, (st.golfUntil || 0) - st.day)}d left`,
                    C.amber)}
              {st.eco === 2 && (() => {
                const pk = st.grid.filter((c) => c && c.type === "park" && !c.build).length - (st.ecoParks || 0);
                const dirty = st.grid.filter((c) => c && c.type === "plant" && !c.build && !plantStats(c).clean).length;
                return line("Eco pledge",
                  `${Math.max(0, Math.min(ECO_PARKS, pk))}/${ECO_PARKS} parks \u00b7 ${dirty} plant${dirty === 1 ? "" : "s"} to convert \u00b7 ${Math.max(0, (st.ecoUntil || 0) - st.day)}d left`,
                  C.amber);
              })()}
              {(st.govAsk || 0) > 0 && line("State grant",
                    stateGrant > 0 ? `$${stateGrant}/day \u00b7 Sanders is paying`
                      : (st.govAsk === 4 ? "he stopped writing" : "nothing while he is cool on you"),
                    stateGrant > 0 ? C.green : C.red)}
              {st.pvisit >= 2 && line("Presidential visit", st.pvisit === 2 ? "hosted" : "declined", st.pvisit === 2 ? C.amber : C.green)}
              {(st.loans || 0) > 0 && line("Loans taken", `${st.loans} · +${5 * st.loans}% build cost`, C.red)}
              {(st.bribes || 0) > 0 && line("Envelopes delivered", `${st.bribes}`, C.red)}

              <div style={{ ...mono, fontSize: 9.5, color: C.orange, letterSpacing: "0.18em", margin: "10px 0 3px" }}>THE TSUI FAMILY</div>
              {line("Standing", st.mafia === "allied" ? "in business together"
                : st.mafia === "refused" ? "at war"
                : st.mafia === "defeated" ? (st.testified ? "you testified" : "finished")
                : "no contact", st.mafia === "allied" ? C.amber : st.mafia === "refused" ? C.red : C.green)}
              {st.mafia === "allied" && line("Current terms", `$${kickbackFor(st.deal, st.rigged)}/day`)}
              {st.testified && line("Testified", `day ${st.testifiedDay}, ${st.testifiedTies} arrangement${st.testifiedTies === 1 ? "" : "s"} confessed`, C.red)}
              {(st.smuggleOffer === 3) && line("Factory smuggling", "running", C.red)}
              {st.backroom && line("Venue back room", "running", C.red)}
              {(st.rigged || 0) > 0 && line("Elections rigged", `${st.rigged}`, C.red)}
              {st.investTook > 0 && line("Foreign investor", "you looked the other way", C.red)}
              {line("Federal entanglements", `${ties}${ties >= FED_TRIGGER ? " · file open" : ""}`, ties >= FED_TRIGGER ? C.red : C.dim)}
              {st.fed === 1 && line("Federal heat", `${Math.round(st.heat)} / 100`, st.heat > 70 ? C.red : C.amber)}

              <div style={{ ...mono, fontSize: 9.5, color: C.orange, letterSpacing: "0.18em", margin: "10px 0 3px" }}>THE RECORD SO FAR</div>
              {L.items.map(([label, v]) => (
                <div key={label} style={{ display: "flex", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                  <span style={{ color: C.dim }}>{label}</span><span style={{ flex: 1 }} />
                  <span style={{ color: v < 0 ? C.red : C.cream }}>{v >= 0 ? "+" : ""}{v}</span>
                </div>
              ))}
              {L.mult !== 1 && (
                <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10, padding: "2px 0", color: L.mult > 1 ? C.green : C.amber }}>
                  <span>Difficulty ×{L.mult.toFixed(2)}</span><span>{L.base} → {L.total}</span>
                </div>
              )}
              <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ ...disp, fontSize: 12, color: C.dim }}>{L.title}</span>
                <span style={{ flex: 1 }} />
                <span style={{ ...disp, fontSize: 22, color: C.orange }}>{L.total}</span>
              </div>
              <div style={{ ...mono, fontSize: 9, color: C.dim, marginTop: 4 }}>
                Score if your term ended today. Indictment or bankruptcy halves it.
              </div>

              <div style={{ display: "flex", marginTop: 10 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setStatePanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>DONE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PR panel */}
      {prPanel && (() => {
        const hap = calcHap(st.pop, d, st.mafia, st.crime);
        const atkCtx = challengerCtx(st.pop, d, hap, st);
        const atk = challengerAttack(st.challenger, atkCtx);
        const rows = approvalRows({ ...st, challengerDrag: atk.drag,
          challengerLabel: st.challenger ? st.challenger.label : "" }, d, hap);
        const target = rows.reduce((a, [, v]) => a + v, 0);
        const now = st.approval;
        const drift = (target - now) * APPROVAL_INERTIA;
        const crimeDrag = st.crime > CRIME_THRESHOLD ? (st.crime - CRIME_THRESHOLD) * CRIME_APPROVAL : 0;
        const net = drift - crimeDrag;
        const up = rows.filter(([, v]) => v > 0);
        const down = rows.filter(([, v]) => v < 0);
        return (
          <div onClick={() => setPrPanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 384px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>PR PANEL</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 10 }}>
                {Math.round(now)}% today · drifting toward {Math.round(target)}% · 51% to hold the seat · figures reflect today, before tomorrow\u2019s crime
              </div>

              <div style={{ ...mono, fontSize: 9.5, color: C.green, letterSpacing: "0.18em", margin: "6px 0 3px" }}>IN YOUR FAVOUR</div>
              {up.length === 0 && <div style={{ ...mono, fontSize: 10.5, color: C.dim, padding: "2px 0" }}>Nothing. Not one thing.</div>}
              {up.map(([label, v]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                  <span style={{ color: C.dim }}>{label}</span><span style={{ color: C.green }}>+{v.toFixed(1)}</span>
                </div>
              ))}

              <div style={{ ...mono, fontSize: 9.5, color: C.red, letterSpacing: "0.18em", margin: "8px 0 3px" }}>AGAINST YOU</div>
              {down.length === 0 && <div style={{ ...mono, fontSize: 10.5, color: C.dim, padding: "2px 0" }}>Nothing. Enjoy it.</div>}
              {down.map(([label, v]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                  <span style={{ color: C.dim }}>{label}</span><span style={{ color: C.red }}>{v.toFixed(1)}</span>
                </div>
              ))}

              <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 8, paddingTop: 8 }}>
                <div style={{ display: "flex", ...mono, fontSize: 10.5 }}>
                  <span style={{ color: C.dim }}>Drift toward target</span><span style={{ flex: 1 }} />
                  <span style={{ color: drift >= 0 ? C.green : C.red }}>{drift >= 0 ? "+" : ""}{drift.toFixed(2)}/day</span>
                </div>
                {crimeDrag > 0 && (
                  <div style={{ display: "flex", ...mono, fontSize: 10.5 }}>
                    <span style={{ color: C.dim }}>Crime above {CRIME_THRESHOLD} (at {Math.round(st.crime)})</span><span style={{ flex: 1 }} />
                    <span style={{ color: C.red }}>-{crimeDrag.toFixed(2)}/day</span>
                  </div>
                )}
                <div style={{ display: "flex", ...mono, fontSize: 11, marginTop: 4 }}>
                  <span style={{ color: C.dim }}>NET</span><span style={{ flex: 1 }} />
                  <span style={{ color: net > 0.02 ? C.green : net < -0.02 ? C.red : C.dim }}>
                    {net > 0 ? "+" : ""}{net.toFixed(2)}/day {net > 0.02 ? "rising" : net < -0.02 ? "falling" : "steady"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", marginTop: 10 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setPrPanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>DONE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* crime report */}
      {tiesPanel && (() => {
        const favor = fedFavorOf(st);
        const grant = fedGrantOf(st, Math.floor(st.pop));
        const LW = LAWYERS[st.lawyerId];
        const doubt = Math.floor((st.graft || 0) * (LW && LW.graftShield ? 0 : 1) * (st.testified ? 0.35 : 1) / GOV_GRAFT_PER_DOUBT);
        const standing = (st.govRel || 0) - doubt + (LW ? LW.gov : 0);
        const kickNow = st.mafia === "allied" ? kickbackFor(st.deal, st.rigged) : 0;

        const fedLines = [];
        fedLines.push([`Grant paying $${grant}/day`, grant > 0 ? 1 : -1]);
        if (st.schoolAudit) fedLines.push(["Education audit has stopped every federal dollar", -1]);
        if (st.pvisit === 2) fedLines.push(["You hosted the President", 1]);
        if (st.pvisit === 3) fedLines.push(["You snubbed the President's visit", -1]);
        if (st.ice === 2) fedLines.push(["You let ICE into the city", 1]);
        if (st.ice === 3) fedLines.push(["You refused the ICE demand", -1]);
        if (st.potus === 2 && st.lawyerLocked) fedLines.push(["You appointed his choice of attorney", 1]);
        if (st.fed === 1) fedLines.push(["The Bureau has a file open on you", -1]);
        if (st.fed === 2) fedLines.push(["You have been indicted", -1]);
        if (fedComplete(st) && (st.fedFavor || 0) >= 3) fedLines.push(["No federal exposure reaches you while this holds", 1]);

        const govLines = [];
        if (st.govAsk === 0) govLines.push(["He has not written yet", 0]);
        if (st.govAsk === 1 || st.govAsk === 2) govLines.push(["Waiting on a residence he asked for", 0]);
        if (st.govAsk === 4) govLines.push(["You never built the mansion", -1]);
        if ((st.govRel || 0) > 0) govLines.push([`${st.govRel} favour${st.govRel === 1 ? "" : "s"} done for him`, 1]);
        if ((st.govRel || 0) < 0) govLines.push([`${Math.abs(st.govRel)} time${st.govRel === -1 ? "" : "s"} you turned him down`, -1]);
        if (doubt > 0) govLines.push([`He has heard about the Tsui money`, -1]);
        if (LW && LW.graftShield) govLines.push([`${LW.name} keeps the money out of sight`, 1]);
        if (st.testified) govLines.push(["You testified against the family", 1]);
        if (LW && LW.gov) govLines.push([`${LW.name} as city attorney`, LW.gov > 0 ? 1 : -1]);
        if (d.mansionOn && st.tax === "normal") govLines.push(["Mansion standing, Conservative Tax", 1]);
        else if (d.mansionOn) govLines.push(["Mansion standing, but your tax policy is not his", 0]);
        if (st.govBacked) govLines.push(["He is funding your opponent", -1]);
        if (st.freeLandmark) govLines.push(["He is covering your next landmark in full", 1]);
        else if ((st.govYes || 0) > 0 && (st.govYes || 0) < 3) govLines.push([`${st.govYes} of 3 favours done for him`, 0]);

        const tsuiLines = [];
        if (st.mafia === "none") tsuiLines.push(["No arrangement either way", 0]);
        if (st.mafia === "allied") tsuiLines.push([`Kickbacks of $${kickNow}/day`, kickNow > 0 ? 1 : -1]);
        if (st.mafia === "refused") tsuiLines.push(["At war with the family", -1]);
        if (st.mafia === "defeated") tsuiLines.push(["The family is finished in Luckhead", 1]);
        if (st.graft) tsuiLines.push([`$${(st.graft || 0).toLocaleString()} taken from them, all told`, -1]);
        if (st.tsuiBound) tsuiLines.push(["Bound to them permanently. You cannot testify", -1]);
        if (st.testified) tsuiLines.push(["You testified against them", 1]);
        if (st.blackmail === 3) tsuiLines.push(["They are talking to reporters", -1]);
        if (st.deal > 0) tsuiLines.push([`${st.deal} renegotiation${st.deal === 1 ? "" : "s"}`, 0]);
        if (d.tsuiLoyal) tsuiLines.push(["Unbroken loyalty. Elections rig free of the usual cost", 1]);

        const powers = [
          { who: "WASHINGTON", sub: "The President",
            state: FED_FAVOR_NAME[String(favor)], tone: favor >= 1 ? C.green : favor <= -1 ? C.red : C.cream, lines: fedLines },
          { who: "THE STATEHOUSE", sub: "Governor Sonny Sanders",
            state: standing >= 2 ? "friendly" : standing <= -1 ? "hostile" : "correct, and no more", tone: standing >= 2 ? C.green : standing <= -1 ? C.red : C.cream, lines: govLines },
          { who: "THE FAMILY", sub: "Vincent Tsui",
            state: st.mafia === "allied" ? (st.tsuiBound ? "they own you" : "allied") : st.mafia === "refused" ? "at war" : st.mafia === "defeated" ? "beaten" : "no arrangement",
            tone: st.mafia === "allied" ? C.amber : st.mafia === "refused" ? C.red : C.cream, lines: tsuiLines },
        ];

        return (
          <div onClick={() => setTiesPanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 62, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(92vw, 390px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>RELATIONSHIPS</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>Three powers with an interest in Luckhead, and where each of them has you.</div>
              {powers.map((p) => (
                <div key={p.who} style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 11, border: `1px solid ${C.line}` }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ ...mono, fontSize: 9.5, color: C.dim, letterSpacing: "0.18em" }}>{p.who}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ ...disp, fontSize: 13, color: p.tone }}>{p.state}</span>
                  </div>
                  <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 1, marginBottom: 5 }}>{p.sub}</div>
                  {p.lines.length === 0 && <div style={{ ...mono, fontSize: 10.5, color: C.dim }}>Nothing between you yet.</div>}
                  {p.lines.map(([label, tone]) => (
                    <div key={label} style={{ display: "flex", gap: 6, ...mono, fontSize: 10.5, padding: "1.5px 0", lineHeight: 1.4 }}>
                      <span style={{ color: tone > 0 ? C.green : tone < 0 ? C.red : C.dim, width: 8 }}>
                        {tone > 0 ? "+" : tone < 0 ? "\u2212" : "\u00b7"}
                      </span>
                      <span style={{ color: C.dim, flex: 1 }}>{label}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ display: "flex" }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setTiesPanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 14px" }}>CLOSE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {statPanel && (() => {
        const cfg = {
          approval: { title: "APPROVAL", sub: `${Math.round(st.approval)}% today \u00b7 51% wins an election`,
                      rows: approvalRows(st, d, hap), unit: "", foot: "TARGET" },
          mood: { title: "TOWN MOOD", sub: `${Math.round(hap)} today \u00b7 under 45 nobody moves here, under 28 people leave`,
                  rows: moodRows(st.pop, { ...d, env: st.env, grace: undefined, protestMood: d.protestMood }, st.mafia, st.crime), unit: "", foot: "MOOD" },
          env: { title: "ENVIRONMENT", sub: `${Math.round(st.env === undefined ? 100 : st.env)} today \u00b7 under ${ENV_ALARM} the whole town notices`,
                 rows: envRows(d), unit: "", foot: "TARGET" },
        }[statPanel];
        if (statPanel === "growth") {
          const g = growthRows(st, d, hap);
          return (
            <div onClick={() => setStatPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 62, padding: 16 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 380px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
                <div style={{ ...disp, fontSize: 18 }}>WHO IS MOVING HERE</div>
                <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 10 }}>
                  Population {Math.floor(st.pop)} of {Math.floor(d.popCap)} housed
                </div>
                {g.blocked.length > 0 && (
                  <>
                    <div style={{ ...mono, fontSize: 9.5, color: C.red, letterSpacing: "0.18em", margin: "6px 0 3px" }}>NOBODY IS ARRIVING</div>
                    {g.blocked.map((b) => (
                      <div key={b} style={{ ...mono, fontSize: 10.5, color: C.red, padding: "2px 0", lineHeight: 1.4 }}>{b}</div>
                    ))}
                  </>
                )}
                <div style={{ ...mono, fontSize: 9.5, color: C.dim, letterSpacing: "0.18em", margin: "10px 0 3px" }}>WHAT SETS THE RATE</div>
                {g.rows.map(([label, v], i) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                    <span style={{ color: C.dim }}>{label}</span>
                    <span style={{ color: i === 0 ? C.cream : v > 0 ? C.green : C.red }}>
                      {i === 0 ? `${v}/day` : `${v > 0 ? "+" : ""}${v}%`}
                    </span>
                  </div>
                ))}
                <div style={{ display: "flex", marginTop: 10 }}>
                  <span style={{ flex: 1 }} />
                  <span onClick={() => setStatPanel(null)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 14px" }}>CLOSE</span>
                </div>
              </div>
            </div>
          );
        }
        const up = cfg.rows.filter(([, v]) => v > 0);
        const down = cfg.rows.filter(([, v]) => v < 0);
        const net = cfg.rows.reduce((a, [, v]) => a + v, 0);
        return (
          <div onClick={() => setStatPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 62, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 380px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>{cfg.title}</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 10 }}>{cfg.sub}</div>
              <div style={{ ...mono, fontSize: 9.5, color: C.green, letterSpacing: "0.18em", margin: "6px 0 3px" }}>LIFTING IT</div>
              {up.length === 0 && <div style={{ ...mono, fontSize: 10.5, color: C.dim, padding: "2px 0" }}>Nothing at all.</div>}
              {up.map(([label, v]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                  <span style={{ color: C.dim }}>{label}</span><span style={{ color: C.green }}>+{v.toFixed(1)}</span>
                </div>
              ))}
              <div style={{ ...mono, fontSize: 9.5, color: C.red, letterSpacing: "0.18em", margin: "8px 0 3px" }}>HOLDING IT DOWN</div>
              {down.length === 0 && <div style={{ ...mono, fontSize: 10.5, color: C.dim, padding: "2px 0" }}>Nothing at all.</div>}
              {down.map(([label, v]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                  <span style={{ color: C.dim }}>{label}</span><span style={{ color: C.red }}>{v.toFixed(1)}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 8, paddingTop: 8, display: "flex", ...mono, fontSize: 11 }}>
                <span style={{ color: C.dim }}>{cfg.foot}</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: C.cream }}>{Math.round(net)}</span>
              </div>
              <div style={{ display: "flex", marginTop: 10 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setStatPanel(null)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 14px" }}>CLOSE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {crimeReport && (() => {
        const rows = crimeLedgerRows({ mafia: st.mafia, reprisal: st.reprisal, testified: st.testified,
          rigged: st.rigged, pop: st.pop, backroom: st.backroom, fund: st.fund, heir: st.heir,
          event: st.event, gear: st.gear, day: st.day, bustUntil: st.bustUntil, chiefId: st.chiefId }, d);
        const net = rows.reduce((a, [, v]) => a + v, 0);
        const up = rows.filter(([, v]) => v > 0);
        const down = rows.filter(([, v]) => v < 0);
        return (
          <div onClick={() => setCrimeReport(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 380px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>CRIME REPORT</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 10 }}>
                {Math.round(st.crime)} on the street · above {CRIME_THRESHOLD} it costs you approval daily
              </div>
              <div style={{ ...mono, fontSize: 9.5, color: C.red, letterSpacing: "0.18em", margin: "6px 0 3px" }}>PRESSURE</div>
              {up.length === 0 && <div style={{ ...mono, fontSize: 10.5, color: C.dim, padding: "2px 0" }}>Nothing. A quiet town.</div>}
              {up.map(([label, v]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                  <span style={{ color: C.dim }}>{label}</span><span style={{ color: C.red }}>+{v.toFixed(1)}</span>
                </div>
              ))}
              <div style={{ ...mono, fontSize: 9.5, color: C.green, letterSpacing: "0.18em", margin: "8px 0 3px" }}>SUPPRESSION</div>
              {down.length === 0 && <div style={{ ...mono, fontSize: 10.5, color: C.dim, padding: "2px 0" }}>Nothing. Nobody is pushing back.</div>}
              {down.map(([label, v]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 10.5, padding: "2px 0" }}>
                  <span style={{ color: C.dim }}>{label}</span><span style={{ color: C.green }}>{v.toFixed(1)}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 8, paddingTop: 8, display: "flex", ...mono, fontSize: 11 }}>
                <span style={{ color: C.dim }}>NET, PER DAY</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: net > 0.2 ? C.red : net < -0.2 ? C.green : C.dim }}>
                  {net > 0 ? "+" : ""}{net.toFixed(1)} {net > 0.2 ? "rising" : net < -0.2 ? "falling" : "holding"}
                </span>
              </div>
              <div style={{ display: "flex", marginTop: 10 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setCrimeReport(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>DONE</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* the communications director */}
      {commsPanel && (
        <div onClick={() => setCommsPanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 62, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(92vw, 380px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18 }}>COMMUNICATIONS</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>
              {st.commsLocked
                ? "Marla Krauthammer is the Governor's arrangement, not yours. She stays until a successor takes office."
                : st.commsId
                ? "On retainer. Change whenever you like, for a signing fee."
                : "Nobody is speaking for Luckhead. Trade, arrivals and mood all sit at their own level."}
            </div>
            {COMMS_KEYS.map((k) => {
              const M = COMMS[k];
              const on = st.commsId === k;
              const fee = st.commsId ? M.fee * COMMS_SIGNING : 0;
              return (
                <div key={k}
                  onClick={() => {
                    if (on) return;
                    if (st.commsLocked) { setNote("Sanders put Marla Krauthammer in that chair. Moving her is not yours to do."); return; }
                    if (st.money < fee) { setNote(`${M.name} wants $${fee.toLocaleString()} to sign. Luckhead does not have it.`); return; }
                    setSt((s) => ({ ...s, commsId: k, money: s.money - fee }));
                    setNote(`${M.name} starts on Monday. $${fee.toLocaleString()} to sign.`);
                  }}
                  style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: on ? "default" : "pointer",
                           background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{M.icon}</span>
                    <span style={{ ...disp, fontSize: 14, color: on ? C.orange : C.cream }}>{M.name}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ ...mono, fontSize: 10, color: on ? C.amber : C.dim }}>
                      ${M.fee}/day{!on ? ` \u00b7 $${fee.toLocaleString()} to sign` : ""}
                    </span>
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 3, fontStyle: "italic" }}>{M.line}</div>
                  <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>
                    {M.effects.map((e) => "\u00b7 " + e).join("  ")}
                  </div>
                </div>
              );
            })}
            {st.commsId && !st.commsLocked && (
              <div onClick={() => { setSt((s) => ({ ...s, commsId: null })); setNote("Luckhead speaks for itself again. The retainer stops today."); }}
                style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 11, cursor: "pointer", border: `1px solid ${C.line}` }}>
                <div style={{ ...disp, fontSize: 13, color: C.dim }}>LET THEM GO</div>
                <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 2 }}>No retainer, and no help with any of it.</div>
              </div>
            )}
            <div style={{ display: "flex", marginTop: 6 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => setCommsPanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 14px" }}>CLOSE</span>
            </div>
          </div>
        </div>
      )}

      {/* the city attorney's file */}
      {lawyerPanel && (
        <div onClick={() => setLawyerPanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 62, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(92vw, 380px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18 }}>CITY ATTORNEY</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>
              {st.lawyerId
                ? `On retainer. You can change counsel whenever you like, for a signing fee, and new counsel needs ${LAWYER_HANDOVER} days on the file before they are any use.`
                : "Nobody is retained. The federal file builds at full speed."}
            </div>
            {LAWYER_KEYS.map((k) => {
              const L = LAWYERS[k];
              const on = st.lawyerId === k;
              return (
                <div key={k}
                  onClick={() => {
                    if (on) return;
                    if ((st.deadLawyers || []).includes(k)) { setNote(`${L.name} was killed in a Tsui reprisal. The office remembers.`); return; }
                    if (st.lawyerLocked) { setNote("Nancy Nace was appointed at the President's request. She is not going anywhere."); return; }
                    const fee = st.lawyerId ? L.fee * LAWYER_SIGNING : 0;
                    if (st.money < fee) { setNote(`${L.name} wants $${fee.toLocaleString()} to take the file on. Luckhead does not have it.`); return; }
                    setSt((s) => ({ ...s, lawyerId: k, lawyerFrom: s.day, money: s.money - fee }));
                    setNote(`${L.name} takes over for $${fee.toLocaleString()}. It will be ${LAWYER_HANDOVER} days before she is across the file.`);
                  }}
                  style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: on ? "default" : "pointer",
                         background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{L.icon}</span>
                    <span style={{ ...disp, fontSize: 14, color: on ? C.orange : C.cream }}>{L.name}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ ...mono, fontSize: 10, color: on ? C.amber : C.dim }}>
                      ${L.fee}/day{!on && st.lawyerId ? ` \u00b7 $${(L.fee * LAWYER_SIGNING).toLocaleString()} to sign` : ""}
                    </span>
                  </div>
                  {on && st.day < (st.lawyerFrom || 0) + LAWYER_HANDOVER && (
                    <div style={{ ...mono, fontSize: 10, color: C.amber, marginTop: 3 }}>
                      Reading in. No protection for another {(st.lawyerFrom || 0) + LAWYER_HANDOVER - st.day} days.
                    </div>
                  )}
                  <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 3, fontStyle: "italic" }}>{L.line}</div>
                  <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>
                    {L.effects.map((e) => "\u00b7 " + e).join("  ")}
                  </div>
                </div>
              );
            })}
            {st.lawyerId && (
              <div onClick={() => { if (st.lawyerLocked) { setNote("Nancy Nace was appointed at the President's request. She is not going anywhere."); return; }
                                    setSt((s) => ({ ...s, lawyerId: null, lawyerFrom: 0 })); setNote("Luckhead will represent itself. The retainer stops today."); }}
                style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 11, cursor: "pointer", border: `1px solid ${C.line}` }}>
                <div style={{ ...disp, fontSize: 13, color: C.dim }}>LET THEM GO</div>
                <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 2 }}>No retainer, no protection. The file builds at full speed again.</div>
              </div>
            )}
            <div style={{ display: "flex", marginTop: 6 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => setLawyerPanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 14px" }}>CLOSE</span>
            </div>
          </div>
        </div>
      )}

      {/* public works */}
      {worksPanel && (
        <div onClick={() => setWorksPanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 62, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 380px)", maxHeight: "86vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18 }}>PUBLIC WORKS</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>Where the road money goes. Changes what the asphalt carries, what transit is worth, and what it all costs to keep.</div>
            {WORKS_KEYS.map((k) => {
              const w = WORKS[k];
              const on = (st.works || "balanced") === k;
              return (
                <div key={k} onClick={() => { setSt((s) => ({ ...s, works: k })); setNote(`Public works set to ${w.name}.`); }}
                  style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: "pointer",
                           background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{w.icon}</span>
                    <span style={{ ...disp, fontSize: 14, color: on ? C.orange : C.cream }}>{w.name}</span>
                    <span style={{ flex: 1 }} />
                    {w.approval !== 0 && (
                      <span style={{ ...mono, fontSize: 10, color: w.approval > 0 ? C.green : C.red }}>
                        {w.approval > 0 ? "+" : ""}{w.approval} approval
                      </span>
                    )}
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 3, lineHeight: 1.45 }}>{w.blurb}</div>
                </div>
              );
            })}
            <div style={{ display: "flex", marginTop: 6 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => setWorksPanel(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 14px" }}>CLOSE</span>
            </div>
          </div>
        </div>
      )}

      {/* police funding */}
      {funding && (
        <div onClick={() => setFunding(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 380px)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18 }}>POLICE FUNDING</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>Changes every station's roster and upkeep.</div>
            {(st.tsuiLoanUntil || 0) > st.day && (
              <div style={{ ...mono, fontSize: 10.5, color: C.amber, marginBottom: 12, lineHeight: 1.5,
                            border: `1px solid ${C.amber}`, borderRadius: 10, padding: "8px 10px" }}>
                The Tsui arrangement holds the force at a shoestring for another {(st.tsuiLoanUntil || 0) - st.day} days. You took their money; this was the price.
              </div>
            )}
            {FUND_KEYS.map((k) => {
              const f = FUND[k];
              const on = st.fund === k;
              const locked = (st.tsuiLoanUntil || 0) > st.day;
              return (
                <div key={k} onClick={() => {
                    if (locked) { setNote("The Tsuis are holding you to the deal. The budget stays where it is."); return; }
                    setSt((s) => ({ ...s, fund: k })); setNote(`Police funding set to ${f.name}.`);
                  }}
                  style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: locked ? "default" : "pointer",
                           opacity: locked && !on ? 0.4 : 1,
                           background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 15 }}>{f.icon}</span>
                    <span style={{ ...disp, fontSize: 14, color: on ? C.orange : C.cream }}>{f.name}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ ...mono, fontSize: 10, color: C.dim }}>upkeep ×{f.upkeep}</span>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.45, color: C.dim, marginTop: 5 }}>{f.blurb}</div>
                  <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ color: f.staff > 0 ? C.amber : f.staff < 0 ? C.green : C.dim }}>staff {f.staff > 0 ? "+" : ""}{f.staff}</span>
                    <span style={{ color: f.crime < 0 ? C.green : f.crime > 0 ? C.red : C.dim }}>crime {f.crime > 0 ? "+" : ""}{f.crime || "0"}</span>
                    <span style={{ color: f.approval > 0 ? C.green : f.approval < 0 ? C.red : C.dim }}>approval {f.approval > 0 ? "+" : ""}{f.approval || "0"}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", marginTop: 6 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => setFunding(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>DONE</span>
            </div>
          </div>
        </div>
      )}

      {/* tax policy */}
      {rates && (
        <div onClick={() => setRates(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 380px)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18 }}>TAX POLICY</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>Takes effect immediately. Approval adjusts over several days.</div>

            {TAX_KEYS.map((k) => {
              const t = TAX[k];
              const on = st.tax === k;
              return (
                <div
                  key={k}
                  onClick={() => { if (st.mayor === "debbs") { setNote("Debbs ran on High Tax. The platform is not negotiable."); return; }
                                   setSt((s) => ({ ...s, tax: k })); setNote(`Tax policy set to ${t.name}.`); }}
                  style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: "pointer",
                           background: on ? C.bg : "transparent", border: `1px solid ${on ? C.orange : C.line}` }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 15 }}>{t.icon}</span>
                    <span style={{ ...disp, fontSize: 14, color: on ? C.orange : C.cream }}>{t.name}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ ...mono, fontSize: 10, color: C.dim }}>
                      {t.taxRate === 0 ? "no revenue" : `${Math.round(t.taxRate * 100)}% revenue`}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.45, color: C.dim, marginTop: 5 }}>{t.blurb}</div>
                  <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ color: t.approval > 0 ? C.green : t.approval < 0 ? C.red : C.dim }}>
                      approval {t.approval > 0 ? "+" : ""}{t.approval || "0"}
                    </span>
                    <span style={{ color: t.police > 1 ? C.green : t.police < 1 ? C.red : C.dim }}>police ×{t.police}</span>
                    <span style={{ color: t.infra < 1 ? C.green : t.infra > 1 ? C.red : C.dim }}>infra ×{t.infra}</span>
                    <span style={{ color: t.growth > 1 ? C.green : t.growth < 1 ? C.red : C.dim }}>growth ×{t.growth}</span>
                  </div>
                </div>
              );
            })}

            <div style={{ display: "flex", marginTop: 6 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => setRates(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                DONE
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ledger */}
      {books && (() => {
        const rows = [
          ["Taxes", "taxes", C.green],
          ["Commercial", "trade", C.green],
          ["Industrial", "goods", C.green],
          ["Power", "power", C.red],
          ["Industry", "industry", C.red],
          ["Civic", "civic", C.red],
          ["Tsui family", "mob", C.amber],
          ["Windfalls", "windfall", C.amber],
          ["Federal grant", "grant", C.green],
          ["State grant", "stategrant", C.amber],
        ];
        const L = st.ledger || [];
        const sum = (k) => L.reduce((a, e) => a + (e[k] || 0), 0);
        const income = sum("taxes") + sum("trade") + sum("goods") + sum("grant") + sum("stategrant")
          + Math.max(0, sum("windfall")) + Math.max(0, sum("mob"));
        const expense = -(sum("power") + sum("industry") + sum("civic")
          + Math.min(0, sum("windfall")) + Math.min(0, sum("mob")));
        const total = income - expense;
        const peak = Math.max(1, ...rows.map((r) => Math.abs(sum(r[1]))));
        const mag = Math.pow(10, Math.floor(Math.log10(peak)));
        const lead = peak / mag;
        const scale = (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * mag;
        return (
          <div onClick={() => setBooks(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 380px)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 18 }}>THE BOOKS</div>
              <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>
                {L.length ? `Last ${L.length} day${L.length > 1 ? "s" : ""} · day ${L[0].day} to ${L[L.length - 1].day}` : "No days on record yet."}
              </div>
              {L.length > 0 && (L[L.length - 1].notes || []).length > 0 && (
                <div style={{ ...mono, fontSize: 9.5, color: C.amber, marginBottom: 10, lineHeight: 1.5 }}>
                  AFFECTING TODAY: {(L[L.length - 1].notes || []).join(" · ")}
                </div>
              )}

              {L.length > 0 && rows.map(([label, key, color]) => {
                const v = sum(key);
                if (v === 0) return null;
                const shown = key === "mob" ? (v >= 0 ? C.amber : C.red) : color;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ ...mono, fontSize: 9.5, width: 86, color: C.cream }}>{label}</span>
                    <span style={{ flex: 1, height: 8, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${(Math.abs(v) / scale) * 100}%`, background: shown }} />
                    </span>
                    <span style={{ ...mono, fontSize: 11, width: 52, textAlign: "right", color: shown }}>
                      {v >= 0 ? "+" : ""}{v}
                    </span>
                  </div>
                );
              })}

              {L.length > 0 && (
                <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 10, ...mono, fontSize: 11.5, lineHeight: 1.7 }}>
                  <div style={{ display: "flex" }}><span style={{ flex: 1, color: C.dim }}>Income</span><span style={{ color: C.green }}>+{income}</span></div>
                  <div style={{ display: "flex" }}><span style={{ flex: 1, color: C.dim }}>Expenses</span><span style={{ color: C.red }}>-{expense}</span></div>
                  <div style={{ display: "flex", ...disp, fontSize: 14, marginTop: 4 }}>
                    <span style={{ flex: 1 }}>NET</span>
                    <span style={{ color: total >= 0 ? C.green : C.red }}>{total >= 0 ? "+" : ""}{total}</span>
                  </div>
                  <div style={{ color: C.dim, fontSize: 10.5, marginTop: 6 }}>
                    Averaging {total >= 0 ? "+" : ""}{Math.round(total / L.length)} a day.
                  </div>
                </div>
              )}

              <div style={{ display: "flex", marginTop: 14 }}>
                <span style={{ flex: 1 }} />
                <span onClick={() => setBooks(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                  CLOSE THE BOOKS
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* help overlay */}
      {help && (
        <div onClick={() => setHelp(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(88vw, 360px)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18, marginBottom: 10 }}>FIELD MANUAL</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.dim }}>
              {[
                ["THE TWO NETWORKS", [
                  "Most buildings need a Road touching them AND power reaching them.",
                  "Power starts at a Plant, travels along Power Lines, and passes through buildings tile to tile. Roads carry no power.",
                  "Roads must link back to the main network. A stray stub shows grey and serves nobody.",
                  "Badges: 🚧 no road · ⚡ no power · 👤 no staff · 🔨 still building.",
                ]],
                ["THE BASIC LOOP", [
                  "Houses bring residents. Shops and Factories give them jobs. Residents pay tax.",
                  "Every business needs workers, including the Plant. Build Houses first.",
                  "Understaffed buildings still open, at reduced output.",
                  "Keep happiness above 45 or nobody moves in.",
                ]],
                ["WHAT KILLS RUNS", [
                  "Crime. It drags mood, and mood sets approval. Watch the bar.",
                  "Unemployment and homelessness. Both hit mood, approval, and crime at once.",
                  "Traffic. Roads carry 6 trips; past that they jam and trade revenue falls.",
                  "Debt. Below −$3,000 the state takes the city.",
                ]],
                ["ELECTIONS", [
                  "Every 140 days you need 51%. That number never changes.",
                  "The opposition runs on your worst stat and drains approval daily until you fix it.",
                  "Your first term carries goodwill. Every term after polls a little worse.",
                  "Every two terms you name a successor, which resets fatigue and wipes all Tsui deals.",
                ]],
                ["THE TSUI FAMILY", [
                  "Three standing arrangements opens a federal file. Heat fills; at 100 you are indicted.",
                  "Refuse from the start and they burn one building, once. Take their money first and the fires never stop.",
                  "TESTIFY at any renegotiation ends them for good and clears the heat, for 26 approval and a crime spike.",
                ]],
                ["MONEY", [
                  "Shops need customers: one shop per 10 residents earns full price.",
                  "Factories out-earn shops but need more workers and foul the air.",
                  "Roads cost $1/day. A deficit costs 6 approval until you climb out.",
                  "Envelopes buy approval, cool heat, or lift industry. Each leaves a stain and may draw the Bureau.",
                ]],
                ["USEFUL HABITS", [
                  "Upgrade before you expand. A leveled House holds far more than a second one.",
                  "Put transit across from Apartments, Venues, and Factories, where the trips are.",
                  "Change one thing at a time. Luckhead punishes sudden reinvention.",
                  "City Hall has the Books, the PR Panel, and the Crime Report. They explain every number.",
                ]],
              ].map(([head, lines]) => (
                <div key={head} style={{ marginBottom: 11 }}>
                  <div style={{ ...mono, fontSize: 9.5, color: C.orange, letterSpacing: "0.18em", marginBottom: 3 }}>{head}</div>
                  {lines.map((t) => (
                    <div key={t} style={{ display: "flex", gap: 6, marginBottom: 2 }}>
                      <span style={{ color: C.line }}>·</span><span>{t}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ ...mono, fontSize: 9.5, color: C.dim, marginTop: 4 }}>
                Luckhead saves as you play. Tips can be switched on or off from the City Hall menu.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { doReset(); setHelp(false); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "6px 12px" }}
              >
                RESET CITY
              </span>
              <span
                onClick={() => { doReset(Math.floor(Math.random() * 1e9)); setHelp(false); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 12px" }}
              >
                NEW MAP
              </span>
              <span style={{ flex: 1 }} />
              <span onClick={() => setHelp(false)} style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                BACK TO WORK
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
