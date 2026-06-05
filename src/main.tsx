
import React, { useEffect, useMemo, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Stage = { code: string; name: string; stage_order: number; close_probability: number; is_terminal: boolean };
type Profile = { id: string; full_name: string; microsoft_email: string; role: string; active: boolean };
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
  loss_reason_code: string | null; loss_reason_name: string | null; loss_notes: string | null; commission_rate: number | null; created_at: string; updated_at: string;
};
type Interaction = { id: string; opportunity_id: string; interaction_type: string; notes: string | null; occurred_at: string; created_at: string; created_by: string | null; psi_sales_profiles?: { full_name?: string } | null };
type MonthlyKpi = { owner_id?: string | null; owner_name: string | null; period_month: string; prospectos: number; cotizaciones: number; ventas_aprobadas: number; comision_ganada: number; comision_proyectada: number };
type SalesGoal = { id?: string; user_id: string | null; period_month: string; quote_target: number; prospect_target: number; sales_budget: number; created_at?: string; updated_at?: string };
type Bootstrap = { summary: SummaryRow[]; opportunities: Opportunity[]; profiles: Profile[]; stages: Stage[]; services: ServiceType[]; lossReasons: LossReason[]; stalled: Opportunity[]; topClosing: Opportunity[]; monthlyKpis: MonthlyKpi[]; goals: SalesGoal[]; totals: { count: number; pipeline: number; weighted: number; approved: number }; currentProfile: Profile };
type UserPayload = { full_name: string; microsoft_email: string; role: string; active: boolean; password?: string; send_invite?: boolean };
type TenderSection = 'hacer' | 'revisar' | 'descartar';
type PublicTender = { id: string; source: string; section: TenderSection; entity: string; dept?: string; city?: string; ref?: string; process_id?: string; title: string; desc?: string; value: number; status?: string; category?: string; published?: string | null; deadline?: string | null; window?: string; days?: number | null; score: number; reasons: string[]; risks: string[]; url?: string };
type TenderRadarPayload = { generatedAt: string; totals: { all: number; hacer: number; revisar: number; descartar: number; highValue: number; urgent: number }; tenders: PublicTender[] };
type Route = { page: 'home' | 'opportunities' | 'tenders' | 'detail' | 'new' | 'edit' | 'dashboard' | 'consultant' | 'goals' | 'alerts' | 'centinel' | 'users'; id?: string };

