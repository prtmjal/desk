/** Unit-of-measure canonicalization and pack/UoM factor logic. */

const UOM_SYNONYMS: Record<string, string> = {
  EA: "EA", EACH: "EA", PC: "EA", PCS: "EA", PIECE: "EA", PIECES: "EA", UNIT: "EA", UNITS: "EA", U: "EA",
  CS: "CS", CASE: "CS", CASES: "CS", CA: "CS", CSE: "CS",
  BX: "BX", BOX: "BX", BOXES: "BX",
  PK: "PK", PACK: "PK", PKG: "PK", PACKAGE: "PK", PKT: "PK",
  CT: "CT", CTN: "CT", CARTON: "CT", CARTONS: "CT",
  DZ: "DZ", DOZ: "DZ", DOZEN: "DZ",
  PR: "PR", PAIR: "PR", PAIRS: "PR",
  RL: "RL", ROLL: "RL", ROLLS: "RL", COIL: "RL", SPOOL: "RL",
  BDL: "BDL", BD: "BDL", BNDL: "BDL", BUNDLE: "BDL", BUNDLES: "BDL",
  BG: "BG", BAG: "BG", BAGS: "BG",
  PL: "PL", PLT: "PL", PALLET: "PL", PALLETS: "PL", SKID: "PL",
  FT: "FT", FOOT: "FT", FEET: "FT", LF: "FT",
  M: "M", MTR: "M", METER: "M", METRE: "M",
  IN: "IN", INCH: "IN",
  LB: "LB", LBS: "LB", POUND: "LB", POUNDS: "LB",
  KG: "KG", KGS: "KG", KILO: "KG",
  GAL: "GAL", GALLON: "GAL", GALLONS: "GAL",
  L: "L", LTR: "L", LITER: "L", LITRE: "L",
  SET: "SET", SETS: "SET", KIT: "KIT", KITS: "KIT",
  SF: "SF", SQFT: "SF", M2: "M2", SQM: "M2",
  HR: "HR", HOUR: "HR", HOURS: "HR",
};

export function normalizeUom(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!key) return null;
  return UOM_SYNONYMS[key] ?? null;
}

/** Items may define selling units: e.g. { CS: 12 } means one case is 12 stocking units. */
export type PackDefinition = {
  /** Stocking (base) UoM in the ERP, e.g. EA */
  baseUom: string;
  /** Other sellable units expressed in base units, e.g. { CS: 12, BX: 6 } */
  factors?: Record<string, number>;
  /** Minimum order quantity in base units */
  minQty?: number;
  /** Orders must be a multiple of this (in base units); e.g. sold only by full cases */
  multipleOf?: number;
};

export type UomResolution =
  | { ok: true; factor: number; erpUom: string; note: string | null }
  | { ok: false; reason: string };

/**
 * Resolve the ordered UoM against the item's pack definition.
 * - Same as base: factor 1.
 * - Known selling unit: factor from table.
 * - Absent: base UoM.
 * - Anything else, including units this module has never seen: fail so the line is
 *   flagged (UOM_UNKNOWN), never guessed.
 */
export function resolveUom(rawUom: string | null | undefined, pack: PackDefinition): UomResolution {
  const canon = (u: string) => normalizeUom(u) ?? u.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = canon(pack.baseUom);
  const written = rawUom?.trim();
  // Absent UoM on the PO: the base unit is the only reasonable reading.
  if (!written) return { ok: true, factor: 1, erpUom: base, note: null };
  const ordered = canon(written);
  if (ordered === base) return { ok: true, factor: 1, erpUom: base, note: null };
  // Pack factors are keyed however the ERP spells the unit; compare canonical forms.
  for (const [unit, f] of Object.entries(pack.factors ?? {})) {
    if (canon(unit) === ordered && f > 0) return { ok: true, factor: f, erpUom: base, note: `${ordered} = ${f} ${base}` };
  }
  // A unit we cannot place is never guessed: "10 BDL" read as 10 EA ships a tenth of the order.
  return { ok: false, reason: `UoM '${written}' not defined for item (base ${base})` };
}

export type PackRounding = { qty: number; rounded: boolean; note: string | null };

/** Apply minimum and multiple-of rules; round UP to the next multiple (never silently down). */
export function applyPackRules(qtyBase: number, pack: PackDefinition): PackRounding {
  let qty = qtyBase;
  let note: string | null = null;
  let rounded = false;
  if (pack.multipleOf && pack.multipleOf > 1 && qty % pack.multipleOf !== 0) {
    const next = Math.ceil(qty / pack.multipleOf) * pack.multipleOf;
    note = `Rounded ${qty} up to ${next} (sold in multiples of ${pack.multipleOf})`;
    qty = next;
    rounded = true;
  }
  if (pack.minQty && qty < pack.minQty) {
    note = `${note ? note + "; " : ""}Raised to minimum ${pack.minQty}`;
    qty = pack.minQty;
    rounded = true;
  }
  return { qty, rounded, note };
}
