import React, { useEffect, useId, useMemo, useState } from "react";
import { X, GitFork } from "lucide-react";
import { bankDate } from "../shared/calendar.js";
import { formatMoney } from "../shared/currency.js";
import { moneyFlow, layoutMoneyFlow } from "../shared/money-flow.js";

const monthLabel = (month) => new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date(`${month}-01T12:00:00Z`));
const dateLabel = (date) => new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date(`${date}T12:00:00Z`));

export function MoneyFlow({ data, providers, hidden }) {
  const today = bankDate(new Date()), currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth), [activeKey, setActiveKey] = useState(null), [detailKey, setDetailKey] = useState(null);
  const id = useId(), detailsId = useId();
  const months = [...new Set([currentMonth, ...data.transactions.filter((row) => providers[row.provider]?.kind === "bank" && row.date <= today).map((row) => row.date.slice(0, 7))])].sort().reverse();
  const selectedMonth = months.includes(month) ? month : currentMonth;
  const flow = useMemo(() => moneyFlow(data.transactions, data.accounts, providers, selectedMonth, today), [data.transactions, data.accounts, providers, selectedMonth, today]);
  const layout = useMemo(() => layoutMoneyFlow(flow), [flow]);
  const active = flow.nodes.find((node) => node.key === activeKey), detail = flow.nodes.find((node) => node.key === detailKey);
  const money = (value) => hidden ? "••••••" : formatMoney(value);
  const percent = (value) => value / flow.total < 0.001 ? "<0.1%" : new Intl.NumberFormat("he-IL", { style: "percent", maximumFractionDigits: 1 }).format(value / flow.total);
  const describe = (node) => `${node.label} · ${money(node.value)} · ${percent(node.value)}`;
  const close = () => { setActiveKey(null); setDetailKey(null); };
  useEffect(close, [selectedMonth]);
  const interact = (key) => ({
    onPointerEnter: () => { setActiveKey(key); setDetailKey(key); }, onPointerLeave: () => setActiveKey(null),
    onFocus: () => { setActiveKey(key); setDetailKey(key); }, onBlur: () => setActiveKey(null),
    onClick: () => { setActiveKey(key); setDetailKey(key); },
    onKeyDown: (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setActiveKey(key); setDetailKey(key); } },
  });
  return <section className="panel money-flow-panel" aria-label="לאן הכסף זורם" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <div className="panel-heading"><div><h2><GitFork size={18} /> לאן הכסף זורם?</h2>
      <p>זיכויים וחיובים שהושלמו בבנק · לפי מועד תנועת הבנק · שקלים</p></div>
      <div className="money-flow-month"><label htmlFor={`${id}-month`}>חודש התרשים</label><select id={`${id}-month`} value={selectedMonth} onChange={(event) => setMonth(event.target.value)}>
        {months.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}
      </select></div>
    </div>
    <dl className="money-flow-totals"><div><dt>נכנס לבנק</dt><dd className="money-flow-income"><bdi>{money(flow.income)}</bdi></dd></div>
      <div><dt>יצא מהבנק</dt><dd className="money-flow-expense"><bdi>{money(flow.expense)}</bdi></dd></div>
      <div><dt>{flow.net < 0 ? "הוצאות מעבר לנכנס" : "הפרש החודש"}</dt><dd className={flow.net < 0 ? "money-flow-negative" : "money-flow-positive"}><bdi>{money(flow.net)}</bdi></dd></div>
    </dl>
    {!flow.total ? <div className="money-flow-empty"><GitFork size={28} /><h3>אין תנועות בנק שהושלמו בחודש הזה</h3><p>בחרו חודש אחר או סנכרנו חשבון בנק. חיובי כרטיסים לבדם אינם מוצגים כהוצאות בנק.</p></div> : <>
      <div className="money-flow-hint">{active ? <div role="tooltip"><strong>{active.label}</strong><bdi>{money(active.value)}</bdi><bdi>{percent(active.value)}</bdi></div>
        : <span>עברו על רצועה או קטגוריה לפירוט התנועות · רוחב הרצועה מייצג את הסכום</span>}</div>
      <p className="money-flow-mobile-hint">אפשר להחליק לצדדים כדי לראות את התרשים המלא.</p>
      <div className="money-flow-scroll"><svg className="money-flow-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`תרשים זרימת כסף · ${monthLabel(selectedMonth)}`}>
        <defs>{layout.links.map((link) => <linearGradient key={link.id} id={`${id}-flow-${link.id}`} gradientUnits="userSpaceOnUse" x1={link.sourceNode.x} y1="0" x2={link.targetNode.x} y2="0">
          <stop offset="0%" stopColor={link.sourceNode.color} /><stop offset="100%" stopColor={link.targetNode.color} />
        </linearGradient>)}</defs>
        {["כסף שנכנס והפרש למימון", "חלוקת החודש", "חיובים בבנק והפרש", "פירוט תשלומי הכרטיסים"].map((title, index) => <foreignObject key={title} x={[1210, 880, 550, 190][index] + 20} y="8" width="172" height="35"><div className="money-flow-column-title" dir="rtl">{title}</div></foreignObject>)}
        {layout.links.map((link) => {
          const key = link.target === "hub" ? link.source : link.target;
          const node = flow.nodes.find((item) => item.key === key);
          return <path key={link.id} d={link.path} fill={`url(#${id}-flow-${link.id})`}
            className={`money-flow-link ${active && link.source !== active.key && link.target !== active.key ? "muted" : ""}`}
            role="button" tabIndex={0} aria-label={describe(node)} aria-controls={detail ? detailsId : undefined} aria-expanded={detailKey === key}
            data-source={link.source} data-target={link.target} data-value={link.value} {...interact(key)}><title>{describe(node)}</title></path>;
        })}
        {layout.nodes.map((node) => <g key={node.key} className={`money-flow-node ${activeKey === node.key || detailKey === node.key ? "selected" : ""}`}
          role="button" tabIndex={0} aria-label={describe(node)} aria-expanded={detailKey === node.key} aria-controls={detail ? detailsId : undefined}
          data-node={node.key} data-value={node.value} {...interact(node.key)}>
          <title>{describe(node)}</title>
          <rect x={node.x} y={node.y - Math.max(0, 1 - node.height) / 2} width={layout.barWidth} height={Math.max(1, node.height)} rx="2" fill={node.color} />
          <foreignObject x={node.x + 22} y={node.y + node.height / 2 - 28} width="172" height="56"><div className="money-flow-node-label" dir="rtl"><span>{node.label}</span><bdi>{money(node.value)} · {percent(node.value)}</bdi></div></foreignObject>
        </g>)}
      </svg></div>
      <div className="money-flow-notes">
        <p>התרשים מציג תנועות מהבנק, לא תחזית. הפרש חיובי אינו יתרת החשבון או חיסכון מאומת. כשיצא יותר משנכנס, מוצג הפרש מחושב שאינו הכנסה נוספת.</p>
        {flow.cardPayments > 0 && <p className="money-flow-reconciliation">תשלומי הכרטיסים נספרים פעם אחת בלבד. לפירוט בתי העסק הותאמו {flow.matchedPayments} חיובי בנק בסך <bdi>{money(flow.matchedAmount)}</bdi>.{flow.unmatchedAmount > 0 && <> פירוט שלא הותאם: <bdi>{money(flow.unmatchedAmount)}</bdi> — ייתכן שחסרים כרטיסים, תנועות או מועדי חיוב.</>}</p>}
        {data.truncated && <p>התרשים מתבסס על התנועות שנטענו בלבד; היסטוריה נוספת שלא נטענה אינה נכללת.</p>}
      </div>
      {detail && <section id={detailsId} className="money-flow-details" aria-label={`פירוט זרימה: ${detail.label}`}>
        <div className="money-flow-detail-heading"><div><h3>{detail.label}</h3><p>{monthLabel(selectedMonth)} · {detail.entries.length ? `${detail.entries.length} תנועות בחישוב` : "חישוב התזרים"}</p></div>
          <strong className="money-flow-detail-total"><bdi>{money(detail.value)}</bdi></strong><button className="icon-button" aria-label="סגירת פירוט הזרימה" onClick={close}><X size={16} /></button>
        </div><p className="money-flow-explanation">{detail.explanation}</p>
        {!!detail.entries.length && <ul>{detail.entries.map((row, index) => <li key={`${row.id}:${index}`} data-transaction-id={row.id} data-contribution={row.contribution}>
          <div><strong>{row.description}</strong><small>{row.matchedBankDate ? `חיוב בבנק: ${dateLabel(row.matchedBankDate)} · חיוב בכרטיס: ${dateLabel(row.processed_date)}` : `תאריך: ${dateLabel(row.date)}`}</small>
            <small>{providers[row.provider]?.name || row.provider} · ••{String(row.account_number).slice(-4)}{row.contribution < 0 ? " · מקטין את הסכום" : ""}</small>
            {row.matchReason && <small>{row.matchReason}</small>}</div><bdi>{money(row.contribution)}</bdi>
        </li>)}</ul>}
      </section>}
    </>}
  </section>;
}
