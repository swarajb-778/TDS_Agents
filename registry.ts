/**
 * THE TDS QUESTION REGISTRY
 *
 * Every question on the California Transfer Disclosure Statement, declared once.
 *
 * Design notes that matter more than the code:
 *
 * 1. CHAPTER ORDER IS NOT PDF ORDER. The PDF opens with legal description and
 *    county — the worst possible first question for a stressed seller. We open
 *    with the appliance checklist instead: it's easy, it builds momentum, and
 *    it mentally walks the seller through their house, which primes recall for
 *    the hard questions in Sections B and C.
 *
 * 2. MODALITY IS A DEFAULT, NOT A JAIL. `defaultModality` decides where the
 *    seller lands first. Every form question carries a mic affordance; every
 *    voice question carries a "just show me the buttons" affordance.
 *
 * 3. THE SHARED EXPLAIN BOXES ARE A PRINTING CONSTRAINT, NOT A DATA MODEL.
 *    Section C gives sixteen questions one text box. We capture explanations
 *    per-question at the moment of each `yes` and compose them at render time.
 *
 * 4. AT DISCLOSURE TIME THERE IS NO BUYER. Buyer signature and initial fields
 *    exist on the form but are deliberately left unassigned — a TDS is
 *    completed at listing, before any offer exists.
 */

import type { Chapter, ChapterId, Question } from "./types";

// ===========================================================================
// CHAPTERS
// ===========================================================================

export const CHAPTERS: Chapter[] = [
  {
    id: "confirm",
    title: "Your property",
    intro: "Your agent filled this in. Just check it looks right.",
    tdsSection: "Header / I",
    order: 1,
  },
  {
    id: "basics",
    title: "Living situation",
    intro: "One quick question.",
    tdsSection: "II",
    order: 2,
  },
  {
    id: "features",
    title: "What's in the home",
    intro:
      "Tap everything your home has. Go room by room — most people finish this in about two minutes.",
    tdsSection: "II.A",
    order: 3,
  },
  {
    id: "condition",
    title: "Anything not working",
    intro:
      "Now the flip side: is anything you just told us about broken or not working right?",
    tdsSection: "II.A",
    order: 4,
  },
  {
    id: "defects",
    title: "The building itself",
    intro:
      "This is about the structure — walls, roof, foundation, systems. Easier to talk through than to tick boxes, so let's talk.",
    tdsSection: "II.B",
    order: 5,
  },
  {
    id: "awareness",
    title: "Things you know about",
    intro:
      "Sixteen questions about the property and the neighborhood. Some use legal wording — I'll translate as we go.",
    tdsSection: "II.C",
    order: 6,
  },
  {
    id: "affirmations",
    title: "Two things to confirm",
    intro: "Nothing to answer here — just read and confirm.",
    tdsSection: "II.D",
    order: 7,
  },
  {
    id: "sign",
    title: "Sign",
    intro: "We'll build your form and send it over for signature.",
    tdsSection: "III / V",
    order: 8,
  },
];

export const CHAPTER_ORDER: ChapterId[] = CHAPTERS.sort(
  (a, b) => a.order - b.order,
).map((c) => c.id);

// ===========================================================================
// HELPERS — Section A is 40 near-identical checkboxes; a builder keeps the
// interesting questions readable instead of drowned in boilerplate.
// ===========================================================================

interface FeatureOpts {
  id: string;
  label: string;
  group: string;
  field: string;
  plainEnglish?: string;
  examples?: string[];
}

/** A plain "does the home have this?" checkbox from Section A. */
function feature(o: FeatureOpts): Question {
  return {
    id: o.id,
    chapter: "features",
    group: o.group,
    label: o.label,
    plainEnglish: o.plainEnglish,
    examples: o.examples,
    voicePrompt: `Does the home have ${o.label.toLowerCase()}?`,
    type: "boolean",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: o.field },
    estimatedSeconds: 2,
  };
}

interface AwarenessOpts {
  n: number;
  label: string;
  sellerLabel: string;
  plainEnglish: string;
  whyWeAsk: string;
  examples: string[];
  voicePrompt: string;
  followUpPrompt: string;
  followUpVoice: string;
}

/** One of Section C's sixteen "are you aware of..." questions. */
function awareness(o: AwarenessOpts): Question {
  return {
    id: `C.${o.n}`,
    chapter: "awareness",
    label: o.label,
    sellerLabel: o.sellerLabel,
    plainEnglish: o.plainEnglish,
    whyWeAsk: o.whyWeAsk,
    examples: o.examples,
    voicePrompt: o.voicePrompt,
    type: "boolean",
    defaultModality: "voice",
    allowUnknown: true,
    required: true,
    followUp: {
      when: true,
      prompt: o.followUpPrompt,
      voicePrompt: o.followUpVoice,
      into: "C.explain",
      required: true,
    },
    docuseal: {
      kind: "yes_no",
      yesField: `c${o.n}_yes`,
      noField: `c${o.n}_no`,
    },
    estimatedSeconds: 20,
  };
}

// ===========================================================================
// CHAPTER: confirm — agent-prefilled, seller verifies
// ===========================================================================

