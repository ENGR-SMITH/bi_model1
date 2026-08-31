// TANDEM ticket-pass promo codes — seeds the server-managed promo codes used
// by the checkout form (the "PROMOCODE" field on the coupon card). Idempotent:
// re-running refreshes the values without duplicating rows.
//
//   pnpm --filter @workspace/api-server seed:promos
import "../env";
import { eq } from "drizzle-orm";
import { db, tandemPromoCodesTable } from "@workspace/db";

const PROMOS = [
  // 100% off — the whole pass is free.
  { code: "FREEPASS", kind: "FREE", value: 0, maxUses: 0 },
  // 50% off — $0.94.
  { code: "HALFPASS", kind: "PERCENT", value: 50, maxUses: 0 },
  // $0.50 off — $1.38.
  { code: "FLAT50", kind: "FLAT", value: 50, maxUses: 0 },
];

async function main(): Promise<void> {
  let upserted = 0;
  for (const promo of PROMOS) {
    const [existing] = await db
      .select({ code: tandemPromoCodesTable.code })
      .from(tandemPromoCodesTable)
      .where(eq(tandemPromoCodesTable.code, promo.code))
      .limit(1);
    if (existing) {
      await db
        .update(tandemPromoCodesTable)
        .set({ kind: promo.kind, value: promo.value, maxUses: promo.maxUses })
        .where(eq(tandemPromoCodesTable.code, promo.code));
    } else {
      await db.insert(tandemPromoCodesTable).values({ ...promo, uses: 0 });
    }
    upserted += 1;
  }
  console.log(`Ticket promo codes ready: ${upserted} upserted (${PROMOS.map((p) => p.code).join(", ")})`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
