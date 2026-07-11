import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { games } from "@/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Action = "add" | "remove" | "up" | "down" | "complete" | "uncomplete";
const ACTIONS = new Set<Action>([
  "add",
  "remove",
  "up",
  "down",
  "complete",
  "uncomplete",
]);

export async function POST(req: NextRequest) {
  let body: { id?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = Number(body.id);
  const action = body.action as Action;
  if (!Number.isInteger(id) || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const touched: number[] = [id];

  if (action === "add") {
    const max = await db
      .select({ m: sql<number>`coalesce(max(${games.backlogOrder}), 0)` })
      .from(games);
    const next = (max[0]?.m ?? 0) + 1;
    await db
      .update(games)
      .set({ backlogOrder: next, lastUpdated: sql`now()` })
      .where(eq(games.id, id));
  } else if (action === "remove") {
    await db
      .update(games)
      .set({
        backlogOrder: null,
        completed: false,
        completedAt: null,
        lastUpdated: sql`now()`,
      })
      .where(eq(games.id, id));
  } else if (action === "complete" || action === "uncomplete") {
    const done = action === "complete";
    await db
      .update(games)
      .set({
        completed: done,
        completedAt: done ? sql`now()` : null,
        lastUpdated: sql`now()`,
      })
      .where(eq(games.id, id));
  } else {
    // up / down: swap backlog_order with the adjacent non-completed backlog item
    const list = await db
      .select({ id: games.id, order: games.backlogOrder })
      .from(games)
      .where(and(isNotNull(games.backlogOrder), eq(games.completed, false)))
      .orderBy(games.backlogOrder);
    const idx = list.findIndex((g) => g.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Not in backlog" }, { status: 400 });
    }
    const swapIdx = action === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) {
      // already at the edge; no-op
      const cur = await db.select().from(games).where(eq(games.id, id));
      return NextResponse.json({ games: cur });
    }
    const a = list[idx];
    const b = list[swapIdx];
    await db.update(games).set({ backlogOrder: b.order }).where(eq(games.id, a.id));
    await db.update(games).set({ backlogOrder: a.order }).where(eq(games.id, b.id));
    touched.push(b.id);
  }

  const rows = await db
    .select()
    .from(games)
    .where(sql`${games.id} in (${sql.join(touched, sql`, `)})`);
  return NextResponse.json({ games: rows });
}
