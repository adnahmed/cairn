// Guard against the shared optimal-zone matcher's substring over-match — one test every
// surface that speaks about "outside optimal" applies (the doctor packet, the Records
// rows, evidence-wanted, the doctor loop's spoken reasons). Pure.
//
// The traps: the matcher's substring over-match on composite/qualitative marker names — e.g. "Total Cholesterol /
// HDL Ratio" grabbing HDL's band, "LDL Pattern A" grabbing LDL's, a urine
// albumin grabbing serum creatinine's, or "Testosterone, Free" (pg/mL) grabbing
// total-T's (ng/dL) band. On a clinician doc a false target reads as an error,
// so we only TRUST (and thus display) an optimal band when the name isn't one of
// these traps and the value is numerically comparable. The lab's own H/L flag is
// authoritative and never suppressed; this only governs the optimal annotation.
export function optimalTrustworthy(name: string, value: unknown): boolean {
  const n = name.toLowerCase();
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return false; // qualitative result (e.g. pattern "A")
  if (/\bvldl\b/.test(n)) return false; // VLDL must not inherit LDL-C's target
  if (/\bratio\b|\bpattern\b|\burine\b/.test(n)) return false;
  if (n.includes("/")) return false; // composite "x / y" names
  if (n.includes("free") && n.includes("testosterone")) return false; // no free-T zone
  return true;
}
