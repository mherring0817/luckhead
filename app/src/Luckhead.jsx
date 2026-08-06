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
  shop:    { name: "Shop",        cost: 75,  icon: "🏪", pow: 1, jobs: 3, rev: 8, hint: "Trade income, 3 jobs. Earns most when there is 1 shop per 10 residents." },
  factory: { name: "Factory",     cost: 340, icon: "🏭", pow: 2, jobs: 10, upkeep: 5, rev: 28, pollute: true, hint: "Big industrial income, 10 jobs. Pollutes 2 tiles hard. Takes 9 days to build." },
  plant:   { name: "Power Plant", cost: 260, icon: "⚡", gen: 10, jobs: 1, upkeep: 12, pollute: true, hint: "Powers 10 units across its wires. Needs 1 operator. Pollutes 2 tiles; keeps running while upgrading." },
  park:    { name: "Park",        cost: 40,  icon: "🌳", upkeep: 1, hint: "Lifts mood for homes within 2 tiles. No road, power, or staff needed." },
  tavern:  { name: "Tavern",      cost: 90,  icon: "🍺", pow: 1, jobs: 2, rev: 6, hint: "Cheer townwide, but +2 crime and adjacent homes lose 9 mood." },
  church:  { name: "Church",      cost: 110, icon: "⛪", pow: 1, jobs: 2, upkeep: 3, faith: 1.3, hint: "Quiets crime townwide (-1.3/day), at a small cost to the town\u2019s mood. Loudspeakers within 2 tiles drown it out entirely. Maximum of 3." },
  police:  { name: "Police",      cost: 120, icon: "🚓", pow: 1, jobs: 4, upkeep: 9, hint: "Cuts crime within 3 tiles. 4 officers. Coverage scales with staffing, and sharpens a lot once the chief has new equipment." },
  camera:  { name: "Cameras",     cost: 105, icon: "📷", pow: 3, upkeep: 4, watch: 0.6, reach: 2,
    hint: "Watches 2 tiles in every direction, cutting crime where no patrol reaches. No staff and no road needed, but a heavy power draw, and the town does not love being filmed." },
  school:  { name: "School",      cost: 130, icon: "🏫", pow: 1, jobs: 4, upkeep: 5, learn: 1, hint: "Draws newcomers, +approval, -0.6 crime, and raises the tax take from homes within 3 tiles. Maximum of 2." },
  library: { name: "Luckhead Library", cost: 220, icon: "📚", pow: 1, jobs: 2, upkeep: 6, edu: 0.35,
    hint: "Sharpens every school in town, making each more effective. Needs a road and 2 librarians. Unlocks after your first school." },
  histcenter:{ name: "History Center", cost: 420, icon: "🏛", pow: 2, jobs: 4, upkeep: 11, edu: 0.6,
    hint: "A grander archive than the Library, and a stronger boost to every school. Pricier to build and run, and needs 4 staff." },
  stadium: { name: "Stadium",     cost: 1400, icon: "🏟️", pow: 4, jobs: 10, upkeep: 20, rev: 120, crime: 4,
    hint: "A big commercial draw and a jobs engine, but crowds bring crime. Upgrades once to a retractable roof for higher year-round revenue. Maximum of 1." },
  hall:    { name: "City Hall",   cost: 0,   icon: "🏛️", upkeep: 4, hint: "Your seat of government. Carries power through, generates none. Tap it for the budget and tax policy." },
  hallpart:{ name: "City Hall",   cost: 0,   icon: "",   hint: "Part of City Hall." },
  speaker: { name: "Loudspeakers", cost: 90, icon: "📢", pow: 1, upkeep: 3, message: 1, hint: "+2.2 approval, no staff, no road needed. Taverns and Schools within 2 tiles lose 30%; Churches within 2 tiles go silent entirely and sour the mood nearby. Maximum of 3." },
  billboard:{ name: "Campaign Billboard", cost: 70, icon: "🪧", upkeep: 1, message: 0.75, hint: "A political billboard: +1.7 approval, no staff, no power, no road. A dollar a day. PR campaigns boost it further. Maximum of 3." },
  theatre: { name: "Luckhead Theatre", cost: 900, icon: "🎭", pow: 3, jobs: 6, upkeep: 12, cheer: 12, rev: 25, trips: 20,
    hint: "The grand old stage, one of a kind. Sells out most nights, lifts the whole town's spirits. The Music Venues lose 15% of their door to it." },
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
  prison:  { name: "Prison",      cost: 260, icon: "🏛", pow: 2, jobs: 4, upkeep: 13, hold: 4, gloom: 7, hint: "Calms crime townwide (-4/day). Homes within 2 tiles lose 7 mood." },
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
  tavern:  [{ name: "Alehouse",        cost: 95,  set: { jobs: 3, rev: 11, cheer: 3 } },
            { name: "Music Hall",      cost: 170, set: { jobs: 5, rev: 18, cheer: 5, pow: 2 } },
            { name: "Grand Saloon",    cost: 290, set: { jobs: 7, rev: 27, cheer: 7, pow: 2 } }],
  church:  [{ name: "Parish Hall",     cost: 120, set: { jobs: 3, upkeep: 4, faith: 2.3 } },
            { name: "Cathedral",       cost: 220, set: { jobs: 5, upkeep: 6, faith: 5, pow: 2 } },
            { name: "Basilica",        cost: 380, set: { jobs: 7, upkeep: 8, faith: 7, pow: 2 } }],
  hall:    [{ name: "Secured City Hall", cost: 260, set: { upkeep: 11, jobs: 2, guard: 3 } }],
  police:  [{ name: "RoboCops",        cost: 300, set: { jobs: 1, upkeep: 16, reach: 4 } }],
  school:  [{ name: "Middle School",   cost: 140, set: { jobs: 6, upkeep: 7, learn: 1.6 } },
            { name: "High School",     cost: 240, set: { jobs: 9, upkeep: 10, learn: 2.3, pow: 2 } },
            { name: "Community College", cost: 400, set: { jobs: 13, upkeep: 14, learn: 3.2, pow: 2 } }],
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
  library: [{ name: "Reference Wing",  cost: 180, set: { jobs: 3, upkeep: 8, edu: 0.5 } }],
};

// Construction time in days. Upgrades take half as long, rounded up.
const BUILD_DAYS = { house: 3, park: 3, factory: 9, road: 0, line: 0, bridge: 3, theatre: 7, hideaway: 7, plaza: 7, fastpark: 7, library: 6, histcenter: 8, stadium: 10, hall: 0, hallpart: 0 };
const SPECIALTY = new Set(["theatre", "hideaway", "plaza", "fastpark"]);
// Buildings the town will only tolerate so many of.
const BUILD_CAP = { church: 3, speaker: 3, bank: 3, billboard: 3, school: 2, stadium: 1, library: 1, histcenter: 1 };
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

const COST_SCALE = 1.12;
const LOAN_PENALTY = 0.05;   // each loan raises build costs 5%, permanently
const DEBT_FLOOR = -3000;    // past this the state takes the city off your hands
const MODAL_GAP = 6;         // quiet days after something that could end the run
const MODAL_GAP_SOFT = 13;   // and a longer breather after routine business
// Interruptions that genuinely cannot wait. Everything else is business.
const URGENT_MODALS = new Set(["heir", "vote", "fed", "indict", "chief", "arson", "shooting"]);
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
const BUILD_KEYS = ["road", "bridge", "line", "house", "shop", "factory", "plant", "park", "tavern", "church", "police", "school", "bus", "venue", "clinic", "hospital", "prison", "library", "histcenter", "stadium", "speaker", "billboard", "bank", "subway", "theatre", "hideaway", "plaza", "fastpark"];
const UNLOCK_DAY = { speaker: 40, billboard: 40, camera: 100, bank: 138 };
// Some buildings unlock only after a prerequisite building exists.
const UNLOCK_AFTER = { library: "school" };
const UNLOCK = { church: 15, factory: 15, school: 25, clinic: 30, prison: 30, bus: 36, subway: 60, hospital: 50, venue: 50, theatre: 55, hideaway: 55, plaza: 55, fastpark: 55 };
// Popups fire the first time the town reaches each milestone.
const MILESTONES = [
  { pop: 15, title: "FAITH AND INDUSTRY", keys: ["church", "factory"],
    body: "Luckhead can support industry and a congregation. Factories export goods for real money but demand a small army of workers and foul the air for two tiles. Churches quiet crime across the whole town.",
    tip: "Keep factories away from housing. Churches work from anywhere." },
  { pop: 25, title: "SCHOOLS OPEN", keys: ["school"],
    body: "Schools draw families to Luckhead, lift approval, and keep young people out of trouble. They cost real upkeep and need a full staff.",
    tip: "Their pull on newcomers compounds. Build early." },
  { pop: 30, title: "ORDER AND MEDICINE", keys: ["prison", "clinic"],
    body: "Two institutions a real town needs. A Prison calms crime across the whole map wherever you put it. A Clinic keeps people well, lifting both happiness and your approval.",
    tip: "Both cost real upkeep. Neither works next to a factory." },
  { pop: 36, title: "PUBLIC TRANSIT", keys: ["bus"],
    body: "Bus Stations shed traffic from every road they touch, and a working network eases congestion across the entire town.",
    tip: "A lone station does nothing. Build at least two." },
  { pop: 50, title: "A SCENE AND A HOSPITAL", keys: ["hospital", "venue", "histcenter"],
    body: "A Hospital is four times the Clinic in every direction: happiness, approval, staffing, and cost. A Music Venue lifts the town's mood and earns well, but draws crowds, cars, and trouble.",
    tip: "Keep both out of the smog, and the venue away from housing." },
  { pop: 60, title: "UNDERGROUND", keys: ["subway", "stadium"],
    body: "Luckhead can dig. Subway Stops clear traffic far harder than buses, near and townwide, but cost real money to run and need a partner stop like any transit.",
    tip: "Two stops minimum. They share the network with your buses." },
  { pop: 55, title: "LANDMARKS", keys: ["theatre", "hideaway", "plaza", "fastpark"],
    body: "Luckhead is big enough for institutions now: the Theatre, Tommy's Hideaway, Pipp's Plaza, and Faststain Park. Each is one of a kind, very expensive, and powerful. Each also steps on somebody's toes.",
    tip: "Read what each one costs the rest of the town before you build it." },
];
// The popup, not raw population, gates a building. This map ties each key to the
// milestone that introduces it, so availability and the popup are the same event.
const MILESTONE_POP = {};
MILESTONES.forEach((m) => (m.keys || []).forEach((k) => { MILESTONE_POP[k] = m.pop; }));
const CONDUCT = new Set(["line", "plant", "house", "shop", "factory", "police", "tavern", "church", "school", "bus", "venue", "prison", "clinic", "hospital", "speaker", "camera", "bank", "subway", "theatre", "hideaway", "plaza", "library", "histcenter", "stadium", "hall", "hallpart"]);
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

