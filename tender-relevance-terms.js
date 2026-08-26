export const TENDER_DISQUALIFYING_TERMS = Object.freeze([
  'interventoria', 'interventoría',
  'vehiculo blindado', 'vehículo blindado', 'vehiculos blindados', 'vehículos blindados',
  'transporte blindado', 'camioneta blindada', 'camionetas blindadas', 'carro blindado',
  'blindaje vehicular', 'blindaje de vehiculos', 'blindaje de vehículos', 'blindados',
  'radiocomunicaciones', 'radiocomunicacion', 'radio comunicaciones', 'radio comunicación',
  'sistema de radiocomunicaciones', 'equipos de comunicacion', 'equipos de comunicación',
  'red de comunicaciones', 'telecomunicaciones',
]);

export const TENDER_NON_SECURITY_CONTEXT_TERMS = Object.freeze([
  'vigilancia epidemiologica', 'vigilancia sanitaria', 'vigilancia en salud publica',
  'vigilancia fitosanitaria', 'vigilancia veterinaria', 'monitoreo epidemiologico',
  'sanidad aviar', 'influenza aviar', 'tifosis aviar', 'enfermedad de newcastle',
  'diagnostico veterinario', 'cadena avicola',
]);

export const TENDER_NON_COMMERCIAL_ACT_TERMS = Object.freeze([
  'aunar esfuerzos',
]);

export const TENDER_CORE_SERVICE_TERMS = Object.freeze([
  'vigilancia y seguridad privada', 'vigilancia y seguridad', 'servicios de vigilancia', 'servicio de vigilancia',
  'vigilancia armada', 'vigilancia privada', 'seguridad privada', 'seguridad electronica', 'seguridad electrónica',
  'cctv', 'videovigilancia', 'video vigilancia', 'control de acceso', 'circuito cerrado',
]);

function normalizeTenderTerm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const NORMALIZED_CORE_SERVICE_TERMS = new Set(TENDER_CORE_SERVICE_TERMS.map(normalizeTenderTerm));

export function isTenderCoreServiceTerm(value) {
  return NORMALIZED_CORE_SERVICE_TERMS.has(normalizeTenderTerm(value));
}

export function extractTenderCoreServiceTerms(value) {
  const text = ` ${normalizeTenderTerm(value)} `;
  return [...NORMALIZED_CORE_SERVICE_TERMS].filter(term => text.includes(` ${term} `)).sort();
}
