
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Stage = { code: string; name: string; stage_order: number; close_probability: number; is_terminal: boolean };
type CommercialArea = 'seguridad_fisica' | 'tecnologia' | 'licitacion_publica';
type CustomerSegment = 'cliente_nuevo' | 'cliente_actual';
type Profile = { id: string; full_name: string; microsoft_email: string; role: string; active: boolean; commercial_area?: CommercialArea | null; can_edit_customer_segment?: boolean };
type ServiceType = { code: string; name: string };
type LossReason = { code: string; name: string };
type SummaryRow = { stage_code: string; stage_name: string; stage_order: number; opportunities_count: number; total_offer_value: number; weighted_pipeline_value: number };
type Opportunity = {
  id: string; owner_id: string | null; company_name: string; owner_name: string | null; owner_email: string | null;
  stage_code: string; stage_name: string; stage_order: number; service_type_code: string | null; service_type_name: string | null;
  offer_value: number; weighted_pipeline_value: number; regional_nombre: string | null; sede: string | null;
  tipo_producto_original: string | null; quote_city: string | null; quote_date: string | null; expected_close_date: string | null;
  last_interaction_at: string | null; next_action_at: string | null; prioritization_date: string | null; observaciones: string | null;
  economic_sector: string | null; decision_maker_name: string | null; decision_maker_email: string | null; decision_maker_phone: string | null;
  legacy_excel_id: string | null; excel_hoja_origen: string | null; estado_pipeline_original: string | null; valor_servicio: number | null; valor_proyecto: number | null;
  loss_reason_code: string | null; loss_reason_name: string | null; loss_notes: string | null; commission_rate: number | null; created_at: string; updated_at: string; approved_at?: string | null;
  customer_segment?: CustomerSegment | null; owner_commercial_area?: CommercialArea | null; owner_can_edit_customer_segment?: boolean | null;
};
type Interaction = { id: string; opportunity_id: string; interaction_type: string; notes: string | null; occurred_at: string; created_at: string; created_by: string | null; psi_sales_profiles?: { full_name?: string } | null };
type MonthlyKpi = { owner_id?: string | null; owner_name: string | null; period_month: string; prospectos: number; cotizaciones: number; ventas_aprobadas: number; comision_ganada: number; comision_proyectada: number };
type SalesGoal = { id?: string; user_id: string | null; period_month: string; quote_target: number; prospect_target: number; sales_budget: number; created_at?: string; updated_at?: string };
type Bootstrap = { summary: SummaryRow[]; opportunities: Opportunity[]; profiles: Profile[]; stages: Stage[]; services: ServiceType[]; lossReasons: LossReason[]; stalled: Opportunity[]; topClosing: Opportunity[]; monthlyKpis: MonthlyKpi[]; goals: SalesGoal[]; totals: { count: number; pipeline: number; weighted: number; approved: number }; currentProfile: Profile };
type UserPayload = { full_name: string; microsoft_email: string; role: string; active: boolean; password?: string; send_invite?: boolean; commercial_area?: CommercialArea | ''; can_edit_customer_segment?: boolean };
type TenderSection = 'hacer' | 'revisar' | 'descartar';
type TenderInternalStatus = 'nueva' | 'en_revision' | 'convertida_oportunidad' | 'descartada';
type TenderQuickFilter = 'hacer' | 'en_revision' | 'high_value' | 'convertidas' | null;
type TenderFastFilter = 'hacer' | 'revisar' | 'nuevas' | 'urgentes' | 'alto_valor' | 'alto_encaje' | null;
type TenderPrimaryFilter = 'todas' | TenderSection | Exclude<TenderFastFilter, null>;
type TenderDeadlineFilter = 'todas' | '0_7' | '8_15' | '16_30' | 'vencida' | 'sin_fecha';
type TenderValueFilter = 'todas' | 'sin_valor' | 'lt_50m' | '50m_500m' | '500m_plus' | '1000m_plus';
type TenderScoreFilter = 'todas' | 'alto' | 'medio' | 'bajo';
type TenderSortKey = 'deadline' | 'value' | 'score' | 'entity' | 'source';
type PublicTender = { id: string; stable_key?: string; source: string; section: TenderSection; internal_status?: TenderInternalStatus; converted_opportunity_id?: string | null; reviewed_at?: string | null; detected_at?: string | null; last_seen_at?: string | null; entity: string; dept?: string; city?: string; ref?: string; process_id?: string; title: string; desc?: string; value: number; status?: string; category?: string; published?: string | null; deadline?: string | null; window?: string; days?: number | null; score: number; reasons: string[]; risks: string[]; url?: string };
type TenderSourceDiagnostic = { source: string; status: 'ok' | 'error' | string; count?: number; message?: string };
type TenderRadarPayload = { generatedAt: string; source?: string; diagnostics?: TenderSourceDiagnostic[]; totals: { all: number; hacer: number; revisar: number; descartar: number; highValue: number; urgent: number; enRevision?: number; convertidas?: number; descartadas?: number }; tenders: PublicTender[] };
type Route = { page: 'home' | 'opportunities' | 'tenders' | 'detail' | 'new' | 'edit' | 'dashboard' | 'consultant' | 'goals' | 'alerts' | 'centinel' | 'users'; id?: string };
type DashboardPeriodFilter = '' | 'todos' | 'mes_actual' | 'proximos_30' | 'trimestre_actual' | 'anio_actual';

type OpportunityPayload = Partial<Omit<Opportunity, 'customer_segment'>> & { company_name?: string; offer_value?: number | string; commission_rate?: number | string; external_source?: string; customer_segment?: CustomerSegment | ''; };
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
const interactionTypes = ['llamada','correo','reunion','whatsapp','nota','cambio_estado','documento'];
const supabaseBrowser = createClient(import.meta.env.NEXT_PUBLIC_SUPABASE_URL, import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
let currentAccessToken: string | null = null;
function setApiAccessToken(token: string | null) { currentAccessToken = token; }
function isManagementRole(role?: string | null) { return ['director','gerencia','admin'].includes(role || ''); }
function canManageUsers(profile?: Profile | null) { return profile?.role === 'admin'; }
function canManageGoals(profile?: Profile | null) { return isManagementRole(profile?.role); }
function canViewTenders(profile?: Profile | null) { return isManagementRole(profile?.role) || profile?.microsoft_email?.toLowerCase() === 'directora.licitaciones@seguridadnacional.co'; }
function alertOpportunityCount(opportunities: Opportunity[]) {
  return opportunities.filter(o => {
    if (isTerminalStage(o.stage_code)) return false;
    const action = nextActionStatus(o);
    const inactiveDays = daysSince(o.last_interaction_at || o.updated_at || o.created_at);
    return ['missing','overdue','today','soon'].includes(action.code)
      || (o.stage_code === 'sustentacion' && Number(inactiveDays || 0) > 5)
      || (Number(o.offer_value || 0) >= 250_000_000 && Number(inactiveDays || 0) >= 10);
  }).length;
}
const customerSegmentOptions: Array<[CustomerSegment, string]> = [['cliente_nuevo','Cliente Nuevo'], ['cliente_actual','Cliente Actual']];
const commercialAreaOptions: Array<[CommercialArea, string]> = [['seguridad_fisica','Seguridad Física'], ['tecnologia','Tecnología'], ['licitacion_publica','Licitación Pública']];
const TENDER_OFFICIAL_SOURCES = ['SECOP I', 'SECOP II', 'TVEC', 'ESU Contratación'];
function customerSegmentLabel(value?: string | null) { return value === 'cliente_nuevo' ? 'Cliente Nuevo' : value === 'cliente_actual' ? 'Cliente Actual' : 'Pendiente'; }
function commercialAreaLabel(value?: string | null) { return value === 'seguridad_fisica' ? 'Seguridad Física' : value === 'tecnologia' ? 'Tecnología' : value === 'licitacion_publica' ? 'Licitación Pública' : 'Sin área'; }
function isApprovedSale(o: Opportunity) { return o.stage_code === 'aprobado'; }
function canEditOpportunitySegment(current: Profile, opportunity?: Opportunity | null) { return !opportunity || isManagementRole(current.role) || (current.can_edit_customer_segment && opportunity.owner_id === current.id); }

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path] = hash.split('?');
  const [page, id] = path.split('/');
  if (page === 'opportunities') return { page: 'opportunities' };
  if (page === 'tenders') return { page: 'tenders' };
  if (page === 'detail' && id) return { page: 'detail', id: decodeURIComponent(id) };
  if (page === 'edit' && id) return { page: 'edit', id: decodeURIComponent(id) };
  if (page === 'consultant' && id) return { page: 'consultant', id: decodeURIComponent(id) };
  if (page === 'new') return { page: 'new' };
  if (page === 'dashboard') return { page: 'dashboard' };
  if (page === 'goals') return { page: 'goals' };
  if (page === 'alerts') return { page: 'alerts' };
  if (page === 'centinel' || page === 'vig-ia') return { page: 'centinel' };
  if (page === 'users') return { page: 'users' };
  return { page: 'dashboard' };
}
function go(hash: string) { window.location.hash = hash; }
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = { 'Content-Type': 'application/json', ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}), ...(options?.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}
function fmtMoney(n: number | null | undefined) { return money.format(Number(n || 0)); }
function fmtMoneyCompact(n: number | null | undefined) {
  const value = Number(n || 0);
  if (Math.abs(value) >= 1_000_000) return `$ ${(value / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 0 })} M`;
  if (Math.abs(value) > 0) return `$ ${(value / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  return '$ 0 M';
}
function fmtDate(value?: string | null) { return value ? dateFmt.format(new Date(value)) : '—'; }
function fmtTenderDeadline(value?: string | null) {
  if (!value) return 'sin fecha';
  const target = new Date(value);
  const today = new Date();
  target.setHours(0,0,0,0); today.setHours(0,0,0,0);
  const days = Math.ceil((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `vencida · ${fmtDate(value)}`;
  if (days === 0) return `vence hoy · ${fmtDate(value)}`;
  if (days <= 7) return `vence en ${days} día(s) · ${fmtDate(value)}`;
  return fmtDate(value);
}
function tenderDeadlineDays(value?: string | null) {
  if (!value) return null;
  const target = new Date(value); const today = new Date();
  target.setHours(0,0,0,0); today.setHours(0,0,0,0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}
function uniq(values: Array<string | null | undefined>) { return Array.from(new Set(values.filter(Boolean) as string[])).sort((a,b) => a.localeCompare(b)); }
function ownerKey(o: Pick<Opportunity, 'owner_id'>) { return o.owner_id || '__sin_comercial__'; }
function ownerRoute(ownerId: string) { return `#/consultant/${encodeURIComponent(ownerId)}`; }
function alertRoute(status: string) { return `#/alerts?status=${encodeURIComponent(status)}`; }
function managerAlertRoute(status: string) { return alertRoute(status); }
function tenderDeepLink(tender: PublicTender) { return `#/tenders?tender=${encodeURIComponent(tender.id)}`; }
function hashQueryParam(name: string) { return new URLSearchParams((window.location.hash.split('?')[1] || '')).get(name) || ''; }
function isTerminalStage(stageCode?: string | null) { return ['aprobado','perdido','descartado'].includes(stageCode || ''); }
function dashboardOpportunityDate(o: Opportunity) { return o.expected_close_date || o.quote_date || o.approved_at || o.updated_at || o.created_at; }
function matchesDashboardPeriod(o: Opportunity, period: DashboardPeriodFilter) {
  if (!period || period === 'todos') return true;
  const value = dashboardOpportunityDate(o);
  if (!value) return false;
  const d = new Date(value); if (Number.isNaN(d.getTime())) return false;
  const today = startOfToday();
  if (period === 'mes_actual') return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
  if (period === 'proximos_30') { const max = new Date(today); max.setDate(max.getDate() + 30); return d >= today && d <= max; }
  if (period === 'trimestre_actual') return d.getFullYear() === today.getFullYear() && Math.floor(d.getMonth()/3) === Math.floor(today.getMonth()/3);
  if (period === 'anio_actual') return d.getFullYear() === today.getFullYear();
  return true;
}
function lastUpdatedLabel(rows: Opportunity[]) {
  const timestamps = rows.map(o => new Date(o.updated_at || o.created_at).getTime()).filter(Number.isFinite);
  return timestamps.length ? fmtDate(new Date(Math.max(...timestamps)).toISOString()) : 'Sin fecha';
}
function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function daysSince(value?: string | null) { if (!value) return null; const diff = startOfToday().getTime() - new Date(value).getTime(); return Math.max(0, Math.floor(diff / 86_400_000)); }
function nextActionStatus(o: Pick<Opportunity, 'stage_code' | 'next_action_at' | 'last_interaction_at' | 'updated_at' | 'created_at'>) {
  if (isTerminalStage(o.stage_code)) return { code: 'closed', label: 'Cerrada', tone: 'success', detail: 'No requiere próxima gestión' };
  if (!o.next_action_at) return { code: 'missing', label: 'Sin agenda', tone: 'danger', detail: 'Programar próxima gestión' };
  const today = startOfToday();
  const next = new Date(o.next_action_at); next.setHours(0,0,0,0);
  const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { code: 'overdue', label: 'Vencida', tone: 'danger', detail: `${Math.abs(days)} día(s) vencida` };
  if (days === 0) return { code: 'today', label: 'Hoy', tone: 'amber', detail: 'Gestionar hoy' };
  if (days <= 3) return { code: 'soon', label: 'Próxima', tone: 'amber', detail: `En ${days} día(s)` };
  return { code: 'scheduled', label: 'Agendada', tone: 'success', detail: fmtDate(o.next_action_at) };
}

function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    if (!currentAccessToken) return;
    setLoading(true); setError(null);
    try { setData(await api<Bootstrap>('/api/bootstrap')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setApiAccessToken(data.session?.access_token || null);
      setAuthReady(true);
    });
    const { data: listener } = supabaseBrowser.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setSession(nextSession);
      setApiAccessToken(nextSession?.access_token || null);
      if (!nextSession) { setData(null); setPasswordRecovery(false); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (authReady && session) refresh(); }, [authReady, session?.access_token]);
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (!authReady) return <div className="app"><main><div className="notice">Verificando sesión…</div></main></div>;
  if (!session) return <LoginScreen />;
  if (passwordRecovery) return <PasswordResetScreen onDone={() => setPasswordRecovery(false)} />;
  const currentProfile = data?.currentProfile || null;
  return <div className="app crm-v2-shell">
    <aside className="sidebar">
      <div className="brand"><span className="sidebar-logo-mark">SN</span><div><small>Seguridad Nacional</small><em>CRM Comercial</em></div></div>
      <Nav route={route} currentProfile={currentProfile} tenderCount={data?.totals.count || 0} opportunityCount={data?.opportunities.length || 0} alertCount={data ? alertOpportunityCount(data.opportunities) : 0} />
      <div className="session-card"><span className="avatar-initials">{(currentProfile?.full_name || session.user.email || 'SN').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</span><div><small>Sesión activa</small><strong>{currentProfile?.full_name || session.user.email}</strong><span>{currentProfile?.role || 'perfil'}</span></div></div>
      <button className="secondary full" onClick={refresh}>Actualizar datos</button>
      <button className="secondary full" onClick={() => supabaseBrowser.auth.signOut()}>Cerrar sesión</button>
    </aside>
    <main>
      <header className="topbar">
        <div><p className="breadcrumb" aria-label="CRM · Seguridad Nacional">CRM comercial · Seguridad Nacional</p><h1>{titleFor(route)}</h1></div>
        <div className="topbar-actions"><span className="topbar-status"><i/> Actualizado</span><button onClick={() => go('#/new')}>+ Nueva oportunidad</button></div>
      </header>
      {loading && <div className="notice">Cargando información comercial…</div>}
      {error && <div className="error">{error}</div>}
      {!loading && data && <RouterView route={route} data={data} refresh={refresh} />}
    </main>
  </div>;
}

function PasswordResetScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState('Define una nueva clave de mínimo 8 caracteres.');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setStatus('La nueva clave debe tener mínimo 8 caracteres.'); return; }
    if (password !== confirm) { setStatus('Las claves no coinciden.'); return; }
    setStatus('Actualizando clave…');
    const { error } = await supabaseBrowser.auth.updateUser({ password });
    if (error) { setStatus(error.message); return; }
    window.history.replaceState(null, '', window.location.origin);
    setStatus('Clave actualizada. Ya puedes continuar en el CRM.');
    onDone();
  };
  return <div className="login-shell">
    <form className="login-card" onSubmit={submit}>
      <span className="eyebrow">Seguridad Nacional Ltda</span>
      <h1>Restablecer clave</h1>
      <p>Ingresa la nueva clave para tu usuario del CRM Comercial.</p>
      <label>Nueva clave<input type="password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" /></label>
      <label>Confirmar clave<input type="password" required minLength={8} value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repite la clave" /></label>
      <button>Actualizar clave</button>
      {status && <small>{status}</small>}
    </form>
  </div>;
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const normalizedEmail = email.trim().toLowerCase();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Ingresando…');
    const { error } = await supabaseBrowser.auth.signInWithPassword({ email: normalizedEmail, password });
    setStatus(error ? error.message : 'Sesión iniciada.');
  };
  const resetPassword = async () => {
    if (!normalizedEmail) { setStatus('Escribe tu email para enviarte el enlace de recuperación.'); return; }
    setStatus('Enviando recuperación…');
    const { error } = await supabaseBrowser.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: window.location.origin });
    setStatus(error ? error.message : 'Te enviamos un enlace para restablecer la clave. Revisa tu correo.');
  };
  return <div className="login-shell">
    <form className="login-card" onSubmit={submit}>
      <span className="eyebrow">Seguridad Nacional Ltda</span>
      <h1>Ingreso al CRM Comercial</h1>
      <p>Ingresa con el usuario asignado para ver tus oportunidades y próximas acciones.</p>
      <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="correo@empresa.com" /></label>
      <label>Clave<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Clave temporal" /></label>
      <button>Ingresar</button>
      <button type="button" className="secondary" onClick={resetPassword}>Olvidé mi clave</button>
      {status && <small>{status}</small>}
    </form>
  </div>;
}
function titleFor(route: Route) {
  if (route.page === 'opportunities') return 'Oportunidades';
  if (route.page === 'tenders') return 'Licitaciones';
  if (route.page === 'detail') return 'Detalle de oportunidad';
  if (route.page === 'new') return 'Crear oportunidad';
  if (route.page === 'edit') return 'Editar oportunidad';
  if (route.page === 'dashboard') return 'Dashboard gerencial';
  if (route.page === 'consultant') return 'Detalle de consultor';
  if (route.page === 'goals') return 'Metas comerciales y cumplimiento';
  if (route.page === 'alerts') return 'Alertas comerciales';
  if (route.page === 'centinel') return 'Vig-IA — Reportes gerenciales';
  if (route.page === 'users') return 'Usuarios y permisos';
  return 'Inicio comercial';
}
function Nav({ route, currentProfile, tenderCount, opportunityCount, alertCount }: { route: Route; currentProfile: Profile | null; tenderCount?: number; opportunityCount?: number; alertCount?: number }) {
  const items = [['#/dashboard','Dashboard gerencial'],['#/alerts','Alertas comerciales'],['#/opportunities','Oportunidades']];
  if (canViewTenders(currentProfile)) items.push(['#/tenders','Licitaciones']);
  items.push(['#/vig-ia','Vig-IA'],['#/new','Crear oportunidad'],['#/goals','Metas y cumplimiento']);
  if (canManageUsers(currentProfile)) items.push(['#/users','Usuarios y permisos']);
  void items;
  const isActive = (href: string) => (route.page === 'home' && href === '#/') || href.includes(route.page) || (route.page === 'centinel' && href === '#/vig-ia');
  const item = (href: string, label: string, icon: string, count?: number) => <a key={href} className={isActive(href) ? 'active' : ''} href={href}><span className="nav-item-main"><b>{icon}</b>{label}</span>{typeof count === 'number' ? <em>{count}</em> : null}</a>;
  return <nav>
    <span className="nav-section-label">Comercial</span>
    {item('#/dashboard','Dashboard','⊞')}
    {item('#/alerts','Alertas','!', alertCount)}
    {item('#/opportunities','Oportunidades','≡', opportunityCount)}
    {canViewTenders(currentProfile) ? item('#/tenders','Licitaciones','○', tenderCount) : null}
    <span className="nav-section-label">Inteligencia</span>
    {item('#/vig-ia','Vig-IA','◉')}
    {item('#/new','Crear oportunidad','+')}
    {item('#/goals','Metas y cumplimiento','◇')}
    {canManageUsers(currentProfile) ? <><span className="nav-section-label">Administración</span>{item('#/users','Usuarios y permisos','👤')}</> : null}
  </nav>;
}
function RouterView({ route, data, refresh }: { route: Route; data: Bootstrap; refresh: () => Promise<void> }) {
  if (route.page === 'opportunities') return <OpportunityList data={data} />;
  if (route.page === 'tenders') return <TendersRadar data={data} refresh={refresh} />;
  if (route.page === 'detail' && route.id) return <OpportunityDetail id={route.id} data={data} refresh={refresh} />;
  if (route.page === 'new') return <OpportunityForm data={data} refresh={refresh} />;
  if (route.page === 'edit' && route.id) return <OpportunityForm data={data} id={route.id} refresh={refresh} />;
  if (route.page === 'dashboard') return <ManagerDashboard data={data} />;
  if (route.page === 'consultant' && route.id) return <ConsultantDetail data={data} ownerId={route.id} />;
  if (route.page === 'goals') return <GoalsCompliance data={data} refresh={refresh} />;
  if (route.page === 'alerts') return <CommercialAlerts data={data} />;
  if (route.page === 'centinel') return <CentinelAssistant data={data} />;
  if (route.page === 'users') return <UsersAdmin currentProfile={data.currentProfile} />;
  if (data.currentProfile.role === 'comercial') return <CommercialPersonalDashboard data={data} />;
  return <Home data={data} />;
}
function stageTone(stageCode?: string | null) {
  if (stageCode === 'aprobado') return 'success';
  if (stageCode === 'perdido' || stageCode === 'descartado') return 'danger';
  if (stageCode === 'negociacion' || stageCode === 'sustentacion') return 'amber';
  if (stageCode === 'envio_oferta') return 'purple';
  return 'blue';
}
function Home({ data }: { data: Bootstrap }) {
  const active = data.opportunities.filter(o => !['aprobado','perdido','descartado'].includes(o.stage_code)).length;
  const largestStage = [...data.summary].sort((a,b)=>Number(b.total_offer_value)-Number(a.total_offer_value))[0];
  return <section className="stack dashboard-home">
    <ExecutiveSummary data={data} active={active} largestStage={largestStage} />
    <div className="grid kpis">
      <Kpi icon="◉" tone="blue" label="Oportunidades activas" value={active.toString()} hint={`${data.totals.count} oportunidades en base`} meta="Gestión comercial vigente" />
      <Kpi icon="$" tone="purple" label="Valor total pipeline" value={fmtMoneyCompact(data.totals.pipeline)} hint="Todas las etapas" meta={fmtMoney(data.totals.pipeline)} />
      <Kpi icon="≈" tone="indigo" label="Valor ponderado" value={fmtMoneyCompact(data.totals.weighted)} hint="Probabilidad por etapa" meta={fmtMoney(data.totals.weighted)} />
      <Kpi icon="✓" tone="green" label="Aprobado / ganado" value={fmtMoneyCompact(data.totals.approved)} hint="Ventas aprobadas" meta={fmtMoney(data.totals.approved)} />
      <Kpi icon={data.stalled.length ? '!' : '✓'} tone={data.stalled.length ? 'amber' : 'green'} label="Sustentación estancada" value={data.stalled.length.toString()} hint="Más de 5 días sin gestión" meta={data.stalled.length ? 'Requiere atención' : 'Todo al día'} />
    </div>
    <Panel title="Pipeline por etapa"><StageBars summary={data.summary} /></Panel>
    <div className="grid two dashboard-panels">
      <Panel title="Top oportunidades próximas a cierre"><MiniTable rows={data.topClosing.slice(0, 9)} /></Panel>
      <Panel title="Alertas de sustentación">{data.stalled.length ? <MiniTable rows={data.stalled.slice(0, 9)} /> : <EmptyState title="Todo al día" text="No hay oportunidades en sustentación con más de 5 días sin gestión." />}</Panel>
    </div>
  </section>;
}
function ExecutiveSummary({ data, active, largestStage }: { data: Bootstrap; active: number; largestStage?: SummaryRow }) {
  return <section className="executive-hero">
    <div>
      <span className="eyebrow">Vista ejecutiva comercial</span>
      <h2>Seguimiento de ventas y salud del pipeline</h2>
      <p>Resumen gerencial de oportunidades, valor ponderado, cierres aprobados y alertas operativas para priorizar gestión comercial.</p>
    </div>
    <div className="hero-facts">
      <div><small>Foco actual</small><strong>{active} activas</strong></div>
      <div><small>Etapa dominante</small><strong>{largestStage?.stage_name || '—'}</strong></div>
      <div><small>Base</small><strong>{data.totals.count} registros</strong></div>
    </div>
  </section>;
}
function Kpi({ label, value, hint, tone, icon, meta }: { label: string; value: string; hint: string; tone?: 'warn'|'ok'|'blue'|'purple'|'indigo'|'green'|'amber'; icon?: string; meta?: string }) {
  return <div className={`card kpi ${tone||''}`}>
    <div className="kpi-head"><span className="kpi-icon">{icon || '•'}</span><small>{label}</small></div>
    <strong>{value}</strong>
    <span>{hint}</span>
    {meta && <em>{meta}</em>}
  </div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }
