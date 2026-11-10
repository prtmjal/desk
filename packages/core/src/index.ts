/**
 * @desk/core — domain types and pure logic for the AI order desk.
 *
 * - schema/   OrderDraft and extraction contracts (zod; the source of truth, plan §7.3 #1)
 * - matching/ normalization, trigram, UoM, catalog interface, layered matcher (L0–L4)
 * - customer/ deterministic customer identification
 * - rules/    validation against ERP facts and auto-post policy
 *
 * No I/O, no model calls, no database access in this package.
 */
export * from "./schema/index";
export * from "./matching/index";
export * from "./customer/index";
export * from "./rules/index";
