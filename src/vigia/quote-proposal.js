// AGT-003 — Propuesta de una cotización y lo que la cotización le pasa a la oportunidad (entrega 4; Juan, 2026-11-16).
//
// Módulo puro: arma el contenido de la propuesta (lo que dice, no cómo se dibuja; eso lo hace quote-proposal-pdf.ts) y
// las dos reglas que llevan la cotización al CRM. Sin red, sin base y sin reloj implícito: la fecha llega como
// parámetro.
//
// Decisiones de Juan (2026-11-16):
//   · Condiciones por defecto: oferta válida 30 días; vigilancia mes vencido, factura a 30 días; tecnología 50 % de
//     anticipo y 50 % contra entrega e instalación; garantía de equipos la del fabricante, mínimo un año; instalación
//     en 15 días hábiles desde la orden.
//   · Presentación de la empresa: sólo lo verificable, y el logo como es, con su frase ("Sabemos de seguridad").
//   · Valor que pasa a la oportunidad: vigilancia = lo mensual antes de IVA; tecnología = el total antes de IVA.
//   · Los puestos de la cotización pasan al formulario de cierre.
//
// Cambios de Juan (2026-11-25), con las respuestas del área comercial:
//   · Validez: 30 días la vigilancia y 15 días la tecnología.
//   · Vigilancia: se factura el mes por anticipado y la factura se paga a 30 días.
//   · Garantía de los equipos: un año. Entrega e instalación: depende del proyecto (lo escribe el comercial).
//   · Presentación: sólo lo verificable, con las sedes que tienen resolución de la Superintendencia.
//   · Cotización mixta: ya no se suma. La vigilancia va a la oportunidad de seguridad física y la tecnología a una de
//     tipo «proyecto», para seguir las dos líneas por separado (las divide el servidor).
// Lo que la propuesta NO muestra nunca: el costo de los equipos ni el margen (son internos).

import { GUARD_DAY_TYPES } from './quote-engine.js';

export const COMPANY = Object.freeze({
  name: 'Seguridad Nacional Ltda.',
  tagline: 'Sabemos de seguridad',
  nit: '891.408.256-4',
  city: 'Pereira',
  // Sede principal y agencias con resolución de la Superintendencia (psi_company_sites, 2026-11-25). Armenia no va:
  // su resolución está pendiente.
  agencies: Object.freeze(['Bogotá', 'Medellín', 'Cali', 'Manizales', 'Cartago']),
});

export const GUARD_VALIDITY_DAYS = 30;
export const TECH_VALIDITY_DAYS = 15;

const MODALITY_LABEL = Object.freeze({ sin_arma: 'Sin arma', con_arma: 'Con arma', canino: 'Canino' });
const CATEGORY_LABEL = Object.freeze({ equipo: 'Equipo', insumo: 'Insumos', mano_de_obra: 'Instalación y programación' });
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const pesos = value => `$ ${Math.round(Number(value) || 0).toLocaleString('es-CO')}`;