function StageBars({ summary }: { summary: SummaryRow[] }) {
  const max = Math.max(...summary.map(s => Number(s.total_offer_value)), 1);
  const total = summary.reduce((acc, s) => acc + Number(s.total_offer_value || 0), 0) || 1;
  return <div className="bars">{summary.map(s => {
    const pct = Math.round((Number(s.total_offer_value || 0) / total) * 100);
    return <div className={`barrow stage-${stageTone(s.stage_code)}`} key={s.stage_code}>
      <div className="barlabel"><strong>{s.stage_name}</strong><span>{s.opportunities_count} ops · {pct}% del pipeline</span></div>
      <div className="bar"><span style={{ width: `${Math.max(3, (Number(s.total_offer_value)/max)*100)}%` }} /></div>
      <small><b>{fmtMoney(s.total_offer_value)}</b><br/>{fmtMoney(s.weighted_pipeline_value)} ponderado</small>
    </div>;
  })}</div>;
}
function ServicePipelineBreakdown({ rows }: { rows: Array<{ key: string; label: string; count: number; value: number; weighted: number; share: number }> }) {
  if (!rows.length) return <EmptyState title="Sin pipeline activo" text="No hay oportunidades activas para agrupar por servicio." />;
  const max = Math.max(...rows.map(r => r.value), 1);
  return <div className="service-pipeline-list">{rows.map(row => <div className="service-pipeline-row" key={row.key}>
    <div className="service-pipeline-label"><strong>{row.label}</strong><span>{row.count} oportunidades activas · {row.share}% del pipeline activo por servicio</span></div>
    <div className="service-pipeline-track"><span style={{ width: `${Math.max(4, row.value / max * 100)}%` }} /></div>
    <div className="service-pipeline-meta"><strong>{fmtMoneyCompact(row.value)}</strong><span>{fmtMoneyCompact(row.weighted)} forecast</span></div>
  </div>)}</div>;
}
function MiniTable({ rows, empty = 'Sin registros' }: { rows: Opportunity[]; empty?: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return <table className="mini-table"><tbody>{rows.map(o => <tr key={o.id} onClick={() => go(`#/detail/${o.id}`)} className="clickable"><td><strong>{o.company_name}</strong><br/><small>{o.owner_name || 'Sin comercial'} · <Badge tone={stageTone(o.stage_code)}>{o.stage_name}</Badge></small></td><td>{fmtMoney(o.offer_value)}</td></tr>)}</tbody></table>;
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div>✓</div><strong>{title}</strong><p>{text}</p></div>;
}

type SortDirection = 'asc' | 'desc';
type SortConfig<K extends string> = { key: K; direction: SortDirection };
function compareSortValues(a: string | number | null | undefined, b: string | number | null | undefined, direction: SortDirection) {
  const emptyA = a === null || a === undefined || a === '';
  const emptyB = b === null || b === undefined || b === '';
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  const result = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'es', { sensitivity: 'base', numeric: true });
  return direction === 'asc' ? result : -result;
}
function SortableTh<K extends string>({ label, sortKey, sortConfig, onSort }: { label: string; sortKey: K; sortConfig: SortConfig<K>; onSort: (key: K) => void }) {
  const active = sortConfig.key === sortKey;
  return <th aria-sort={active ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className={`sortable-th ${active ? 'active' : ''}`} onClick={() => onSort(sortKey)} title={`Ordenar por ${label}`}>{label}<span className="sort-indicator">{active ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
}
function nextSort<K extends string>(current: SortConfig<K>, key: K): SortConfig<K> { return current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }; }
function sortTenderCards(rows: PublicTender[], tenderSortKey: TenderSortKey, tenderSortDirection: SortDirection) {
  const tenderSortValue = (t: PublicTender): string | number => {
    if (tenderSortKey === 'value') return Number(t.value || 0);
    if (tenderSortKey === 'score') return Number(t.score || 0);
    if (tenderSortKey === 'entity') return t.entity || '';
    if (tenderSortKey === 'source') return t.source || '';
    return t.deadline || '';
  };
  return [...rows].sort((a, b) => compareSortValues(tenderSortValue(a), tenderSortValue(b), tenderSortDirection));
}

function OpportunityList({ data }: { data: Bootstrap }) {
  const [q, setQ] = useState(hashQueryParam('q')); const [owner, setOwner] = useState(hashQueryParam('owner')); const [regional, setRegional] = useState(hashQueryParam('regional')); const [stage, setStage] = useState(hashQueryParam('stage')); const [service, setService] = useState(hashQueryParam('service')); const [onlyActive, setOnlyActive] = useState(hashQueryParam('active') !== 'all');
  const [sortConfig, setSortConfig] = useState<SortConfig<'client'|'owner'|'regional'|'stage'|'product'|'segment'|'value'|'close'|'last'>>({ key: 'client', direction: 'asc' });
  const regionals = useMemo(() => uniq(data.opportunities.map(o => o.regional_nombre)), [data.opportunities]);
  const filtered = data.opportunities.filter(o => (!q || `${o.company_name} ${o.owner_name||''} ${o.sede||''} ${o.quote_city||''} ${o.regional_nombre||''} ${o.tipo_producto_original||''} ${o.service_type_name||''} ${o.legacy_excel_id||''}`.toLowerCase().includes(q.toLowerCase())) && (!owner || o.owner_id===owner) && (!regional || o.regional_nombre===regional) && (!stage || o.stage_code===stage) && (!service || o.service_type_code===service) && (!onlyActive || !isTerminalStage(o.stage_code)));
  const sortedOpportunities = [...filtered].sort((a,b) => {
    const value = (o: Opportunity) => sortConfig.key === 'client' ? o.company_name : sortConfig.key === 'owner' ? (o.owner_name || '') : sortConfig.key === 'regional' ? (o.regional_nombre || '') : sortConfig.key === 'stage' ? (o.stage_order || 0) : sortConfig.key === 'product' ? (o.tipo_producto_original || o.service_type_name || '') : sortConfig.key === 'segment' ? customerSegmentLabel(o.customer_segment) : sortConfig.key === 'value' ? Number(o.offer_value || 0) : sortConfig.key === 'close' ? (o.expected_close_date || '') : (o.last_interaction_at || '');
    return compareSortValues(value(a), value(b), sortConfig.direction);
  });
  const sortBy = (key: typeof sortConfig.key) => setSortConfig(current => nextSort(current, key));
  return <section className="stack">
    <div className="filters opportunity-filters"><input placeholder="Buscar cliente, sede, ciudad, servicio o ID…" value={q} onChange={e=>setQ(e.target.value)} /> <Select value={owner} onChange={setOwner} options={data.profiles.map(p=>[p.id,p.full_name])} empty="Todos los comerciales"/> <Select value={regional} onChange={setRegional} options={regionals.map(r=>[r,r])} empty="Todas las regionales"/> <Select value={stage} onChange={setStage} options={data.stages.map(s=>[s.code,s.name])} empty="Todas las etapas"/> <Select value={service} onChange={setService} options={data.services.map(s=>[s.code,s.name])} empty="Todos los servicios"/><label className="check-filter"><input type="checkbox" checked={onlyActive} onChange={e=>setOnlyActive(e.target.checked)} /> Solo activas</label><button className="secondary" onClick={()=>{ setQ(''); setOwner(''); setRegional(''); setStage(''); setService(''); setOnlyActive(true); }}>Limpiar filtros</button></div>
    <p className="muted filter-summary"><strong>{filtered.length}</strong> de {data.opportunities.length} oportunidades visibles.</p>
    <div className="tablewrap"><table><thead><tr><SortableTh label="Cliente" sortKey="client" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Comercial" sortKey="owner" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Regional" sortKey="regional" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Etapa" sortKey="stage" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Tipo producto" sortKey="product" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Tipo cliente" sortKey="segment" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Valor" sortKey="value" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Cierre estimado" sortKey="close" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Último seguimiento" sortKey="last" sortConfig={sortConfig} onSort={sortBy}/></tr></thead><tbody>{sortedOpportunities.map(o => <tr key={o.id} className="clickable" onClick={() => go(`#/detail/${o.id}`)}><td><strong>{o.company_name}</strong><br/><small>{o.sede || o.quote_city || '—'}</small></td><td>{o.owner_name || '—'}</td><td>{o.regional_nombre || '—'}</td><td><Badge>{o.stage_name}</Badge></td><td>{o.tipo_producto_original || o.service_type_name || '—'}</td><td><Badge tone={o.customer_segment ? 'blue' : 'amber'}>{customerSegmentLabel(o.customer_segment)}</Badge></td><td>{fmtMoney(o.offer_value)}</td><td>{fmtDate(o.expected_close_date)}</td><td>{fmtDate(o.last_interaction_at)}</td></tr>)}</tbody></table></div>
  </section>;
}
function findTenderOwner(data: Bootstrap) {
  return data.profiles.find(p => p.microsoft_email?.toLowerCase() === 'directora.licitaciones@seguridadnacional.co') || data.currentProfile;
}
function buildTenderOpportunityPayload(tender: PublicTender, data: Bootstrap): OpportunityPayload {
  const owner = findTenderOwner(data);
  const notes = [
    `Origen: ${tender.source} / Radar Licitaciones`,
    `Referencia: ${tender.ref || tender.process_id || '—'}`,
    `Objeto: ${tender.title}`,
    `Entidad: ${tender.entity}`,
    `Ubicación: ${tender.city || tender.dept || '—'}`,
    `Score radar: ${tender.score}`,
    `Razones: ${tender.reasons.join(', ') || '—'}`,
    tender.url ? `Link fuente: ${tender.url}` : '',
  ].filter(Boolean).join('\n');
  return {
    company_name: tender.entity,
    owner_id: owner.id,
    stage_code: 'prospecto',
    service_type_code: 'licitacion_publica',
    offer_value: tender.value || 0,
    expected_close_date: tender.deadline || '',
    quote_city: tender.city || tender.dept || '',
    regional_nombre: tender.dept || '',
    sede: tender.ref || tender.process_id || '',
    economic_sector: 'Sector público',
    tipo_producto_original: 'Licitación Pública',
    observaciones: notes,
    external_source: `secop_radar:${tender.source}`,
  };
}
function tenderStatusLabel(status?: TenderInternalStatus) {
  if (status === 'en_revision') return 'En revisión';
  if (status === 'descartada') return 'Descartada';
  if (status === 'convertida_oportunidad') return 'Convertida';
  return 'Nueva';
}
function tenderStatusTone(status?: TenderInternalStatus) {
  if (status === 'convertida_oportunidad') return 'success';
  if (status === 'descartada') return 'danger';
  if (status === 'en_revision') return 'amber';
  return 'blue';
}
function tenderDeadlineBucket(tender: PublicTender): TenderDeadlineFilter | '31_plus' {
  if (!tender.deadline) return 'sin_fecha';
  const target = new Date(tender.deadline);
  target.setHours(0,0,0,0);
  const today = new Date();
  today.setHours(0,0,0,0);
  const days = Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return 'vencida';
  if (days <= 7) return '0_7';
  if (days <= 15) return '8_15';
  if (days <= 30) return '16_30';
  return '31_plus';
}
function tenderDeadlineTone(tender: PublicTender) {
  const bucket = tenderDeadlineBucket(tender);
  if (bucket === 'vencida') return 'danger';
  if (bucket === '0_7') return 'amber';
  if (bucket === '8_15') return 'blue';
  if (bucket === 'sin_fecha') return 'muted';
  return 'success';
}
function tenderDeadlineClass(tender: PublicTender) {
  const bucket = tenderDeadlineBucket(tender);
  if (bucket === 'vencida') return 'tender-deadline-overdue';
  if (bucket === '0_7') return 'tender-deadline-urgent';
  if (bucket === '8_15' || bucket === '16_30') return 'tender-deadline-soon';
  if (bucket === 'sin_fecha') return 'tender-deadline-empty';
  return 'tender-deadline-ok';
}
function isTenderPrioritizable(tender: PublicTender) {
  const status = tender.internal_status || 'nueva';
  return status !== 'descartada' && status !== 'convertida_oportunidad';
}
function tenderSourceTone(source?: string) {
  const s = (source || '').toLowerCase();
  if (s.includes('esu')) return 'purple';
  if (s.includes('tvec')) return 'green';
  if (s.includes('ii')) return 'blue';
  return 'amber';
}
function scoreLabel(score?: number) {
  const value = Number(score || 0);
  if (value >= 70) return 'Alto';
  if (value >= 40) return 'Medio';
  return 'Bajo / validar';
}
function TendersRadar({ data, refresh }: { data: Bootstrap; refresh: () => Promise<void> }) {
  const currentProfile = data.currentProfile;
  const [payload, setPayload] = useState<TenderRadarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [section, setSection] = useState<TenderSection | 'todas'>('hacer');
  const [internalStatus, setInternalStatus] = useState<TenderInternalStatus | 'todas'>('todas');
  const [q, setQ] = useState('');
  const [quickFilter, setQuickFilter] = useState<TenderQuickFilter>(null);
  const [fastFilter, setFastFilter] = useState<TenderFastFilter>(null);
  const [sourceFilter, setSourceFilter] = useState('todas');
  const [deadlineFilter, setDeadlineFilter] = useState<TenderDeadlineFilter>('todas');
  const [valueFilter, setValueFilter] = useState<TenderValueFilter>('todas');
  const [scoreFilter, setScoreFilter] = useState<TenderScoreFilter>('todas');
  const [tenderSortKey, setTenderSortKey] = useState<TenderSortKey>('deadline');
  const [tenderSortDirection, setTenderSortDirection] = useState<SortDirection>('asc');
  const focusTenderId = hashQueryParam('tender');
  const load = async () => {
    setLoading(true); setError(null);
    try { setPayload(await api<TenderRadarPayload>('/api/tenders')); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  };
  const refreshRadar = async () => {
    setSyncing(true); setError(null);
    try { setPayload(await api<TenderRadarPayload>('/api/tender-refresh', { method: 'POST' })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSyncing(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!focusTenderId || !payload) return;
    const focused = payload.tenders.find(t => t.id === focusTenderId);
    if (!focused) return;
    setSection(focused.section);
    setInternalStatus('todas');
    setQ('');
    setQuickFilter(null);
    setFastFilter(null);
    setSourceFilter('todas');
    setDeadlineFilter('todas');
    setValueFilter('todas');
    setScoreFilter('todas');
    window.setTimeout(() => document.getElementById(`tender-${focusTenderId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, [focusTenderId, payload]);
  if (!canViewTenders(currentProfile)) return <div className="error">Solo dirección o licitaciones puede ver este radar.</div>;
  if (loading) return <div className="notice">Cargando radar de licitaciones…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!payload) return <EmptyState title="Sin datos" text="No se pudo cargar el radar de licitaciones." />;
  const clearTenderFilters = () => { setQuickFilter(null); setFastFilter(null); setSection('todas'); setInternalStatus('todas'); setSourceFilter('todas'); setDeadlineFilter('todas'); setValueFilter('todas'); setScoreFilter('todas'); setQ(''); };
  const applyTenderQuickFilter = (filter: TenderQuickFilter) => {
    setQuickFilter(current => current === filter ? null : filter);
    setFastFilter(null);
    setQ('');
    if (filter === 'hacer') { setSection('hacer'); setInternalStatus('todas'); setValueFilter('todas'); }
    if (filter === 'en_revision') { setSection('todas'); setInternalStatus('en_revision'); setValueFilter('todas'); }
    if (filter === 'high_value') { setSection('todas'); setInternalStatus('todas'); setValueFilter('500m_plus'); }
    if (filter === 'convertidas') { setSection('todas'); setInternalStatus('convertida_oportunidad'); setValueFilter('todas'); }
  };
  const applyTenderFastFilter = (filter: TenderFastFilter) => {
    const isClearing = fastFilter === filter;
    setFastFilter(isClearing ? null : filter);
    setQuickFilter(null);
    setQ('');
    setSection('todas');
    setInternalStatus('todas');
    setDeadlineFilter('todas');
    setValueFilter('todas');
    setScoreFilter('todas');
    if (isClearing || !filter) return;
    const config = tenderFastFilterConfig[filter];
    if (config?.section) setSection(config.section);
    if (config?.internalStatus) setInternalStatus(config.internalStatus);
    if (config?.deadlineFilter) setDeadlineFilter(config.deadlineFilter);
    if (config?.valueFilter) setValueFilter(config.valueFilter);
    if (config?.scoreFilter) setScoreFilter(config.scoreFilter);
  };
  const markTenderStatus = async (tender: PublicTender, status: TenderInternalStatus) => {
    setCreatingId(tender.id); setError(null);
    try {
      const updated = await api<PublicTender>(`/api/tender-status?id=${encodeURIComponent(tender.id)}`, { method: 'PATCH', body: JSON.stringify({ internal_status: status }) });
      setPayload(current => current ? { ...current, tenders: current.tenders.map(t => t.id === tender.id ? { ...t, ...updated } : t) } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingId(null);
    }
  };
  const createOpportunityFromTender = async (tender: PublicTender) => {
    if (tender.converted_opportunity_id) { go(`#/detail/${tender.converted_opportunity_id}`); return; }
    const owner = findTenderOwner(data);
    const ok = window.confirm(`¿Crear oportunidad para ${tender.entity} y asignarla a ${owner.full_name}?`);
    if (!ok) return;
    setCreatingId(tender.id); setError(null);
    try {
      const saved = await api<{id:string}>('/api/tender-convert', { method: 'POST', body: JSON.stringify({ tender }) });
      setPayload(current => current ? { ...current, tenders: current.tenders.map(t => t.id === tender.id ? { ...t, internal_status: 'convertida_oportunidad', converted_opportunity_id: saved.id } : t) } : current);
      await refresh();
      go(`#/detail/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingId(null);
    }
  };
  const sourceOptions = Array.from(new Set([...TENDER_OFFICIAL_SOURCES, ...payload.tenders.map(t => t.source).filter(Boolean)])).sort((a,b) => a.localeCompare(b)).map(s => [s, s]);
  const tenderFastFilterConfig: Record<Exclude<TenderFastFilter, null>, { label: string; section?: TenderSection | 'todas'; internalStatus?: TenderInternalStatus | 'todas'; deadlineFilter?: TenderDeadlineFilter; valueFilter?: TenderValueFilter; scoreFilter?: TenderScoreFilter }> = {
    hacer: { label: 'Hacer hoy', section: 'hacer' },
    revisar: { label: 'Revisar', section: 'revisar' },
    nuevas: { label: 'Nuevas', internalStatus: 'nueva' },
    urgentes: { label: 'Urgentes', deadlineFilter: '0_7' },
    alto_valor: { label: 'Alto valor', valueFilter: '500m_plus' },
    alto_encaje: { label: 'Alto encaje', scoreFilter: 'alto' },
  };
  const primaryTenderFilter: TenderPrimaryFilter = fastFilter || (section !== 'todas' ? section : 'todas');
  const applyPrimaryTenderFilter = (filter: TenderPrimaryFilter) => {
    setQuickFilter(null);
    setFastFilter(null);
    setSection('todas');
    setInternalStatus('todas');
    setDeadlineFilter('todas');
    setValueFilter('todas');
    setScoreFilter('todas');
    if (filter === 'todas') return;
    if (filter === 'hacer' || filter === 'revisar' || filter === 'descartar') { setSection(filter); return; }
    setFastFilter(filter);
    const config = tenderFastFilterConfig[filter];
    if (config?.section) setSection(config.section);
    if (config?.internalStatus) setInternalStatus(config.internalStatus);
    if (config?.deadlineFilter) setDeadlineFilter(config.deadlineFilter);
    if (config?.valueFilter) setValueFilter(config.valueFilter);
    if (config?.scoreFilter) setScoreFilter(config.scoreFilter);
  };
  const applyTenderSortPreset = (preset: string) => {
    const [key, direction] = preset.split(':') as [TenderSortKey, SortDirection];
    setTenderSortKey(key);
    setTenderSortDirection(direction);
  };
  const rows = payload.tenders.filter(t => {
    const status = t.internal_status || 'nueva';
    const value = Number(t.value || 0);
    const score = Number(t.score || 0);
    const deadlineBucket = tenderDeadlineBucket(t);
    const prioritizable = isTenderPrioritizable(t);
    const priorityFilterActive = quickFilter === 'hacer' || quickFilter === 'high_value' || fastFilter === 'hacer' || fastFilter === 'revisar' || fastFilter === 'urgentes' || fastFilter === 'alto_valor' || fastFilter === 'alto_encaje';
    const matchesQuick = !quickFilter || (quickFilter === 'hacer' && prioritizable && t.section === 'hacer') || (quickFilter === 'en_revision' && status === 'en_revision') || (quickFilter === 'high_value' && prioritizable && value >= 500_000_000) || (quickFilter === 'convertidas' && status === 'convertida_oportunidad');
    const matchesValue = valueFilter === 'todas' || (valueFilter === 'sin_valor' && value <= 0) || (valueFilter === 'lt_50m' && value > 0 && value < 50_000_000) || (valueFilter === '50m_500m' && value >= 50_000_000 && value < 500_000_000) || (valueFilter === '500m_plus' && value >= 500_000_000) || (valueFilter === '1000m_plus' && value >= 1_000_000_000);
    const matchesScore = scoreFilter === 'todas' || (scoreFilter === 'alto' && score >= 70) || (scoreFilter === 'medio' && score >= 40 && score < 70) || (scoreFilter === 'bajo' && score < 40);
    return (!priorityFilterActive || prioritizable) && matchesQuick && (section === 'todas' || t.section === section) && (internalStatus === 'todas' || status === internalStatus) && (sourceFilter === 'todas' || t.source === sourceFilter) && (deadlineFilter === 'todas' || deadlineBucket === deadlineFilter) && matchesValue && matchesScore && (!q || `${t.entity} ${t.city||''} ${t.dept||''} ${t.title} ${t.ref||''} ${t.source}`.toLowerCase().includes(q.toLowerCase()));
  });
  const sortedRows = sortTenderCards(rows, tenderSortKey, tenderSortDirection);
  const activeTenderFilterChips = [
    quickFilter ? { key: 'quick', label: quickFilter === 'hacer' ? 'KPI: Hacer hoy' : quickFilter === 'en_revision' ? 'KPI: En revisión' : quickFilter === 'high_value' ? 'KPI: Alto valor' : 'KPI: Convertidas', clear: () => setQuickFilter(null) } : null,
    fastFilter ? { key: 'fast', label: `Rápido: ${tenderFastFilterConfig[fastFilter].label}`, clear: () => setFastFilter(null) } : null,
    section !== 'todas' ? { key: 'section', label: `Sección: ${section === 'hacer' ? 'Hacer hoy' : section === 'revisar' ? 'Revisar' : 'Descartar'}`, clear: () => setSection('todas') } : null,
    internalStatus !== 'todas' ? { key: 'status', label: `Estado: ${tenderStatusLabel(internalStatus)}`, clear: () => setInternalStatus('todas') } : null,
    sourceFilter !== 'todas' ? { key: 'source', label: `Fuente: ${sourceFilter}`, clear: () => setSourceFilter('todas') } : null,
    deadlineFilter !== 'todas' ? { key: 'deadline', label: `Cierre: ${deadlineFilter === '0_7' ? '0-7 días' : deadlineFilter === '8_15' ? '8-15 días' : deadlineFilter === '16_30' ? '16-30 días' : deadlineFilter === 'vencida' ? 'Vencida' : 'Sin fecha'}`, clear: () => setDeadlineFilter('todas') } : null,
    valueFilter !== 'todas' ? { key: 'value', label: `Valor: ${valueFilter === 'sin_valor' ? 'Sin valor' : valueFilter === 'lt_50m' ? '<$50M' : valueFilter === '50m_500m' ? '$50M-$500M' : valueFilter === '500m_plus' ? '$500M+' : '$1.000M+'}`, clear: () => setValueFilter('todas') } : null,
    scoreFilter !== 'todas' ? { key: 'score', label: `Encaje: ${scoreFilter === 'alto' ? 'Alto' : scoreFilter === 'medio' ? 'Medio' : 'Bajo/validar'}`, clear: () => setScoreFilter('todas') } : null,
    q ? { key: 'q', label: `Búsqueda: ${q}`, clear: () => setQ('') } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;
  const diagnosticAlerts = (payload.diagnostics || []).filter(d => d.status === 'error' || /bloqueo|error|no disponible/i.test(d.message || d.status || ''));
  const diagnosticsLabel = payload.diagnostics?.length ? `${payload.diagnostics.length - diagnosticAlerts.length} fuente(s) OK · ${diagnosticAlerts.length} alerta(s)` : 'Sin diagnóstico reciente';
  return <section className="stack tenders-page">
    <section className="executive-hero">
      <div><span className="eyebrow">Radar de Licitaciones Públicas</span><h2>Licitaciones</h2><p>Procesos públicos y eventos TVEC priorizados, historizados y accionables: Katherine puede revisar, descartar o convertir a oportunidad sin duplicar.</p></div>
      <div className="hero-facts"><div><small>Actualización</small><strong>{fmtDate(payload.generatedAt)}</strong></div><div><small>Fuente</small><strong>{payload.source === 'supabase' ? 'Supabase' : 'Fuentes vivas'}</strong></div></div>
    </section>
    <div className="grid kpis tender-kpi-grid">
      <button className={`card kpi tender-kpi-filter ${quickFilter === 'hacer' ? 'active' : ''}`} onClick={() => applyTenderQuickFilter('hacer')}><Kpi icon="!" tone="amber" label="Hacer hoy" value={payload.totals.hacer.toString()} hint="Revisión prioritaria" meta="Ver procesos prioritarios" /></button>
      <button className={`card kpi tender-kpi-filter ${quickFilter === 'en_revision' ? 'active' : ''}`} onClick={() => applyTenderQuickFilter('en_revision')}><Kpi icon="↗" tone="blue" label="En revisión" value={(payload.totals.enRevision || 0).toString()} hint="Marcadas por equipo" meta="Ver estado interno" /></button>
      <button className={`card kpi tender-kpi-filter ${quickFilter === 'high_value' ? 'active' : ''}`} onClick={() => applyTenderQuickFilter('high_value')}><Kpi icon="$" tone="purple" label="Alto valor" value={payload.totals.highValue.toString()} hint="$500M+ COP" meta="Ver procesos $500M+" /></button>
      <button className={`card kpi tender-kpi-filter ${quickFilter === 'convertidas' ? 'active' : ''}`} onClick={() => applyTenderQuickFilter('convertidas')}><Kpi icon="✓" tone="green" label="Convertidas" value={(payload.totals.convertidas || 0).toString()} hint="Ya son oportunidades" meta="Ver convertidas" /></button>
    </div>
    <section className="tender-control-panel" aria-label="Controles de licitaciones">
      <div className="tender-control-top">
        <input className="tender-search-input" placeholder="Buscar entidad, ciudad, objeto, fuente o referencia…" value={q} onChange={e=>setQ(e.target.value)} />
        <div className="tender-control-actions"><button className="secondary" onClick={load}>Recargar vista</button><button onClick={refreshRadar} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar fuentes oficiales'}</button></div>
      </div>
      <div className="tender-control-section">
        <span className="filter-label">Vistas rápidas</span>
        <div className="tender-fast-filters" aria-label="Filtros rápidos de licitaciones">
          {(Object.entries(tenderFastFilterConfig) as Array<[Exclude<TenderFastFilter, null>, { label: string }]>).map(([key, config]) => <button key={key} className={fastFilter === key ? 'active' : ''} onClick={() => applyTenderFastFilter(key)}>{config.label}</button>)}
        </div>
      </div>
      <div className="filters tender-refine-filters"><span className="filter-label">Refinar resultados</span><label className="tender-filter-field"><span>Prioridad</span><Select value={primaryTenderFilter} onChange={v=>applyPrimaryTenderFilter(v as TenderPrimaryFilter)} options={[["todas","Todas"],["hacer","Hacer hoy"],["revisar","Revisar"],["descartar","Descartar / validar"],["nuevas","Nuevas"],["urgentes","Urgentes"],["alto_valor","Alto valor"],["alto_encaje","Alto encaje"]]} empty=""/></label><label className="tender-filter-field"><span>Estado interno</span><Select value={internalStatus} onChange={v=>{ setInternalStatus(v as TenderInternalStatus | 'todas'); setQuickFilter(null); setFastFilter(null); }} options={[["todas","Todas"],["nueva","Nueva"],["en_revision","En revisión"],["descartada","Descartada"],["convertida_oportunidad","Convertida"]]} empty=""/></label><label className="tender-filter-field"><span>Fuente</span><Select value={sourceFilter} onChange={setSourceFilter} options={[["todas","Todas"], ...sourceOptions]} empty=""/></label><label className="tender-filter-field"><span>Cierre</span><Select value={deadlineFilter} onChange={v=>setDeadlineFilter(v as TenderDeadlineFilter)} options={[["todas","Todas"],["0_7","0-7 días"],["8_15","8-15 días"],["16_30","16-30 días"],["vencida","Vencida"],["sin_fecha","Sin fecha"]]} empty=""/></label><label className="tender-filter-field"><span>Valor</span><Select value={valueFilter} onChange={v=>setValueFilter(v as TenderValueFilter)} options={[["todas","Todas"],["sin_valor","Sin valor"],["lt_50m","<$50M"],["50m_500m","$50M-$500M"],["500m_plus","$500M+"],["1000m_plus","$1.000M+"]]} empty=""/></label><label className="tender-filter-field"><span>Encaje</span><Select value={scoreFilter} onChange={v=>setScoreFilter(v as TenderScoreFilter)} options={[["todas","Todas"],["alto","Alto"],["medio","Medio"],["bajo","Bajo / validar"]]} empty=""/></label><button className="secondary" onClick={clearTenderFilters}>Limpiar filtros</button></div>
    </section>
    <div className="tender-results-toolbar">
      <div className="filter-summary"><strong>{rows.length}</strong><span>de {payload.tenders.length} procesos</span>{activeTenderFilterChips.length ? <div className="filter-chips">{activeTenderFilterChips.map(chip => <button className="filter-chip" key={chip.key} onClick={chip.clear}>{chip.label} ×</button>)}</div> : <span className="muted">Sin filtros activos</span>}</div>
      <div className="filters tender-sort-controls"><span className="filter-label">Orden</span><Select value={`${tenderSortKey}:${tenderSortDirection}`} onChange={applyTenderSortPreset} options={[["deadline:asc","Cierre más próximo"],["deadline:desc","Cierre más lejano"],["value:desc","Mayor valor primero"],["value:asc","Menor valor primero"],["score:desc","Score alto primero"],["score:asc","Score bajo primero"],["entity:asc","Entidad A-Z"],["entity:desc","Entidad Z-A"],["source:asc","Fuente A-Z"]]} empty="Ordenar por"/></div>
    </div>
    <details className="tender-help-panel">
      <summary>Estado de fuentes y ayuda · {diagnosticsLabel}</summary>
      <p className="muted action-explainer">Recargar vista actualiza los datos guardados en el CRM. Sincronizar fuentes oficiales consulta SECOP I, SECOP II, TVEC y ESU Contratación, persiste novedades y puede tardar más.</p>
      {payload.diagnostics?.length ? <div className="tender-diagnostics"><strong>Diagnóstico de fuentes:</strong> {payload.diagnostics.map(d => `${d.source}: ${d.message || d.status}`).join(' · ')}</div> : null}
      <p className="muted tender-classification-note"><strong>Cómo leer la bandeja:</strong> “Hacer hoy” prioriza procesos con mejor encaje, valor o urgencia; “Revisar” reúne señales útiles que requieren validación; “Descartar” conserva trazabilidad de falsos positivos o bajo encaje.</p>
    </details>
    <TenderUnifiedBoard rows={sortedRows} focusTenderId={focusTenderId} onCreate={createOpportunityFromTender} onStatus={markTenderStatus} creatingId={creatingId} />
  </section>;
}
function TenderUnifiedBoard({ rows, focusTenderId, onCreate, onStatus, creatingId }: { rows: PublicTender[]; focusTenderId?: string; onCreate: (tender: PublicTender) => void; onStatus: (tender: PublicTender, status: TenderInternalStatus) => void; creatingId: string | null }) {
  return <Panel title="Vista unificada de licitaciones">{rows.length ? <div className="tender-cards">{rows.map(t => <TenderCard key={t.id} tender={t} focused={focusTenderId === t.id} onCreate={onCreate} onStatus={onStatus} creating={creatingId === t.id} />)}</div> : <EmptyState title="Sin licitaciones" text="No hay procesos con los filtros actuales." />}</Panel>;
}
function TenderSectionPanel({ title, rows, show, focusTenderId, onCreate, onStatus, creatingId }: { title: string; rows: PublicTender[]; show: boolean; focusTenderId?: string; onCreate: (tender: PublicTender) => void; onStatus: (tender: PublicTender, status: TenderInternalStatus) => void; creatingId: string | null }) {
  if (!show) return null;
  return <Panel title={title}>{rows.length ? <div className="tender-cards">{rows.map(t => <TenderCard key={t.id} tender={t} focused={focusTenderId === t.id} onCreate={onCreate} onStatus={onStatus} creating={creatingId === t.id} />)}</div> : <EmptyState title="Sin licitaciones" text="No hay procesos en esta sección con los filtros actuales." />}</Panel>;
}
function TenderCard({ tender, focused, onCreate, onStatus, creating }: { tender: PublicTender; focused?: boolean; onCreate: (tender: PublicTender) => void; onStatus: (tender: PublicTender, status: TenderInternalStatus) => void; creating: boolean }) {
  const converted = Boolean(tender.converted_opportunity_id);
  const score = Math.max(0, Math.min(100, Number(tender.score || 0)));
  const scoreTone = score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
  const deadlineBucket = tenderDeadlineBucket(tender);
  const deadlineLabel = deadlineBucket === '0_7' ? '0–7 días' : deadlineBucket === '8_15' ? '8–15 días' : deadlineBucket === '16_30' ? '16–30 días' : deadlineBucket === 'vencida' ? 'Vencida' : deadlineBucket === 'sin_fecha' ? 'Sin fecha' : '30+ días';
  return <article id={`tender-${tender.id}`} className={`card tender-card lic-card tender-${tender.section} ${focused ? 'tender-highlight' : ''}`}>
    <div className="tender-head">
      <div className="tender-card-main">
        <div className="tender-card-kickers"><Badge tone={tenderSourceTone(tender.source)}><span className="tender-source-badge">{tender.source}</span></Badge><Badge tone={tenderDeadlineTone(tender)}><span className={`tender-deadline-pill ${tenderDeadlineClass(tender)}`}>{deadlineLabel}</span></Badge><Badge tone={scoreTone === 'high' ? 'success' : scoreTone === 'mid' ? 'amber' : 'danger'}>{scoreLabel(tender.score).replace(' / validar','')}</Badge></div>
        <h3>{tender.entity} — {tender.city || tender.dept || 'Sin ciudad'}</h3>
      </div>
      <div className={`tender-score-ring score-${scoreTone}`} aria-label={`Score ${score}`}>
        <svg className="score-ring-svg" viewBox="0 0 44 44"><circle className="score-ring-bg" cx="22" cy="22" r="18"/><circle className="score-ring-progress" cx="22" cy="22" r="18" pathLength="100" style={{ strokeDasharray: `${score} 100` }} /></svg>
        <strong>{score}</strong><span>SCORE</span>
      </div>
    </div>
    <p>{tender.title}</p>
    <div className="tender-meta lic-metrics"><span><b>{fmtMoneyCompact(tender.value)}</b><small>{fmtMoney(tender.value)}</small></span><span>Ref: {tender.ref || tender.process_id || '—'}</span><span className={tenderDeadlineClass(tender)}>◷ {fmtTenderDeadline(tender.deadline)}</span></div>
    <small className="muted">{tender.reasons.slice(0,4).join(' · ')}</small>
    {tender.risks.length > 0 && <small className="muted">Riesgos: {tender.risks.slice(0,2).join(' · ')}</small>}
    <div className="row-actions tender-card-actions">{tender.url && <a className="button secondary" target="_blank" href={tender.url}>Abrir fuente</a>}<button className="secondary" onClick={() => onStatus(tender, 'en_revision')} disabled={creating || converted}>Marcar en revisión</button><button className="secondary" onClick={() => window.confirm('¿Descartar esta licitación?') && onStatus(tender, 'descartada')} disabled={creating || converted}>Descartar</button><button onClick={() => onCreate(tender)} disabled={creating}>{creating ? 'Creando…' : converted ? 'Ver oportunidad' : 'Crear oportunidad'}</button></div>
  </article>;
}
function TenderTable({ rows, focusTenderId, onCreate, onStatus, creatingId }: { rows: PublicTender[]; focusTenderId?: string; onCreate: (tender: PublicTender) => void; onStatus: (tender: PublicTender, status: TenderInternalStatus) => void; creatingId: string | null }) {
  const [tenderSortConfig, setTenderSortConfig] = useState<SortConfig<'entity'|'section'|'status'|'location'|'title'|'value'|'deadline'|'source'|'score'>>({ key: 'deadline', direction: 'asc' });
  const sortedTenderRows = [...rows].sort((a,b) => {
    const value = (t: PublicTender) => tenderSortConfig.key === 'entity' ? t.entity : tenderSortConfig.key === 'section' ? t.section : tenderSortConfig.key === 'status' ? tenderStatusLabel(t.internal_status) : tenderSortConfig.key === 'location' ? `${t.dept || ''} ${t.city || ''}` : tenderSortConfig.key === 'title' ? t.title : tenderSortConfig.key === 'value' ? Number(t.value || 0) : tenderSortConfig.key === 'source' ? t.source : tenderSortConfig.key === 'score' ? Number(t.score || 0) : (t.deadline || '');
    return compareSortValues(value(a), value(b), tenderSortConfig.direction);
  });
  const sortTenderBy = (key: typeof tenderSortConfig.key) => setTenderSortConfig(current => nextSort(current, key));
  if (!rows.length) return <EmptyState title="Sin resultados" text="No hay licitaciones con esos filtros." />;
  return <div className="tablewrap"><table><thead><tr><SortableTh label="Entidad" sortKey="entity" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><SortableTh label="Fuente" sortKey="source" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><SortableTh label="Sección" sortKey="section" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><SortableTh label="Estado interno" sortKey="status" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><SortableTh label="Ubicación" sortKey="location" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><SortableTh label="Objeto" sortKey="title" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><SortableTh label="Valor" sortKey="value" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><SortableTh label="Cierre" sortKey="deadline" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><SortableTh label="Score" sortKey="score" sortConfig={tenderSortConfig} onSort={sortTenderBy}/><th>Acción</th></tr></thead><tbody>{sortedTenderRows.map(t => { const converted = Boolean(t.converted_opportunity_id); return <tr id={`tender-${t.id}`} className={focusTenderId === t.id ? 'tender-highlight' : ''} key={t.id}><td><strong>{t.entity}</strong><br/><small>{t.ref || t.process_id || '—'}</small></td><td><Badge tone={tenderSourceTone(t.source)}><span className="tender-source-badge">{t.source}</span></Badge></td><td><Badge>{t.section}</Badge></td><td><Badge tone={tenderStatusTone(t.internal_status)}>{tenderStatusLabel(t.internal_status)}</Badge></td><td>{t.dept || '—'} / {t.city || '—'}</td><td>{t.title}</td><td><strong>{fmtMoneyCompact(t.value)}</strong><br/><small>{fmtMoney(t.value)}</small></td><td><Badge tone={tenderDeadlineTone(t)}><span className={`tender-deadline-pill ${tenderDeadlineClass(t)}`}>{fmtTenderDeadline(t.deadline)}</span></Badge></td><td><strong>{t.score}</strong><br/><small>{scoreLabel(t.score)}</small></td><td><div className="row-actions table-actions tender-card-actions">{t.url ? <a target="_blank" href={t.url}>Abrir</a> : null}<button className="secondary" onClick={() => onStatus(t, 'en_revision')} disabled={creatingId === t.id || converted}>Revisar</button><button className="secondary" onClick={() => onStatus(t, 'descartada')} disabled={creatingId === t.id || converted}>Descartar</button><button onClick={() => onCreate(t)} disabled={creatingId === t.id}>{creatingId === t.id ? 'Creando…' : converted ? 'Ver' : 'Crear'}</button></div></td></tr>; })}</tbody></table></div>;
}
function Select({ value, onChange, options, empty, disabled = false }: { value: string; onChange: (v:string)=>void; options: string[][]; empty: string; disabled?: boolean }) { return <select value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{empty ? <option value="">{empty}</option> : null}{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>; }
function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) { return <span className={`badge ${tone ? `badge-${tone}` : ''}`}>{children}</span>; }
function OpportunityDetail({ id, data, refresh }: { id: string; data: Bootstrap; refresh: () => Promise<void> }) {
  const [detail, setDetail] = useState<{ opportunity: Opportunity; interactions: Interaction[] } | null>(null); const [error, setError] = useState<string | null>(null);
  const load = async () => { try { setDetail(await api(`/api/opportunity-detail?id=${encodeURIComponent(id)}`)); } catch(e) { setError(e instanceof Error ? e.message : String(e)); } };
  useEffect(() => { load(); }, [id]);
  if (error) return <div className="error">{error}</div>; if (!detail) return <div className="notice">Cargando detalle…</div>;
  const o = detail.opportunity;
  const action = nextActionStatus(o);
  const lastDays = daysSince(o.last_interaction_at || o.updated_at || o.created_at);
  return <section className="stack">
    <div className="hero"><div><Badge>{o.stage_name}</Badge><h2>{o.company_name}</h2><p>{o.owner_name || 'Sin comercial'} · {o.regional_nombre || 'Sin regional'} · {fmtMoney(o.offer_value)}</p></div><button onClick={() => go(`#/edit/${o.id}`)}>Editar</button></div>
    <div className="grid three"><Info label="Servicio" value={o.service_type_name || o.tipo_producto_original}/><Info label="Tipo de cliente" value={customerSegmentLabel(o.customer_segment)}/><Info label="Área comercial" value={commercialAreaLabel(o.owner_commercial_area)}/><Info label="Cierre estimado" value={fmtDate(o.expected_close_date)}/><Info label="Próxima acción" value={fmtDate(o.next_action_at)}/><Info label="Estado próxima gestión" value={`${action.label} · ${action.detail}`}/><Info label="Días sin seguimiento" value={lastDays === null ? 'Sin registro' : `${lastDays} día(s)`}/><Info label="Decisor" value={o.decision_maker_name}/><Info label="Correo decisor" value={o.decision_maker_email}/><Info label="Teléfono" value={o.decision_maker_phone}/></div>
    <div className="grid two"><Panel title="Datos comerciales"><dl><Dt label="Sector" value={o.economic_sector}/><Dt label="Ciudad" value={o.quote_city}/><Dt label="Sede" value={o.sede}/><Dt label="ID legacy" value={o.legacy_excel_id}/><Dt label="Hoja origen" value={o.excel_hoja_origen}/><Dt label="Estado original" value={o.estado_pipeline_original}/><Dt label="Observaciones" value={o.observaciones}/></dl></Panel><FollowUpForm opportunityId={id} profiles={data.profiles} currentProfile={data.currentProfile} onSaved={async()=>{await load(); await refresh();}} /></div>
    <Panel title="Línea de seguimientos"><div className="timeline">{detail.interactions.length ? detail.interactions.map(i => <div className="event" key={i.id}><strong>{i.interaction_type}</strong><span>{fmtDate(i.occurred_at)} · {i.psi_sales_profiles?.full_name || 'Migrado / sistema'}</span><p>{i.notes}</p></div>) : <p className="muted">Sin seguimientos registrados.</p>}</div></Panel>
  </section>;
}
function Info({ label, value }: { label: string; value?: string | null }) { return <div className="card info"><small>{label}</small><strong>{value || '—'}</strong></div>; }
function Dt({ label, value }: { label: string; value?: string | null }) { return <><dt>{label}</dt><dd>{value || '—'}</dd></>; }
function FollowUpForm({ opportunityId, profiles, currentProfile, onSaved }: { opportunityId: string; profiles: Profile[]; currentProfile: Profile; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ interaction_type: 'nota', notes: '', occurred_at: new Date().toISOString().slice(0,16), created_by: currentProfile.id, next_action_at: '' }); const [status, setStatus] = useState('');
  const save = async (e: React.FormEvent) => { e.preventDefault(); setStatus('Guardando…'); try { await api(`/api/opportunity-interactions?id=${encodeURIComponent(opportunityId)}`, { method:'POST', body: JSON.stringify({ ...form, occurred_at: new Date(form.occurred_at).toISOString(), next_action_at: form.next_action_at ? new Date(form.next_action_at).toISOString() : null, created_by: form.created_by || null }) }); setForm({...form, notes:''}); setStatus('Seguimiento registrado.'); await onSaved(); } catch(err) { setStatus(err instanceof Error ? err.message : String(err)); } };
  return <Panel title="Registrar seguimiento"><form onSubmit={save} className="form"><Select value={form.interaction_type} onChange={v=>setForm({...form, interaction_type:v})} options={interactionTypes.map(t=>[t,t])} empty="Tipo"/>{profiles.length > 1 && <Select value={form.created_by} onChange={v=>setForm({...form, created_by:v})} options={profiles.map(p=>[p.id,p.full_name])} empty="Quién registra"/>}<label>Fecha del seguimiento<input type="datetime-local" value={form.occurred_at} onChange={e=>setForm({...form, occurred_at:e.target.value})}/></label><label>Programar próxima gestión<input type="datetime-local" value={form.next_action_at} onChange={e=>setForm({...form, next_action_at:e.target.value})}/></label><textarea required placeholder="Nota del seguimiento" value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})}/><button>Guardar seguimiento</button>{status && <small>{status}</small>}</form></Panel>;
}
function OpportunityForm({ data, id, refresh }: { data: Bootstrap; id?: string; refresh: () => Promise<void> }) {
  const existing = id ? data.opportunities.find(o => o.id === id) : undefined;
  const [form, setForm] = useState<OpportunityPayload>({
    company_name: existing?.company_name || '',
    owner_id: existing?.owner_id || '',
    stage_code: existing?.stage_code || 'prospecto',
    service_type_code: existing?.service_type_code || '',
    offer_value: existing?.offer_value || 0,
    expected_close_date: existing?.expected_close_date || '',
    next_action_at: existing?.next_action_at || '',
    quote_city: existing?.quote_city || '',
    regional_nombre: existing?.regional_nombre || '',
    sede: existing?.sede || '',
    economic_sector: existing?.economic_sector || '',
    decision_maker_name: existing?.decision_maker_name || '',
    decision_maker_email: existing?.decision_maker_email || '',
    decision_maker_phone: existing?.decision_maker_phone || '',
    loss_reason_code: existing?.loss_reason_code || '',
    loss_notes: existing?.loss_notes || '',
    observaciones: existing?.observaciones || '',
    commission_rate: existing?.commission_rate || 0,
    customer_segment: existing?.customer_segment || '',
  });
  const [status, setStatus] = useState('');
  const canEditSegment = canEditOpportunitySegment(data.currentProfile, existing);
  const set = (key: keyof OpportunityPayload, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Guardando…');
    try {
      const saved = await api<{id:string}>(id ? `/api/opportunity?id=${encodeURIComponent(id)}` : '/api/opportunities', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(form),
      });
      await refresh();
      setStatus('Guardado.');
      go(`#/detail/${saved.id}`);
    } catch(err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };
  return <Panel title={id ? 'Editar oportunidad' : 'Nueva oportunidad'}>
    <form onSubmit={submit} className="form gridform">
      <label>Cliente / empresa<input required value={form.company_name || ''} onChange={e=>set('company_name', e.target.value)}/></label>
      <label>Comercial<Select value={String(form.owner_id || '')} onChange={v=>set('owner_id', v)} options={data.profiles.map(p=>[p.id,p.full_name])} empty="Seleccionar"/></label>
      <label>Etapa<Select value={String(form.stage_code || '')} onChange={v=>set('stage_code', v)} options={data.stages.map(s=>[s.code,s.name])} empty="Seleccionar"/></label>
      <label>Servicio<Select value={String(form.service_type_code || '')} onChange={v=>set('service_type_code', v)} options={data.services.map(s=>[s.code,s.name])} empty="Seleccionar"/></label>
      <label>Tipo de cliente<Select value={String(form.customer_segment || '')} onChange={v=>set('customer_segment', v)} options={customerSegmentOptions} empty="Seleccionar" disabled={id ? !canEditSegment : false}/></label>
      {id && !canEditSegment && <p className="muted wide">Después de creada, esta clasificación solo la cambia Admin/Directivo o un comercial habilitado.</p>}
      <label>Valor oferta<input type="number" min="0" required value={String(form.offer_value || 0)} onChange={e=>set('offer_value', e.target.value)}/></label>
      <label>Cierre estimado<input type="date" value={String(form.expected_close_date || '')} onChange={e=>set('expected_close_date', e.target.value)}/></label>
      <label>Próxima acción<input type="datetime-local" value={String(form.next_action_at || '').slice(0,16)} onChange={e=>set('next_action_at', e.target.value)}/></label>
      <label>Regional<input value={String(form.regional_nombre || '')} onChange={e=>set('regional_nombre', e.target.value)}/></label>
      <label>Sede<input value={String(form.sede || '')} onChange={e=>set('sede', e.target.value)}/></label>
      <label>Ciudad<input value={String(form.quote_city || '')} onChange={e=>set('quote_city', e.target.value)}/></label>
      <label>Sector<input value={String(form.economic_sector || '')} onChange={e=>set('economic_sector', e.target.value)}/></label>
      <label>Decisor<input value={String(form.decision_maker_name || '')} onChange={e=>set('decision_maker_name', e.target.value)}/></label>
      <label>Email decisor<input type="email" value={String(form.decision_maker_email || '')} onChange={e=>set('decision_maker_email', e.target.value)}/></label>
      <label>Teléfono decisor<input value={String(form.decision_maker_phone || '')} onChange={e=>set('decision_maker_phone', e.target.value)}/></label>
      {form.stage_code === 'perdido' && <label>Motivo pérdida<Select value={String(form.loss_reason_code || '')} onChange={v=>set('loss_reason_code', v)} options={data.lossReasons.map(r=>[r.code,r.name])} empty="Seleccionar"/></label>}
      {form.stage_code === 'perdido' && <label>Notas pérdida<input value={String(form.loss_notes || '')} onChange={e=>set('loss_notes', e.target.value)}/></label>}
      <label>Comisión %<input type="number" min="0" max="100" step="0.1" value={String(form.commission_rate || 0)} onChange={e=>set('commission_rate', e.target.value)}/></label>
      <label className="wide">Observaciones<textarea value={String(form.observaciones || '')} onChange={e=>set('observaciones', e.target.value)}/></label>
      <div className="formactions"><button>{id ? 'Guardar cambios' : 'Crear oportunidad'}</button>{status && <span>{status}</span>}</div>
    </form>
  </Panel>;
}


function GoalVsActualDashboard({ rows }: { rows: ReturnType<typeof buildGoalVsActualRows> }) {
  const visibleRows = rows.filter(row => row.goal > 0 || row.actual > 0);
  if (!visibleRows.length) return <EmptyState title="Sin metas reales cargadas" text="Carga metas en Metas y cumplimiento para comparar presupuesto, prospectos y cotizaciones contra resultados reales." />;
  return <div className="goal-vs-actual-grid">{visibleRows.map(row => <div className={`goal-progress-card ${goalStatusTone(row.pct)}`} key={row.label}>
    <small>{row.label}</small>
    <strong className="numeric-value">{row.pct === null ? 'Sin meta' : `${row.pct}%`}</strong>
    <div className="goal-progress-track"><span style={{ width: `${Math.min(100, Math.max(3, row.pct || 0))}%` }} /></div>
    <span>Real: {formatGoalValue(row.kind, row.actual)} · Meta: {formatGoalValue(row.kind, row.goal)}</span>
  </div>)}</div>;
}

function buildGoalVsActualRows(data: Bootstrap, months: string[], ownerId?: string) {
  const ownerName = ownerId ? data.profiles.find(p => p.id === ownerId)?.full_name || '' : '';
  const spec = [
    { label: 'Ventas aprobadas', kind: 'money' as const, goalField: 'sales_budget' as const, actualField: 'ventas_aprobadas' as const },
    { label: 'Prospectos', kind: 'count' as const, goalField: 'prospect_target' as const, actualField: 'prospectos' as const },
    { label: 'Cotizaciones', kind: 'count' as const, goalField: 'quote_target' as const, actualField: 'cotizaciones' as const },
  ];
  return spec.map(row => {
    const goals = data.goals.filter(g => (!ownerId || g.user_id === ownerId) && months.includes(String(g.period_month).slice(0, 7)));
    const kpis = data.monthlyKpis.filter(k => months.includes(String(k.period_month).slice(0, 7)) && (!ownerId || k.owner_id === ownerId || (!k.owner_id && (k.owner_name || '') === ownerName)));
    const goal = goals.reduce((sum, g) => sum + Number(g[row.goalField] || 0), 0);
    const actual = kpis.reduce((sum, k) => sum + Number(k[row.actualField] || 0), 0);
    const pct = goal > 0 ? Math.round((actual / goal) * 100) : null;
    return { ...row, goal, actual, pct };
  });
}

function buildMonthlyTrendRows(data: Bootstrap) {
  const map = new Map<string, { period: string; prospectos: number; cotizaciones: number; ventas: number; comision: number }>();
  data.monthlyKpis.forEach(k => {
    const period = String(k.period_month).slice(0, 7);
    const row = map.get(period) || { period, prospectos: 0, cotizaciones: 0, ventas: 0, comision: 0 };
    row.prospectos += Number(k.prospectos || 0);
    row.cotizaciones += Number(k.cotizaciones || 0);
    row.ventas += Number(k.ventas_aprobadas || 0);
    row.comision += Number(k.comision_proyectada || 0);
    map.set(period, row);
  });
  return Array.from(map.values()).sort((a,b)=>b.period.localeCompare(a.period)).slice(0, 6).reverse();
}

function trendAvailabilityNote(rows: Array<{ period: string }>) {
  if (rows.length < 2) return 'Histórico limitado: todavía no hay suficientes meses comparables; esta vista se irá llenando automáticamente con los KPIs mensuales.';
  return `Comparativo disponible para ${rows.length} meses con información registrada.`;
}

function businessUnitRuleRows(data: Bootstrap, periodMonth: string) {
  return commercialAreaOptions.map(([area, label]) => {
    const profiles = data.profiles.filter(p => p.commercial_area === area);
    const ids = new Set(profiles.map(p => p.id));
    const goals = data.goals.filter(g => g.user_id && ids.has(g.user_id) && String(g.period_month).slice(0, 7) === periodMonth.slice(0, 7));
    const kpis = data.monthlyKpis.filter(k => ((k.owner_id && ids.has(k.owner_id)) || profiles.some(p => p.full_name === (k.owner_name || ''))) && String(k.period_month).slice(0, 7) === periodMonth.slice(0, 7));
    const salesGoal = goals.reduce((s,g)=>s+Number(g.sales_budget||0),0);
    const sales = kpis.reduce((s,k)=>s+Number(k.ventas_aprobadas||0),0);
    const quotesGoal = goals.reduce((s,g)=>s+Number(g.quote_target||0),0);
    const quotes = kpis.reduce((s,k)=>s+Number(k.cotizaciones||0),0);
    const pct = salesGoal ? Math.round((sales / salesGoal) * 100) : null;
    const rule = area === 'licitacion_publica' ? 'Revisar, decidir y convertir procesos públicos con trazabilidad.' : area === 'tecnologia' ? 'Priorizar proyectos, licencias, monitoreo y soluciones con forecast claro.' : 'Mantener volumen de prospectos, cotizaciones y cierre recurrente.';
    return { area, label, profiles: profiles.length, rule, salesGoal, sales, quotesGoal, quotes, pct };
  });
}

function CommercialPersonalDashboard({ data }: { data: Bootstrap }) { return <ConsultantDetail data={data} ownerId={data.currentProfile.id} personal />; }

function ManagerDashboard({ data }: { data: Bootstrap }) {
  const [period, setPeriod] = useState<DashboardPeriodFilter>('');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [regional, setRegional] = useState('');
  const [stage, setStage] = useState('');
  const [service, setService] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig<'client'|'owner'|'value'|'stage'|'next'|'risk'>>({ key: 'value', direction: 'desc' });
  const [stageActionSortConfig, setStageActionSortConfig] = useState<SortConfig<'stage'|'value'|'count'|'share'|'weighted'|'risk'|'action'>>({ key: 'value', direction: 'desc' });
  const managerRegionalOptions = useMemo(() => uniq(data.opportunities.map(o => o.regional_nombre)), [data.opportunities]);
  const scopedOpportunities = useMemo(() => data.opportunities.filter(o =>
    matchesDashboardPeriod(o, period) &&
    (!q || `${o.company_name} ${o.owner_name||''} ${o.sede||''} ${o.quote_city||''} ${o.regional_nombre||''} ${o.tipo_producto_original||''} ${o.service_type_name||''} ${o.legacy_excel_id||''}`.toLowerCase().includes(q.toLowerCase())) &&
    (!owner || ownerKey(o) === owner) &&
    (!regional || o.regional_nombre === regional) &&
    (!stage || o.stage_code === stage) &&
    (!service || o.service_type_code === service) &&
    (!onlyActive || !isTerminalStage(o.stage_code))
  ), [data.opportunities, period, q, owner, regional, stage, service, onlyActive]);
  const scopedIds = useMemo(() => new Set(scopedOpportunities.map(o => o.id)), [scopedOpportunities]);
  const filteredStalled = data.stalled.filter(o => scopedIds.has(o.id));
  const activeOpportunities = scopedOpportunities.filter(o => !isTerminalStage(o.stage_code));
  const active = activeOpportunities.length;
  const actionRows = activeOpportunities.map(o => ({ opportunity: o, action: nextActionStatus(o), inactiveDays: daysSince(o.last_interaction_at || o.updated_at || o.created_at) }));
  const missingAgendaRows = actionRows.filter(r => r.action.code === 'missing');
  const overdueRows = actionRows.filter(r => r.action.code === 'overdue');
  const todayRows = actionRows.filter(r => r.action.code === 'today');
  const soonRows = actionRows.filter(r => r.action.code === 'soon');
  const closingSoonRows = activeOpportunities.filter(o => {
    if (!o.expected_close_date) return false;
    const d = new Date(o.expected_close_date); if (Number.isNaN(d.getTime())) return false;
    const today = startOfToday(); const max = new Date(today); max.setDate(max.getDate() + 30);
    return d >= today && d <= max;
  });
  const averageActiveValue = activeOpportunities.length ? activeOpportunities.reduce((s,o)=>s+Number(o.offer_value||0),0) / activeOpportunities.length : 0;
  const highValueFloor = Math.max(200_000_000, averageActiveValue);
  const highValueStalledRows = actionRows.filter(r => Number(r.opportunity.offer_value || 0) >= highValueFloor && Number(r.inactiveDays || 0) >= 10);
  const pipelineManagedRows = actionRows.filter(r => r.opportunity.next_action_at && !['overdue','missing'].includes(r.action.code));
  const pipelineRiskRows = Array.from(new Map([...missingAgendaRows, ...overdueRows, ...highValueStalledRows].map(r => [r.opportunity.id, r])).values());
  const sumValue = (rows: Array<Opportunity> | Array<{ opportunity: Opportunity }>) => rows.reduce((sum, row) => sum + Number('opportunity' in row ? row.opportunity.offer_value || 0 : row.offer_value || 0), 0);
  const scopedTotals = useMemo(() => scopedOpportunities.reduce((acc, o) => {
    const value = Number(o.offer_value || 0);
    acc.count++;
    acc.pipeline += value;
    acc.weighted += Number(o.weighted_pipeline_value || 0);
    if (isApprovedSale(o)) acc.approved += value;
    return acc;
  }, { count: 0, pipeline: 0, weighted: 0, approved: 0 }), [scopedOpportunities]);
  const byOwner = useMemo(() => {
    const map = new Map<string, { ownerId: string; owner: string; count: number; value: number; weighted: number; approved: number; active: number; missing: number; overdue: number }>();
    scopedOpportunities.forEach(o => {
      const key = ownerKey(o);
      const row = map.get(key) || { ownerId: key, owner: o.owner_name || 'Sin comercial', count: 0, value: 0, weighted: 0, approved: 0, active: 0, missing: 0, overdue: 0 };
      row.count++;
      row.value += Number(o.offer_value || 0);
      row.weighted += Number(o.weighted_pipeline_value || 0);
      if (!isTerminalStage(o.stage_code)) {
        row.active++;
        const action = nextActionStatus(o);
        if (action.code === 'missing') row.missing++;
        if (action.code === 'overdue') row.overdue++;
      }
      if (isApprovedSale(o)) row.approved += Number(o.offer_value || 0);
      map.set(key,row);
    });
    return Array.from(map.values()).sort((a,b)=>b.value-a.value);
  }, [scopedOpportunities]);
  const leader = byOwner[0];
  const maxOwnerValue = Math.max(...byOwner.map(o=>o.value),1);
  const conversion = scopedTotals.pipeline ? Math.round((scopedTotals.approved / scopedTotals.pipeline) * 100) : 0;
  const stageRows = useMemo(() => {
    const map = new Map<string, SummaryRow>();
    scopedOpportunities.forEach(o => {
      const row = map.get(o.stage_code) || { stage_code: o.stage_code, stage_name: o.stage_name, stage_order: o.stage_order, opportunities_count: 0, total_offer_value: 0, weighted_pipeline_value: 0 };
      row.opportunities_count++;
      row.total_offer_value += Number(o.offer_value || 0);
      row.weighted_pipeline_value += Number(o.weighted_pipeline_value || 0);
      map.set(o.stage_code, row);
    });
    return Array.from(map.values()).sort((a,b)=>a.stage_order-b.stage_order);
  }, [scopedOpportunities]);
  const activePipelineValue = activeOpportunities.reduce((sum, o) => sum + Number(o.offer_value || 0), 0);
  const servicePipelineRows = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; value: number; weighted: number }>();
    activeOpportunities.forEach(o => {
      const key = o.service_type_code || o.tipo_producto_original || '__sin_servicio__';
      const label = o.service_type_name || o.tipo_producto_original || 'Sin servicio clasificado';
      const row = map.get(key) || { key, label, count: 0, value: 0, weighted: 0 };
      row.count++;
      row.value += Number(o.offer_value || 0);
      row.weighted += Number(o.weighted_pipeline_value || 0);
      map.set(key, row);
    });
    const total = Array.from(map.values()).reduce((sum, row) => sum + row.value, 0) || 1;
    return Array.from(map.values()).map(row => ({ ...row, share: Math.round((row.value / total) * 100) })).sort((a,b)=>b.value-a.value || b.count-a.count);
  }, [activeOpportunities]);
  const serviceLeader = servicePipelineRows[0];
  const stageLeader = [...stageRows].sort((a,b)=>Number(b.total_offer_value)-Number(a.total_offer_value))[0];
  const concentration = stageLeader && scopedTotals.pipeline ? Math.round((Number(stageLeader.total_offer_value || 0) / scopedTotals.pipeline) * 100) : 0;
  const stageActionRows = stageRows.map(s => {
    const value = Number(s.total_offer_value || 0);
    const weighted = Number(s.weighted_pipeline_value || 0);
    const pct = scopedTotals.pipeline ? Math.round((value / scopedTotals.pipeline) * 100) : 0;
    const terminal = isTerminalStage(s.stage_code);
    const riskTone = terminal ? (s.stage_code === 'aprobado' ? 'green' : 'red') : pct >= 55 ? 'red' : pct >= 25 ? 'amber' : 'green';
    const riskLabel = terminal
      ? (s.stage_code === 'aprobado' ? 'Resultado ganado' : 'Resultado perdido')
      : pct >= 55
        ? 'Concentración alta'
        : pct >= 25
          ? 'Revisar avance'
          : weighted >= value * 0.45
            ? 'Potencial cercano'
            : 'Seguimiento normal';
    const actionLabel = terminal
      ? (s.stage_code === 'aprobado' ? 'Ver aprobadas' : 'Revisar razones')
      : s.stage_code === 'envio_oferta'
        ? 'Destrabar ofertas'
        : s.stage_code === 'negociacion'
          ? 'Empujar cierre'
          : s.stage_code === 'sustentacion'
            ? 'Preparar sustentación'
            : 'Ordenar gestión';
    return { ...s, value, weighted, pct, riskTone, riskLabel, actionLabel, terminal };
  });
  const sortedStageActionRows = [...stageActionRows].sort((a,b) => {
    const value = (row: typeof stageActionRows[number]) => stageActionSortConfig.key === 'stage' ? row.stage_name : stageActionSortConfig.key === 'value' ? row.value : stageActionSortConfig.key === 'count' ? row.opportunities_count : stageActionSortConfig.key === 'share' ? row.pct : stageActionSortConfig.key === 'weighted' ? row.weighted : stageActionSortConfig.key === 'risk' ? row.riskLabel : row.actionLabel;
    return compareSortValues(value(a), value(b), stageActionSortConfig.direction);
  });
  const sortStageActionBy = (key: typeof stageActionSortConfig.key) => setStageActionSortConfig(current => nextSort(current, key));
  const staleCount = filteredStalled.length;
  const commercialCards = byOwner.map(o => {
    const share = scopedTotals.pipeline ? Math.round((o.value / scopedTotals.pipeline) * 100) : 0;
    const winRate = o.value ? Math.round((o.approved / o.value) * 100) : 0;
    const status = winRate >= 20 ? 'green' : winRate >= 8 ? 'amber' : 'red';
    const statusLabel = winRate >= 20 ? 'Cierre fuerte' : winRate >= 8 ? 'En observación' : 'Requiere foco';
    return { ...o, share, winRate, status, statusLabel };
  });
  const monthlyByOwner = useMemo(() => {
    const selectedOwnerName = owner ? data.profiles.find(p => p.id === owner)?.full_name : '';
    const map = new Map<string, { owner: string; prospectos: number; cotizaciones: number; ventas: number; comision: number }>();
    data.monthlyKpis.slice(0, 30).filter(k => !selectedOwnerName || (k.owner_name || 'Sin comercial') === selectedOwnerName).forEach(k => {
      const owner = k.owner_name || 'Sin comercial';
      const row = map.get(owner) || { owner, prospectos: 0, cotizaciones: 0, ventas: 0, comision: 0 };
      row.prospectos += Number(k.prospectos || 0);
      row.cotizaciones += Number(k.cotizaciones || 0);
      row.ventas += Number(k.ventas_aprobadas || 0);
      row.comision += Number(k.comision_proyectada || 0);
      map.set(owner, row);
    });
    return Array.from(map.values()).sort((a,b)=>b.ventas-a.ventas || b.cotizaciones-a.cotizaciones);
  }, [data.monthlyKpis, data.profiles, owner]);
  const maxMonthly = Math.max(...monthlyByOwner.map(o=>Math.max(o.prospectos, o.cotizaciones, o.ventas / 10_000_000)), 1);
  const maxMonthlySales = Math.max(...monthlyByOwner.map(o=>o.ventas), 1);
  const monthlyByOwnerMap = new Map(monthlyByOwner.map(row => [row.owner, row]));
  const trendRows = buildMonthlyTrendRows(data);
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const goalVsActualRows = buildGoalVsActualRows(data, [currentMonthKey]);
  const goalRowsWithTargets = goalVsActualRows.filter(row => row.pct !== null);
  const goalAveragePct = goalRowsWithTargets.length ? Math.round(goalRowsWithTargets.reduce((sum,row)=>sum+Number(row.pct||0),0)/goalRowsWithTargets.length) : null;
  const managedRatio = activeOpportunities.length ? Math.round((pipelineManagedRows.length / activeOpportunities.length) * 100) : 100;
  const commercialHealthCards = byOwner.map(o => {
    const monthly = monthlyByOwnerMap.get(o.owner);
    const winRate = o.value ? Math.round((o.approved / o.value) * 100) : 0;
    const disciplinePenalty = (o.missing * 4) + (o.overdue * 6);
    const score = Math.max(0, Math.min(100, Math.round((o.active * 2) + (o.weighted / Math.max(scopedTotals.weighted,1) * 30) + (winRate * .35) + Number(monthly?.cotizaciones || 0) + Number(monthly?.prospectos || 0) - disciplinePenalty)));
    const tone = score >= 70 ? 'green' : score >= 45 ? 'amber' : 'red';
    return { ...o, score, tone, winRate, prospectos: monthly?.prospectos || 0, cotizaciones: monthly?.cotizaciones || 0 };
  }).sort((a,b)=>b.score-a.score || b.approved-a.approved);
  const criticalOpportunityRows = actionRows.map(r => {
    const value = Number(r.opportunity.offer_value || 0);
    const closingSoon = closingSoonRows.some(o => o.id === r.opportunity.id);
    const riskScore = value + (r.action.code === 'overdue' ? 600_000_000 : 0) + (r.action.code === 'missing' ? 450_000_000 : 0) + (closingSoon ? 350_000_000 : 0) + (Number(r.inactiveDays || 0) >= 10 ? 250_000_000 : 0);
    const risk = r.action.code === 'overdue' ? 'Gestión vencida' : r.action.code === 'missing' ? 'Sin próxima acción' : closingSoon ? 'Cierre próximo' : Number(r.inactiveDays || 0) >= 10 ? 'Sin seguimiento reciente' : 'Revisar avance';
    return { ...r, riskScore, risk };
  }).filter(r => ['overdue','missing'].includes(r.action.code) || closingSoonRows.some(o => o.id === r.opportunity.id) || Number(r.inactiveDays || 0) >= 10).sort((a,b)=>b.riskScore-a.riskScore).slice(0, 10);
  const sortedCriticalOpportunityRows = [...criticalOpportunityRows].sort((a,b) => {
    const value = (row: typeof criticalOpportunityRows[number]) => sortConfig.key === 'client' ? row.opportunity.company_name : sortConfig.key === 'owner' ? (row.opportunity.owner_name || '') : sortConfig.key === 'value' ? Number(row.opportunity.offer_value || 0) : sortConfig.key === 'stage' ? (row.opportunity.stage_order || 0) : sortConfig.key === 'next' ? (row.opportunity.next_action_at || '') : row.riskScore;
    return compareSortValues(value(a), value(b), sortConfig.direction);
  });
  const sortBy = (key: typeof sortConfig.key) => setSortConfig(current => nextSort(current, key));
  const biggestAlertOwner = commercialHealthCards.find(o => o.missing || o.overdue) || commercialHealthCards[0];
  const actionTitle = overdueRows.length
    ? `${overdueRows.length} gestiones vencidas requieren decisión hoy`
    : missingAgendaRows.length
      ? `${missingAgendaRows.length} oportunidades están sin próxima acción`
      : closingSoonRows.length
        ? `${closingSoonRows.length} cierres próximos necesitan empuje gerencial`
        : 'Disciplina comercial activa y pipeline bajo control';
  const actionInstruction = overdueRows.length
    ? `Resolver las gestiones vencidas y recuperar ${fmtMoneyCompact(sumValue(overdueRows))} en pipeline en riesgo.`
    : missingAgendaRows.length
      ? `Asignar responsable, fecha y siguiente paso a oportunidades por ${fmtMoneyCompact(sumValue(missingAgendaRows))}.`
      : closingSoonRows.length
        ? `Preparar decisión de cierre para ${fmtMoneyCompact(sumValue(closingSoonRows))} en los próximos 30 días.`
        : 'Mantener seguimiento vigente y sostener avance del pipeline activo.';

  return <section className="stack manager-dashboard command-center">
    <section className="command-center-hero">
      <div className="command-copy">
        <div className="command-title-row"><span className="eyebrow">Sala de control comercial · Comando gerencial del día</span></div>
        <h2 className="command-priority-title">{actionTitle}</h2>
        <p>{stageLeader ? `Revisar forecast: ${concentration}% del valor filtrado está concentrado en ${stageLeader.stage_name}. Comercial a revisar: ${biggestAlertOwner?.owner || '—'}.` : 'Lectura ejecutiva del pipeline, forecast, concentración y riesgos comerciales.'}</p>
        <div className="command-metrics pipeline-discipline-grid">
          <div><small>Pipeline total</small><strong className="numeric-value">{fmtMoneyCompact(scopedTotals.pipeline)}</strong><span>{scopedTotals.count} oportunidades filtradas</span></div>
          <div><small>Pipeline activo</small><strong className="numeric-value">{fmtMoneyCompact(activePipelineValue)}</strong><span>{active} oportunidades en gestión</span></div>
          <div><small>Forecast ponderado</small><strong className="numeric-value">{fmtMoneyCompact(scopedTotals.weighted)}</strong><span>Pipeline gestionado: {pipelineManagedRows.length} con próxima acción vigente</span></div>
          <div><small>Pipeline en riesgo</small><strong className="numeric-value">{fmtMoneyCompact(sumValue(pipelineRiskRows))}</strong><span>{pipelineRiskRows.length} sin control suficiente</span></div>
        </div>
      </div>
      <div className="manager-action-panel">
        <small>Acción gerencial sugerida</small>
        <strong>{actionInstruction}</strong>
        <p className="manager-action-context">Enfoque de revisión: comercial, etapa y servicio con mayor impacto en el pipeline filtrado.</p>
        <div className="signal-grid">
          <span><b>{leader?.owner || '—'}</b><em>Líder pipeline</em></span>
          <span><b>{stageLeader?.stage_name || '—'}</b><em>Etapa crítica</em></span>
          <span><b>{serviceLeader?.label || '—'}</b><em>Servicio líder</em></span>
          <span><b>{biggestAlertOwner?.owner || '—'}</b><em>Comercial a revisar</em></span>
        </div>
      </div>
    </section>

    <Panel title="Filtros gerenciales">
      <div className="filters manager-dashboard-filters">
        <Select value={period} onChange={v=>setPeriod(v as DashboardPeriodFilter)} options={[["todos","Todo el pipeline"],["mes_actual","Mes actual"],["proximos_30","Próximos 30 días"],["trimestre_actual","Trimestre actual"],["anio_actual","Año actual"]]} empty="Período"/>
        <input placeholder="Buscar cliente, comercial, sede, ciudad, servicio o ID…" value={q} onChange={e=>setQ(e.target.value)} />
        <Select value={owner} onChange={setOwner} options={data.profiles.map(p=>[p.id,p.full_name])} empty="Todos los comerciales"/>
        <Select value={regional} onChange={setRegional} options={managerRegionalOptions.map(r=>[r,r])} empty="Todas las regionales"/>
        <Select value={stage} onChange={setStage} options={data.stages.map(s=>[s.code,s.name])} empty="Todas las etapas"/>
        <Select value={service} onChange={setService} options={data.services.map(s=>[s.code,s.name])} empty="Todos los servicios"/>
        <label className="check-filter"><input type="checkbox" checked={onlyActive} onChange={e=>setOnlyActive(e.target.checked)} /> Pipeline activo</label>
        <button className="secondary" onClick={()=>{ setPeriod(''); setQ(''); setOwner(''); setRegional(''); setStage(''); setService(''); setOnlyActive(false); }}>Limpiar filtros</button>
      </div>
      <div className="filter-summary"><strong>{scopedOpportunities.length}</strong> de {data.opportunities.length} oportunidades visibles · Última actualización: {lastUpdatedLabel(scopedOpportunities)}</div>
    </Panel>

    <Panel title="Prioridad gerencial de hoy">
      <div className="operational-command-grid">
        <a className="operational-card danger clickable-card" href={managerAlertRoute('missing')}><small>Sin próxima acción</small><strong className="numeric-value">{missingAgendaRows.length}</strong><span>{fmtMoneyCompact(sumValue(missingAgendaRows))} sin agenda</span><em>Ver casos y asignar fecha →</em></a>
        <a className="operational-card danger clickable-card" href={managerAlertRoute('overdue')}><small>Gestión vencida</small><strong className="numeric-value">{overdueRows.length}</strong><span>{fmtMoneyCompact(sumValue(overdueRows))} vencido</span><em>Ver casos vencidos →</em></a>
        <a className="operational-card warn clickable-card" href={managerAlertRoute('closing_soon')}><small>Cierre próximo</small><strong className="numeric-value">{closingSoonRows.length}</strong><span>{fmtMoneyCompact(sumValue(closingSoonRows))} próximos 30 días</span><em>Ver cierres próximos →</em></a>
        <a className="operational-card warn clickable-card" href={managerAlertRoute('high_value_stalled')}><small>Alto valor estancado</small><strong className="numeric-value">{highValueStalledRows.length}</strong><span>{fmtMoneyCompact(sumValue(highValueStalledRows))} sin seguimiento reciente</span><em>Ver bloqueos comerciales →</em></a>
      </div>
    </Panel>

    <Panel title="Semáforos ejecutivos">
      <div className="executive-signals">
        <a className={concentration >= 55 ? 'signal-card warn clickable-card' : 'signal-card ok clickable-card'} href={`#/opportunities?stage=${encodeURIComponent(stageLeader?.stage_code || '')}`}><small>Riesgo de concentración del pipeline</small><strong className="numeric-value">{concentration}%</strong><span>{stageLeader?.stage_name || 'Sin etapa dominante'}</span><em>{concentration >= 55 ? 'Ver etapa dominante →' : 'Distribución saludable'}</em></a>
        <a className={conversion >= 15 ? 'signal-card ok clickable-card' : 'signal-card warn clickable-card'} href="#/goals"><small>Efectividad de cierre</small><strong className="numeric-value">{conversion}%</strong><span>{fmtMoneyCompact(scopedTotals.approved)} ganado</span><em>{conversion >= 15 ? 'Ritmo positivo' : 'Revisar avance a cierre'}</em></a>
        <a className={managedRatio >= 70 ? 'signal-card ok clickable-card' : managedRatio >= 45 ? 'signal-card warn clickable-card' : 'signal-card danger clickable-card'} href={managerAlertRoute('missing')}><small>Disciplina de agenda</small><strong className="numeric-value">{managedRatio}%</strong><span>{fmtMoneyCompact(sumValue(pipelineManagedRows))} gestionado</span><em>Ver oportunidades sin control →</em></a>
        <a className={goalAveragePct === null ? 'signal-card warn clickable-card' : goalAveragePct >= 100 ? 'signal-card ok clickable-card' : goalAveragePct >= 80 ? 'signal-card warn clickable-card' : 'signal-card danger clickable-card'} href="#/goals"><small>Cumplimiento meta mes</small><strong className="numeric-value">{goalAveragePct === null ? '—' : `${goalAveragePct}%`}</strong><span>Ventas, prospectos y cotizaciones</span><em>{goalAveragePct === null ? 'Cargar metas reales →' : 'Ver metas y cumplimiento →'}</em></a>
      </div>
    </Panel>

    <Panel title="Avance contra meta comercial">
      <GoalVsActualDashboard rows={goalVsActualRows} />
    </Panel>

    <Panel title="Top 10 oportunidades que requieren decisión">
      <div className="tablewrap critical-opportunities-table"><table><thead><tr><SortableTh label="Cliente" sortKey="client" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Comercial" sortKey="owner" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Valor" sortKey="value" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Etapa" sortKey="stage" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Próxima acción" sortKey="next" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Riesgo" sortKey="risk" sortConfig={sortConfig} onSort={sortBy}/><th>Acción</th></tr></thead><tbody>{sortedCriticalOpportunityRows.map(row => {
        const o = row.opportunity;
        return <tr key={o.id}><td><strong>{o.company_name}</strong><br/><small>{o.sede || o.regional_nombre || '—'}</small></td><td>{o.owner_name || 'Sin comercial'}</td><td><strong className="numeric-value">{fmtMoneyCompact(o.offer_value)}</strong></td><td><Badge tone={stageTone(o.stage_code)}>{o.stage_name}</Badge></td><td>{o.next_action_at ? fmtDate(o.next_action_at) : 'Sin agenda'}<br/><small>{row.action.detail}</small></td><td><Badge tone={row.action.tone}>{row.risk}</Badge></td><td><a className="button" href={`#/detail/${o.id}`}>Ver detalle</a><a className="button secondary" href={`#/detail/${o.id}`}>Registrar seguimiento</a></td></tr>;
      })}</tbody></table></div>
      {!criticalOpportunityRows.length ? <EmptyState title="Sin oportunidades críticas" text="No hay vencidas, sin agenda, próximas a cierre o estancadas con los filtros actuales." /> : null}
    </Panel>

    <Panel title="Concentración y avance del pipeline">
      <div className="stage-action-summary">
        <div><small>Lectura ejecutiva</small><strong>{stageLeader ? `${concentration}% del pipeline está en ${stageLeader.stage_name}` : 'Sin etapa dominante'}</strong><span>{stageLeader && concentration >= 55 ? 'Prioridad: destrabar esa etapa y revisar siguientes acciones.' : 'Distribución sin concentración crítica con los filtros actuales.'}</span></div>
        <a className="button secondary" href={`#/opportunities?stage=${encodeURIComponent(stageLeader?.stage_code || '')}`}>Ver etapa dominante</a>
      </div>
      <div className="tablewrap stage-action-table"><table><thead><tr><SortableTh label="Etapa" sortKey="stage" sortConfig={stageActionSortConfig} onSort={sortStageActionBy}/><SortableTh label="Valor total" sortKey="value" sortConfig={stageActionSortConfig} onSort={sortStageActionBy}/><SortableTh label="Ops" sortKey="count" sortConfig={stageActionSortConfig} onSort={sortStageActionBy}/><SortableTh label="% pipeline" sortKey="share" sortConfig={stageActionSortConfig} onSort={sortStageActionBy}/><SortableTh label="Valor ponderado" sortKey="weighted" sortConfig={stageActionSortConfig} onSort={sortStageActionBy}/><SortableTh label="Riesgo / lectura" sortKey="risk" sortConfig={stageActionSortConfig} onSort={sortStageActionBy}/><SortableTh label="Acción" sortKey="action" sortConfig={stageActionSortConfig} onSort={sortStageActionBy}/></tr></thead><tbody>{sortedStageActionRows.map(s => <tr key={s.stage_code}>
        <td><strong>{s.stage_name}</strong><br/><small>{s.terminal ? 'Resultado del proceso' : 'Pipeline activo'}</small></td>
        <td><strong className="numeric-value">{fmtMoneyCompact(s.value)}</strong></td>
        <td>{s.opportunities_count}</td>
        <td><strong>{s.pct}%</strong><div className="mini-progress stage-share-meter"><span style={{ width: `${Math.max(3, s.pct)}%` }} /></div></td>
        <td><strong className="numeric-value">{fmtMoneyCompact(s.weighted)}</strong></td>
        <td><span className={`stage-risk-pill ${s.riskTone}`}>{s.riskLabel}</span></td>
        <td><a className="button" href={`#/opportunities?stage=${encodeURIComponent(s.stage_code)}`}>{s.actionLabel}</a><br/><small>Ver etapa</small></td>
      </tr>)}</tbody></table></div>
    </Panel>

    <Panel title="Pipeline por tipo de servicio">
      <ServicePipelineBreakdown rows={servicePipelineRows} />
    </Panel>

    <Panel title="Ranking por salud comercial">
      <div className="commercial-scorecards">{commercialHealthCards.map((o, index) => <a className={`commercial-scorecard status-${o.tone}`} key={o.ownerId} href={ownerRoute(o.ownerId)}>
        <div className="scorecard-top"><span className="owner-rank">#{index + 1}</span><span className={`status-pill ${o.tone}`}>Salud {o.score}/100</span></div>
        <div className="scorecard-name"><strong>{o.owner}</strong><small>{o.active} activas · {o.missing} sin agenda · {o.overdue} vencidas</small></div>
        <div className="health-score"><strong className="numeric-value">{o.score}</strong><span>score gestión + cierre</span></div>
        <div className="scorecard-metrics">
          <span><small>Forecast</small><b>{fmtMoneyCompact(o.weighted)}</b></span>
          <span><small>Aprobado</small><b>{fmtMoneyCompact(o.approved)}</b></span>
          <span><small>Conversión</small><b>{o.winRate}%</b></span>
          <span><small>Cotizaciones</small><b>{o.cotizaciones}</b></span>
        </div>
        <em>Ver detalle →</em>
      </a>)}</div>
    </Panel>

    <Panel title="Ranking comercial ejecutivo">
      <div className="status-legend"><span><i className="dot good"/> Cierre fuerte ≥20%</span><span><i className="dot warn"/> En observación 8–19%</span><span><i className="dot danger"/> Requiere foco &lt;8%</span></div>
      <div className="commercial-scorecards">{commercialCards.map((o, index) => <a className={`commercial-scorecard status-${o.status}`} key={o.ownerId} href={ownerRoute(o.ownerId)}>
        <div className="scorecard-top"><span className="owner-rank">#{index + 1}</span><span className={`status-pill ${o.status}`}>{o.statusLabel}</span></div>
        <div className="scorecard-name"><strong>{o.owner}</strong><small>{o.count} oportunidades · {o.active} activas</small></div>
        <div className="scorecard-value"><small>Pipeline</small><strong className="numeric-value">{fmtMoneyCompact(o.value)}</strong><span>{o.share}% del total filtrado</span></div>
        <div className="scorecard-bars">
          <div><span>Participación</span><b>{o.share}%</b></div><div className="mini-progress"><span style={{ width: `${Math.max(3, o.value/maxOwnerValue*100)}%` }} /></div>
        </div>
        <div className="scorecard-metrics">
          <span><small>Forecast</small><b>{fmtMoneyCompact(o.weighted)}</b></span>
          <span><small>Aprobado</small><b>{fmtMoneyCompact(o.approved)}</b></span>
          <span><small>Conversión</small><b>{o.winRate}%</b></span>
        </div>
        <em>Ver detalle →</em>
      </a>)}</div>
    </Panel>

    <div className="grid manager-layout command-lower">
      <Panel title="Lectura gerencial de riesgos y concentración">
        <div className="insight-list command-insights">
          <div><small>Mayor concentración</small><strong>{leader?.owner || '—'}</strong><span>{leader ? `${fmtMoneyCompact(leader.value)} en pipeline filtrado` : 'Sin datos'}</span></div>
          <div><small>Etapa crítica</small><strong>{stageLeader?.stage_name || '—'}</strong><span>{stageLeader ? `${concentration}% del valor filtrado concentrado` : 'Sin datos'}</span></div>
          <div><small>Riesgo operativo</small><strong>{pipelineRiskRows.length ? `${pipelineRiskRows.length} por revisar` : 'Sin alertas'}</strong><span>{pipelineRiskRows.length ? 'Requiere seguimiento comercial' : 'Sustentación al día'}</span></div>
        </div>
      </Panel>
      <Panel title="Tendencia comercial disponible">
        <p className="trend-availability-note">{trendAvailabilityNote(trendRows)}</p>
        <div className="pulse-header"><span>Mes</span><span>Ventas aprobadas</span><span>Prospectos</span><span>Cotizaciones</span></div>
        <div className="monthly-bars">{trendRows.map(row => <div className="monthly-row" key={row.period}>
          <div className="monthly-name"><strong>{row.period}</strong><span>{fmtMoneyCompact(row.comision)} comisión proyectada</span></div>
          <div className="pulse-value"><strong className="numeric-value">{fmtMoneyCompact(row.ventas)}</strong><small>ventas aprobadas</small><div className="sales-meter"><span style={{ width: `${Math.max(3, row.ventas/maxMonthlySales*100)}%` }} /></div></div>
          <div className="monthly-track"><small>Prospectos</small><div className="mini-progress"><span style={{ width: `${Math.max(3, row.prospectos/maxMonthly*100)}%` }} /></div><b>{row.prospectos}</b></div>
          <div className="monthly-track quote"><small>Cotizaciones</small><div className="mini-progress"><span style={{ width: `${Math.max(3, row.cotizaciones/maxMonthly*100)}%` }} /></div><b>{row.cotizaciones}</b></div>
        </div>)}</div>
      </Panel>
    </div>
  </section>;
}

