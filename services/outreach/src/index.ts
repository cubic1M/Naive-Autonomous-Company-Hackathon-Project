// Public surface of the outreach package (owner: Andrew). apps/api imports from here.
export * from './types.js';
export { envFromProcess, DEFAULTS, type Env } from './env.js';
export { HttpMonid, type Monid, type MonidRunResult } from './monid.js';
export type { Repo } from './repo.js';
export { InMemoryRepo } from './repo/memory.js';
export { PostgresRepo } from './repo/postgres.js';
export { NaiveEmailSender, RecordingSender, type EmailSender, type SmsSender, type SendResult } from './senders.js';
export { findPeople, findPeopleDetailed } from './find.js';
export { sendBlast, sendBlastDetailed } from './blast.js';
export { signJobToken, verifyJobToken, jobLink } from './tokens.js';
export { classifyReply, handleReply } from './replies.js';
export { renderEmail, renderSms, renderRegularInvite, renderStopConfirmation, workerPay } from './templates.js';
export { pickChannel } from './channel.js';
export { outreachTools, findPeopleShape, sendBlastShape, type OutreachDeps } from './tools.js';