const CONFIRM: Question[] = [
  {
    id: "meta.address",
    chapter: "confirm",
    label: "Property Address",
    type: "text",
    defaultModality: "agent",
    allowUnknown: false,
    required: true,
    docuseal: { kind: "text", field: "property_address" },
    estimatedSeconds: 0,
  },
  {
    id: "meta.city",
    chapter: "confirm",
    label: "City",
    type: "text",
    defaultModality: "agent",
    allowUnknown: false,
    required: true,
    docuseal: { kind: "text", field: "city" },
    estimatedSeconds: 0,
  },
  {
    id: "meta.county",
    chapter: "confirm",
    label: "County",
    type: "text",
    defaultModality: "agent",
    allowUnknown: false,
    required: true,
    docuseal: { kind: "text", field: "county" },
    estimatedSeconds: 0,
  },
  {
    id: "meta.property_description",
    chapter: "confirm",
    label: "Property Description (legal description / APN)",
    plainEnglish:
      "The legal description from the title. Your agent pulls this — you don't need to know it.",
    type: "text",
    defaultModality: "agent",
    allowUnknown: false,
    required: true,
    docuseal: { kind: "text", field: "property_description" },
    estimatedSeconds: 0,
  },
  {
    id: "meta.date",
    chapter: "confirm",
    label: "Date of disclosure",
    type: "date",
    defaultModality: "agent",
    allowUnknown: false,
    required: true,
    docuseal: { kind: "text", field: "disclosure_date" },
    estimatedSeconds: 0,
  },
  {
    id: "meta.multi_unit",
    chapter: "confirm",
    label: "This property is a duplex, triplex or fourplex",
    type: "boolean",
    defaultModality: "agent",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: "multi_unit" },
    estimatedSeconds: 0,
  },
  {
    id: "meta.units",
    chapter: "confirm",
    label: "This TDS is for: all units, or only unit(s)",
    type: "text",
    defaultModality: "agent",
    allowUnknown: false,
    required: false,
    gatedBy: { questionId: "meta.multi_unit", isTruthy: true },
    docuseal: { kind: "text", field: "units_covered" },
    estimatedSeconds: 0,
  },
  {
    id: "meta.substituted_disclosures",
    chapter: "confirm",
    label: "Substituted Disclosures (Section I)",
    plainEnglish:
      "Which other reports are standing in for parts of this form. Agent-side — a seller has no way to know this.",
    type: "multi_enum",
    options: [
      {
        value: "inspection_reports",
        label: "Inspection reports per the sales contract or deposit receipt",
      },
      {
        value: "other_reports",
        label: "Additional inspection reports or disclosures",
      },
      { value: "none", label: "No substituted disclosures for this transfer" },
    ],
    defaultModality: "agent",
    allowUnknown: false,
    required: true,
    docuseal: {
      kind: "enum_checkboxes",
      fields: {
        inspection_reports: "sub_disc_inspection",
        other_reports: "sub_disc_other",
        none: "sub_disc_none",
      },
    },
    estimatedSeconds: 0,
  },
];

// ===========================================================================
// CHAPTER: basics
// ===========================================================================

const BASICS: Question[] = [
  {
    id: "occupancy",
    chapter: "basics",
    label: "Seller is / is not occupying the property",
    sellerLabel: "Do you currently live in this home?",
    whyWeAsk:
      "Buyers weigh disclosures differently depending on whether you've lived with the property day to day.",
    voicePrompt: "First one's easy — are you living in the home right now?",
    type: "enum",
    options: [
      { value: "is", label: "Yes, I live here" },
      { value: "is_not", label: "No — it's vacant or tenant-occupied" },
    ],
    defaultModality: "form",
    allowUnknown: false,
    required: true,
    docuseal: {
      kind: "enum_checkboxes",
      fields: { is: "occupying_is", is_not: "occupying_is_not" },
    },
    estimatedSeconds: 5,
  },
];

// ===========================================================================
// CHAPTER: features — Section A
// Form. Forty closed booleans read aloud would be torture; forty taps in a
// grouped grid is ninety seconds. Grouping is by where the thing physically
// lives, so the seller walks the house in their head.
// ===========================================================================

