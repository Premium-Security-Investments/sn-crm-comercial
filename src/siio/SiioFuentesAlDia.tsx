import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { fuentesAlDia, type EntradaFuentes } from './fuentesAlDia';
import type { TorreAvancys } from './SiioTorreAvancys';

// «¿Las fuentes están al día?» (contrato de la maqueta, Fase 3): qué falta, quién responde, hace cuánto y qué deja de
// mostrar la Torre por eso. El histórico de Finanzas sale de Parámetros; se pide solo al abrir esta pestaña.
export function SiioFuentesAlDia({ t, excelHasta, forecast }: { t: TorreAvancys; excelHasta: string | null; forecast: EntradaFuentes['forecast'] }) {
  const [historico, setHistorico] = useState<EntradaFuentes['historico']>(null);
  const [creditosManuales, setCreditosManuales] = useState<{ banco?: unknown }[]>([]);
  useEffect(() => {
    let vivo = true;
    api<{ historico: EntradaFuentes['historico']; vigentes?: { clave: string; valor?: unknown }[] }>('/api/siio/parametros')
      .then(datos => {
        if (!vivo) return;
        setHistorico(datos.historico || null);
        const creditos = (datos.vigentes || []).find(item => item.clave === 'creditos')?.valor;
        setCreditosManuales(Array.isArray(creditos) ? creditos : []);
      })
      .catch(() => { if (vivo) setHistorico(null); });
    return () => { vivo = false; };
  }, []);
  const filas = fuentesAlDia({ hoy: new Date(), torre: t.torre as EntradaFuentes['torre'], excelHasta, forecast, historico, creditosManuales });
  const altas = filas.filter(fila => fila.prioridad === 'alta').length;
  return <section className="siio-panel" aria-label="¿Las fuentes están al día?">
    <h2>¿Las fuentes están al día? {altas ? <span className="siio-conteo">{altas}</span> : null}</h2>
    <p className="siio-nota" style={{ margin: '4px 0 8px' }}>La Torre muestra lo que el sistema tiene. Cuando falta, aquí se ve qué, quién responde y hace cuánto.</p>
    {filas.length ? <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
      <thead><tr><th>Atraso</th><th>Qué falta</th><th>Responsable</th><th>Efecto en la Torre</th></tr></thead>
      <tbody>{filas.map(fila => <tr key={fila.clave}>
        <td><span className={`siio-plazo ${fila.prioridad}`}><strong>{fila.ficha.valor}</strong><small>{fila.ficha.unidad}</small></span></td>
        <td><span className="nombre">{fila.que}</span><small className="siio-nota">{fila.detalle}</small></td>
        <td data-etiqueta="Responsable"><strong>{fila.responsable}</strong></td>
        <td data-etiqueta="Efecto">{fila.efecto}</td>
      </tr>)}</tbody>
    </table></div> : <p className="siio-nota">Todas las fuentes que la Torre revisa están al día.</p>}
  </section>;
}