function ConsultantDetail({ data, ownerId, personal = false }: { data: Bootstrap; ownerId: string; personal?: boolean }) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [service, setService] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const [personalCriticalSortConfig, setPersonalCriticalSortConfig] = useState<SortConfig<'client'|'stage'|'value'|'next'|'priority'>>({ key: 'value', direction: 'desc' });
  const [consultantMonthlySortConfig, setConsultantMonthlySortConfig] = useState<SortConfig<'month'|'prospects'|'quotes'|'sales'|'commission'>>({ key: 'month', direction: 'desc' });
  const [consultantOpportunitySortConfig, setConsultantOpportunitySortConfig] = useState<SortConfig<'client'|'regional'|'stage'|'product'|'value'|'next'|'inactive'|'priority'>>({ key: 'stage', direction: 'asc' });
  const opportunities = useMemo(() => data.opportunities
    .filter(o => ownerKey(o) === ownerId)
    .sort((a,b) => a.stage_order - b.stage_order || Number(b.offer_value || 0) - Number(a.offer_value || 0)), [data.opportunities, ownerId]);
  const ownerName = opportunities[0]?.owner_name || data.profiles.find(p => p.id === ownerId)?.full_name || 'Sin comercial';
  const monthly = data.monthlyKpis.filter(k => (k.owner_name || 'Sin comercial') === ownerName);
  const sortedConsultantMonthlyRows = [...monthly].sort((a,b) => {
    const value = (k: MonthlyKpi) => consultantMonthlySortConfig.key === 'month' ? (k.period_month || '') : consultantMonthlySortConfig.key === 'prospects' ? Number(k.prospectos || 0) : consultantMonthlySortConfig.key === 'quotes' ? Number(k.cotizaciones || 0) : consultantMonthlySortConfig.key === 'sales' ? Number(k.ventas_aprobadas || 0) : Number(k.comision_proyectada || 0);
    return compareSortValues(value(a), value(b), consultantMonthlySortConfig.direction);
  });
  const sortConsultantMonthlyBy = (key: typeof consultantMonthlySortConfig.key) => setConsultantMonthlySortConfig(current => nextSort(current, key));
  const totals = opportunities.reduce((acc, o) => {
    const value = Number(o.offer_value || 0);
    acc.pipeline += value;
    acc.weighted += Number(o.weighted_pipeline_value || 0);
    if (o.stage_code === 'prospecto') { acc.prospectos += 1; acc.prospectValue += value; }
    if (o.stage_code === 'envio_oferta') { acc.cotizaciones += 1; acc.cotizado += value; }
    if (!isTerminalStage(o.stage_code)) acc.active += 1;
    if (o.stage_code === 'aprobado') { acc.approvedCount += 1; acc.approved += value; }
    const action = nextActionStatus(o);
    if (action.code === 'overdue') acc.overdue += 1;
    if (action.code === 'missing') acc.missingAgenda += 1;
    if (action.code === 'today' || action.code === 'soon') acc.upcoming += 1;
    return acc;
  }, { pipeline: 0, weighted: 0, prospectos: 0, prospectValue: 0, cotizaciones: 0, cotizado: 0, active: 0, approvedCount: 0, approved: 0, overdue: 0, missingAgenda: 0, upcoming: 0 });
  const conversion = totals.pipeline ? Math.round((totals.approved / totals.pipeline) * 100) : 0;
  const stageSummary = data.stages.map(stage => {
    const rows = opportunities.filter(o => o.stage_code === stage.code);
    return {
      stage_code: stage.code,
      stage_name: stage.name,
      stage_order: stage.stage_order,
      opportunities_count: rows.length,
      total_offer_value: rows.reduce((sum, o) => sum + Number(o.offer_value || 0), 0),
      weighted_pipeline_value: rows.reduce((sum, o) => sum + Number(o.weighted_pipeline_value || 0), 0),
    };
  }).filter(s => s.opportunities_count > 0);
  const regionalLeader = topGroup(opportunities.map(o => o.regional_nombre || 'Sin regional'));
  const serviceLeader = topGroup(opportunities.map(o => o.tipo_producto_original || o.service_type_name || 'Sin servicio'));
  const nextActions = opportunities.filter(o => o.next_action_at && !isTerminalStage(o.stage_code)).sort((a,b)=>String(a.next_action_at).localeCompare(String(b.next_action_at)));
  const consultantStageOptions = data.stages.filter(s => opportunities.some(o => o.stage_code === s.code));
  const consultantServiceOptions = data.services.filter(s => opportunities.some(o => o.service_type_code === s.code));
  const filteredOpportunities = opportunities.filter(o => {
    const action = nextActionStatus(o);
    const haystack = `${o.company_name} ${o.sede || ''} ${o.quote_city || ''} ${o.regional_nombre || ''} ${o.tipo_producto_original || ''}`.toLowerCase();
    return (!q || haystack.includes(q.toLowerCase()))
      && (!stage || o.stage_code === stage)
      && (!service || o.service_type_code === service)
      && (!onlyActive || !isTerminalStage(o.stage_code))
      && (!actionFilter || action.code === actionFilter);
  });

  const personalCriticalRows = opportunities
    .map(o => ({ opportunity: o, action: nextActionStatus(o), inactiveDays: daysSince(o.last_interaction_at || o.updated_at || o.created_at) }))
    .filter(row => !isTerminalStage(row.opportunity.stage_code) && (['overdue','missing','today','soon'].includes(row.action.code) || Number(row.inactiveDays || 0) >= 7))
    .sort((a,b) => (a.action.code === 'overdue' ? -1 : b.action.code === 'overdue' ? 1 : 0) || Number(b.opportunity.offer_value || 0) - Number(a.opportunity.offer_value || 0))
    .slice(0, 8);
  const sortedPersonalCriticalRows = [...personalCriticalRows].sort((a,b) => {
    const value = (row: typeof personalCriticalRows[number]) => personalCriticalSortConfig.key === 'client' ? row.opportunity.company_name : personalCriticalSortConfig.key === 'stage' ? row.opportunity.stage_order : personalCriticalSortConfig.key === 'value' ? Number(row.opportunity.offer_value || 0) : personalCriticalSortConfig.key === 'next' ? (row.opportunity.next_action_at || '') : row.action.label;
    return compareSortValues(value(a), value(b), personalCriticalSortConfig.direction);
  });
  const sortPersonalCriticalBy = (key: typeof personalCriticalSortConfig.key) => setPersonalCriticalSortConfig(current => nextSort(current, key));
  const sortedConsultantOpportunities = [...filteredOpportunities].sort((a,b) => {
    const value = (o: Opportunity) => consultantOpportunitySortConfig.key === 'client' ? o.company_name : consultantOpportunitySortConfig.key === 'regional' ? (o.regional_nombre || '') : consultantOpportunitySortConfig.key === 'stage' ? o.stage_order : consultantOpportunitySortConfig.key === 'product' ? (o.tipo_producto_original || o.service_type_name || '') : consultantOpportunitySortConfig.key === 'value' ? Number(o.offer_value || 0) : consultantOpportunitySortConfig.key === 'next' ? (o.next_action_at || '') : consultantOpportunitySortConfig.key === 'inactive' ? Number(daysSince(o.last_interaction_at || o.updated_at || o.created_at) || 0) : nextActionStatus(o).detail;
    return compareSortValues(value(a), value(b), consultantOpportunitySortConfig.direction);
  });
  const sortConsultantOpportunityBy = (key: typeof consultantOpportunitySortConfig.key) => setConsultantOpportunitySortConfig(current => nextSort(current, key));
  const personalGoalRows = buildGoalVsActualRows(data, [new Date().toISOString().slice(0, 7)], ownerId);
  const personalPriorityText = totals.overdue
    ? `Resolver ${totals.overdue} gestiones vencidas antes de crear nuevo pipeline.`
    : totals.missingAgenda
      ? `Asignar próxima acción a ${totals.missingAgenda} oportunidades sin agenda.`
      : personalCriticalRows.length
        ? `Revisar ${personalCriticalRows.length} oportunidades críticas de hoy.`
        : 'Mantener seguimiento vigente y avanzar cierres próximos.';

  if (!opportunities.length) return <section className="stack"><div className="notice">No encontré oportunidades asociadas a este consultor.</div><button className="secondary" onClick={() => go('#/dashboard')}>Volver al dashboard gerencial</button></section>;

  return <section className="stack consultant-dashboard">
    <section className="executive-hero consultant-hero">
      <div>
        <span className="eyebrow">{personal ? 'Mi tablero comercial' : 'Detalle por consultor'}</span>
        <h2>{personal ? 'Mi gestión comercial' : ownerName}</h2>
        <p>{personal ? `Hola ${ownerName}. Este tablero prioriza tus gestiones de hoy, tus oportunidades críticas, tu avance contra meta y tu pipeline activo.` : 'Vista consolidada de lo cotizado, prospectos, oportunidades activas, ventas aprobadas, forecast, próxima gestión e indicadores operativos del consultor.'}</p>
      </div>
      <div className="hero-facts">
        <div><small>Total pipeline</small><strong>{fmtMoneyCompact(totals.pipeline)}</strong></div>
        <div><small>Oportunidades activas</small><strong>{totals.active}</strong></div>
        <div><small>Conversión aprobada</small><strong>{conversion}%</strong></div>
      </div>
    </section>
    <div className="actions-row">{!personal && <button className="secondary" onClick={() => go('#/dashboard')}>← Dashboard gerencial</button>}<button onClick={() => go(`#/opportunities`)}>Ver mis oportunidades</button><button className="secondary" onClick={() => go('#/goals')}>Ver mis metas</button></div>
    {personal && <div className="personal-dashboard">
      <Panel title="Mi prioridad de hoy"><div className="personal-priority-grid"><div><small>Acción recomendada</small><strong>{personalPriorityText}</strong></div><div><small>Gestión pendiente</small><strong>{totals.overdue} vencidas · {totals.missingAgenda} sin agenda</strong></div></div></Panel>
      <Panel title="Mi avance contra meta"><GoalVsActualDashboard rows={personalGoalRows} /></Panel>
      <Panel title="Mis oportunidades críticas">{personalCriticalRows.length ? <div className="tablewrap"><table><thead><tr><SortableTh label="Cliente" sortKey="client" sortConfig={personalCriticalSortConfig} onSort={sortPersonalCriticalBy}/><SortableTh label="Etapa" sortKey="stage" sortConfig={personalCriticalSortConfig} onSort={sortPersonalCriticalBy}/><SortableTh label="Valor" sortKey="value" sortConfig={personalCriticalSortConfig} onSort={sortPersonalCriticalBy}/><SortableTh label="Próxima acción" sortKey="next" sortConfig={personalCriticalSortConfig} onSort={sortPersonalCriticalBy}/><SortableTh label="Prioridad" sortKey="priority" sortConfig={personalCriticalSortConfig} onSort={sortPersonalCriticalBy}/></tr></thead><tbody>{sortedPersonalCriticalRows.map(row => <tr key={row.opportunity.id} className="clickable" onClick={() => go(`#/detail/${row.opportunity.id}`)}><td><strong>{row.opportunity.company_name}</strong></td><td><Badge tone={stageTone(row.opportunity.stage_code)}>{row.opportunity.stage_name}</Badge></td><td>{fmtMoneyCompact(row.opportunity.offer_value)}</td><td>{row.opportunity.next_action_at ? fmtDate(row.opportunity.next_action_at) : 'Sin agenda'}</td><td><Badge tone={row.action.tone}>{row.action.label}</Badge></td></tr>)}</tbody></table></div> : <EmptyState title="Sin críticas inmediatas" text="No hay vencidas, sin agenda ni gestiones urgentes con tus filtros actuales." />}</Panel>
    </div>}

    <div className="grid kpis manager-kpis consultant-kpis">
      <Kpi icon="Σ" tone="blue" label="Total oportunidades" value={String(opportunities.length)} hint={`${totals.active} activas`} meta="Asignadas al consultor" />
      <Kpi icon="◎" tone="indigo" label="Prospectos" value={String(totals.prospectos)} hint={fmtMoneyCompact(totals.prospectValue)} meta={fmtMoney(totals.prospectValue)} />
      <Kpi icon="$" tone="purple" label="Cotizado" value={fmtMoneyCompact(totals.cotizado)} hint={`${totals.cotizaciones} en envío de oferta`} meta={fmtMoney(totals.cotizado)} />
      <Kpi icon="!" tone={totals.overdue || totals.missingAgenda ? 'amber' : 'green'} label="Gestión pendiente" value={String(totals.overdue + totals.missingAgenda)} hint={`${totals.overdue} vencidas · ${totals.missingAgenda} sin agenda`} meta={`${totals.upcoming} próximas`} />
      <Kpi icon="✓" tone="green" label="Aprobado / ganado" value={fmtMoneyCompact(totals.approved)} hint={`${totals.approvedCount} oportunidades`} meta={fmtMoney(totals.approved)} />
    </div>
    <div className="grid consultant-layout">
      <Panel title="Detalle por etapa"><StageBars summary={stageSummary} /></Panel>
      <Panel title="Indicadores del consultor">
        <div className="insight-list">
          <div><small>Regional principal</small><strong>{regionalLeader.label}</strong><span>{regionalLeader.count} oportunidades</span></div>
          <div><small>Servicio / producto más frecuente</small><strong>{serviceLeader.label}</strong><span>{serviceLeader.count} oportunidades</span></div>
          <div><small>Próxima gestión</small><strong>{nextActions[0] ? fmtDate(nextActions[0].next_action_at) : 'Sin agenda'}</strong><span>{nextActions[0]?.company_name || 'No hay próxima acción registrada'}</span></div>
        </div>
      </Panel>
    </div>
    <Panel title="KPIs mensuales del consultor">
      {monthly.length ? <div className="tablewrap"><table><thead><tr><SortableTh label="Mes" sortKey="month" sortConfig={consultantMonthlySortConfig} onSort={sortConsultantMonthlyBy}/><SortableTh label="Prospectos" sortKey="prospects" sortConfig={consultantMonthlySortConfig} onSort={sortConsultantMonthlyBy}/><SortableTh label="Cotizaciones" sortKey="quotes" sortConfig={consultantMonthlySortConfig} onSort={sortConsultantMonthlyBy}/><SortableTh label="Ventas aprobadas" sortKey="sales" sortConfig={consultantMonthlySortConfig} onSort={sortConsultantMonthlyBy}/><SortableTh label="Comisión proyectada" sortKey="commission" sortConfig={consultantMonthlySortConfig} onSort={sortConsultantMonthlyBy}/></tr></thead><tbody>{sortedConsultantMonthlyRows.slice(0,12).map((k,i)=><tr key={`${k.owner_name}-${k.period_month}-${i}`}><td>{fmtDate(k.period_month)}</td><td>{k.prospectos}</td><td>{k.cotizaciones}</td><td>{fmtMoneyCompact(k.ventas_aprobadas)}</td><td>{fmtMoneyCompact(k.comision_proyectada)}</td></tr>)}</tbody></table></div> : <p className="muted">Sin KPIs mensuales para este consultor.</p>}
    </Panel>
    <Panel title="Oportunidades del consultor">
      <div className="consultant-opportunity-filters filters">
        <input placeholder="Buscar cliente, sede, ciudad o servicio…" value={q} onChange={e=>setQ(e.target.value)} />
        <Select value={stage} onChange={setStage} options={consultantStageOptions.map(s=>[s.code,s.name])} empty="Todas las etapas" />
        <Select value={service} onChange={setService} options={consultantServiceOptions.map(s=>[s.code,s.name])} empty="Todos los servicios" />
        <Select value={actionFilter} onChange={setActionFilter} options={[["missing","Sin agenda"],["overdue","Vencidas"],["today","Hoy"],["soon","Próximas"],["scheduled","Agendadas"]]} empty="Todas las gestiones" />
        <label className="check-filter"><input type="checkbox" checked={onlyActive} onChange={e=>setOnlyActive(e.target.checked)} /> Solo activas</label>
        <button className="secondary" onClick={()=>{ setQ(''); setStage(''); setService(''); setActionFilter(''); setOnlyActive(true); }}>Limpiar filtros</button>
      </div>
      <p className="muted consultant-filter-summary"><strong>{filteredOpportunities.length}</strong> de {opportunities.length} oportunidades del consultor.</p>
      <div className="tablewrap"><table><thead><tr><SortableTh label="Cliente" sortKey="client" sortConfig={consultantOpportunitySortConfig} onSort={sortConsultantOpportunityBy}/><SortableTh label="Regional" sortKey="regional" sortConfig={consultantOpportunitySortConfig} onSort={sortConsultantOpportunityBy}/><SortableTh label="Etapa" sortKey="stage" sortConfig={consultantOpportunitySortConfig} onSort={sortConsultantOpportunityBy}/><SortableTh label="Tipo producto" sortKey="product" sortConfig={consultantOpportunitySortConfig} onSort={sortConsultantOpportunityBy}/><SortableTh label="Valor" sortKey="value" sortConfig={consultantOpportunitySortConfig} onSort={sortConsultantOpportunityBy}/><SortableTh label="Próxima acción" sortKey="next" sortConfig={consultantOpportunitySortConfig} onSort={sortConsultantOpportunityBy}/><SortableTh label="Días sin seguimiento" sortKey="inactive" sortConfig={consultantOpportunitySortConfig} onSort={sortConsultantOpportunityBy}/><SortableTh label="Prioridad" sortKey="priority" sortConfig={consultantOpportunitySortConfig} onSort={sortConsultantOpportunityBy}/></tr></thead><tbody>{sortedConsultantOpportunities.map(o => {
        const action = nextActionStatus(o);
        const inactiveDays = daysSince(o.last_interaction_at || o.updated_at || o.created_at);
        return <tr key={o.id} className={`clickable action-${action.code}`} onClick={() => go(`#/detail/${o.id}`)}><td><strong>{o.company_name}</strong><br/><small>{o.sede || o.quote_city || '—'}</small></td><td>{o.regional_nombre || '—'}</td><td><Badge tone={stageTone(o.stage_code)}>{o.stage_name}</Badge></td><td>{o.tipo_producto_original || o.service_type_name || '—'}</td><td>{fmtMoney(o.offer_value)}</td><td><Badge tone={action.tone}>{action.label}</Badge><br/><small>{o.next_action_at ? fmtDate(o.next_action_at) : action.detail}</small></td><td>{inactiveDays === null ? '—' : `${inactiveDays} día(s)`}</td><td>{action.detail}</td></tr>;
      })}</tbody></table></div>
    </Panel>
  </section>;
}
function CommercialAlerts({ data }: { data: Bootstrap }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(hashQueryParam('status'));
  const [owner, setOwner] = useState(hashQueryParam('owner'));
  const [regional, setRegional] = useState(hashQueryParam('regional'));
  const [stage, setStage] = useState(hashQueryParam('stage'));
  const [service, setService] = useState(hashQueryParam('service'));
  const [hideClosed, setHideClosed] = useState(true);
  const [sortConfig, setSortConfig] = useState<SortConfig<'alert'|'client'|'owner'|'stage'|'value'|'next'|'inactive'|'action'>>({ key: 'alert', direction: 'asc' });
  const [lowGoalSortConfig, setLowGoalSortConfig] = useState<SortConfig<'owner'|'month'|'sales'|'goal'|'status'>>({ key: 'status', direction: 'asc' });

  const active = data.opportunities.filter(o => !isTerminalStage(o.stage_code));
  const alertRows = active.map(o => {
    const action = nextActionStatus(o);
    const inactiveDays = daysSince(o.last_interaction_at || o.updated_at || o.created_at);
    const stalledSustentacion = o.stage_code === 'sustentacion' && Number(inactiveDays || 0) > 5;
    const closeDate = o.expected_close_date ? new Date(o.expected_close_date) : null;
    const closingSoon = !!closeDate && !Number.isNaN(closeDate.getTime()) && closeDate >= startOfToday() && closeDate <= (() => { const d = startOfToday(); d.setDate(d.getDate() + 30); return d; })();
    const highValueStalled = Number(o.offer_value || 0) >= 250_000_000 && Number(inactiveDays || 0) >= 10;
    const alertCode = stalledSustentacion && ['scheduled','soon'].includes(action.code) ? 'stalled' : action.code;
    const alertLabel = alertCode === 'stalled' ? 'Sustentación estancada' : action.label;
    const alertTone = alertCode === 'stalled' ? 'danger' : action.tone;
    const priority = alertCode === 'overdue' ? 1 : alertCode === 'missing' ? 2 : alertCode === 'stalled' ? 3 : alertCode === 'today' ? 4 : alertCode === 'soon' ? 5 : 9;
    return { opportunity: o, action, inactiveDays, stalledSustentacion, closingSoon, highValueStalled, alertCode, alertLabel, alertTone, priority };
  }).sort((a,b) => a.priority - b.priority || Number(b.opportunity.offer_value || 0) - Number(a.opportunity.offer_value || 0));

  const lowGoalRows = data.goals.map(g => {
    const profile = data.profiles.find(p => p.id === g.user_id);
    const kpi = data.monthlyKpis.find(k => k.owner_id === g.user_id && k.period_month === g.period_month);
    const sales = Number(kpi?.ventas_aprobadas || 0);
    const budget = Number(g.sales_budget || 0);
    const pct = budget ? Math.round((sales / budget) * 100) : null;
    return { goal: g, profile, sales, budget, pct };
  }).filter(r => r.pct !== null && Number(r.pct) < 80);
  const sortedLowGoalRows = [...lowGoalRows].sort((a,b) => {
    const value = (row: typeof lowGoalRows[number]) => lowGoalSortConfig.key === 'owner' ? (row.profile?.full_name || '') : lowGoalSortConfig.key === 'month' ? (row.goal.period_month || '') : lowGoalSortConfig.key === 'sales' ? row.sales : lowGoalSortConfig.key === 'goal' ? row.budget : Number(row.pct || 0);
    return compareSortValues(value(a), value(b), lowGoalSortConfig.direction);
  });
  const sortLowGoalBy = (key: typeof lowGoalSortConfig.key) => setLowGoalSortConfig(current => nextSort(current, key));

  const alertCards = [
    { label: 'Acciones críticas', value: alertRows.filter(r => ['overdue','missing','stalled'].includes(r.alertCode)).length, detail: 'Vencidas, sin agenda o estancadas', tone: 'danger' },
    { label: 'Sin próxima acción', value: alertRows.filter(r => r.alertCode === 'missing').length, detail: 'Oportunidades activas sin agenda', tone: 'amber' },
    { label: 'Vencidas', value: alertRows.filter(r => r.alertCode === 'overdue').length, detail: 'Gestión programada ya vencida', tone: 'danger' },
    { label: 'Sustentación estancada', value: alertRows.filter(r => r.alertCode === 'stalled').length, detail: 'Más de 5 días sin gestión', tone: 'danger' },
    { label: 'Bajo cumplimiento', value: lowGoalRows.length, detail: 'Metas por debajo de 80%', tone: lowGoalRows.length ? 'amber' : 'success' },
  ];

  const ownerOptions = data.profiles.filter(p => active.some(o => o.owner_id === p.id)).map(p => [p.id, p.full_name]);
  const alertRegionalOptions = uniq(active.map(o => o.regional_nombre)).map(r => [r, r]);
  const stageOptions = data.stages.filter(s => active.some(o => o.stage_code === s.code)).map(s => [s.code, s.name]);
  const alertServiceOptions = data.services.map(s => [s.code, s.name]);
  const statusOptions = [['missing','Sin agenda'],['overdue','Vencidas'],['closing_soon','Cierre próximo'],['high_value_stalled','Alto valor estancado'],['stalled','Sustentación estancada'],['today','Hoy'],['soon','Próximas'],['scheduled','Agendadas']];
  const filteredAlerts = alertRows.filter(row => {
    const o = row.opportunity;
    const haystack = `${o.company_name} ${o.owner_name || ''} ${o.regional_nombre || ''} ${o.sede || ''} ${o.quote_city || ''} ${o.tipo_producto_original || ''}`.toLowerCase();
    const isOperationalAlert = ['missing','overdue','stalled','today','soon'].includes(row.alertCode) || row.closingSoon || row.highValueStalled;
    return (!q || haystack.includes(q.toLowerCase()))
      && (!status || row.alertCode === status || (status === 'closing_soon' && row.closingSoon) || (status === 'high_value_stalled' && row.highValueStalled))
      && (!owner || o.owner_id === owner)
      && (!regional || o.regional_nombre === regional)
      && (!stage || o.stage_code === stage)
      && (!service || o.service_type_code === service)
      && (!hideClosed || !isTerminalStage(o.stage_code))
      && (status === 'scheduled' || isOperationalAlert);
  });
  const sortedFilteredAlerts = [...filteredAlerts].sort((a,b) => {
    const value = (row: typeof filteredAlerts[number]) => sortConfig.key === 'alert' ? row.priority : sortConfig.key === 'client' ? row.opportunity.company_name : sortConfig.key === 'owner' ? (row.opportunity.owner_name || '') : sortConfig.key === 'stage' ? (row.opportunity.stage_order || 0) : sortConfig.key === 'value' ? Number(row.opportunity.offer_value || 0) : sortConfig.key === 'next' ? (row.opportunity.next_action_at || '') : sortConfig.key === 'inactive' ? Number(row.inactiveDays || 0) : row.action.detail;
    return compareSortValues(value(a), value(b), sortConfig.direction);
  });
  const sortBy = (key: typeof sortConfig.key) => setSortConfig(current => nextSort(current, key));

  return <section className="stack alerts-dashboard">
    <section className="executive-hero alerts-hero">
      <div>
        <span className="eyebrow">Estado de gestión</span>
        <h2>Alertas comerciales</h2>
        <p>Centro operativo para priorizar oportunidades activas: vencidas, sin próxima acción, próximas gestiones, sustentación estancada y cumplimiento bajo meta.</p>
      </div>
      <div className="hero-facts">
        <div><small>Alertas visibles</small><strong>{filteredAlerts.length}</strong></div>
        <div><small>Oportunidades activas</small><strong>{active.length}</strong></div>
        <div><small>Bajo cumplimiento</small><strong>{lowGoalRows.length}</strong></div>
      </div>
    </section>
    <div className="alert-cards">
      {alertCards.map(card => <div className={`alert-card alert-${card.tone}`} key={card.label}><small>{card.label}</small><strong>{card.value}</strong><span>{card.detail}</span></div>)}
    </div>
    <Panel title="Filtros de gestión">
      <div className="filters alerts-filters">
        <input placeholder="Buscar cliente, comercial, sede, ciudad o servicio…" value={q} onChange={e=>setQ(e.target.value)} />
        <Select value={status} onChange={setStatus} options={statusOptions} empty="Todas las alertas" />
        <Select value={owner} onChange={setOwner} options={ownerOptions} empty="Todos los comerciales" />
        <Select value={regional} onChange={setRegional} options={alertRegionalOptions} empty="Todas las regionales" />
        <Select value={stage} onChange={setStage} options={stageOptions} empty="Todas las etapas" />
        <Select value={service} onChange={setService} options={alertServiceOptions} empty="Todos los servicios" />
        <label className="check-filter"><input type="checkbox" checked={hideClosed} onChange={e=>setHideClosed(e.target.checked)} /> Solo activas</label>
        <button className="secondary" onClick={()=>{ setQ(''); setStatus(''); setOwner(''); setRegional(''); setStage(''); setService(''); setHideClosed(true); }}>Limpiar filtros</button>
      </div>
      <div className="filter-summary alert-filter-summary"><strong>{filteredAlerts.length}</strong> alertas operativas visibles · {active.length} oportunidades activas base</div>
    </Panel>
    <Panel title="Bandeja de alertas">
      <p className="muted">Mostrando {filteredAlerts.length} oportunidades que requieren decisión o seguimiento. Click en una fila para abrir el detalle.</p>
      <div className="tablewrap alert-table"><table><thead><tr><SortableTh label="Alerta" sortKey="alert" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Cliente" sortKey="client" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Comercial" sortKey="owner" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Etapa" sortKey="stage" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Valor" sortKey="value" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Próxima acción" sortKey="next" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Días sin seguimiento" sortKey="inactive" sortConfig={sortConfig} onSort={sortBy}/><SortableTh label="Acción sugerida" sortKey="action" sortConfig={sortConfig} onSort={sortBy}/></tr></thead><tbody>{sortedFilteredAlerts.map(row => {
        const o = row.opportunity;
        return <tr key={o.id} className={`clickable alert-row alert-row-${row.alertCode}`} onClick={() => go(`#/detail/${o.id}`)}><td><Badge tone={row.alertTone}>{row.alertLabel}</Badge></td><td><strong>{o.company_name || 'Sin cliente'}</strong><br/><small>{o.regional_nombre || o.sede || o.quote_city || 'Sin regional/sede'}</small></td><td>{o.owner_name || 'Sin comercial'}</td><td><Badge tone={stageTone(o.stage_code)}>{o.stage_name || 'Sin etapa'}</Badge></td><td>{fmtMoney(o.offer_value)}</td><td>{o.next_action_at ? fmtDate(o.next_action_at) : 'Sin agenda'}</td><td>{row.inactiveDays === null ? '—' : `${row.inactiveDays} día(s)`}</td><td>{row.alertCode === 'missing' ? 'Programar próxima gestión' : row.alertCode === 'overdue' ? 'Gestionar vencida' : status === 'closing_soon' ? 'Preparar decisión / cierre' : status === 'high_value_stalled' ? 'Escalar bloqueo comercial' : row.alertCode === 'stalled' ? 'Revisar sustentación' : row.action.detail}</td></tr>;
      })}</tbody></table></div>
    </Panel>
    <Panel title="Cumplimiento bajo 80%">
      {lowGoalRows.length ? <div className="tablewrap"><table><thead><tr><SortableTh label="Comercial" sortKey="owner" sortConfig={lowGoalSortConfig} onSort={sortLowGoalBy}/><SortableTh label="Mes" sortKey="month" sortConfig={lowGoalSortConfig} onSort={sortLowGoalBy}/><SortableTh label="Ventas" sortKey="sales" sortConfig={lowGoalSortConfig} onSort={sortLowGoalBy}/><SortableTh label="Meta" sortKey="goal" sortConfig={lowGoalSortConfig} onSort={sortLowGoalBy}/><SortableTh label="Cumplimiento" sortKey="status" sortConfig={lowGoalSortConfig} onSort={sortLowGoalBy}/></tr></thead><tbody>{sortedLowGoalRows.map(row => <tr key={`${row.goal.user_id}-${row.goal.period_month}`}><td>{row.profile?.full_name || 'Sin comercial'}</td><td>{fmtDate(row.goal.period_month)}</td><td>{fmtMoney(row.sales)}</td><td>{fmtMoney(row.budget)}</td><td><Badge tone="amber">{row.pct}%</Badge></td></tr>)}</tbody></table></div> : <EmptyState title="Sin alertas de cumplimiento" text="Cuando se carguen metas reales, aquí aparecerán comerciales por debajo del 80%." />}
    </Panel>
  </section>;
}