const FLAVOR = [
  "A citizen suggested the factory could smell less like regret.",
  "Roads to nowhere are still roads. Philosophically.",
  "Parks: nature's customer service.",
  "The pigeons have unionized. No demands yet.",
  "Approval rating: you. You are the approval rating.",
  "Someone painted the water tower. We do not have a water tower.",
  "The pigeons approve of the new perches.",
];

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
const HONEYMOON = 20;   // goodwill during the first term, fading after
const APPROVAL_INERTIA = 0.05;   // how fast approval chases its target; lower = steadier
const CRIME_APPROVAL = 0.07;     // approval lost per point of crime over the threshold
const FATIGUE = 2.5;    // approval target lost per term already served
const FATIGUE_CAP = 15; // levels off after six terms
const SUCCESSION_EVERY = 2;
const ICE_RAID_DAYS = 60;    // how long the streets stay quiet after the raids
const ICE_RAID_CRIME = 9;    // crime removed while the agents are still working

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
  jenkins: { name: "Leroy Jenkins", icon: "🤝",
    line: "Came up through the neighborhoods, knows everyone, owes most of them.",
    staff: +2, police: 1, entRev: 1, mood: 0, approval: -2, crime: 3, tsuiStations: 2,
    crimeLabel: "Chief Jenkins, looking the other way",
    effects: ["Tsui family covers 2 stations' upkeep", "+2 staff needed at every Station and Prison", "+3 crime", "-2 approval", "Counts as a federal entanglement"] },
  mcgurk: { name: "Dirk McGurk", icon: "🔨",
    line: "Kicks doors first. The doors have stopped complaining.",
    staff: 0, police: 1.15, entRev: 0.9, mood: 0, approval: -4, crime: 0,
    effects: ["Police and Prisons 15% harder on crime", "Venues and Taverns earn 10% less", "-4 approval"] },
  quietmilk: { name: "Charles Quietmilk", icon: "🕊️",
    line: "Believes in second chances, block parties, and a light touch.",
    staff: -1, police: 1, entRev: 1.1, mood: +2, approval: 0, crime: 2.5,
    crimeLabel: "Chief Quietmilk, community first",
    effects: ["1 fewer staff at every Station and Prison", "Venues and Taverns earn 10% more", "+2 happiness", "+2.5 crime"] },
};

