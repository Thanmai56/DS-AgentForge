const generatedSessionKeys = [
  'activePlan',
  'activePlanId',
  'activePlanRequestId',
  'activePlanWarnings',
  'activeSampleDataSummary',
  'activeSourceEntities',
];

export function clearGeneratedBrowserState(): void {
  generatedSessionKeys.forEach((key) => sessionStorage.removeItem(key));
  localStorage.removeItem('activeRun');
}