type CentinelOwnerSummaryRow = { owner: string; count: number; value: number; nextStep: string };
type CentinelGoalComplianceRow = { owner: string; period: string; budget: number; approved: number; compliance: number; gap: number };
type CentinelResult = { title: string; summary: string; rows: Opportunity[]; tenderRows?: PublicTender[]; ownerSummaryRows?: CentinelOwnerSummaryRow[]; goalComplianceRows?: CentinelGoalComplianceRow[]; cards: Array<{ label: string; value: string; detail: string }>; mode: 'alerts' | 'pipeline' | 'goals' | 'stalled' | 'large' | 'risk' | 'tenders' | 'search' };

const centinelQuickActionGroups = [
  { title: 'Consultas comerciales', actions: [
    { label: 'Oportunidades sin agenda', prompt: 'Muéstrame oportunidades sin agenda por comercial' },
    { label: 'Pipeline por etapa', prompt: 'Muéstrame pipeline por etapa y valor ponderado' },
    { label: 'Clientes en sustentación', prompt: 'Muéstrame clientes en sustentación con días sin seguimiento' },
    { label: 'Próximas gestiones', prompt: 'Muéstrame próximas gestiones de esta semana' },
    { label: 'Oportunidades grandes', prompt: 'Muéstrame oportunidades grandes en negociación o sustentación' },
  ]},
  { title: 'Gestión gerencial', actions: [
    { label: 'Cumplimiento de metas', prompt: 'Muéstrame cumplimiento de metas por comercial' },
  ]},
  { title: 'Licitaciones', actions: [
    { label: 'Licitaciones para revisar hoy', prompt: 'Qué licitaciones debe revisar Katherine hoy' },
    { label: 'Licitaciones alto valor', prompt: 'Qué licitaciones de alto valor siguen sin decisión' },
    { label: 'Licitaciones convertidas', prompt: 'Qué licitaciones se convirtieron en oportunidad' },
  ]},
];

