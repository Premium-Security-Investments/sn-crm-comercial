export type SiioAgentStatus = 'piloto' | 'operativo_parcial' | 'diseño';

export type SiioInstitutionalAgent = {
  id: string;
  name: string;
  status: SiioAgentStatus;
  owner_role: string;
  purpose: string;
  authorized_fronts: string[];
  authorized_sources: string[];
  permitted_actions: string[];
  forbidden_actions: string[];
  human_review_required: true;
  can_write_production: false;
  channel: string;
  audit_rule: string;
  current_capability: string;
  next_gate: string;
};

export const SIIO_AGENT_CATALOG: SiioInstitutionalAgent[] = [
  {
    id: 'AGT-001',
    name: 'Agente Gerencial SIIO',
    status: 'piloto',
    owner_role: 'Gerencia General',
    purpose: 'Convertir información F2/F4 en lecturas ejecutivas trazables y acciones recomendadas.',
    authorized_fronts: ['F2', 'F4', 'F5'],
    authorized_sources: ['SRC-011', 'SRC-012', 'SRC-013'],
    permitted_actions: ['Leer métricas agregadas', 'Aplicar reglas F5', 'Resumir evidencia', 'Proponer acciones gerenciales', 'Preparar borrador de Junta'],
    forbidden_actions: ['Publicar informes', 'Aprobar cifras financieras', 'Ocultar alertas o restricciones', 'Exponer nómina individual o datos personales', 'Modificar archivos de origen', 'Ejecutar decisiones gerenciales'],
    human_review_required: true,
    can_write_production: false,
    channel: 'SIIO Gerencial / Dashboard Ejecutivo',
    audit_rule: 'Toda recomendación debe mostrar regla, evidencia, periodo y fuente.',
    current_capability: 'Cuatro reglas determinísticas activas sobre finanzas y nómina agregada.',
    next_gate: 'Validación financiera y QA autenticado por roles.',
  },
  {
    id: 'AGT-002',
    name: 'Copiloto de Licitaciones',
    status: 'operativo_parcial',
    owner_role: 'Dirección de Licitaciones',
    purpose: 'Priorizar procesos públicos, analizar documentos y preparar un expediente de oferta controlado.',
    authorized_fronts: ['F1', 'F4', 'F5'],
    authorized_sources: ['SECOP-I', 'SECOP-II', 'TVEC', 'ESU', 'Perfil corporativo PSI'],
    permitted_actions: ['Priorizar procesos', 'Analizar documentos', 'Preparar matriz GO/NO GO', 'Generar borradores y checklist'],
    forbidden_actions: ['Presentar ofertas', 'Descartar procesos sin confirmación', 'Convertir oportunidades sin confirmación', 'Firmar documentos'],
    human_review_required: true,
    can_write_production: false,
    channel: 'CRM / Radar de Licitaciones',
    audit_rule: 'Las acciones sensibles exigen confirmación y deben conservar fuente, usuario y fecha.',
    current_capability: 'Radar, análisis documental, perfil corporativo y expediente de oferta con gates.',
    next_gate: 'Cerrar prueba RUP heredada y completar QA con Dirección de Licitaciones.',
  },
  {
    id: 'AGT-003',
    name: 'Vig-IA Comercial',
    status: 'operativo_parcial',
    owner_role: 'Dirección Comercial',
    purpose: 'Detectar oportunidades estancadas, riesgos de seguimiento y prioridades del pipeline comercial.',
    authorized_fronts: ['F1', 'F5'],
    authorized_sources: ['CRM-F1', 'Interacciones comerciales', 'Metas comerciales'],
    permitted_actions: ['Leer pipeline', 'Detectar estancamientos', 'Priorizar seguimiento', 'Explicar señales comerciales'],
    forbidden_actions: ['Modificar oportunidades', 'Cambiar responsables', 'Aprobar ventas', 'Enviar comunicaciones externas'],
    human_review_required: true,
    can_write_production: false,
    channel: 'CRM / Vig-IA y alertas comerciales',
    audit_rule: 'Cada alerta debe vincular oportunidad, responsable, fecha y criterio de activación.',
    current_capability: 'Consulta y priorización de señales comerciales en modo de solo lectura.',
    next_gate: 'Validar umbrales y utilidad con Dirección Comercial.',
  },
];

export function validateSiioAgentCatalog(catalog: SiioInstitutionalAgent[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const agent of catalog) {
    if (!agent.id || ids.has(agent.id)) errors.push(`ID inválido o duplicado: ${agent.id || 'vacío'}`);
    ids.add(agent.id);
    if (!agent.name || !agent.owner_role || !agent.purpose) errors.push(`${agent.id}: identidad incompleta`);
    if (!agent.authorized_fronts.length || !agent.authorized_sources.length) errors.push(`${agent.id}: fuentes o frentes no definidos`);
    if (!agent.permitted_actions.length || !agent.forbidden_actions.length) errors.push(`${agent.id}: límites de acción incompletos`);
    if (!agent.human_review_required || agent.can_write_production) errors.push(`${agent.id}: gobierno humano inválido`);
    if (!agent.audit_rule) errors.push(`${agent.id}: regla de auditoría ausente`);
  }
  return errors;
}
