import { addBloodPressureReading } from "../../repo/health.js";
import { deriveDirectives } from "../../repo/propagation.js";

export type BloodPressureReadingInput = Parameters<typeof addBloodPressureReading>[0];

/**
 * One stated blood-pressure reading, stored and propagated. The single writer the
 * REST route, the MCP tool and the chat `log_blood_pressure` action share, so a
 * reading lands the same way (and re-derives directives the same way) whichever
 * surface it was typed into. A directive refresh never fails the vital log.
 */
export function recordBloodPressureReading(input: BloodPressureReadingInput) {
  const row = addBloodPressureReading(input);
  try {
    deriveDirectives();
  } catch {
    /* never fail the vital log */
  }
  return row;
}