// ---- election challengers ----
// Each cycle the opposition runs someone whose platform is your worst number.
// If their issue is still bad on election day, the bar to win rises.
const CHALLENGER_FIRST = ["Marlene", "Dez", "Harriet", "Cole", "Priya", "Antoine", "June", "Wallace", "Rosa", "Emory", "Bea", "Terrence"];
const CHALLENGER_LAST = ["Okafor", "Whitfield", "Cho", "Delgado", "Pruitt", "Mabry", "Sandoval", "Greer", "Tookes", "Lindqvist", "Abernathy", "Fox"];
const AXES = {
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
const AXIS_ORDER = ["corruption", "crime", "traffic", "jobs", "mood", "change"];
function challengerCtx(pop, d, hap, S) {
  const fp = Math.floor(pop);
  const emp = Math.min(fp, d.jobs);
  return { crime: S.crime, ties: S.ties || 0, rigged: S.testified ? 0 : (S.rigged || 0),
           traffic: d.traffic || 0, unemp: fp > 0 ? Math.max(0, fp - emp) / fp : 0, hap };
}
function makeChallenger(seed, cycle, ctx) {
  const rnd = mulberry32((seed || 1) * 104729 + cycle * 131);
  const name = CHALLENGER_FIRST[Math.floor(rnd() * CHALLENGER_FIRST.length)] + " " +
               CHALLENGER_LAST[Math.floor(rnd() * CHALLENGER_LAST.length)];
  const axis = AXIS_ORDER.find((k) => AXES[k].test(ctx)) || "change";
  return { name, axis, label: AXES[axis].label };
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
  const since = (S.elected || 0) - (S.honeymoonAt || 0);
  // A successor inherits the chair, not the benefit of the doubt.
  const inherited = (S.heirCount || 0) > 0 ? 0.7 : 1;
  push("New administration goodwill", (since === 0 ? HM
    : since === 1 ? Math.max(0, HM * (1 - ((S.day % TERM_DAYS) / TERM_DAYS))) : 0) * inherited);
  push(`Time in office (${since} term${since === 1 ? "" : "s"})`, -Math.min(FATIGUE_CAP, FT * since));
  push(`Tax policy: ${T.name}`, T.approval);
  push(`Police funding: ${F.name}`, F.approval);
  if (H) push(`Doctrine: ${H.name}`, H.approval);
  if (CHF) push(`Chief ${CHF.name.split(" ").pop()}`, CHF.approval);
  if (EV && EV.approval) push(`Event: ${EV.name}`, EV.approval);
  push("Schools", Math.min(6, 1.2 * (d.learning || 0)));
  push("Clinics and hospitals", Math.min(8, 1.4 * (d.care || 0)));
  push("Loudspeakers", Math.min(7, 2.2 * (d.message || 0)));
  if (d.fastparkOn) push("Faststain Park", 4);
  if (d.monumentCount) push(`Chief memorials (${d.monumentCount})`, Math.min(6, 2 * d.monumentCount));
  if (d.cameras) push(`Cameras watching (${d.cameras})`, -Math.min(5, 0.9 * d.cameras));
  if (S.blackmail === 3 && S.day < (S.blackmailUntil || 0)) push("The Tsuis are talking to reporters", -7);
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
function legacyScore(st) {
  const items = [];
  const add = (label, val) => items.push([label, Math.round(val)]);
  add(`Days in office (${st.day})`, st.day);
  if (st.elected) add(`Terms won (${st.elected})`, st.elected * 800);
  add(`Peak population (${st.peakPop || 0})`, (st.peakPop || 0) * 12);
  if (st.money > 0) add(`Treasury left behind ($${st.money})`, st.money * 0.2);
  if (st.money < 0) add(`Debt left behind ($${Math.abs(st.money)})`, st.money * 0.35);
  if (st.heirCount) add(`Successors named (${st.heirCount})`, st.heirCount * 400);
  if (st.rigged) add(`Elections rigged (${st.rigged})`, -st.rigged * 250);
  if (st.graft) add(`Tsui money pocketed ($${st.graft})`, -st.graft * 0.2);
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
async function saveGame(st) {
  try {
    if (typeof window !== "undefined" && window.storage) {
      await window.storage.set(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, st }));
    }
  } catch (e) { /* storage is best-effort */ }
}

const EVENT_EVERY = 50;

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
  { id: "crimewatch", day: 9, title: "WATCH THE CRIME NUMBER", icon: "🚨",
    body: "Crime is the quiet killer in Luckhead. It drags down mood, and mood is the biggest single thing setting your approval. Let crime run and you will lose an election without ever knowing why.",
    tip: "Police cut it. So do Churches, Schools, and jobs. City Hall → Crime Report shows every single thing pushing it up or down." },
  { id: "transit", when: (st, d, fp) => fp >= 34,
    body: "Buses and Subways help most when they sit across the street from the busiest buildings: fully upgraded Houses (Apartments), Music Venues, and Factories. Those send the most trips onto the road, so relieving them does the most good.",
    title: "PUT TRANSIT WHERE THE CROWDS ARE", icon: "🚌",
    tip: "A stop next to a quiet corner of the map does almost nothing. Put it where the traffic is." },
  { id: "hall", day: 4, title: "CITY HALL IS YOUR DESK", icon: "🏛️",
    body: "Tap City Hall in the middle of the map. Everything you govern with is in there: the books, tax policy, police funding, and the field manual.",
    tip: "The map seed and your current administration are listed there too." },
  { id: "jobs", when: (st, d, fp) => fp > 0 && Math.max(0, fp - Math.min(fp, d.jobs)) >= 3,
    title: "PEOPLE NEED WORK", icon: "🏪",
    body: "The LABOR bar is red, which means residents with nothing to do. Unemployment drags happiness down and stalls immigration.",
    tip: "A Shop gives 3 jobs. Buildings only work if they touch a road and have power." },
  { id: "banks", day: 138, title: "THE BANKS ARRIVE", icon: "🏦",
    body: "Luckhead can support a financial district. Each Bank lifts industrial and commercial revenue 5 percent, shaves 4 percent off construction, and makes envelopes 5 percent cheaper. Up to three, and they stack.",
    tip: "Two staff each. They pay for themselves in a big town and bleed you in a small one." },
  { id: "honeymoon", day: 8, title: "THE TOWN LIKES YOU", icon: "🌤️",
    body: "New mayors get the benefit of the doubt. Your approval runs about 20 points higher through this first term, and it fades across your second.",
    tip: "Build something lasting while the polling is kind. It gets harder every term you serve." },
  { id: "books", day: 12, title: "MIND THE BOOKS", icon: "$",
    body: "Every building costs upkeep daily. Open The Books from City Hall to see what is earning and what is bleeding.",
    tip: "Income is taxes from homes, commercial trade, and industrial goods." },
  { id: "election", when: (st) => st.day >= 60 && st.elected === 0,
    title: "THE VOTE IS COMING", icon: "🗳️",
    body: "Luckhead votes on day 120 against a real opponent. Winning always takes 51 percent, but while their attack line about your town is true, it drains your approval every single day.",
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
  { id: "recession", name: "Economic Recession", icon: "📉", days: 60, weight: 3,
    body: "Orders have dried up nationwide. Factory output is worth far less until the market turns.",
    tag: "Industrial revenue -40%", goods: 0.6 },
  { id: "boom", name: "Economic Boom", icon: "📈", days: 60, weight: 3,
    body: "Luckhead's factories cannot fill orders fast enough. Everything they ship is worth more.",
    tag: "Industrial revenue +20%", goods: 1.2, good: true },
  { id: "strike", name: "Bus Drivers' Strike", icon: "🚏", days: 60,
    // Nobody can strike a transit system you have not built yet.
    needs: (st) => st.grid.filter((c) => c && (c.type === "bus" || c.type === "subway") && !c.build).length >= 2,
    body: "The transit union has walked out. Every Bus Station sits idle and the traffic they were absorbing is back on your streets.",
    tag: "Bus network offline", noTransit: true },
  { id: "heatwave", name: "Heat Wave", icon: "🌡️", days: 30,
    body: "Air conditioners everywhere. Power plants strain to keep up and tempers are short.",
    tag: "Plant output -25%, happiness -6", plantGen: 0.75, mood: -6 },
  { id: "flu", name: "Flu Season", icon: "🤒", days: 40,
    body: "Half the town is out sick. Businesses run short-handed and clinics are overwhelmed.",
    tag: "Workforce -20%, care halved", labor: 0.8, care: 0.5 },
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
    tag: "Crime pressure +5", crime: 5 },
  { id: "grant", name: "Federal Grant", icon: "🏦", days: 1,
    body: "A state infrastructure program has selected Luckhead. The cheque cleared this morning.",
    tag: "One-time payment", cash: 400, good: true },
  { id: "storm", name: "Severe Storm", icon: "⛈️", days: 25,
    body: "Wind damage across the city. Roads are half blocked and crews are working around the clock.",
    tag: "Traffic +50%, upkeep +30%", traffic: 1.5, upkeep: 1.3 },
  { id: "festival", name: "Founders' Festival", icon: "🎪", days: 20,
    body: "The whole town turns out. Bunting everywhere, and for a few weeks nobody minds the potholes.",
    tag: "Happiness +10, approval +5", mood: 10, approval: 5, good: true },
  { id: "snow", name: "Snowpocalypse", icon: "❄️", days: 5,
    body: "Two inches of snow. Two. Every driver in Luckhead has forgotten how roads work, half of them are sideways in a ditch, and the entire city has stopped moving.",
    tag: "City-wide gridlock for five days", traffic: 1.8, trafficFloor: 0.92 },
  { id: "film", name: "Movie Filming in Luckhead", icon: "🎬", days: 30,
    body: "A production has taken over half the city. Shops cannot keep up with the crews, the streets are closed at random, and your officers are spending their shifts guarding a catering truck.",
    tag: "Commercial +20%, traffic up, police distracted", trade: 1.2, traffic: 1.2, crime: 3, good: true },
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
  protestMul: st.protest === 2 ? 0.7 : st.protest === 3 ? 1.25 : 1,
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
  churchMul: st.faithStance === "refuse" ? 0.7 : 1,
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
const CRIME_DRIFT = 0.85;    // how fast the crime bar chases its pressure
const SHOOTING_ODDS = 1 / 150;   // a bad night, roughly this often
const SHOOTING_WAR = 2.2;        // and more often once the family is at odds with you
const SHOOTING_SHOCK = 20;       // days of frozen immigration and a subdued town
const PROTEST_MOOD = 20;     // below this the town starts gathering
const PROTEST_DAYS = 3;      // consecutive days of it before they march
const INDICT_WARN_HEAT = 80;   // last call before the file closes
const FED_TRIGGER = 3;
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



const CRIME_THRESHOLD = 35;
const TERM_DAYS = 120;
const WARN_DAY = 20;    // poll lands on day 100 of each 120-day term
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
  return { grid, terrain, seed: useSeed, diff: DF, money: DIFFICULTY.economy[DF.economy].cash, pop: 4, day: 1, seq: 20, mafia: "none", crime: 0, calm: 0, approval: 60, env: START_ENV, over: false, elected: 0, deal: 0, nextTalk: 0, ledger: [], tax: "normal", fund: "normal", polled: 0, rigged: 0, unlocked: 0, gear: false, chief: 0, smuggleOffer: 0, venueDay: 0, venueOffer: 0, backroom: false, fed: 0, heat: 0, ties: 0, testified: false, reprisal: 0, dayUnlocked: 0, heir: null, succession: 0, honeymoonAt: 0, tsuiReturn: 0, event: null, eventEnds: 0, eventSeen: 0, nextEvent: EVENT_EVERY, hintsSeen: [], lossWarned: 0, peakPop: 4, graft: 0, heirCount: 0, challenger: null, lastElection: null, electionSeen: 0, tsuiWar: 0, chiefHit: 0, chiefKilled: 0, deadChiefs: [], vacancyReason: "opening", justBroke: false, pendingMonument: null, monuments: [], broke: false, theatreDay: 0, bust: 0, bustUntil: 0, chiefId: null, chiefShake: 0, pvisit: 0, faithMeet: 0, faithStance: "none", loans: 0, loanOffer: 0, bribes: 0, bribeLocal: [], bribeTrade: [], bribeStain: [], campaign: 0, campaignUntil: 0, modalGap: 0, ice: 0, iceUntil: 0, graffiti: 0, graffitiUntil: 0, graffitiSeen: 0, billboardDay: 0, riot: 0, riotUntil: 0, riotSeen: 0, prisonDay: 0, viral: 0, viralSeen: 0, viralAck: 0, hideawayFirstDay: 0, blackmail: 0, blackmailSeen: 0, blackmailUntil: 0, firstHeirDay: 0, arsonDay: 0, arsonCount: 0, lastArson: null, arsonAck: 0, indictWarn: 0, protest: 0, protestUntil: 0, moodLowDays: 0, protestsSeen: 0, strike: 0, strikeUntil: 0, strikeCool: 0, wageMul: 1, strikesSeen: 0, schoolDemand: 0, cop: 0, copUntil: 0, copCool: 0, copWage: 1, doctrine: 0, doctrineCool: 0, lowWarn: 0, envWarn: 0, homelessWarn: 0, shooting: 0, shootingUntil: 0, shootingDead: 0, shootingsSeen: 0, river: 0, riverUntil: 0, riverCool: 0, riversSeen: 0, riversCleaned: 0, riverBuriedDay: 0, pothole: 0, potholeCool: 0, potholeTile: null, potholesSeen: 0, testifiedDay: 0, testifiedTies: 0, press: 0, pressDue: 0, hintsOn: null, soundOn: true, musicOn: true, musicSet: Math.floor(Math.random() * MUSIC_SETS.length), invest: 0, investCool: 0, investTook: 0, pendingFactory: 0, speech: 0, promise: null, promiseDay: 0, promiseSeq: 0, promiseBroken: 0, promiseKept: 0, log: [], logSeq: 0, dismissed: [] };
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
  const envPlants = grid.filter((c) => c && c.type === "plant" && !c.build
    && (c.lv || 0) < maxLevel("plant")).length;          // a fully upgraded plant runs clean
  const envGreen = grid.filter((c) => c && !c.build
    && (c.type === "park" || c.type === "fastpark" || c.type === "monument")).length;
  const envTransit = grid.filter((c) => c && !c.build
    && (c.type === "bus" || c.type === "subway")).length;
  const CH = CHIEFS[flags.chiefId] || null;
  const chiefStaff = CH ? CH.staff : 0;
  const copMul = (CH ? CH.police : 1) * (flags.shake ? 0.5 : 1) * (flags.protestMul || 1);
  const entRevMul = CH ? CH.entRev : 1;
  let waivedStations = 0, churchTax = 0;
  const H = HEIRS[heirKey] || null;
  if (EV && EV.labor && workforce !== Infinity) workforce = Math.floor(workforce * EV.labor);
  const pollMul = (H ? H.pollution : 1) * (flags.pollCut || 1);
  const leisure = H ? H.leisure : 1;
  const T = TAX[taxKey] || TAX.normal;
  const F = FUND[fundKey] || FUND.normal;
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
  const status = {};
  let powerCap = 0, powerDemand = 0, popCap = 0, jobs = 0, upkeep = 0, revenue = 0;
  let billboardMsg = 0;   // accumulated in pass 1; folded into message below
  let upPower = 0, upIndustry = 0, upCivic = 0, goods = 0, smuggling = 0;
  let guard = null, hallJobs = 0;
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
    if (cell.type === "road" || cell.type === "bridge") { const ru = statsOf(cell).upkeep || 0; upkeep += ru; upCivic += ru; }
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
    if (cell.type === "billboard") {
      if (cell.build > 0) { status[i] = { connected: true, powered: true, functioning: false, staffed: true, building: true }; anyBuilding = true; return; }
      const bb = statsOf(cell); status[i] = { connected: true, powered: true, functioning: !flags.graffiti, staffed: true };
      const bu = civicCost(bb.upkeep); upkeep += bu; upCivic += bu;
      if (!flags.graffiti) billboardMsg += (bb.message || 0.75) * (flags.campaign ? 1.3 : 1);
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
  const buses = [], shops = [], venues = [], schools = [], prisons = [];
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
    if (cell.type === "shop") { jobs += b.jobs; shops.push([i, b.rev || 0, smogPenalty * crew * shopRevMul]); targets.push([r, c]); }
    if (cell.type === "factory") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      goods += Math.round((b.rev || 0) * (cell.smuggle ? 2 : 1) * crew * (flags.retrofit || 1)); if (cell.smuggle) smuggling += 1; targets.push([r, c]); }
    if (cell.type === "police") { const cu = Math.round(civicCost(b.upkeep) * F.upkeep * (flags.copWage || 1));
      jobs += Math.max(1, b.jobs + F.staff + chiefStaff);
      if (CH && CH.tsuiStations && waivedStations < CH.tsuiStations) waivedStations++;
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
        faith += (b.faith || 2) * crew * (flags.faithStance === "attend" ? 1.25 : 1) * (flags.churchMul || 1);
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
      }
    }
    if (cell.type === "library" || cell.type === "histcenter") { const cu = civicCost(b.upkeep); jobs += b.jobs; upkeep += cu; upCivic += cu; eduBuff += (b.edu || 0.35) * crew; }
    if (cell.type === "stadium") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      revenue += Math.round((b.rev || 0) * smogPenalty * crew * leisure * entRevMul);
      stadiumCrime += (b.crime || 4) * crew; targets.push([r, c]); }
    if (cell.type === "venue") { jobs += b.jobs; upkeep += indUp(b.upkeep); upIndustry += indUp(b.upkeep);
      revenue += Math.round(b.rev * smogPenalty * crew * leisure * venueRevMul * entRevMul); cheer += (b.cheer || 6) * smogPenalty * crew * leisure; rowdiness += (b.rowdy || 2.5) * crew;
      venues.push([r, c]); targets.push([r, c]); }
    if (cell.type === "speaker") { const cu = Math.round(civicCost(b.upkeep) * (flags.campaign ? 2 : 1));
      upkeep += cu; upCivic += cu; message += (b.message || 1) * (flags.campaign ? 1.3 : 1); }
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
      care += (b.care || 1) * smogPenalty * crew; medical.push([r, c]); }
    if (cell.type === "prison") { const cu = civicCost(b.upkeep); jobs += Math.max(1, b.jobs + chiefStaff); upkeep += cu; upCivic += cu; held += flags.riotOn ? 0 : (b.hold || 4) * crew * (flags.bustArrest ? 1.1 : 1) * copMul; if (b.gloom) prisons.push([r, c, b.gloom]); }
    if (cell.type === "bus" || cell.type === "subway") { const cu = civicCost(b.upkeep); jobs += b.jobs; upkeep += cu; upCivic += cu;
      buses.push([r, c, (b.relief || 0.4) * crew, (b.relief || 0.4) * crew * (cell.type === "subway" ? 0.165 : 0.14)]); }
  });

  // Libraries and the History Center sharpen every school. The buff scales the
  // learning already produced, capped so a stack of archives can't run away.
  const eduMul = 1 + Math.min(0.6, eduBuff);
  learning = learning * eduMul;

  // Shop demand: the town supports one shop per 10 residents at full price.
  // Each shop past that captures a shrinking slice of what is left.
  const SHOP_CATCHMENT = 10;
  const supported = (workforce === Infinity ? 0 : workforce) / SHOP_CATCHMENT;
  let shopDemand = 0;
  shops
    .sort((a, b) => grid[a[0]].seq - grid[b[0]].seq)
    .forEach(([i, rev, smogPenalty], k) => {
      // full rate while shops still fit inside the catchment, then taper
      const share = k < supported ? 1 : Math.max(0.15, supported / (k + 1));
      const earned = Math.round(rev * share * smogPenalty);
      status[i].demand = share;
      status[i].earned = earned;
      revenue += earned;
      shopDemand += share;
    });
  const shopSaturation = shops.length ? shopDemand / shops.length : 1;

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
  const ROAD_CAPACITY = 6;
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
  let traffic = roadCount ? Math.min(1, (jamSum / roadCount) * (1 - globalRelief) * (EV && EV.traffic ? EV.traffic : 1) * (flags.iceOn ? 1.15 : 1)) : 0;
  // Some events do not scale what you had, they simply stop the city.
  if (EV && EV.trafficFloor && roadCount) traffic = Math.max(traffic, EV.trafficFloor);

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
  const revenueNet = Math.round(revenue * (1 - 0.35 * traffic) * (EV && EV.trade ? EV.trade : 1) * (flags.iceOn ? 0.85 : 1));

  // Where the environment is heading. 100 is pristine. Industry drags it down,
  // green space pulls it back, and the doctrine you govern under colours all of
  // it. The bar itself drifts toward this in step() rather than snapping.
  const envTarget = Math.max(0, Math.min(100,
    100
    - 7 * envStacks * (flags.envDirty || 1)
    - 9 * envPlants * (flags.envDirty || 1)
    - 24 * traffic
    + 4 * envGreen
    + 1.5 * envTransit
    + (flags.envCleaned ? 8 : 0)
  ));
  return { status, powerCap, powerDemand, popCap, housing: popCap, jobs, upkeep, upPower, upIndustry, upCivic,
           revenue: revenueNet, revenueGross: revenue, traffic, congested, orphanRoads, envAvg, tavernMood,
           goods, learning, held, care, message, theatreOn, hideawayOn, plazaOn, fastparkOn, fastparkTax, churchTax, schoolTax, waterTax, bankCount, monumentCount, transit, buses: buses.length, venues: venues.length, rowdiness, smuggling, hallJobs, globalRelief, shops: shops.length, shopSaturation, supported,
           anyDisc, anyUnwired, anyOverload, anyUnstaffed, anyBuilding, plantBuilt, policeFrac,
           copPosts: cops, crimeTargets: targets, hallGuard: guard,
           taverns: taverns.length, stadiumCrime, eduBuff, schoolCount: schools.length, cameras, churchWeight, churchCount: Math.round(churchWeight), loudChurches,
           envTarget, env: flags.env === undefined ? START_ENV : flags.env,
           envStacks, envPlants, envGreen, envTransit,
           protestMood: flags.protestMood || 0, grace: flags.grace === undefined ? 1 : flags.grace, faith };
}

