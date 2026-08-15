/**
 * dsh-projection-guard type declarations.
 * @module dsh-projection-guard
 */

/** Result of the pure guard core: surviving rows plus dropped keys. */
export interface SanitizeResult {
    rows: Record<string, unknown>;
    dropped: string[];
}

/**
 * Drop every checkpoint row that is not lossless JSON.
 * @param rows - raw per-session projection checkpoint rows.
 * @returns surviving rows plus the dropped keys.
 * @throws when no row survives (same contract as the original put()).
 */
export declare function sanitizeCheckpoint(rows: Record<string, unknown>): SanitizeResult;

/** Whether a cached projection snapshot already carries a usable title. */
export declare function hasUsableTitle(cached: { values?: Record<string, unknown> } | undefined): boolean;

/** Cordis plugin name. */
export declare const name: 'dsh-projection-guard';
/** Hard service dependencies. */
export declare const inject: readonly ['sessionProjectionCache'];

/** Plugin config (schema defaults applied by the loader). */
export interface ProjectionGuardConfig {
    /** Backfill missing cached titles from persisted logs at startup. Default true. */
    repairOnStart?: boolean;
    /** Warn per dropped non-JSON row. Default true. */
    logDropped?: boolean;
}

/** Cordis plugin entry. */
export declare function apply(ctx: unknown, config?: ProjectionGuardConfig): void;
