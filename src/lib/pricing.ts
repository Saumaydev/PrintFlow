import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { pricingVersions } from "@/db/schema";
import { parsePageRange } from "./utils";

export type QuoteItem = {
  documentId: string;
  label: string;
  pageCount: number | null;
  kind: string;
  needsConversion?: boolean;
  config: {
    copies: number;
    colorMode: "bw" | "color";
    paperSize: string;
    orientation: "portrait" | "landscape" | "auto";
    duplex: "off" | "long" | "short";
    pagesPerSheet: number;
    pageRange: string;
    scaling: string;
    finishing: string[];
    urgent?: boolean;
  };
};

export type QuoteLine = {
  documentId: string;
  label: string;
  printablePages: number;
  faces: number;
  sheets: number;
  copies: number;
  rate: number;
  base: number;
  finishing: { name: string; amount: number }[];
  urgentFee: number;
  lineTotal: number;
  note?: string;
};

export type QuoteResult = {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  pricingVersion: number;
  warnings: string[];
};

export const DEFAULT_RULES = {
  currency: "INR",
  taxRate: 18,
  bwPerPage: 200, // paise per printed side
  colorPerPage: 1000,
  sizeMultiplier: { A4: 1, A5: 0.75, A3: 2, Letter: 1, Legal: 1.25 } as Record<string, number>,
  duplexFactor: 0.9, // 10% saving on double-sided jobs
  minJobPaise: 1000,
  urgentPct: 25,
  maxCopies: 50,
  finishing: {
    spiral: { label: "Spiral binding", price: 3000 },
    lamination: { label: "Lamination", price: 2000 },
    staple: { label: "Staple & corner fold", price: 500 },
    hardcover: { label: "Hardcover binding", price: 12000 },
  } as Record<string, { label: string; price: number }>,
};

export type PricingRules = typeof DEFAULT_RULES;

export async function getActivePricing(shopId: string): Promise<{ rules: PricingRules; version: number }> {
  const rows = await db
    .select()
    .from(pricingVersions)
    .where(eq(pricingVersions.shopId, shopId))
    .orderBy(desc(pricingVersions.version))
    .limit(1);
  const row = rows[0];
  if (!row) return { rules: DEFAULT_RULES, version: 1 };
  return { rules: { ...DEFAULT_RULES, ...(row.rules as object) } as PricingRules, version: row.version };
}

export function computeQuote(rules: PricingRules, items: QuoteItem[], version: number): QuoteResult {
  const warnings: string[] = [];
  const lines: QuoteLine[] = [];
  let subtotal = 0;

  for (const item of items) {
    const cfg = item.config;
    const copies = Math.max(1, Math.min(cfg.copies || 1, rules.maxCopies));
    const pageCount = item.pageCount ?? 1;

    let printablePages = pageCount;
    let note: string | undefined;
    if (item.kind === "office" || item.needsConversion) {
      note = "Office file — will be converted to PDF before printing. Page count is an estimate.";
    } else if (item.kind === "pdf") {
      try {
        printablePages = parsePageRange(cfg.pageRange, pageCount).length;
      } catch (e) {
        throw new Error(`${item.label}: ${e instanceof Error ? e.message : "invalid page range"}`);
      }
    } else if (item.kind === "image") {
      printablePages = 1;
    }

    const nup = Math.max(1, cfg.pagesPerSheet || 1);
    const faces = Math.max(1, Math.ceil(printablePages / nup));
    const duplex = cfg.duplex !== "off";
    const sheets = duplex ? Math.ceil(faces / 2) : faces;

    const sizeMul = rules.sizeMultiplier[cfg.paperSize] ?? 1;
    const perFace = (cfg.colorMode === "color" ? rules.colorPerPage : rules.bwPerPage) * sizeMul;
    let base = Math.round(faces * perFace * copies);
    if (duplex) base = Math.round(base * rules.duplexFactor);

    const finishing = (cfg.finishing ?? []).map((k) => {
      const f = rules.finishing[k];
      return { name: f?.label ?? k, amount: (f?.price ?? 0) * copies };
    });
    const finishingTotal = finishing.reduce((s, f) => s + f.amount, 0);

    let lineTotal = base + finishingTotal;
    let urgentFee = 0;
    if (cfg.urgent) {
      urgentFee = Math.round((lineTotal * rules.urgentPct) / 100);
      lineTotal += urgentFee;
    }
    if (lineTotal < rules.minJobPaise) {
      lineTotal = rules.minJobPaise;
      note = note ? `${note} Minimum order charge applied.` : "Minimum order charge applied.";
    }

    lines.push({
      documentId: item.documentId,
      label: item.label,
      printablePages,
      faces,
      sheets,
      copies,
      rate: Math.round(perFace),
      base,
      finishing,
      urgentFee,
      lineTotal,
      note,
    });
    subtotal += lineTotal;
  }

  if (items.length === 0) warnings.push("Add at least one document to get a quote.");
  const taxAmount = Math.round((subtotal * rules.taxRate) / 100);
  return {
    lines,
    subtotal,
    discount: 0,
    taxRate: rules.taxRate,
    taxAmount,
    total: subtotal + taxAmount,
    currency: rules.currency,
    pricingVersion: version,
    warnings,
  };
}
