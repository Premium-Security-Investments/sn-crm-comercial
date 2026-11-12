// Cruce de cada requisito con la ficha de la empresa (Juan, 2026-11-12: «usted debe organizar y analizar el Excel y,
// como ya tenemos la información muy completa de la empresa, definir cuáles serían inhabilitantes… sino para qué sirve
// el Excel»). Reglas de texto contra los datos de la ficha, sin modelo: si la ficha cambia (otro corte financiero, una
// sede nueva, un código nuevo), el veredicto cambia solo.
//
// Veredictos, de más a menos grave:
//   inhabilita  con lo que dice la ficha no cumplimos (y no es un papel que se saque para el proceso);
//   verificar   la ficha no tiene el dato: hay que confirmarlo antes de contar con él;
//   depende     depende de un dato del proceso (el presupuesto, la experiencia que se escoja);
//   se_prepara  es un documento o formato que se arma o se renueva para cada proceso;
//   cumple      la ficha muestra que cumplimos.
// Sólo los habilitantes: un puntuable que no tenemos resta puntos pero no inhabilita.
import { foldText } from './requirement-catalog.js';

export const ASSESSMENT_VERDICTS = Object.freeze({ inhabilita: 'Nos inhabilita', verificar: 'Por verificar', depende: 'Depende del proceso', se_prepara: 'Se prepara para cada proceso', cumple: 'Cumplimos' });

const money = value => `$${Math.round(value / 1e6).toLocaleString('es-CO')} millones`;
const number = value => String(value).replace('.', ',');
const parseNumber = raw => {
  const text = String(raw).trim();
  // «9.589.715.984» o «1.5» o «3,17»: la coma es decimal; un punto sólo lo es si no hay grupos de mil.
  const normalized = /^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(',', '.');
  return Number(normalized);
};

// Los números que siguen a un indicador dentro de la misma frase: «endeudamiento <=0.40», «Liquidez ≥ 1,50».
// Las fechas («corte 31/12/2025») no son umbrales.
const withoutDates = text => foldText(text).replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
function thresholdFor(text, labels) {
  const folded = withoutDates(text).replace(/≥|>=/g, ' mayor o igual a ').replace(/≤|<=/g, ' menor o igual a ');
  for (const label of labels) {
    const match = folded.match(new RegExp(`${label}[^;0-9]{0,60}?(\\d+(?:[.,]\\d+)?)\\s*(%)?`));
    if (match) return { value: parseNumber(match[1]), percent: Boolean(match[2]) };
  }
  return null;
}
function firstThreshold(text) {
  const match = withoutDates(text).match(/(\d+(?:[.,]\d+)?)\s*(%)?/);
  return match ? { value: parseNumber(match[1]), percent: Boolean(match[2]) } : null;
}
const ratio = threshold => (threshold.percent || threshold.value > 1.5 ? threshold.value / 100 : threshold.value);

// Ciudades con las que se cruza la presencia: capitales y municipios donde hemos licitado.
const CITIES = ['Arauca', 'Armenia', 'Barranquilla', 'Bogotá', 'Bucaramanga', 'Cali', 'Cartagena', 'Cartago', 'Cúcuta', 'Dosquebradas', 'Florencia', 'Ibagué', 'Inírida', 'Leticia', 'Manizales', 'Medellín', 'Mitú', 'Mocoa', 'Montería', 'Neiva', 'Pasto', 'Pereira', 'Piedecuesta', 'Popayán', 'Puerto Carreño', 'Quibdó', 'Riohacha', 'San Andrés', 'San José del Guaviare', 'Santa Marta', 'Santa Rosa de Cabal', 'Sincelejo', 'Tunja', 'Valledupar', 'Villavicencio', 'Villamaría', 'Yopal'];
const citiesIn = text => CITIES.filter(city => new RegExp(`\\b${foldText(city)}\\b`).test(foldText(text)));

const FINANCIAL = {
  liquidez: { labels: ['liquidez'], fact: 'liquidez', min: true, name: 'liquidez' },
  endeudamiento: { labels: ['endeudamiento'], fact: 'endeudamiento', min: false, name: 'endeudamiento', asRatio: true },
  cobertura_intereses: { labels: ['cobertura de intereses', 'razon de cobertura'], fact: 'cobertura', min: true, name: 'cobertura de intereses' },
};

