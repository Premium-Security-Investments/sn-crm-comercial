#!/usr/bin/env python3
"""AGT-004 / Vig-IA Operaciones: cifras mensuales de SecurityOps por cliente para la Torre de Gerencia.

Dos pasos, separados a propósito:

  extract  Lee Firestore de SecurityOps (solo lectura, credenciales ADC de gcloud) y escribe un
           JSON de cifras agregadas. Solo pide a Firestore los campos de fecha, estado y enlace al
           puesto: nunca nombres, cédulas, correos, GPS, placas, fotos, firmas ni textos libres.
           Del campo `zone` solo se conserva el número (el nombre lleva el del coordinador).
  sql      Convierte ese JSON en la entrada de `composio execute SUPABASE_BETA_RUN_SQL_QUERY`
           que carga una corrida nueva en siio_operations_runs / siio_operations_metrics (mig. 128).

Cliente del puesto (SecurityOps no tiene campo cliente): misma precedencia que sus informes
(`src/utils/marcaInformes.js` resolverMarca): marcaId del puesto → nombre exacto del puesto en una
marca → zona de la marca. Marcas = las integradas en el código + las de Firestore `config`
(tipo = marca), que ganan. Además, la palabra ARA en el nombre cuenta como ARA (tiendas fuera de
las Zonas 1-3). Lo que no casa con ninguna marca queda en "otros". Es aproximado y así se marca.
"""
import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import unicodedata
import urllib.request
from collections import defaultdict

EXTRACTOR_VERSION = 'agt004-ops-v2'
PROJECT = 'security-ops-e8534'
SOURCE_ID = 'SRC-OPS-SECURITYOPS'
SUPABASE_REF = 'tyfzjqzcpgwcjnxozaaf'
CLIENT_RULE = ('Marca del puesto como en los informes de SecurityOps (marcaId → nombre de puesto → zona; '
               'ARA = Zonas 1-3) + palabra ARA en el nombre; aprovisionamientos sin puesto = ARA '
               '(programación de camiones ARA); resto = otros')
# Copia de SecurityOps src/utils/marcasIntegradas.js (3143e6d). La marca ARA es Jerónimo Martins.
BUILTIN_BRANDS = [
    {'id': 'marca_jeronimo-martins', 'nombre': 'Jerónimo Martins', 'zonas': [1, 2, 3], 'puestos': []},
    {'id': 'marca_cide', 'nombre': 'CIDE', 'zonas': [], 'puestos': ['CIDE GALERIAS', 'CIDE RIONEGRO', 'CIDE SOLEDAD']},
    {'id': 'marca_grandbay', 'nombre': 'Grandbay · Papeles Nacionales', 'zonas': [], 'puestos': ['PAPELES FUNZA']},
    {'id': 'marca_redes-medicas', 'nombre': 'Redes Médicas', 'zonas': [], 'puestos': ['REDES MEDICAS']},
    {'id': 'marca_hitachi', 'nombre': 'HITACHI', 'zonas': [], 'puestos': ['HITACHI LA ESTANCIA']},
    {'id': 'marca_suzuki', 'nombre': 'Suzuki', 'zonas': [], 'puestos': ['SUZUKI 22', 'SUZUKI 36']},
]
ARA_BRAND_ID = 'marca_jeronimo-martins'
FIXED_LABELS = {'ara': 'ARA (Jerónimo Martins)', 'otros': 'Otros clientes', 'sin_identificar': 'Sin puesto identificado', 'total': 'Total'}
TICKET_OPEN = {'nuevo', 'convertido', 'atendido', 'en_aprobacion', 'cotizacion_aprobada', 'cotizacion_rechazada'}
PROVISION_DONE = {'descargado', 'puerta_abierta'}
TICKET_OVERDUE_DAYS = 5  # SecurityOps src/utils/reportesFallas.js DIAS_PARA_ALERTA