const FEATURES: Question[] = [
  // --- Kitchen & laundry -------------------------------------------------
  feature({ id: "A.range", label: "Range", group: "Kitchen & laundry", field: "a_range" }),
  feature({ id: "A.oven", label: "Oven", group: "Kitchen & laundry", field: "a_oven" }),
  feature({ id: "A.microwave", label: "Microwave", group: "Kitchen & laundry", field: "a_microwave" }),
  feature({ id: "A.dishwasher", label: "Dishwasher", group: "Kitchen & laundry", field: "a_dishwasher" }),
  feature({
    id: "A.trash_compactor",
    label: "Trash Compactor",
    group: "Kitchen & laundry",
    field: "a_trash_compactor",
    plainEnglish: "A built-in unit that crushes trash. Not the same as a garbage disposal.",
  }),
  feature({
    id: "A.garbage_disposal",
    label: "Garbage Disposal",
    group: "Kitchen & laundry",
    field: "a_garbage_disposal",
    plainEnglish: "The grinder under the kitchen sink.",
  }),
  feature({
    id: "A.washer_dryer_hookups",
    label: "Washer/Dryer Hookups",
    group: "Kitchen & laundry",
    field: "a_washer_dryer_hookups",
    plainEnglish: "The connections, whether or not the machines stay.",
  }),

  // --- Heating & cooling -------------------------------------------------
  feature({ id: "A.central_heating", label: "Central Heating", group: "Heating & cooling", field: "a_central_heating" }),
  feature({ id: "A.central_ac", label: "Central Air Conditioning", group: "Heating & cooling", field: "a_central_ac" }),
  feature({
    id: "A.evaporator_cooler",
    label: "Evaporator Cooler(s)",
    group: "Heating & cooling",
    field: "a_evaporator_cooler",
    plainEnglish: "A swamp cooler — cools by evaporating water. Common in dry inland areas.",
  }),
  feature({
    id: "A.wall_window_ac",
    label: "Wall/Window Air Conditioning",
    group: "Heating & cooling",
    field: "a_wall_window_ac",
  }),
  {
    id: "A.fireplace",
    chapter: "features",
    group: "Heating & cooling",
    label: "Fireplace(s)",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: "a_fireplace" },
    estimatedSeconds: 2,
  },
  {
    id: "A.fireplace_location",
    chapter: "features",
    group: "Heating & cooling",
    label: "Fireplace(s) in",
    sellerLabel: "Which rooms?",
    type: "text",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    gatedBy: { questionId: "A.fireplace", isTruthy: true },
    docuseal: { kind: "text", field: "a_fireplace_location" },
    estimatedSeconds: 8,
  },
  {
    id: "A.gas_starter",
    chapter: "features",
    group: "Heating & cooling",
    label: "Gas Starter",
    plainEnglish: "A gas jet in the fireplace used to light wood.",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    gatedBy: { questionId: "A.fireplace", isTruthy: true },
    docuseal: { kind: "checkbox", field: "a_gas_starter" },
    estimatedSeconds: 4,
  },

  // --- Safety ------------------------------------------------------------
  feature({ id: "A.burglar_alarms", label: "Burglar Alarms", group: "Safety & security", field: "a_burglar_alarms" }),
  feature({
    id: "A.co_device",
    label: "Carbon Monoxide Device(s)",
    group: "Safety & security",
    field: "a_co_device",
    plainEnglish: "Required in California homes with a gas appliance, fireplace, or attached garage.",
  }),
  feature({ id: "A.smoke_detectors", label: "Smoke Detector(s)", group: "Safety & security", field: "a_smoke_detectors" }),
  feature({ id: "A.fire_alarm", label: "Fire Alarm", group: "Safety & security", field: "a_fire_alarm" }),
  feature({ id: "A.security_gates", label: "Security Gate(s)", group: "Safety & security", field: "a_security_gates" }),
  feature({
    id: "A.window_security_bars",
    label: "Window Security Bars",
    group: "Safety & security",
    field: "a_window_security_bars",
  }),
  {
    id: "A.quick_release",
    chapter: "features",
    group: "Safety & security",
    label: "Quick Release Mechanism on Bedroom Windows",
    sellerLabel: "Do the bedroom window bars have quick-release latches?",
    plainEnglish:
      "A latch that lets you open barred windows from inside without a key, so you can get out in a fire.",
    whyWeAsk: "Bars without a release are a life-safety issue and buyers must be told.",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    gatedBy: { questionId: "A.window_security_bars", isTruthy: true },
    docuseal: { kind: "checkbox", field: "a_quick_release" },
    estimatedSeconds: 8,
  },

  // --- Media -------------------------------------------------------------
  feature({ id: "A.tv_antenna", label: "TV Antenna", group: "Media & communications", field: "a_tv_antenna" }),
  feature({ id: "A.satellite_dish", label: "Satellite Dish", group: "Media & communications", field: "a_satellite_dish" }),
  feature({ id: "A.intercom", label: "Intercom", group: "Media & communications", field: "a_intercom" }),

  // --- Outside -----------------------------------------------------------
  feature({ id: "A.rain_gutters", label: "Rain Gutters", group: "Outside", field: "a_rain_gutters" }),
  feature({ id: "A.sprinklers", label: "Sprinklers", group: "Outside", field: "a_sprinklers" }),
  feature({ id: "A.patio_decking", label: "Patio/Decking", group: "Outside", field: "a_patio_decking" }),
  feature({ id: "A.built_in_bbq", label: "Built-in Barbecue", group: "Outside", field: "a_built_in_bbq" }),
  feature({ id: "A.gazebo", label: "Gazebo", group: "Outside", field: "a_gazebo" }),
  feature({ id: "A.window_screens", label: "Window Screens", group: "Outside", field: "a_window_screens" }),

  // --- Water, sewer, utilities ------------------------------------------
  feature({ id: "A.public_sewer", label: "Public Sewer System", group: "Water & utilities", field: "a_public_sewer" }),
  feature({
    id: "A.septic_tank",
    label: "Septic Tank",
    group: "Water & utilities",
    field: "a_septic_tank",
    plainEnglish: "An on-site tank instead of a connection to the city sewer.",
  }),
  feature({
    id: "A.sump_pump",
    label: "Sump Pump",
    group: "Water & utilities",
    field: "a_sump_pump",
    plainEnglish: "A pump in a pit, usually in a basement or crawlspace, that pushes out water.",
  }),
  feature({ id: "A.water_softener", label: "Water Softener", group: "Water & utilities", field: "a_water_softener" }),
  {
    id: "A.water_conserving_fixtures",
    chapter: "features",
    group: "Water & utilities",
    label: "Water-Conserving Plumbing Fixtures",
    sellerLabel: "Low-flow toilets, showerheads, and faucets?",
    plainEnglish:
      "California requires these in homes built on or before Jan 1, 1994. If you're not sure, say so — your agent can check.",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    docuseal: { kind: "checkbox", field: "a_water_conserving" },
    estimatedSeconds: 8,
  },
  {
    id: "A.water_heater_type",
    chapter: "features",
    group: "Water & utilities",
    label: "Water Heater: Gas / Solar / Electric",
    sellerLabel: "What kind of water heater?",
    plainEnglish:
      "One question, not three — and you can pick more than one if you have solar with a gas backup.",
    examples: [
      "Gas: there's a pilot light or a blue flame you can see through a little window",
      "Electric: no flame, usually a thicker power cable",
      "Solar: panels on the roof feeding the tank",
    ],
    voicePrompt:
      "What kind of water heater do you have — gas, electric, or solar? If you're not sure: gas ones usually have a small window near the bottom with a flame behind it.",
    type: "multi_enum",
    options: [
      { value: "gas", label: "Gas" },
      { value: "solar", label: "Solar" },
      { value: "electric", label: "Electric" },
    ],
    defaultModality: "form",
    allowUnknown: true,
    required: true,
    docuseal: {
      kind: "enum_checkboxes",
      fields: {
        gas: "a_wh_gas",
        solar: "a_wh_solar",
        electric: "a_wh_electric",
      },
    },
    estimatedSeconds: 10,
  },
  {
    id: "A.water_supply",
    chapter: "features",
    group: "Water & utilities",
    label: "Water Supply: City / Well / Private Utility or Other",
    sellerLabel: "Where does your water come from?",
    voicePrompt:
      "Where does your water come from — the city, a private well, or some other utility?",
    type: "multi_enum",
    options: [
      { value: "city", label: "City" },
      { value: "well", label: "Well" },
      { value: "private_utility", label: "Private utility or other" },
    ],
    defaultModality: "form",
    allowUnknown: true,
    required: true,
    docuseal: {
      kind: "enum_checkboxes",
      fields: {
        city: "a_ws_city",
        well: "a_ws_well",
        private_utility: "a_ws_private",
      },
    },
    estimatedSeconds: 8,
  },
  {
    id: "A.gas_supply",
    chapter: "features",
    group: "Water & utilities",
    label: "Gas Supply: Utility / Bottled (Tank)",
    sellerLabel: "How is gas supplied?",
    plainEnglish:
      "Bottled means a propane tank on the property rather than a pipeline from the gas company.",
    type: "multi_enum",
    options: [
      { value: "utility", label: "Utility (piped)" },
      { value: "bottled", label: "Bottled (tank)" },
    ],
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    docuseal: {
      kind: "enum_checkboxes",
      fields: { utility: "a_gs_utility", bottled: "a_gs_bottled" },
    },
    estimatedSeconds: 8,
  },
  {
    id: "A.220_wiring",
    chapter: "features",
    group: "Water & utilities",
    label: "220 Volt Wiring",
    sellerLabel: "Any 220-volt outlets?",
    plainEnglish:
      "Heavy-duty wiring for a dryer, electric range, EV charger, or workshop tool. The outlet looks bigger and rounder than a normal one.",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    docuseal: { kind: "checkbox", field: "a_220_wiring" },
    estimatedSeconds: 6,
  },
  {
    id: "A.220_wiring_location",
    chapter: "features",
    group: "Water & utilities",
    label: "220 Volt Wiring in",
    sellerLabel: "Where?",
    type: "text",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    gatedBy: { questionId: "A.220_wiring", isTruthy: true },
    docuseal: { kind: "text", field: "a_220_wiring_location" },
    estimatedSeconds: 8,
  },
  {
    id: "A.exhaust_fans",
    chapter: "features",
    group: "Water & utilities",
    label: "Exhaust Fan(s)",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: "a_exhaust_fans" },
    estimatedSeconds: 3,
  },
  {
    id: "A.exhaust_fans_location",
    chapter: "features",
    group: "Water & utilities",
    label: "Exhaust Fan(s) in",
    sellerLabel: "Which rooms?",
    type: "text",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    gatedBy: { questionId: "A.exhaust_fans", isTruthy: true },
    docuseal: { kind: "text", field: "a_exhaust_fans_location" },
    estimatedSeconds: 8,
  },

  // --- Garage & parking --------------------------------------------------
  {
    id: "A.garage",
    chapter: "features",
    group: "Garage & parking",
    label: "Garage",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: "a_garage" },
    estimatedSeconds: 2,
  },
  {
    id: "A.garage_type",
    chapter: "features",
    group: "Garage & parking",
    label: "Garage: Attached / Not Attached",
    sellerLabel: "Is it attached to the house?",
    plainEnglish:
      "Attached means it shares a wall with the living space and you can usually walk straight in.",
    type: "enum",
    options: [
      { value: "attached", label: "Attached" },
      { value: "not_attached", label: "Not attached" },
    ],
    defaultModality: "form",
    allowUnknown: false,
    required: true,
    gatedBy: { questionId: "A.garage", isTruthy: true },
    docuseal: {
      kind: "enum_checkboxes",
      fields: { attached: "a_garage_attached", not_attached: "a_garage_not_attached" },
    },
    estimatedSeconds: 5,
  },
  feature({ id: "A.carport", label: "Carport", group: "Garage & parking", field: "a_carport" }),
  {
    id: "A.auto_garage_opener",
    chapter: "features",
    group: "Garage & parking",
    label: "Automatic Garage Door Opener(s)",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: "a_auto_garage_opener" },
    estimatedSeconds: 3,
  },
  {
    id: "A.remote_count",
    chapter: "features",
    group: "Garage & parking",
    label: "Number Remote Controls",
    sellerLabel: "How many remotes will you leave for the buyer?",
    type: "number",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    gatedBy: { questionId: "A.auto_garage_opener", isTruthy: true },
    docuseal: { kind: "text", field: "a_remote_count" },
    estimatedSeconds: 6,
  },

  // --- Pool, spa, sauna --------------------------------------------------
  feature({ id: "A.sauna", label: "Sauna", group: "Pool, spa & sauna", field: "a_sauna" }),
  {
    id: "A.hot_tub_spa",
    chapter: "features",
    group: "Pool, spa & sauna",
    label: "Hot Tub/Spa",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: "a_hot_tub_spa" },
    estimatedSeconds: 2,
  },
  {
    id: "A.hot_tub_locking_cover",
    chapter: "features",
    group: "Pool, spa & sauna",
    label: "Locking Safety Cover",
    sellerLabel: "Does it have a locking safety cover?",
    whyWeAsk: "It's a child-safety item, so it gets called out separately.",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    gatedBy: { questionId: "A.hot_tub_spa", isTruthy: true },
    docuseal: { kind: "checkbox", field: "a_hot_tub_locking_cover" },
    estimatedSeconds: 5,
  },
  {
    id: "A.pool",
    chapter: "features",
    group: "Pool, spa & sauna",
    label: "Pool",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: "a_pool" },
    estimatedSeconds: 2,
  },
  {
    id: "A.pool_child_barrier",
    chapter: "features",
    group: "Pool, spa & sauna",
    label: "Child Resistant Barrier",
    sellerLabel: "Is there a child-resistant barrier around the pool?",
    plainEnglish:
      "A fence, safety cover, or self-latching gate that keeps small children out.",
    whyWeAsk:
      "California has specific pool safety standards, and buyers need to know whether yours meets them.",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    gatedBy: { questionId: "A.pool", isTruthy: true },
    docuseal: { kind: "checkbox", field: "a_pool_child_barrier" },
    estimatedSeconds: 6,
  },
  {
    id: "A.pool_spa_heater",
    chapter: "features",
    group: "Pool, spa & sauna",
    label: "Pool/Spa Heater",
    type: "boolean",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "checkbox", field: "a_pool_spa_heater" },
    estimatedSeconds: 2,
  },
  {
    id: "A.pool_spa_heater_type",
    chapter: "features",
    group: "Pool, spa & sauna",
    label: "Pool/Spa Heater: Gas / Solar / Electric",
    sellerLabel: "What kind?",
    type: "multi_enum",
    options: [
      { value: "gas", label: "Gas" },
      { value: "solar", label: "Solar" },
      { value: "electric", label: "Electric" },
    ],
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    gatedBy: { questionId: "A.pool_spa_heater", isTruthy: true },
    docuseal: {
      kind: "enum_checkboxes",
      fields: {
        gas: "a_psh_gas",
        solar: "a_psh_solar",
        electric: "a_psh_electric",
      },
    },
    estimatedSeconds: 8,
  },

  // --- Roof --------------------------------------------------------------
  {
    id: "A.roof",
    chapter: "features",
    group: "Roof",
    label: "Roof(s)",
    sellerLabel: "What's the roof made of, and roughly how old is it?",
    plainEnglish:
      "A rough answer is fine — 'composition shingle, replaced around 2015'. If you don't know the age, say so.",
    examples: [
      "Composition shingle, about 10 years old",
      "Tile, original to the house",
      "Flat / built-up, resealed 2021",
    ],
    voicePrompt:
      "Last one in this section — what's the roof made of, and any idea when it was last done? A rough guess is fine.",
    type: "text",
    defaultModality: "form",
    allowUnknown: true,
    required: false,
    docuseal: { kind: "text", field: "a_roof" },
    estimatedSeconds: 15,
  },
];

