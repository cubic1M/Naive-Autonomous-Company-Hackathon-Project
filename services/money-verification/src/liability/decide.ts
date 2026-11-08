// services/money-verification/src/liability/decide.ts
import { InvalidStateError, NotFoundError } from '../errors.js';
import type { Repo } from '../repo.js';
import type { JobLiability } from '../types.js';
import { POLICY_VERSION, RULES, policyText, ruleById, type LiabilityModel } from './policy.js';

export interface LiabilityDeps {
  repo: Pick<Repo, 'getJob' | 'getJobLiability' | 'insertJobLiability' | 'decideJobLiability'>;
  now?: () => Date;
}

export interface LiabilityContext {
  job_id: string;
  pricing: JobLiability['pricing'];
  /** hints: mentions intake found that force nothing; the agent judges them (policy text, "Tags and hints"). */
  tags: { rules: string[]; forced: JobLiability['tags']['forced']; hints: string[] };
  decision: { model: string; rule_id: string | null; reason: string | null; decided_by: string | null; decided_at: string | null } | null;
  allowed_models: LiabilityModel[];
  policy_version: string;
  policy: string;
}

export interface DecisionOutcome {
  liability: JobLiability;
  /** What the API does next: wake the CEO to dispatch, or release the hold and cancel the job. */
  next: 'wake_ceo' | 'cancel';
  changed: boolean;
}

export function allowedModels(tags: JobLiability['tags']): LiabilityModel[] {
  if (tags.forced === 'refuse') return ['refuse'];
  if (tags.forced === 'connector') return ['connector', 'refuse'];
  return ['operis', 'connector', 'refuse'];
}

async function intakeRow(deps: LiabilityDeps, jobId: string): Promise<JobLiability> {
  return (await deps.repo.getJobLiability(jobId))
    ?? deps.repo.insertJobLiability({ job_id: jobId, tags: { rules: [], forced: null }, pricing: 'standard' });
}

const nextFor = (model: LiabilityModel): DecisionOutcome['next'] => (model === 'refuse' ? 'cancel' : 'wake_ceo');

export async function getLiabilityContext(deps: LiabilityDeps, jobId: string): Promise<LiabilityContext> {
  const row = await intakeRow(deps, jobId);
  return {
    job_id: jobId,
    pricing: row.pricing,
    tags: { rules: row.tags.rules, forced: row.tags.forced, hints: row.tags.hints ?? [] },
    decision: row.model
      ? { model: row.model, rule_id: row.rule_id, reason: row.reason, decided_by: row.decided_by, decided_at: row.decided_at?.toISOString() ?? null }
      : null,
    allowed_models: allowedModels(row.tags),
    policy_version: POLICY_VERSION,
    policy: policyText(),
  };
}

export async function setLiability(
  deps: LiabilityDeps,
  input: { jobId: string; model: LiabilityModel; ruleId: string; reason: string; decidedBy: string },
): Promise<DecisionOutcome> {
  // A decision belongs to a funded job that is not dispatched yet: later states would cancel or release the wrong thing.
  const job = await deps.repo.getJob(input.jobId);
  if (!job) throw new NotFoundError('job', input.jobId);
  if (job.status !== 'held') {
    throw new InvalidStateError(`job_not_held: job ${input.jobId} is ${job.status}; a liability decision is recorded only while the job is held (funded, not yet dispatched)`);
  }
  const row = await intakeRow(deps, input.jobId);
  const rule = ruleById(input.ruleId);
  if (!rule) throw new InvalidStateError(`unknown_rule: ${input.ruleId} is not in liability policy ${POLICY_VERSION}`);
  const allowed = allowedModels(row.tags);
  if (!allowed.includes(input.model)) {
    throw new InvalidStateError(`model_not_allowed: intake tags ${JSON.stringify(row.tags.rules)} allow only ${allowed.join(' or ')}`);
  }
  const licensed = rule.id === 'L1' || rule.id === 'L2';
  if (input.model === 'connector' && licensed && row.pricing === 'standard') {
    throw new InvalidStateError(
      'repost_required: this job was priced as a standard job; refuse it with rule L1 or L2 and tell the customer to post it again as a notary or legal job so it is priced as one',
    );
  }
  if (input.model === 'connector' && licensed && !row.tags.rules.includes(rule.id)) {
    throw new InvalidStateError(
      `rule_not_tagged: ${rule.id} is not among this job's intake tags ${JSON.stringify(row.tags.rules)}; record the tagged rule, so the licence checked at accept is the one the work needs`,
    );
  }
  const repostRefusal = input.model === 'refuse' && licensed && row.pricing === 'standard';
  if (rule.model !== input.model && !repostRefusal) {
    throw new InvalidStateError(`rule_mismatch: rule ${rule.id} (${rule.title}) means ${rule.model}, not ${input.model}`);
  }
  const reason = input.reason.trim();
  const { row: stored, changed } = await deps.repo.decideJobLiability(input.jobId, {
    model: input.model,
    rule_id: rule.id,
    reason,
    policy_version: POLICY_VERSION,
    decided_by: input.decidedBy,
    decided_at: deps.now?.() ?? new Date(),
  });
  if (!changed && (stored.model !== input.model || stored.rule_id !== rule.id)) {
    throw new InvalidStateError(`already_decided: job ${input.jobId} is ${stored.model} under ${stored.rule_id} (${stored.reason})`);
  }
  return { liability: stored, next: nextFor(stored.model as LiabilityModel), changed };
}

export async function decideFallback(deps: LiabilityDeps, jobId: string): Promise<DecisionOutcome> {
  const row = await intakeRow(deps, jobId);
  if (row.model) return { liability: row, next: nextFor(row.model), changed: false };
  const firstOf = (model: LiabilityModel) => RULES.find((r) => r.model === model && row.tags.rules.includes(r.id))?.id;
  const [model, ruleId] =
    row.tags.forced === 'refuse' ? (['refuse', firstOf('refuse') ?? 'R'] as const)
    : row.tags.forced === 'connector' ? (['connector', firstOf('connector') ?? 'U'] as const)
    : (['connector', 'U'] as const);
  return setLiability(deps, { jobId, model, ruleId, reason: 'no decision within fifteen minutes', decidedBy: 'fallback' });
}
