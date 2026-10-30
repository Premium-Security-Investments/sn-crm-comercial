import datetime as dt
import importlib.util
import json
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "agt004_securityops_operations.py"


def load_module():
    spec = importlib.util.spec_from_file_location("agt004_securityops_operations", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


ops = load_module()
NOW = dt.datetime(2026, 10, 14, 12, 0, tzinfo=dt.timezone.utc)


def raw_fixture():
    return {
        'puestos': [
            {'_id': 'p1', 'name': 'ARA CHAPINERO', 'zone': 'Zona 1: Coordinador X', 'regional': 'BOGOTA', 'sap': '1001', 'esUnidadMonitoreo': False},
            {'_id': 'p2', 'name': 'ARA TULUA', 'zone': 'Zona 7', 'regional': 'VALLE', 'sap': '2002', 'esUnidadMonitoreo': False},
            {'_id': 'p3', 'name': 'Hitachi  la Estancia', 'zone': 'ZONA4', 'regional': 'BOGOTA', 'sap': '', 'esUnidadMonitoreo': False},
            {'_id': 'p4', 'name': 'CUENTA ALARMA', 'zone': 'Zona 9', 'regional': 'PEREIRA', 'cuenta': '777'},
            {'_id': 'p5', 'name': 'ARA VIEJA', 'zone': 'Zona 1', 'regional': 'BOGOTA', 'status': 'archivado'},
            {'_id': 'p6', 'name': 'PARADERO', 'zone': 'Zona 8', 'regional': 'CALDAS', 'esUnidadMonitoreo': False},
            {'_id': 'p7', 'name': 'CLINICA NORTE', 'zone': 'ZONA4', 'regional': 'BOGOTA', 'esUnidadMonitoreo': False},
        ],
        'marcas': [{'id': 'marca_clinica', 'nombre': 'Clínica Norte', 'activa': True, 'puestos': ['CLINICA NORTE'], 'zonas': []}],
        'puesto_visits': [
            {'puestoId': 'p1', 'arrivalAt': '2026-10-02T10:00:00Z', 'status': 'COMPLETED', 'tipoVisita': 'supervision'},
            {'puestoId': 'p1', 'arrivalAt': '2026-10-05T10:00:00Z', 'status': 'AUTO_CLOSED'},
            {'puestoId': 'p2', 'arrivalAt': '2026-10-06T10:00:00Z', 'status': 'ABANDONED'},
            {'puestoId': 'p2', 'arrivalAt': '2026-10-06T23:00:00Z', 'status': 'COMPLETED', 'tipoVisita': 'aprovisionamiento'},
            {'puestoId': 'p3', 'arrivalAt': '2026-09-20T10:00:00Z', 'status': 'COMPLETED'},
        ],
        'novedades': [
            {'puestoId': 'p1', 'createdAt': '2026-10-03T01:00:00Z', 'status': 'completado'},
            {'puestoId': 'p1', 'createdAt': '2026-10-03T02:00:00Z', 'status': 'borrador'},
            {'puestoId': '', 'createdAt': '2026-10-04T02:00:00Z', 'status': 'completado'},
        ],
        'reportes_fallas': [
            {'puestoId': '', 'sap': '2002', 'createdAt': '2026-10-01T00:00:00Z', 'estado': 'nuevo'},
            {'puestoId': 'p1', 'createdAt': '2026-10-12T00:00:00Z'},
            {'puestoId': 'p1', 'createdAt': '2026-08-01T00:00:00Z', 'estado': 'cerrado'},
            {'puestoId': 'p3', 'createdAt': '2026-07-01T00:00:00Z', 'estado': 'solucionado'},
            {'puestoId': 'p3', 'createdAt': '2026-07-01T00:00:00Z', 'estado': 'respondido', 'respondidoAt': '2026-07-02T00:00:00Z'},
        ],
        'visitas_tecnico': [
            {'puestoId': 'p2', 'fecha': '2026-10-07', 'status': 'COMPLETED'},
            {'puestoId': 'p2', 'fecha': '2026-10-08', 'status': 'ABANDONED'},
        ],
        'aprovisionamientos': [
            {'puestoId': 'p1', 'fecha': '2026-10-02', 'estado': 'descargado'},
            {'puestoId': None, 'sap': '2002', 'fecha': '2026-10-02', 'estado': 'camion_no_llego'},
            {'puestoId': None, 'sap': '9999', 'regional': 'Tolima', 'fecha': '2026-10-03', 'estado': 'puerta_abierta'},
            {'puestoId': 'p1', 'fecha': '2026-10-04', 'estado': 'programado', 'anulado': True},
            {'puestoId': 'p1', 'fecha': '2026-10-14', 'estado': 'programado'},  # hoy: el camión aún no llega
        ],
        'rondas': [{'puestoId': 'p3', 'iniciadaEn': '2026-10-01T03:00:00Z', 'status': 'COMPLETADA'}],
    }


def metric(rows, month, client, regional, name):
    for r in rows:
        if (r['period_month'], r['client_key'], r['regional'], r['metric']) == (month, client, regional, name):
            return r['value']
    return 0


class AggregateTest(unittest.TestCase):
    def setUp(self):
        self.rows, self.summary = ops.aggregate(raw_fixture(), NOW)

    def test_client_rule(self):
        client_of, labels = ops.make_client_of(ops.merge_brands([]))
        self.assertEqual(client_of({'zone': 'Zona 2: Alguien'}), 'ara')
        self.assertEqual(client_of({'zone': 'Zona 7', 'name': 'ARA TULUA'}), 'ara')
        self.assertEqual(client_of({'zone': 'Zona 8', 'name': 'PARADERO'}), 'otros')
        self.assertEqual(client_of({'zone': 'ZONA4', 'name': 'Suzuki 36'}), 'suzuki')
        self.assertEqual(client_of({'zone': 'ZONA4', 'name': 'HITACHI'}), 'otros')  # nombre exacto, como SecurityOps
        # marcaId del puesto gana a la zona; el nombre gana a la zona.
        self.assertEqual(client_of({'zone': 'Zona 1', 'marcaId': 'marca_cide'}), 'cide')
        self.assertEqual(client_of({'zone': 'Zona 1', 'name': 'PAPELES FUNZA'}), 'grandbay')
        self.assertEqual(labels['grandbay'], 'Grandbay · Papeles Nacionales')
        self.assertEqual(client_of({'name': 'REDES MÉDICAS'}), 'redes_medicas')

    def test_client_keys_fit_the_table_check(self):
        import re
        for r in self.rows:
            self.assertRegex(r['client_key'], r'^[a-z0-9_]{1,40}$')
        self.assertEqual(ops.brand_key('marca_Óptica-Ñ 2'), 'optica_n_2')
        self.assertEqual(ops.brand_key('marca_total'), 'marca_total')

    def test_firestore_brands_win_and_inactive_are_ignored(self):
        brands = ops.merge_brands([{'id': 'marca_suzuki', 'nombre': 'Suzuki Motor', 'puestos': ['SUZUKI 99'], 'zonas': []},
                                   {'id': 'marca_x', 'nombre': 'X', 'activa': False, 'puestos': ['PARADERO'], 'zonas': []}])
        client_of, labels = ops.make_client_of(brands)
        self.assertEqual(client_of({'name': 'SUZUKI 99'}), 'suzuki')
        self.assertEqual(client_of({'name': 'SUZUKI 36'}), 'otros')
        self.assertEqual(client_of({'name': 'PARADERO'}), 'otros')
        self.assertEqual(labels['suzuki'], 'Suzuki Motor')

    def test_named_clients_get_own_rows(self):
        oct_ = '2026-10-01'
        self.assertEqual(metric(self.rows, oct_, 'clinica', 'BOGOTA', 'puestos_activos'), 1)
        self.assertEqual(metric(self.rows, oct_, 'hitachi', 'BOGOTA', 'puestos_activos'), 1)
        labels = {r['client_key']: r['client_label'] for r in self.rows}
        self.assertEqual(labels['clinica'], 'Clínica Norte')
        self.assertEqual(labels['hitachi'], 'HITACHI')

    def test_puestos_activos_excludes_alarm_accounts_and_archived(self):
        oct_ = '2026-10-01'
        self.assertEqual(metric(self.rows, oct_, 'ara', 'TODAS', 'puestos_activos'), 2)
        self.assertEqual(metric(self.rows, oct_, 'otros', 'TODAS', 'puestos_activos'), 1)
        self.assertEqual(metric(self.rows, oct_, 'total', 'TODAS', 'puestos_activos'), 5)
        self.assertEqual(metric(self.rows, oct_, 'ara', 'VALLE', 'puestos_activos'), 1)

    def test_supervisor_visits_skip_abandoned_and_provisioning(self):
        oct_ = '2026-10-01'
        self.assertEqual(metric(self.rows, oct_, 'ara', 'TODAS', 'visitas_supervisor'), 2)
        self.assertEqual(metric(self.rows, oct_, 'ara', 'TODAS', 'puestos_visitados'), 1)
        self.assertEqual(metric(self.rows, '2026-09-01', 'hitachi', 'BOGOTA', 'visitas_supervisor'), 1)

    def test_novedades_skip_drafts_and_keep_unlinked(self):
        self.assertEqual(metric(self.rows, '2026-10-01', 'ara', 'TODAS', 'novedades'), 1)
        self.assertEqual(metric(self.rows, '2026-10-01', 'sin_identificar', 'TODAS', 'novedades'), 1)
        self.assertEqual(metric(self.rows, '2026-10-01', 'total', 'TODAS', 'novedades'), 2)

    def test_tickets_open_and_overdue_are_snapshot_of_current_month(self):
        oct_ = '2026-10-01'
        # p2 (por SAP) abierto 13 días; p1 abierto 2 días; p3 'solucionado' sin respuesta, 105 días.
        self.assertEqual(metric(self.rows, oct_, 'ara', 'TODAS', 'tickets_abiertos'), 2)
        self.assertEqual(metric(self.rows, oct_, 'ara', 'TODAS', 'tickets_vencidos_5d'), 1)
        self.assertEqual(metric(self.rows, oct_, 'hitachi', 'TODAS', 'tickets_vencidos_5d'), 1)
        self.assertEqual(metric(self.rows, '2026-08-01', 'ara', 'TODAS', 'tickets_creados'), 1)

    def test_provisioning(self):
        oct_ = '2026-10-01'
        self.assertEqual(metric(self.rows, oct_, 'ara', 'TODAS', 'aprovisionamientos_programados'), 3)
        self.assertEqual(metric(self.rows, oct_, 'ara', 'TODAS', 'aprovisionamientos_cumplidos'), 2)
        self.assertEqual(metric(self.rows, oct_, 'ara', 'TOLIMA', 'aprovisionamientos_programados'), 1)
        self.assertEqual(self.summary['sin_puesto_identificado']['aprovisionamientos'], 1)
        self.assertEqual(self.summary['aprovisionamientos_hasta'], '2026-10-14')

    def test_technician_visits_only_completed(self):
        self.assertEqual(metric(self.rows, '2026-10-01', 'ara', 'VALLE', 'visitas_tecnico'), 1)

    def test_no_personal_fields_requested(self):
        forbidden = {'supervisorName', 'supervisorId', 'guardaName', 'tecnicoName', 'placa', 'gpsLocation',
                     'descripcion', 'capturadoCedula', 'motorizadoNombre', 'images', 'historial', 'uid', 'address', 'position'}
        for collection, fields in ops.FIELDS.items():
            self.assertFalse(forbidden & set(fields), collection)

    def test_rows_never_carry_zone_names(self):
        blob = json.dumps(self.rows)
        self.assertNotIn('Coordinador', blob)
        self.assertNotIn('Zona', blob)


class SqlTest(unittest.TestCase):
    def test_load_sql_is_atomic_and_escaped(self):
        payload = {'run': {'extracted_at': '2026-10-14T12:00:00+00:00', 'extractor_version': 'v', 'client_rule': "regla con 'comilla'", 'summary': {'a': 1}},
                   'metrics': [{'period_month': '2026-10-01', 'client_key': 'ara', 'client_label': "ARA d'X", 'regional': 'TODAS', 'metric': 'novedades', 'value': 3}]}
        sql = ops.build_load_sql(payload)
        self.assertTrue(sql.startswith('BEGIN;'))
        self.assertIn('COMMIT;', sql)
        self.assertIn("'regla con ''comilla'''", sql)
        self.assertIn("'ARA d''X'", sql)
        self.assertIn("'SRC-OPS-SECURITYOPS'", sql)


if __name__ == '__main__':
    unittest.main()
