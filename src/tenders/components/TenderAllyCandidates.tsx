import { useEffect, useState } from 'react';
import type { TenderRequest } from '../types';
import { AllyCardDialog } from './AllyDetail';

/**
 * Aliados (Juan, 2026-11-09): debajo de «Solo en unión temporal: …», las empresas que cubren lo que nos falta, calculado
 * con nuestra ficha. Hasta 5, sin descartados, con aviso si es el contratista actual o un competidor directo. Una oficina
 * en el listado no prueba la agencia: hay que pedir la resolución y el certificado de Cámara.
 */
type Candidate = { nit: string; name: string; role: string; covered: string[]; covers_all: boolean; times_seen: number; warning: string | null; zone_warning?: string | null; contact: string | null; phone: string | null; email: string | null };
type Reading = { mode: 'uno_cumple' | 'se_suma' | 'no_dice'; quote: string | null; quote_verified: boolean; document_name: string | null; locator: string | null; explanation: string | null };
type Payload = { applies: boolean; installed?: boolean; cities: string[]; candidates: Candidate[]; reading?: Reading; alternative?: { label: string; cities: string[]; candidates: Candidate[] } };
// Encargo AGT-002 del 2026-11-10 (aprobado por Juan): la lista sale de cómo deja el pliego cumplir a una unión temporal.
// Juan (2026-11-10): no afirmar más de lo que dice el pliego. «Si uno de los integrantes cumple… se entenderá cumplido»
// dice que BASTA con uno, no que esté prohibido sumar: se muestran las dos listas, cada una con lo que la sostiene.
const READING: Record<Reading['mode'], (cities: string) => string> = {
  uno_cumple: cities => `el pliego dice que basta con que un integrante tenga ${cities}. No dice si la Entidad acepta sumar entre integrantes`,
  se_suma: cities => `el pliego permite sumar entre integrantes: el socio aporta ${cities}`,
  no_dice: () => 'el pliego no dice si un solo integrante debe cumplirlo o si se puede sumar',
};
const joinCities = (cities: string[]) => cities.length > 1 ? `${cities.slice(0, -1).join(', ')} y ${cities[cities.length - 1]}` : cities[0] || '';
const ROLE: Record<string, string> = { aliado: 'Aliado', aliado_potencial: 'Aliado potencial', competidor: 'Competidor', sin_clasificar: 'Sin clasificar' };

export function TenderAllyCandidates({ opportunityId, request, navigate, canEdit = false }: { opportunityId: string; request: TenderRequest; navigate?: (hash: string) => void; canEdit?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    void request<Payload>(`/api/tender-allies/candidates?opportunity_id=${encodeURIComponent(opportunityId)}`).then(payload => { if (active) setData(payload); }, () => undefined);
    return () => { active = false; };
  }, [opportunityId, request, version]);
  if (!data?.applies) return null;
  const open = () => (navigate ? navigate('#/tenders?view=aliados') : (window.location.hash = '#/tenders?view=aliados'));
  return <div className="tw-ally-candidates">
    <strong>Posibles socios</strong>
    {data.reading && <div className="tw-ally-reading">
      <span><b>Lectura del pliego:</b> {READING[data.reading.mode](joinCities(data.cities))}{data.reading.locator ? ` (${data.reading.locator}${data.reading.document_name ? `, ${data.reading.document_name}` : ''})` : data.reading.document_name ? ` (${data.reading.document_name})` : ''}.</span>
      {data.reading.quote && <details><summary>Lo que dice el pliego</summary><blockquote>«{data.reading.quote}»</blockquote></details>}
    </div>}
    <p className="tw-muted tw-ally-source">Cruce automático con la base de Aliados según esa lectura; no es una recomendación de Vig-IA.</p>
    {!data.cities.length
      ? <p className="tw-muted">Lo que falta no es una ciudad (por ejemplo, un indicador financiero): Aliados todavía no filtra por eso. <button type="button" className="tw-link" onClick={open}>Ver Aliados</button></p>
      : !data.candidates.length
        ? <p className="tw-muted">Ninguna empresa del listado tiene oficina en {data.cities.join(' y ')}. <button type="button" className="tw-link" onClick={open}>Ver Aliados</button></p>
        : <>
          <p className="tw-muted">{data.alternative ? <><b>Lo seguro según el pliego</b>: con oficina en {joinCities(data.cities)}</> : <>Con oficina en {joinCities(data.cities)}</>} según el listado de la Superintendencia (falta pedirles la resolución y el certificado de Cámara):</p>
          <CandidateList candidates={data.candidates} onOpen={setCard} />
          {data.alternative && data.alternative.candidates.length > 0 && <>
            <p className="tw-muted"><b>{data.alternative.label}</b>: con oficina en {joinCities(data.alternative.cities)}.</p>
            <CandidateList candidates={data.alternative.candidates} onOpen={setCard} />
          </>}
          <button type="button" className="tw-link" onClick={open}>Ver todos en Aliados →</button>
        </>}
    {card && <AllyCardDialog nit={card} canEdit={canEdit} request={request} onClose={() => setCard(null)} onChanged={() => setVersion(value => value + 1)} />}
  </div>;
}

function CandidateList({ candidates, onOpen }: { candidates: Candidate[]; onOpen: (nit: string) => void }) {
  return <ul>{candidates.map(candidate => <li key={candidate.nit}>
            {/* La ficha en una ventana (Juan, 2026-11-10). */}
            <button type="button" className="tw-ally-name" onClick={() => onOpen(candidate.nit)}>{candidate.name}</button> · NIT {candidate.nit} · {ROLE[candidate.role] || candidate.role}
            {!candidate.covers_all && <> · cubre {candidate.covered.join(', ')}</>}
            {candidate.times_seen > 0 && <> · visto en {candidate.times_seen} proceso{candidate.times_seen === 1 ? '' : 's'}</>}
            {(candidate.contact || candidate.phone) && <> · {candidate.contact || candidate.phone}</>}
            {candidate.warning && <span className="tw-reject"> {candidate.warning}</span>}
            {candidate.zone_warning && <span className="tw-ally-zone"> {candidate.zone_warning}</span>}
  </li>)}</ul>;
}
