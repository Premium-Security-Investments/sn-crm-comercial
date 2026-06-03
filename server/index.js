
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json({ limit: '1mb' }));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function sendError(res, error, status = 500) {
  console.error(error);
  res.status(status).json({ error: error?.message || String(error) });
}
async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
const opportunitySelect = '*';

app.get('/api/bootstrap', async (_req, res) => {
  try {
    const [summary, opportunities, profiles, stages, services, lossReasons, stalled, topClosing, monthlyKpis, goals] = await Promise.all([
      must(db.from('v_psi_sales_pipeline_summary').select('*').order('stage_order')),
      must(db.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).order('updated_at', { ascending: false }).limit(1000)),
      must(db.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active').eq('active', true).order('full_name')),
      must(db.from('psi_sales_pipeline_stages').select('*').order('stage_order')),
      must(db.from('psi_sales_service_types').select('*').eq('active', true).order('name')),
      must(db.from('psi_sales_loss_reasons').select('*').eq('active', true).order('name')),
      must(db.from('v_psi_sales_stalled_sustentacion').select(opportunitySelect).order('prioritization_date')),
      must(db.from('v_psi_sales_top3_closing').select(opportunitySelect).order('owner_name')),
      must(db.from('v_psi_sales_kpis_by_commercial_month').select('*').order('period_month', { ascending: false }).limit(80)),
      must(db.from('psi_sales_goals').select('*').order('period_month', { ascending: false }).limit(500)),
    ]);
    const totals = opportunities.reduce((acc, o) => {
      acc.count += 1;
      acc.pipeline += Number(o.offer_value || 0);
      acc.weighted += Number(o.weighted_pipeline_value || 0);
      if (o.stage_code === 'aprobado') acc.approved += Number(o.offer_value || 0);
      return acc;
    }, { count: 0, pipeline: 0, weighted: 0, approved: 0 });
    res.json({ summary, opportunities, profiles, stages, services, lossReasons, stalled, topClosing, monthlyKpis, goals, totals });
  } catch (error) { sendError(res, error); }
});

app.get('/api/opportunities/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const opportunity = await must(db.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single());
    const interactions = await must(db.from('psi_sales_interactions').select('*, psi_sales_profiles(full_name)').eq('opportunity_id', id).order('occurred_at', { ascending: false }));
    res.json({ opportunity, interactions });
  } catch (error) { sendError(res, error); }
});

function cleanOpportunity(body) {
  const payload = {
    company_name: String(body.company_name || '').trim(),
    owner_id: body.owner_id || null,
    economic_sector: body.economic_sector || null,
    decision_maker_name: body.decision_maker_name || null,
    decision_maker_email: body.decision_maker_email || null,
    decision_maker_phone: body.decision_maker_phone || null,
    quote_city: body.quote_city || null,
    quote_date: body.quote_date || null,
    offer_value: Number(body.offer_value || 0),
    service_type_code: body.service_type_code || null,
    stage_code: body.stage_code || 'prospecto',
    loss_reason_code: body.stage_code === 'perdido' ? body.loss_reason_code : null,
    loss_notes: body.loss_notes || null,
    next_action_at: body.next_action_at || null,
    expected_close_date: body.expected_close_date || null,
    commission_rate: Number(body.commission_rate || 0),
    regional_nombre: body.regional_nombre || null,
    sede: body.sede || null,
    tipo_producto_original: body.tipo_producto_original || null,
    observaciones: body.observaciones || null,
    external_source: body.external_source || 'web_mvp'
  };
  if (!payload.company_name) throw new Error('El cliente / empresa es obligatorio.');
  if (!payload.owner_id) throw new Error('El comercial responsable es obligatorio.');
  if (!payload.stage_code) throw new Error('La etapa es obligatoria.');
  if (!payload.service_type_code) throw new Error('El tipo de servicio es obligatorio.');
  if (Number.isNaN(payload.offer_value) || payload.offer_value < 0) throw new Error('El valor debe ser numérico y positivo.');
  if (payload.stage_code === 'perdido' && !payload.loss_reason_code) throw new Error('Si la oportunidad está perdida, debe registrar motivo de pérdida.');
  return payload;
}

app.post('/api/opportunities', async (req, res) => {
  try {
    const payload = cleanOpportunity(req.body);
    const data = await must(db.from('psi_sales_opportunities').insert(payload).select('id').single());
    res.status(201).json(data);
  } catch (error) { sendError(res, error, 400); }
});

app.put('/api/opportunities/:id', async (req, res) => {
  try {
    const payload = cleanOpportunity(req.body);
    const data = await must(db.from('psi_sales_opportunities').update(payload).eq('id', req.params.id).select('id').single());
    res.json(data);
  } catch (error) { sendError(res, error, 400); }
});

function normalizePeriodMonth(value) {
  const raw = String(value || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(raw)) throw new Error('Debe seleccionar año y mes válidos.');
  return `${raw}-01`;
}

function cleanGoal(body) {
  const payload = {
    user_id: body.user_id || null,
    period_month: normalizePeriodMonth(body.period_month),
    sales_budget: Number(body.sales_budget || 0),
    prospect_target: Number(body.prospect_target || 0),
    quote_target: Number(body.quote_target || 0),
  };
  if (!payload.user_id) throw new Error('Debe seleccionar un asesor comercial.');
  for (const [key, value] of Object.entries(payload)) {
    if (['sales_budget','prospect_target','quote_target'].includes(key) && (Number.isNaN(value) || Number(value) < 0)) {
      throw new Error('Las metas deben ser numéricas y positivas.');
    }
  }
  return payload;
}

app.get('/api/goals', async (_req, res) => {
  try {
    const data = await must(db.from('psi_sales_goals').select('*').order('period_month', { ascending: false }).limit(500));
    res.json(data);
  } catch (error) { sendError(res, error); }
});

app.put('/api/goals', async (req, res) => {
  try {
    const payload = cleanGoal(req.body);
    const data = await must(db.from('psi_sales_goals').upsert(payload, { onConflict: 'user_id,period_month' }).select('*').single());
    res.json(data);
  } catch (error) { sendError(res, error, 400); }
});

app.post('/api/opportunities/:id/interactions', async (req, res) => {
  try {
    const notes = String(req.body.notes || '').trim();
    if (!notes) throw new Error('La nota del seguimiento es obligatoria.');
    const occurred_at = req.body.occurred_at || new Date().toISOString();
    const interaction_type = req.body.interaction_type || 'nota';
    const created_by = req.body.created_by || null;
    const next_action_at = req.body.next_action_at || null;
    const row = { opportunity_id: req.params.id, notes, occurred_at, interaction_type, created_by };
    const data = await must(db.from('psi_sales_interactions').insert(row).select('id').single());
    const update = { last_interaction_at: occurred_at };
    if (next_action_at) update.next_action_at = next_action_at;
    await must(db.from('psi_sales_opportunities').update(update).eq('id', req.params.id).select('id').single());
    res.status(201).json(data);
  } catch (error) { sendError(res, error, 400); }
});

const dist = path.resolve(__dirname, '../dist');
app.use(express.static(dist));
app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = Number(process.env.PORT || 4173);
app.listen(port, '0.0.0.0', () => console.log(`Seguridad Nacional CRM server listening on http://0.0.0.0:${port}`));