function isLargeOpportunityQuery(q: string) {
  return q.includes('grande') || q.includes('mayor valor') || q.includes('más valor') || q.includes('mas valor') || q.includes('alto valor') || q.includes('top oportunidad') || q.includes('importante');
}

function isRiskFollowUpQuery(q: string) {
  return q.includes('muchos días') || q.includes('muchos dias') || q.includes('sin seguimiento') || q.includes('abandonad') || q.includes('atrasad') || q.includes('riesgo') || q.includes('vencid');
}

function isTenderQuery(q: string) {
  return q.includes('licitacion') || q.includes('licitación') || q.includes('licitaciones') || q.includes('secop') || q.includes('tvec') || q.includes('katherine');
}

function isConvertedTenderQuery(q: string) {
  return q.includes('convertid') || q.includes('oportunidad');
}

function isHighValueTenderQuery(q: string) {
  return q.includes('alto valor') || q.includes('mayor valor') || q.includes('más valor') || q.includes('mas valor') || q.includes('grande') || q.includes('sin decisión') || q.includes('sin decision');
}

function isOpenTender(tender: PublicTender) {
  const status = tender.internal_status || 'nueva';
  return status !== 'descartada' && status !== 'convertida_oportunidad' && !tender.converted_opportunity_id;
}

function tenderDecisionPriority(tender: PublicTender) {
  const urgent = tender.days !== null && tender.days !== undefined && tender.days <= 7;
  return (tender.section === 'hacer' ? 0 : tender.section === 'revisar' ? 1 : 2) + (urgent ? -1 : 0);
}

