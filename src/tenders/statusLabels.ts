export type TenderStatusTone = 'success' | 'danger' | 'warning' | 'neutral';

const documentLabels: Record<string, string> = {
  analisis_generado: 'Análisis generado',
  documentos_cargados: 'Documentos cargados',
  fallo_importacion: 'Falló la actualización documental',
  pendiente_documentos: 'Documentos pendientes',
  no_aplica: 'No aplica',
  error: 'Estado documental no disponible',
};

const offerLabels: Record<string, string> = {
  pendiente_decision: 'Decisión pendiente',
  en_preparacion: 'En preparación',
  lista_para_presentar: 'Lista para presentar',
  presentada: 'Presentada',
  adjudicada: 'Adjudicada',
  no_adjudicada: 'No adjudicada',
  cerrada_no_go: 'Cerrada por NO GO',
};

const decisionLabels: Record<string, string> = {
  go: 'GO',
  no_go: 'NO GO',
};

const tones: Record<string, TenderStatusTone> = {
  no_go: 'danger',
  cerrada_no_go: 'danger',
  no_adjudicada: 'danger',
  fallo_importacion: 'danger',
  error: 'danger',
  alto: 'danger',
  'medio-alto': 'danger',
  bloqueado: 'danger',
  go: 'success',
  analisis_generado: 'success',
  documentos_cargados: 'success',
  lista_para_presentar: 'success',
  presentada: 'success',
  adjudicada: 'success',
  completado: 'success',
  pendiente_decision: 'warning',
  pendiente_documentos: 'warning',
  en_preparacion: 'warning',
  condicionado: 'warning',
  medio: 'warning',
  pendiente: 'warning',
  'riesgo pendiente': 'warning',
};

export function tenderDocumentStatusLabel(value?: string | null) {
  return documentLabels[String(value || '').toLowerCase()] || 'Estado documental pendiente';
}

export function tenderOfferStatusLabel(value?: string | null) {
  return offerLabels[String(value || '').toLowerCase()] || 'Estado de oferta pendiente';
}

export function tenderDecisionLabel(value?: string | null) {
  return decisionLabels[String(value || '').toLowerCase()] || 'Decisión pendiente';
}

export function tenderStatusTone(value?: string | null): TenderStatusTone {
  return tones[String(value || '').toLowerCase()] || 'neutral';
}
