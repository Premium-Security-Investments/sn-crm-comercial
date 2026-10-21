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
    { area: 'Finanzas', titulo: 'Rentabilidad por cliente', falta: 'salario base de los guardas y centro de costo de cada puesto en Programación; hoy ambos están vacíos.' },
    { area: 'Comercial privado', titulo: 'Puente de ingresos', falta: 'ingreso mensual actualizado y fecha de inicio del servicio de cada venta aprobada.' },
    { area: 'Comercial privado', titulo: 'Cobertura necesaria', falta: 'tasa de cierre histórica (ofertas ganadas sobre enviadas) para fijar cuántas veces debe cubrir el pipeline la meta.' },
    { area: 'Comercial privado', titulo: 'Concentración de clientes', falta: 'ingresos por cliente desde Avancys.' },
    { area: 'Comercial privado', titulo: 'Cierres que se corren', falta: 'guardar el historial de fechas de cierre estimadas en el CRM.' },
    { area: 'Licitaciones', titulo: 'Tasa de adjudicación', falta: adjudicacion },
    { area: 'Licitaciones', titulo: 'Contra quién se pierde', falta: 'registrar el adjudicatario de cada licitación perdida.' },
    { area: 'Operaciones', titulo: 'Cumplimiento contra contrato', falta: 'frecuencias exigidas por cliente: visitas, tiempos de tickets, aprovisionamientos.' },
    { area: 'Operaciones', titulo: 'Servicio técnico y cotizaciones', falta: 'cotizaciones abiertas y tiempos de atención por cliente.' },
    { area: 'Operaciones', titulo: 'Alertas de video', falta: 'fuente de monitoreo.' },
    { area: 'Operaciones', titulo: 'Cliente de cada puesto en SecurityOps', falta: 'llenar la marca del puesto; hoy el cliente se deduce del nombre y queda aproximado.' },
  ];
}

export function SiioLoQueFalta({ summary }: { summary: CommercialSummary | null }) {
  const lista = faltantes(summary);
  return <div className="siio-detail-body">
    <p className="siio-pulse-source">
      {lista.length} cosas que la Torre todavía no puede mostrar, y el dato que destraba cada una.
      Ninguna depende de programar algo: dependen de que exista la información.
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