function assessFinancial(type, text, company) {
  const results = [];
  for (const [key, spec] of Object.entries(FINANCIAL)) {
    const threshold = thresholdFor(text, spec.labels) || (key === type ? firstThreshold(text) : null);
    if (!threshold || company[spec.fact] === undefined) continue;
    const limit = spec.asRatio ? ratio(threshold) : threshold.value;
    const ours = company[spec.fact];
    const ok = spec.min ? ours >= limit : ours <= limit;
    results.push({ ok, reason: `${spec.name[0].toUpperCase()}${spec.name.slice(1)}: piden ${spec.min ? 'al menos' : 'como máximo'} ${number(spec.asRatio ? `${Math.round(limit * 100)} %` : limit)}; tenemos ${spec.asRatio ? `${Math.round(ours * 100)} %` : number(ours)}.` });
  }
  if (type === 'rentabilidad') {
    const folded = foldText(text);
    const roe = thresholdFor(text, ['roe', 'patrimonio']);
    const roa = thresholdFor(text, ['roa', 'activo']);
    if (roe && company.roe !== undefined && /patrimonio|roe/.test(folded)) results.push({ ok: company.roe >= ratio(roe), reason: `Rentabilidad del patrimonio: piden al menos ${number(ratio(roe))}; tenemos ${number(company.roe)}.` });
    if (roa && company.roa !== undefined && /activo|roa/.test(folded)) results.push({ ok: company.roa >= ratio(roa), reason: `Rentabilidad del activo: piden al menos ${number(ratio(roa))}; tenemos ${number(company.roa)}.` });
  }
  if (!results.length) return null;
  const failed = results.filter(result => !result.ok);
  return failed.length ? { verdict: 'inhabilita', reason: failed.map(result => result.reason).join(' ') } : { verdict: 'cumple', reason: results.map(result => result.reason).join(' ') };
}

function assessShareOfBudget(type, text, company) {
  const fact = type === 'capital_trabajo' ? company.capitalTrabajo : company.patrimonio;
  const match = foldText(text).match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:del|de el)?\s*(?:presupuesto|valor)/);
  if (!fact) return { verdict: 'depende', reason: 'Depende del presupuesto del proceso.' };
  const name = type === 'capital_trabajo' ? 'capital de trabajo' : 'patrimonio';
  if (!match) return { verdict: 'depende', reason: `Depende del presupuesto del proceso; nuestro ${name} es de ${money(fact)}.` };
  const share = parseNumber(match[1]) / 100;
  return { verdict: 'depende', reason: `Piden ${name} de al menos el ${Math.round(share * 100)} % del presupuesto: con ${money(fact)} cumplimos si el presupuesto es de hasta ${money(fact / share)}.` };
}

function assessCodes(text, company) {
  // Los números de solicitud de SECOP («CO1.REQ.11051174») no son códigos.
  const codes = [...new Set(String(text).replace(/CO1\.[A-Z]+\.\d+/g, ' ').match(/\b\d{8}\b/g) || [])];
  if (codes.length) {
    const missing = codes.filter(code => !company.codes.includes(code));
    const any = /\b(o|alguno|cualquiera|al menos (uno|dos)|minimo (uno|dos))\b/.test(foldText(text));
    if (!missing.length || (any && missing.length < codes.length)) return { verdict: 'cumple', reason: `Tenemos ${codes.filter(code => company.codes.includes(code)).join(', ')} en el RUP.` };
    return { verdict: 'inhabilita', reason: `No tenemos en el RUP: ${missing.join(', ')}.` };
  }
  const count = foldText(text).match(/minimo (\w+) codigos/);
  const words = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  const needed = count ? Number(count[1]) || words[count[1]] : null;
  if (needed) return needed > company.codes.length ? { verdict: 'inhabilita', reason: `Piden ${needed} códigos y tenemos ${company.codes.length}.` } : { verdict: 'depende', reason: `Piden ${needed} códigos de la lista del pliego; tenemos ${company.codes.length} en el RUP: hay que cruzarlos con la lista.` };
  return { verdict: 'depende', reason: 'Depende de los códigos que pida el pliego.' };
}