# Campos pedidos a Firestore por colección (proyección: lo demás nunca sale de la base).
FIELDS = {
    'puestos': ['name', 'zone', 'regional', 'sap', 'status', 'esUnidadMonitoreo', 'origenDato', 'cuenta', 'marcaId'],
    # Marcas de cliente. `zonas` lleva el nombre del coordinador: solo se conserva el número.
    'config': ['tipo', 'nombre', 'zonas', 'puestos', 'activa'],
    'puesto_visits': ['puestoId', 'arrivalAt', 'status', 'tipoVisita'],
    'novedades': ['puestoId', 'createdAt', 'status'],
    'reportes_fallas': ['puestoId', 'sap', 'createdAt', 'estado', 'respondidoAt'],
    'visitas_tecnico': ['puestoId', 'sap', 'fecha', 'status'],
    'aprovisionamientos': ['puestoId', 'sap', 'regional', 'fecha', 'estado', 'anulado'],
    'rondas': ['puestoId', 'iniciadaEn', 'status'],
}


# ---------------------------------------------------------------- lógica pura (probada)

def zone_number(zone):
    m = re.match(r'\s*zona\s*(\d+)', str(zone or ''), re.I)
    return int(m.group(1)) if m else None


def is_monitoring_unit(p):
    """Copia de SecurityOps src/utils/unidadMonitoreo.js."""
    if isinstance(p.get('esUnidadMonitoreo'), bool):
        return p['esUnidadMonitoreo']
    if str(p.get('origenDato') or '').startswith('listado-unidades'):
        return True
    return bool(str(p.get('cuenta') or '').strip()) and not str(p.get('sap') or '').strip()


def name_key(n):
    """claveNombre de SecurityOps: sin tildes, mayúsculas, espacios simples."""
    t = unicodedata.normalize('NFD', str(n or ''))
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', t.upper()).strip()


def brand_key(brand_id):
    """Clave apta para siio_operations_metrics.client_key (^[a-z0-9_]{1,40}$)."""
    if brand_id == ARA_BRAND_ID:
        return 'ara'
    key = re.sub(r'[^a-z0-9]+', '_', name_key(re.sub(r'^marca_', '', brand_id)).lower()).strip('_')[:40]
    return key if key not in ('', 'ara', 'otros', 'total', 'sin_identificar') else f'marca_{key}'[:40]


def merge_brands(firestore_brands):
    """Integradas + Firestore (gana Firestore, como cargarMarcas). Firestore: zonas ya en números."""
    by_id = {b['id']: b for b in BUILTIN_BRANDS}
    for b in firestore_brands:
        if b.get('activa') is not False:
            by_id[b['id']] = b
    return list(by_id.values())


def make_client_of(brands):
    by_id = {b['id']: b for b in brands}
    by_name = {}
    for b in brands:
        for n in b.get('puestos') or []:
            by_name.setdefault(name_key(n), b)
    by_zone = {}
    for b in brands:
        for z in b.get('zonas') or []:
            by_zone.setdefault(int(z), b)

    def client_of(p):
        b = by_id.get(p.get('marcaId') or '') or by_name.get(name_key(p.get('name'))) or by_zone.get(zone_number(p.get('zone')))
        if b:
            return brand_key(b['id'])
        if re.search(r'\bARA\b', str(p.get('name') or ''), re.I):
            return 'ara'
        return 'otros'

    labels = dict(FIXED_LABELS)
    for b in brands:
        if b['id'] != ARA_BRAND_ID:
            labels[brand_key(b['id'])] = str(b.get('nombre') or brand_key(b['id']))[:80]
    return client_of, labels


def regional_of(value):
    r = str(value or '').strip().upper()
    return r[:60] if r else 'SIN REGIONAL'


def month_of(value):
    """'2026-10-03T…' / '2026-10-03' → '2026-10-01'."""
    s = str(value or '')
    return f'{s[:7]}-01' if re.match(r'^\d{4}-\d{2}', s) else None


