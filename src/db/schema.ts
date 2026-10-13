import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigint,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

// ---------- Identity ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    accent: text("accent").notNull().default("#42E8D1"),
    profile: jsonb("profile").notNull().default({}),
    operatingMode: text("operating_mode").notNull().default("auto"),
    emergencyPaused: boolean("emergency_paused").notNull().default(false),
    retentionDays: integer("retention_days").notNull().default(0),
    lastCleanupAt: timestamp("last_cleanup_at"),
    orderSeq: integer("order_seq").notNull().default(1000),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("shops_slug_idx").on(t.slug)],
);

export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("counter"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("staff_shop_user_uq").on(t.shopId, t.userId)],
);

// ---------- Documents & files ----------

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id"),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    ext: text("ext").notNull(),
    kind: text("kind").notNull().default("pdf"), // pdf | image | office | other
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: text("checksum"),
    pageCount: integer("page_count"),
    needsConversion: boolean("needs_conversion").notNull().default(false),
    status: text("status").notNull().default("ready"),
    errorNote: text("error_note"),
    fileData: bytea("file_data"),
    filesClearedAt: timestamp("files_cleared_at"),
    clearedBytes: bigint("cleared_bytes", { mode: "number" }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("documents_shop_idx").on(t.shopId), index("documents_order_idx").on(t.orderId)],
);

// ---------- Orders ----------

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderNumber: text("order_number").notNull(),
    token: text("token").notNull().unique(),
    customerName: text("customer_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    note: text("note"),
    status: text("status").notNull().default("received"),
    paymentMethod: text("payment_method").notNull().default("counter"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    currency: text("currency").notNull().default("INR"),
    subtotal: integer("subtotal").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    total: integer("total").notNull().default(0),
    pricingVersion: integer("pricing_version").notNull().default(1),
    priceSnapshot: jsonb("price_snapshot").notNull().default({}),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("orders_shop_status_idx").on(t.shopId, t.status),
    index("orders_shop_created_idx").on(t.shopId, t.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull(),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    label: text("label").notNull(),
    config: jsonb("config").notNull().default({}),
    pages: integer("pages").notNull().default(1),
    sheets: integer("sheets").notNull().default(1),
    lineTotal: integer("line_total").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    note: text("note"),
    actor: text("actor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId)],
);

// ---------- Print jobs ----------

export const printJobs = pgTable(
  "print_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    itemId: uuid("item_id").references(() => orderItems.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    label: text("label").notNull().default("Print job"),
    kind: text("kind").notNull().default("order"), // order | test
    status: text("status").notNull().default("queued"),
    progressStage: text("progress_stage"),
    printerId: uuid("printer_id"),
    priority: integer("priority").notNull().default(3),
    attempts: integer("attempts").notNull().default(0),
    agentId: uuid("agent_id"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    spoolerRef: text("spooler_ref"),
    testMode: boolean("test_mode").notNull().default(false),
    errorReason: text("error_reason"),
    configSnapshot: jsonb("config_snapshot").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("print_jobs_queue_idx").on(t.shopId, t.status, t.priority, t.createdAt),
    index("print_jobs_order_idx").on(t.orderId),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => printJobs.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    detail: text("detail"),
    source: text("source").notNull().default("system"),
    eventId: text("event_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId)],
);

// ---------- Payments ----------

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("sandbox"),
    method: text("method").notNull().default("counter"),
    providerRef: text("provider_ref"),
    amount: integer("amount").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default("pending"),
    verifiedBy: text("verified_by"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_shop_idx").on(t.shopId)],
);

// ---------- Pricing ----------

export const pricingVersions = pgTable(
  "pricing_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    rules: jsonb("rules").notNull(),
    published: boolean("published").notNull().default(true),
    changedBy: text("changed_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("pricing_shop_idx").on(t.shopId, t.version)],
);

// ---------- Devices: printers & agents ----------

export const printers = pgTable(
  "printers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id"),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    status: text("status").notNull().default("online"),
    capabilities: jsonb("capabilities").notNull().default({}),
    lastSeenAt: timestamp("last_seen_at"),
    lastTestAt: timestamp("last_test_at"),
    lastTestResult: text("last_test_result"),
    jobsPrinted: integer("jobs_printed").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("printers_shop_idx").on(t.shopId)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    token: text("token").notNull().unique(),
    version: text("version").notNull().default("1.0.0"),
    hostname: text("hostname"),
    os: text("os"),
    status: text("status").notNull().default("never_connected"),
    testMode: boolean("test_mode").notNull().default(true),
    paused: boolean("paused").notNull().default(false),
    pairingCode: text("pairing_code"),
    pairingCodeExpiresAt: timestamp("pairing_code_expires_at"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    currentJobId: uuid("current_job_id"),
    diagnostics: jsonb("diagnostics").notNull().default({}),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("agents_shop_idx").on(t.shopId)],
);

// ---------- Audit ----------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    summary: text("summary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_shop_idx").on(t.shopId, t.createdAt)],
);

// ---------- Idempotency ----------

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    result: jsonb("result").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_scope_key_uq").on(t.scope, t.key)],
);
