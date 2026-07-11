/**
 * The onboarding demo clip, or null while it hasn't been supplied.
 *
 * Metro resolves `require` at build time and throws if the file is missing, so
 * this is the one place that knows whether the asset exists. Drop the mp4 at
 * `assets/onboarding/demo.mp4` and swap the export below — nothing else changes.
 *
 *   export const DEMO_VIDEO = require('@/assets/onboarding/demo.mp4');
 */
export const DEMO_VIDEO: number | null = null;