function interpretTenderCentinelQuery(query: string, centinelTenderPayload: TenderRadarPayload | null): CentinelResult {
  const q = query.toLowerCase();
  if (!centinelTenderPayload) {
    return { mode: 'tenders', title: 'Radar de licitaciones no disponible', summary: 'Vig-IA no tiene el radar de licitaciones cargado todavía. La consulta comercial sigue disponible; para licitaciones intenta reintentar la carga o abre el radar.', rows: [], tenderRows: [], cards: [
      { label: 'Radar', value: 'Sin cargar', detail: 'Datos SECOP/Supabase no disponibles todavía' },
      { label: 'Modo', value: 'Solo lectura', detail: 'No modifica estados ni oportunidades' },
      { label: 'Siguiente paso', value: 'Licitaciones', detail: 'Abrir radar de licitaciones' },
    ] };
  }
  const tenders = centinelTenderPayload.tenders || [];
  const open = tenders.filter(isOpenTender);
  const converted = tenders.filter(t => t.internal_status === 'convertida_oportunidad' || t.converted_opportunity_id);
  const highOpen = open.filter(t => Number(t.value || 0) >= 500_000_000).sort((a,b) => Number(b.value || 0) - Number(a.value || 0));
  const dueSoon = open.filter(t => t.days !== null && t.days !== undefined && t.days <= 7).length;

  if (isConvertedTenderQuery(q)) {
    const rows = converted.sort((a,b) => String(b.reviewed_at || b.last_seen_at || '').localeCompare(String(a.reviewed_at || a.last_seen_at || '')) || Number(b.value || 0) - Number(a.value || 0));
    return { mode: 'tenders', title: 'Licitaciones convertidas', summary: 'Procesos públicos que ya fueron conectados con oportunidades comerciales para evitar doble creación.', rows: [], tenderRows: rows, cards: [
      { label: 'Convertidas', value: String(rows.length), detail: 'Ya tienen oportunidad asociada' },
      { label: 'Valor convertido', value: fmtMoneyCompact(rows.reduce((s,t)=>s+Number(t.value||0),0)), detail: 'Valor base de procesos convertidos' },
      { label: 'Última conversión', value: rows[0] ? fmtDate(rows[0].reviewed_at || rows[0].last_seen_at) : '—', detail: rows[0]?.entity || 'Sin conversiones registradas' },
    ] };
  }

  if (isHighValueTenderQuery(q)) {
    return { mode: 'tenders', title: 'Licitaciones de alto valor sin decisión', summary: 'Procesos abiertos de $500M+ COP que todavía no están descartados ni convertidos. Prioridad para decisión gerencial o de Katherine.', rows: [], tenderRows: highOpen, cards: [
      { label: 'Alto valor abiertas', value: String(highOpen.length), detail: '$500M+ COP sin decisión final' },
      { label: 'Valor en decisión', value: fmtMoneyCompact(highOpen.reduce((s,t)=>s+Number(t.value||0),0)), detail: 'Suma de procesos abiertos de alto valor' },
      { label: 'Con cierre cercano', value: String(highOpen.filter(t => t.days !== null && t.days !== undefined && t.days <= 7).length), detail: '7 días o menos' },
    ] };
  }

  const rows = open
    .filter(t => t.section === 'hacer' || t.internal_status === 'nueva' || t.internal_status === 'en_revision')
    .sort((a,b) => tenderDecisionPriority(a) - tenderDecisionPriority(b) || Number(b.score || 0) - Number(a.score || 0) || Number(b.value || 0) - Number(a.value || 0));
  return { mode: 'tenders', title: 'Licitaciones para revisar hoy', summary: 'Bandeja priorizada de procesos públicos abiertos: primero Hacer hoy, cierres cercanos, mayor score y mayor valor.', rows: [], tenderRows: rows, cards: [
    { label: 'Para revisar', value: String(rows.length), detail: 'Abiertas sin decisión final' },
    { label: 'Hacer hoy', value: String(open.filter(t => t.section === 'hacer').length), detail: 'Prioridad del radar' },
    { label: 'Cierre cercano', value: String(dueSoon), detail: '7 días o menos' },
  ] };
}

