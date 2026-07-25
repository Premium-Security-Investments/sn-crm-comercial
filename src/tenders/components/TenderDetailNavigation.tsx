type TenderDetailNavigationProps = {
  entity: string;
  sourceUrl?: string | null;
  observations?: string | null;
  onBack: () => void;
};

const progress = [
  ['tender-summary', 'Resumen'],
  ['tender-document-review', 'Revisión documental'],
  ['tender-analysis', 'Análisis / preanálisis'],
  ['tender-decision', 'GO / NO GO'],
  ['tender-preparation', 'Preparación'],
  ['tender-follow-up', 'Seguimiento'],
] as const;

function safeHttpUrl(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch { return null; }
}

export function resolveTenderSourceUrl(sourceUrl?: string | null, observations?: string | null) {
  const structured = safeHttpUrl(sourceUrl);
  if (structured) return structured;
  const historical = String(observations || '').match(/Link fuente:\s*(https?:\/\/\S+)/i)?.[1] || null;
  return safeHttpUrl(historical);
}

export function TenderDetailNavigation({ entity, sourceUrl, observations, onBack }: TenderDetailNavigationProps) {
  const officialUrl = resolveTenderSourceUrl(sourceUrl, observations);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return <div className="tender-detail-navigation">
    <nav className="tender-detail-breadcrumb" aria-label="Ruta del expediente">
      <button type="button" className="link-button" onClick={onBack}>Licitaciones</button>
      <span aria-hidden="true">/</span>
      <button type="button" className="link-button" aria-current="page" onClick={onBack}>Oportunidades</button>
      <span aria-hidden="true">/</span>
      <span>{entity || 'Expediente'}</span>
    </nav>
    <div className="tender-detail-actions">
      <button type="button" className="secondary" onClick={onBack}>Volver a Oportunidades</button>
      {officialUrl && <a className="button secondary" href={officialUrl} target="_blank" rel="noreferrer">Abrir fuente oficial</a>}
    </div>
    <nav className="tender-detail-progress" aria-label="Línea de avance del expediente">
      {progress.map(([id, label], index) => <button type="button" key={id} onClick={() => scrollTo(id)}><span>{index + 1}</span>{label}</button>)}
    </nav>
  </div>;
}
