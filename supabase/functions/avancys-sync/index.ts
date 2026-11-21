// Conexión directa con Avancys (Odoo JSON-RPC). Las claves viven en los secretos de esta función:
// AVANCYS_URL, AVANCYS_DB, AVANCYS_USUARIO, AVANCYS_CLAVE. Solo un administrador de Programación la usa.
// No aplica nada: deja un cargue en vista previa que el administrador aprueba en la app.
// odoo.ts y normalizar.ts son copias de src/integracion (una prueba verifica que sean idénticas).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { autenticar, contar, leerLugares, leerModalidades, leerPuestos, leerTodo, mapearRegistros, type ConfigEntidad, type ConfigModalidades, type ConfigPuestos, type FiltroLugar } from './odoo.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const SECRETOS = ['AVANCYS_URL', 'AVANCYS_DB', 'AVANCYS_USUARIO', 'AVANCYS_CLAVE'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, db: { schema: 'programacion' },
    });
    const { data: acceso } = await sb.rpc('mi_acceso');
    if (!Array.isArray(acceso) || acceso[0]?.rol !== 'admin') return json({ error: 'Solo un administrador de Programación puede usar la conexión con Avancys' }, 403);

    const body = await req.json();
    const entidad = ['clientes', 'patrones', 'puestos'].includes(body.entidad) ? body.entidad : 'empleados';
    const faltan = SECRETOS.filter((k) => !Deno.env.get(k));
    if (faltan.length) return json({ configurado: false, faltan });

    const { data: integ, error: e1 } = await sb.from('integraciones').select('config').eq('id', 'avancys').single();
    if (e1 || !integ) return json({ error: 'No hay configuración de Avancys' }, 500);
    const raiz = integ.config as Record<string, unknown>;

    // Los puestos traen su municipio en la orden de servicio; el mapa `municipios` lo traduce a una
    // ciudad de Programación. El que no se pueda traducir entra sin ciudad y la vista previa lo
    // muestra como error: `puestos.ciudad_id` es obligatorio y no se inventa.
    if (entidad === 'puestos') {
      const cfgp = raiz.puestos_avancys as ConfigPuestos | undefined;
      if (!cfgp) return json({ error: 'No hay mapeo de puestos en la configuración de Avancys' }, 500);
      const mapa = (raiz.municipios ?? {}) as Record<string, string[]>;
      const deMunicipio = new Map<string, string>();
      for (const [ciudad, lista] of Object.entries(mapa)) for (const m of lista) deMunicipio.set(m.trim().toLowerCase(), ciudad);
      const cx = { url: Deno.env.get('AVANCYS_URL')!, db: Deno.env.get('AVANCYS_DB')!, usuario: Deno.env.get('AVANCYS_USUARIO')!, clave: Deno.env.get('AVANCYS_CLAVE')! };
      const uidp = await autenticar(cx);
      if (body.accion === 'probar') {
        return json({ configurado: true, conectado: true, registros: await contar(cx, uidp, { modelo: cfgp.modelo, dominio: [], campos: {} }) });
      }
      const puestos = (await leerPuestos(cx, uidp, cfgp))
        .map((p) => ({ ...p, ciudad: p.municipio ? deMunicipio.get(p.municipio.trim().toLowerCase()) ?? null : null }));
      const conCiudad = puestos.filter((p) => p.ciudad);
      const nombrep = `Avancys ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      // Solo se mandan los que tienen ciudad y los que traían municipio sin traducir: los que no
      // tienen ni municipio son miles y no aportan nada a la vista previa.
      const filas = puestos.filter((p) => p.ciudad || p.municipio);
      const { data: dp, error: ep } = await sb.rpc('preparar_cargue_puestos', { p_origen: 'avancys', p_archivo: nombrep, p_filas: filas });
      if (ep) return json({ error: ep.message }, 500);
      return json({ configurado: true, registros: puestos.length, con_ciudad: conCiudad.length, ...(dp as object) });
    }

    // Los patrones son el catálogo de modalidades de toda la empresa: no tienen ciudad ni filtro.
    if (entidad === 'patrones') {
      const cfgp = raiz.patrones as ConfigModalidades | undefined;
      if (!cfgp) return json({ error: 'No hay mapeo de patrones en la configuración de Avancys' }, 500);
      const cx = { url: Deno.env.get('AVANCYS_URL')!, db: Deno.env.get('AVANCYS_DB')!, usuario: Deno.env.get('AVANCYS_USUARIO')!, clave: Deno.env.get('AVANCYS_CLAVE')! };
      const uidp = await autenticar(cx);
      if (body.accion === 'probar') {
        return json({ configurado: true, conectado: true, registros: await contar(cx, uidp, { modelo: cfgp.modelo, dominio: [], campos: {} }) });
      }
      const patrones = await leerModalidades(cx, uidp, cfgp);
      const nombrep = `Avancys ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const { data: dp, error: ep } = await sb.rpc('preparar_cargue_patrones', { p_origen: 'avancys', p_archivo: nombrep, p_filas: patrones });
      if (ep) return json({ error: ep.message }, 500);
      return json({ configurado: true, registros: patrones.length, ...(dp as object) });
    }

    const cfg = raiz[entidad] as ConfigEntidad;
    if (!cfg) return json({ error: `No hay mapeo de ${entidad} en la configuración de Avancys` }, 500);
    // El filtro del lugar se declara por ciudad de Programación. Sin filtro declarado no se trae nada:
    // traer toda la empresa a una ciudad crearía cientos de altas que no son de esa ciudad.
    const filtros = (raiz.ciudades ?? {}) as Record<string, FiltroLugar>;
    const filtro = body.ciudad ? filtros[String(body.ciudad)] : undefined;
    if (body.ciudad && !filtro) {
      return json({ error: `No hay filtro declarado para la ciudad "${body.ciudad}" en integraciones.avancys (config.ciudades)` }, 400);
    }
    const c = { url: Deno.env.get('AVANCYS_URL')!, db: Deno.env.get('AVANCYS_DB')!, usuario: Deno.env.get('AVANCYS_USUARIO')!, clave: Deno.env.get('AVANCYS_CLAVE')! };
    const uid = await autenticar(c);
    if (body.accion === 'probar') return json({ configurado: true, conectado: true, registros: await contar(c, uid, cfg) });

    const registros = await leerTodo(c, uid, cfg);
    const lugares = cfg.lugar && cfg.lugar.desde !== 'propio' ? await leerLugares(c, uid, cfg.lugar) : undefined;
    const { filas, descartadosPorCiudad, sinLugar } = mapearRegistros(registros, cfg, entidad, filtro, lugares);
    const nombre = `Avancys ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const { data, error } = entidad === 'empleados'
      ? await sb.rpc('preparar_cargue_empleados', { p_ciudad: body.ciudad, p_origen: 'avancys', p_archivo: nombre, p_filas: filas, p_marcar_ausentes: true })
      : await sb.rpc('preparar_cargue_clientes', { p_origen: 'avancys', p_archivo: nombre, p_filas: filas });
    if (error) return json({ error: error.message }, 500);
    return json({ configurado: true, registros: registros.length, descartadosPorCiudad, sinLugar, ...(data as object) });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