// ===========================================================================
// CHAPTER: condition — Section A's catch-all gate
// Voice. This is the first genuinely hard question on the form: it asks the
// seller to scan back over forty items they just ticked and recall which ones
// have problems. That's a memory task, and a memory task wants prompting.
// ===========================================================================

const CONDITION: Question[] = [
  {
    id: "A.not_operating",
    chapter: "condition",
    label:
      "Are there, to the best of your (Seller's) knowledge, any of the above that are not in operating condition?",
    sellerLabel: "Is anything you just listed broken or not working properly?",
    plainEnglish:
      "This covers anything that doesn't work the way it should — not just things that are completely dead. A dishwasher that doesn't drain counts.",
    whyWeAsk:
      "Buyers assume everything listed works. If something doesn't, telling them now is what protects you later.",
    examples: [
      "The oven's second element stopped heating",
      "One of the sprinkler zones doesn't come on",
      "The intercom hasn't worked since we moved in",
    ],
    voicePrompt:
      "Now the other half of that list. Is anything you just told me about broken, or not working the way it should? It doesn't have to be completely dead — a dishwasher that doesn't drain properly counts. Take your time; I'll keep your list up on the screen.",
    type: "boolean",
    defaultModality: "voice",
    allowUnknown: false,
    required: true,
    followUp: {
      when: true,
      prompt: "Which ones, and what's wrong with each?",
      voicePrompt:
        "Tell me which ones and roughly what's going on with each. You don't need to be technical — how it behaves is enough.",
      into: "A.not_operating_describe",
      required: true,
    },
    docuseal: {
      kind: "yes_no",
      yesField: "a_not_operating_yes",
      noField: "a_not_operating_no",
    },
    estimatedSeconds: 45,
  },
  {
    id: "A.not_operating_describe",
    chapter: "condition",
    label: "If yes, then describe",
    voicePrompt:
      "Tell me which ones and roughly what's going on with each. You don't need to be technical — just how it behaves.",
    type: "long_text",
    defaultModality: "voice",
    allowUnknown: false,
    required: false,
    gatedBy: { questionId: "A.not_operating", isTruthy: true },
    docuseal: { kind: "composed", field: "a_not_operating_describe", source: "explanations" },
    estimatedSeconds: 0,
  },
];

