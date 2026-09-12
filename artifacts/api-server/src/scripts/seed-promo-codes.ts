// NEXET ticket-pass promo codes — seeds the server-managed promo codes used
// by the pass-card checkout (the "PROMOCODE" field plus its Verify button).
// Every code is dedicated to one category, so it is refused on the other
// pass. Idempotent: re-running refreshes the values without duplicating rows.
//
//   pnpm --filter @workspace/api-server seed:promos
import "../env";
import { eq } from "drizzle-orm";
import { db, nexetPromoCodesTable } from "@workspace/db";

const PROMOS = [
  // 100% off — the whole Content Creators pass is free.
  { code: "FREEPASS", category: "content-creators", kind: "FREE", value: 0, maxUses: 0 },
  // 50% off the Author & Writer pass — $2.94.
  { code: "HALFPASS", category: "authors", kind: "PERCENT", value: 50, maxUses: 0 },
  // $0.50 off the Author & Writer pass — $5.38.
  { code: "FLAT50", category: "authors", kind: "FLAT", value: 50, maxUses: 0 },
];

async function main(): Promise<void> {
  let upserted = 0;
  for (const promo of PROMOS) {
    const [existing] = await db
      .select({ code: nexetPromoCodesTable.code })
      .from(nexetPromoCodesTable)
      .where(eq(nexetPromoCodesTable.code, promo.code))
      .limit(1);
    if (existing) {
      await db
        .update(nexetPromoCodesTable)
        .set({
          category: promo.category,
          kind: promo.kind,
          value: promo.value,
          maxUses: promo.maxUses,
        })
        .where(eq(nexetPromoCodesTable.code, promo.code));
    } else {
      await db.insert(nexetPromoCodesTable).values({ ...promo, uses: 0 });
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
