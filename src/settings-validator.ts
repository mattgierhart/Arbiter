import type { ArbiterSettings } from "./types";

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate an ArbiterSettings object. Returns a structured result so the caller
 * can decide whether to apply, fall back, or surface to the user.
 *
 * Inspired by Symphony §6.2 (dynamic reload semantics): "Invalid reloads MUST
 * NOT crash the service; keep operating with the last known good effective
 * configuration and emit an operator-visible error."
 */
export function validateSettings(s: unknown): ValidationResult {
	const errors: string[] = [];

	if (!s || typeof s !== "object") {
		return { valid: false, errors: ["settings is not an object"] };
	}

	const cfg = s as Record<string, unknown>;

	// Strings that must be non-empty
	for (const key of ["policyFolderPath", "logFolderPath", "frontmatterPrefix", "assessmentHeading"]) {
		const v = cfg[key];
		if (typeof v !== "string" || v.trim() === "") {
			errors.push(`${key} must be a non-empty string`);
		}
	}

	// Discovery folders must be a non-empty array of non-empty strings
	if (!Array.isArray(cfg.taskDiscoveryFolders) || cfg.taskDiscoveryFolders.length === 0) {
		errors.push("taskDiscoveryFolders must be a non-empty array");
	} else if (cfg.taskDiscoveryFolders.some((f) => typeof f !== "string" || f.trim() === "")) {
		errors.push("taskDiscoveryFolders entries must be non-empty strings");
	}

	// Booleans
	for (const key of ["autoAssessOnChange", "enableMachineLog", "syncProtocolEnabled", "laneAwareAssessments"]) {
		if (typeof cfg[key] !== "boolean") {
			errors.push(`${key} must be a boolean`);
		}
	}

	// Confidence threshold must be 0..1
	const ct = cfg.confidenceThreshold;
	if (typeof ct !== "number" || Number.isNaN(ct) || ct < 0 || ct > 1) {
		errors.push("confidenceThreshold must be a number between 0 and 1");
	}

	// Board debounce must be a non-negative integer
	const debounce = cfg.boardDebounceMs;
	if (typeof debounce !== "number" || !Number.isFinite(debounce) || debounce < 0) {
		errors.push("boardDebounceMs must be a non-negative number");
	}

	// agent_dispatch_hints (optional object) — when present, validate inner shape
	if (cfg.agentDispatchHints !== undefined) {
		const hints = cfg.agentDispatchHints;
		if (!hints || typeof hints !== "object") {
			errors.push("agentDispatchHints must be an object when set");
		} else {
			const h = hints as Record<string, unknown>;
			if (h.maxConcurrentPerCapability !== undefined) {
				const m = h.maxConcurrentPerCapability;
				if (!m || typeof m !== "object") {
					errors.push("agentDispatchHints.maxConcurrentPerCapability must be a map");
				} else {
					for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
						if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
							errors.push(`agentDispatchHints.maxConcurrentPerCapability[${k}] must be a positive integer`);
						}
					}
				}
			}
			if (
				h.maxConcurrentPerRepo !== undefined &&
				(typeof h.maxConcurrentPerRepo !== "number" || !Number.isInteger(h.maxConcurrentPerRepo) || h.maxConcurrentPerRepo < 1)
			) {
				errors.push("agentDispatchHints.maxConcurrentPerRepo must be a positive integer");
			}
			if (
				h.maxConcurrentTotal !== undefined &&
				(typeof h.maxConcurrentTotal !== "number" || !Number.isInteger(h.maxConcurrentTotal) || h.maxConcurrentTotal < 1)
			) {
				errors.push("agentDispatchHints.maxConcurrentTotal must be a positive integer");
			}
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Apply the last-known-good fallback. Given the current effective settings (which
 * are the last known good) and a new candidate that may be invalid, return the
 * settings to actually use plus a human-readable status message.
 *
 * - If candidate is valid → use candidate
 * - If candidate is invalid → keep current, return error message for operator surface
 */
export function applyWithFallback(
	current: ArbiterSettings,
	candidate: unknown
): { effective: ArbiterSettings; status: "applied" | "rejected"; message: string } {
	const result = validateSettings(candidate);
	if (result.valid) {
		return {
			effective: candidate as ArbiterSettings,
			status: "applied",
			message: "Settings applied successfully.",
		};
	}
	return {
		effective: current,
		status: "rejected",
		message: `Settings rejected (${result.errors.length} error(s)): ${result.errors.join("; ")}. Keeping last known good config.`,
	};
}
