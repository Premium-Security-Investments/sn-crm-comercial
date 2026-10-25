// Autoridad de medición de consumo de AGT-002 Radar (issue #136).
//
// `agt002-hetzner-bridge-client.js` es el único punto del camino que observa lo que el proveedor
// realmente ejecutó: valida la respuesta del transporte firmado y la devuelve como
// `response.usage`. El JSON que produce el modelo viaja DENTRO de `response.content`, así que su
// bloque `usage` es material auto-reportado: el modelo no puede declarar sus propios tokens, su
// propio modelo ni su propio costo. Este módulo construye el único bloque `usage` que el contrato
// acepta y lo hace siempre desde la medición del puente.
//
// Semántica explícita de modelo (`usage.model` en el retorno):
//   · modelo solicitado: el que el runtime pidió y firmó hacia el puente
//     (`AGT002_RADAR_PREANALYSIS_MODEL`). Es lo que se quiso ejecutar.
//   · modelo resuelto: el que el puente informa en su medición. Es lo que se ejecutó y es lo que
//     se persiste como modelo de la corrida (`usage.model`). Si el puente no informa modelo, el
//     resuelto es el solicitado —el puente firma la petición con ese modelo exacto—, nunca un
//     valor tomado del JSON del modelo ni reconstruido desde el entorno al persistir.
// Que el resuelto difiera del solicitado (alias del proveedor) no es un error y no se corrige: se
// registra tal cual. Lo que sí falla cerrado es una medición que el puente no debería haber
// aceptado.
//
// Costo: el puente no siempre mide costo. Cuando no lo informa (ausente o `null`), se persiste
// `cost_usd: null` explícito —"no medido"—, nunca un 0 inventado: 0 es una medición legítima (el
// puente sí midió y el costo fue cero) y no puede confundirse con la ausencia de medición. Cuando el
// puente informa un costo, sea 0 o positivo, se conserva tal cual. Nunca se acepta el costo que
// declare el modelo.

export const AGT002_RADAR_PREANALYSIS_USAGE_PROVIDER = 'hetzner_bridge';
export const AGT002_RADAR_PREANALYSIS_UNTRUSTED_USAGE_CODE = 'AGT002_RADAR_PREANALYSIS_UNTRUSTED_USAGE';

const USAGE_KEYS = Object.freeze(['provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd']);
const SORTED_USAGE_KEYS = Object.freeze([...USAGE_KEYS].sort());

// `classifyAgt002RadarPreanalysisError` mapea este código a `provider_error`: una medición que el
// puente no debería haber aceptado es una falla del proveedor/transporte, no del JSON del modelo.
function untrusted(reason) {
  const error = new Error(`${AGT002_RADAR_PREANALYSIS_UNTRUSTED_USAGE_CODE}: ${reason}`);
  error.code = AGT002_RADAR_PREANALYSIS_UNTRUSTED_USAGE_CODE;
  error.runtime_boundary_code = AGT002_RADAR_PREANALYSIS_UNTRUSTED_USAGE_CODE;
  return error;
}
function nonemptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
// 0 es una medición legítima, no "ausente": nunca se puede caer a otro valor por ser falsy.
function tokenCount(value) { return Number.isInteger(value) && value >= 0; }
function finiteCost(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }

// Sólo `usage` sobrevive hasta la persistencia (ver `agt002-radar-preanalysis-runtime.js`): el
// helper no promete más campos que los que el llamador realmente usa.
export function measureAgt002RadarPreanalysisUsage({ requestedModel, bridgeUsage } = {}) {
  if (!nonemptyString(requestedModel)) throw untrusted('requested model');
  if (!bridgeUsage || typeof bridgeUsage !== 'object' || Array.isArray(bridgeUsage)) throw untrusted('bridge usage missing');
  if (!tokenCount(bridgeUsage.input_tokens) || !tokenCount(bridgeUsage.output_tokens)) throw untrusted('bridge token counts');
  if (bridgeUsage.model !== undefined && bridgeUsage.model !== null && !nonemptyString(bridgeUsage.model)) throw untrusted('bridge model');
  const costProvided = bridgeUsage.cost_usd !== undefined && bridgeUsage.cost_usd !== null;
  if (costProvided && !finiteCost(bridgeUsage.cost_usd)) throw untrusted('bridge cost');
  // modelo resuelto: lo que el puente informa haber ejecutado; sin ese dato, el solicitado —el
  // puente firmó la petición con él— es el mejor registro disponible, nunca el JSON del modelo.
  const resolved = nonemptyString(bridgeUsage.model) ? bridgeUsage.model.trim() : requestedModel.trim();
  return Object.freeze({
    usage: Object.freeze({
      provider: AGT002_RADAR_PREANALYSIS_USAGE_PROVIDER,
      model: resolved,
      input_tokens: bridgeUsage.input_tokens,
      output_tokens: bridgeUsage.output_tokens,
      cost_usd: costProvided ? bridgeUsage.cost_usd : null,
    }),
  });
}

// Frontera de persistencia: el bloque `usage` del envelope tiene que ser una medición completa.
// La autoridad se impone en el runtime, que es el único punto que observa `response.usage`; aquí
// se comprueba que lo que llegó al ledger sigue siendo esa forma cerrada y no una declaración
// incompleta que el llamador tendría que completar adivinando (entorno, ceros, `{}`).
export function assertAgt002RadarPreanalysisMeasuredUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw untrusted('usage missing');
  const keys = Object.keys(usage).sort();
  if (keys.length !== SORTED_USAGE_KEYS.length || keys.some((key, index) => key !== SORTED_USAGE_KEYS[index])) throw untrusted('usage closed shape');
  if (!nonemptyString(usage.provider) || !nonemptyString(usage.model)) throw untrusted('usage provider/model');
  if (!tokenCount(usage.input_tokens) || !tokenCount(usage.output_tokens)) throw untrusted('usage token counts');
  // `null` es "el puente no midió costo"; cualquier otro valor debe ser un número finito >= 0.
  if (usage.cost_usd !== null && !finiteCost(usage.cost_usd)) throw untrusted('usage cost');
  return usage;
}
