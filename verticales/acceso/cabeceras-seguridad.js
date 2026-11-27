// Cabeceras de seguridad del SIIO (27-nov-2026). Pedido de Fabián al unificar el inicio de sesión: el SIIO no puede dejar
// abiertas las puertas que SecurityOps ya cerró. Antes el SIIO no mandaba ninguna y anunciaba «X-Powered-By: Express».
//
// - Se aplican de una vez: HSTS, X-Frame-Options DENY (+ frame-ancestors), nosniff, Referrer-Policy, COOP/CORP, sin X-Powered-By.
// - La CSP va en modo «solo reportar» (Content-Security-Policy-Report-Only): registra lo que bloquearía sin bloquear, para
//   no dejar a nadie sin SIIO por un origen olvidado. Se pasa a bloquear cuando los reportes estén limpios.
//   Inventario de orígenes (27-nov, src/): Supabase (datos, archivos firmados), Firebase Auth REST (identitytoolkit,
//   securetoken), Google Fonts (programacion.css). Las descargas usan blob: del propio navegador.
import helmet from 'helmet';

const SUPABASE_FALLBACK = 'https://tyfzjqzcpgwcjnxozaaf.supabase.co';
export const CSP_REPORT_PATH = '/api/csp-report';
const MAX_REPORT_BYTES = 20_000;

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

export function cspDirectives(environment = process.env) {
  const supabase = originOf(environment?.NEXT_PUBLIC_SUPABASE_URL) || SUPABASE_FALLBACK;
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'blob:', supabase],
    connectSrc: ["'self'", supabase, 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'],
    frameSrc: ["'none'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    reportUri: [CSP_REPORT_PATH],
    upgradeInsecureRequests: null,
  };
}

export function cabecerasSeguridad(environment = process.env) {
  return helmet({
    contentSecurityPolicy: { useDefaults: false, reportOnly: true, directives: cspDirectives(environment) },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: false, preload: false },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  });
}

/** Receptor de reportes CSP: corto, sin datos de la persona, a prueba de basura. Siempre 204. */
export function recibirReporteCsp(req, res) {
  try {
    const body = req.body;
    const raw = JSON.stringify(body ?? null);
    if (raw && raw.length <= MAX_REPORT_BYTES) {
      const reports = Array.isArray(body) ? body.map(r => r?.body || r) : [body?.['csp-report'] || body];
      for (const r of reports.slice(0, 5)) {
        if (!r || typeof r !== 'object') continue;
        console.warn('siio_csp_report', {
          directiva: String(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || '').slice(0, 60),
          bloqueado: String(r['blocked-uri'] || r.blockedURL || '').slice(0, 200),
          pagina: String(originOf(r['document-uri'] || r.documentURL) || '').slice(0, 120),
        });
      }
    }
  } catch { /* un reporte malformado no rompe nada */ }
  res.status(204).end();
}

export const CSP_REPORT_CONTENT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];

/** Envuelve el lector de JSON de la ruta: un cuerpo roto o demasiado grande se descarta en silencio (204), sin el
 *  error por defecto de Express, que mostraría detalles internos. */
export function lectorReporteCsp(jsonParser) {
  return (req, res, next) => jsonParser(req, res, error => (error ? res.status(204).end() : next()));
}