function buildCentinelOwnerSummaryRows(rows: Opportunity[], nextStep = 'Programar próxima gestión'): CentinelOwnerSummaryRow[] {
  const grouped = rows.reduce((map, opportunity) => {
    const owner = opportunity.owner_name || 'Sin comercial';
    const current = map.get(owner) || { owner, count: 0, value: 0, nextStep };
    current.count += 1;
    current.value += Number(opportunity.offer_value || 0);
    map.set(owner, current);
    return map;
  }, new Map<string, CentinelOwnerSummaryRow>());
  return Array.from(grouped.values()).sort((a,b) => b.count - a.count || b.value - a.value);
}

function buildCentinelGoalComplianceRows(data: Bootstrap): CentinelGoalComplianceRow[] {
  return data.goals.map(goal => {
    const period = String(goal.period_month).slice(0, 7);
    const approved = data.monthlyKpis
      .filter(kpi => kpi.owner_id === goal.user_id && String(kpi.period_month).slice(0, 7) === period)
      .reduce((sum, kpi) => sum + Number(kpi.ventas_aprobadas || 0), 0);
    const budget = Number(goal.sales_budget || 0);
    return {
      owner: data.profiles.find(profile => profile.id === goal.user_id)?.full_name || 'Sin comercial',
      period,
      budget,
      approved,
      compliance: budget ? Math.round((approved / budget) * 100) : 0,
      gap: Math.max(0, budget - approved),
    };
  }).sort((a,b) => a.compliance - b.compliance || b.gap - a.gap);
}

function interpretCentinelQuery(query: string, data: Bootstrap, centinelTenderPayload: TenderRadarPayload | null = null): CentinelResult {
  const q = query.toLowerCase();
  if (isTenderQuery(q)) return interpretTenderCentinelQuery(query, centinelTenderPayload);
  const active = data.opportunities.filter(o => !isTerminalStage(o.stage_code));
  const baseRows = active.map(o => ({ o, action: nextActionStatus(o), inactiveDays: daysSince(o.last_interaction_at || o.updated_at || o.created_at) }));

  if (q.includes('sin agenda') || q.includes('sin próxima') || q.includes('sin proxima')) {
    const rows = baseRows.filter(r => r.action.code === 'missing').map(r => r.o).sort((a,b) => Number(b.offer_value || 0) - Number(a.offer_value || 0));
    const owners = topGroup(rows.map(o => o.owner_name || 'Sin comercial'));
    return { mode: 'alerts', title: 'Oportunidades sin agenda', summary: 'Oportunidades activas que todavía no tienen próxima gestión registrada. Primero se muestra el resumen por comercial y luego el detalle.', rows, ownerSummaryRows: buildCentinelOwnerSummaryRows(rows), cards: [
      { label: 'Sin agenda', value: String(rows.length), detail: 'Requieren fecha de próxima gestión' },
      { label: 'Comercial con más casos', value: owners.label, detail: `${owners.count} oportunidades` },
      { label: 'Valor en revisión', value: fmtMoneyCompact(rows.reduce((s,o)=>s+Number(o.offer_value||0),0)), detail: 'Pipeline sin siguiente paso' },
    ] };
  }

  if (isLargeOpportunityQuery(q)) {
    const restrictAdvancedStages = q.includes('negociación') || q.includes('negociacion') || q.includes('sustentación') || q.includes('sustentacion');
    const rows = active
      .filter(o => !restrictAdvancedStages || ['negociacion','sustentacion'].includes(o.stage_code || ''))
      .sort((a,b) => Number(b.offer_value || 0) - Number(a.offer_value || 0));
    const stageLeader = topGroup(rows.slice(0, 20).map(o => o.stage_name || 'Sin etapa'));
    return { mode: 'large', title: 'Oportunidades de mayor valor', summary: 'Oportunidades activas ordenadas por valor para priorizar revisión comercial y gerencial.', rows, cards: [
      { label: 'Top oportunidades', value: String(rows.length), detail: restrictAdvancedStages ? 'En negociación o sustentación' : 'Activas ordenadas por valor' },
      { label: 'Mayor oportunidad', value: fmtMoneyCompact(rows[0]?.offer_value || 0), detail: rows[0]?.company_name || 'Sin datos' },
      { label: 'Etapa más común del top', value: stageLeader.label, detail: `${stageLeader.count} oportunidades en el top 20` },
    ] };
  }

  if (isRiskFollowUpQuery(q)) {
    const rows = baseRows
      .filter(r => r.action.code === 'missing' || r.action.code === 'overdue' || Number(r.inactiveDays || 0) >= 5)
      .sort((a,b) => Number(b.inactiveDays || 0) - Number(a.inactiveDays || 0) || Number(b.o.offer_value || 0) - Number(a.o.offer_value || 0))
      .map(r => r.o);
    const owners = topGroup(rows.map(o => o.owner_name || 'Sin comercial'));
    return { mode: 'risk', title: 'Seguimiento en riesgo', summary: 'Oportunidades activas con señales de atraso: sin agenda, gestión vencida o varios días sin seguimiento.', rows, cards: [
      { label: 'En riesgo', value: String(rows.length), detail: 'Sin agenda, vencidas o con 5+ días' },
      { label: 'Vencidas', value: String(baseRows.filter(r => r.action.code === 'overdue').length), detail: 'Próxima gestión ya pasó' },
      { label: 'Comercial con más casos', value: owners.label, detail: `${owners.count} oportunidades` },
    ] };
  }

  if (q.includes('pipeline') || q.includes('etapa') || q.includes('embudo')) {
    const rows = [...active].sort((a,b) => a.stage_order - b.stage_order || Number(b.offer_value || 0) - Number(a.offer_value || 0));
    const leader = [...data.summary].sort((a,b)=>Number(b.total_offer_value||0)-Number(a.total_offer_value||0))[0];
    return { mode: 'pipeline', title: 'Pipeline por etapa', summary: 'Lectura del embudo comercial con valor total y valor ponderado por probabilidad de cierre.', rows, cards: [
      { label: 'Pipeline total', value: fmtMoneyCompact(data.totals.pipeline), detail: 'Valor de ofertas registradas' },
      { label: 'Valor ponderado', value: fmtMoneyCompact(data.totals.weighted), detail: 'Ajustado por etapa' },
      { label: 'Etapa dominante', value: leader?.stage_name || '—', detail: leader ? fmtMoneyCompact(leader.total_offer_value) : 'Sin datos' },
    ] };
  }

  if (q.includes('meta') || q.includes('cumplimiento') || q.includes('presupuesto')) {
    const goalComplianceRows = buildCentinelGoalComplianceRows(data);
    const goalCount = data.goals.length;
    const budget = data.goals.reduce((s,g)=>s+Number(g.sales_budget||0),0);
    const approved = data.monthlyKpis.reduce((s,k)=>s+Number(k.ventas_aprobadas||0),0);
    return { mode: 'goals', title: 'Cumplimiento de metas', summary: 'Vista segura de metas cargadas y ventas aprobadas por comercial. La tabla prioriza primero las brechas de cumplimiento.', rows: [], goalComplianceRows, cards: [
      { label: 'Metas cargadas', value: String(goalCount), detail: goalCount ? 'Registros de presupuesto disponibles' : 'Pendiente cargar metas reales' },
      { label: 'Presupuesto registrado', value: fmtMoneyCompact(budget), detail: 'Suma de metas comerciales' },
      { label: 'Ventas aprobadas', value: fmtMoneyCompact(approved), detail: 'Según KPIs mensuales' },
    ] };
  }

  if (q.includes('sustentación') || q.includes('sustentacion') || q.includes('estancad')) {
    const rows = active.filter(o => o.stage_code === 'sustentacion').sort((a,b) => Number(daysSince(b.last_interaction_at || b.updated_at || b.created_at)||0) - Number(daysSince(a.last_interaction_at || a.updated_at || a.created_at)||0));
    return { mode: 'stalled', title: 'Clientes en sustentación', summary: 'Oportunidades en sustentación priorizadas por días sin seguimiento y valor comercial.', rows, cards: [
      { label: 'En sustentación', value: String(rows.length), detail: 'Oportunidades activas' },
      { label: 'Más de 5 días', value: String(rows.filter(o => Number(daysSince(o.last_interaction_at || o.updated_at || o.created_at)||0) > 5).length), detail: 'Requieren revisión gerencial' },
      { label: 'Valor asociado', value: fmtMoneyCompact(rows.reduce((s,o)=>s+Number(o.offer_value||0),0)), detail: 'Pipeline en sustentación' },
    ] };
  }

  if (q.includes('próxima') || q.includes('proxima') || q.includes('semana') || q.includes('hoy')) {
    const limitToWeek = q.includes('semana');
    const weekEnd = startOfToday(); weekEnd.setDate(weekEnd.getDate() + 7);
    const rows = baseRows.filter(r => ['today','soon','scheduled','overdue'].includes(r.action.code) && (!limitToWeek || !r.o.next_action_at || new Date(r.o.next_action_at) <= weekEnd)).map(r => r.o).sort((a,b) => String(a.next_action_at||'9999').localeCompare(String(b.next_action_at||'9999')));
    return { mode: 'alerts', title: 'Próximas gestiones', summary: limitToWeek ? 'Agenda comercial de esta semana, incluyendo vencidas y próximas gestiones.' : 'Agenda comercial ordenada por fecha de próxima acción.', rows, cards: [
      { label: 'Con agenda', value: String(rows.length), detail: 'Oportunidades con próxima acción' },
      { label: 'Para hoy', value: String(baseRows.filter(r => r.action.code === 'today').length), detail: 'Gestión inmediata' },
      { label: 'Vencidas', value: String(baseRows.filter(r => r.action.code === 'overdue').length), detail: 'Requieren acción urgente' },
    ] };
  }

  const terms = q.split(/\s+/).filter(t => t.length > 2);
  const rows = active.filter(o => {
    const haystack = `${o.company_name} ${o.owner_name || ''} ${o.stage_name} ${o.regional_nombre || ''} ${o.sede || ''} ${o.tipo_producto_original || ''}`.toLowerCase();
    return terms.length ? terms.some(t => haystack.includes(t)) : true;
  }).sort((a,b) => Number(b.offer_value || 0) - Number(a.offer_value || 0));
  return { mode: 'search', title: 'Búsqueda comercial segura', summary: 'Vig-IA encontró coincidencias en clientes, comerciales, etapas, regionales y tipo de producto.', rows, cards: [
    { label: 'Coincidencias', value: String(rows.length), detail: 'Oportunidades activas encontradas' },
    { label: 'Valor asociado', value: fmtMoneyCompact(rows.reduce((s,o)=>s+Number(o.offer_value||0),0)), detail: 'Pipeline filtrado' },
    { label: 'Modo', value: 'Solo lectura', detail: 'No modifica datos ni agenda' },
  ] };
}

