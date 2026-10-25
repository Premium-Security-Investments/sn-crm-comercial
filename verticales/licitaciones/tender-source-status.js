export function normalizeTenderStatusText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const TENDER_TERMINAL_STATUS_TERMS = [
  'revocado', 'revocada',
  'declarado desierto', 'declarada desierta', 'desierto', 'desierta',
  'cancelado', 'cancelada',
  'request canceled', 'request cancelled',
  'celebrado', 'celebrada',
];

export function isTenderTerminalStatus(value) {
  const text = normalizeTenderStatusText(value);
  return TENDER_TERMINAL_STATUS_TERMS.some(term => text.includes(normalizeTenderStatusText(term)));
}

export function tenderStatusSearchText(item) {
  const raw = item?.raw || item || {};
  return [
    item?.status,
    raw.estado_del_procedimiento,
    raw.estado_del_proceso,
    raw.fase,
    raw.estado,
    raw.descripcion_estado,
    raw.estado_resumen,
    raw.resultado,
    raw.comentario_entidad_estatal,
  ].filter(Boolean).join(' ');
}

export function isTenderTrackableStatus(item) {
  return !isTenderTerminalStatus(tenderStatusSearchText(item));
}

export function officialTenderStatus(row, source) {
  if (source === 'SECOP II') return row?.estado_del_procedimiento || row?.fase || '';
  if (source === 'SECOP I') return row?.estado_del_proceso || '';
  return row?.status || row?.estado || '';
}
