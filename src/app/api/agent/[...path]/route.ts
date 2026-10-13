import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, documents, orders, printJobs, printers, shops } from "@/db/schema";
import { ApiError, errorResponse, ok } from "@/lib/auth";
import { recordJobEvent, syncOrderFromJobs } from "@/lib/service";

export const dynamic = "force-dynamic";

const LEASE_SECONDS = 180;
const PROGRESS_STAGES = ["claimed", "downloading", "validating", "preparing", "submitting", "submitted_to_spooler"];

async function authAgent(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.headers.get("x-agent-token") ?? "";
  if (!token) throw new ApiError(401, "AGENT_AUTH", "Missing agent token");
  const [agent] = await db.select().from(agents).where(eq(agents.token, token)).limit(1);
  if (!agent) throw new ApiError(401, "AGENT_AUTH", "Invalid agent token");
  if (agent.revokedAt) throw new ApiError(403, "AGENT_REVOKED", "This agent has been revoked. Pair a new agent from the admin panel.");
  const [shop] = await db.select().from(shops).where(eq(shops.id, agent.shopId)).limit(1);
  if (!shop) throw new ApiError(404, "NOT_FOUND", "Shop not found");
  return { agent, shop };
}

type Params = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { path } = await params;
    const { agent, shop } = await authAgent(req);

    // GET /api/agent/jobs — available work (small payload)
    if (path[0] === "jobs" && path.length === 1) {
      if (shop.emergencyPaused) return ok({ paused: true, reason: "Emergency pause is active", jobs: [] });
      if (agent.paused) return ok({ paused: true, reason: "Agent is paused", jobs: [] });
      const rows = await db
        .select({ id: printJobs.id, label: printJobs.label, priority: printJobs.priority, createdAt: printJobs.createdAt, kind: printJobs.kind })
        .from(printJobs)
        .where(
          and(
            eq(printJobs.shopId, shop.id),
            eq(printJobs.status, "queued"),
            or(isNull(printJobs.leaseExpiresAt), lt(printJobs.leaseExpiresAt, new Date())),
          ),
        )
        .orderBy(asc(printJobs.priority), asc(printJobs.createdAt))
        .limit(20);
      return ok({ paused: false, jobs: rows });
    }

    // GET /api/agent/download/:jobId — scoped short-lived download
    if (path[0] === "download" && path[1]) {
      const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, path[1]), eq(printJobs.shopId, shop.id))).limit(1);
      if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");
      if (job.agentId !== agent.id) throw new ApiError(403, "NOT_YOUR_JOB", "This job is not assigned to your agent.");
      if (!job.documentId) {
        const { samplePdf } = await import("@/lib/files");
        return new Response(new Uint8Array(samplePdf(job.label)), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
      }
      const [doc] = await db.select().from(documents).where(eq(documents.id, job.documentId)).limit(1);
      if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");
      if (doc.filesClearedAt || !doc.fileData) {
        throw new ApiError(410, "FILE_CLEARED", "The source file was securely cleared and cannot be downloaded.");
      }
      return new Response(new Uint8Array(doc.fileData), {
        headers: {
          "Content-Type": doc.mime,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
          "X-PF-Checksum": doc.checksum ?? "",
          "Cache-Control": "no-store",
        },
      });
    }

    throw new ApiError(404, "NOT_FOUND", "Unknown agent endpoint");
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { path } = await params;
    const body = await req.json().catch(() => ({}));

    // POST /api/agent/pair — exchange one-time pairing code for machine token
    if (path[0] === "pair") {
      const code = String(body?.code ?? "").trim().toUpperCase();
      if (!code) throw new ApiError(400, "BAD_INPUT", "Missing pairing code");
      const [agent] = await db.select().from(agents).where(eq(agents.pairingCode, code)).limit(1);
      if (!agent || !agent.pairingCodeExpiresAt || new Date(agent.pairingCodeExpiresAt).getTime() < Date.now()) {
        throw new ApiError(401, "BAD_CODE", "Pairing code is invalid or expired. Generate a new one in the admin panel.");
      }
      if (agent.revokedAt) throw new ApiError(403, "AGENT_REVOKED", "This agent was revoked.");
      await db.update(agents).set({ pairingCode: null, pairingCodeExpiresAt: null }).where(eq(agents.id, agent.id));
      const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, agent.shopId)).limit(1);
      return ok({ agentId: agent.id, token: agent.token, shopName: shop?.name ?? "" });
    }

    const { agent, shop } = await authAgent(req);

    // POST /api/agent/heartbeat
    if (path[0] === "heartbeat") {
      const currentJobId = typeof body?.currentJobId === "string" ? body.currentJobId : null;
      await db
        .update(agents)
        .set({
          lastHeartbeatAt: new Date(),
          status: currentJobId ? "working" : "connected",
          version: typeof body?.version === "string" ? body.version : agent.version,
          hostname: typeof body?.hostname === "string" ? body.hostname : agent.hostname,
          os: typeof body?.os === "string" ? body.os : agent.os,
          currentJobId,
          diagnostics: typeof body?.diagnostics === "object" && body?.diagnostics ? body.diagnostics : agent.diagnostics,
        })
        .where(eq(agents.id, agent.id));

      const reported = Array.isArray(body?.printers) ? body.printers : [];
      for (const p of reported.slice(0, 20)) {
        const name = String(p?.name ?? "").trim();
        if (!name) continue;
        const caps = {
          sizes: Array.isArray(p?.capabilities?.sizes) ? p.capabilities.sizes.map(String) : ["A4"],
          color: Boolean(p?.capabilities?.color),
          duplex: Boolean(p?.capabilities?.duplex),
        };
        const existing = await db.select().from(printers).where(and(eq(printers.shopId, shop.id), eq(printers.agentId, agent.id), eq(printers.name, name))).limit(1);
        if (existing.length > 0) {
          await db.update(printers).set({ capabilities: caps, lastSeenAt: new Date(), status: String(p?.status ?? "online") }).where(eq(printers.id, existing[0].id));
        } else {
          await db.insert(printers).values({ shopId: shop.id, agentId: agent.id, name, capabilities: caps, lastSeenAt: new Date(), status: "online" });
        }
      }
      return ok({ ok: true, emergencyPaused: shop.emergencyPaused });
    }

    // POST /api/agent/jobs/:id/claim — atomic claim with lease
    if (path[0] === "jobs" && path[2] === "claim") {
      const jobId = path[1];
      if (shop.emergencyPaused) throw new ApiError(409, "SHOP_PAUSED", "Emergency pause is active — no new jobs can be claimed.");
      if (agent.paused) throw new ApiError(409, "AGENT_PAUSED", "This agent is paused.");

      const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.shopId, shop.id))).limit(1);
      if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");
      if (job.status !== "queued") throw new ApiError(409, "NOT_CLAIMABLE", `Job is "${job.status}" and cannot be claimed.`);

      // Payment/approval gate re-check — never print unpaid or unapproved work.
      if (job.orderId) {
        const [order] = await db.select().from(orders).where(eq(orders.id, job.orderId)).limit(1);
        if (!order || order.paymentStatus !== "paid") throw new ApiError(409, "GATE_PAYMENT", "Order payment is not confirmed — job is not printable.");
        if (order.status === "cancelled" || order.status === "rejected") throw new ApiError(409, "GATE_ORDER", "Order is cancelled or rejected.");
      }

      const claimed = await db
        .update(printJobs)
        .set({
          status: "printing",
          agentId: agent.id,
          leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000),
          startedAt: sql`coalesce(${printJobs.startedAt}, now())`,
          attempts: sql`${printJobs.attempts} + 1`,
          progressStage: "claimed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(printJobs.id, jobId),
            eq(printJobs.status, "queued"),
            or(isNull(printJobs.leaseExpiresAt), lt(printJobs.leaseExpiresAt, new Date())),
          ),
        )
        .returning();
      if (claimed.length === 0) throw new ApiError(409, "ALREADY_CLAIMED", "Another agent claimed this job first.");

      await recordJobEvent(jobId, "claimed", `agent:${agent.name}`, `Claimed by ${agent.name} (lease ${LEASE_SECONDS}s)`);
      await db.update(agents).set({ currentJobId: jobId, status: "working" }).where(eq(agents.id, agent.id));
      if (job.orderId) await db.update(orders).set({ status: "printing", updatedAt: new Date() }).where(eq(orders.id, job.orderId));

      const doc = job.documentId ? (await db.select().from(documents).where(eq(documents.id, job.documentId)).limit(1))[0] : null;
      if (doc && (doc.filesClearedAt || !doc.fileData)) {
        await db.update(printJobs).set({ status: "failed", errorReason: "FILE_CLEARED", progressStage: "failed", updatedAt: new Date() }).where(eq(printJobs.id, jobId));
        await recordJobEvent(jobId, "failed", "system", "Source file was securely cleared before printing");
        if (job.orderId) await syncOrderFromJobs(job.orderId);
        throw new ApiError(410, "FILE_CLEARED", "Source file was cleared — job marked failed for staff review.");
      }

      const printerRows = await db.select().from(printers).where(eq(printers.shopId, shop.id));
      const assigned = printerRows.find((p) => p.id === job.printerId) ?? printerRows.find((p) => p.isDefault && p.enabled) ?? printerRows.find((p) => p.enabled);
      return ok({
        job: {
          id: job.id,
          label: job.label,
          kind: job.kind,
          testMode: agent.testMode || job.testMode,
          config: job.configSnapshot,
          priority: job.priority,
          leaseSeconds: LEASE_SECONDS,
        },
        file: doc
          ? { url: `/api/agent/download/${job.id}`, fileName: doc.fileName, sizeBytes: Number(doc.sizeBytes), checksum: doc.checksum, pageCount: doc.pageCount, needsConversion: doc.needsConversion }
          : { url: `/api/agent/download/${job.id}`, fileName: "test-page.pdf", sizeBytes: 0, checksum: null, pageCount: 1, needsConversion: false },
        printer: assigned ? { id: assigned.id, name: assigned.name, capabilities: assigned.capabilities } : null,
      });
    }

    // POST /api/agent/jobs/:id/progress
    if (path[0] === "jobs" && path[2] === "progress") {
      const jobId = path[1];
      const stage = String(body?.stage ?? "");
      if (!PROGRESS_STAGES.includes(stage)) throw new ApiError(400, "BAD_STAGE", `Invalid stage "${stage}"`);
      const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.agentId, agent.id))).limit(1);
      if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found or not assigned to this agent");
      const eventId = typeof body?.eventId === "string" ? body.eventId : undefined;
      const fresh = await recordJobEvent(jobId, stage, `agent:${agent.name}`, typeof body?.detail === "string" ? body.detail : undefined, eventId);
      if (fresh) {
        await db.update(printJobs).set({ progressStage: stage, leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000), updatedAt: new Date() }).where(eq(printJobs.id, jobId));
      }
      return ok({ accepted: fresh });
    }

    // POST /api/agent/jobs/:id/renew-lease
    if (path[0] === "jobs" && path[2] === "renew-lease") {
      const jobId = path[1];
      const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.agentId, agent.id))).limit(1);
      if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");
      await db.update(printJobs).set({ leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000), updatedAt: new Date() }).where(eq(printJobs.id, jobId));
      return ok({ leaseSeconds: LEASE_SECONDS });
    }

    // POST /api/agent/jobs/:id/result — terminal outcome
    if (path[0] === "jobs" && path[2] === "result") {
      const jobId = path[1];
      const status = String(body?.status ?? "");
      if (!["completed", "failed"].includes(status)) throw new ApiError(400, "BAD_INPUT", "Result must be completed or failed");
      const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.agentId, agent.id))).limit(1);
      if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found or not assigned to this agent");
      if (["completed", "cancelled"].includes(job.status)) return ok({ alreadyTerminal: true }); // idempotent

      const eventId = typeof body?.eventId === "string" ? body.eventId : undefined;
      const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : undefined;
      const spoolerRef = typeof body?.spoolerRef === "string" ? body.spoolerRef.slice(0, 120) : null;

      if (status === "completed") {
        await db
          .update(printJobs)
          .set({ status: "completed", progressStage: "completed", completedAt: new Date(), spoolerRef, errorReason: null, leaseExpiresAt: null, updatedAt: new Date() })
          .where(eq(printJobs.id, jobId));
        await recordJobEvent(jobId, "completed", `agent:${agent.name}`, spoolerRef ? `Spooler accepted job (${spoolerRef})` : "Job completed", eventId);
        if (job.printerId) await db.update(printers).set({ jobsPrinted: sql`${printers.jobsPrinted} + 1`, lastSeenAt: new Date() }).where(eq(printers.id, job.printerId));
      } else {
        await db
          .update(printJobs)
          .set({ status: "failed", progressStage: "failed", errorReason: reason ?? "Unknown failure", leaseExpiresAt: null, updatedAt: new Date() })
          .where(eq(printJobs.id, jobId));
        await recordJobEvent(jobId, "failed", `agent:${agent.name}`, reason ?? "Unknown failure", eventId);
      }
      await db.update(agents).set({ currentJobId: null, status: "connected", lastHeartbeatAt: new Date() }).where(eq(agents.id, agent.id));
      if (job.orderId) await syncOrderFromJobs(job.orderId);
      return ok({ status });
    }

    throw new ApiError(404, "NOT_FOUND", "Unknown agent endpoint");
  } catch (err) {
    return errorResponse(err);
  }
}