// ===========================================================================
// CHAPTER: defects — Section B
// Voice-led, form-confirmed. "Significant defect" is a judgment word, not a
// fact — the seller has to be talked into or out of it. So: seller talks, the
// agent extracts which components are implicated, and the seller SEES the
// checkboxes tick and confirms them. Neither path alone is right here.
// ===========================================================================

const B_COMPONENTS = [
  ["interior_walls", "Interior Walls", "b_interior_walls"],
  ["ceilings", "Ceilings", "b_ceilings"],
  ["floors", "Floors", "b_floors"],
  ["exterior_walls", "Exterior Walls", "b_exterior_walls"],
  ["insulation", "Insulation", "b_insulation"],
  ["roof", "Roof(s)", "b_roof"],
  ["windows", "Windows", "b_windows"],
  ["doors", "Doors", "b_doors"],
  ["foundation", "Foundation", "b_foundation"],
  ["slabs", "Slab(s)", "b_slabs"],
  ["driveways", "Driveways", "b_driveways"],
  ["sidewalks", "Sidewalks", "b_sidewalks"],
  ["walls_fences", "Walls/Fences", "b_walls_fences"],
  ["electrical_systems", "Electrical Systems", "b_electrical_systems"],
  ["plumbing_sewers_septics", "Plumbing/Sewers/Septics", "b_plumbing"],
  ["other", "Other", "b_other"],
] as const;

const DEFECTS: Question[] = [
  {
    id: "B.gate",
    chapter: "defects",
    label:
      "Are you (Seller) aware of any significant defects/malfunctions in any of the following?",
    sellerLabel:
      "Are you aware of any significant problems with the building itself?",
    plainEnglish:
      "\"Significant\" means something a buyer would want to know about — not every nail hole and scuff. If you'd mention it to a friend buying the place, mention it here.",
    whyWeAsk:
      "This is the section buyers and their inspectors read first. Being upfront here is the strongest protection you have against a claim after closing.",
    examples: [
      "A crack in the foundation or slab",
      "A roof leak, patched or not",
      "Windows that don't seal or have failed double-glazing",
      "Electrical that trips repeatedly",
      "A drain line that backs up",
    ],
    voicePrompt:
      "This next part is about the building itself — walls, floors, roof, foundation, the electrical and plumbing. I'm looking for significant problems, not every scuff and nail hole. The test I'd use: if a friend were buying this place, what would you feel you had to tell them? Anything come to mind?",
    type: "boolean",
    defaultModality: "voice",
    allowUnknown: true,
    required: true,
    docuseal: { kind: "yes_no", yesField: "b_yes", noField: "b_no" },
    estimatedSeconds: 60,
  },
  {
    id: "B.components",
    chapter: "defects",
    label: "If yes, check appropriate space(s) below",
    sellerLabel: "Which parts of the building?",
    plainEnglish:
      "I've ticked the ones I picked up from what you said. Add or remove anything — you have the final say.",
    type: "multi_enum",
    options: B_COMPONENTS.map(([value, label]) => ({ value, label })),
    defaultModality: "form", // deliberately: seller confirms what voice extracted
    allowUnknown: false,
    required: true,
    gatedBy: { questionId: "B.gate", isTruthy: true },
    followUp: {
      when: true,
      prompt: "What's the problem with each one?",
      voicePrompt:
        "Walk me through each one — what's wrong, roughly when it started, and whether anything's been done about it.",
      into: "B.explain",
      required: true,
    },
    docuseal: {
      kind: "enum_checkboxes",
      fields: Object.fromEntries(B_COMPONENTS.map(([v, , f]) => [v, f])),
    },
    estimatedSeconds: 30,
  },
  {
    id: "B.other_describe",
    chapter: "defects",
    label: "Other Components (Describe:)",
    sellerLabel: "What else?",
    voicePrompt:
      "You mentioned something that doesn't fit the standard list — what is it, in your own words?",
    type: "text",
    defaultModality: "voice",
    allowUnknown: false,
    required: true,
    gatedBy: { questionId: "B.components", includes: "other" },
    docuseal: { kind: "text", field: "b_other_describe" },
    estimatedSeconds: 20,
  },
  {
    id: "B.explain",
    chapter: "defects",
    label: "If any of the above is checked, explain",
    sellerLabel: "Here's what we captured — read it over and change anything.",
    plainEnglish:
      "This is the text that goes on the form. It's written from what you told me. Edit freely — it's your disclosure.",
    type: "long_text",
    defaultModality: "form", // seller reads and approves the drafted text
    allowUnknown: false,
    required: true,
    gatedBy: { questionId: "B.gate", isTruthy: true },
    docuseal: { kind: "composed", field: "b_explain", source: "explanations" },
    estimatedSeconds: 45,
  },
];