type OpportunityPayload = Partial<Opportunity> & { company_name?: string; offer_value?: number | string; commission_rate?: number | string; };
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

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  if (page === 'opportunities') return { page: 'opportunities' };
  if (page === 'tenders') return { page: 'tenders' };
  if (page === 'detail' && id) return { page: 'detail', id: decodeURIComponent(id) };
  if (page === 'edit' && id) return { page: 'edit', id: decodeURIComponent(id) };
  if (page === 'consultant' && id) return { page: 'consultant', id: decodeURIComponent(id) };
  if (page === 'new') return { page: 'new' };
  if (page === 'dashboard') return { page: 'dashboard' };
  if (page === 'goals') return { page: 'goals' };
  if (page === 'alerts') return { page: 'alerts' };
  if (page === 'centinel') return { page: 'centinel' };
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
function uniq(values: Array<string | null | undefined>) { return Array.from(new Set(values.filter(Boolean) as string[])).sort((a,b) => a.localeCompare(b)); }
function ownerKey(o: Pick<Opportunity, 'owner_id'>) { return o.owner_id || '__sin_comercial__'; }
function ownerRoute(ownerId: string) { return `#/consultant/${encodeURIComponent(ownerId)}`; }
function isTerminalStage(stageCode?: string | null) { return ['aprobado','perdido','descartado'].includes(stageCode || ''); }
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
  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><small>Seguridad Nacional Ltda</small><em>Dashboard Comercial</em></div>
      <Nav route={route} currentProfile={currentProfile} />
      <div className="session-card"><small>Sesión activa</small><strong>{currentProfile?.full_name || session.user.email}</strong><span>{currentProfile?.role || 'perfil'}</span></div>
      <button className="secondary full" onClick={refresh}>Actualizar datos</button>
      <button className="secondary full" onClick={() => supabaseBrowser.auth.signOut()}>Cerrar sesión</button>
    </aside>
    <main>
      <header className="topbar">
        <div><h1>{titleFor(route)}</h1><p>CRM comercial · Seguridad Nacional</p></div>
        <button onClick={() => go('#/new')}>Nueva oportunidad</button>
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
  if (route.page === 'centinel') return 'Pregúntale a Centinel';
  if (route.page === 'users') return 'Usuarios y permisos';
  return 'Inicio comercial';
}
function Nav({ route, currentProfile }: { route: Route; currentProfile: Profile | null }) {
  const items = [['#/dashboard','Dashboard gerencial'],['#/alerts','Alertas comerciales'],['#/opportunities','Oportunidades']];
  if (canViewTenders(currentProfile)) items.push(['#/tenders','Licitaciones']);
  items.push(['#/goals','Metas y cumplimiento'],['#/new','Crear oportunidad'],['#/centinel','Centinel']);
  if (canManageUsers(currentProfile)) items.push(['#/users','Usuarios y permisos']);
  return <nav>{items.map(([href,label]) => <a key={href} className={(route.page === 'home' && href==='#/') || href.includes(route.page) ? 'active' : ''} href={href}>{label}</a>)}</nav>;
}
function RouterView({ route, data, refresh }: { route: Route; data: Bootstrap; refresh: () => Promise<void> }) {
  if (route.page === 'opportunities') return <OpportunityList data={data} />;
  if (route.page === 'tenders') return <TendersRadar currentProfile={data.currentProfile} />;
  if (route.page === 'detail' && route.id) return <OpportunityDetail id={route.id} data={data} refresh={refresh} />;
  if (route.page === 'new') return <OpportunityForm data={data} refresh={refresh} />;
  if (route.page === 'edit' && route.id) return <OpportunityForm data={data} id={route.id} refresh={refresh} />;
  if (route.page === 'dashboard') return <ManagerDashboard data={data} />;
  if (route.page === 'consultant' && route.id) return <ConsultantDetail data={data} ownerId={route.id} />;
  if (route.page === 'goals') return <GoalsCompliance data={data} refresh={refresh} />;
  if (route.page === 'alerts') return <CommercialAlerts data={data} />;
  if (route.page === 'centinel') return <CentinelAssistant data={data} />;
  if (route.page === 'users') return <UsersAdmin currentProfile={data.currentProfile} />;
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
function MiniTable({ rows, empty = 'Sin registros' }: { rows: Opportunity[]; empty?: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return <table className="mini-table"><tbody>{rows.map(o => <tr key={o.id} onClick={() => go(`#/detail/${o.id}`)} className="clickable"><td><strong>{o.company_name}</strong><br/><small>{o.owner_name || 'Sin comercial'} · <Badge tone={stageTone(o.stage_code)}>{o.stage_name}</Badge></small></td><td>{fmtMoney(o.offer_value)}</td></tr>)}</tbody></table>;
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div>✓</div><strong>{title}</strong><p>{text}</p></div>;
}
function OpportunityList({ data }: { data: Bootstrap }) {
  const [q, setQ] = useState(''); const [stage, setStage] = useState(''); const [owner, setOwner] = useState(''); const [regional, setRegional] = useState(''); const [service, setService] = useState('');
  const regionals = useMemo(() => uniq(data.opportunities.map(o => o.regional_nombre)), [data.opportunities]);
  const filtered = data.opportunities.filter(o => (!q || `${o.company_name} ${o.sede||''} ${o.legacy_excel_id||''}`.toLowerCase().includes(q.toLowerCase())) && (!stage || o.stage_code===stage) && (!owner || o.owner_id===owner) && (!regional || o.regional_nombre===regional) && (!service || o.service_type_code===service));
  return <section className="stack">
    <div className="filters"><input placeholder="Buscar cliente, sede o ID…" value={q} onChange={e=>setQ(e.target.value)} /> <Select value={stage} onChange={setStage} options={data.stages.map(s=>[s.code,s.name])} empty="Todas las etapas"/> <Select value={owner} onChange={setOwner} options={data.profiles.map(p=>[p.id,p.full_name])} empty="Todos los comerciales"/> <Select value={regional} onChange={setRegional} options={regionals.map(r=>[r,r])} empty="Todas las regionales"/> <Select value={service} onChange={setService} options={data.services.map(s=>[s.code,s.name])} empty="Todos los servicios"/></div>
    <p className="muted">Mostrando {filtered.length} de {data.opportunities.length} oportunidades.</p>
    <div className="tablewrap"><table><thead><tr><th>Cliente</th><th>Comercial</th><th>Regional</th><th>Etapa</th><th>Tipo producto</th><th>Valor</th><th>Cierre estimado</th><th>Último seguimiento</th></tr></thead><tbody>{filtered.map(o => <tr key={o.id} className="clickable" onClick={() => go(`#/detail/${o.id}`)}><td><strong>{o.company_name}</strong><br/><small>{o.sede || o.quote_city || '—'}</small></td><td>{o.owner_name || '—'}</td><td>{o.regional_nombre || '—'}</td><td><Badge>{o.stage_name}</Badge></td><td>{o.tipo_producto_original || o.service_type_name || '—'}</td><td>{fmtMoney(o.offer_value)}</td><td>{fmtDate(o.expected_close_date)}</td><td>{fmtDate(o.last_interaction_at)}</td></tr>)}</tbody></table></div>
  </section>;
}
function TendersRadar({ currentProfile }: { currentProfile: Profile }) {
  const [payload, setPayload] = useState<TenderRadarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<TenderSection | 'todas'>('hacer');
  const [q, setQ] = useState('');
  const load = async () => {
    setLoading(true); setError(null);
    try { setPayload(await api<TenderRadarPayload>('/api/tenders')); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  if (!canViewTenders(currentProfile)) return <div className="error">Solo dirección o licitaciones puede ver este radar.</div>;
  if (loading) return <div className="notice">Cargando radar de licitaciones…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!payload) return <EmptyState title="Sin datos" text="No se pudo cargar el radar de licitaciones." />;
  const rows = payload.tenders.filter(t => (section === 'todas' || t.section === section) && (!q || `${t.entity} ${t.city||''} ${t.title} ${t.ref||''}`.toLowerCase().includes(q.toLowerCase())));
  const grouped = { hacer: rows.filter(t => t.section === 'hacer'), revisar: rows.filter(t => t.section === 'revisar'), descartar: rows.filter(t => t.section === 'descartar') };
  return <section className="stack tenders-page">
    <section className="executive-hero">
      <div><span className="eyebrow">Radar público SECOP</span><h2>Licitaciones</h2><p>Procesos públicos priorizados para Seguridad Nacional. V1 es solo lectura: primero validamos, después se convierte a oportunidad comercial.</p></div>
      <div className="hero-facts"><div><small>Actualización</small><strong>{fmtDate(payload.generatedAt)}</strong></div><div><small>Acceso</small><strong>Dirección + Katherine</strong></div></div>
    </section>
    <div className="grid kpis">
      <Kpi icon="!" tone="amber" label="Hacer hoy" value={payload.totals.hacer.toString()} hint="Revisión prioritaria" meta="Cierre cercano / alto encaje" />
      <Kpi icon="↗" tone="blue" label="Revisar" value={payload.totals.revisar.toString()} hint="Oportunidades adicionales" meta="Validar si hay capacidad" />
      <Kpi icon="$" tone="purple" label="Alto valor" value={payload.totals.highValue.toString()} hint="$500M+ COP" meta="Procesos de mayor impacto" />
      <Kpi icon="⚑" tone="green" label="Total radar" value={payload.totals.all.toString()} hint="SECOP I/II priorizado" meta={`${payload.totals.urgent} cierres próximos`} />
    </div>
    <div className="filters"><input placeholder="Buscar entidad, ciudad, objeto o referencia…" value={q} onChange={e=>setQ(e.target.value)} /><Select value={section} onChange={v=>setSection(v as TenderSection | 'todas')} options={[["hacer","Hacer hoy"],["revisar","Revisar"],["descartar","Descartar / validar"],["todas","Todas"]]} empty="Sección"/><button className="secondary" onClick={load}>Actualizar</button></div>
    {section === 'todas' ? <TenderTable rows={rows} /> : <>
      <TenderSectionPanel title="Hacer hoy" rows={grouped.hacer} show={section === 'hacer'} />
      <TenderSectionPanel title="Revisar si hay tiempo" rows={grouped.revisar} show={section === 'revisar'} />
      <TenderSectionPanel title="Descartar o validar con cuidado" rows={grouped.descartar} show={section === 'descartar'} />
    </>}
  </section>;
}
function TenderSectionPanel({ title, rows, show }: { title: string; rows: PublicTender[]; show: boolean }) {
  if (!show) return null;
  return <Panel title={title}>{rows.length ? <div className="tender-cards">{rows.map(t => <TenderCard key={t.id} tender={t} />)}</div> : <EmptyState title="Sin licitaciones" text="No hay procesos en esta sección con los filtros actuales." />}</Panel>;
}
function TenderCard({ tender }: { tender: PublicTender }) {
  return <article className={`card tender-card tender-${tender.section}`}>
    <div className="tender-head"><div><small>{tender.source} · Score {tender.score}</small><h3>{tender.entity} — {tender.city || tender.dept || 'Sin ciudad'}</h3></div><Badge tone={tender.section === 'hacer' ? 'amber' : tender.section === 'descartar' ? 'danger' : 'blue'}>{tender.section === 'hacer' ? 'Hacer hoy' : tender.section === 'revisar' ? 'Revisar' : 'Validar'}</Badge></div>
    <p>{tender.title}</p>
    <div className="tender-meta"><span>{fmtMoney(tender.value)}</span><span>Cierre: {fmtDate(tender.deadline)}</span><span>Ref: {tender.ref || '—'}</span></div>
    <small className="muted">{tender.reasons.slice(0,4).join(' · ')}</small>
    {tender.risks.length > 0 && <small className="muted">Riesgos: {tender.risks.slice(0,2).join(' · ')}</small>}
    <div className="row-actions">{tender.url && <a className="button secondary" target="_blank" href={tender.url}>Abrir SECOP</a>}<button className="secondary" disabled title="Fase 2">Crear oportunidad</button></div>
  </article>;
}
function TenderTable({ rows }: { rows: PublicTender[] }) {
  if (!rows.length) return <EmptyState title="Sin resultados" text="No hay licitaciones con esos filtros." />;
  return <div className="tablewrap"><table><thead><tr><th>Entidad</th><th>Sección</th><th>Ubicación</th><th>Objeto</th><th>Valor</th><th>Cierre</th><th>Link</th></tr></thead><tbody>{rows.map(t => <tr key={t.id}><td><strong>{t.entity}</strong><br/><small>{t.ref || t.process_id || '—'}</small></td><td><Badge>{t.section}</Badge></td><td>{t.dept || '—'} / {t.city || '—'}</td><td>{t.title}</td><td>{fmtMoney(t.value)}</td><td>{fmtDate(t.deadline)}</td><td>{t.url ? <a target="_blank" href={t.url}>Abrir</a> : '—'}</td></tr>)}</tbody></table></div>;
}
function Select({ value, onChange, options, empty }: { value: string; onChange: (v:string)=>void; options: string[][]; empty: string }) { return <select value={value} onChange={e=>onChange(e.target.value)}><option value="">{empty}</option>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>; }
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
    <div className="grid three"><Info label="Servicio" value={o.service_type_name || o.tipo_producto_original}/><Info label="Cierre estimado" value={fmtDate(o.expected_close_date)}/><Info label="Próxima acción" value={fmtDate(o.next_action_at)}/><Info label="Estado próxima gestión" value={`${action.label} · ${action.detail}`}/><Info label="Días sin seguimiento" value={lastDays === null ? 'Sin registro' : `${lastDays} día(s)`}/><Info label="Decisor" value={o.decision_maker_name}/><Info label="Correo decisor" value={o.decision_maker_email}/><Info label="Teléfono" value={o.decision_maker_phone}/></div>
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
  });
  const [status, setStatus] = useState('');
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
function ManagerDashboard({ data }: { data: Bootstrap }) {
  const active = data.opportunities.filter(o => !['aprobado','perdido','descartado'].includes(o.stage_code)).length;
  const byOwner = useMemo(() => {
    const map = new Map<string, { ownerId: string; owner: string; count: number; value: number; weighted: number; approved: number; active: number }>();
    data.opportunities.forEach(o => {
      const key = ownerKey(o);
      const row = map.get(key) || { ownerId: key, owner: o.owner_name || 'Sin comercial', count: 0, value: 0, weighted: 0, approved: 0, active: 0 };
      row.count++;
      row.value += Number(o.offer_value || 0);
      row.weighted += Number(o.weighted_pipeline_value || 0);
      if (!['aprobado','perdido','descartado'].includes(o.stage_code)) row.active++;
      if (o.stage_code === 'aprobado') row.approved += Number(o.offer_value || 0);
      map.set(key,row);
    });
    return Array.from(map.values()).sort((a,b)=>b.value-a.value);
  }, [data.opportunities]);
  const leader = byOwner[0];
  const maxOwnerValue = Math.max(...byOwner.map(o=>o.value),1);
  const conversion = data.totals.pipeline ? Math.round((data.totals.approved / data.totals.pipeline) * 100) : 0;
  const stageRows = [...data.summary].sort((a,b)=>a.stage_order-b.stage_order);
  const stageLeader = [...data.summary].sort((a,b)=>Number(b.total_offer_value)-Number(a.total_offer_value))[0];
  const concentration = stageLeader && data.totals.pipeline ? Math.round((Number(stageLeader.total_offer_value || 0) / data.totals.pipeline) * 100) : 0;
  const staleCount = data.stalled.length;
  const commercialCards = byOwner.map(o => {
    const share = data.totals.pipeline ? Math.round((o.value / data.totals.pipeline) * 100) : 0;
    const winRate = o.value ? Math.round((o.approved / o.value) * 100) : 0;
    const status = winRate >= 20 ? 'green' : winRate >= 8 ? 'amber' : 'red';
    const statusLabel = winRate >= 20 ? 'Cierre fuerte' : winRate >= 8 ? 'En observación' : 'Requiere foco';
    return { ...o, share, winRate, status, statusLabel };
  });
  const monthlyByOwner = useMemo(() => {
    const map = new Map<string, { owner: string; prospectos: number; cotizaciones: number; ventas: number; comision: number }>();
    data.monthlyKpis.slice(0, 30).forEach(k => {
      const owner = k.owner_name || 'Sin comercial';
      const row = map.get(owner) || { owner, prospectos: 0, cotizaciones: 0, ventas: 0, comision: 0 };
      row.prospectos += Number(k.prospectos || 0);
      row.cotizaciones += Number(k.cotizaciones || 0);
      row.ventas += Number(k.ventas_aprobadas || 0);
      row.comision += Number(k.comision_proyectada || 0);
      map.set(owner, row);
    });
    return Array.from(map.values()).sort((a,b)=>b.ventas-a.ventas || b.cotizaciones-a.cotizaciones);
  }, [data.monthlyKpis]);
  const maxMonthly = Math.max(...monthlyByOwner.map(o=>Math.max(o.prospectos, o.cotizaciones, o.ventas / 10_000_000)), 1);
  const maxMonthlySales = Math.max(...monthlyByOwner.map(o=>o.ventas), 1);
  const actionText = stageLeader
    ? `Priorizar avance de ${stageLeader.stage_name}: concentra ${concentration}% del pipeline y puede liberar ${fmtMoneyCompact(stageLeader.weighted_pipeline_value)} ponderados.`
    : 'Mantener seguimiento semanal del pipeline y las oportunidades activas.';

  return <section className="stack manager-dashboard command-center">
    <section className="command-center-hero">
      <div className="command-copy">
        <div className="command-title-row"><span className="eyebrow">Sala de control comercial</span></div>
        <h2>{fmtMoneyCompact(data.totals.pipeline)} en pipeline comercial</h2>
        <p>{stageLeader ? `El ${concentration}% del valor está concentrado en ${stageLeader.stage_name}. La prioridad gerencial es mover ese valor hacia cierre sin perder visibilidad por comercial.` : 'Lectura ejecutiva del pipeline, forecast, concentración y riesgos comerciales.'}</p>
        <div className="command-metrics">
          <div><small>Forecast ponderado</small><strong>{fmtMoneyCompact(data.totals.weighted)}</strong><span>{fmtMoney(data.totals.weighted)}</span></div>
          <div><small>Ganado</small><strong>{fmtMoneyCompact(data.totals.approved)}</strong><span>{conversion}% de conversión</span></div>
          <div><small>Oportunidades activas</small><strong>{active}</strong><span>{data.totals.count} oportunidades totales</span></div>
        </div>
      </div>
      <div className="manager-action-panel">
        <small>Acción gerencial sugerida</small>
        <strong>{actionText}</strong>
        <div className="signal-grid">
          <span><b>{leader?.owner || '—'}</b><em>Líder pipeline</em></span>
          <span><b>{stageLeader?.stage_name || '—'}</b><em>Etapa crítica</em></span>
          <span><b>{staleCount ? staleCount : '0'}</b><em>Alertas</em></span>
        </div>
      </div>
    </section>

    <Panel title="Semáforos ejecutivos">
      <div className="executive-signals">
        <div className={concentration >= 55 ? 'signal-card warn' : 'signal-card ok'}><small>Concentración</small><strong>{concentration}%</strong><span>{stageLeader?.stage_name || 'Sin etapa dominante'}</span><em>{concentration >= 55 ? 'Alto peso en una sola etapa' : 'Distribución saludable'}</em></div>
        <div className={conversion >= 15 ? 'signal-card ok' : 'signal-card warn'}><small>Conversión aprobada</small><strong>{conversion}%</strong><span>{fmtMoneyCompact(data.totals.approved)} ganado</span><em>{conversion >= 15 ? 'Ritmo positivo' : 'Revisar avance a cierre'}</em></div>
        <div className={staleCount ? 'signal-card danger' : 'signal-card ok'}><small>Seguimientos críticos</small><strong>{staleCount}</strong><span>Sustentación &gt; 5 días</span><em>{staleCount ? 'Requiere acción inmediata' : 'Sin alertas activas'}</em></div>
        <div className="signal-card info"><small>Base activa</small><strong>{active}</strong><span>{data.totals.count} oportunidades totales</span><em>Operación comercial vigente</em></div>
      </div>
    </Panel>

    <Panel title="Embudo visual de valor por etapa">
      <div className="visual-funnel">{stageRows.map(s => {
        const value = Number(s.total_offer_value || 0);
        const pct = data.totals.pipeline ? Math.round((value / data.totals.pipeline) * 100) : 0;
        const width = Math.max(58, Math.min(100, 46 + pct * 0.8));
        return <div className={`funnel-segment stage-${stageTone(s.stage_code)}`} key={s.stage_code} style={{ width: `${width}%` }}>
          <div><small>{s.stage_name}</small><strong>{fmtMoneyCompact(value)}</strong></div>
          <span>{s.opportunities_count} ops · {pct}% del pipeline</span>
          <em>{fmtMoneyCompact(s.weighted_pipeline_value)} ponderado</em>
        </div>;
      })}</div>
    </Panel>

    <Panel title="Ranking comercial ejecutivo">
      <div className="status-legend"><span><i className="dot good"/> Cierre fuerte ≥20%</span><span><i className="dot warn"/> En observación 8–19%</span><span><i className="dot danger"/> Requiere foco &lt;8%</span></div>
      <div className="commercial-scorecards">{commercialCards.map((o, index) => <a className={`commercial-scorecard status-${o.status}`} key={o.ownerId} href={ownerRoute(o.ownerId)}>
        <div className="scorecard-top"><span className="owner-rank">#{index + 1}</span><span className={`status-pill ${o.status}`}>{o.statusLabel}</span></div>
        <div className="scorecard-name"><strong>{o.owner}</strong><small>{o.count} oportunidades · {o.active} activas</small></div>
        <div className="scorecard-value"><small>Pipeline</small><strong>{fmtMoneyCompact(o.value)}</strong><span>{o.share}% del total</span></div>
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
          <div><small>Mayor concentración</small><strong>{leader?.owner || '—'}</strong><span>{leader ? `${fmtMoneyCompact(leader.value)} en pipeline total` : 'Sin datos'}</span></div>
          <div><small>Etapa crítica</small><strong>{stageLeader?.stage_name || '—'}</strong><span>{stageLeader ? `${concentration}% del valor total concentrado` : 'Sin datos'}</span></div>
          <div><small>Riesgo operativo</small><strong>{data.stalled.length ? `${data.stalled.length} por revisar` : 'Sin alertas'}</strong><span>{data.stalled.length ? 'Requiere seguimiento comercial' : 'Sustentación al día'}</span></div>
        </div>
      </Panel>
      <Panel title="Pulso mensual por comercial">
        <div className="pulse-header"><span>Comercial</span><span>Ventas aprobadas</span><span>Prospectos</span><span>Cotizaciones</span></div>
        <div className="monthly-bars">{monthlyByOwner.map(row => <div className="monthly-row" key={row.owner}>
          <div className="monthly-name"><strong>{row.owner}</strong><span>{fmtMoneyCompact(row.comision)} comisión proyectada</span></div>
          <div className="pulse-value"><strong>{fmtMoneyCompact(row.ventas)}</strong><small>ventas aprobadas</small><div className="sales-meter"><span style={{ width: `${Math.max(3, row.ventas/maxMonthlySales*100)}%` }} /></div></div>
          <div className="monthly-track"><small>Prospectos</small><div className="mini-progress"><span style={{ width: `${Math.max(3, row.prospectos/maxMonthly*100)}%` }} /></div><b>{row.prospectos}</b></div>
          <div className="monthly-track quote"><small>Cotizaciones</small><div className="mini-progress"><span style={{ width: `${Math.max(3, row.cotizaciones/maxMonthly*100)}%` }} /></div><b>{row.cotizaciones}</b></div>
        </div>)}</div>
      </Panel>
    </div>
  </section>;
}

function ConsultantDetail({ data, ownerId }: { data: Bootstrap; ownerId: string }) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const opportunities = useMemo(() => data.opportunities
    .filter(o => ownerKey(o) === ownerId)
    .sort((a,b) => a.stage_order - b.stage_order || Number(b.offer_value || 0) - Number(a.offer_value || 0)), [data.opportunities, ownerId]);
  const ownerName = opportunities[0]?.owner_name || data.profiles.find(p => p.id === ownerId)?.full_name || 'Sin comercial';
  const monthly = data.monthlyKpis.filter(k => (k.owner_name || 'Sin comercial') === ownerName);
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
  const filteredOpportunities = opportunities.filter(o => {
    const action = nextActionStatus(o);
    const haystack = `${o.company_name} ${o.sede || ''} ${o.quote_city || ''} ${o.regional_nombre || ''} ${o.tipo_producto_original || ''}`.toLowerCase();
    return (!q || haystack.includes(q.toLowerCase()))
      && (!stage || o.stage_code === stage)
      && (!onlyActive || !isTerminalStage(o.stage_code))
      && (!actionFilter || action.code === actionFilter);
  });

  if (!opportunities.length) return <section className="stack"><div className="notice">No encontré oportunidades asociadas a este consultor.</div><button className="secondary" onClick={() => go('#/dashboard')}>Volver al dashboard gerencial</button></section>;

  return <section className="stack consultant-dashboard">
    <section className="executive-hero consultant-hero">
      <div>
        <span className="eyebrow">Detalle por consultor</span>
        <h2>{ownerName}</h2>
        <p>Vista consolidada de lo cotizado, prospectos, oportunidades activas, ventas aprobadas, forecast, próxima gestión e indicadores operativos del consultor.</p>
      </div>
      <div className="hero-facts">
        <div><small>Total pipeline</small><strong>{fmtMoneyCompact(totals.pipeline)}</strong></div>
        <div><small>Oportunidades activas</small><strong>{totals.active}</strong></div>
        <div><small>Conversión aprobada</small><strong>{conversion}%</strong></div>
      </div>
    </section>
    <div className="actions-row"><button className="secondary" onClick={() => go('#/dashboard')}>← Dashboard gerencial</button><button onClick={() => go(`#/opportunities`)}>Ver listado general</button></div>
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
      {monthly.length ? <div className="tablewrap"><table><thead><tr><th>Mes</th><th>Prospectos</th><th>Cotizaciones</th><th>Ventas aprobadas</th><th>Comisión proyectada</th></tr></thead><tbody>{monthly.slice(0,12).map((k,i)=><tr key={`${k.owner_name}-${k.period_month}-${i}`}><td>{fmtDate(k.period_month)}</td><td>{k.prospectos}</td><td>{k.cotizaciones}</td><td>{fmtMoneyCompact(k.ventas_aprobadas)}</td><td>{fmtMoneyCompact(k.comision_proyectada)}</td></tr>)}</tbody></table></div> : <p className="muted">Sin KPIs mensuales para este consultor.</p>}
    </Panel>
    <Panel title="Oportunidades del consultor">
      <div className="consultant-opportunity-filters filters">
        <input placeholder="Buscar cliente, sede, ciudad o servicio…" value={q} onChange={e=>setQ(e.target.value)} />
        <Select value={stage} onChange={setStage} options={consultantStageOptions.map(s=>[s.code,s.name])} empty="Todas las etapas" />
        <Select value={actionFilter} onChange={setActionFilter} options={[["missing","Sin agenda"],["overdue","Vencidas"],["today","Hoy"],["soon","Próximas"],["scheduled","Agendadas"]]} empty="Todas las gestiones" />
        <label className="check-filter"><input type="checkbox" checked={onlyActive} onChange={e=>setOnlyActive(e.target.checked)} /> Solo activas</label>
      </div>
      <p className="muted">Mostrando {filteredOpportunities.length} de {opportunities.length} oportunidades del consultor.</p>
      <div className="tablewrap"><table><thead><tr><th>Cliente</th><th>Regional</th><th>Etapa</th><th>Tipo producto</th><th>Valor</th><th>Próxima acción</th><th>Días sin seguimiento</th><th>Prioridad</th></tr></thead><tbody>{filteredOpportunities.map(o => {
        const action = nextActionStatus(o);
        const inactiveDays = daysSince(o.last_interaction_at || o.updated_at || o.created_at);
        return <tr key={o.id} className={`clickable action-${action.code}`} onClick={() => go(`#/detail/${o.id}`)}><td><strong>{o.company_name}</strong><br/><small>{o.sede || o.quote_city || '—'}</small></td><td>{o.regional_nombre || '—'}</td><td><Badge tone={stageTone(o.stage_code)}>{o.stage_name}</Badge></td><td>{o.tipo_producto_original || o.service_type_name || '—'}</td><td>{fmtMoney(o.offer_value)}</td><td><Badge tone={action.tone}>{action.label}</Badge><br/><small>{o.next_action_at ? fmtDate(o.next_action_at) : action.detail}</small></td><td>{inactiveDays === null ? '—' : `${inactiveDays} día(s)`}</td><td>{action.detail}</td></tr>;
      })}</tbody></table></div>
    </Panel>
  </section>;
}
function CommercialAlerts({ data }: { data: Bootstrap }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [stage, setStage] = useState('');
  const [hideClosed, setHideClosed] = useState(true);

  const active = data.opportunities.filter(o => !isTerminalStage(o.stage_code));
  const alertRows = active.map(o => {
    const action = nextActionStatus(o);
    const inactiveDays = daysSince(o.last_interaction_at || o.updated_at || o.created_at);
    const stalledSustentacion = o.stage_code === 'sustentacion' && Number(inactiveDays || 0) > 5;
    const alertCode = stalledSustentacion && ['scheduled','soon'].includes(action.code) ? 'stalled' : action.code;
    const alertLabel = alertCode === 'stalled' ? 'Sustentación estancada' : action.label;
    const alertTone = alertCode === 'stalled' ? 'danger' : action.tone;
    const priority = alertCode === 'overdue' ? 1 : alertCode === 'missing' ? 2 : alertCode === 'stalled' ? 3 : alertCode === 'today' ? 4 : alertCode === 'soon' ? 5 : 9;
    return { opportunity: o, action, inactiveDays, stalledSustentacion, alertCode, alertLabel, alertTone, priority };
  }).sort((a,b) => a.priority - b.priority || Number(b.opportunity.offer_value || 0) - Number(a.opportunity.offer_value || 0));

  const lowGoalRows = data.goals.map(g => {
    const profile = data.profiles.find(p => p.id === g.user_id);
    const kpi = data.monthlyKpis.find(k => k.owner_id === g.user_id && k.period_month === g.period_month);
    const sales = Number(kpi?.ventas_aprobadas || 0);
    const budget = Number(g.sales_budget || 0);
    const pct = budget ? Math.round((sales / budget) * 100) : null;
    return { goal: g, profile, sales, budget, pct };
  }).filter(r => r.pct !== null && Number(r.pct) < 80);

  const alertCards = [
    { label: 'Acciones críticas', value: alertRows.filter(r => ['overdue','missing','stalled'].includes(r.alertCode)).length, detail: 'Vencidas, sin agenda o estancadas', tone: 'danger' },
    { label: 'Sin próxima acción', value: alertRows.filter(r => r.alertCode === 'missing').length, detail: 'Oportunidades activas sin agenda', tone: 'amber' },
    { label: 'Vencidas', value: alertRows.filter(r => r.alertCode === 'overdue').length, detail: 'Gestión programada ya vencida', tone: 'danger' },
    { label: 'Sustentación estancada', value: alertRows.filter(r => r.alertCode === 'stalled').length, detail: 'Más de 5 días sin gestión', tone: 'danger' },
    { label: 'Bajo cumplimiento', value: lowGoalRows.length, detail: 'Metas por debajo de 80%', tone: lowGoalRows.length ? 'amber' : 'success' },
  ];

  const ownerOptions = data.profiles.filter(p => active.some(o => o.owner_id === p.id)).map(p => [p.id, p.full_name]);
  const stageOptions = data.stages.filter(s => active.some(o => o.stage_code === s.code)).map(s => [s.code, s.name]);
  const statusOptions = [['missing','Sin agenda'],['overdue','Vencidas'],['stalled','Sustentación estancada'],['today','Hoy'],['soon','Próximas'],['scheduled','Agendadas']];
  const filteredAlerts = alertRows.filter(row => {
    const o = row.opportunity;
    const haystack = `${o.company_name} ${o.owner_name || ''} ${o.regional_nombre || ''} ${o.sede || ''} ${o.quote_city || ''} ${o.tipo_producto_original || ''}`.toLowerCase();
    return (!q || haystack.includes(q.toLowerCase()))
      && (!status || row.alertCode === status)
      && (!owner || o.owner_id === owner)
      && (!stage || o.stage_code === stage)
      && (!hideClosed || !isTerminalStage(o.stage_code));
  });

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
        <Select value={stage} onChange={setStage} options={stageOptions} empty="Todas las etapas" />
        <label className="check-filter"><input type="checkbox" checked={hideClosed} onChange={e=>setHideClosed(e.target.checked)} /> Solo activas</label>
      </div>
    </Panel>
    <Panel title="Bandeja de alertas">
      <p className="muted">Mostrando {filteredAlerts.length} oportunidades. Click en una fila para abrir el detalle y registrar seguimiento.</p>
      <div className="tablewrap alert-table"><table><thead><tr><th>Alerta</th><th>Cliente</th><th>Comercial</th><th>Etapa</th><th>Valor</th><th>Próxima acción</th><th>Días sin seguimiento</th><th>Acción sugerida</th></tr></thead><tbody>{filteredAlerts.map(row => {
        const o = row.opportunity;
        return <tr key={o.id} className={`clickable alert-row alert-row-${row.alertCode}`} onClick={() => go(`#/detail/${o.id}`)}><td><Badge tone={row.alertTone}>{row.alertLabel}</Badge></td><td><strong>{o.company_name}</strong><br/><small>{o.regional_nombre || o.sede || '—'}</small></td><td>{o.owner_name || 'Sin comercial'}</td><td><Badge tone={stageTone(o.stage_code)}>{o.stage_name}</Badge></td><td>{fmtMoney(o.offer_value)}</td><td>{o.next_action_at ? fmtDate(o.next_action_at) : 'Sin agenda'}</td><td>{row.inactiveDays === null ? '—' : `${row.inactiveDays} día(s)`}</td><td>{row.alertCode === 'missing' ? 'Programar próxima gestión' : row.alertCode === 'overdue' ? 'Gestionar vencida' : row.alertCode === 'stalled' ? 'Revisar sustentación' : row.action.detail}</td></tr>;
      })}</tbody></table></div>
    </Panel>
    <Panel title="Cumplimiento bajo 80%">
      {lowGoalRows.length ? <div className="tablewrap"><table><thead><tr><th>Comercial</th><th>Mes</th><th>Ventas</th><th>Meta</th><th>Cumplimiento</th></tr></thead><tbody>{lowGoalRows.map(row => <tr key={`${row.goal.user_id}-${row.goal.period_month}`}><td>{row.profile?.full_name || 'Sin comercial'}</td><td>{fmtDate(row.goal.period_month)}</td><td>{fmtMoney(row.sales)}</td><td>{fmtMoney(row.budget)}</td><td><Badge tone="amber">{row.pct}%</Badge></td></tr>)}</tbody></table></div> : <EmptyState title="Sin alertas de cumplimiento" text="Cuando se carguen metas reales, aquí aparecerán comerciales por debajo del 80%." />}
    </Panel>
  </section>;
}


type CentinelResult = { title: string; summary: string; rows: Opportunity[]; cards: Array<{ label: string; value: string; detail: string }>; mode: 'alerts' | 'pipeline' | 'goals' | 'stalled' | 'large' | 'risk' | 'search' };

const centinelQuickActions = [
  { label: 'Oportunidades sin agenda', prompt: 'Muéstrame oportunidades sin agenda por comercial' },
  { label: 'Pipeline por etapa', prompt: 'Muéstrame pipeline por etapa y valor ponderado' },
  { label: 'Cumplimiento de metas', prompt: 'Muéstrame cumplimiento de metas por comercial' },
  { label: 'Clientes en sustentación', prompt: 'Muéstrame clientes en sustentación con días sin seguimiento' },
  { label: 'Próximas gestiones', prompt: 'Muéstrame próximas gestiones de esta semana' },
  { label: 'Oportunidades grandes', prompt: 'Muéstrame oportunidades grandes en negociación o sustentación' },
];

function isLargeOpportunityQuery(q: string) {
  return q.includes('grande') || q.includes('mayor valor') || q.includes('más valor') || q.includes('mas valor') || q.includes('alto valor') || q.includes('top oportunidad') || q.includes('importante');
}

function isRiskFollowUpQuery(q: string) {
  return q.includes('muchos días') || q.includes('muchos dias') || q.includes('sin seguimiento') || q.includes('abandonad') || q.includes('atrasad') || q.includes('riesgo') || q.includes('vencid');
}

function interpretCentinelQuery(query: string, data: Bootstrap): CentinelResult {
  const q = query.toLowerCase();
  const active = data.opportunities.filter(o => !isTerminalStage(o.stage_code));
  const baseRows = active.map(o => ({ o, action: nextActionStatus(o), inactiveDays: daysSince(o.last_interaction_at || o.updated_at || o.created_at) }));

  if (q.includes('sin agenda') || q.includes('sin próxima') || q.includes('sin proxima')) {
    const rows = baseRows.filter(r => r.action.code === 'missing').map(r => r.o).sort((a,b) => Number(b.offer_value || 0) - Number(a.offer_value || 0));
    const owners = topGroup(rows.map(o => o.owner_name || 'Sin comercial'));
    return { mode: 'alerts', title: 'Oportunidades sin agenda', summary: 'Oportunidades activas que todavía no tienen próxima gestión registrada.', rows, cards: [
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
    const rows = [...active].sort((a,b) => Number(b.offer_value || 0) - Number(a.offer_value || 0)).slice(0, 20);
    const goalCount = data.goals.length;
    const budget = data.goals.reduce((s,g)=>s+Number(g.sales_budget||0),0);
    const approved = data.monthlyKpis.reduce((s,k)=>s+Number(k.ventas_aprobadas||0),0);
    return { mode: 'goals', title: 'Cumplimiento de metas', summary: 'Vista segura de metas cargadas y ventas aprobadas. Si faltan metas, Centinel lo deja explícito.', rows, cards: [
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
    const rows = baseRows.filter(r => ['today','soon','scheduled','overdue'].includes(r.action.code)).map(r => r.o).sort((a,b) => String(a.next_action_at||'9999').localeCompare(String(b.next_action_at||'9999')));
    return { mode: 'alerts', title: 'Próximas gestiones', summary: 'Agenda comercial ordenada por fecha de próxima acción.', rows, cards: [
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
  return { mode: 'search', title: 'Búsqueda comercial segura', summary: 'Centinel encontró coincidencias en clientes, comerciales, etapas, regionales y tipo de producto.', rows, cards: [
    { label: 'Coincidencias', value: String(rows.length), detail: 'Oportunidades activas encontradas' },
    { label: 'Valor asociado', value: fmtMoneyCompact(rows.reduce((s,o)=>s+Number(o.offer_value||0),0)), detail: 'Pipeline filtrado' },
    { label: 'Modo', value: 'Solo lectura', detail: 'No modifica datos ni agenda' },
  ] };
}

function CentinelAssistant({ data }: { data: Bootstrap }) {
  const [query, setQuery] = useState('Muéstrame oportunidades sin agenda por comercial');
  const [submitted, setSubmitted] = useState(query);
  const result = useMemo(() => interpretCentinelQuery(submitted, data), [submitted, data]);
  const visibleRows = result.rows.slice(0, 25);
  return <section className="stack centinel-dashboard">
    <section className="centinel-topline"><h2>Pregúntale a Centinel</h2><p>Escribe lo que necesitas ver y Centinel te devuelve un reporte comercial seguro.</p></section>
    <section className="centinel-hero">
      <div className="centinel-orb"><span></span><span></span></div>
      <div><span className="eyebrow">CENTINEL</span><h2>Pregunta en español. Recibe el resultado.</h2><p>Pide el reporte como lo dirías en comité comercial. Centinel consulta pipeline, alertas, metas y seguimiento sin modificar información.</p></div>
      <div className="centinel-safe"><strong>Solo lectura</strong><small>Reporte seguro sobre datos del CRM</small></div>
    </section>
    <section className="centinel-query-panel">
      <label>¿Qué quieres analizar?</label>
      <textarea className="centinel-textarea" value={query} onChange={e => setQuery(e.target.value)} rows={4} />
      <div className="centinel-actions">
        <div>{centinelQuickActions.map(action => <button className="centinel-chip" key={action.label} onClick={() => { setQuery(action.prompt); setSubmitted(action.prompt); }}>{action.label}</button>)}</div>
        <button onClick={() => setSubmitted(query)}>Construir reporte seguro</button>
      </div>
    </section>
    <section className="centinel-result">
      <div className="centinel-result-head"><div><span className="eyebrow">Resultado Centinel</span><h2>{result.title}</h2><p>{result.summary}</p></div><button className="secondary" onClick={() => go('#/alerts')}>Abrir alertas comerciales</button></div>
      <div className="centinel-result-grid">{result.cards.map(card => <div className="centinel-result-card" key={card.label}><small>{card.label}</small><strong>{card.value}</strong><span>{card.detail}</span></div>)}</div>
      {result.mode === 'pipeline' && <StageBars summary={data.summary} />}
      <div className="tablewrap centinel-result-table"><table><thead><tr><th>Cliente</th><th>Comercial</th><th>Etapa</th><th>Valor</th><th>Próxima acción</th><th>Días sin seguimiento</th></tr></thead><tbody>{visibleRows.map(o => {
        const action = nextActionStatus(o);
        const inactive = daysSince(o.last_interaction_at || o.updated_at || o.created_at);
        return <tr key={o.id} className="clickable" onClick={() => go(`#/detail/${o.id}`)}><td><strong>{o.company_name}</strong><br/><small>{o.sede || o.regional_nombre || '—'}</small></td><td>{o.owner_name || 'Sin comercial'}</td><td><Badge tone={stageTone(o.stage_code)}>{o.stage_name}</Badge></td><td>{fmtMoney(o.offer_value)}</td><td><Badge tone={action.tone}>{action.label}</Badge><br/><small>{o.next_action_at ? fmtDate(o.next_action_at) : action.detail}</small></td><td>{inactive === null ? '—' : `${inactive} día(s)`}</td></tr>;
      })}</tbody></table></div>
      <p className="muted">Mostrando {visibleRows.length} de {result.rows.length} coincidencias. Click en una fila para abrir el detalle.</p>
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
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [ownerId, setOwnerId] = useState(data.currentProfile.role === 'comercial' ? data.currentProfile.id : (data.profiles[0]?.id || ''));
  const canEditGoals = canManageGoals(data.currentProfile);
  const [status, setStatus] = useState('');
  const periodMonth = `${year}-${String(month).padStart(2, '0')}-01`;
  const existing = data.goals.find(g => g.user_id === ownerId && String(g.period_month).slice(0, 7) === periodMonth.slice(0, 7));
  const [form, setForm] = useState({ sales_budget: '', prospect_target: '', quote_target: '' });

  useEffect(() => {
    setForm({
      sales_budget: existing ? String(Number(existing.sales_budget || 0)) : '',
      prospect_target: existing ? String(Number(existing.prospect_target || 0)) : '',
      quote_target: existing ? String(Number(existing.quote_target || 0)) : '',
    });
  }, [existing?.id, ownerId, year, month]);

  const ownerName = data.profiles.find(p => p.id === ownerId)?.full_name || 'Seleccionar asesor';
  const periods = buildCompliancePeriods(year, month);
  const rows = buildComplianceRows(data, ownerId, periods);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Guardando presupuesto…');
    try {
      await api<SalesGoal>('/api/goals', { method: 'PUT', body: JSON.stringify({
        user_id: ownerId,
        period_month: periodMonth,
        sales_budget: Number(form.sales_budget || 0),
        prospect_target: Number(form.prospect_target || 0),
        quote_target: Number(form.quote_target || 0),
      }) });
      setStatus('Presupuesto guardado.');
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
        <p>{canEditGoals ? 'Configuración mensual para gerencia y lectura automática del cumplimiento.' : 'Consulta de tus metas y cumplimiento comercial.'}</p>
      </div>
      <div className="hero-facts">
        <div><small>Asesor seleccionado</small><strong>{ownerName}</strong></div>
        <div><small>Periodo de carga</small><strong>{monthName(month)} {year}</strong></div>
        <div><small>Metas cargadas</small><strong>{data.goals.length}</strong></div>
      </div>
    </section>

    <div className="grid goals-layout">
      <Panel title={canEditGoals ? 'Panel de configuración gerencial' : 'Mis metas'}>
        <form className="form goals-form" onSubmit={save}>
          <div className="grid three compact-grid">
            <label>Año<input type="number" min="2024" max="2035" value={year} onChange={e=>setYear(Number(e.target.value || today.getFullYear()))}/></label>
            <label>Mes<Select value={String(month)} onChange={v=>setMonth(Number(v))} options={Array.from({ length: 12 }, (_, i) => [String(i + 1), monthName(i + 1)])} empty="Mes"/></label>
            <label>Asesor comercial<Select value={ownerId} onChange={setOwnerId} options={data.profiles.map(p=>[p.id,p.full_name])} empty="Seleccionar asesor"/></label>
          </div>
          <label>Presupuesto aprobado / ventas<input disabled={!canEditGoals} type="number" min="0" value={form.sales_budget} onChange={e=>setForm({...form, sales_budget:e.target.value})} placeholder="Ej: 250000000"/></label>
          <label>Prospectos nuevos<input disabled={!canEditGoals} type="number" min="0" value={form.prospect_target} onChange={e=>setForm({...form, prospect_target:e.target.value})} placeholder="Ej: 20"/></label>
          <label>Propuestas / cotizaciones<input disabled={!canEditGoals} type="number" min="0" value={form.quote_target} onChange={e=>setForm({...form, quote_target:e.target.value})} placeholder="Ej: 12"/></label>
          {canEditGoals && <button disabled={!ownerId}>Guardar Presupuesto</button>}
          {status && <small>{status}</small>}
          <p className="muted">Los permisos activos dependen del rol asignado al usuario autenticado.</p>
        </form>
      </Panel>

      <Panel title="Lectura de negocio">
        <div className="insight-list">
          <div><small>Real presupuesto</small><strong>Ventas aprobadas</strong><span>Oportunidades en estado Aprobado/Ganado.</span></div>
          <div><small>Real gestión</small><strong>Prospectos nuevos</strong><span>Oportunidades del mes que están en etapa Prospecto.</span></div>
          <div><small>Real preventa</small><strong>Propuestas / cotizaciones</strong><span>Oportunidades que llegaron a Envío de oferta o etapa posterior.</span></div>
        </div>
      </Panel>
    </div>

    <Panel title={`Panel de cumplimiento · ${ownerName}`}>
      <div className="compliance-legend"><span className="dot danger"/> Rojo &lt;80% <span className="dot warn"/> Amarillo 80–99% <span className="dot good"/> Verde ≥100%</div>
      <div className="tablewrap compliance-table"><table><thead><tr><th>Indicador</th>{periods.map(p => <th key={p.key}>{p.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.label}><td><strong>{row.label}</strong><br/><small>{row.description}</small></td>{periods.map(period => {
        const cell = row.values[period.key];
        return <td key={period.key} className={`compliance-cell ${goalStatusTone(cell.pct)}`}><strong>{formatGoalValue(row.kind, cell.goal)} / {formatGoalValue(row.kind, cell.actual)}</strong><span>{cell.pct === null ? 'Sin meta' : `${cell.pct}%`}</span></td>;
      })}</tr>)}</tbody></table></div>
    </Panel>
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
  return rows.map(row => ({ ...row, values: Object.fromEntries(periods.map(period => {
    const goal = data.goals
      .filter(g => g.user_id === ownerId && period.months.includes(String(g.period_month).slice(0, 7)))
      .reduce((sum, g) => sum + Number(g[row.goalField] || 0), 0);
    const actual = data.monthlyKpis
      .filter(k => (k.owner_id ? k.owner_id === ownerId : true) && period.months.includes(String(k.period_month).slice(0, 7)))
      .filter(k => k.owner_id || (data.profiles.find(p => p.id === ownerId)?.full_name || '') === (k.owner_name || ''))
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
  const emptyUserForm: UserPayload = { full_name: '', microsoft_email: '', role: 'comercial', active: true, password: '', send_invite: true };
  const [form, setForm] = useState<UserPayload>(emptyUserForm);
  const load = async () => { setUsers(await api<Profile[]>('/api/users')); };
  useEffect(() => { if (canManageUsers(currentProfile)) load().catch(e => setStatus(e instanceof Error ? e.message : String(e))); }, [currentProfile.id]);
  if (!canManageUsers(currentProfile)) return <div className="error">Solo admin puede administrar usuarios.</div>;
  const startEdit = (user: Profile) => {
    setEditingUserId(user.id);
    setForm({ full_name: user.full_name, microsoft_email: user.microsoft_email, role: user.role, active: user.active, password: '', send_invite: false });
    setStatus('Editando usuario existente. Deja la clave en blanco si no quieres cambiarla.');
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
      const saved = await api<Profile & { invited?: boolean }>(editingUserId ? `/api/users?id=${encodeURIComponent(editingUserId)}` : '/api/users', { method: editingUserId ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      setForm(emptyUserForm);
      setEditingUserId(null);
      await load();
      setStatus(editingUserId ? 'Usuario actualizado.' : (saved.invited ? 'Usuario guardado. Invitación enviada por correo.' : 'Usuario/perfil guardado.'));
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  };
  return <section className="stack">
    <section className="executive-hero"><div><span className="eyebrow">Administración</span><h2>Usuarios y permisos</h2><p>Crea usuarios de acceso y asigna el rol comercial, dirección, gerencia o admin.</p></div><div className="hero-facts"><div><small>Usuarios</small><strong>{users.length}</strong></div><div><small>Administrador</small><strong>{currentProfile.full_name}</strong></div></div></section>
    <Panel title={editingUserId ? 'Editar usuario' : 'Crear usuario'}>
      <form className="form gridform" onSubmit={submit}>
        <label>Nombre completo<input required value={form.full_name} onChange={e=>setForm({...form, full_name:e.target.value})}/></label>
        <label>Email<input type="email" required value={form.microsoft_email} onChange={e=>setForm({...form, microsoft_email:e.target.value})}/></label>
        <label>Rol<Select value={form.role} onChange={v=>setForm({...form, role:v})} options={[['comercial','Comercial'],['director','Directivo'],['gerencia','Gerencia'],['admin','Admin']]} empty="Rol"/></label>
        <label>Clave temporal<input type="password" minLength={8} value={form.password || ''} onChange={e=>setForm({...form, password:e.target.value})} placeholder={form.send_invite ? "Opcional si envías invitación" : "Mínimo 8 caracteres"}/></label>
        <label>Estado<Select value={form.active ? 'true' : 'false'} onChange={v=>setForm({...form, active:v==='true'})} options={[['true','Activo'],['false','Inactivo']]} empty="Estado"/></label>
        <label className="checkline"><input type="checkbox" checked={!!form.send_invite} onChange={e=>setForm({...form, send_invite:e.target.checked})}/> Enviar correo de invitación para que el usuario active su acceso</label>
        <div className="formactions"><button>{editingUserId ? 'Actualizar usuario' : 'Guardar usuario'}</button>{editingUserId && <button type="button" className="secondary" onClick={cancelEdit}>Cancelar edición</button>}{status && <span>{status}</span>}</div>
      </form>
    </Panel>
    <Panel title="Perfiles actuales"><div className="tablewrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{users.map(u => <tr key={u.id}><td><strong>{u.full_name}</strong></td><td>{u.microsoft_email}</td><td><Badge>{u.role}</Badge></td><td>{u.active ? 'Activo' : 'Inactivo'}</td><td><button type="button" className="secondary" onClick={() => startEdit(u)}>Editar</button></td></tr>)}</tbody></table></div></Panel>
  </section>;
}

createRoot(document.getElementById('root')!).render(<App />);
