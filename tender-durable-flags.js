function isOn(value) {
  return value === 'on';
}

export function isTenderDurablePipelineEnabled(environment = process.env) {
  return isOn(environment?.TENDER_DURABLE_PIPELINE);
}

export function isTenderPublicUiEnabled(environment = process.env) {
  return isOn(environment?.TENDER_PUBLIC_UI);
}

export function isTenderAutoAnalysisEnabled(environment = process.env) {
  return isOn(environment?.TENDER_AUTO_ANALYSIS);
}