def parse_ts(value):
    if not value:
        return None
    return dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))


def aggregate(raw, now, local_today=None):
    """raw: {colección: [docs con solo los campos de FIELDS, más '_id' en puestos y marcas]} → filas.

    local_today (YYYY-MM-DD, Bogotá): los aprovisionamientos de ese día o posteriores no se cuentan,
    porque a la hora de la extracción todavía no ha llegado el camión.
    """
    client_of, labels = make_client_of(merge_brands(raw.get('marcas', [])))
    local_today = local_today or (now - dt.timedelta(hours=5)).strftime('%Y-%m-%d')
    puestos = {p['_id']: p for p in raw['puestos'] if p.get('status') != 'archivado'}
    by_sap = {}
    for pid, p in puestos.items():
        sap = str(p.get('sap') or '').strip()
        if sap:
            by_sap.setdefault(sap, pid)

    counts = defaultdict(float)
    visited = defaultdict(set)
    unmatched = defaultdict(int)
    current_month = now.strftime('%Y-%m-01')

    def resolve(rec, fallback_client=None):
        pid = rec.get('puestoId') or by_sap.get(str(rec.get('sap') or '').strip())
        p = puestos.get(pid) if pid else None
        if p:
            return pid, client_of(p), regional_of(p.get('regional'))
        return None, fallback_client or 'sin_identificar', regional_of(rec.get('regional'))

    def add(month, client, regional, metric, n=1):
        if not month:
            return
        for c in (client, 'total'):
            for r in (regional, 'TODAS'):
                counts[(month, c, r, metric)] += n

    for p in puestos.values():
        if not is_monitoring_unit(p):
            add(current_month, client_of(p), regional_of(p.get('regional')), 'puestos_activos')

    for v in raw['puesto_visits']:
        if v.get('tipoVisita') == 'aprovisionamiento' or v.get('status') == 'ABANDONED':
            continue
        pid, client, regional = resolve(v)
        month = month_of(v.get('arrivalAt'))
        add(month, client, regional, 'visitas_supervisor')
        if pid and month:
            for c in (client, 'total'):
                for r in (regional, 'TODAS'):
                    visited[(month, c, r)].add(pid)
        if not pid:
            unmatched['puesto_visits'] += 1

    for n in raw['novedades']:
        if n.get('status') == 'borrador':
            continue
        pid, client, regional = resolve(n)
        add(month_of(n.get('createdAt')), client, regional, 'novedades')
        if not pid:
            unmatched['novedades'] += 1

    for t in raw['reportes_fallas']:
        pid, client, regional = resolve(t)
        add(month_of(t.get('createdAt')), client, regional, 'tickets_creados')
        estado = t.get('estado') or 'nuevo'
        is_open = estado in TICKET_OPEN or (estado == 'solucionado' and not t.get('respondidoAt'))
        if is_open:
            add(current_month, client, regional, 'tickets_abiertos')
            created = parse_ts(t.get('createdAt'))
            if not t.get('respondidoAt') and created and (now - created).days > TICKET_OVERDUE_DAYS:
                add(current_month, client, regional, 'tickets_vencidos_5d')
        if not pid:
            unmatched['reportes_fallas'] += 1

    for v in raw['visitas_tecnico']:
        if v.get('status') != 'COMPLETED':
            continue
        pid, client, regional = resolve(v)
        add(month_of(v.get('fecha')), client, regional, 'visitas_tecnico')
        if not pid:
            unmatched['visitas_tecnico'] += 1

    for a in raw['aprovisionamientos']:
        if a.get('anulado') is True or str(a.get('fecha') or '') >= local_today:
            continue
        pid, client, regional = resolve(a, fallback_client='ara')
        month = month_of(a.get('fecha'))
        add(month, client, regional, 'aprovisionamientos_programados')
        if a.get('estado') in PROVISION_DONE:
            add(month, client, regional, 'aprovisionamientos_cumplidos')
        if not pid:
            unmatched['aprovisionamientos'] += 1

    for r in raw['rondas']:
        pid, client, regional = resolve(r)
        add(month_of(r.get('iniciadaEn')), client, regional, 'rondas')
        if not pid:
            unmatched['rondas'] += 1

    for (month, client, regional), pids in visited.items():
        counts[(month, client, regional, 'puestos_visitados')] = len(pids)

    rows = [
        {'period_month': m, 'client_key': c, 'client_label': labels.get(c, c), 'regional': r, 'metric': k, 'value': v}
        for (m, c, r, k), v in sorted(counts.items())
    ]
    summary = {
        'documentos_leidos': {k: len(v) for k, v in raw.items()},
        'aprovisionamientos_hasta': local_today,
        'sin_puesto_identificado': dict(unmatched),
        'filas': len(rows),
    }
    return rows, summary


