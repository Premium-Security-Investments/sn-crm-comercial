import { useEffect, useState } from 'react';
import './tender-dossier.css';
import { zipStore } from '../../../verticales/licitaciones/zip-store.js';
import { apiDownload } from '../../apiClient';
import { loadCompanyProcurementDocuments, loadTenderOfferPackage } from '../api';
import type { TenderOfferPackage, TenderRequest } from '../types';

/**
 * El paquete que el encargado del proceso baja para radicar (Juan, 2026-10-30: "los documentos la idea es que estén
 * en una carpeta que el encargado del proceso pueda descargar para presentar").
 *
 * Se arma **en el navegador**: el servidor manda la lista, el índice y la matriz, y aquí se baja cada archivo por su
 * propia ruta —con su propia autorización— y se juntan en un ZIP. Una función sin servidor no podría devolver los
 * 30 MB que pesa el expediente de una licitación.
 *
 * Lo que el paquete promete y lo que no: van las doce carpetas aunque queden vacías, el índice dice primero lo que
 * falta y cada documento de empresa dice si su bloque está confirmado. **No se presenta nada como aprobado sin que
 * una persona lo haya confirmado**, y el índice lo declara en su primera línea.
 */
type Progreso = { total: number; hechos: number; archivo: string } | null;

function descargar(bytes: Uint8Array, nombre: string) {
  // El Blob necesita un ArrayBuffer propio: `bytes.buffer` puede ser más grande que la vista.
  const copia = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([copia], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nombre;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function TenderOfferPackagePanel({ opportunityId, request }: { opportunityId: string; request: TenderRequest }) {
  const [paquete, setPaquete] = useState<TenderOfferPackage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [progreso, setProgreso] = useState<Progreso>(null);
  const [armando, setArmando] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setPaquete(null);
    void (async () => {
      try {
        const payload = await loadTenderOfferPackage(request, opportunityId);
        if (active) setPaquete(payload);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [opportunityId, request]);

  const armar = async () => {
    if (!paquete || armando) return;
    setArmando(true); setError('');
    const fallos: string[] = [];
    try {
      // Los documentos de empresa viajan con su URL firmada en la lista de Empresa; los del expediente se bajan por
      // su ruta, que vuelve a autorizar y responde con un 302 hacia una URL firmada de vigencia corta.
      const companyDocuments = paquete.manifest.files.some(file => file.kind === 'empresa')
        ? await loadCompanyProcurementDocuments(request)
        : [];
      const urlPorId = new Map(companyDocuments.map(document => [document.id, document.url || null]));
      const entries: { name: string; content: string | Uint8Array }[] = [
        { name: paquete.manifest.generated[0], content: paquete.index },
      ];
      if (paquete.matrix_csv) entries.push({ name: paquete.matrix_name, content: paquete.matrix_csv });

      const total = paquete.manifest.files.length;
      let hechos = 0;
      for (const file of paquete.manifest.files) {
        setProgreso({ total, hechos, archivo: file.source_name || file.path });
        try {
          let blob: Blob;
          if (file.kind === 'expediente') {
            blob = await apiDownload(`/api/tender-documents/${encodeURIComponent(file.document_id)}/download?opportunity_id=${encodeURIComponent(opportunityId)}`);
          } else {
            const url = urlPorId.get(file.document_id);
            if (!url) throw new Error('sin enlace de descarga en la ficha de empresa');
            const response = await fetch(url);
            if (!response.ok) throw new Error(`descarga ${response.status}`);
            blob = await response.blob();
          }
          entries.push({ name: file.path, content: new Uint8Array(await blob.arrayBuffer()) });
        } catch (cause) {
          // Un archivo que no se pudo bajar no tumba el paquete: se anota y el ZIP lo dice.
          fallos.push(`${file.path} — ${cause instanceof Error ? cause.message : String(cause)}`);
        }
        hechos += 1;
        setProgreso({ total, hechos, archivo: file.source_name || file.path });
      }

      if (fallos.length) {
        entries.push({
          name: '00_Control/02_NO_SE_PUDIERON_BAJAR.md',
          content: `# Archivos que no entraron al paquete\n\n${fallos.map(line => `- ${line}`).join('\n')}\n\nBájelos a mano antes de radicar.\n`,
        });
      }
      const nombre = `Paquete_${(paquete.manifest.tender_ref || opportunityId).replace(/[^\w.-]+/g, '_')}.zip`;
      descargar(zipStore({ folders: paquete.manifest.folders, entries }), nombre);
      if (fallos.length) setError(`${fallos.length} de ${total} archivos no se pudieron bajar; el paquete los lista en 00_Control.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setArmando(false);
      setProgreso(null);
    }
  };

  if (loading) return <section className="card stack" aria-busy="true"><p className="muted">Revisando qué va en el paquete…</p></section>;
  if (error && !paquete) return <section className="card stack"><div className="error" role="alert">{error}</div></section>;
  if (!paquete) return null;

  const { summary } = paquete.manifest;
  return <section className="card stack tender-company-bridge" aria-labelledby="tender-offer-package-heading">
    <div className="tender-dossier-section-head">
      <div>
        <h3 id="tender-offer-package-heading">Paquete para radicar</h3>
        <p className="muted">Las doce carpetas con lo que hay hoy, el índice y la matriz adentro. Es material de preparación: el índice dice, archivo por archivo, si una persona confirmó su bloque.</p>
      </div>
      <button type="button" onClick={() => void armar()} disabled={armando}>{armando ? 'Armando…' : 'Armar y descargar (ZIP)'}</button>
    </div>
    <div className="tender-card-tags">
      <span className="badge badge-muted">{summary.total_files} archivos</span>
      <span className="badge badge-muted">{summary.del_expediente} del proceso</span>
      <span className="badge badge-muted">{summary.de_empresa} de la empresa</span>
      {summary.sin_confirmar > 0 && <span className="badge tender-fit-por_validar">{summary.sin_confirmar} sin confirmar</span>}
      {summary.bloques_sin_archivo > 0 && <span className="badge tender-fit-bajo">{summary.bloques_sin_archivo} bloques sin soporte</span>}
    </div>
    {progreso && <p className="muted" role="status">Bajando {progreso.hechos} de {progreso.total}: {progreso.archivo}</p>}
    {error && <div className="error" role="alert">{error}</div>}
    {summary.bloques_sin_archivo > 0 && <details>
      <summary>{summary.bloques_sin_archivo} bloques de la ficha de empresa sin soporte</summary>
      <ul>{paquete.manifest.missing_blocks.map(block => <li key={block.block}>{block.label} <span className="muted">→ {block.folder} · responsable: {block.owner}</span></li>)}</ul>
    </details>}
  </section>;
}
