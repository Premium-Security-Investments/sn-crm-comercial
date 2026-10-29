import type { CommercialSummary } from './commercialSummary';

// Lo que a la Torre le falta para estar completa, en un solo lugar.
//
// Estaba repartido en cuatro bloques "En construcción" dentro de cuatro plegados distintos: nueve
// tarjetas que nadie veía juntas y que ocupaban espacio en medio de las cifras que sí existen.
// Esto no es información de gerencia diaria: es el mapa de lo que falta y de quién lo destraba.

type Falta = { titulo: string; falta: string; area: string };

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

export function faltantes(summary: CommercialSummary | null): Falta[] {
  const tenders = summary?.tenders;
  const adjudicacion = tenders && tenders.awarded + tenders.not_awarded
    ? `ya hay dato: ${percent(tenders.award_rate)} (${tenders.awarded} de ${tenders.awarded + tenders.not_awarded}). Falta histórico suficiente para usarlo.`
    : 'registrar en el CRM las licitaciones adjudicadas y no adjudicadas.';
  return [
    { area: 'Finanzas', titulo: 'Comparación con presupuesto', falta: 'presupuesto mensual del año por rubro.' },
    // Reescrito el 2026-10-29 con lo medido. Decía que faltaba "el centro de costo de cada puesto
    // en Programación": ese centro de costo SÍ existe, es el código de la cuenta analítica del
    // puesto en Avancys. Lo que falta es otra cosa y mandaba a buscar donde no era.
    //
    // Lo medido: de las líneas analíticas de agosto que caen en cuentas de puesto, las negativas
    // están en `13050500 CLIENTES VIGILANCIA` —una cuenta por cobrar— y en cuentas de ingreso. Son
    // los dos lados de la factura, no costo. El único costo real en cuentas de puesto en todo el
    // mes fue una comisión de 65 millones. La nómina vive en cuentas por regional y línea de
    // servicio, así que el costo no está atribuido al puesto en ninguna parte.
    { area: 'Finanzas', titulo: 'Rentabilidad por cliente', falta: 'permiso de lectura sobre hr.contract.analytic.distribution en Avancys: dice cómo se reparte el costo de cada empleado entre los puestos. Hoy el costo no está marcado por puesto en ninguna parte, así que no se puede atribuir a un cliente.' },
    { area: 'Comercial privado', titulo: 'Puente de ingresos', falta: 'ingreso mensual actualizado y fecha de inicio del servicio de cada venta aprobada.' },
    { area: 'Comercial privado', titulo: 'Cobertura necesaria', falta: 'tasa de cierre histórica (ofertas ganadas sobre enviadas) para fijar cuántas veces debe cubrir el pipeline la meta.' },
    { area: 'Comercial privado', titulo: 'Cierres que se corren', falta: 'guardar el historial de fechas de cierre estimadas en el CRM.' },
    { area: 'Licitaciones', titulo: 'Tasa de adjudicación', falta: adjudicacion },
    { area: 'Licitaciones', titulo: 'Contra quién se pierde', falta: 'registrar el adjudicatario de cada licitación perdida.' },
    { area: 'Operaciones', titulo: 'Cumplimiento contra contrato', falta: 'frecuencias exigidas por cliente: visitas, tiempos de tickets, aprovisionamientos.' },
    { area: 'Operaciones', titulo: 'Servicio técnico y cotizaciones', falta: 'cotizaciones abiertas y tiempos de atención por cliente.' },
    { area: 'Operaciones', titulo: 'Alertas de video', falta: 'fuente de monitoreo.' },
    { area: 'Operaciones', titulo: 'Cliente de cada puesto en SecurityOps', falta: 'que SecurityOps pueda consultarnos. El dato ya no falta: la llave puesto↔cliente está declarada en el catálogo de fuentes y se lee de Avancys, donde los puestos traen su contrato y su cliente.' },
  ];
}

export function SiioLoQueFalta({ summary }: { summary: CommercialSummary | null }) {
  const lista = faltantes(summary);
  return <div className="siio-detail-body">
    <p className="siio-pulse-source">
      {lista.length} cosas que la Torre todavía no puede mostrar, y lo que destraba cada una.
      Casi todas dependen de que exista la información, no de programar algo.
    </p>
    <div className="siio-commercial-pending-grid">
      {lista.map(item => <div className="siio-commercial-pending" key={`${item.area}:${item.titulo}`}>
        <strong>{item.titulo}</strong>
        <span>Pendiente: {item.falta}</span>
        <small className="siio-secondary">{item.area}</small>
      </div>)}
    </div>
  </div>;
}