/** `AAAA-MM-DD` → "16 de noviembre de 2026". */
export function longDate(day) {
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

/** Suma días a una fecha `AAAA-MM-DD`, en calendario (sin zona horaria de por medio). */
export function addDays(day, days) {
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** "0600" → "06:00"; "2400" → "24:00". La hora ya pasó por el motor, así que es válida. */
export function clock(value) {
  const raw = String(value ?? '').replace(':', '').trim();
  const text = raw.length <= 2 ? `${raw.padStart(2, '0')}00` : raw.padStart(4, '0');
  return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

/** Los días que cubre un puesto, en palabras: "Todos los días", "Lunes a viernes y sábados". */
export function daysLabel(dayTypes = []) {
  const marked = GUARD_DAY_TYPES.filter(type => dayTypes.includes(type.code));
  if (marked.length === GUARD_DAY_TYPES.length) return 'Todos los días';
  const names = marked.map((type, index) => (index === 0 ? type.label : type.label.toLowerCase()));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || '';
}

/** El horario de un puesto: "24 horas" o "06:00 a 18:00". */
export function scheduleLabel(post, result) {
  return result.totalHours === 24 ? '24 horas' : `${clock(post.start)} a ${clock(post.end)}`;
}

/**
 * Los valores que la cotización le pone a sus oportunidades, siempre antes de IVA: la vigilancia (lo mensual) va a la
 * de seguridad física y la tecnología (el total) a la de proyecto. Una cotización mixta trae los dos y el servidor los
 * reparte en dos oportunidades (Juan, 2026-11-25). Devuelve `null` si la cotización no tiene nada.
 */
export function opportunityValuesFromQuote(totals) {
  const guard = totals.posts.length ? { value: totals.monthly.subtotal, explanation: `Vigilancia ${pesos(totals.monthly.subtotal)} al mes, antes de IVA.` } : null;
  const tech = totals.lines.length ? { value: totals.oneTime.subtotal, explanation: `Tecnología ${pesos(totals.oneTime.subtotal)} en total, antes de IVA.` } : null;
  return guard || tech ? { guard, tech, mixed: Boolean(guard && tech) } : null;
}

/** Tipo de oportunidad que recibe la tecnología de una cotización mixta, y el que recibe la vigilancia. */
export const TECH_OPPORTUNITY_TYPE = 'proyecto';
export const GUARD_OPPORTUNITY_TYPE = 'seguridad_fisica';

/**
 * Los puestos de la cotización en la forma del formulario de cierre (GGC-FO-001). El valor es el del puesto antes de
 * IVA, que es lo que el formulario pide; el AIU y el IVA los vuelve a calcular el formulario con la misma regla.
 */
export function closurePostsFromQuote(guardPosts, results) {
  return guardPosts.map((post, index) => {
    const result = results[index];
    const name = String(post.name || '').trim() || `Puesto ${index + 1}`;
    // El campo de hora del formulario no acepta 24:00: la medianoche es 00:00.
    const time = value => { const text = clock(value); return text === '24:00' ? '00:00' : text; };
    return {
      description: `${name} · ${MODALITY_LABEL[post.modality] || post.modality} · ${scheduleLabel(post, result)} · ${daysLabel(post.dayTypes)}`.slice(0, 500),
      shift_start: time(post.start),
      shift_end: time(post.end),
      days_per_month: result.days,
      guards_required: result.guards,
      armed: post.modality === 'con_arma',
      service_value: result.subtotal,
      notes: post.modality === 'canino' ? 'Modalidad canina (de la cotización).' : null,
    };
  });
}

/** Las condiciones comerciales que aplican, según lo que lleve la cotización. */
export function proposalConditions({ hasGuard, hasTech, today, deliveryTerms = '' }) {
  const list = [];
  if (hasGuard) {
    list.push(`Vigilancia: oferta válida por ${GUARD_VALIDITY_DAYS} días, hasta el ${longDate(addDays(today, GUARD_VALIDITY_DAYS))}.`);
    list.push('Vigilancia: se factura mensualmente por anticipado y la factura se paga a 30 días.');
    list.push('Vigilancia: valores calculados con la tarifa vigente de la Superintendencia de Vigilancia y Seguridad Privada.');
  }
  if (hasTech) {
    const terms = String(deliveryTerms || '').trim().replace(/\.$/, '');
    list.push(`Medios tecnológicos: oferta válida por ${TECH_VALIDITY_DAYS} días, hasta el ${longDate(addDays(today, TECH_VALIDITY_DAYS))}.`);
    list.push('Medios tecnológicos: 50 % de anticipo con la orden de compra y 50 % contra entrega e instalación.');
    list.push(terms ? `Medios tecnológicos: entrega e instalación: ${terms}.` : 'Medios tecnológicos: entrega e instalación según el cronograma que se acuerde para el proyecto.');
    list.push('Medios tecnológicos: garantía de los equipos de un año.');
  }
  return list;
}

/**
 * Todo lo que dice la propuesta. `quote` es la cotización como la devuelve el servidor (con `totals`); `today` es el
 * día de la propuesta (`AAAA-MM-DD`, hora de Colombia); `seller` es quien la firma.
 */
export function proposalContent({ quote, today, seller = null }) {
  const totals = quote.totals;
  const hasGuard = totals.posts.length > 0;
  const hasTech = totals.lines.length > 0;
  // La oferta entera vence con la línea que vence primero.
  const validUntil = addDays(today, hasTech ? TECH_VALIDITY_DAYS : GUARD_VALIDITY_DAYS);
  const guard = hasGuard ? {
    rows: quote.guardPosts.map((post, index) => {
      const result = totals.posts[index];
      return {
        name: String(post.name || '').trim() || `Puesto ${index + 1}`,
        schedule: scheduleLabel(post, result),
        days: daysLabel(post.dayTypes),
        guards: result.guards,
        modality: MODALITY_LABEL[post.modality] || post.modality,
        value: result.subtotal,
      };
    }),
    subtotal: totals.monthly.subtotal,
    aiu: totals.monthly.aiu,
    iva: totals.monthly.iva,
    total: totals.monthly.total,
  } : null;
  const tech = hasTech ? {
    // Precio de venta, nunca el costo ni el margen.
    rows: quote.techLines.map((line, index) => {
      const result = totals.lines[index];
      return {
        description: String(line.description || '').trim() || CATEGORY_LABEL[line.category],
        category: CATEGORY_LABEL[line.category] || line.category,
        quantity: result.quantity,
        unitPrice: result.unitPrice,
        value: result.price,
      };
    }),
    subtotal: totals.oneTime.subtotal,
    iva: totals.oneTime.iva,
    total: totals.oneTime.total,
  } : null;
  return {
    company: COMPANY,
    number: `SN-COT-${String(quote.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || 'BORRADOR'}`,
    date: longDate(today),
    validUntil: longDate(validUntil),
    client: String(quote.client_name || '').trim() || 'Cliente',
    reference: String(quote.title || '').trim() || null,
    intro: proposalIntro({ hasGuard, hasTech }),
    guard,
    tech,
    conditions: proposalConditions({ hasGuard, hasTech, today, deliveryTerms: quote.tech_delivery_terms }),
    seller: seller && String(seller.name || '').trim() ? { name: String(seller.name).trim(), email: seller.email || null, phone: seller.phone || null } : null,
  };
}

function proposalIntro({ hasGuard, hasTech }) {
  const what = hasGuard && hasTech
    ? 'el servicio de vigilancia y los medios tecnológicos'
    : hasGuard ? 'el servicio de vigilancia' : 'los medios tecnológicos';
  const agencies = COMPANY.agencies;
  const list = agencies.length > 1 ? `${agencies.slice(0, -1).join(', ')} y ${agencies[agencies.length - 1]}` : agencies[0];
  return `Agradecemos la oportunidad de presentar nuestra propuesta para ${what} que se describen a continuación. ${COMPANY.name}, con sede principal en ${COMPANY.city} y agencias en ${list}, presta servicios de vigilancia y seguridad privada.`;
}
