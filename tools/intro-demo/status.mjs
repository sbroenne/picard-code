// This original recording example deliberately starts with a broken release check.
export function readyToLaunch(checks) {
  return checks.some((check) => check.passed);
}
