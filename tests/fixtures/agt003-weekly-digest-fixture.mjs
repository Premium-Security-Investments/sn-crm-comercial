// Datos ficticios para el correo semanal de AGT-003 (src/vigia/weekly-digest.js). Ningún dato es real.
// Hora de generación: lunes 12 de octubre de 2026, 6:45 a.m. en Bogotá (11:45 UTC).
export const NOW = new Date('2026-10-12T11:45:00Z');
export const MANAGER_EMAIL = 'directorfisica@seguridadnacional.co';
export const PREVIEW_TO = 'juanbotero@premiumsecurity.ai';
export const SECRET_NOTE = 'NOTA-PRIVADA-NO-DEBE-SALIR';
export const TENDER_CLIENT = 'ALCALDIA LICITACION AGT002';

const at = (day, hour = '15:00:00') => `${day}T${hour}Z`;

export function weeklyDigestFixture() {
  const profiles = [
    { id: 'p-ana', full_name: 'Ana María Pérez Gómez', role: 'comercial', active: true, identity_type: 'human', microsoft_email: 'ana.perez@example.co' },
    { id: 'p-beto', full_name: 'Beto Ramírez', role: 'comercial', active: true, identity_type: 'human', microsoft_email: 'Beto.Ramirez@Example.co' },
    { id: 'p-caro', full_name: 'Carolina Díaz Ríos', role: 'comercial', active: true, identity_type: 'human', microsoft_email: 'carolina.diaz@example.co' },
    // Comercial cuya área comercial es sólo licitaciones: excluida por regla.
    { id: 'p-kata', full_name: 'Katalina Licitaciones Prueba', role: 'comercial', active: true, identity_type: 'human', microsoft_email: 'kata@example.co' },
    // Gerente comercial: no es comercial, recibe el resumen y va en copia.
    { id: 'p-lucho', full_name: 'Luis Fernando Gerente Prueba', role: 'director', active: true, identity_type: 'human', can_own_opportunities: true, microsoft_email: MANAGER_EMAIL },
    // Dueño con oportunidades propias: no recibe correo personal ni copias.
    { id: 'p-juan', full_name: 'Juan Dueño', role: 'admin', active: true, identity_type: 'human', can_own_opportunities: true, microsoft_email: PREVIEW_TO },
    // Identidad de agente y comercial inactivo: nunca reciben correo.
    { id: 'p-agent', full_name: 'Vig-IA Comercial', role: 'comercial', active: true, identity_type: 'agent', microsoft_email: 'agent@example.co' },
    { id: 'p-old', full_name: 'Comercial Retirado', role: 'comercial', active: false, identity_type: 'human', microsoft_email: 'old@example.co' },
  ];
  const areaAssignments = [
    { profile_id: 'p-ana', area_code: 'comercial', subarea_code: null },
    // Beto tiene licitaciones Y otra subárea comercial: sí recibe.
    { profile_id: 'p-beto', area_code: 'comercial', subarea_code: 'licitaciones' },
    { profile_id: 'p-beto', area_code: 'comercial', subarea_code: 'empresarial' },
    { profile_id: 'p-kata', area_code: 'comercial', subarea_code: 'licitaciones' },
    { profile_id: 'p-kata', area_code: 'operaciones', subarea_code: null },
    { profile_id: 'p-lucho', area_code: 'comercial', subarea_code: null },
  ];
  const base = { service_type_code: 'seguridad_fisica', stage_code: 'prospecto', observaciones: SECRET_NOTE, loss_notes: SECRET_NOTE };
  const opportunities = [
    // Ana: dos pendientes de decidir, tres agendadas esta semana, una aprobada este mes.
    { ...base, id: 'o-a1', owner_id: 'p-ana', company_name: 'Clínica <script>alert("x")</script> & Cía', quote_city: 'Pereira', offer_value: 120000000, next_action_at: at('2026-10-01'), last_interaction_at: at('2026-09-28') },
    { ...base, id: 'o-a2', owner_id: 'p-ana', company_name: 'Hotel Los Andes', regional_nombre: 'Eje cafetero', offer_value: 45000000, next_action_at: null, last_interaction_at: null },
    { ...base, id: 'o-a3', owner_id: 'p-ana', company_name: 'Conjunto Torres del Parque', quote_city: 'Manizales', offer_value: 30000000, next_action_at: at('2026-10-14') },
    { ...base, id: 'o-a4', owner_id: 'p-ana', company_name: 'Bodegas El Puerto', quote_city: 'Armenia', offer_value: 80000000, next_action_at: at('2026-10-12', '13:00:00') },
    // Domingo 18 a las 23:30 Bogotá = lunes 19 04:30 UTC: todavía es "esta semana".
    { ...base, id: 'o-a5', owner_id: 'p-ana', company_name: 'Colegio San José', quote_city: 'Pereira', offer_value: 15000000, next_action_at: at('2026-10-19', '04:30:00') },
    // Lunes 19 a las 00:30 Bogotá: ya es la semana siguiente.
    { ...base, id: 'o-a6', owner_id: 'p-ana', company_name: 'Centro Comercial Próxima Semana', quote_city: 'Pereira', offer_value: 9000000, next_action_at: at('2026-10-19', '05:30:00') },
    { ...base, id: 'o-a7', owner_id: 'p-ana', company_name: 'Aprobada Octubre', stage_code: 'aprobado', offer_value: 25000000, approved_at: at('2026-10-02') },
    // Licitación pública (AGT-002) de Ana: nunca aparece en el correo.
    { ...base, id: 'o-a8', owner_id: 'p-ana', service_type_code: 'licitacion_publica', company_name: TENDER_CLIENT, offer_value: 9000000000, next_action_at: null },
    // Congelada: ni pendiente ni agenda.
    { ...base, id: 'o-a9', owner_id: 'p-ana', company_name: 'Congelada SAS', offer_value: 70000000, next_action_at: at('2026-09-01'), frozen_until: '2026-12-01' },
    // Beto: al día.
    { ...base, id: 'o-b1', owner_id: 'p-beto', company_name: 'Industrias Beta', quote_city: 'Bogotá', offer_value: 200000000, next_action_at: at('2026-10-15') },
    // Carolina: inactiva con una pendiente grande.
    { ...base, id: 'o-c1', owner_id: 'p-caro', company_name: 'Universidad del Café', quote_city: 'Manizales', offer_value: 350000000, next_action_at: at('2026-09-20'), last_interaction_at: at('2026-09-15') },
    // Katalina (excluida) y Juan: no entran al equipo.
    { ...base, id: 'o-k1', owner_id: 'p-kata', company_name: 'Cliente de Katalina', offer_value: 1, next_action_at: null },
    { ...base, id: 'o-j1', owner_id: 'p-juan', company_name: 'Cliente de Juan', offer_value: 1, next_action_at: null },
  ];
  const interactions = [
    // Semana pasada (5 al 11 de octubre) de Ana: 3 cuentan.
    { opportunity_id: 'o-a1', created_by: 'p-ana', interaction_type: 'llamada', created_at: at('2026-10-05', '05:00:00'), notes: SECRET_NOTE }, // lunes 00:00 Bogotá
    { opportunity_id: 'o-a3', created_by: 'p-ana', interaction_type: 'correo', created_at: at('2026-10-08'), notes: SECRET_NOTE },
    { opportunity_id: 'o-a4', created_by: 'p-ana', interaction_type: 'reunion', created_at: at('2026-10-12', '04:30:00'), notes: SECRET_NOTE }, // domingo 23:30 Bogotá
    // No cuentan para la semana pasada:
    { opportunity_id: 'o-a4', created_by: 'p-ana', interaction_type: 'whatsapp', created_at: at('2026-10-05', '04:59:00') }, // domingo 4, 23:59 Bogotá
    { opportunity_id: 'o-a4', created_by: 'p-ana', interaction_type: 'nota', created_at: at('2026-10-12', '05:30:00') }, // este lunes 00:30 Bogotá
    { opportunity_id: 'o-a8', created_by: 'p-ana', interaction_type: 'llamada', created_at: at('2026-10-07') }, // licitación
    { opportunity_id: 'o-a3', created_by: 'p-ana', interaction_type: 'cambio_estado', created_at: at('2026-10-07') }, // tipo no cuenta
    // Beto: uno la semana pasada.
    { opportunity_id: 'o-b1', created_by: 'p-beto', interaction_type: 'llamada', created_at: at('2026-10-09') },
    // Carolina: hace semanas.
    { opportunity_id: 'o-c1', created_by: 'p-caro', interaction_type: 'llamada', created_at: at('2026-09-15') },
  ];
  const decisions = [
    { opportunity_id: 'o-a3', changed_by: 'p-ana', field_name: 'decision', created_at: at('2026-10-06') },
    { opportunity_id: 'o-a4', changed_by: 'p-ana', field_name: 'decision', created_at: at('2026-10-09') },
    { opportunity_id: 'o-a8', changed_by: 'p-ana', field_name: 'decision', created_at: at('2026-10-09') }, // licitación
    { opportunity_id: 'o-b1', changed_by: 'p-beto', field_name: 'decision', created_at: at('2026-10-03') }, // semana anterior
  ];
  const lastSeen = [
    { profile_id: 'p-ana', last_seen_at: at('2026-10-11') },
    { profile_id: 'p-beto', last_seen_at: at('2026-10-09') },
    { profile_id: 'p-caro', last_seen_at: at('2026-09-20') },
  ];
  const goals = [
    { user_id: 'p-ana', period_month: '2026-10-01', sales_budget: 100000000, service_type_code: null },
    { user_id: 'p-ana', period_month: '2026-10-01', sales_budget: 999999999, service_type_code: 'licitacion_publica' },
  ];
  return { profiles, areaAssignments, opportunities, interactions, decisions, lastSeen, goals, now: NOW, config: { managerEmail: MANAGER_EMAIL } };
}
