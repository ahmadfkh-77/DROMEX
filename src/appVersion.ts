/**
 * DEC-475. The release identity shown on the Home screen, so the Owner can tell at a glance which
 * build a phone is actually running -- an installed APK and an Expo Go session look identical
 * otherwise.
 *
 * These values duplicate `app.json` (and `package.json`) deliberately: `resolveJsonModule` is not
 * enabled for this project, so the app cannot import that JSON directly. The duplication is guarded --
 * tests/app-version.test.ts fails if these ever drift from `app.json`, so a release that bumps the
 * version without updating this file cannot pass the suite.
 */
export const APP_VERSION='0.17.0';
export const ANDROID_VERSION_CODE=20;

/** "v0.17.0 · build 20" -- the one place that formatting is decided. */
export const appVersionLabel=()=>`v${APP_VERSION} · build ${ANDROID_VERSION_CODE}`;
