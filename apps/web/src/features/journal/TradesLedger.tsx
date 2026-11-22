import type {
  JournalOrderBatchReadModel,
  JournalTradeReadModel,
} from "../../convex/types";
import {
  formatDateLabel,
  formatMoney,
  pluralize,
  pnlTone,
  tradeDate,
} from "./formatting";
import { LedgerIcon } from "./icons";

interface TradeDayGroup {
  trades: JournalTradeReadModel[];
  orderDays: JournalOrderBatchReadModel[];
}

function SourceOrders({ batch }: { batch: JournalOrderBatchReadModel }) {
  return (
    <details className="journal-order-disclosure">
      <summary>
        <span>Source orders</span>{" "}
        <span className="journal-row-meta journal-row-meta--inline">
          {pluralize(batch.orders.length, "order")}
        </span>
      </summary>
      {batch.note && <p className="journal-session-note">{batch.note}</p>}
      <div
        className="journal-order-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={`Source orders for ${formatDateLabel(batch.date)}`}
      >
        <table className="journal-order-table">
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Submitted</th>
              <th scope="col">Status</th>
              <th scope="col">Side</th>
              <th scope="col">Type</th>
              <th scope="col" className="journal-numeric">
                Qty
              </th>
              <th scope="col" className="journal-numeric">
                Avg. fill
              </th>
              <th scope="col" className="journal-numeric">
                Limit
              </th>
              <th scope="col" className="journal-numeric">
                Cost/credit
              </th>
              <th scope="col" className="journal-numeric">
                Realized P&amp;L
              </th>
            </tr>
          </thead>
          <tbody>
            {batch.orders.map((order, index) => (
              <tr key={`${batch.stableId}-${index}`}>
                <th scope="row">{order.contract}</th>
                <td className="journal-mono">{order.submittedAt}</td>
                <td>{order.status}</td>
                <td>{order.side}</td>
                <td>{order.type}</td>
                <td className="journal-numeric">{order.quantity}</td>
                <td className="journal-numeric">
                  {formatMoney(order.averageFillCents)}
                </td>
                <td className="journal-numeric">
                  {formatMoney(order.limitCents)}
                </td>
                <td className="journal-numeric">
                  {formatMoney(order.cashCents, true)}
                </td>
                <td
                  className={`journal-numeric journal-result ${pnlTone(order.realizedPnlCents)}`}
                >
                  {formatMoney(order.realizedPnlCents, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DayLedger({
  date,
  day,
  onOpenTrade,
}: {
  date: string;
  day: TradeDayGroup;
  onOpenTrade: (trade: JournalTradeReadModel) => void;
}) {
  let dailyPnl: number | null = null;
  for (const trade of day.trades) {
    if (trade.status === "Closed" && trade.realizedPnlCents !== null) {
      dailyPnl = (dailyPnl ?? 0) + trade.realizedPnlCents;
    }
  }

  return (
    <section
      className="journal-card journal-ledger-card"
      aria-labelledby={`ledger-${date}`}
    >
      <header className="journal-ledger-heading">
        <h2 id={`ledger-${date}`}>
          <time dateTime={date}>{formatDateLabel(date)}</time>
        </h2>
        <div className="journal-ledger-totals">
          <span>{pluralize(day.trades.length, "trade")}</span>
          <span>
            Realized P&amp;L{" "}
            <strong className={pnlTone(dailyPnl)}>
              {formatMoney(dailyPnl, true)}
            </strong>
          </span>
        </div>
      </header>
      {day.trades.length > 0 && (
        <div className="journal-table-wrap">
          <table className="journal-ledger-table">
            <thead>
              <tr>
                <th scope="col">Trade</th>
                <th scope="col">Instrument</th>
                <th scope="col">Status</th>
                <th scope="col" className="journal-numeric">
                  P&amp;L
                </th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {day.trades.map((trade) => {
                const closed = trade.status === "Closed";
                const action = closed ? "Review" : "Edit";
                const tradeMeta = [
                  trade.direction,
                  trade.size,
                  trade.setup,
                  !trade.openedOn && "Entry unknown",
                ]
                  .filter(Boolean)
                  .join(" · ");
                const instrumentMeta = [
                  trade.instrument,
                  trade.account !== "Unspecified" && trade.account,
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <tr key={trade.stableId}>
                    <th scope="row">
                      <strong className="journal-symbol">{trade.symbol}</strong>
                      {tradeMeta && (
                        <span className="journal-row-meta">{tradeMeta}</span>
                      )}
                    </th>
                    <td>
                      <span className="journal-meta-col">{instrumentMeta}</span>
                    </td>
                    <td>
                      <span
                        className="journal-status-text"
                        data-status={trade.status.toLowerCase()}
                      >
                        {trade.status}
                      </span>
                    </td>
                    <td
                      className={`journal-numeric journal-result ${pnlTone(trade.realizedPnlCents)}`}
                    >
                      {formatMoney(trade.realizedPnlCents, true)}
                    </td>
                    <td className="journal-row-action">
                      <button
                        type="button"
                        className="journal-text-button"
                        aria-label={`${action} ${trade.symbol}`}
                        onClick={() => onOpenTrade(trade)}
                      >
                        {action}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {day.orderDays.map((batch) => (
        <SourceOrders key={batch.stableId} batch={batch} />
      ))}
    </section>
  );
}

export function TradesLedger({
  trades,
  orderDays,
  onOpenTrade,
  onLogTrade,
}: {
  trades: JournalTradeReadModel[];
  orderDays: JournalOrderBatchReadModel[];
  onOpenTrade: (trade: JournalTradeReadModel) => void;
  onLogTrade: () => void;
}) {
  const days = new Map<string, TradeDayGroup>();

  function groupFor(date: string): TradeDayGroup {
    const existing = days.get(date);
    if (existing) return existing;
    const created: TradeDayGroup = { trades: [], orderDays: [] };
    days.set(date, created);
    return created;
  }

  for (const trade of trades) {
    groupFor(tradeDate(trade)).trades.push(trade);
  }
  for (const orderDay of orderDays) {
    groupFor(orderDay.date).orderDays.push(orderDay);
  }

  if (days.size === 0) {
    return (
      <section className="journal-card">
        <div className="journal-empty">
          <span className="journal-empty-icon">
            <LedgerIcon />
          </span>
          <strong>No trades yet</strong>
          <p>
            Log a trade manually or paste a brokerage screenshot into Journal
            Chat to import your fills.
          </p>
          <button
            type="button"
            className="journal-button journal-button--secondary"
            onClick={onLogTrade}
          >
            Log a trade
          </button>
        </div>
      </section>
    );
  }

  const sortedDays = [...days.entries()].sort(([left], [right]) =>
    right.localeCompare(left),
  );

  return (
    <div className="journal-view-stack">
      {sortedDays.map(([date, day]) => (
        <DayLedger key={date} date={date} day={day} onOpenTrade={onOpenTrade} />
      ))}
    </div>
  );
}