function assessPresence(text, company, process) {
  const folded = foldText(text);
  // Una fila de la matriz puede juntar varios procesos: cada uno se mide con su propia ciudad.
  const own = citiesIn(process || '');
  const cities = own.length ? own : citiesIn(text);
  if (!cities.length) return { verdict: 'depende', reason: 'Depende de las ciudades del proceso.' };
  const acceptsAgency = /agencia/.test(folded);
  const onlyMain = /domicilio principal/.test(folded) && !/sucursal|agencia/.test(folded);
  const years = Number(folded.match(/(\d+)\s*anos/)?.[1] || 0);
  const lacking = [];
  for (const city of cities) {
    const key = foldText(city);
    if (key === foldText(company.mainCity)) continue;
    const agency = company.agencies.find(item => foldText(item.city) === key);
    if (onlyMain) { lacking.push(`${city}: piden domicilio principal y el nuestro es ${company.mainCity}`); continue; }
    if (!agency) { lacking.push(`${city}: no tenemos sede`); continue; }
    if (!acceptsAgency) { lacking.push(`${city}: tenemos agencia y piden sede principal o sucursal`); continue; }
    if (years && agency.since && (new Date().getFullYear() - Number(agency.since)) < years) lacking.push(`${city}: piden ${years} años y la agencia es de ${agency.since}`);
  }
  return lacking.length ? { verdict: 'inhabilita', reason: `${lacking.join('; ')}. Solos no cumplimos; en unión temporal, con un socio que la tenga.` }
    : { verdict: 'cumple', reason: `Tenemos presencia en ${cities.join(', ')}.` };
}

const has = (company, type) => company.documents.some(document => document.type === type);

/**
 * El veredicto de un requisito habilitante contra la ficha. `type` es la clave del catálogo; `text`, el requisito y su
 * umbral; `quote`, la cita del pliego, que sólo se usa si el número no está en el texto (la matriz junta en una fila
 * citas de varios procesos). Pura.
 */
