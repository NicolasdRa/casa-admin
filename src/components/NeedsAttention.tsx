import { A, createAsync, query } from "@solidjs/router";
import { Show } from "solid-js";
import { db } from "~/db/index";
import { dashboardAttention } from "~/db/reports";
import { useI18n } from "~/lib/i18n";
import { formatMoney } from "~/lib/money";
import { requireUser } from "~/lib/session";

// Settlement is a partnership result — gated like net (RP-4): a co-host never receives it.
export const attentionQuery = query(async () => {
  "use server";
  const me = await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const a = dashboardAttention(db, today);
  const canSettle = me.role !== "user";
  return { canSettle, ...a, settlementDue: canSettle ? a.settlementDue : 0 };
}, "dashboardAttention");

/** Panel zone ③ — leading operational signals (open work, caja, upcoming, owed). Each row links
 *  to the surface that resolves it. Period-independent: these are "now", not scoped to a period. */
export function NeedsAttention() {
  const { t, locale } = useI18n();
  const a = createAsync(() => attentionQuery(), { initialValue: null });
  const money = (c: number) => `${formatMoney(c, locale())} €`;

  return (
    <Show when={a()}>
      {(d) => (
        <dl class="attn-list">
          <Row href="/maintenance" label={t("panel.attn_maintenance")}>
            {d().maintenanceOpen}
          </Row>
          <Row href="/bookings" label={t("panel.attn_checkins")}>
            {d().upcomingCheckIns}
          </Row>
          <Row href="/caja" label={t("panel.attn_caja")}>
            {money(d().cajaBalance)}
          </Row>
          <Show when={d().canSettle}>
            <Row href="/caja" label={t("panel.attn_settlement")}>
              {money(d().settlementDue)}
            </Row>
          </Show>
        </dl>
      )}
    </Show>
  );
}

function Row(props: { href: string; label: string; children: number | string }) {
  return (
    <A href={props.href} class="attn-row">
      <dt>{props.label}</dt>
      <dd class="num">{props.children}</dd>
    </A>
  );
}