// ===========================================================================
// CHAPTER: awareness — Section C
// Voice, all sixteen. Read as written, most of these are unintelligible to a
// homeowner ("encroachments, easements or similar matters"). The translation
// IS the product here — a checkbox next to legalese gets a wrong answer,
// confidently given.
// ===========================================================================

const AWARENESS: Question[] = [
  awareness({
    n: 1,
    label:
      "Substances, materials, or products which may be an environmental hazard such as, but not limited to, asbestos, formaldehyde, radon gas, lead-based paint, mold, fuel or chemical storage tanks, and contaminated soil or water on the subject property",
    sellerLabel: "Anything hazardous on the property?",
    plainEnglish:
      "Hazardous materials in, under, or around the home — including things that came with the house long before you did.",
    whyWeAsk:
      "Some of these are expensive to deal with and some are health risks, so buyers get to factor them in.",
    examples: [
      "Asbestos in old floor tiles, pipe wrap, or popcorn ceilings",
      "Lead paint — common in homes built before 1978",
      "Mold behind a wall or under a sink",
      "A buried oil or propane tank",
    ],
    voicePrompt:
      "Do you know of anything hazardous on the property? I mean things like asbestos — often in old floor tiles or pipe insulation — lead paint if the house is pre-1978, mold, radon, or a buried fuel tank. Anything like that ever come up?",
    followUpPrompt: "What is it, where, and has anything been done about it?",
    followUpVoice:
      "Tell me what it is and where — and if it's been tested, treated, or removed, mention that too.",
  }),
  awareness({
    n: 2,
    label:
      "Features of the property shared in common with adjoining landowners, such as walls, fences, and driveways, whose use or responsibility for maintenance may have an effect on the subject property",
    sellerLabel: "Anything you share with a neighbor?",
    plainEnglish:
      "A wall, fence, driveway, or similar that you and a neighbor both use or both maintain.",
    whyWeAsk:
      "A buyer inherits the arrangement — and the cost-sharing that comes with it.",
    examples: [
      "A fence on the property line you split the cost of",
      "A shared driveway",
      "A retaining wall holding back a neighbor's slope",
    ],
    voicePrompt:
      "Do you share anything with a neighbor? A fence line, a retaining wall, a driveway you both use? Even a handshake arrangement counts here.",
    followUpPrompt: "What's shared, with whom, and how is upkeep handled?",
    followUpVoice:
      "What is it, which neighbor, and how do you two handle repairs — is it written down anywhere or just an understanding?",
  }),
  awareness({
    n: 3,
    label:
      "Any encroachments, easements or similar matters that may affect your interest in the subject property",
    sellerLabel:
      "Does anything of a neighbor's cross onto your land, or does anyone have a right to use part of it?",
    plainEnglish:
      "An encroachment is someone else's structure sitting on your land. An easement is someone's legal right to cross or use part of your property.",
    whyWeAsk:
      "Both limit what a buyer can do with the land, so they need to know before they commit.",
    examples: [
      "A neighbor's shed or fence a few feet over the line",
      "A utility company's right to access poles or lines",
      "A neighbor whose only road access runs across your lot",
    ],
    voicePrompt:
      "This one has some legal wording, so let me put it plainly. Does a neighbor's fence, shed, or driveway cross onto your land? Or does anyone have a legal right to cross or use part of your property — a utility company, or a neighbor who needs to drive across to get to their place?",
    followUpPrompt: "What is it, and where on the property?",
    followUpVoice:
      "Describe what it is and roughly where — and if it's written into the title, mention that.",
  }),
  awareness({
    n: 4,
    label:
      "Room additions, structural modifications, or other alterations or repairs made without necessary permits",
    sellerLabel: "Any work done without a permit?",
    plainEnglish:
      "Work that legally needed a permit and didn't get one — including work done by owners before you, if you know about it.",
    whyWeAsk:
      "Unpermitted work can affect insurance, appraisals, and what a buyer can legally do later.",
    examples: [
      "A garage converted to a bedroom or ADU",
      "A finished basement or attic",
      "An added bathroom, deck, or patio cover",
      "A moved or removed interior wall",
    ],
    voicePrompt:
      "Has any work been done on the house without a permit? Converted garage, finished basement, an added bathroom or deck, a wall taken out. And this includes work done by previous owners, if you know about it.",
    followUpPrompt: "What work, roughly when, and who did it?",
    followUpVoice:
      "What was done, roughly when, and do you know whether a permit was ever pulled after the fact?",
  }),
  awareness({
    n: 5,
    label:
      "Room additions, structural modifications, or other alterations or repairs not in compliance with building codes",
    sellerLabel: "Any work that isn't up to code?",
    plainEnglish:
      "Different from the last question — work can have a permit and still not meet code, or have no permit but be built properly.",
    whyWeAsk:
      "A buyer may have to bring it up to code, and that's a real cost.",
    examples: [
      "Ceiling height too low in a converted space",
      "Wiring or plumbing a contractor flagged as non-compliant",
      "A deck rail below the required height",
    ],
    voicePrompt:
      "Related but not the same: is any of the work on the house not up to building code? An inspector or contractor may have flagged something at some point — a low ceiling in a conversion, a railing that's too short, wiring that isn't right.",
    followUpPrompt: "What's not compliant, and how do you know?",
    followUpVoice:
      "What is it, and how did you find out — an inspection, a contractor, the city?",
  }),
  awareness({
    n: 6,
    label: "Fill (compacted or otherwise) on the property or any portion thereof",
    sellerLabel: "Was any part of the lot filled in with soil?",
    plainEnglish:
      "Soil brought in from somewhere else to level a slope or build up a pad. Fill settles differently from native ground.",
    whyWeAsk:
      "Fill affects how the ground behaves under a foundation, so buyers and their engineers want to know.",
    examples: [
      "A hillside lot levelled out to create a flat pad",
      "A filled-in pool or old excavation",
      "A raised back yard",
    ],
    voicePrompt:
      "Was any part of the lot filled in with soil brought from somewhere else — to level out a slope, or fill in an old pool? This often shows up in the paperwork from when you bought the place, so it's fine to say you're not sure.",
    followUpPrompt: "Which part of the property, and what do you know about it?",
    followUpVoice: "Which part of the lot, and how did you come to know about it?",
  }),
  awareness({
    n: 7,
    label:
      "Any settling from any cause, or slippage, sliding, or other soil problems",
    sellerLabel: "Has the ground moved or settled?",
    plainEnglish:
      "The soil under or around the house shifting over time. It usually shows up in the things sitting on top of it before you ever see the soil itself.",
    whyWeAsk:
      "Soil movement is one of the first things a buyer's inspector looks for.",
    examples: [
      "New cracks in the driveway, patio, or slab",
      "Doors or windows that suddenly stop closing right",
      "A fence or retaining wall going crooked",
      "A slope that's slipped after heavy rain",
    ],
    voicePrompt:
      "Has the ground around the house ever shifted or settled? You'd usually notice it indirectly — new cracks in the driveway or patio, a door that stopped closing right, a fence going crooked. Anything like that?",
    followUpPrompt: "What did you notice, when, and was anything done?",
    followUpVoice:
      "What did you notice and roughly when? And did you have anyone look at it — an engineer, a contractor?",
  }),
  awareness({
    n: 8,
    label: "Flooding, drainage or grading problems",
    sellerLabel: "Any problems with water on the property?",
    plainEnglish:
      "Water going where it shouldn't — pooling, running toward the house, or getting inside.",
    whyWeAsk:
      "Water intrusion is a leading cause of expensive damage, and history matters to a buyer.",
    examples: [
      "Water pooling in the yard after heavy rain",
      "Water getting into the garage, basement, or crawlspace",
      "A slope that drains toward the house instead of away",
      "Gutters that overflow onto the foundation",
    ],
    voicePrompt:
      "How's water on the property? Does it pool anywhere after heavy rain, or has water ever actually got into the garage, a basement, or the crawlspace? Even once counts.",
    followUpPrompt: "Where does water go, how often, and has anything been fixed?",
    followUpVoice:
      "Where does the water go, how often does it happen, and has anything been done — regrading, a drain, a sump pump?",
  }),
  awareness({
    n: 9,
    label:
      "Major damage to the property or any of the structures from fire, earthquake, floods, or landslides",
    sellerLabel: "Any major damage from fire, earthquake, flood, or landslide?",
    plainEnglish:
      "Significant damage from any of these, whether or not it's been repaired and whether or not insurance covered it.",
    whyWeAsk:
      "Buyers want to know the repair history, not just the current condition.",
    examples: [
      "Smoke or fire damage, even in one room",
      "Earthquake damage from Loma Prieta or Northridge",
      "Flood damage to a lower floor",
    ],
    voicePrompt:
      "Has the property ever had major damage from a fire, an earthquake, a flood, or a landslide? This counts even if it was fully repaired and even if it happened before you owned it, as long as you know about it.",
    followUpPrompt: "What happened, when, and how was it repaired?",
    followUpVoice:
      "Walk me through it — what happened, roughly when, who did the repairs, and was an insurance claim involved?",
  }),
  awareness({
    n: 10,
    label:
      'Any zoning violations, nonconforming uses, violations of "setback" requirements',
    sellerLabel:
      "Has the city or county ever said something on the property isn't allowed?",
    plainEnglish:
      "Setback rules say how close to your property line you're allowed to build. A nonconforming use is something that was legal once but wouldn't be permitted today.",
    whyWeAsk:
      "It can limit rebuilding, remodeling, or renting — a buyer's plans may depend on it.",
    examples: [
      "A structure built closer to the line than current rules allow",
      "A unit being rented that isn't zoned for it",
      "A property zoned differently from how it's actually used",
    ],
    voicePrompt:
      "Has the city or county ever told you something on the property isn't allowed where it is, or how it's being used? Something built too close to the property line, or a space being rented out that isn't zoned for it?",
    followUpPrompt: "What's the issue, and has the city been involved?",
    followUpVoice:
      "What's the issue, and did you get anything in writing from the city or county?",
  }),
  awareness({
    n: 11,
    label: "Neighborhood noise problems or other nuisances",
    sellerLabel: "Anything about the neighborhood a buyer should know?",
    plainEnglish:
      "Ongoing noise, smells, traffic, or activity that a buyer wouldn't notice on a Sunday afternoon showing.",
    whyWeAsk:
      "Buyers see the house for twenty minutes. You've lived through every Tuesday night.",
    examples: [
      "Freeway, train, or flight-path noise",
      "A dog that barks through the night",
      "A bar, school, or business nearby",
      "Regular street parking problems or events",
    ],
    voicePrompt:
      "This one's about the neighborhood rather than the house. A buyer sees the place for twenty minutes on a Sunday. You've lived through every Tuesday night. Anything they'd want to know? Traffic or train noise, a barking dog, a business nearby, regular events?",
    followUpPrompt: "What is it, and when does it happen?",
    followUpVoice: "What is it, and when does it tend to happen?",
  }),
  awareness({
    n: 12,
    label: "CC&R's or other deed restrictions or obligations",
    sellerLabel: "Any written rules attached to the property?",
    plainEnglish:
      "CC&Rs are Covenants, Conditions and Restrictions — rules recorded against the property about what you can and can't do with it. They travel with the land, not the owner.",
    whyWeAsk: "The buyer will be bound by them, so they need to see them first.",
    examples: [
      "Rules on paint colors, fences, or landscaping",
      "Restrictions on RV or boat parking",
      "A limit on short-term rentals",
    ],
    voicePrompt:
      "Are there written rules attached to the property about what you can do with it? Sometimes called CC&Rs. Things like restrictions on paint colors, fences, parking an RV, or renting the place out short-term. Common if there's an HOA, but they can exist without one.",
    followUpPrompt: "What restrictions, and where's the document?",
    followUpVoice:
      "What kind of restrictions, and do you know where the document lives — title company, HOA, your closing packet?",
  }),
  awareness({
    n: 13,
    label: "Homeowners' Association which has any authority over the subject property",
    sellerLabel: "Is there an HOA?",
    plainEnglish:
      "Any homeowners' association with authority over the property — including small ones with just a few homes.",
    whyWeAsk:
      "Dues, rules, and reserves all affect what a buyer can afford and what they can do.",
    voicePrompt:
      "Is there a homeowners' association? Counts even if it's small and informal — a handful of houses sharing a private road, for instance.",
    examples: [
      "A condo or townhome association",
      "A small road-maintenance association",
      "A master association over the whole development",
    ],
    followUpPrompt: "Which HOA, and what are the dues?",
    followUpVoice:
      "What's the association called, and roughly what are the dues? Monthly or annual, either's fine.",
  }),
  awareness({
    n: 14,
    label:
      'Any "common area" (facilities such as pools, tennis courts, walkways, or other areas co-owned in undivided interest with others)',
    sellerLabel: "Any shared facilities you co-own?",
    plainEnglish:
      "Areas or amenities you own a share of together with other owners, rather than owning outright.",
    whyWeAsk:
      "Co-ownership comes with shared costs and shared liability that transfer to the buyer.",
    examples: [
      "A community pool or clubhouse",
      "Shared walkways, greenbelt, or parking",
      "A private road owned jointly",
    ],
    voicePrompt:
      "Are there shared facilities you co-own with other owners? A community pool, a clubhouse, shared walkways or parking, a private road?",
    followUpPrompt: "What's shared, and who manages it?",
    followUpVoice: "What's shared, and who takes care of it?",
  }),
  awareness({
    n: 15,
    label: "Any notices of abatement or citations against the property",
    sellerLabel: "Any official notices or citations from the city or county?",
    plainEnglish:
      "An abatement notice is an official order to fix or stop something. A citation is a fine or formal violation.",
    whyWeAsk:
      "An open notice can hold up a sale and often has to be resolved before closing.",
    examples: [
      "A code enforcement notice about an unpermitted structure",
      "A weed or debris abatement notice",
      "A fine for a violation that's still open",
    ],
    voicePrompt:
      "Have you ever received an official notice or citation about the property from the city or county? Something telling you to fix, remove, or stop something — code enforcement, weed abatement, that kind of thing.",
    followUpPrompt: "What was it, when, and is it resolved?",
    followUpVoice:
      "What was it about, roughly when did it arrive, and has it been cleared up?",
  }),
  awareness({
    n: 16,
    label:
      "Any lawsuits by or against the Seller threatening to or affecting this real property, claims for damages by the Seller pursuant to Section 910 or 914, claims for breach of warranty pursuant to Section 900, or claims for breach of an enhanced protection agreement pursuant to Section 903, including any lawsuits or claims for damages pursuant to Section 910 or 914 alleging a defect or deficiency in this real property or \"common areas\"",
    sellerLabel: "Any lawsuits or legal claims involving this property?",
    plainEnglish:
      "The statute numbers all point at the same idea: legal disputes or claims about defects in the property, whether you brought them or someone brought them against you.",
    whyWeAsk:
      "Pending litigation can affect title, financing, and what a buyer is taking on.",
    examples: [
      "A construction defect claim against a builder",
      "A boundary or easement dispute with a neighbor",
      "An HOA-wide lawsuit over common area defects",
      "A warranty claim against a contractor",
    ],
    voicePrompt:
      "Last one in this section, and it's the wordiest on the form — but it's simpler than it reads. Are there any lawsuits or legal claims involving this property? That includes claims you've made, like a construction defect or warranty claim against a builder, and claims made against you. Also counts if it's an HOA-wide suit over the common areas.",
    followUpPrompt: "What's the claim, who's involved, and what's its status?",
    followUpVoice:
      "Tell me what the claim is about, who's involved, and where it stands right now.",
  }),
  {
    id: "C.explain",
    chapter: "awareness",
    label: "If the answer to any of these is yes, explain",
    sellerLabel: "Here's everything you told me — read it over before we lock it in.",
    plainEnglish:
      "This is the exact text that goes on the form, numbered to match the questions. Edit anything that isn't right.",
    type: "long_text",
    defaultModality: "form",
    allowUnknown: false,
    required: false,
    docuseal: { kind: "composed", field: "c_explain", source: "explanations" },
    estimatedSeconds: 60,
  },
];