def sql_literal(value):
    if value is None:
        return 'null'
    if isinstance(value, (int, float)):
        return repr(float(value)) if isinstance(value, float) else str(value)
    return "'" + str(value).replace("'", "''") + "'"


def build_load_sql(payload):
    run = payload['run']
    values = ',\n'.join(
        '(' + ', '.join(sql_literal(x) for x in (r['period_month'], r['client_key'], r['client_label'], r['regional'], r['metric'], r['value'])) + ')'
        for r in payload['metrics']
    )
    return f"""BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '45s';
WITH run AS (
  INSERT INTO public.siio_operations_runs (source_id, extracted_at, extractor_version, client_rule, summary)
  VALUES ({sql_literal(SOURCE_ID)}, {sql_literal(run['extracted_at'])}::timestamptz, {sql_literal(run['extractor_version'])}, {sql_literal(run['client_rule'])}, {sql_literal(json.dumps(run['summary'], ensure_ascii=False))}::jsonb)
  RETURNING id
)
INSERT INTO public.siio_operations_metrics (run_id, period_month, client_key, client_label, regional, metric, value)
SELECT run.id, v.period_month::date, v.client_key, v.client_label, v.regional, v.metric, v.value::numeric
FROM run, (VALUES
{values}
) AS v(period_month, client_key, client_label, regional, metric, value);
COMMIT;
SELECT r.id, r.extracted_at, count(m.*) AS filas FROM public.siio_operations_runs r
LEFT JOIN public.siio_operations_metrics m ON m.run_id = r.id
GROUP BY r.id, r.extracted_at ORDER BY r.extracted_at DESC LIMIT 3;
"""


# ---------------------------------------------------------------- lectura de Firestore

def _value(f):
    if not f:
        return None
    kind, v = next(iter(f.items()))
    if kind == 'integerValue':
        return int(v)
    if kind == 'arrayValue':
        return [_value(x) for x in v.get('values', []) if 'stringValue' in x]  # solo listas de texto (marcas)
    if kind == 'mapValue':
        return None  # nunca se piden, pero no se arrastran si llegaran
    return v


def _token():
    gcloud = '/root/google-cloud-sdk/bin/gcloud'
    out = subprocess.run([gcloud, 'auth', 'application-default', 'print-access-token'], capture_output=True, text=True)
    if not out.stdout.strip():
        raise SystemExit('Sin sesión de Google: repetir el inicio de sesión (gcloud auth application-default login)')
    return out.stdout.strip()


