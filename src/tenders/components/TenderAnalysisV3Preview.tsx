import { useMemo, useState } from 'react';
import './tender-analysis-v3-preview.css';

type PhaseKey = 'descarte' | 'habilitantes' | 'tecnico' | 'financiero' | 'estrategico';
type Tone = 'supported' | 'partial' | 'gap' | 'insufficient';

type Axis = { label: 'Presencia' | 'Revisión' | 'Vigencia' | 'Aplicabilidad' | 'Sustento'; value: string; tone: 'ok' | 'warn' | 'danger' };
type PreviewUnit = {
  id: string;
  phase: PhaseKey;
  title: string;
  status: string;
  tone: Tone;
  critical: boolean;
  excerpt: string;
  evidence: Array<{ source: string; locator: string; note: string }>;
  abstention?: string;
  axes: Axis[];
  commercialImpact: string;
  legalAssessment: string;
  action: { summary: string; role: string; basisUnitId: string; closeCondition: string };
};

const PHASES: Array<{ key: PhaseKey; label: string; short: string }> = [
  { key: 'descarte', label: 'Descarte', short: '01' },
  { key: 'habilitantes', label: 'Habilitantes', short: '02' },
  { key: 'tecnico', label: 'Técnico', short: '03' },
  { key: 'financiero', label: 'Financiero / ejecución', short: '04' },
  { key: 'estrategico', label: 'Estratégico', short: '05' },
];

