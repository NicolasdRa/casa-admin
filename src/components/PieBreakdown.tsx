import { For, Show } from "solid-js";
import type { Breakdown } from "~/lib/expenseSummary";

// Categorical palette (6 hues + muted gray for the rolled-up "Other"/Unassigned slice).
// Defined as CSS vars in app.css so themes can override; "Other" always reads as background noise.
const PALETTE = ["--ch-1", "--ch-2", "--ch-3", "--ch-4", "--ch-5", "--ch-6"];
const colorFor = (key: string, i: number) =>
  key === "__other__" ? "var(--ch-other)" : `var(${PALETTE[i % PALETTE.length]})`;

/**
 * CA-119: a pie via CSS conic-gradient + an exact legend — no charting dependency.
 * Hidden when it would render a single slice (rule C): one 100% wheel teaches nothing.
 */
export function PieBreakdown(props: {
  title: string;
  data: Breakdown;
  money: (cents: number) => string;
}) {
  // Cumulative stops: conic-gradient(c 0% start=>end%, …). Built off pct so it tracks the legend.
  const gradient = () => {
    let at = 0;
    const stops = props.data.slices.map((s, i) => {
      const from = at;
      at += s.pct;
      return `${colorFor(s.key, i)} ${from}% ${at}%`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  };

  return (
    <Show when={props.data.slices.length > 1}>
      <figure class="pie-card">
        <figcaption class="pie-title">{props.title}</figcaption>
        <div class="pie-row">
          <div class="pie" style={{ background: gradient() }} aria-hidden="true" />
          <ul class="pie-legend">
            <For each={props.data.slices}>
              {(s, i) => (
                <li>
                  <span class="pie-swatch" style={{ background: colorFor(s.key, i()) }} />
                  <span class="pie-label">{s.label}</span>
                  <span class="pie-val">
                    {props.money(s.amountEur)} · {Math.round(s.pct)}%
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </figure>
    </Show>
  );
}