def _run_query(token, collection, where=None):
    query = {'from': [{'collectionId': collection}], 'select': {'fields': [{'fieldPath': f} for f in FIELDS[collection]]}}
    if where:
        query['where'] = where
    url = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents:runQuery'
    req = urllib.request.Request(url, data=json.dumps({'structuredQuery': query}).encode(),
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as resp:
        items = json.load(resp)
    docs = []
    for item in items:
        doc = item.get('document')
        if not doc:
            continue
        row = {k: _value(v) for k, v in doc.get('fields', {}).items() if k in FIELDS[collection]}
        if collection in ('puestos', 'config'):
            row['_id'] = doc['name'].rsplit('/', 1)[-1]
        docs.append(row)
    return docs


def _range(field, start, end, kind):
    def ff(op, value):
        return {'fieldFilter': {'field': {'fieldPath': field}, 'op': op, 'value': {kind: value}}}
    return {'compositeFilter': {'op': 'AND', 'filters': [ff('GREATER_THAN_OR_EQUAL', start), ff('LESS_THAN', end)]}}


def extract(since):
    token = _token()
    start_ts = f'{since}T00:00:00Z'
    end_ts = '2100-01-01T00:00:00Z'
    marcas = [{'id': m['_id'], 'nombre': m.get('nombre'), 'activa': m.get('activa'),
               'puestos': m.get('puestos') or [],
               'zonas': sorted({n for n in (zone_number(z) for z in m.get('zonas') or []) if n is not None})}
              for m in _run_query(token, 'config', {'fieldFilter': {'field': {'fieldPath': 'tipo'}, 'op': 'EQUAL', 'value': {'stringValue': 'marca'}}})
              if m.get('tipo') == 'marca']
    raw = {
        'marcas': marcas,
        'puestos': _run_query(token, 'puestos'),
        'puesto_visits': _run_query(token, 'puesto_visits', _range('arrivalAt', start_ts, end_ts, 'timestampValue')),
        'novedades': _run_query(token, 'novedades', _range('createdAt', start_ts, end_ts, 'timestampValue')),
        # Los tickets abiertos pueden ser viejos: se leen todos (pocos miles, solo 5 campos).
        'reportes_fallas': _run_query(token, 'reportes_fallas'),
        'visitas_tecnico': _run_query(token, 'visitas_tecnico', _range('fecha', since, '9999-12-31', 'stringValue')),
        'aprovisionamientos': _run_query(token, 'aprovisionamientos', _range('fecha', since, '9999-12-31', 'stringValue')),
        'rondas': _run_query(token, 'rondas', _range('iniciadaEn', start_ts, end_ts, 'timestampValue')),
    }
    # reportes_fallas trae todo el histórico para los abiertos; los creados se cuentan desde `since`.
    return raw


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    e = sub.add_parser('extract')
    e.add_argument('--since', default='2026-04-01')
    e.add_argument('--out', required=True)
    s = sub.add_parser('sql')
    s.add_argument('payload')
    s.add_argument('--out', required=True)
    args = ap.parse_args(argv)

    if args.cmd == 'extract':
        now = dt.datetime.now(dt.timezone.utc)
        raw = extract(args.since)
        rows, summary = aggregate(raw, now)
        rows = [r for r in rows if r['period_month'] >= args.since]
        summary['desde'] = args.since
        summary['filas'] = len(rows)
        payload = {'run': {'extracted_at': now.isoformat(timespec='seconds'), 'extractor_version': EXTRACTOR_VERSION,
                           'client_rule': CLIENT_RULE, 'summary': summary}, 'metrics': rows}
        with open(args.out, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        ara = {r['metric']: r['value'] for r in rows if r['client_key'] == 'ara' and r['regional'] == 'TODAS' and r['period_month'] == now.strftime('%Y-%m-01')}
        print(json.dumps({'resumen': summary, 'ara_mes_actual': ara}, ensure_ascii=False, indent=1))
    else:
        with open(args.payload, encoding='utf-8') as fh:
            payload = json.load(fh)
        with open(args.out, 'w', encoding='utf-8') as fh:
            json.dump({'ref': SUPABASE_REF, 'query': build_load_sql(payload)}, fh, ensure_ascii=False)
        print(f"{len(payload['metrics'])} filas → {args.out}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