const homelessRate = (pop, d) => {
  const fp = Math.floor(pop);
  return fp > 0 ? Math.max(0, fp - (d.housing || 0)) / fp : 0;
};

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
  let h = 58 + d.envAvg + d.tavernMood + Math.min(10, 1.6 * (d.care || 0)) + (d.protestMood || 0) - unemp * gr - homeless * gr - piety - loudPenalty - envPain - 24 * (d.traffic || 0);
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
  const F = FUND[prev.fund] || FUND.normal;
  const H = HEIRS[prev.heir] || null;
  const CHF = CHIEFS[prev.chiefId] || null;
  const EV = eventById(prev.event);
  const DP = diffOf(prev.diff);
  const d = derive(prev.grid, Math.floor(prev.pop), prev.tax, prev.fund, prev.terrain, prev.heir, prev.event, { bustArrest: prev.bust === 2, bustPardon: prev.bust === 3, chiefId: prev.chiefId, shake: (prev.chiefShake || 0) > prev.day, faithStance: prev.faithStance, campaign: (prev.campaignUntil || 0) > prev.day, tradeBribes: (prev.bribeTrade || []).filter((d) => d > prev.day).length, upkeepMul: DP.economy.upkeep, graffiti: prev.graffiti === 1, riotOn: prev.riot === 1, iceOn: prev.ice === 2, ...protestFlags(prev), ...strikeFlags(prev), ...copFlags(prev), ...faithFlags(prev), ...riverFlags(prev), grace: earlyGrace(prev.day), env: prev.env });
  const baseHap = calcHap(prev.pop, d, prev.mafia, prev.crime);
  const hap = baseHap + (H ? H.mood : 0) + (CHF ? CHF.mood : 0) + (EV && EV.mood ? EV.mood : 0);
  let pop = prev.pop;
  const overCap = pop >= d.popCap;
  if (overCap && hap >= 30) {
    // People keep arriving even with nowhere to live, just far more slowly.
    const room = Math.max(0, d.popCap * 1.35 - pop);
    if (room > 0) pop = Math.min(d.popCap * 1.35, pop + Math.min(room, 0.06 * T.growth));
  } else if (pop > d.popCap * 1.35) pop = Math.max(d.popCap * 1.35, pop - 2);
  else if (hap >= 45 && pop < d.popCap && prev.ice !== 2
      && (prev.day + 1) >= (prev.shootingUntil || 0)
      && !((prev.tsuiWar || 0) > 0 && (prev.day + 1) < prev.tsuiWar + 40))
    pop = Math.min(d.popCap, pop + (0.25 + hap / 95) * T.growth * (EV && EV.growth ? EV.growth : 1) * (d.hideawayOn ? 1.12 : 1) * (prev.faithStance === "attend" ? 0.94 : 1) * (1 + Math.min(0.35, 0.06 * d.learning)));
  else if (hap < 28 && pop > 0) pop = Math.max(0, pop - 1);
  const employed = Math.min(Math.floor(pop), d.jobs);

  let mafia = prev.mafia, calm = prev.calm, mafiaMoney = 0;
  let tsuiReturn = prev.tsuiReturn || 0;
  if (mafia === "none" && tsuiReturn > 0 && prev.day + 1 >= tsuiReturn) { mafia = "choice"; tsuiReturn = 0; }
  else if (mafia === "none" && tsuiReturn === 0 && Math.floor(pop) >= MAFIA_POP) mafia = "choice";
  if (mafia === "allied") mafiaMoney = kickbackFor(prev.deal, prev.rigged) + (prev.backroom ? 10 : 0);

  // Crime exists in every state. The mob just makes it much worse.
  const reprisal = prev.reprisal > 0 ? prev.reprisal - 1 : 0;
  const crimeRows = crimeLedgerRows({ mafia, reprisal, testified: prev.testified, rigged: prev.rigged,
    pop, backroom: prev.backroom, fund: prev.fund, heir: prev.heir, event: prev.event, gear: prev.gear,
    day: prev.day, bustUntil: prev.bustUntil, chiefId: prev.chiefId }, d);
  const pressure = crimeRows.reduce((a, [, v]) => a + v, 0) * DP.crime.pressure * CRIME_DRIFT;
  // Nothing happens in the first ten days. Nobody has had time to do anything.
  const CRIME_GRACE = 10;
  let crime = prev.day + 1 <= CRIME_GRACE ? 0 : Math.min(100, Math.max(0, prev.crime + pressure));
  if (mafia === "refused") {
    mafiaMoney = -Math.round(crime / 6 * DP.crime.mob);
    if (crime <= 5) { calm += 1; if (calm >= 12) { mafia = "defeated"; crime = 0; } }
    else calm = 0;
  }

  const schoolPride = Math.min(6, 1.2 * d.learning) + Math.min(8, 1.4 * (d.care || 0)) + Math.min(7, 2.2 * (d.message || 0)) + (d.fastparkOn ? 4 : 0) + Math.min(6, 2 * (d.monumentCount || 0));
  // A declared challenger's attack line drains approval every day it stays
  // true, and stops the day the issue is fixed.
  const attackCtx = challengerCtx(pop, d, hap,
    { crime, ties: entanglements({ ...prev, mafia }), rigged: prev.rigged, testified: prev.testified });
  const attack = challengerAttack(prev.challenger, attackCtx).drag;
  // The presidential visit lingers with the base either way, until a
  // successor gives the town somebody new to judge.
  const apRows = approvalRows({ ...prev, pop, crime, mafia,
    challengerDrag: attack, challengerLabel: prev.challenger ? prev.challenger.label : "" }, d, baseHap);
  const target = apRows.reduce((a, [, v]) => a + v, 0);
  let approval = prev.approval + (target - prev.approval) * DP.politics.inertia;
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
  if (prev.chiefId && prev.chiefId !== "mcgurk" && day > CRIME_GRACE && Math.floor(pop) >= 45 && shooting === 0
      && day >= shootingUntil) {
    const feud = (mafia === "refused" || mafia === "defeated") ? SHOOTING_WAR : 1;
    if (evRoll(113) < SHOOTING_ODDS * feud) {
      // Two to ten, and never more people than the town actually has.
      const toll = Math.min(Math.floor(pop), 2 + Math.floor(evRoll(127) * 9));
      if (toll >= 2) {
        shootingDead = toll;
        shootingUntil = day + SHOOTING_SHOCK;
        shootingsSeen = shootingsSeen + 1;
        shooting = 2;
        note("🕯️", "GANG SHOOTING", `${toll} dead overnight on the east side. Nobody is moving here for ${SHOOTING_SHOCK} days.`, "bad");
        pop = Math.max(0, pop - toll);
      }
    }
  }
  if (mafia === "allied" && prev.nextTalk > 0 && day >= prev.nextTalk) mafia = "renegotiate";
  // Federal heat. Opens once you are deep enough in, then tracks how visible
  // the arrangement is: more deals and more crime mean faster.
  const ties = entanglements({ ...prev, mafia });
  let fed = prev.fed || 0;          // 0 none, 1 open file, 2 indicted
  let heat = prev.heat || 0;
  if (fed === 0 && ties >= FED_TRIGGER) fed = 1;
  if (fed === 1) {
    // Roughly 100 days of exposure at three ties with no defences, and a
    // committed law-and-order town can hold the line indefinitely.
    const exposure = (0.32 * ties + crime / 90) * DP.crime.heat * (prev.viral === 1 ? 1.4 : 1);
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
  if (speech === 0 && toVote === SPEECH_BEFORE && day > CRIME_GRACE) speech = 1;
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

  if (campaign !== 1 && speakerCount >= 2 && toVote === 30
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
  if (strike === 0 && anySchool && day > strikeCool && evRoll(71) < STRIKE_ODDS) {
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
  if (river === 0 && stacks >= 2 && day > RIVER_DAY && day > riverCool
      && evRoll(139) < RIVER_ODDS * (stacks / 2)) {
    river = 1;
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
  if (pothole === 0 && day > potholeCool && day > CRIME_GRACE && evRoll(151) < POTHOLE_ODDS * (T.potholeMul || 1)) {
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
  moodLowDays = baseHap < PROTEST_MOOD ? moodLowDays + 1 : 0;
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
    const total = pool.reduce((a, e) => a + (e.weight || 1), 0);
    let roll = mulberry32((prev.seed || 1) * 7919 + day)() * total;
    let pick = pool[pool.length - 1];
    for (const e of pool) { roll -= (e.weight || 1); if (roll <= 0) { pick = e; break; } }
    event = pick.id;
    eventEnds = day + pick.days;
    eventSeen = eventSeen + 1;
    nextEvent = day + EVENT_EVERY;
    note(pick.icon, pick.name.toUpperCase(), pick.tag, pick.good ? "good" : "bad");
  }

  // Day-gated unlocks announce themselves once.
  let dayUnlocked = prev.dayUnlocked || 0;
  if (dayUnlocked === 0 && day >= UNLOCK_DAY.speaker) dayUnlocked = 1;

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
    chiefHit = prev.chiefId ? day + 5 : 0;   // no chief to kill, no hit
  }
  // Severing agreements: the back room closes and factory smuggling stops.
  let backroom = justRefused ? false : prev.backroom;

  // The hit lands. The chief is gone; the mayor must appoint another, and the
  // fallen chief gets a park.
  let chiefId = prev.chiefId;
  let pendingMonument = prev.pendingMonument || null;
  let chiefKilled = prev.chiefKilled || 0;
  let deadChiefs = prev.deadChiefs || [];
  let vacancyReason = prev.vacancyReason || (prev.chiefId ? "" : "opening");
  if (chiefHit > 0 && day >= chiefHit && chiefId) {
    const survivorsAfter = Object.keys(CHIEFS).filter((k) => k !== chiefId && !deadChiefs.includes(k));
    if (survivorsAfter.length === 0) {
      chiefHit = 0;   // the last possible chief survives; someone must run the department
    } else {
      pendingMonument = CHIEFS[chiefId] ? CHIEFS[chiefId].name : null;
      chiefKilled = (prev.chiefKilled || 0) + 1;
      note("🔪", "THE CHIEF IS DEAD", `${CHIEFS[chiefId] ? CHIEFS[chiefId].name : "The chief"} was killed in a Tsui reprisal. Name a successor.`, "bad");
      deadChiefs = [...deadChiefs, chiefId];       // barred for the rest of the game
      vacancyReason = "assassinated";
      chiefId = null;
      chiefHit = 0;
    }
  }

  // While the war with the family runs, Vincent's people set fires. Every 7
  // days there is a 35% chance an arsonist levels a building, favoring police
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
  // Fifteen days after you break with them, one goes up. Not a roll, a promise.
  const reprisalDue = tsuiWar > 0 && sinceWar === 15 && arsonDay !== day;
  // Otherwise the fires come on a weekly cadence, hotter while the war is fresh.
  const warHeat = sinceWar >= 0 && sinceWar <= 60 ? 0.40 : 0.25;
  const weeklyDue = atOddsWithTsui && day % 11 === 0 && arsonDay !== day
    && evRoll(53) < warHeat;
  if (reprisalDue || weeklyDue) {
      // Score every standing, finished building. Police first, then by the
      // dollars sunk into it, so the arsonist always takes something that hurts.
      const candidates = [];
      prev.grid.forEach((c, i) => {
        if (!c || c.build) return;
        if (c.type === "hall" || c.type === "hallpart") return;   // never City Hall
        if (c.type === "road" || c.type === "bridge" || c.type === "line") return;  // infrastructure, not a "building"
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
  if (untilVote <= LOSS_WARN_DAY && lossWarned <= cycle && Math.round(prev.approval) < 51) {
    lossWarned = cycle + 1;
  }
  let polled = prev.polled, challenger = prev.challenger;
  if (untilVote <= WARN_DAY && polled <= cycle) {
    polled = cycle + 1;
    challenger = makeChallenger(prev.seed, cycle,
      challengerCtx(pop, d, hap, { crime, ties, rigged: prev.rigged, testified: prev.testified }));
  }
  let over = prev.over, elected = prev.elected, succession = prev.succession || 0;
  let musicSet = prev.musicSet === undefined ? 0 : prev.musicSet;
  let broke = prev.broke || false;
  if (fed === 2) over = true;
  let lastElection = prev.lastElection, electionSeen = prev.electionSeen || 0;
  if (day % TERM_DAYS === 0) {
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
      musicSet = pickMusicSet(prev.musicSet); }
    else over = true;
  }

  const taxes = Math.round(Math.floor(pop) * T.taxRate) + (d.fastparkTax || 0) + (d.churchTax || 0) + (d.schoolTax || 0) + (d.waterTax || 0);
  const windfall = (event && event !== prev.event && eventById(event)?.cash) || 0;
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
  const entry = { day, taxes, trade: d.revenue, goods: d.goods, power: -d.upPower,
    industry: -d.upIndustry, civic: -d.upCivic, mob: mafiaMoney, windfall, notes };
  const ledger = [...(prev.ledger || []), entry].slice(-7);

  const net = taxes + d.revenue + d.goods - d.upkeep + mafiaMoney + windfall;
  const money = prev.money + net;
  if (money <= DEBT_FLOOR) { over = true; broke = true; }
  const log = newEntries.length ? [...(prev.log || []), ...newEntries].slice(-LOG_KEEP) : (prev.log || []);
  return { ...prev, musicSet, log, logSeq, env, speech, promise, promiseDay, promiseSeq, promiseBroken, promiseKept, pop, money, broke, day, mafia, crime, calm, approval, over, elected, ledger, polled, lossWarned, unlocked, chief, smuggleOffer, venueDay, venueOffer, fed, heat, ties, reprisal, dayUnlocked, succession, tsuiReturn, event, eventEnds, eventSeen, nextEvent, challenger, lastElection, electionSeen, theatreDay, bust, pvisit, faithMeet, campaign, loanOffer, tsuiWar, chiefHit, chiefKilled, deadChiefs, vacancyReason, pendingMonument, chiefId, backroom, justBroke: false, ice, iceUntil, graffiti, graffitiUntil, graffitiSeen, billboardDay, riot, riotUntil, riotSeen, prisonDay, viral, viralSeen, viralAck, hideawayFirstDay, blackmail, blackmailSeen, blackmailUntil: prev.blackmailUntil || 0, arsonDay, arsonCount, lastArson, arsonAck, indictWarn, protest, protestUntil, moodLowDays, protestsSeen, strike, strikeUntil, strikeCool, strikesSeen, schoolDemand, cop, copUntil, copCool, doctrine, doctrineCool, lowWarn, envWarn, homelessWarn, shooting, shootingUntil, shootingDead, shootingsSeen, invest, investCool, river, riverUntil, riverCool, riversSeen, pothole, potholeCool, potholeTile, potholesSeen, press,
    peakPop: Math.max(prev.peakPop || 0, pop), graft: (prev.graft || 0) + (mafiaMoney > 0 ? mafiaMoney : 0) };
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
const MUSIC_FADE_IN = 2.5;    // seconds for trouble to kick in
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
  let musicBus = null, tenseGain = null, tenseOn = false;
  let bufSources = [], streamEls = [], curSetIdx = -1;
  const stopAllMusic = () => {
    bufSources.forEach((s) => { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} });
    bufSources = [];
    streamEls.forEach((el) => { try { el.pause(); } catch (e) {} el.src = ""; });
    streamEls = [];
    if (musicBus) { try { musicBus.disconnect(); } catch (e) {} musicBus = null; }
    tenseGain = null;
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
    const mainGain = c.createGain();
    mainGain.gain.value = MUSIC_MAIN_VOL;
    mainGain.connect(musicBus);
    tenseGain = c.createGain();
    tenseGain.gain.value = tenseOn ? MUSIC_TENSE_VOL : 0.0001;
    tenseGain.connect(musicBus);
    return mainGain;
  };

  // Preferred path. Whole files decoded into memory, looped by the audio clock,
  // so the two layers are locked to the sample and the seam is exact.
  const startBuffered = (c, set) =>
    Promise.all([grab(c, MUSIC_BASE + set.main), grab(c, MUSIC_BASE + set.tense)])
      .then(([mainBuf, tenseBuf]) => {
        const mainGain = buildBus(c);
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
      const mainGain = buildBus(c);
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
    if (!tenseGain || !ctx) return;
    const g = tenseGain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(on ? MUSIC_TENSE_VOL : 0.0001,
      t + (on ? MUSIC_FADE_IN : MUSIC_FADE_OUT));
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
  const [pickHints, setPickHints] = useState(true);
  const lastSave = useRef(0);

  // Load a saved city once, on launch. Anything malformed starts fresh.
  useEffect(() => {
    let alive = true;
    let loadedSave = false;
    (async () => {
      try {
        if (typeof window !== "undefined" && window.storage) {
          const r = await window.storage.get(SAVE_KEY);
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
  const [crimeReport, setCrimeReport] = useState(false);
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
  const d = useMemo(() => derive(st.grid, Math.floor(st.pop), st.tax, st.fund, st.terrain, st.heir, st.event, { bustArrest: st.bust === 2, bustPardon: st.bust === 3, chiefId: st.chiefId, shake: (st.chiefShake || 0) > st.day, faithStance: st.faithStance, campaign: (st.campaignUntil || 0) > st.day, tradeBribes: (st.bribeTrade || []).filter((d) => d > st.day).length, upkeepMul: diffOf(st.diff).economy.upkeep, graffiti: st.graffiti === 1, riotOn: st.riot === 1, iceOn: st.ice === 2, ...protestFlags(st), ...strikeFlags(st), ...copFlags(st), ...faithFlags(st), ...riverFlags(st), grace: earlyGrace(st.day), env: st.env }), [st.grid, st.pop, st.tax, st.fund, st.terrain, st.heir, st.event, st.bust, st.chiefId, st.chiefShake, st.day, st.faithStance, st.bribeTrade, st.campaignUntil, st.diff, st.graffiti, st.riot, st.ice, st.protest, st.strike, st.strikeUntil, st.wageMul, st.cop, st.copUntil, st.copWage, st.doctrine, st.faithStance, st.river, st.riverUntil, st.riversCleaned, st.env]);
  const hap = calcHap(st.pop, d, st.mafia, st.crime);
  const fp = Math.floor(st.pop);
  const employed = Math.min(fp, d.jobs);
  const kick = kickbackFor(st.deal, st.rigged);
  const newKick = kickbackFor(st.deal + 1, st.rigged);
  const mafiaMoney = st.mafia === "allied" ? kick : st.mafia === "refused" ? -Math.round(st.crime / 6) : 0;
  const net = Math.round(fp * T.taxRate) + d.revenue + d.goods - d.upkeep + mafiaMoney;
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
      audio.current.startMusic(st.musicSet || 0);
    }
  }, [audioReady]);

  // New term, new theme. The set is chosen on each win and stored in state;
  // startMusic ignores a repeat index, so this only ever fires a real switch.
  useEffect(() => {
    if (audioReady && audio.current) audio.current.startMusic(st.musicSet || 0);
  }, [st.musicSet, audioReady]);

  // The tense layer rises when any of these is true and drains once all clear:
  // crime past 50, approval under 50, or an election ten days out or closer.
  const tenseMusic = st.crime > 50 || st.approval < 50 || toElection <= 10;
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
    ? { pop: null, day: UNLOCK_DAY.speaker, title: "A VOICE FROM ABOVE", keys: ["speaker"],
        body: "A contractor has offered the city a network of civic loudspeakers. Hourly announcements, uplifting music, reminders of who runs this town. Approval rises wherever they reach.",
        tip: "Keep them away from Taverns and Schools. Nobody learns or drinks well over a public address system." }
    : null;
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
  const mustPickChief = st.day >= 7 && !st.chiefId && !st.over;

  // One interruption at a time, and never two within MODAL_GAP days. Anything
  // held back keeps its flag and simply waits its turn.
  const pendingModals = [
    ["heir", showHeir], ["vote", showVote], ["fed", showFed], ["indict", showIndict], ["protest", showProtest], ["arson", showArson], ["viral", showViral], ["speech", showSpeech], ["invest", showInvest], ["river", showRiver], ["strike", showStrike], ["cop", showCop], ["doctrine", showDoctrine], ["chief", showChief],
    ["ice", showIce], ["blackmail", showBlackmail],
    ["loan", showLoan], ["pvisit", showPvisit], ["bust", showBust],
    ["smuggle", showSmuggle], ["venue", showVenue], ["faith", showFaith],
    ["campaign", showCampaign], ["event", showEvent],
  ].filter(([, on]) => on).map(([k]) => k);
  const queueLen = pendingModals.length;
  const cooling = (st.modalGap || 0) > st.day;
  const active = mustPickChief ? null : (queueLen && !cooling ? pendingModals[0] : null);
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
  useEffect(() => { if (active) sfx(
    active === "arson" ? "fire"
    : active === "shooting" ? "gunshot"
    : active === "pothole" ? "quake"
    : active === "indict" || active === "fed" || active === "lowwarn" ? "bad"
    : "alert"); }, [active]);
  useEffect(() => { if (st.over) sfx("lose"); }, [st.over]);

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
    const next = { ...freshState(seed, diff || pickDiff), hintsOn: pickHints };
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
    if (Math.round(st.approval) < 51 && toElection <= WARN_DAY) return `Approval is under 51 with the election in ${toElection} days. Parks, jobs, and prayers.`;
    if (fp >= 6 && d.jobs < fp * 0.7) return "Unemployment is brewing. Shops and Factories make jobs.";
    if (hap < 40) return "Morale is low. Parks near homes, factories far from them.";
    if (st.money < 50 && net <= 0) return st.tax === "none" ? "The treasury is empty and you collect no taxes. Something has to give." : "The treasury is thin. Residents and jobs pay taxes.";
    const pool = st.mafia === "allied" ? FLAVOR.concat(MAFIA_FLAVOR) : FLAVOR;
    return pool[Math.floor(st.day / 2) % pool.length];
  };

  const describe = (cell, s) => {
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
    const pct = s.crew === undefined ? 1 : s.crew;
    const state = !s.connected ? "no road access" : !s.powered ? "no power"
      : pct <= 0 ? "no staff at all, closed"
      : pct < 1 ? `running at ${Math.round(pct * 100)}% staffing`
      : "running";
    const econ = econOf(cell.type, cell);
    const crew = b.jobs ? ` Needs ${b.jobs} workers${pct < 1 && pct > 0 ? `, has ${Math.round(b.jobs * pct)}` : ""}.` : "";
    let extra = (cell.type === "bus" || cell.type === "subway") ? (d.transit ? " Transit network active." : " Idle: needs a second stop somewhere in town.") : "";
    if (cell.type === "shop" && s.demand !== undefined) {
      extra = ` Earning $${s.earned}/day at ${Math.round(s.demand * 100)}% of full demand.` +
              (s.demand < 0.99 ? " Too many shops for the population." : "");
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
    if (cell && (cell.type === "hall" || cell.type === "hallpart")) {
      setHallMenu(true);
      return;
    }
    if (tool === null) {
      const g = (st.terrain || [])[i] || PLAIN;
      setNote(cell ? describe(cell, d.status[i])
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
    const clearing = ground === WOODS ? CLEAR_COST : 0;
    const price = costOf(tool, st.tax, d.bankCount, st.loans, ecoCost) + clearing;
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
      grid[i] = days > 0 ? { type: tool, seq: s.seq, build: days } : { type: tool, seq: s.seq };
      // A felled stand of trees is a direct hit, not something the slow drift
      // toward a target would ever register on its own.
      const env = clearing ? Math.max(0, (s.env === undefined ? START_ENV : s.env) - 5) : s.env;
      return { ...s, grid, env, money: s.money - price, seq: s.seq + 1 };
    });
    setNote(null);
  };

  const disp = { fontFamily: "'Staatliches', 'Arial Narrow', sans-serif", letterSpacing: "0.08em" };
  const mono = { fontFamily: "ui-monospace, Menlo, monospace" };

  // Which tiles a patrol reaches, and which of the buildings crime is measured
  // against are standing outside all of them. The lens shows both: coverage is
  // the answer, uncovered targets are the question.
  const beatMap = useMemo(() => {
    if (!beat) return null;
    const posts = d.copPosts || [];
    const targs = d.crimeTargets || [];
    const strength = new Map();   // tile index -> best patrol strength on it
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
    const naked = new Set();
    targs.forEach(([r, c]) => { const k = at0(r, c); if (!strength.has(k)) naked.add(k); });
    return { strength, guarded, naked, targets: targs.length };
  }, [beat, d.copPosts, d.crimeTargets, d.hallGuard]);

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
      else if (s.unguarded) badge = ["👮", C.red];
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
              {bare && (
                <span style={{ position: "absolute", inset: 0, borderRadius: isHall ? 0 : 4,
                  boxShadow: `inset 0 0 0 2px ${C.red}`, pointerEvents: "none", zIndex: 5 }} />
              )}
            </>
          );
        })()}
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
          <span key={cell.seq} className="pop" style={{ fontSize: "clamp(12px, 4.6vw, 20px)", lineHeight: 1, opacity: cell.build > 0 ? 0.35 : 1 }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, marginBottom: 16, padding: "10px 12px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10 }}>
            <span style={{ ...mono, fontSize: 10, color: C.dim }}>SCORE MULTIPLIER</span>
            <span style={{ flex: 1 }} />
            <span style={{ ...disp, fontSize: 22, color: mult >= 1 ? C.green : C.amber }}>×{mult.toFixed(2)}</span>
          </div>

          <div onClick={() => doReset(undefined, pickDiff)}
            style={{ ...disp, fontSize: 18, textAlign: "center", background: C.orange, color: C.ink, borderRadius: 12, padding: "12px 0", cursor: "pointer", letterSpacing: "0.08em" }}>
            TAKE OFFICE
          </div>
          <div style={{ ...mono, fontSize: 9, color: C.dim, textAlign: "center", marginTop: 8 }}>
            All-Medium is the standard game. Winning always takes 51%.
          </div>
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
          title={beat ? "Hide police coverage" : "Show police coverage"}
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
            style={{ cursor: "pointer", padding: "2px 7px", borderRadius: 7, border: `1px solid ${C.line}`, background: speed === k ? C.orange : "transparent", color: speed === k ? C.ink : C.cream }}
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
      <div style={{ width: boardW, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 6, display: "grid", gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gap: 2 }}>
        {st.grid.map((_, i) => <Tile key={i} i={i} />)}
      </div>

      {beatMap && (
        <div style={{ width: boardW, marginTop: 6, display: "flex", alignItems: "center", flexWrap: "wrap",
                      gap: 10, ...mono, fontSize: 9.5, color: C.dim }}>
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
            coverage {Math.round((d.policeFrac || 0) * 100)}%
          </span>
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
        {BUILD_KEYS.filter((k) => (!MILESTONE_POP[k] || (fp >= MILESTONE_POP[k] && crossedMilestone(k))) && (!UNLOCK_DAY[k] || st.day >= UNLOCK_DAY[k]) && (!UNLOCK_AFTER[k] || st.grid.some((c) => c && c.type === UNLOCK_AFTER[k])) && !(SPECIALTY.has(k) && st.grid.some((c) => c && c.type === k))
              && !(BUILD_CAP[k] && st.grid.filter((c) => c && c.type === k).length >= BUILD_CAP[k])).map((k) => (
          <PaletteBtn
            key={k}
            icon={BUILD[k].icon}
            label={BUILD[k].name === "Power Plant" ? "Plant" : BUILD[k].name === "Power Line" ? "Line" : BUILD[k].name === "Campaign Billboard" ? "Billboard" : BUILD[k].name}
            sub={`$${costOf(k, st.tax, d.bankCount, st.loans, ecoCost)}${BUILD[k].jobs ? `·${BUILD[k].jobs}👤` : ""}${buildDays(k) ? `·${buildDays(k)}d` : ""}`}
            active={tool === k}
            dimmed={st.money < costOf(k, st.tax, d.bankCount, st.loans, ecoCost)}
            onPick={() => {
              const next = tool === k ? null : k;
              setTool(next);
              if (next === "police" || next === "camera") setBeat(true);
              setNote(BUILD[k].hint);
            }}
          />
        ))}
        <PaletteBtn icon="🔨" label="Upgrade" sub="varies" active={tool === "up"} onPick={() => { setTool(tool === "up" ? null : "up"); setNote("Tap a building to upgrade it. Three levels each, one for Police."); }} />
        <PaletteBtn icon="🚜" label="Bulldoze" sub="+50%" active={tool === "doze"} onPick={() => { setTool(tool === "doze" ? null : "doze"); setNote("Tap a building to demolish it for half back."); }} />
        <PaletteBtn icon="🔍" label="Inspect" sub="free" active={tool === null} onPick={() => { setTool(null); setNote("Tap anything on the map for details."); }} />
      </div>

      {/* new buildings unlocked */}
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
        const canRig = st.mafia === "allied" || st.mafia === "refused" || st.mafia === "defeated";
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
                {canRig && (
                  <span
                    onClick={() => {
                      setSt((s) => ({ ...s, approval: Math.min(100, s.approval + 12), crime: Math.min(100, s.crime + 8), rigged: s.rigged + 1 }));
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
                onClick={() => { setSt((s) => ({ ...s, mafia: "refused", crime: 15, justBroke: true })); setToast("🚨 Vincent didn't take it well. Build up your police."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "6px 12px" }}
              >
                REFUSE
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, mafia: "allied", nextTalk: s.day + 60, approval: Math.max(0, s.approval - 15), crime: Math.min(100, s.crime + 10) })); setToast("🤝 The Tsuis send their regards. The papers noticed, and so did everyone else."); setSpeed("play"); }}
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
                onClick={() => { setSt((s) => ({ ...s, mafia: "refused", crime: 30, heat: Math.max(0, s.heat * 0.45), justBroke: true })); setToast("🚨 The deal is off. Vincent is not sentimental, but the Bureau is interested."); setSpeed("play"); }}
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
                onClick={() => { setSt((s) => ({ ...s, mafia: "allied", deal: s.deal + 1, nextTalk: s.day + 60, approval: Math.max(0, s.approval - 6) })); setToast("🤝 New terms accepted. The papers noticed. Again."); setSpeed("play"); }}
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
          ]],
          ["WHERE YOU STAND", [
            ["🗳️", "PR Panel", `${Math.round(st.approval)}% approval`,
              st.approval >= 51 ? C.green : C.red, () => { setHallMenu(false); setPrPanel(true); }],
            ["🔦", "Crime Report", `${Math.round(st.crime)} on the street`,
              st.crime >= 60 ? C.red : st.crime >= 30 ? C.amber : C.green, () => { setHallMenu(false); setCrimeReport(true); }],
            ["📋", "State of the City", `score ${L.total}`, C.cream, () => { setHallMenu(false); setStatePanel(true); }],
            ["🗞️", "The Sentinel", `${(st.log || []).length} stories`, C.cream, () => { setHallMenu(false); setPaper(true); }],
          ]],
          ["YOUR PEOPLE", [
            [CHIEFS[st.chiefId]?.icon || "👮", "Police Chief", CHIEFS[st.chiefId]?.name || "None appointed",
              st.chiefId ? C.cream : C.amber, () => { setHallMenu(false); setChiefPanel(true); }],
            ["✉️", "Envelopes", st.fed === 1 ? `heat ${heat}/100` : `$${bribeCost(st.bribes, d.bankCount)} each`,
              st.fed === 1 ? C.red : C.amber, () => { setHallMenu(false); setBribePanel(true); }],
          ]],
        ];
        return (
          <div onClick={() => setHallMenu(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 58, padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 390px)", maxHeight: "88vh", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
              <div style={{ ...disp, fontSize: 22, letterSpacing: "0.04em" }}>CITY HALL</div>
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginBottom: 4 }}>
                Day {st.day} · {TIERS[tier].name} · {st.elected} term{st.elected === 1 ? "" : "s"} served
              </div>
              {st.heir && (
                <div style={{ ...mono, fontSize: 10, color: C.amber, marginBottom: 4 }}>
                  {HEIRS[st.heir].icon} {HEIRS[st.heir].name} administration
                </div>
              )}

              {/* the three numbers you actually watch, big enough to read */}
              <div style={{ display: "flex", gap: 6, margin: "12px 0 4px" }}>
                {[["APPROVAL", `${Math.round(st.approval)}%`, st.approval >= 51 ? C.green : C.red],
                  ["CRIME", `${Math.round(st.crime)}`, st.crime >= 60 ? C.red : st.crime >= 30 ? C.amber : C.green],
                  ["ENVIRON", `${Math.round(st.env === undefined ? 100 : st.env)}`,
                    (st.env === undefined ? 100 : st.env) < ENV_ALARM ? C.red : (st.env === undefined ? 100 : st.env) < 55 ? C.amber : C.green],
                ].map(([lab, val, col]) => (
                  <div key={lab} style={{ flex: 1, background: C.bg, borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
                    <div style={{ ...disp, fontSize: 20, color: col, lineHeight: 1.1 }}>{val}</div>
                    <div style={{ ...mono, fontSize: 8, color: C.dim, letterSpacing: "0.12em" }}>{lab}</div>
                  </div>
                ))}
              </div>

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
            <div style={{ display: "flex", marginTop: 14 }}>
              <span style={{ flex: 1 }} />
              <span onClick={() => { prevEvent.current = st.eventSeen; setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 13, background: C.orange, color: C.ink, borderRadius: 9, padding: "6px 12px" }}>
                {EV.good ? "GOOD NEWS" : "DEAL WITH IT"}
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
                onClick={() => { setSt((s) => ({ ...s, pvisit: 3 })); setToast("🇺🇸 Regrets, respectfully. The base is pleased with you."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 9, padding: "6px 10px" }}
              >
                SEND REGRETS
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, pvisit: 2, heat: Math.max(0, s.heat - 45) })); setToast("🇺🇸 Motorcade, handshake, front page. The file goes quiet."); setSpeed("play"); }}
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
                  onClick={() => { clear(); testify(); }}
                  style={{ ...disp, textAlign: "center", cursor: "pointer", fontSize: 13,
                           color: C.green, border: `1px solid ${C.green}`, borderRadius: 9, padding: "8px 12px" }}
                >
                  TESTIFY AGAINST THE FAMILY
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
              <span style={{ color: C.amber }}>ALLOW</span> · crime -{ICE_RAID_CRIME} for {ICE_RAID_DAYS} days, then nothing · immigration stops for good · commercial &amp; industrial revenue -15% · traffic up · approval hit<br />
              <span style={{ color: C.red }}>REFUSE</span> · a federal investigation opens against you
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <span
                onClick={() => { setSt((s) => ({ ...s, ice: 3, fed: s.fed === 0 ? 1 : s.fed, heat: s.fed === 0 ? Math.max(s.heat, 12) : s.heat })); setToast("🚔 You told the President no. The Bureau opens a file."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, color: C.red, border: `1px solid ${C.red}`, borderRadius: 9, padding: "6px 10px" }}
              >
                REFUSE
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => { setSt((s) => ({ ...s, ice: 2, iceUntil: s.day + ICE_RAID_DAYS })); setToast("🚔 ICE moves into Luckhead. The city goes quiet and cold."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: C.cream, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                ALLOW THE RAIDS
              </span>
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
              <span style={{ color: C.amber }}>PAY $5,000</span> · the photographs disappear<br />
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
                onClick={() => { if (st.money < 5000) { setNote("You do not have $5,000 to give them."); return; } setSt((s) => ({ ...s, blackmail: 2, money: s.money - 5000 })); setToast("🤝 The envelope is collected. The photographs are gone."); setSpeed("play"); }}
                style={{ ...disp, cursor: "pointer", fontSize: 12.5, background: st.money < 5000 ? C.line : C.amber, color: C.ink, borderRadius: 9, padding: "6px 12px" }}
              >
                PAY $5,000
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
                {mustPickChief && st.vacancyReason === "assassinated"
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

      {/* police funding */}
      {funding && (
        <div onClick={() => setFunding(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(90vw, 380px)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
            <div style={{ ...disp, fontSize: 18 }}>POLICE FUNDING</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 12 }}>Changes every station's roster and upkeep.</div>
            {FUND_KEYS.map((k) => {
              const f = FUND[k];
              const on = st.fund === k;
              return (
                <div key={k} onClick={() => { setSt((s) => ({ ...s, fund: k })); setNote(`Police funding set to ${f.name}.`); }}
                  style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 11, cursor: "pointer",
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
                  onClick={() => { setSt((s) => ({ ...s, tax: k })); setNote(`Tax policy set to ${t.name}.`); }}
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
          ["Windfalls", "windfall", C.green],
        ];
        const L = st.ledger || [];
        const sum = (k) => L.reduce((a, e) => a + (e[k] || 0), 0);
        const income = sum("taxes") + sum("trade") + sum("goods") + sum("windfall") + Math.max(0, sum("mob"));
        const expense = -(sum("power") + sum("industry") + sum("civic") + Math.min(0, sum("mob")));
        const total = income - expense;
        const scale = Math.max(1, ...rows.map((r) => Math.abs(sum(r[1]))));
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
                    <span style={{ ...mono, fontSize: 10.5, width: 76, color: C.cream }}>{label}</span>
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
                  "Every 120 days you need 51%. That number never changes.",
                  "The opposition runs on your worst stat and drains approval daily until you fix it.",
                  "Your first term carries goodwill. Every term after polls a little worse.",
                  "Every two terms you name a successor, which resets fatigue and wipes all Tsui deals.",
                ]],
                ["THE TSUI FAMILY", [
                  "Three standing arrangements opens a federal file. Heat fills; at 100 you are indicted.",
                  "Refusing them costs more than accepting: frozen immigration, a dead chief, and arson.",
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
