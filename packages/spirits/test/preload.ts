/**
 * Pretest setup: run the suite under the same app identity as the packaged entry.
 *
 * `bin/bootstrap.ts` sets `PI_APP_NAME=spirits` before pi loads, which derives
 * `SPIRITS_CODING_AGENT_DIR` and the other identity-sensitive names. Without this preload,
 * tests importing pi directly would resolve the default `pi` identity.
 */
process.env.PI_APP_NAME = "spirits";
