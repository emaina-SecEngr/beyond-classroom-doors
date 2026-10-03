/**
 * App Worker — explicit assembly for DeepSpace app routes and Durable Objects.
 *
 * Route implementations live under src/server. Keep their registration order
 * here: specific API and WebSocket handlers must precede the SPA fallback.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  armCronRoom,
  CanvasRoom,
  CronRoom,
  JobRoom,
  PresenceRoom,
  RecordRoom,
  resolveAppRole,
  workerErrorHandler,
  YjsRoom,
} from 'deepspace/worker'
import type { DOBindings, DOManifest, Job, JobContext } from 'deepspace/worker'
import { AI_CHATS_SCHEMA } from 'deepspace/schema'
import { registerAgent } from './src/ai/agent.js'
import { buildTools } from './src/ai/tools.js'
import { tasks as cronTasks, runTask as runCronTask } from './src/cron.js'
import { runJob } from './src/jobs.js'
import { schemas } from './src/schemas.js'
import { registerActionRoutes } from './src/server/action-routes.js'
import {
  registerAuthAndIntegrationRoutes,
  registerPlatformProxyRoutes,
  registerStaticRoutes,
  resolveAuth,
} from './src/server/http-routes.js'
import { registerRealtimeRoutes } from './src/server/realtime-routes.js'
import { decideSetRole, isSetRoleMessage } from './src/server/staff-guard.js'

// Dynamic deploy reads this manifest to create the app's DO bindings.
export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'JOB_ROOMS', className: 'AppJobRoom', sqlite: true },
] as const satisfies DOManifest

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }

  /**
   * Decision R6: only the nonprofit admin (the app owner) may make someone program
   * staff or remove them. DeepSpace's own set-role handler lets ANY admin set ANY
   * role with no audit trail, so its message is checked here first. Everything
   * else passes straight through to DeepSpace.
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === 'string') {
      let msg: unknown = null
      try {
        msg = JSON.parse(message)
      } catch {
        // Not JSON: DeepSpace reports the error itself.
      }
      if (isSetRoleMessage(msg)) {
        const caller = ws.deserializeAttachment() as { userId?: string; role?: string } | null
        const callerId = caller?.userId ?? ''
        const decision = decideSetRole(callerId, this.env.OWNER_USER_ID, msg.payload)
        if (!decision.allow) {
          ws.send(JSON.stringify({ type: 'core.error', payload: { error: decision.error } }))
          // Audit refusals from staff (the case that matters); non-admins are refused by
          // DeepSpace anyway, and logging them would let anyone flood the audit log.
          if (caller?.role === 'admin') {
            await this.auditStaffChange(callerId, 'staff_change_refused', decision.targetId, '', '', decision.error)
          }
          return
        }
        const before = await this.roleOf(decision.targetId)
        await super.webSocketMessage(ws, message)
        const after = await this.roleOf(decision.targetId)
        if (after === decision.role && before !== after) {
          await this.auditStaffChange(callerId, decision.role === 'admin' ? 'grant_staff' : 'remove_staff', decision.targetId, before, after, '')
        }
        return
      }
    }
    return super.webSocketMessage(ws, message)
  }

  /** Runs a record tool inside this room as the app (RBAC off), like server actions do. */
  private async tool(userId: string, tool: string, params: Record<string, unknown>): Promise<{ success: boolean; data?: unknown }> {
    const res = await this.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-App-Action': 'true' },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return (await res.json()) as { success: boolean; data?: unknown }
  }

  private async roleOf(userId: string): Promise<string> {
    if (!userId) return ''
    const r = await this.tool(this.env.OWNER_USER_ID, 'records.get', { collection: 'users', recordId: userId })
    const role = (r.data as { record?: { data?: { role?: unknown } } } | undefined)?.record?.data?.role
    return r.success && typeof role === 'string' ? role : ''
  }

  private async auditStaffChange(actorId: string, action: string, targetId: string, fromState: string, toState: string, reason: string) {
    try {
      await this.tool(actorId || this.env.OWNER_USER_ID, 'records.create', {
        collection: 'audit_log',
        data: { actorId: actorId || 'unknown', action, targetType: 'user', targetId: targetId || 'unknown', fromState, toState, reason },
      })
    } catch (e) {
      console.error(`[staff-guard] audit write failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

export class AppYjsRoom extends YjsRoom<Env> {}
export class AppCanvasRoom extends CanvasRoom<Env> {}
export class AppPresenceRoom extends PresenceRoom<Env> {}

/** Runs the scheduled tasks defined in src/cron.ts. */
export class AppCronRoom extends CronRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
  }

  protected async onTask(taskName: string): Promise<void> {
    await runCronTask(taskName, this.env)
  }
}

/** Runs durable background work defined in src/jobs.ts. */
export class AppJobRoom extends JobRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      authorizeWrite: async (user) => {
        if (user.userId.startsWith('anon-')) return false
        const role = await resolveAppRole(env, user.userId)
        return role === 'member' || role === 'admin'
      },
    })
  }

  protected async onJob(job: Job, context: JobContext): Promise<unknown> {
    return await runJob(job, context, this.env)
  }
}

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  /**
   * Platform service binding in production; deepspace dev supplies the URL
   * fallback. Standard app files use the platform's shared, app-scoped R2
   * bucket rather than a local binding.
   */
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  /**
   * HMAC app credential minted on first deploy. Proxy routes omit identity
   * headers when it is absent so upstream services fail closed.
   */
  APP_IDENTITY_TOKEN?: string
  /** API service binding in production with a deepspace-dev URL fallback. */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  /** Comma-separated exact Expo/native callback URIs (for example, veriluma://auth/callback). */
  NATIVE_AUTH_REDIRECT_URIS?: string
  APP_NAME: string
  /** Immutable record-scope and platform identity. */
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  /**
   * Long-lived owner JWT used for developer-billed server calls. User-billed
   * calls always forward the signed-in caller's JWT instead.
   */
  APP_OWNER_JWT: string
  /**
   * Enables /api/debug/* only when exactly "true". The route still requires
   * an authenticated app owner/admin. deepspace dev/test set it locally.
   */
  ALLOW_DEBUG_ROUTES?: string
}

export type AppContext = { Bindings: Env }

const app = new Hono<AppContext>()
app.use('/api/*', cors())
// A Durable Object exists only once something fetches it, and the CronRoom
// arms its alarm in that first fetch — so wake it from the request path, or a
// deployed schedule waits for a visitor. Once per isolate; no-op without tasks.
app.use('*', async (c, next) => {
  armCronRoom(c.executionCtx, c.env.CRON_ROOMS, `app:${c.env.DEEPSPACE_APP_ID}`, cronTasks)
  await next()
})

// Registration order is part of the worker contract. The wildcard auth route
// follows its special cases, AI precedes platform proxies, and static is last.
registerAuthAndIntegrationRoutes(app)
registerRealtimeRoutes(app)
registerActionRoutes(app, resolveAuth)
// The in-app assistant stores chat history in `ai-chats` / `ai-messages`,
// which only the copilot overlay declares. When present, registerAgent enables
// both that website AI and the user's local Codex/Claude/etc. assistant.
if (schemas.some((schema) => schema.name === AI_CHATS_SCHEMA.name)) {
  registerAgent(app, { tools: buildTools })
}
registerPlatformProxyRoutes(app)
registerStaticRoutes(app)

// Hono registers ONE error handler (last onError wins), and its default is
// `console.error(err)` — whose message Workers Logs drops, keeping only the
// stack frames. workerErrorHandler logs the string form instead (message
// first, frames and bounded cause chain, method + path for context), keeps a
// response-bearing error's (HTTPException — auth 401s, upload 413s) own
// answer, and returns a generic 500 for the rest.
app.onError(workerErrorHandler('error'))

export default app