// ===========================================================================
// CHAPTER: affirmations — Section D
// Nothing to collect. These are covenants the seller makes about the state of
// things at close of escrow, not questions about the present. Presenting them
// as questions would be wrong; presenting them as fine print would be worse.
// ===========================================================================

const AFFIRMATIONS: Question[] = [
  {
    id: "D.1",
    chapter: "affirmations",
    label:
      "Seller affirms that upon completion of escrow the property will conform to Section 13113.8 of the Health and Safety Code (operable smoke detectors)",
    sellerLabel:
      "You're confirming the home will have working, approved smoke detectors when the sale closes.",
    plainEnglish:
      "This is a promise about closing day, not about today. If you're missing any, you have until then to install them.",
    type: "acknowledgement",
    defaultModality: "form",
    allowUnknown: false,
    required: true,
    docuseal: { kind: "none" },
    estimatedSeconds: 10,
  },
  {
    id: "D.2",
    chapter: "affirmations",
    label:
      "Seller affirms that upon completion of escrow the property will conform to Section 19211 of the Health and Safety Code (water heater bracing)",
    sellerLabel:
      "You're confirming the water heater will be properly strapped or braced when the sale closes.",
    plainEnglish:
      "Earthquake safety — the tank has to be anchored so it can't tip. A plumber can do it cheaply if it isn't already.",
    type: "acknowledgement",
    defaultModality: "form",
    allowUnknown: false,
    required: true,
    docuseal: { kind: "none" },
    estimatedSeconds: 10,
  },
];

// ===========================================================================
// EXPORTS
// ===========================================================================

export const QUESTIONS: Question[] = [
  ...CONFIRM,
  ...BASICS,
  ...FEATURES,
  ...CONDITION,
  ...DEFECTS,
  ...AWARENESS,
  ...AFFIRMATIONS,
];

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

export function getQuestion(id: string): Question | undefined {
  return BY_ID.get(id);
}

export function questionsInChapter(chapter: ChapterId): Question[] {
  return QUESTIONS.filter((q) => q.chapter === chapter);
}

export function getChapter(id: ChapterId): Chapter | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

/** Questions the seller never sees — the agent fills these before sending. */
export function agentOnlyQuestions(): Question[] {
  return QUESTIONS.filter((q) => q.defaultModality === "agent");
}

/** Groups within a chapter, in first-appearance order. Drives the form layout. */
export function groupsInChapter(chapter: ChapterId): string[] {
  const seen: string[] = [];
  for (const q of questionsInChapter(chapter)) {
    if (q.group && !seen.includes(q.group)) seen.push(q.group);
  }
  return seen;
}
