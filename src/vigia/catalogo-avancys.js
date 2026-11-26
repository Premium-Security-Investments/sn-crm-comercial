// AGT-003 — Catálogo de productos de Avancys en el cotizador (entrega 5a; Juan, 2026-11-26: «si ya está en Avancys,
// ¿por qué no se trae todo y ya?»). Módulo puro: convierte un producto de Avancys en una línea del cotizador.
//
// El catálogo lo mantienen en Avancys (1.114 productos vendibles el 2026-11-26). Se usa su COSTO, que es lo que el
// cotizador espera (el precio sale con el margen de las tarifas); el «precio de venta» de Avancys no trae valores
// reales. Herramientas, gastos y operaciones no se le venden al cliente: no salen.

const FUERA = new Set(['HERRAMIENTAS', 'GASTOS', 'OPERACIONES']);
const INSUMOS = new Set(['ACCESORIOS', 'INSUMOS', 'CABLES']);

/** Tipo de línea del cotizador según la categoría del producto: equipo, insumo o mano de obra. */
export function tipoDeLinea({ categoria = '', tipo = '' } = {}) {
  const grupo = String(categoria || '').split('/')[0].trim().toUpperCase();
  if (FUERA.has(grupo)) return null;
  if (tipo === 'service' || grupo === 'SERVICIOS') return 'mano_de_obra';
  if (INSUMOS.has(grupo)) return 'insumo';
  return 'equipo';
}

/** Los productos que el cotizador puede usar, ya con su tipo de línea, ordenados por categoría y nombre. */
export function catalogoParaCotizar(productos = []) {
  return productos
    .map(p => ({ ...p, linea: tipoDeLinea(p) }))
    .filter(p => p.linea && Number(p.costo) > 0 && String(p.nombre || '').trim())
    .sort((a, b) => String(a.categoria).localeCompare(String(b.categoria), 'es') || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

/** Busca por palabras (todas deben aparecer) en el código, el nombre o la categoría, sin tildes ni mayúsculas. */
export function buscarEnCatalogo(catalogo = [], consulta = '', limite = 12) {
  const plano = valor => String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palabras = plano(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  return catalogo.filter(p => { const texto = plano(`${p.codigo} ${p.nombre} ${p.categoria}`); return palabras.every(w => texto.includes(w)); }).slice(0, limite);
}

/** La línea del cotizador para un producto: la descripción lleva el código de Avancys para reconocerlo después. */
export function lineaDesdeProducto(producto) {
  return {
    description: `${producto.codigo ? `[${producto.codigo}] ` : ''}${String(producto.nombre).trim()}`.slice(0, 500),
    category: producto.linea,
    quantity: 1,
    unitCost: Math.round(Number(producto.costo) || 0),
  };
}
