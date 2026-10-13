// Cobertura territorial temprana (Juan, 2026-10-13): "no perder tiempo en procesos que no vamos a poder participar o
// dejar claro desde el inicio que solo podemos participar en unión temporal". Funciones puras, sin red.
import type { CompanySite } from './companyBase';

export type CoverageMark = { tone: 'ok' | 'pending' | 'partner'; text: string };
export type ParticipationVerdict = { kind: 'sola' | 'union_temporal' | 'no_puede'; title: string; detail: string };

const PENDING_AUTHORIZATION = /pendiente/i;

function plain(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Clave comparable de un departamento: sin tildes ni prefijos ("Departamento de", "D.C."), Bogotá unificada. */
export function departmentKey(value: string | null | undefined): string {
  let key = plain(String(value || ''));
  key = key.replace(/^(departamento|depto|dpto)( del?| de la)? /, '').replace(/ d c$/, '').trim();
  if (/bogota|distrito capital/.test(key)) return 'bogota';
  if (key === 'valle') return 'valle del cauca';
  if (key.startsWith('san andres')) return 'san andres';
  return key;
}

function siteAuthorized(site: CompanySite): boolean {
  return !PENDING_AUTHORIZATION.test(String(site.supervigilancia_authorization || ''));
}

function siteNames(sites: CompanySite[]): string {
  return [...new Set(sites.map(site => site.city || site.department).filter(Boolean))].join(', ');
}

/**
 * Marca del Radar según el departamento de ejecución y las sedes de Empresa. Sin departamento o sin sedes
 * cargadas no hay marca (no se afirma nada que no se pueda cruzar).
 */
export function radarCoverageMark(department: string | null | undefined, sites: CompanySite[]): CoverageMark | null {
  const label = String(department || '').trim();
  if (!label || !sites.length) return null;
  const key = departmentKey(label);
  const inDepartment = sites.filter(site => departmentKey(site.department) === key);
  const authorized = inDepartment.filter(siteAuthorized);
  if (authorized.length) return { tone: 'ok', text: `Tenemos sede en ${label} (${siteNames(authorized)})` };
  if (key === 'cundinamarca') {
    const bogota = sites.filter(site => departmentKey(site.department) === 'bogota' && siteAuthorized(site));
    if (bogota.length) return { tone: 'ok', text: 'Tenemos sede en Bogotá (suele cubrir Cundinamarca; confirmar en el pliego)' };
  }
  if (inDepartment.length) return { tone: 'pending', text: `Sede con autorización pendiente en ${label} (${siteNames(inDepartment)})` };
  return { tone: 'partner', text: `Solo en unión temporal: sin sede en ${label}` };
}

const VERDICTS: Array<{ prefix: RegExp; kind: ParticipationVerdict['kind']; title: string }> = [
  { prefix: /^puede presentarse sola\.?\s*/i, kind: 'sola', title: 'Puede presentarse sola' },
  { prefix: /^solo en uni[oó]n temporal:?\s*/i, kind: 'union_temporal', title: 'Solo en unión temporal' },
  { prefix: /^no puede presentarse:?\s*/i, kind: 'no_puede', title: 'No puede presentarse' },
];

/** Veredicto de participación con el que empieza recommendation.label en los análisis nuevos; null en los viejos. */
export function participationVerdict(label: string | null | undefined): ParticipationVerdict | null {
  const text = String(label || '').trim();
  for (const verdict of VERDICTS) {
    const match = text.match(verdict.prefix);
    if (match) return { kind: verdict.kind, title: verdict.title, detail: text.slice(match[0].length).trim() };
  }
  return null;
}