function CentinelAssistant({ data }: { data: Bootstrap }) {
  const [query, setQuery] = useState('Muéstrame oportunidades sin agenda por comercial');
  const [submitted, setSubmitted] = useState(query);
  const [centinelTenderPayload, setCentinelTenderPayload] = useState<TenderRadarPayload | null>(null);
  const [centinelTenderStatus, setCentinelTenderStatus] = useState('');
  const [centinelOpportunitySortConfig, setCentinelOpportunitySortConfig] = useState<SortConfig<'client'|'owner'|'stage'|'value'|'next'|'inactive'>>({ key: 'value', direction: 'desc' });
  const [centinelTenderSortConfig, setCentinelTenderSortConfig] = useState<SortConfig<'entity'|'section'|'status'|'value'|'deadline'|'score'>>({ key: 'score', direction: 'desc' });
  const loadCentinelTenders = async () => {
    if (!canViewTenders(data.currentProfile)) return;
    setCentinelTenderStatus('Cargando licitaciones para Vig-IA…');
    try {
      setCentinelTenderPayload(await api<TenderRadarPayload>('/api/tenders'));
      setCentinelTenderStatus('Licitaciones cargadas para Vig-IA.');
    } catch (err) {
      setCentinelTenderStatus(err instanceof Error ? err.message : String(err));
    }
  };
  useEffect(() => { loadCentinelTenders(); }, [data.currentProfile.id]);
  const result = useMemo(() => interpretCentinelQuery(submitted, data, centinelTenderPayload), [submitted, data, centinelTenderPayload]);
  const sortedCentinelOpportunityRows = [...result.rows].sort((a,b) => {
    const value = (o: Opportunity) => centinelOpportunitySortConfig.key === 'client' ? o.company_name : centinelOpportunitySortConfig.key === 'owner' ? (o.owner_name || '') : centinelOpportunitySortConfig.key === 'stage' ? o.stage_order : centinelOpportunitySortConfig.key === 'value' ? Number(o.offer_value || 0) : centinelOpportunitySortConfig.key === 'next' ? (o.next_action_at || '') : Number(daysSince(o.last_interaction_at || o.updated_at || o.created_at) || 0);
    return compareSortValues(value(a), value(b), centinelOpportunitySortConfig.direction);
  });
  const sortedCentinelTenderRows = [...(result.tenderRows || [])].sort((a,b) => {
    const value = (t: PublicTender) => centinelTenderSortConfig.key === 'entity' ? t.entity : centinelTenderSortConfig.key === 'section' ? t.section : centinelTenderSortConfig.key === 'status' ? tenderStatusLabel(t.internal_status) : centinelTenderSortConfig.key === 'value' ? Number(t.value || 0) : centinelTenderSortConfig.key === 'deadline' ? (t.deadline || '') : Number(t.score || 0);
    return compareSortValues(value(a), value(b), centinelTenderSortConfig.direction);
  });
  const sortCentinelOpportunityBy = (key: typeof centinelOpportunitySortConfig.key) => setCentinelOpportunitySortConfig(current => nextSort(current, key));
  const sortCentinelTenderBy = (key: typeof centinelTenderSortConfig.key) => setCentinelTenderSortConfig(current => nextSort(current, key));
  const visibleRows = sortedCentinelOpportunityRows.slice(0, 25);
  const visibleTenderRows = sortedCentinelTenderRows.slice(0, 25);
  const isTenderResult = result.mode === 'tenders';
  const tenderLoadFailed = canViewTenders(data.currentProfile) && !!centinelTenderStatus && !centinelTenderPayload && !centinelTenderStatus.includes('Cargando');
  const tenderStatusText = !canViewTenders(data.currentProfile) ? 'Licitaciones sin permiso' : centinelTenderPayload ? 'Licitaciones cargadas' : centinelTenderStatus || 'Cargando licitaciones…';
  return <section className="stack centinel-dashboard">
    <section className="centinel-topline"><h2>Vig-IA — Reportes gerenciales asistidos</h2><p>Módulo en evolución: hoy organiza reportes seguros del CRM; no es un chat de IA abierto.</p></section>
    <section className="centinel-hero">
      <div className="centinel-orb"><span></span><span></span></div>
      <div><span className="eyebrow">VIG-IA</span><h2>Selecciona un reporte gerencial</h2><p>Usa los accesos rápidos para revisar pipeline, alertas, metas y licitaciones con una lectura ejecutiva. Vig-IA trabaja en modo solo lectura sobre datos del CRM.</p></div>
      <div className="centinel-safe"><strong>Solo lectura</strong><small>Reportes asistidos, sin inteligencia generativa conectada todavía</small></div>
    </section>
    <section className="centinel-query-panel">
      <div className="centinel-assisted-copy"><span className="eyebrow">Reportes disponibles</span><h3>Elige una consulta predefinida</h3><p>Estos botones son la fuente principal por ahora. Mantienen la experiencia honesta mientras conectamos una IA real al CRM.</p></div>
      <div className="centinel-actions">
        <div className="centinel-action-groups">{centinelQuickActionGroups.map(group => <div className="centinel-action-group" key={group.title}><small>{group.title}</small><div>{group.actions.map(action => <button className={`centinel-chip ${submitted === action.prompt ? 'centinel-chip-active' : ''}`} key={action.label} onClick={() => { setQuery(action.prompt); setSubmitted(action.prompt); }}>{action.label}</button>)}</div></div>)}</div>
      </div>
      <details className="centinel-manual-query">
        <summary>Pregunta opcional</summary>
        <label>Escribe una consulta si coincide con un reporte existente</label>
        <textarea className="centinel-textarea" value={query} onChange={e => setQuery(e.target.value)} rows={3} />
        <button onClick={() => setSubmitted(query)}>Generar reporte manual</button>
      </details>
      <div className="centinel-data-status"><span>Estado de datos</span><strong>CRM actualizado</strong><span>·</span><strong>{tenderStatusText}</strong>{tenderLoadFailed && <button className="secondary" onClick={loadCentinelTenders}>Reintentar carga</button>}</div>
    </section>
    <section className="centinel-result">
      <div className="centinel-result-head"><div><span className="eyebrow">Resultado Vig-IA</span><h2>{result.title}</h2><p>{result.summary}</p></div><button className="secondary" onClick={() => go(isTenderResult ? '#/tenders' : '#/alerts')}>{isTenderResult ? 'Abrir radar de licitaciones' : 'Abrir alertas comerciales'}</button></div>
      <div className="centinel-result-grid">{result.cards.map(card => <div className="centinel-result-card" key={card.label}><small>{card.label}</small><strong>{card.value}</strong><span>{card.detail}</span></div>)}</div>
      {result.mode === 'pipeline' && <StageBars summary={data.summary} />}
      {!!result.ownerSummaryRows?.length && <div className="tablewrap centinel-summary-table"><table><thead><tr><th>Comercial</th><th>Oportunidades</th><th>Valor asociado</th><th>Acción sugerida</th></tr></thead><tbody>{result.ownerSummaryRows.map(row => <tr key={row.owner}><td><strong>{row.owner}</strong></td><td>{row.count}</td><td>{fmtMoney(row.value)}</td><td>{row.nextStep}</td></tr>)}</tbody></table></div>}
      {!!result.goalComplianceRows?.length && <div className="tablewrap centinel-summary-table"><table><thead><tr><th>Comercial</th><th>Mes</th><th>Meta</th><th>Ventas aprobadas</th><th>Cumplimiento</th><th>Brecha</th></tr></thead><tbody>{result.goalComplianceRows.map(row => <tr key={`${row.owner}-${row.period}`}><td><strong>{row.owner}</strong></td><td>{row.period}</td><td>{fmtMoney(row.budget)}</td><td>{fmtMoney(row.approved)}</td><td><Badge tone={row.compliance >= 100 ? 'success' : row.compliance >= 80 ? 'amber' : 'danger'}>{row.compliance}%</Badge></td><td>{row.gap ? fmtMoney(row.gap) : 'Superada'}</td></tr>)}</tbody></table></div>}
      {isTenderResult && <div className="tablewrap centinel-result-table"><table><thead><tr><SortableTh label="Entidad" sortKey="entity" sortConfig={centinelTenderSortConfig} onSort={sortCentinelTenderBy}/><SortableTh label="Sección" sortKey="section" sortConfig={centinelTenderSortConfig} onSort={sortCentinelTenderBy}/><SortableTh label="Estado interno" sortKey="status" sortConfig={centinelTenderSortConfig} onSort={sortCentinelTenderBy}/><SortableTh label="Valor" sortKey="value" sortConfig={centinelTenderSortConfig} onSort={sortCentinelTenderBy}/><SortableTh label="Cierre" sortKey="deadline" sortConfig={centinelTenderSortConfig} onSort={sortCentinelTenderBy}/><SortableTh label="Score" sortKey="score" sortConfig={centinelTenderSortConfig} onSort={sortCentinelTenderBy}/></tr></thead><tbody>{visibleTenderRows.map(t => (
        <tr key={t.id} className="clickable" onClick={() => go(tenderDeepLink(t))}><td><strong>{t.entity}</strong><br/><small>{t.ref || t.process_id || t.city || '—'}</small></td><td><Badge tone={t.section === 'hacer' ? 'amber' : t.section === 'descartar' ? 'danger' : 'blue'}>{t.section === 'hacer' ? 'Hacer hoy' : t.section === 'revisar' ? 'Revisar' : 'Validar'}</Badge></td><td><Badge tone={tenderStatusTone(t.internal_status)}>{tenderStatusLabel(t.internal_status)}</Badge></td><td>{fmtMoney(t.value)}</td><td>{fmtDate(t.deadline)}</td><td>{t.score}</td></tr>
      ))}</tbody></table></div>}
      {!isTenderResult && result.mode !== 'goals' && <div className="tablewrap centinel-result-table"><table><thead><tr><SortableTh label="Cliente" sortKey="client" sortConfig={centinelOpportunitySortConfig} onSort={sortCentinelOpportunityBy}/><SortableTh label="Comercial" sortKey="owner" sortConfig={centinelOpportunitySortConfig} onSort={sortCentinelOpportunityBy}/><SortableTh label="Etapa" sortKey="stage" sortConfig={centinelOpportunitySortConfig} onSort={sortCentinelOpportunityBy}/><SortableTh label="Valor" sortKey="value" sortConfig={centinelOpportunitySortConfig} onSort={sortCentinelOpportunityBy}/><SortableTh label="Próxima acción" sortKey="next" sortConfig={centinelOpportunitySortConfig} onSort={sortCentinelOpportunityBy}/><SortableTh label="Días sin seguimiento" sortKey="inactive" sortConfig={centinelOpportunitySortConfig} onSort={sortCentinelOpportunityBy}/></tr></thead><tbody>{visibleRows.map(o => {
        const action = nextActionStatus(o);
        const inactive = daysSince(o.last_interaction_at || o.updated_at || o.created_at);
        return <tr key={o.id} className="clickable" onClick={() => go(`#/detail/${o.id}`)}><td><strong>{o.company_name}</strong><br/><small>{o.sede || o.regional_nombre || '—'}</small></td><td>{o.owner_name || 'Sin comercial'}</td><td><Badge tone={stageTone(o.stage_code)}>{o.stage_name}</Badge></td><td>{fmtMoney(o.offer_value)}</td><td><Badge tone={action.tone}>{action.label}</Badge><br/><small>{o.next_action_at ? fmtDate(o.next_action_at) : action.detail}</small></td><td>{inactive === null ? '—' : `${inactive} día(s)`}</td></tr>;
      })}</tbody></table></div>}
      <p className="muted">Mostrando {isTenderResult ? visibleTenderRows.length : result.mode === 'goals' ? (result.goalComplianceRows || []).length : visibleRows.length} de {isTenderResult ? (result.tenderRows || []).length : result.mode === 'goals' ? (result.goalComplianceRows || []).length : result.rows.length} coincidencias. Click en una fila para abrir el detalle.</p>
    </section>
  </section>;
}

function topGroup(values: string[]) {
  const counts = values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map<string, number>());
  const [label, count] = Array.from(counts.entries()).sort((a,b) => b[1] - a[1])[0] || ['—', 0];
  return { label, count };
}


function GoalsCompliance({ data, refresh }: { data: Bootstrap; refresh: () => Promise<void> }) {
  const today = new Date();
  const canEditGoals = canManageGoals(data.currentProfile);
  const defaultEditOwnerId = data.currentProfile.role === 'comercial' ? data.currentProfile.id : (data.profiles[0]?.id || '');
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [viewOwnerId, setViewOwnerId] = useState(data.currentProfile.role === 'comercial' ? data.currentProfile.id : '');
  const [editYear, setEditYear] = useState(today.getFullYear());
  const [editMonth, setEditMonth] = useState(today.getMonth() + 1);
  const [editOwnerId, setEditOwnerId] = useState(defaultEditOwnerId);
  const [status, setStatus] = useState('');
  const [complianceSortConfig, setComplianceSortConfig] = useState<SortConfig<'indicator'|'month'|'quarter'|'semester'|'year'>>({ key: 'indicator', direction: 'asc' });
  const editPeriodMonth = `${editYear}-${String(editMonth).padStart(2, '0')}-01`;
  const existing = data.goals.find(g => g.user_id === editOwnerId && String(g.period_month).slice(0, 7) === editPeriodMonth.slice(0, 7));
  const [form, setForm] = useState({ sales_budget: '', prospect_target: '', quote_target: '' });

  useEffect(() => {
    setForm({
      sales_budget: existing ? String(Number(existing.sales_budget || 0)) : '',
      prospect_target: existing ? String(Number(existing.prospect_target || 0)) : '',
      quote_target: existing ? String(Number(existing.quote_target || 0)) : '',
    });
  }, [existing?.id, editOwnerId, editYear, editMonth]);

  const viewOwnerName = viewOwnerId ? (data.profiles.find(p => p.id === viewOwnerId)?.full_name || 'Seleccionar asesor') : 'Todos los asesores';
  const editOwnerName = data.profiles.find(p => p.id === editOwnerId)?.full_name || 'Seleccionar asesor';
  const periods = buildCompliancePeriods(viewYear, viewMonth);
  const rows = buildComplianceRows(data, viewOwnerId, periods);
  const missingGoals = data.profiles.filter(profile => !data.goals.some(g => g.user_id === profile.id && String(g.period_month).slice(0, 7) === editPeriodMonth.slice(0, 7)));
  const sortedComplianceRows = [...rows].sort((a,b) => {
    const value = (row: typeof rows[number]) => complianceSortConfig.key === 'indicator' ? row.label : Number(row.values[complianceSortConfig.key]?.pct ?? -1);
    return compareSortValues(value(a), value(b), complianceSortConfig.direction);
  });
  const sortComplianceBy = (key: typeof complianceSortConfig.key) => setComplianceSortConfig(current => nextSort(current, key));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Guardando metas…');
    try {
      await api<SalesGoal>('/api/goals', { method: 'PUT', body: JSON.stringify({
        user_id: editOwnerId,
        period_month: editPeriodMonth,
        sales_budget: Number(form.sales_budget || 0),
        prospect_target: Number(form.prospect_target || 0),
        quote_target: Number(form.quote_target || 0),
      }) });
      setStatus('Metas guardadas.');
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  return <section className="stack goals-dashboard">
    <section className="executive-hero goals-hero">
      <div>
        <span className="eyebrow">Metas Comerciales y Cumplimiento</span>
        <h2>Presupuesto, gestión y avance acumulado por asesor</h2>
        <p>{canEditGoals ? 'Consulta gerencial separada de la carga administrativa de metas.' : 'Consulta de tus metas y cumplimiento comercial.'}</p>
      </div>
      <div className="hero-facts">
        <div><small>Vista seleccionada</small><strong>{viewOwnerName}</strong></div>
        <div><small>Período de consulta</small><strong>{monthName(viewMonth)} {viewYear}</strong></div>
        <div><small>Metas cargadas</small><strong>{data.goals.length}</strong></div>
      </div>
    </section>

    <Panel title="Filtros de consulta">
      <div className="grid three compact-grid goals-view-filters">
        <label>Año<input type="number" min="2024" max="2035" value={viewYear} onChange={e=>setViewYear(Number(e.target.value || today.getFullYear()))}/></label>
        <label>Mes<Select value={String(viewMonth)} onChange={v=>setViewMonth(Number(v))} options={Array.from({ length: 12 }, (_, i) => [String(i + 1), monthName(i + 1)])} empty="Mes"/></label>
        <label>Asesor comercial<Select value={viewOwnerId} onChange={setViewOwnerId} options={data.profiles.map(p=>[p.id,p.full_name])} empty={canEditGoals ? 'Todos los asesores' : 'Seleccionar asesor'} disabled={!canEditGoals && data.currentProfile.role === 'comercial'}/></label>
      </div>
      <p className="muted">Estos filtros solo cambian la lectura del cumplimiento; no modifican metas guardadas.</p>
    </Panel>

    <Panel title={`Panel de cumplimiento · ${viewOwnerName}`}>
      <div className="compliance-legend"><span className="dot danger"/> Rojo &lt;80% <span className="dot warn"/> Amarillo 80–99% <span className="dot good"/> Verde ≥100%</div>
      <div className="tablewrap compliance-table"><table><thead><tr><SortableTh label="Indicador" sortKey="indicator" sortConfig={complianceSortConfig} onSort={sortComplianceBy}/>{periods.map(p => <SortableTh key={p.key} label={p.label} sortKey={p.key as typeof complianceSortConfig.key} sortConfig={complianceSortConfig} onSort={sortComplianceBy}/>)}</tr></thead><tbody>{sortedComplianceRows.map(row => <tr key={row.label}><td><strong>{row.label}</strong><br/><small>{row.description}</small></td>{periods.map(period => {
        const cell = row.values[period.key];
        return <td key={period.key} className={`compliance-cell ${goalStatusTone(cell.pct)}`}><strong>{formatGoalValue(row.kind, cell.goal)} / {formatGoalValue(row.kind, cell.actual)}</strong><span>{cell.pct === null ? 'Sin meta' : `${cell.pct}%`}</span></td>;
      })}</tr>)}</tbody></table></div>
    </Panel>

    {canEditGoals && <Panel title="Cargar o editar metas">
      <form className="form goals-form" onSubmit={save}>
        <div className="grid three compact-grid">
          <label>Año de la meta<input type="number" min="2024" max="2035" value={editYear} onChange={e=>setEditYear(Number(e.target.value || today.getFullYear()))}/></label>
          <label>Mes de la meta<Select value={String(editMonth)} onChange={v=>setEditMonth(Number(v))} options={Array.from({ length: 12 }, (_, i) => [String(i + 1), monthName(i + 1)])} empty="Mes"/></label>
          <label>Asesor a configurar<Select value={editOwnerId} onChange={setEditOwnerId} options={data.profiles.map(p=>[p.id,p.full_name])} empty="Seleccionar asesor"/></label>
        </div>
        <p className="muted"><strong>{existing ? 'Editando meta existente' : 'Nueva meta'}</strong> para {editOwnerName} · {monthName(editMonth)} {editYear}.</p>
        <label>Presupuesto aprobado / ventas<input type="number" min="0" value={form.sales_budget} onChange={e=>setForm({...form, sales_budget:e.target.value})} placeholder="Ej: 250000000"/></label>
        <label>Prospectos nuevos<input type="number" min="0" value={form.prospect_target} onChange={e=>setForm({...form, prospect_target:e.target.value})} placeholder="Ej: 20"/></label>
        <label>Propuestas / cotizaciones<input type="number" min="0" value={form.quote_target} onChange={e=>setForm({...form, quote_target:e.target.value})} placeholder="Ej: 12"/></label>
        <div className="formactions"><button disabled={!editOwnerId}>Guardar metas</button>{status && <span>{status}</span>}</div>
        <p className="muted">Metas pendientes de cargar para {monthName(editMonth)} {editYear}: <strong>{missingGoals.length}</strong>{missingGoals.length ? ` · ${missingGoals.slice(0, 4).map(p => p.full_name).join(', ')}${missingGoals.length > 4 ? '…' : ''}` : ''}</p>
      </form>
    </Panel>}
  </section>;
}

type CompliancePeriod = { key: string; label: string; months: string[] };
type ComplianceCell = { goal: number; actual: number; pct: number | null };

function buildCompliancePeriods(year: number, month: number): CompliancePeriod[] {
  const monthKey = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  const semesterStart = month <= 6 ? 1 : 7;
  const range = (start: number) => Array.from({ length: month - start + 1 }, (_, i) => monthKey(start + i));
  return [
    { key: 'month', label: 'Mes Actual (Meta / Real / %)', months: [monthKey(month)] },
    { key: 'quarter', label: 'Trimestre acumulado (Meta / Real / %)', months: range(quarterStart) },
    { key: 'semester', label: 'Semestre acumulado (Meta / Real / %)', months: range(semesterStart) },
    { key: 'year', label: 'Año acumulado (Meta / Real / %)', months: range(1) },
  ];
}

function buildComplianceRows(data: Bootstrap, ownerId: string, periods: CompliancePeriod[]) {
  const rows = [
    { label: 'Presupuesto aprobado', description: 'Ventas ganadas contra presupuesto comercial.', kind: 'money' as const, goalField: 'sales_budget' as const, actualField: 'ventas_aprobadas' as const },
    { label: 'Prospectos nuevos', description: 'Clientes u oportunidades nuevas en etapa prospecto.', kind: 'count' as const, goalField: 'prospect_target' as const, actualField: 'prospectos' as const },
    { label: 'Propuestas / cotizaciones', description: 'Ofertas presentadas o etapas posteriores.', kind: 'count' as const, goalField: 'quote_target' as const, actualField: 'cotizaciones' as const },
  ];
  const ownerName = data.profiles.find(p => p.id === ownerId)?.full_name || '';
  return rows.map(row => ({ ...row, values: Object.fromEntries(periods.map(period => {
    const goal = data.goals
      .filter(g => (!ownerId || g.user_id === ownerId) && period.months.includes(String(g.period_month).slice(0, 7)))
      .reduce((sum, g) => sum + Number(g[row.goalField] || 0), 0);
    const actual = data.monthlyKpis
      .filter(k => period.months.includes(String(k.period_month).slice(0, 7)))
      .filter(k => !ownerId || (k.owner_id ? k.owner_id === ownerId : ownerName === (k.owner_name || '')))
      .reduce((sum, k) => sum + Number(k[row.actualField] || 0), 0);
    const pct = goal > 0 ? Math.round((actual / goal) * 100) : null;
    return [period.key, { goal, actual, pct } as ComplianceCell];
  })) }));
}

function goalStatusTone(pct: number | null) {
  if (pct === null) return 'empty';
  if (pct < 80) return 'danger';
  if (pct < 100) return 'warn';
  return 'good';
}
function formatGoalValue(kind: 'money' | 'count', value: number) { return kind === 'money' ? fmtMoneyCompact(value) : String(Math.round(value)); }
function monthName(month: number) {
  const name = new Date(2026, month - 1, 1).toLocaleDateString('es-CO', { month: 'long' });
  return name.charAt(0).toUpperCase() + name.slice(1);
}


function UsersAdmin({ currentProfile }: { currentProfile: Profile }) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [status, setStatus] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const editFormRef = useRef<HTMLDivElement | null>(null);
  const emptyUserForm: UserPayload = { full_name: '', microsoft_email: '', role: 'comercial', active: true, password: '', send_invite: true, commercial_area: '', can_edit_customer_segment: false };
  const [form, setForm] = useState<UserPayload>(emptyUserForm);
  const [usersSortConfig, setUsersSortConfig] = useState<SortConfig<'name'|'email'|'role'|'area'|'segment'|'status'>>({ key: 'name', direction: 'asc' });
  const load = async () => { setUsers(await api<Profile[]>('/api/users')); };
  const sortedUsers = [...users].sort((a,b) => {
    const value = (u: Profile) => usersSortConfig.key === 'name' ? u.full_name : usersSortConfig.key === 'email' ? u.microsoft_email : usersSortConfig.key === 'role' ? u.role : usersSortConfig.key === 'area' ? commercialAreaLabel(u.commercial_area) : usersSortConfig.key === 'segment' ? (u.can_edit_customer_segment ? 'Puede editar' : 'Bloqueado') : (u.active ? 'Activo' : 'Inactivo');
    return compareSortValues(value(a), value(b), usersSortConfig.direction);
  });
  const sortUsersBy = (key: typeof usersSortConfig.key) => setUsersSortConfig(current => nextSort(current, key));
  useEffect(() => { if (canManageUsers(currentProfile)) load().catch(e => setStatus(e instanceof Error ? e.message : String(e))); }, [currentProfile.id]);
  if (!canManageUsers(currentProfile)) return <div className="error">Solo admin puede administrar usuarios.</div>;
  const startEdit = (user: Profile) => {
    setEditingUserId(user.id);
    setForm({ full_name: user.full_name, microsoft_email: user.microsoft_email, role: user.role, active: user.active, password: '', send_invite: false, commercial_area: user.commercial_area || '', can_edit_customer_segment: !!user.can_edit_customer_segment });
    setStatus('Editando usuario existente. Deja la clave en blanco si no quieres cambiarla.');
    window.setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const cancelEdit = () => {
    setEditingUserId(null);
    setForm(emptyUserForm);
    setStatus('');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(editingUserId ? 'Actualizando usuario…' : 'Creando usuario…');
    try {
      const saved = await api<(Profile & { invited?: boolean; access_link?: string | null })>(editingUserId ? `/api/users?id=${encodeURIComponent(editingUserId)}` : '/api/users', { method: editingUserId ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      const wasEditing = !!editingUserId;
      setForm(emptyUserForm);
      setEditingUserId(null);
      await load();
      const mailStatus = saved.access_link ? ` Si el correo no llega, comparte este enlace de acceso: ${saved.access_link}` : (saved.invited ? ' Invitación enviada por correo.' : '');
      setStatus(wasEditing ? `Usuario actualizado.${mailStatus}` : `Usuario/perfil guardado.${mailStatus}`);
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  };
  return <section className="stack">
    <section className="executive-hero"><div><span className="eyebrow">Administración</span><h2>Usuarios y permisos</h2><p>Crea usuarios de acceso y asigna el rol comercial, dirección, gerencia o admin.</p></div><div className="hero-facts"><div><small>Usuarios</small><strong>{users.length}</strong></div><div><small>Administrador</small><strong>{currentProfile.full_name}</strong></div></div></section>
    <div ref={editFormRef} className="users-edit-anchor">
    <Panel title={editingUserId ? `Editar usuario · ${form.full_name || form.microsoft_email}` : 'Crear usuario'}>
      <form className="form gridform" onSubmit={submit}>
        <label>Nombre completo<input required value={form.full_name} onChange={e=>setForm({...form, full_name:e.target.value})}/></label>
        <label>Email<input type="email" required value={form.microsoft_email} onChange={e=>setForm({...form, microsoft_email:e.target.value})}/></label>
        <label>Rol<Select value={form.role} onChange={v=>setForm({...form, role:v})} options={[['comercial','Comercial'],['director','Directivo'],['gerencia','Gerencia'],['admin','Admin']]} empty="Rol"/></label>
        <label>Área comercial<Select value={form.commercial_area || ''} onChange={v=>setForm({...form, commercial_area:v as CommercialArea | ''})} options={commercialAreaOptions} empty="Sin área"/></label>
        <label className="checkline"><input type="checkbox" checked={!!form.can_edit_customer_segment} onChange={e=>setForm({...form, can_edit_customer_segment:e.target.checked})}/> Habilitar edición posterior de Cliente Nuevo / Cliente Actual</label>
        <label>Clave temporal<input type="password" minLength={8} value={form.password || ''} onChange={e=>setForm({...form, password:e.target.value})} placeholder={form.send_invite ? "Opcional si envías invitación" : "Mínimo 8 caracteres"}/></label>
        <label>Estado<Select value={form.active ? 'true' : 'false'} onChange={v=>setForm({...form, active:v==='true'})} options={[['true','Activo'],['false','Inactivo']]} empty="Estado"/></label>
        <label className="checkline"><input type="checkbox" checked={!!form.send_invite} onChange={e=>setForm({...form, send_invite:e.target.checked})}/> Enviar correo de invitación para que el usuario active su acceso</label>
        <div className="formactions"><button>{editingUserId ? 'Actualizar usuario' : 'Guardar usuario'}</button>{editingUserId && <button type="button" className="secondary" onClick={cancelEdit}>Cancelar edición</button>}{status && <span>{status}</span>}</div>
      </form>
    </Panel>
    </div>
    <Panel title="Perfiles actuales"><div className="tablewrap"><table><thead><tr><SortableTh label="Nombre" sortKey="name" sortConfig={usersSortConfig} onSort={sortUsersBy}/><SortableTh label="Email" sortKey="email" sortConfig={usersSortConfig} onSort={sortUsersBy}/><SortableTh label="Rol" sortKey="role" sortConfig={usersSortConfig} onSort={sortUsersBy}/><SortableTh label="Área" sortKey="area" sortConfig={usersSortConfig} onSort={sortUsersBy}/><SortableTh label="Segmento" sortKey="segment" sortConfig={usersSortConfig} onSort={sortUsersBy}/><SortableTh label="Estado" sortKey="status" sortConfig={usersSortConfig} onSort={sortUsersBy}/><th>Acciones</th></tr></thead><tbody>{sortedUsers.map(u => <tr key={u.id}><td><strong>{u.full_name}</strong></td><td>{u.microsoft_email}</td><td><Badge>{u.role}</Badge></td><td>{commercialAreaLabel(u.commercial_area)}</td><td>{u.can_edit_customer_segment ? 'Puede editar' : 'Bloqueado'}</td><td>{u.active ? 'Activo' : 'Inactivo'}</td><td><button type="button" className="secondary" onClick={() => startEdit(u)}>Editar</button></td></tr>)}</tbody></table></div></Panel>
  </section>;
}

createRoot(document.getElementById('root')!).render(<App />);
