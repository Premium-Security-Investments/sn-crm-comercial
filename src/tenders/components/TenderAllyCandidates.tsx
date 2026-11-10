import { useEffect, useState } from 'react';
import type { TenderRequest } from '../types';

/**
 * Aliados (Juan, 2026-11-09): debajo de «Solo en unión temporal: …», las empresas que cubren lo que nos falta, calculado
 * con nuestra ficha. Hasta 5, sin descartados, con aviso si es el contratista actual o un competidor directo. Una oficina
 * en el listado no prueba la agencia: hay que pedir la resolución y el certificado de Cámara.
 */
type Candidate = { nit: string; name: string; role: string; covered: string[]; covers_all: boolean; times_seen: number; warning: string | null; contact: string | null; phone: string | null; email: string | null };
type Payload = { applies: boolean; installed?: boolean; cities: string[]; candidates: Candidate[] };
const ROLE: Record<string, string> = { aliado: 'Aliado', aliado_potencial: 'Aliado potencial', competidor: 'Competidor', sin_clasificar: 'Sin clasificar' };

export function TenderAllyCandidates({ opportunityId, request, navigate }: { opportunityId: string; request: TenderRequest; navigate?: (hash: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    let active = true;
    void request<Payload>(`/api/tender-allies/candidates?opportunity_id=${encodeURIComponent(opportunityId)}`).then(payload => { if (active) setData(payload); }, () => undefined);
    return () => { active = false; };
  }, [opportunityId, request]);
  if (!data?.applies) return null;
  const open = () => (navigate ? navigate('#/tenders?view=aliados') : (window.location.hash = '#/tenders?view=aliados'));
  return <div className="tw-ally-candidates">
    <strong>Posibles socios</strong>
    {!data.cities.length
      ? <p className="tw-muted">Lo que falta no es una ciudad (por ejemplo, un indicador financiero): Aliados todavía no filtra por eso. <button type="button" className="tw-link" onClick={open}>Ver Aliados</button></p>
      : !data.candidates.length
        ? <p className="tw-muted">Ninguna empresa del listado tiene oficina en {data.cities.join(' y ')}. <button type="button" className="tw-link" onClick={open}>Ver Aliados</button></p>
        : <>
          <p className="tw-muted">Con oficina en {data.cities.join(' y ')} según el listado de la Superintendencia (falta pedirles la resolución y el certificado de Cámara):</p>
          <ul>{data.candidates.map(candidate => <li key={candidate.nit}>
            <strong>{candidate.name}</strong> · NIT {candidate.nit} · {ROLE[candidate.role] || candidate.role}
            {!candidate.covers_all && <> · cubre {candidate.covered.join(', ')}</>}
            {candidate.times_seen > 0 && <> · visto en {candidate.times_seen} proceso{candidate.times_seen === 1 ? '' : 's'}</>}
            {(candidate.contact || candidate.phone) && <> · {candidate.contact || candidate.phone}</>}
            {candidate.warning && <span className="tw-reject"> {candidate.warning}</span>}
          </li>)}</ul>
          <button type="button" className="tw-link" onClick={open}>Ver todos en Aliados →</button>
        </>}
  </div>;
}