const UNITS: PreviewUnit[] = [
  {
    id: 'REQ-DES-001', phase: 'descarte', title: 'Causal prohibitiva y alcance contractual', status: 'Brecha evidenciada', tone: 'gap', critical: true,
    excerpt: 'El pliego exige una habilitación territorial adicional para ejecutar uno de los frentes del contrato.',
    evidence: [{ source: 'PLIEGO-SYN-01', locator: 'Sección 2.1 · pág. 18', note: 'La exigencia aparece de forma expresa en la regla de participación.' }],
    axes: [
      { label: 'Presencia', value: 'Localizada', tone: 'ok' }, { label: 'Revisión', value: 'Revisada', tone: 'ok' },
      { label: 'Vigencia', value: 'Por confirmar', tone: 'warn' }, { label: 'Aplicabilidad', value: 'Aplicable', tone: 'ok' },
      { label: 'Sustento', value: 'Brecha evidenciada', tone: 'danger' },
    ],
    commercialImpact: 'Puede impedir la participación o exigir una alianza antes del cierre. Impacto alto en tiempo y estructura de oferta.',
    legalAssessment: 'La exigencia está en el pliego sintético, pero su alcance jurídico debe validarse frente al territorio y modalidad exactos.',
    action: { summary: 'Validar alcance territorial y ruta de subsanación o alianza.', role: 'Jurídico + Licitaciones', basisUnitId: 'REQ-DES-001', closeCondition: 'Concepto humano documentado y alternativa operativa definida.' },
  },
  {
    id: 'REQ-HAB-004', phase: 'habilitantes', title: 'Experiencia específica acreditable', status: 'Sustento parcial', tone: 'partial', critical: true,
    excerpt: 'Se solicitan tres contratos comparables ejecutados durante los últimos cinco años.',
    evidence: [{ source: 'RUP-SYN-02', locator: 'Experiencia · filas 12–14', note: 'Hay dos contratos comparables y un tercero pendiente de equivalencia.' }],
    axes: [
      { label: 'Presencia', value: 'Localizada', tone: 'ok' }, { label: 'Revisión', value: 'Revisada', tone: 'ok' },
      { label: 'Vigencia', value: 'Vigente', tone: 'ok' }, { label: 'Aplicabilidad', value: 'Aplicable', tone: 'ok' },
      { label: 'Sustento', value: 'Parcial', tone: 'warn' },
    ],
    commercialImpact: 'La brecha puede resolverse con validación de equivalencia o experiencia de un integrante plural; requiere gestión temprana.',
    legalAssessment: 'No se puede concluir suficiencia hasta contrastar objeto, cuantía y porcentaje de participación del tercer contrato.',
    action: { summary: 'Contrastar el tercer contrato contra objeto, cuantía y participación exigidos.', role: 'Licitaciones + Comercial', basisUnitId: 'REQ-HAB-004', closeCondition: 'Matriz de experiencia revisada por persona autorizada.' },
  },
  {
    id: 'REQ-TEC-008', phase: 'tecnico', title: 'Personal mínimo y perfiles clave', status: 'Sustentado con evidencia', tone: 'supported', critical: false,
    excerpt: 'El proponente debe disponer de coordinador, supervisores y personal operativo con formación definida.',
    evidence: [{ source: 'CAPACIDAD-SYN-03', locator: 'Anexo técnico · pág. 7', note: 'La estructura sintética cubre los roles y cantidades solicitados.' }],
    axes: [
      { label: 'Presencia', value: 'Localizada', tone: 'ok' }, { label: 'Revisión', value: 'Revisada', tone: 'ok' },
      { label: 'Vigencia', value: 'Vigente', tone: 'ok' }, { label: 'Aplicabilidad', value: 'Aplicable', tone: 'ok' },
      { label: 'Sustento', value: 'Con evidencia', tone: 'ok' },
    ],
    commercialImpact: 'La capacidad base está soportada; el costo de movilización debe incorporarse en el modelo económico.',
    legalAssessment: 'La evidencia permite avanzar a revisión humana, sin sustituir la comprobación nominal ni documental de cada perfil.',
    action: { summary: 'Costear movilización y reservar perfiles sin asignar personas nominales.', role: 'Operaciones + Financiero', basisUnitId: 'REQ-TEC-008', closeCondition: 'Costo incluido y disponibilidad operativa confirmada.' },
  },
  {
    id: 'REQ-TEC-011', phase: 'tecnico', title: 'Plan operativo y medios tecnológicos', status: 'Evidencia insuficiente', tone: 'insufficient', critical: true,
    excerpt: 'Se exige interoperabilidad con una plataforma del contratante y pruebas previas al inicio.',
    evidence: [],
    abstention: 'No existe evidencia autorizada sobre la compatibilidad de la integración ni sobre el ambiente de pruebas.',
    axes: [
      { label: 'Presencia', value: 'Localizada', tone: 'ok' }, { label: 'Revisión', value: 'Revisada', tone: 'ok' },
      { label: 'Vigencia', value: 'Sin verificar', tone: 'warn' }, { label: 'Aplicabilidad', value: 'Aplicable', tone: 'ok' },
      { label: 'Sustento', value: 'Insuficiente', tone: 'danger' },
    ],
    commercialImpact: 'Riesgo de costo no estimado, retraso de inicio y dependencia de un tercero. Debe resolverse antes de cerrar precio.',
    legalAssessment: 'La obligación parece contractual; no se infiere viabilidad técnica ni aceptación del contratante sin prueba documentada.',
    action: { summary: 'Solicitar especificación de integración y habilitar prueba técnica controlada.', role: 'Técnico + Licitaciones', basisUnitId: 'REQ-TEC-011', closeCondition: 'Especificación recibida y resultado de prueba documentado.' },
  },
  {
    id: 'REQ-FIN-015', phase: 'financiero', title: 'Capacidad financiera y capital de trabajo', status: 'Sustentado con evidencia', tone: 'supported', critical: false,
    excerpt: 'El proceso define umbrales de liquidez, endeudamiento y capital de trabajo.',
    evidence: [{ source: 'FIN-SYN-04', locator: 'Indicadores · corte 2025', note: 'Los valores sintéticos superan los umbrales del pliego.' }],
    axes: [
      { label: 'Presencia', value: 'Localizada', tone: 'ok' }, { label: 'Revisión', value: 'Revisada', tone: 'ok' },
      { label: 'Vigencia', value: 'Corte válido', tone: 'ok' }, { label: 'Aplicabilidad', value: 'Aplicable', tone: 'ok' },
      { label: 'Sustento', value: 'Con evidencia', tone: 'ok' },
    ],
    commercialImpact: 'No se observa una restricción preliminar; todavía debe modelarse el flujo de caja de ejecución.',
    legalAssessment: 'Los indicadores están documentados en la fuente sintética; la validación humana debe confirmar el corte exigido.',
    action: { summary: 'Modelar flujo de caja y confirmar el corte financiero exigido.', role: 'Financiero', basisUnitId: 'REQ-FIN-015', closeCondition: 'Modelo de caja y corte validados por Financiero.' },
  },
  {
    id: 'STR-001', phase: 'estrategico', title: 'Atractivo estratégico y capacidad de ejecución', status: 'Revisión humana requerida', tone: 'partial', critical: false,
    excerpt: 'La oportunidad abre una región prioritaria, pero concentra recursos durante la transición operativa.',
    evidence: [{ source: 'ESTRATEGIA-SYN-05', locator: 'Escenario controlado', note: 'Lectura sintética para discusión; no corresponde a un requisito habilitante.' }],
    axes: [
      { label: 'Presencia', value: 'Contexto disponible', tone: 'ok' }, { label: 'Revisión', value: 'Preliminar', tone: 'warn' },
      { label: 'Vigencia', value: 'Escenario actual', tone: 'ok' }, { label: 'Aplicabilidad', value: 'Estratégica', tone: 'ok' },
      { label: 'Sustento', value: 'Revisión humana', tone: 'warn' },
    ],
    commercialImpact: 'Potencial de expansión relevante con presión operativa inicial. La rentabilidad depende de transición, recaudo y escalamiento.',
    legalAssessment: 'Esta consideración no reemplaza ningún habilitante ni constituye una conclusión jurídica sobre participación.',
    action: { summary: 'Contrastar atractivo regional, margen y capacidad de transición.', role: 'Dirección + Comercial + Operaciones', basisUnitId: 'STR-001', closeCondition: 'Escenario estratégico revisado por el comité humano.' },
  },
];

