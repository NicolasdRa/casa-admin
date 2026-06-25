import { For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { useI18n } from "~/lib/i18n";

// A documentation block: a paragraph (string), a bullet list, a sub-heading, or a callout note.
type Block = string | { ul: string[] } | { sub: string } | { note: string };
type Doc = { title: string; blocks: Block[] };
type Section = { id: string; es: Doc; en: Doc };

// ponytail: long-form bilingual prose lives here as data, not in the locale dicts —
// stuffing ~600 lines of help text into es.ts/en.ts would bloat the translation tables
// every other screen loads. One file, switched on locale(). Add a language by adding a key.
const SECTIONS: Section[] = [
  {
    id: "overview",
    es: {
      title: "Qué es esta app",
      blocks: [
        "Casa Bosque es la administración del alquiler de la casa: reservas, gastos, ocupación, informes y la liquidación entre los dos socios. Todo el dinero se guarda en centavos enteros y cada importe en moneda extranjera queda fijado al tipo de cambio del día en que se cargó.",
        "El idioma se cambia con el botón ES/EN abajo a la izquierda (o en el menú «Más» en el teléfono). El español es el idioma por defecto.",
        {
          note: "Regla de oro: lo que cargás se preserva exacto. La app nunca recalcula un importe ya guardado — sólo deriva la otra moneda una vez y la redondea.",
        },
      ],
    },
    en: {
      title: "What this app is",
      blocks: [
        "Casa Bosque runs the rental administration for the house: bookings, expenses, occupancy, reports and the settlement between the two partners. All money is stored in integer cents, and every foreign-currency amount is locked to the exchange rate of the day it was entered.",
        "Switch language with the ES/EN button at the bottom-left (or in the “More” menu on a phone). Spanish is the default.",
        {
          note: "Golden rule: what you enter is preserved exactly. The app never recalculates a stored amount — it derives the other currency once and rounds it.",
        },
      ],
    },
  },
  {
    id: "panel",
    es: {
      title: "Panel (inicio)",
      blocks: [
        "La pantalla de inicio resume el estado del negocio de un vistazo.",
        { sub: "Qué muestra" },
        {
          ul: [
            "Tarjetas de período: ingresos, gastos y resultado del mes, del año o de todo el histórico. El selector cambia el período y compara contra el período anterior.",
            "«Requiere atención»: mantenimiento abierto, saldo de caja, check-ins de los próximos 7 días y saldo a liquidar pendiente.",
            "«Actividad reciente»: las últimas reservas y gastos cargados.",
            "Accesos rápidos: nueva reserva, nuevo gasto, ir a Caja.",
          ],
        },
        "No se carga nada acá — es sólo lectura. Tocá una tarjeta para ir a la sección correspondiente.",
      ],
    },
    en: {
      title: "Dashboard (home)",
      blocks: [
        "The home screen summarises the state of the business at a glance.",
        { sub: "What it shows" },
        {
          ul: [
            "Period cards: income, expenses and result for the month, the year, or all time. The selector switches the period and compares against the previous one.",
            "“Needs attention”: open maintenance, cash balance, check-ins in the next 7 days, and any settlement still due.",
            "“Recent activity”: the latest bookings and expenses entered.",
            "Quick actions: new booking, new expense, go to Cash account.",
          ],
        },
        "Nothing is entered here — it's read-only. Tap a card to jump to that section.",
      ],
    },
  },
  {
    id: "bookings",
    es: {
      title: "Alquileres (reservas)",
      blocks: [
        "Cada alquiler registra un huésped, fechas de entrada y salida, el importe, la moneda, el canal y la comisión del co-anfitrión si corresponde.",
        { sub: "Cómo cargar una reserva" },
        {
          ul: [
            "Importe y moneda: cargá el valor en la moneda en que se cobró (EUR o ARS). La app obtiene el tipo de cambio BNA de esa fecha y calcula la otra moneda automáticamente.",
            "Si no hay cotización BNA para la fecha, te pide un cambio manual.",
            "Canal: directo, Booking.com o Airbnb. Define cómo se calcula la comisión.",
            "Tipo: alquiler, cancelación o reembolso — para que las correcciones no rompan los totales.",
          ],
        },
        { sub: "La foto del cambio es inmutable" },
        "Al guardar, la reserva fija moneda, importe, tipo de cambio, fecha del cambio y los dos valores (EUR y ARS) de una sola vez. Eso queda congelado: aunque mañana cambie el dólar, esta reserva conserva el valor del día en que se cargó. Si te equivocaste, editá la reserva — no se recalcula sola.",
        {
          note: "BNA cotiza ARS por 1 EUR. El promedio es (compra + venta) / 2. EUR = ARS / cambio, ARS = EUR × cambio.",
        },
      ],
    },
    en: {
      title: "Bookings",
      blocks: [
        "Each booking records a guest, check-in and check-out dates, the amount, the currency, the channel, and the co-host commission where it applies.",
        { sub: "How to enter a booking" },
        {
          ul: [
            "Amount and currency: enter the value in the currency you were paid in (EUR or ARS). The app fetches that date's BNA rate and computes the other currency automatically.",
            "If there's no BNA quote for the date, it asks for a manual rate.",
            "Channel: direct, Booking.com or Airbnb. It determines how commission is computed.",
            "Type: booking, cancellation or reimbursement — so corrections don't break the totals.",
          ],
        },
        { sub: "The FX snapshot is immutable" },
        "On save, the booking locks currency, amount, FX rate, rate date and both values (EUR and ARS) in one shot. That's frozen: even if the rate moves tomorrow, this booking keeps the value from the day it was entered. Made a mistake? Edit the booking — it never recalculates itself.",
        {
          note: "BNA quotes ARS per 1 EUR. Average is (buy + sell) / 2. EUR = ARS / rate, ARS = EUR × rate.",
        },
      ],
    },
  },
  {
    id: "occupancy",
    es: {
      title: "Ocupación",
      blocks: [
        "Muestra las noches ocupadas mes a mes, derivadas de las fechas de entrada y salida de los alquileres. Filtrá por rango de fechas (filtra por la fecha de entrada).",
        "Es sólo lectura: refleja lo cargado en Alquileres. Si falta una noche, corregí la reserva correspondiente.",
      ],
    },
    en: {
      title: "Occupancy",
      blocks: [
        "Shows occupied nights month by month, derived from the check-in/check-out dates of the bookings. Filter by date range (it filters on check-in).",
        "It's read-only: it reflects what's in Bookings. If a night looks wrong, fix the underlying booking.",
      ],
    },
  },
  {
    id: "expenses",
    es: {
      title: "Gastos",
      blocks: [
        "Cada gasto registra un detalle, categoría, proveedor, importe, moneda, quién lo pagó y, opcionalmente, un comprobante.",
        { sub: "Quién pagó (clave para la liquidación)" },
        "El campo «Pagado por» es el que determina la liquidación entre socios. Cada gasto lo adelanta una sola persona; después la liquidación compensa lo que cada socio adelantó contra la parte que le corresponde según su porcentaje de propiedad.",
        {
          ul: [
            "Si lo pagó un socio (Nicolás o Anastasia): es un gasto adelantado por ese socio, que se le reembolsa por Caja.",
            "Si lo pagó un co-anfitrión: entra al pozo compartido recién cuando se lo reembolsa, y queda a cargo del socio que reembolsa.",
            "Si no tiene pagador: queda «sin atribuir» y se excluye de la liquidación hasta que le asignes uno (así el balance cierra al centavo).",
          ],
        },
        { sub: "Reembolso" },
        "Marcar un gasto como reembolsado registra el retiro real de Caja hacia el socio que lo adelantó, con la fecha en que salió la plata. El gasto sigue siendo un costo compartido; lo que se cancela es el crédito de «adelantado» de ese socio. No se puede reembolsar dos veces.",
        { sub: "Herramientas" },
        {
          ul: [
            "Filtros por pagador y por proveedor; orden por proveedor.",
            "Selección múltiple para reembolsar en lote.",
            "Resumen con totales y gráficos por proveedor, pagador y categoría.",
          ],
        },
      ],
    },
    en: {
      title: "Expenses",
      blocks: [
        "Each expense records a detail, category, supplier, amount, currency, who paid, and optionally a receipt.",
        { sub: "Who paid (the key to the settlement)" },
        "The “Paid by” field is what drives the partner settlement. Each expense is fronted in full by one person; the settlement then nets what each partner fronted against the share they owe under their ownership %.",
        {
          ul: [
            "If a partner paid (Nicolás or Anastasia): it's an expense fronted by that partner, reimbursed to them through the Cash account.",
            "If a co-host paid: it only joins the shared pool once reimbursed, and is then borne by the reimbursing partner.",
            "If there's no payer: it stays “unattributed” and is excluded from the settlement until you assign one (so the balance stays cent-exact).",
          ],
        },
        { sub: "Reimbursement" },
        "Marking an expense reimbursed records the real Cash withdrawal to the partner who fronted it, dated when the money left the box. The expense stays a shared cost; what's cancelled is that partner's “fronted” credit. It can't be reimbursed twice.",
        { sub: "Tools" },
        {
          ul: [
            "Filters by payer and supplier; sort by supplier.",
            "Multi-select to reimburse in bulk.",
            "A summary with totals and charts by supplier, payer and category.",
          ],
        },
      ],
    },
  },
  {
    id: "suppliers",
    es: {
      title: "Proveedores y categorías",
      blocks: [
        "Listas reutilizables para clasificar gastos de forma consistente. Crear un proveedor o categoría una vez evita escribir el mismo nombre con variantes en cada gasto.",
        "Las categorías se agrupan por tipo (operación, equipamiento, mantenimiento, impuestos, servicios), y los informes usan esos grupos. Editar y borrar están reservados a administradores; un proveedor o categoría con gastos asociados no se puede borrar (inhabilitalo o reasigná primero).",
      ],
    },
    en: {
      title: "Suppliers & categories",
      blocks: [
        "Reusable lists for classifying expenses consistently. Creating a supplier or category once avoids typing the same name with variations on every expense.",
        "Categories are grouped by type (operating, equipment, maintenance, taxes, services), and reports use those groups. Edit and delete are admin-only; a supplier or category that has expenses attached can't be deleted (disable or reassign first).",
      ],
    },
  },
  {
    id: "maintenance",
    es: {
      title: "Mantenimiento",
      blocks: [
        "Tareas de mantenimiento de la casa, típicamente las de pre-temporada. Cada tarea tiene una descripción, temporada, estado (pendiente/hecho) y opcionalmente un gasto vinculado.",
        "Marcá «hecho» al completarla, o «reabrir» si hay que volver sobre ella. Vincular un gasto conecta la tarea con el costo real que generó.",
      ],
    },
    en: {
      title: "Maintenance",
      blocks: [
        "House maintenance tasks, typically the pre-season ones. Each task has a description, season, status (pending/done) and optionally a linked expense.",
        "Mark “done” when complete, or “reopen” if it needs revisiting. Linking an expense ties the task to the real cost it generated.",
      ],
    },
  },
  {
    id: "reports",
    es: {
      title: "Informes",
      blocks: [
        "El resultado anual (P&L): por cada año, ingresos menos gastos menos comisiones, con los gastos agrupados por tipo de categoría. Es la vista contable de devengo — qué generó el negocio cada año, independientemente de cuándo se cobró o pagó en efectivo.",
        {
          note: "Informes mira el rendimiento por año; Caja mira el efectivo y la liquidación entre socios. Son dos vistas del mismo dinero: una por devengo, otra por caja.",
        },
      ],
    },
    en: {
      title: "Reports",
      blocks: [
        "The annual result (P&L): for each year, income minus expenses minus commissions, with expenses grouped by category type. It's the accrual accounting view — what the business generated each year, regardless of when cash was collected or paid.",
        {
          note: "Reports looks at performance by year; Cash account looks at the cash and the partner settlement. Two views of the same money: one accrual, one cash.",
        },
      ],
    },
  },
  {
    id: "caja",
    es: {
      title: "Caja y Estado por socio",
      blocks: [
        "Caja es el libro de movimientos de efectivo y la liquidación entre los dos socios. Tiene dos partes: el libro de movimientos (aportes, retiros, asignaciones) y la tabla «Estado por socio».",
        { sub: "La tabla Estado por socio, columna por columna" },
        {
          ul: [
            "Ingresos: la parte de cada socio de los ingresos por alquiler, según su porcentaje de propiedad. Suma.",
            "Comisión: la parte de cada socio de la comisión del co-anfitrión. Resta (se muestra en negativo).",
            "Gastos (parte): la parte justa de cada socio del pozo de gastos compartidos. Resta (se muestra en negativo).",
            "= Resultado: subtotal del negocio para ese socio (Ingresos − Comisión − Gastos).",
            "Adelantado: lo que ese socio pagó de su bolsillo. Suma.",
            "Cuenta caja: sus movimientos de caja netos (aportes − retiros, incluidos los reembolsos). Con signo.",
            "= En caja: subtotal del efectivo (Adelantado + Cuenta caja).",
            "Saldo a liquidar: lo que todavía se le debe (Resultado + En caja). Cada fila cierra sumando de izquierda a derecha.",
          ],
        },
        { sub: "El resumen de arriba (el pozo)" },
        "La franja sobre la tabla muestra el flujo del negocio: Resultado del negocio → Movimientos de caja → Saldo total a liquidar. Refleja el mismo recorrido que la planilla (resultado → caja → saldo) y cierra exactamente con el total de la tabla.",
        { sub: "Por qué la Cuenta caja puede ser muy negativa" },
        "Cada gasto adelantado por un socio genera un retiro de Caja («Reembolso gasto:…») que le devuelve la plata. Si hay muchos reembolsos y ningún aporte que los compense, la columna Cuenta caja se ve muy negativa. Pero ese número es el bruto: el +Adelantado y el −reembolso son la misma plata con signo opuesto. El subtotal «En caja» (Adelantado + Cuenta caja) es el efecto neto real.",
        { sub: "Cómo registrar el ingreso cobrado" },
        "Cargá el cobro como un movimiento de Caja (botón «Agregar movimiento»), asignado al socio cuya cuenta recibió la plata. Importante: el ingreso ya se cuenta una vez vía Alquileres en la columna Ingresos — antes de cargarlo también en Caja hay que definir una única fuente de verdad para el ingreso, para no contarlo dos veces.",
        { sub: "Liquidar a cero" },
        "Para dejar todo en cero (como la planilla cerrada), registrá por cada socio un retiro igual a su Saldo a liquidar. Para un gasto compartido sin dueño (p. ej. un pasaje de la familia), cargalo como dos retiros divididos por porcentaje de propiedad — la app asigna cada movimiento a un socio, no existe el retiro «del pozo».",
      ],
    },
    en: {
      title: "Cash account & Per-partner statement",
      blocks: [
        "Cash account is the ledger of cash movements and the settlement between the two partners. It has two parts: the movements ledger (contributions, withdrawals, allocations) and the “Per-partner statement” table.",
        { sub: "The Per-partner statement, column by column" },
        {
          ul: [
            "Income: each partner's share of rental income, by ownership %. Adds.",
            "Commission: each partner's share of the co-host commission. Subtracts (shown negative).",
            "Expenses (share): each partner's fair share of the shared expense pool. Subtracts (shown negative).",
            "= Result: the business subtotal for that partner (Income − Commission − Expenses).",
            "Fronted: what that partner paid out of pocket. Adds.",
            "Cash account: their net cash movements (contributions − withdrawals, including reimbursements). Signed.",
            "= In cash: the cash subtotal (Fronted + Cash account).",
            "Saldo to settle: what's still owed to them (Result + In cash). Each row reconciles by adding left to right.",
          ],
        },
        { sub: "The summary strip (the pot)" },
        "The strip above the table shows the business flow: Business result → Cash movements → Total saldo to settle. It mirrors the spreadsheet's path (result → cash → saldo) and reconciles exactly to the table total.",
        { sub: "Why Cash account can look very negative" },
        "Every partner-fronted expense creates a Cash withdrawal (“Reembolso gasto:…”) that pays them back. With many reimbursements and no contributions to offset them, the Cash account column looks very negative. But that's the gross figure: the +Fronted and the −reimbursement are the same money with opposite signs. The “In cash” subtotal (Fronted + Cash account) is the true net effect.",
        { sub: "How to record income collected" },
        "Enter the collection as a Cash movement (“Add entry”), assigned to the partner whose account received it. Important: income is already counted once via Bookings in the Income column — before also logging it in Cash you must pick a single source of truth for income, so it isn't double-counted.",
        { sub: "Settling to zero" },
        "To bring everything to zero (like the closed spreadsheet), record for each partner a withdrawal equal to their Saldo to settle. For a shared expense with no owner (e.g. a family travel ticket), enter it as two withdrawals split by ownership % — the app assigns every movement to a partner; there is no pot-level withdrawal.",
      ],
    },
  },
  {
    id: "fx",
    es: {
      title: "Tipo de cambio (BNA)",
      blocks: [
        "La app guarda el historial de cotizaciones EUR del Banco Nación (compra, venta, promedio) y lo usa para fijar la foto de cambio de cada reserva y gasto. La tendencia se ve por semana, mes o año.",
        "Las cotizaciones se actualizan por un proceso automático. Cuando cargás una operación en una fecha sin cotización, la app te pide un cambio manual para esa operación puntual — sin tocar el historial.",
      ],
    },
    en: {
      title: "Exchange rate (BNA)",
      blocks: [
        "The app keeps the history of Banco Nación EUR quotes (buy, sell, average) and uses it to lock the FX snapshot of every booking and expense. The trend is viewable by week, month or year.",
        "Quotes are refreshed by an automated process. When you enter a transaction on a date with no quote, the app asks for a manual rate for that one transaction — without touching the history.",
      ],
    },
  },
  {
    id: "users",
    es: {
      title: "Usuarios y roles",
      blocks: [
        "Tres roles, de mayor a menor alcance:",
        {
          ul: [
            "Superadmin: control total, incluida la gestión de usuarios y ajustes. No se puede degradar ni inhabilitar al último superadmin activo.",
            "Administrador: gestiona el día a día (reservas, gastos, proveedores, etc.) y puede editar/borrar.",
            "Co-anfitrión: acceso acotado; ve lo suyo pero no la gestión de usuarios, caja ni ajustes.",
          ],
        },
        "El acceso a Caja, Usuarios, Ajustes y Auditoría está restringido por rol — por eso esos ítems aparecen o no en el menú según quién entró. La seguridad usa sesión + contraseña (scrypt) + TOTP. Un usuario con actividad registrada se inhabilita, no se borra.",
      ],
    },
    en: {
      title: "Users & roles",
      blocks: [
        "Three roles, from widest to narrowest scope:",
        {
          ul: [
            "Superadmin: full control, including user and settings management. The last active superadmin can't be demoted or disabled.",
            "Admin: runs the day-to-day (bookings, expenses, suppliers, etc.) and can edit/delete.",
            "Co-host: scoped access; sees their own work but not user management, cash, or settings.",
          ],
        },
        "Access to Cash account, Users, Settings and Audit is gated by role — that's why those menu items appear or not depending on who's signed in. Security uses session + password (scrypt) + TOTP. A user with recorded activity is disabled, not deleted.",
      ],
    },
  },
  {
    id: "audit",
    es: {
      title: "Auditoría",
      blocks: [
        "Registro de quién hizo qué y cuándo: cada acción sensible (alta, edición, borrado, reembolso) queda anotada con usuario, acción, entidad y fecha. Filtrá por tipo de acción o buscá una entidad. Es de sólo lectura — la trazabilidad para una administración compartida.",
      ],
    },
    en: {
      title: "Audit log",
      blocks: [
        "A record of who did what and when: every sensitive action (create, edit, delete, reimburse) is logged with user, action, entity and date. Filter by action type or search an entity. It's read-only — traceability for a shared administration.",
      ],
    },
  },
  {
    id: "settings",
    es: {
      title: "Ajustes",
      blocks: [
        "Configuración general de la aplicación, reservada a quienes tienen permiso de gestión. Incluye los parámetros del negocio que no cambian seguido. Cambiá acá lo que afecte a toda la app, no a una operación puntual.",
      ],
    },
    en: {
      title: "Settings",
      blocks: [
        "General application configuration, reserved for those with management permission. Holds the business parameters that don't change often. Change here whatever affects the whole app, not a single transaction.",
      ],
    },
  },
  {
    id: "concepts",
    es: {
      title: "Conceptos clave",
      blocks: [
        { sub: "El dinero es en centavos enteros" },
        "Nunca se usan decimales flotantes para dinero. Esto evita errores de redondeo que, sumados, descuadran la contabilidad.",
        { sub: "La foto de cambio es inmutable" },
        "Cada reserva y gasto fija su cambio una vez, al cargarse, y no se recalcula nunca. El lado que cargaste se preserva exacto; sólo se deriva y redondea la otra moneda.",
        { sub: "Los repartos cierran al centavo" },
        "Las divisiones entre socios suman exactamente el total — no se crea ni se pierde un centavo. Se usa reparto por mayor resto.",
        { sub: "Las fechas son texto ISO" },
        "AAAA-MM-DD, ordenables alfabéticamente. Sin objetos de fecha en el almacenamiento, sin sorpresas de zona horaria.",
      ],
    },
    en: {
      title: "Key concepts",
      blocks: [
        { sub: "Money is integer cents" },
        "Floats are never used for money. This avoids rounding errors that, summed up, throw the books off balance.",
        { sub: "The FX snapshot is immutable" },
        "Each booking and expense locks its rate once, at entry, and is never recalculated. The side you entered is preserved exactly; only the other currency is derived and rounded.",
        { sub: "Splits reconcile to the cent" },
        "Partner splits sum exactly to the total — no cent created or lost. Largest-remainder allocation is used.",
        { sub: "Dates are ISO text" },
        "YYYY-MM-DD, sortable lexically. No date objects in storage, no timezone surprises.",
      ],
    },
  },
];

function Blocks(props: { blocks: Block[] }) {
  return (
    <For each={props.blocks}>
      {(b) => (
        <>
          <Show when={typeof b === "string"}>
            <p>{b as string}</p>
          </Show>
          <Show when={typeof b === "object" && "sub" in b}>
            <h3>{(b as { sub: string }).sub}</h3>
          </Show>
          <Show when={typeof b === "object" && "note" in b}>
            <p class="doc-note">{(b as { note: string }).note}</p>
          </Show>
          <Show when={typeof b === "object" && "ul" in b}>
            <ul>
              <For each={(b as { ul: string[] }).ul}>{(li) => <li>{li}</li>}</For>
            </ul>
          </Show>
        </>
      )}
    </For>
  );
}

export default function Help() {
  const { t, locale } = useI18n();
  const doc = (s: Section) => (locale() === "en" ? s.en : s.es);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("nav.help")}</h1>
        </div>
      </header>

      {/* Table of contents — anchor links to each section below. */}
      <nav class="panel docs-toc" aria-label={t("nav.help")}>
        <ul>
          <For each={SECTIONS}>
            {(s) => (
              <li>
                <a href={`#${s.id}`}>{doc(s).title}</a>
              </li>
            )}
          </For>
        </ul>
      </nav>

      <div class="docs">
        <For each={SECTIONS}>
          {(s) => (
            <section class="panel" id={s.id}>
              <div class="panel-pad">
                <h2>{doc(s).title}</h2>
                <Blocks blocks={doc(s).blocks} />
              </div>
            </section>
          )}
        </For>
      </div>
    </AppShell>
  );
}
