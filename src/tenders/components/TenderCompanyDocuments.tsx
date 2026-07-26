import type { TenderCompanyDocument } from '../types';

const documentTypeLabels: Record<string, string> = {
  rup: 'RUP',
  certificado: 'Certificado',
  certificacion: 'Certificación',
  licencia: 'Licencia',
  poliza: 'Póliza',
  permiso: 'Permiso',
  experiencia: 'Soporte de experiencia',
  financiero: 'Soporte financiero',
  otro: 'Otro documento empresarial',
};

const stateLabels: Record<TenderCompanyDocument['state'], string> = {
  vigente: 'Vigente',
  vence_pronto: 'Vence pronto',
  vencido: 'Vencido',
  sin_vencimiento: 'Sin vencimiento',
};

function dateLabel(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(date);
}

function typeLabel(value: string) {
  return documentTypeLabels[value] || value.replace(/[_-]+/g, ' ');
}

export function TenderCompanyDocuments({ documents }: { documents: TenderCompanyDocument[] }) {
  return <section className="company-document-inventory" aria-labelledby="company-document-inventory-heading">
    <header><div><span className="eyebrow">Inventario versionado</span><h3 id="company-document-inventory-heading">Documentos empresariales</h3><p>Consulte el soporte vigente, su versión y sus alertas de vencimiento.</p></div><span className="company-document-count">{documents.length} documento{documents.length === 1 ? '' : 's'}</span></header>
    {documents.length === 0 ? <div className="company-document-empty"><strong>Aún no hay documentos empresariales cargados.</strong><span>Agregue RUP, certificados, licencias o soportes para mantener la base lista para licitar.</span></div> : <div className="company-document-list">
      {documents.map(document => <article className="company-document-card" key={document.id}>
        <div className="company-document-main"><div className="company-document-kickers"><span className="badge">{typeLabel(document.document_type)}</span>{document.current && <span className="badge">Versión actual</span>}<span className={`company-document-state state-${document.state}`}>{stateLabels[document.state]}</span></div><strong>{document.display_name}</strong><small>Versión {document.version} · Expedición: {dateLabel(document.issued_at)}</small></div>
        <dl className="company-document-dates"><div><dt>Vencimiento</dt><dd>{dateLabel(document.expires_at)}</dd></div><div><dt>Estado</dt><dd>{stateLabels[document.state]}</dd></div></dl>
        {document.url ? <a className="secondary button" href={document.url} target="_blank" rel="noreferrer">Ver documento<span className="sr-only">: {document.display_name}</span></a> : <span className="muted">Archivo no disponible</span>}
      </article>)}
    </div>}
  </section>;
}
