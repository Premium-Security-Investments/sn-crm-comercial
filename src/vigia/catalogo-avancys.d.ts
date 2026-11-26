export type ProductoCatalogo = { codigo: string | null; nombre: string; categoria: string; tipo?: string; costo: number; unidad?: string | null; actualizado?: string | null; linea?: 'equipo' | 'insumo' | 'mano_de_obra' };
export function tipoDeLinea(p: { categoria?: string; tipo?: string }): 'equipo' | 'insumo' | 'mano_de_obra' | null;
export function catalogoParaCotizar(productos: ProductoCatalogo[]): (ProductoCatalogo & { linea: 'equipo' | 'insumo' | 'mano_de_obra' })[];
export function buscarEnCatalogo<T extends ProductoCatalogo>(catalogo: T[], consulta: string, limite?: number): T[];
export function lineaDesdeProducto(p: ProductoCatalogo & { linea: 'equipo' | 'insumo' | 'mano_de_obra' }): { description: string; category: 'equipo' | 'insumo' | 'mano_de_obra'; quantity: number; unitCost: number };