export function assessRequirement({ type, text, quote = '', process = '' }, company) {
  if (!company) return null;
  if (quote && ['liquidez', 'endeudamiento', 'cobertura_intereses', 'rentabilidad', 'codigos_unspsc'].includes(type)) {
    const own = assessRequirement({ type, text, process }, company);
    return own && !['depende'].includes(own.verdict) ? own : assessRequirement({ type, text: `${text} ${quote}`, process }, company);
  }
  const folded = foldText(text);
  switch (type) {
    case 'liquidez': case 'endeudamiento': case 'cobertura_intereses': case 'rentabilidad':
      return assessFinancial(type, text, company) || { verdict: 'depende', reason: 'El pliego no trae el número en esta fila.' };
    case 'capital_trabajo': case 'patrimonio':
      return /origen|ilicit/.test(folded) ? { verdict: 'se_prepara', reason: 'Declaración de origen de fondos.' } : assessShareOfBudget(type, text, company);
    case 'estados_financieros': case 'capacidad_residual':
      return assessFinancial(type, text, company) || { verdict: 'se_prepara', reason: 'Estados financieros y certificaciones del corte vigente.' };
    case 'codigos_unspsc': return assessCodes(text, company);
    case 'presencia_local': return assessPresence(text, company, process);
    case 'rup_vigente': return { verdict: 'cumple', reason: 'RUP en firme; se renueva cada año y el certificado se expide para el cierre.' };
    case 'licencia_supervigilancia':
      return { verdict: 'cumple', reason: `Licencia vigente hasta ${company.licenseUntil || '2029'} con vigilancia fija, móvil, escolta, con y sin armas, medio tecnológico y canino.` };
    case 'licencia_comunicaciones':
      if (/(cobertura|nivel|registro|ambito|alcance) nacional|todo el territorio nacional/.test(folded) && !/nacional (o|y\/o) (en|del)/.test(folded)) return { verdict: 'inhabilita', reason: 'Piden cobertura o registro nacional de telecomunicaciones; nuestro permiso de espectro no es nacional (en Terminal no cubría Bogotá).' };
      if (/frecuencias? (minimas|para)|cobertura en|\ben (riohacha|ibague|tolima)\b|espectro radioelectrico en/.test(folded)) return { verdict: 'verificar', reason: 'Tenemos permiso de espectro y Registro TIC; hay que confirmar la cobertura que piden (en Terminal no cubría Bogotá).' };
      return has(company, 'communications_license') ? { verdict: 'cumple', reason: 'Permiso de espectro (Res. MinTIC 01535 de 2026) y Registro TIC.' } : { verdict: 'verificar', reason: 'La ficha no tiene licencia de comunicaciones.' };
    case 'canina':
      if (/criadero|sede canina|resolucion de (la )?sede|centro de (adiestramiento|entrenamiento)|caninos? propios/.test(folded)) return { verdict: 'inhabilita', reason: 'Piden sede canina (criadero) autorizada o caninos propios; no la tenemos.' };
      return /explosivos|disponibilidad/.test(folded) ? { verdict: 'verificar', reason: 'La licencia incluye medio canino; la ficha no dice cuántos caninos propios ni su especialidad.' } : { verdict: 'cumple', reason: 'La licencia incluye medio canino.' };
    case 'horas_extras': return { verdict: 'verificar', reason: 'La ficha no tiene la autorización del Ministerio del Trabajo para horas extras.' };
    case 'red_apoyo': return { verdict: 'se_prepara', reason: 'Certificado de vinculación a la red de apoyo de la Policía.' };
    case 'registro_tecnologia':
      if (/importador|comercializador|distribuidor|productores/.test(folded)) return { verdict: 'inhabilita', reason: 'Piden el registro de importador, comercializador o distribuidor de equipos ante la Supervigilancia; no lo tenemos.' };
      return /carta|certificado del fabricante|autorice/.test(folded) ? { verdict: 'se_prepara', reason: 'Carta del fabricante para el proceso.' } : { verdict: 'verificar', reason: 'La ficha no tiene taller ni soporte técnico registrado.' };
    case 'calidad_sst': {
      const iso = [...new Set((String(text).match(/iso\s*\d{4,5}/gi) || []).map(item => item.replace(/\s+/g, ' ').toUpperCase()))];
      const ours = company.documents.filter(document => document.type === 'quality_certifications').map(document => document.name.toUpperCase());
      const missing = iso.filter(code => !ours.some(name => name.includes(code.replace('ISO ', ''))));
      if (missing.length) return { verdict: 'inhabilita', reason: `No tenemos ${missing.join(', ')}.` };
      return iso.length ? { verdict: 'cumple', reason: `Tenemos ${iso.join(', ')}.` } : { verdict: 'se_prepara', reason: 'Documentos del SG-SST para el proceso.' };
    }
    case 'poliza_rce': return has(company, 'rce_policy') ? { verdict: 'cumple', reason: 'Póliza de RCE vigente; revisar que el valor asegurado alcance el que pide el pliego.' } : { verdict: 'verificar', reason: 'La ficha no tiene póliza de RCE.' };
    case 'poliza_vida': return has(company, 'collective_life_policy') ? { verdict: 'cumple', reason: 'Póliza colectiva de vida vigente.' } : { verdict: 'verificar', reason: 'La ficha no tiene póliza de vida.' };
    case 'garantia_seriedad': case 'garantias_contrato': return { verdict: 'se_prepara', reason: 'Se expide con la aseguradora para cada proceso.' };
    case 'sanciones_supervigilancia': return { verdict: 'se_prepara', reason: 'Certificado de la Supervigilancia; se renueva para que no pase de 90 días al cierre.' };
    case 'experiencia_general': case 'experiencia_especifica':
      return { verdict: 'depende', reason: 'Se cruza con las 101 experiencias del RUP en cada proceso (Preparar → Experiencia para esta oferta).' };
    case 'personal_minimo': case 'responsable_sst': case 'centro_operaciones': case 'vehiculos': case 'equipos_tecnologia': case 'muestras_fichas':
      return { verdict: 'verificar', reason: 'La ficha no trae el inventario de personal, vehículos ni equipos: se confirma con Operaciones para cada proceso.' };
    case 'uniformes': return has(company, 'uniforms_resolution') ? { verdict: 'cumple', reason: 'Resolución de uniformes de la Supervigilancia.' } : { verdict: 'verificar', reason: 'La ficha no tiene la resolución de uniformes.' };
    case 'armas': return { verdict: 'se_prepara', reason: 'Listado de armas y permisos; se actualiza para cada cierre.' };
    case 'antecedentes': case 'seguridad_social': case 'existencia_representacion': case 'rut': case 'identificacion':
    case 'inhabilidades': case 'sarlaft': case 'carta_formatos': case 'proponente_plural': case 'estructura_organizacional':
    case 'oferta_economica': case 'cronograma':
      return { verdict: 'se_prepara', reason: 'Documento o formato que se arma o se renueva para cada proceso.' };
    default:
      return { verdict: 'verificar', reason: 'Sin regla automática: revisarlo en el pliego.' };
  }
}

const RANK = { inhabilita: 0, verificar: 1, depende: 2, se_prepara: 3, cumple: 4 };
/** El veredicto de un tipo: el peor de sus ocurrencias, con cuántas lo tienen. Pura. */
export function summarizeAssessments(occurrences) {
  const assessed = occurrences.filter(item => item.assessment);
  if (!assessed.length) return null;
  const worst = assessed.reduce((a, b) => (RANK[b.assessment.verdict] < RANK[a.assessment.verdict] ? b : a));
  return { verdict: worst.assessment.verdict, count: assessed.filter(item => item.assessment.verdict === worst.assessment.verdict).length, reason: worst.assessment.reason };
}