const TONE_LABEL: Record<Tone, string> = { supported: 'Con evidencia', partial: 'Parcial', gap: 'Brecha', insufficient: 'Insuficiente' };

export function TenderAnalysisV3Preview() {
  const [selectedUnitId, setSelectedUnitId] = useState(UNITS[0].id);
  const selected = useMemo(() => UNITS.find(unit => unit.id === selectedUnitId) || UNITS[0], [selectedUnitId]);
  const phase = PHASES.find(item => item.key === selected.phase) || PHASES[0];

  return <section className="agt002-v3-preview" aria-labelledby="agt002-v3-title">
    <header className="agt002-v3-hero">
      <div className="agt002-v3-hero-copy">
        <div className="agt002-v3-kicker"><span>AGT-002 · Vista v3</span><b>Datos sintéticos</b><b>Sólo lectura</b></div>
        <h2 id="agt002-v3-title">Análisis integral por requisito</h2>
        <p>Una lectura trazable de descarte, habilitantes, técnica, ejecución y estrategia. Organiza evidencia y pendientes; no sustituye el criterio institucional.</p>
        <div className="agt002-v3-guard"><strong>Validación humana pendiente</strong><span>No decide GO / NO GO · No firma · No envía · No presenta ofertas</span></div>
      </div>
      <dl className="agt002-v3-run-meta">
        <div><dt>Expediente</dt><dd>LIC-SYN-2026-017</dd></div>
        <div><dt>Entidad</dt><dd>Entidad Pública Demo</dd></div>
        <div><dt>Cobertura</dt><dd>6 / 6 unidades</dd></div>
        <div><dt>Estado</dt><dd>Revisión humana</dd></div>
      </dl>
    </header>

    <nav className="agt002-v3-phase-strip" aria-label="Orden institucional del análisis">
      {PHASES.map(item => {
        const units = UNITS.filter(unit => unit.phase === item.key);
        const alerts = units.filter(unit => unit.critical).length;
        return <div key={item.key} className={item.key === selected.phase ? 'active' : ''}>
          <span>{item.short}</span><strong>{item.label}</strong><small>{units.length} unidad(es){alerts ? ` · ${alerts} crítica(s)` : ''}</small>
        </div>;
      })}
    </nav>

    <div className="agt002-v3-workbench">
      <aside className="agt002-v3-unit-rail" aria-label="Unidades del análisis">
        <header><div><span>Manifiesto cubierto</span><strong>Unidades revisables</strong></div><b>{UNITS.length}</b></header>
        <div className="agt002-v3-unit-list">
          {UNITS.map(unit => <button type="button" key={unit.id} className={`${unit.id === selected.id ? 'active' : ''} tone-${unit.tone}`} aria-pressed={unit.id === selected.id} onClick={() => setSelectedUnitId(unit.id)}>
            <span className="agt002-v3-unit-top"><code>{unit.id}</code>{unit.critical && <b>Crítica</b>}</span>
            <strong>{unit.title}</strong>
            <small>{TONE_LABEL[unit.tone]}</small>
          </button>)}
        </div>
      </aside>

      <article className="agt002-v3-detail" aria-live="polite">
        <header className="agt002-v3-detail-head">
          <div><span>{phase.short} · {phase.label}</span><h3>{selected.title}</h3><code>{selected.id}</code></div>
          <b className={`agt002-v3-status tone-${selected.tone}`}>{selected.status}</b>
        </header>

        <blockquote>{selected.excerpt}</blockquote>

        <section className="agt002-v3-axes" aria-label="Cinco ejes independientes">
          {selected.axes.map(axis => <div key={axis.label} className={`axis-${axis.tone}`}><span>{axis.label}</span><strong>{axis.value}</strong></div>)}
        </section>

        <div className="agt002-v3-analysis-grid">
          <section><span className="agt002-v3-section-label">Impacto comercial</span><p>{selected.commercialImpact}</p></section>
          <section><span className="agt002-v3-section-label">Lectura jurídica</span><p>{selected.legalAssessment}</p></section>
        </div>

        <section className={`agt002-v3-evidence ${selected.evidence.length ? '' : 'is-abstention'}`}>
          <header><div><span className="agt002-v3-section-label">Evidencia citada</span><strong>{selected.evidence.length ? `${selected.evidence.length} fuente(s) autorizada(s)` : 'Abstención explícita'}</strong></div><span>{selected.evidence.length ? 'Trazable' : 'Falta evidencia'}</span></header>
          {selected.evidence.length ? <ul>{selected.evidence.map(item => <li key={`${item.source}-${item.locator}`}><code>{item.source}</code><strong>{item.locator}</strong><p>{item.note}</p></li>)}</ul> : <p>{selected.abstention}</p>}
        </section>

        <section className="agt002-v3-action">
          <header><div><span className="agt002-v3-section-label">Siguiente acción trazable</span><strong>{selected.action.summary}</strong></div><b>{selected.action.role}</b></header>
          <dl><div><dt>Fundamento</dt><dd>{selected.action.basisUnitId}</dd></div><div><dt>Condición de cierre</dt><dd>{selected.action.closeCondition}</dd></div></dl>
        </section>
      </article>
    </div>

    <footer className="agt002-v3-footer"><strong>Preview de experiencia · AGT-002 v3</strong><span>Todo el contenido es sintético. La implementación runtime y la conexión con SharePoint permanecen fuera de esta vista.</span></footer>
  </section>;
}
