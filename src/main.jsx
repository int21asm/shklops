import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bankDate } from "../shared/calendar.js";
import { formatMoney as shekel } from "../shared/currency.js";
import { cardForecastForMonth, estimatedClosingBalance, mortgageEstimateForMonth, nextKnownCardPayment, projectedInstallmentsForMonth, upcomingCardCharges } from "../shared/forecast.js";
import { recurringPayments } from "../shared/recurring.js";
import { cardCategoryColor } from "../shared/categories.js";
import { MoneyFlow } from "./MoneyFlow.jsx";
import {
  ArrowUpLeft,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Bell,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  Fingerprint,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Database,
  Server,
  Mail,
  Shield,
  ExternalLink,
  Landmark,
  Banknote,
  CalendarDays,
} from "lucide-react";
import "./style.css";

const labels = {
  dashboard: "סקירה כללית",
  transactions: "תנועות",
  assistant: "שאלו את שקלופס",
  settings: "הגדרות",
};
const colors = {
  hapoalim: "#eb525c",
  leumi: "#3484e9",
  max: "#33363e",
  oneZero: "#6458e5",
  discount: "#45a27b",
  mizrahi: "#ed8c42",
  visaCal: "#2164b2",
  isracard: "#ef554c",
};
const marks = {
  hapoalim: "פ",
  leumi: "ל",
  max: "max",
  oneZero: "01",
  discount: "ד",
  mizrahi: "מ",
  visaCal: "כאל",
  isracard: "י",
};
const fieldLabels = {
  username: "שם משתמש",
  password: "סיסמה לבנק",
  userCode: "קוד משתמש",
  id: "תעודת זהות",
  num: "קוד מזהה",
  card6Digits: "6 ספרות אחרונות של הכרטיס",
  nationalID: "תעודת זהות",
  email: "אימייל בבנק",
  phoneNumber: "מספר טלפון בינלאומי (‎+972…)",
};
const dateFormat = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const syncDateFormat = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const amount = (minor = 0) =>
  new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(
    minor / 100,
  );
const formatDate = (date) => dateFormat.format(new Date(date));
const formatMonth = (date) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
const monthAfter = (month, count = 1) => {
  const date = new Date(`${month}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 10);
};
const syncFailureMessage = (connection, run) =>
  connection.provider === "isracard" &&
  run?.error === "הבנק דורש שינוי סיסמה. יש להיכנס לאתר הבנק."
    ? "אתר ישראכרט ביקש שינוי סיסמה או השלמת תהליך כניסה. היכנסו לאתר ישראכרט, השלימו את ההנחיות שם, ואז נסו לסנכרן שוב. לא יובאו נתונים בסנכרון הזה."
    : run?.error || "לא הצלחנו לסנכרן את החיבור. נסו שוב או בדקו את פעילות הסנכרון.";
const ago = (value) =>
  !value
    ? "טרם סונכרן"
    : Math.floor((Date.now() - new Date(value)) / 60000) < 1
      ? "עודכן עכשיו"
      : Math.floor((Date.now() - new Date(value)) / 60000) < 60
        ? `לפני ${Math.floor((Date.now() - new Date(value)) / 60000)} דקות`
        : `עודכן ב־${formatDate(value)}`;
const syncAge = (value, now) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  if (minutes < 1) return "עכשיו";
  if (minutes === 1) return "לפני דקה";
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "לפני שעה";
  if (hours === 2) return "לפני שעתיים";
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "לפני יום";
  if (days === 2) return "לפני יומיים";
  return `לפני ${days} ימים`;
};
async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response
    .json()
    .catch(() => ({ error: "לא ניתן להתחבר לשרת" }));
  if (!response.ok) throw new Error(data.error || "הבקשה נכשלה");
  return data;
}
function Brand({ small = false }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <Wallet size={23} strokeWidth={2.1} />
        <span />
      </span>
      <strong>
        Shklops
      </strong>
    </div>
  );
}
function Logo({ provider, size = "" }) {
  return (
    <span
      className={`bank-logo ${size}`}
      style={{ "--bank-color": colors[provider] || "#667688" }}
    >
      {marks[provider] || <Landmark size={21} />}
    </span>
  );
}
function Spinner() {
  return <LoaderCircle className="spin" size={18} />;
}
function Empty({ icon: Icon = Wallet, title, description, action }) {
  return (
    <div className="empty">
      <span>
        <Icon size={30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  icon: Icon = Link2,
  wide = false,
}) {
  const element = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    element.current?.focus();
    const key = (e) => {
      if (e.key === "Escape" && onClose) onClose();
      if (e.key === "Tab") {
        const nodes = [
          ...element.current.querySelectorAll(
            'button,input,select,a,[tabindex="0"]',
          ),
        ].filter((n) => !n.disabled);
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={element}
      >
        <div className="modal-heading">
          <span className="modal-icon">
            <Icon size={24} />
          </span>
          {onClose && (
            <button
              className="icon-button"
              aria-label="סגירה"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          )}
        </div>
        <h2 id="modal-title">{title}</h2>
        <p className="muted">{subtitle}</p>
        {children}
      </section>
    </div>
  );
}
function Login({ onUser }) {
  const [mode, setMode] = useState("login"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [show, setShow] = useState(false);
  async function submit(e, demo = false) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = demo ? {} : Object.fromEntries(new FormData(e.target));
      const result = await api(`/auth/${demo ? "demo" : mode}`, {
        method: "POST",
        body: data,
      });
      onUser(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <span>
          <ShieldCheck size={16} /> מרחב אישי לכסף שלכם
        </span>
      </div>
      <div className="auth-layout">
        <section className="auth-story">
          <span className="eyebrow">
            <span className="live-dot" /> קצת יותר סדר. הרבה יותר שקט.
          </span>
          <h1>
            כל הכסף שלכם.
            <br />
            <em>תמונה אחת ברורה.</em>
          </h1>
          <p>
            הבנקים, כרטיסי האשראי וכל התנועות — סוף סוף במקום אחד. פחות גיליונות
            פתוחים, יותר שליטה במה שחשוב.
          </p>
          <div className="auth-preview">
            <div className="preview-label">
              <span>התמונה הפיננסית שלי</span>
              <span className="tiny-pill">הדגמה</span>
            </div>
            <h2 dir="ltr">
              ₪32,846<span>יתרה בחשבונות</span>
            </h2>
            <div className="preview-bars">
              {[30, 42, 38, 58, 51, 69, 62, 87, 79, 95, 89, 110].map((h, i) => (
                <i key={i} style={{ height: h, opacity: 0.25 + i * 0.06 }} />
              ))}
            </div>
            <div className="preview-banks">
              <Logo provider="hapoalim" />
              <Logo provider="leumi" />
              <Logo provider="max" />
              <span>כל החשבונות מתחברים לתמונה אחת</span>
            </div>
          </div>
          <div className="auth-features">
            <span>
              <CheckCircle2 size={16} /> בנקים וכרטיסי אשראי בישראל
            </span>
            <span>
              <CheckCircle2 size={16} /> אימות נוסף, כשצריך
            </span>
          </div>
        </section>
        <section className="auth-card">
          <span className="little-icon">
            <Fingerprint size={25} />
          </span>
          <h2>
            {mode === "login" ? "טוב לראות אתכם שוב" : "מתחילים לעשות סדר"}
          </h2>
          <p>היכנסו למרחב הפיננסי האישי שלכם</p>
          <div className="segmented">
            <button
              className={mode === "login" ? "selected" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              כניסה
            </button>
            <button
              className={mode === "register" ? "selected" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              חשבון חדש
            </button>
          </div>
          <form onSubmit={submit}>
            {mode === "register" && (
              <label>
                איך קוראים לכם?
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={60}
                  placeholder="השם שלכם"
                />
              </label>
            )}
            <label>
              כתובת אימייל
              <div className="input-icon">
                <Mail size={17} />
                <input
                  name="email"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                />
              </div>
            </label>
            <label>
              סיסמה
              <div className="password-field">
                <input
                  name="password"
                  type={show ? "text" : "password"}
                  dir="ltr"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                  minLength={12}
                  maxLength={128}
                  placeholder="לפחות 12 תווים"
                />
                <button
                  type="button"
                  aria-label={show ? "הסתרת סיסמה" : "הצגת סיסמה"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : mode === "login" ? (
                "כניסה לחשבון"
              ) : (
                "יצירת חשבון"
              )}
              <ArrowLeft size={17} />
            </button>
          </form>
          <div className="or">
            <span />
            או להכיר קודם
            <span />
          </div>
          <button
            className="button outline full"
            disabled={busy}
            onClick={(e) => submit(e, true)}
          >
            <Sparkles size={17} /> כניסה להדגמה עם נתונים לדוגמה
          </button>
          <small className="auth-note">
            <LockKeyhole size={13} /> כל משתמש רואה רק את הנתונים שלו.
            <br />
            ההדגמה לא מתחברת לחשבונות בנק אמיתיים.
          </small>
        </section>
      </div>
      <footer className="auth-footer">
        Shklops · מבוסס על israeli-bank-scrapers · פרויקט עצמאי
      </footer>
    </main>
  );
}

function App() {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false),
    [live, setLive] = useState(false),
    [dataLoaded, setDataLoaded] = useState(false),
    [clockNow, setClockNow] = useState(() => Date.now());
  const [page, setPage] = useState(() => new URLSearchParams(window.location.search).has("ai") ? "assistant" : "dashboard"),
    [transactionsKind, setTransactionsKind] = useState("bank"),
    [data, setData] = useState({
      connections: [],
      accounts: [],
      transactions: [],
      runs: [],
    }),
    [providers, setProviders] = useState([]),
    [settings, setSettings] = useState({
      daysBack: 90,
      combineInstallments: false,
      monthlyIncome: 0,
      monthlyCardEstimate: null,
      cardEstimatesByMonth: {},
    }),
    [jobs, setJobs] = useState([]),
    [updatingCardId, setUpdatingCardId] = useState(null);
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState(null),
    [mobile, setMobile] = useState(false),
    [period, setPeriod] = useState("month"),
    [forecastMonth, setForecastMonth] = useState(""),
    [settingsTab, setSettingsTab] = useState("sync"),
    [hidden, setHidden] = useState(false),
    [activity, setActivity] = useState(false);
  const statuses = useRef("");
  const currentUser = useRef(null);
  currentUser.current = user?.id;
  const providerMap = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.id, p])),
    [providers],
  );
  async function refresh() {
    const owner = user?.id;
    const result = await api("/data");
    if (currentUser.current === owner) {
      setData(result);
      setDataLoaded(true);
    }
  }
  useEffect(() => {
    api("/session")
      .then((r) => {
        setUser(r.user);
        setLive(r.liveEnabled);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    Promise.all([api("/data"), api("/providers"), api("/settings")])
      .then(([d, p, s]) => {
        if (mounted) {
          setData(d);
          setDataLoaded(true);
          setProviders(p);
          setSettings(s);
        }
      })
      .catch((e) => setError(e.message));
    let checking = false;
    async function poll() {
      if (checking) return;
      checking = true;
      try {
        const j = await api("/jobs");
        if (!mounted) return;
        setJobs(j);
        const signature = j.map((x) => `${x.id}:${x.status}`).join();
        if (statuses.current !== signature) {
          statuses.current = signature;
          await refresh();
        }
      } catch (e) {
        if (mounted) setError(e.message);
      } finally {
        checking = false;
      }
    }
    poll();
    const interval = setInterval(poll, 1200);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => setClockNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [user?.id]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const active = jobs.filter((j) => !j.finishedAt),
    mfa = active.find((j) => j.status === "waiting_mfa" && j.challenge);
  const latestRuns = new Map();
  for (const run of [...data.runs, ...jobs]) {
    const connectionId = run.connectionId || run.connection_id;
    const previous = latestRuns.get(connectionId);
    if (
      !previous ||
      (run.startedAt || run.started_at) >=
        (previous.startedAt || previous.started_at)
    )
      latestRuns.set(connectionId, run);
  }
  const lastSyncedConnection = data.connections
    .filter((connection) => connection.synced_at && Number.isFinite(Date.parse(connection.synced_at)))
    .sort((a, b) => Date.parse(b.synced_at) - Date.parse(a.synced_at))[0];
  const failedConnections = data.connections.filter(
    (connection) =>
      latestRuns.get(connection.id)?.status === "failed" ||
      (!latestRuns.has(connection.id) && connection.status === "failed"),
  );
  const rangeStart = useMemo(() => {
    const today = bankDate(new Date());
    if (period === "month") return `${today.slice(0, 7)}-01`;
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (period === "90" ? 90 : 3650));
    return d.toISOString().slice(0, 10);
  }, [period]);
  const bankTransactions = data.transactions.filter(
    (t) => providerMap[t.provider]?.kind === "bank",
  );
  const currentMonthStart = `${bankDate(new Date()).slice(0, 7)}-01`;
  const previousMonth = new Date(`${currentMonthStart}T12:00:00Z`);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const previousMonthStart = previousMonth.toISOString().slice(0, 10);
  const mortgageEstimate = mortgageEstimateForMonth(bankTransactions, previousMonthStart);
  const forecastMortgage = mortgageEstimate.amount;
  const nextMonthStart = monthAfter(currentMonthStart);
  const forecastMonths = Array.from({ length: 24 }, (_, index) =>
    monthAfter(currentMonthStart, index + 1),
  );
  const selectedForecastMonth = forecastMonths.includes(forecastMonth)
    ? forecastMonth
    : nextMonthStart;
  const cardConnections = data.connections.filter(
    (connection) => providerMap[connection.provider]?.kind === "card",
  );
  const unavailableCardConnections = cardConnections.filter(
    (connection) =>
      connection.status === "failed" ||
      !data.accounts.some((account) => account.connection_id === connection.id),
  );
  const unavailableCardIds = new Set(
    unavailableCardConnections.map((connection) => connection.id),
  );
  const cardAccounts = data.accounts.filter(
    (a) =>
      a.enabled !== false &&
      a.currency === "ILS" &&
      providerMap[a.provider]?.kind === "card" &&
      !unavailableCardIds.has(a.connection_id),
  );
  const selectedCardForecast = cardForecastForMonth(
    cardAccounts,
    selectedForecastMonth,
    unavailableCardConnections.length > 0,
    data.transactions,
  );
  const forecastCardPayments = selectedCardForecast.amount;
  const cardChargeDates = selectedCardForecast.dates;
  const cardBreakdown = selectedCardForecast.breakdown.map((item) => {
    const account = cardAccounts.find((a) => a.id === item.accountId);
    return { ...item,
      label: `${providerMap[account?.provider]?.name || account?.provider || "כרטיס"} ••${account?.number?.slice(-4) || ""}` };
  });
  const forecastPartial = selectedCardForecast.source === "partial";
  const visibleTransactions = bankTransactions.filter(
    (t) => t.date >= rangeStart && t.date <= bankDate(new Date()),
  );
  const visibleCardCharges = data.transactions.filter((t) => {
    const date = t.processed_date || t.date;
    return providerMap[t.provider]?.kind === "card" &&
      t.status === "completed" && t.amount < 0 && t.currency === "ILS" &&
      date >= rangeStart && date <= bankDate(new Date());
  });
  const income = visibleTransactions
      .filter((t) => t.currency === "ILS" && t.amount > 0)
      .reduce((s, t) => s + t.amount, 0),
    expenses = visibleTransactions
      .filter((t) => t.currency === "ILS" && t.amount < 0)
      .reduce((s, t) => s - t.amount, 0),
    ilsAccounts = data.accounts.filter(
      (a) => a.currency === "ILS" && providerMap[a.provider]?.kind === "bank",
    ),
    accountsWithBalance = ilsAccounts.filter((a) => Number.isFinite(a.balance)),
    missingBalances = ilsAccounts.length - accountsWithBalance.length,
    balance = accountsWithBalance.length
      ? accountsWithBalance.reduce((s, a) => s + a.balance, 0)
      : null;
  const bankBalanceSources = accountsWithBalance.map((account) => ({
    label: `${providerMap[account.provider]?.name || account.provider} ••${account.number.slice(-4)}`,
    amount: account.balance,
  }));
  function navigate(target, kind = "bank") {
    if (target === "transactions") setTransactionsKind(kind);
    if (target === "accounts") {
      setSettingsTab("accounts");
      setPage("settings");
    } else {
      if (target === "settings") setSettingsTab("sync");
      setPage(target);
    }
    setMobile(false);
  }
  async function startSync(connection, credentials) {
    const owner = user?.id;
    try {
      await api(`/connections/${connection.id}/sync`, {
        method: "POST",
        body: credentials ? { credentials } : {},
      });
      setToast("הסנכרון התחיל. אפשר להמשיך להשתמש באתר.");
      setModal(null);
      const j = await api("/jobs");
      if (currentUser.current === owner) setJobs(j);
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }
  async function syncAll() {
    if (!data.connections.length) {
      setModal({ type: "connect" });
      return;
    }
    if (!user.demo && !live) {
      setError(
        "סריקה חיה אינה מופעלת בשרת זה. אין להזין פרטי בנק; אפשר לנסות עם חשבון הדגמה.",
      );
      return;
    }
    const eligible = data.connections.filter((c) => user.demo || c.remembered);
    for (const c of eligible) {
      if (!active.some((j) => j.connectionId === c.id))
        try {
          await startSync(c);
        } catch {
          return;
        }
    }
    const pending = data.connections.filter(
      (c) =>
        !user.demo &&
        !c.remembered &&
        !active.some((j) => j.connectionId === c.id),
    );
    if (pending.length)
      setModal({
        type: "credentials",
        connection: pending[0],
        remaining: pending.slice(1),
      });
  }
  function requestConnectionSync(connection) {
    if (!user.demo && !live) {
      setError(
        "סריקה חיה אינה מופעלת בשרת זה. אין להזין פרטי בנק; אפשר לנסות עם חשבון הדגמה.",
      );
    } else if (user.demo || connection.remembered) {
      startSync(connection).catch(() => {});
    } else {
      setModal({ type: "credentials", connection });
    }
  }
  async function changeCardEnabled(account, enabled) {
    setUpdatingCardId(account.id);
    try {
      await api(`/accounts/${account.id}`, {
        method: "PATCH",
        body: { enabled },
      });
      await refresh();
      setToast(enabled
        ? "הכרטיס נבחר. לחצו על סנכרון כדי לייבא את התנועות שלו."
        : "הכרטיס הוסר מהייבוא והתנועות שלו נמחקו.");
    } catch (e) {
      setError(e.message);
    } finally {
      setUpdatingCardId(null);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
      setUser(null);
      setData({ connections: [], accounts: [], transactions: [], runs: [] });
      setDataLoaded(false);
      setJobs([]);
      setPage("dashboard");
      setActivity(false);
      setModal(null);
      statuses.current = "";
    } catch (e) {
      setError(e.message);
    }
  }
  if (!ready)
    return (
      <div className="initial-load">
        <Brand />
        <Spinner />
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          onUser={(u) => {
            setError("");
            setUser(u);
          }}
        />
        {error && (
          <div className="toast error" role="alert">
            {error}
            <button aria-label="סגירה" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <button
            className="icon-button mobile-close"
            aria-label="סגירת תפריט"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          {[
            [LayoutDashboard, "dashboard"],
            [ArrowRight, "transactions"],
            [MessageCircle, "assistant"],
            [Settings2, "settings"],
          ].map(([Icon, key]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => navigate(key)}
            >
              <Icon size={20} />
              <span>{labels[key]}</span>
              {page === key && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.demo ? "חשבון הדגמה" : "החשבון האישי"}</small>
            </div>
            <button
              className="icon-button"
              aria-label="יציאה מהחשבון"
              title="יציאה מהחשבון"
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <div className="sidebar-shade" onClick={() => setMobile(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="פתיחת תפריט"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <Home size={16} />
            <ChevronLeft size={13} />
            <span>{labels[page]}</span>
          </div>
          <div className="top-actions">
            {user.demo && (
              <span className="demo-badge">
                <span /> מצב הדגמה
              </span>
            )}
            <span className="top-date">
              {new Intl.DateTimeFormat("he-IL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date())}
            </span>
            <button
              className="icon-button notification"
              aria-label="פעילות סנכרון"
              onClick={() => setActivity(!activity)}
            >
              <Bell size={20} />
              {active.length > 0 && <i />}
            </button>
            <button className="logout-top" onClick={logout}>
              <LogOut size={16} />
              <span>יציאה</span>
            </button>
            <span className="avatar small-avatar">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        <main className="main-content">
          {user.demo && (
            <div className="demo-banner">
              <Sparkles size={16} />
              <span>
                נעים להכיר, זו ההדגמה שלכם. כל הנתונים בדויים — אפשר לחבר חשבון
                לדוגמה ולנסות סנכרון ואימות.
              </span>
              <button onClick={() => setModal({ type: "connect" })}>
                בואו ננסה <ArrowLeft size={14} />
              </button>
            </div>
          )}
          {failedConnections.map((connection) => (
            <div className="sync-failure" role="alert" key={connection.id}>
              <AlertCircle size={20} />
              <div>
                <strong>הסנכרון של {providerMap[connection.provider]?.name || connection.name} נכשל</strong>
                <p>{syncFailureMessage(connection, latestRuns.get(connection.id))}</p>
              </div>
              <button className="text-button" onClick={() => navigate("accounts")}>
                לחשבון ולניסיון חוזר <ArrowLeft size={15} />
              </button>
            </div>
          ))}
          {page === "dashboard" && dataLoaded && (
            <div className={`last-sync-banner ${lastSyncedConnection ? "" : "empty"}`} role="status">
              <span className="last-sync-icon"><Clock3 size={18} /></span>
              <div>
                <strong>
                  {lastSyncedConnection
                    ? `סנכרון מוצלח אחרון: ${syncAge(lastSyncedConnection.synced_at, clockNow)}`
                    : "עדיין לא בוצע סנכרון מוצלח"}
                </strong>
                <small>
                  {lastSyncedConnection
                    ? `${providerMap[lastSyncedConnection.provider]?.name || lastSyncedConnection.name} · ${syncDateFormat.format(new Date(lastSyncedConnection.synced_at))}`
                    : "חברו חשבון והפעילו סנכרון כדי לעדכן את הנתונים."}
                </small>
              </div>
              <button className="text-button" onClick={() => lastSyncedConnection ? setActivity(true) : navigate("accounts")}>
                {lastSyncedConnection ? "פעילות סנכרון" : "לחשבונות"} <ArrowLeft size={14} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "dashboard"
                  ? `שלום ${user.name}, טוב לראות אותך`
                  : "המרחב הפיננסי שלך"}
              </div>
              <h1>
                {page === "dashboard" ? "הכסף שלכם, בתמונה אחת." : labels[page]}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {page === "dashboard"
                  ? "כל החשבונות, כל התנועות. קצת יותר סדר ביום שלכם."
                  : page === "transactions"
                    ? "כל ההוצאות וההכנסות, בלי לדלג בין אפליקציות."
                  : page === "assistant"
                    ? "שאלו על הנתונים שלכם וקבלו תשובה עם דרך החישוב."
                  : "כאן בוחרים איך המרחב שלכם עובד."}
              </p>
            </div>
            <div className="heading-actions">
              {page === "dashboard" && (
                <button
                  className="button white"
                  onClick={() => setHidden(!hidden)}
                  aria-label={hidden ? "הצגת סכומים" : "הסתרת סכומים"}
                >
                  {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              )}
              {page !== "settings" && page !== "assistant" && (
                <button
                  className="button primary"
                  onClick={syncAll}
                  disabled={active.length > 0}
                >
                  {active.length ? (
                    <Spinner />
                  ) : (
                    <RefreshCw size={16} />
                  )}{" "}
                  {active.length
                    ? "מסנכרנים…"
                    : "סנכרון חשבונות"}
                </button>
              )}
            </div>
          </div>
          {active.length > 0 && (
            <div className="sync-banner">
              <Spinner />
              <span>
                {mfa
                  ? "נדרש קוד אימות כדי להמשיך בסנכרון"
                  : "מעדכנים את התמונה הפיננסית שלכם…"}
              </span>
              <button onClick={() => setActivity(true)}>
                לצפייה בפעילות <ArrowLeft size={14} />
              </button>
            </div>
          )}
          {page === "dashboard" && (
            <>
              <div className="section-line">
                <div className="section-tabs">
                  <span className="selected">התמונה שלי</span>
                  <span className="subtle-label">
                    <span className="live-dot" /> הנתונים האחרונים שסונכרנו
                  </span>
                </div>
                <select
                  className="period-select"
                  aria-label="תקופה"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="month">החודש</option>
                  <option value="90">90 ימים אחרונים</option>
                  <option value="all">כל התקופה</option>
                </select>
              </div>
              <section className="stats-grid">
                <Stat
                  featured
                  title="יתרה בחשבונות הבנק"
                  value={
                    hidden ? "••••••" : balance === null ? "—" : shekel(balance)
                  }
                  icon={Wallet}
                  hint={
                    balance === null
                      ? "יתרה אינה זמינה בשקלים"
                      : missingBalances
                        ? "יתרה חלקית · שקלים"
                        : "חשבונות בנק · שקלים"
                  }
                  detail={
                    balance === null
                      ? ilsAccounts.length
                        ? "הבנק לא החזיר יתרה בסנכרון האחרון"
                        : "לא סונכרנו חשבונות בשקלים"
                      : missingBalances
                        ? `יתרה חסרה ב־${missingBalances} חשבונות נוספים`
                        : accountsWithBalance.length === 1
                          ? "חשבון בנק אחד עם יתרה"
                          : `${accountsWithBalance.length} חשבונות בנק עם יתרה`
                  }
                />
                <Stat
                  title="הכנסות בתקופה"
                  value={hidden ? "••••••" : shekel(income)}
                  icon={ArrowDownLeft}
                  tone="green"
                  hint="זיכויים בחשבונות הבנק · שקלים"
                  detail={
                    income === 0
                      ? "לא נמצאו זיכויים בתקופה שנבחרה"
                      : `${visibleTransactions.filter((t) => t.amount > 0 && t.currency === "ILS").length} תנועות זכות`
                  }
                />
                <Stat
                  title="הוצאות בתקופה"
                  value={hidden ? "••••••" : shekel(expenses)}
                  icon={ArrowUpLeft}
                  tone="orange"
                  hint="חיובים בחשבונות הבנק · שקלים"
                  detail={`${visibleTransactions.filter((t) => t.amount < 0 && t.currency === "ILS").length} תנועות חובה`}
                />
                <Stat
                  title="תזרים נטו"
                  value={hidden ? "••••••" : shekel(income - expenses)}
                  icon={TrendingUp}
                  tone="purple"
                  hint="הכנסות פחות הוצאות בבנק"
                  detail={
                    income - expenses >= 0
                      ? "יותר נכנס ממה שיצא"
                      : "יותר יצא ממה שנכנס"
                  }
                />
              </section>
              <div className="chart-grid">
                <Cashflow transactions={bankTransactions} hidden={hidden} />
                <Spending transactions={visibleCardCharges} hidden={hidden} providers={providerMap}
                  periodLabel={period === "month" ? formatMonth(currentMonthStart)
                    : `${formatDate(`${rangeStart}T12:00:00Z`)}–${formatDate(`${bankDate(new Date())}T12:00:00Z`)}`} />
              </div>
              <MoneyFlow data={data} providers={providerMap} hidden={hidden} />
              <CashflowForecast
                bankBalance={balance}
                bankBalanceSources={bankBalanceSources}
                missingBalances={missingBalances}
                monthlyIncome={settings.monthlyIncome || 0}
                mortgage={forecastMortgage}
                mortgageEstimate={mortgageEstimate}
                cardPayments={forecastCardPayments}
                cardSource={selectedCardForecast.source}
                forecastPartial={forecastPartial}
                unavailableCards={unavailableCardConnections.length > 0}
                cardChargeDates={cardChargeDates}
                cardBreakdown={cardBreakdown}
                cardKnownFuture={selectedCardForecast.knownFuture}
                previousMonth={previousMonthStart}
                selectedMonth={selectedForecastMonth}
                forecastMonths={forecastMonths}
                onMonthChange={setForecastMonth}
                hidden={hidden}
                onSettings={() => navigate("settings")}
              />
              <RecurringPayments data={data} providers={providerMap} hidden={hidden} />
              <div className="accounts-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      החשבונות שלי{" "}
                      <span className="count">{data.connections.length}</span>
                    </h2>
                    <p>כל החיבורים שלכם, במבט אחד</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("accounts")}
                  >
                    לכל החשבונות <ArrowLeft size={15} />
                  </button>
                </div>
                <div className="account-strip">
                  {data.connections.slice(0, 3).map((c) => (
                    <ConnectionCard
                      key={c.id}
                      connection={c}
                      accounts={data.accounts}
                      transactions={data.transactions}
                      providers={providerMap}
                      jobs={active}
                      lastRun={latestRuns.get(c.id)}
                      hidden={hidden}
                      onSync={() => requestConnectionSync(c)}
                    />
                  ))}
                  <button
                    className="add-account-tile"
                    onClick={() => setModal({ type: "connect" })}
                  >
                    <span>
                      <Plus size={22} />
                    </span>
                    <strong>חיבור חשבון</strong>
                    <small>בנק או כרטיס אשראי</small>
                  </button>
                </div>
              </div>
              <div className="recent-transactions">
                <Transactions
                  sourceKind="bank"
                  data={data}
                  providers={providerMap}
                  compact
                  hidden={hidden}
                  onViewAll={() => navigate("transactions", "bank")}
                />
                <UpcomingCardCharges
                  data={data}
                  providers={providerMap}
                  hidden={hidden}
                  onViewAll={() => navigate("transactions", "card")}
                />
              </div>
            </>
          )}
          {page === "transactions" && (
            <Transactions
              key={transactionsKind}
              sourceKind={transactionsKind}
              data={data}
              providers={providerMap}
              onDataChange={refresh}
              onAiConnect={() => navigate("assistant")}
            />
          )}
          {page === "settings" && (
            <Settings
              tab={settingsTab}
              setTab={setSettingsTab}
              settings={settings}
              setSettings={setSettings}
              user={user}
              live={live}
              data={data}
              providers={providerMap}
              jobs={active}
              latestRuns={latestRuns}
              updatingCardId={updatingCardId}
              onCardEnabledChange={changeCardEnabled}
              onConnectionSync={requestConnectionSync}
              onDelete={(connection) => setModal({ type: "delete", connection })}
              onForget={async (connection) => {
                try {
                  await api(`/connections/${connection.id}/forget`, {
                    method: "POST",
                    body: {},
                  });
                  await refresh();
                  setToast("פרטי הכניסה נמחקו");
                } catch (e) {
                  setError(e.message);
                }
              }}
              onConnect={() => setModal({ type: "connect" })}
              notify={setToast}
              onError={setError}
            />
          )}
          {page === "assistant" && <AiAssistant userId={user.id} />}
          <footer className="main-footer">
            <span>
              <ShieldCheck size={14} /> המידע מוצג רק במרחב האישי שלכם
            </span>
            <span>
              Shklops <span className="footer-divider">/</span> עושים מקום
              לתמונה ברורה
            </span>
          </footer>
        </main>
      </div>
      {activity && (
        <div className="activity-panel">
          <div className="section-heading">
            <h2>פעילות סנכרון</h2>
            <button
              className="icon-button"
              aria-label="סגירת פעילות"
              onClick={() => setActivity(false)}
            >
              <X size={19} />
            </button>
          </div>
          {!data.runs.length && !jobs.length ? (
            <Empty
              icon={Clock3}
              title="כאן תופיע הפעילות שלכם"
              description="התחילו סנכרון כדי לעדכן את הנתונים."
            />
          ) : (
            <div className="activity-list">
              {[
                ...jobs,
                ...data.runs.filter((r) => !jobs.some((j) => j.id === r.id)),
              ]
                .sort(
                  (a, b) =>
                    new Date(b.startedAt || b.started_at) -
                    new Date(a.startedAt || a.started_at),
                )
                .slice(0, 20)
                .map((j) => (
                  <div className="activity-item" key={j.id}>
                    <span
                      className={`activity-icon ${j.status === "failed" ? "bad" : ""}`}
                    >
                      {["running", "queued", "waiting_mfa"].includes(
                        j.status,
                      ) ? (
                        <Spinner />
                      ) : j.status === "completed" ? (
                        <Check size={18} />
                      ) : (
                        <AlertCircle size={18} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {data.connections.find(
                          (c) => c.id === (j.connectionId || j.connection_id),
                        )?.name || "סנכרון חשבון"}
                      </strong>
                      <small>
                        {
                          {
                            running: "מתבצע סנכרון",
                            queued: "ממתין בתור",
                            waiting_mfa: "ממתין לקוד אימות",
                            completed: `הושלם · ${j.count} תנועות חדשות`,
                            failed: "הסנכרון נכשל",
                            cancelled: "בוטל",
                            interrupted: "הופסק בהפעלת השרת",
                          }[j.status]
                        }
                      </small>
                      {j.error && <p>{j.error}</p>}
                    </div>
                    {!j.finishedAt &&
                      ["running", "queued", "waiting_mfa"].includes(
                        j.status,
                      ) && (
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              await api(`/jobs/${j.id}/cancel`, {
                                method: "POST",
                                body: {},
                              });
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          ביטול
                        </button>
                      )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
      {modal?.type === "connect" && (
        <ConnectionModal
          providers={providers}
          user={user}
          live={live}
          onClose={() => setModal(null)}
          onSaved={async () => {
            await refresh();
            setModal(null);
            setToast("החשבון נוסף. אפשר להתחיל בסנכרון.");
          }}
        />
      )}
      {modal?.type === "credentials" && (
        <CredentialsModal
          key={modal.connection.id}
          connection={modal.connection}
          provider={providerMap[modal.connection.provider]}
          onClose={() => setModal(null)}
          onSubmit={async (credentials) => {
            await startSync(modal.connection, credentials);
            if (modal.remaining?.length)
              setModal({
                type: "credentials",
                connection: modal.remaining[0],
                remaining: modal.remaining.slice(1),
              });
          }}
        />
      )}
      {modal?.type === "delete" && (
        <Modal
          icon={Trash2}
          title="לנתק את החשבון?"
          subtitle={`החיבור ״${modal.connection.name}״ וכל התנועות ששייכות אליו יימחקו מהמרחב שלכם.`}
          onClose={() => setModal(null)}
        >
          <div className="modal-actions">
            <button
              className="button danger"
              onClick={async () => {
                try {
                  await api(`/connections/${modal.connection.id}`, {
                    method: "DELETE",
                    body: {},
                  });
                  setModal(null);
                  await refresh();
                  setToast("החשבון נותק והנתונים נמחקו");
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              ניתוק ומחיקת נתונים
            </button>
            <button className="button white" onClick={() => setModal(null)}>
              להשאיר מחובר
            </button>
          </div>
        </Modal>
      )}
      {mfa && (
        <MfaModal
          job={mfa}
          demo={user.demo}
          connection={data.connections.find((c) => c.id === mfa.connectionId)}
          onSubmit={(code) =>
            api(`/jobs/${mfa.id}/mfa`, {
              method: "POST",
              body: { challengeId: mfa.challenge.id, code },
            })
          }
          onCancel={() =>
            api(`/jobs/${mfa.id}/cancel`, { method: "POST", body: {} }).catch(
              (e) => setError(e.message),
            )
          }
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button aria-label="סגירה" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          <AlertCircle size={19} />
          {error}
          <button aria-label="סגירה" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ title, value, icon: Icon, hint, detail, featured, tone }) {
  return (
    <article className={`stat ${featured ? "featured" : ""}`}>
      <div className="stat-heading">
        <span>{title}</span>
        <span className={`stat-icon ${tone || ""}`}>
          <Icon size={19} />
        </span>
      </div>
      <strong className="stat-value" dir="ltr">
        {value}
      </strong>
      <div className="stat-hint">{hint}</div>
      <div className="stat-divider" />
      <span className="stat-detail">
        {featured ? (
          <span className="white-dot" />
        ) : (
          <span className={`mini-dot ${tone}`} />
        )}{" "}
        {detail}
      </span>
      {featured && <div className="stat-decoration" />}
    </article>
  );
}
function CashflowForecast({
  bankBalance,
  bankBalanceSources,
  missingBalances,
  monthlyIncome,
  mortgage,
  mortgageEstimate,
  cardPayments,
  cardSource,
  forecastPartial,
  unavailableCards,
  cardChargeDates,
  cardBreakdown,
  cardKnownFuture,
  previousMonth,
  selectedMonth,
  forecastMonths,
  onMonthChange,
  hidden,
  onSettings,
}) {
  const missing = [];
  if (bankBalance === null) missing.push("יתרה נוכחית בחשבון הבנק");
  if (!monthlyIncome) missing.push("הכנסה חודשית קבועה בהגדרות");
  if (mortgage === null)
    missing.push('חיוב "טפחות - לווים" בחודש הקודם');
  const ready = missing.length === 0;
  const closing = estimatedClosingBalance({
    openingBalance: bankBalance,
    income: ready ? monthlyIncome : null,
    mortgage,
    cardPayments,
    cardComplete: !forecastPartial,
    bankComplete: missingBalances === 0,
  });
  const projected = closing.amount;
  const estimatePartial = closing.partial;
  const shownMoney = (value) => hidden ? "••••••" : shekel(value);
  const balanceExplanation = bankBalanceSources.length
    ? [
        ...bankBalanceSources.map((account) => `${account.label}: ${shownMoney(account.amount)}`),
        `סך היתרות האחרונות שסונכרנו: ${shownMoney(bankBalance)}.`,
        ...(missingBalances ? [`חסרה יתרה ב־${missingBalances} חשבונות בנק נוספים.`] : []),
        "יתרה זו היא נקודת הפתיחה לכל חודש שנבחר; חודשים קודמים אינם נצברים.",
      ]
    : ["אין יתרה מסונכרנת לחשבון בנק בשקלים."];
  const mortgageExplanation = mortgageEstimate.entries.length
    ? [
        ...mortgageEstimate.entries.map((entry) =>
          `${formatDate(`${entry.date}T12:00:00Z`)} · ${entry.description}: ${shownMoney(entry.amount)}`),
        ...(mortgageEstimate.duplicates
          ? [`${mortgageEstimate.duplicates} ${mortgageEstimate.duplicates === 1 ? "רישום זהה נוסף לא נספר" : "רישומים זהים נוספים לא נספרו"}`]
          : []),
        `סך החיובים הייחודיים מ־${formatMonth(previousMonth)} חוזר בכל חודש תחזית.`,
      ]
    : [`לא נמצא חיוב טפחות - לווים ב־${formatMonth(previousMonth)}.`];
  const cardExplanation = cardBreakdown.length
    ? [
        ...cardBreakdown.map((card) => {
          const source = card.source === "scheduled"
            ? `חיוב מסונכרן ל־${formatDate(`${card.date}T12:00:00Z`)}`
            : card.source === "dated"
              ? `${card.count} תנועות מתוארכות`
              : card.source === "projected"
                ? `${card.count} תשלומים צפויים לפי עסקאות קודמות`
                : "לא נמצא חיוב לחודש זה";
          return `${card.label}: ${card.source === "unknown" ? "—" : shownMoney(card.amount)} · ${source}`;
        }),
        `סך החיובים שזוהו ל־${formatMonth(selectedMonth)}: ${shownMoney(cardPayments)}${forecastPartial ? " · הסכום חלקי" : ""}.`,
      ]
    : ["לא נבחרו כרטיסים עם חיוב ידוע לחודש זה."];
  const resultExplanation = [
    `יתרה נוכחית בבנק: ${bankBalance === null ? "לא ידועה" : shownMoney(bankBalance)}`,
    `הכנסה חודשית: ${monthlyIncome ? shownMoney(monthlyIncome) : "לא הוגדרה"}`,
    `פחות משכנתא: ${mortgage === null ? "לא ידועה" : shownMoney(mortgage)}`,
    `פחות חיובי כרטיסים שזוהו: ${forecastPartial && cardPayments === 0 ? "לא ידועים" : shownMoney(cardPayments)}`,
    `יתרה צפויה בסוף ${formatMonth(selectedMonth)}: ${projected === null ? "לא ניתן לחשב" : shownMoney(projected)}${estimatePartial ? " · אומדן חלקי" : ""}`,
  ];
  return (
    <section className="panel forecast-panel" aria-label="תחזית תזרים">
      <div className="panel-heading">
        <div>
          <h2>תזרים</h2>
          <p>תרחיש חודשי ל־{formatMonth(selectedMonth)}</p>
        </div>
        <div className="forecast-month-control">
          <label htmlFor="forecast-month">חודש התחזית</label>
          <select
            id="forecast-month"
            value={selectedMonth}
            onChange={(event) => onMonthChange(event.target.value)}
          >
            {forecastMonths.map((month, index) => (
              <option key={month} value={month}>
                {formatMonth(month)}{index === 0 ? " · החודש הבא" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="forecast-content">
        <div className={`forecast-result ${estimatePartial ? "partial" : ""}`} tabIndex={0} aria-label="פירוט חישוב היתרה הצפויה">
          <span>{estimatePartial ? "יתרה צפויה לפי נתונים זמינים" : "יתרה צפויה בסוף החודש"} <CircleHelp className="forecast-help-icon" size={13} aria-hidden="true" /></span>
          <strong
            className={
              projected === null || estimatePartial
                ? ""
                : projected < 0
                  ? "below-zero"
                  : "above-zero"
            }
            dir="ltr"
          >
            {hidden
              ? "••••••"
              : projected === null
                ? "—"
                : shekel(projected)}
          </strong>
          <p>
            {ready
              ? projected === null
                ? "אין סכום חיוב עתידי ידוע לכרטיסים בחודש זה, ולכן לא ניתן לחשב יתרה צפויה אמינה."
                : estimatePartial
                  ? `אומדן חלקי: ${forecastPartial ? "חיוב הכרטיסים אינו מלא" : ""}${forecastPartial && missingBalances ? " · " : ""}${missingBalances ? "חסרה יתרה בחלק מחשבונות הבנק" : ""}. היתרה בפועל עשויה להיות שונה.`
                  : "יתרת הבנק הנוכחית ועוד הכנסה חודשית, פחות משכנתא וחיובי כרטיסים לחודש שנבחר."
              : `כדי להציג תחזית, צריך להשלים: ${missing.join(" · ")}.`}
          </p>
          <ForecastTooltip items={resultExplanation} />
        </div>
        <div className="forecast-breakdown">
          <ForecastLine
            label="יתרה נוכחית בחשבונות הבנק"
            value={bankBalance}
            hidden={hidden}
            explanation={balanceExplanation}
          />
          <ForecastLine
            label="הכנסה חודשית קבועה"
            value={monthlyIncome || null}
            hidden={hidden}
            positive
            explanation={[`הסכום שהוגדר בהגדרות כהכנסה חודשית קבועה: ${monthlyIncome ? shownMoney(monthlyIncome) : "לא הוגדר"}.`, "אותו סכום משמש לכל חודש תחזית."]}
          />
          <ForecastLine
            label="משכנתא חודשית"
            detail={`לפי חיוב ${formatMonth(previousMonth)}; הנחה לחודש שנבחר`}
            value={mortgage === null ? null : -mortgage}
            hidden={hidden}
            explanation={mortgageExplanation}
          />
          <ForecastLine
            label={`${cardSource === "partial" ? "חיובי כרטיסים שזוהו" : "חיובי כרטיסים צפויים"} · ${formatMonth(selectedMonth)}`}
            detail={
              cardSource === "partial"
                  ? cardKnownFuture
                    ? `חיובים עתידיים ותשלומים ידועים בלבד; קניות חדשות אינן כלולות${unavailableCards ? " · חיבור כרטיס לא סונכרן" : ""}`
                    : cardChargeDates.length
                      ? `נכללו חיובים מתוארכים: ${cardChargeDates
                          .map((date) => formatDate(`${date}T12:00:00Z`))
                          .join(" · ")}; סכומים נוספים חסרים${unavailableCards ? " בגלל חיבור שלא סונכרן" : ""}`
                      : `אין חיובי כרטיסים ידועים לחודש זה${unavailableCards ? " · חיבור כרטיס לא סונכרן" : ""}`
                  : cardChargeDates.length
                    ? `מועדים שסונכרנו: ${cardChargeDates
                    .map((date) => formatDate(`${date}T12:00:00Z`))
                    .join(" · ")}`
                    : "לא צפוי חיוב לפי הסנכרון האחרון"
            }
            value={cardSource === "partial" && cardPayments === 0 ? null : cardPayments === 0 ? 0 : -cardPayments}
            hidden={hidden}
            explanation={cardExplanation}
          />
        </div>
      </div>
      <div className="forecast-footer">
        <span>
          כל חודש מחושב בנפרד: יתרת הבנק הנוכחית ועוד הכנסה, פחות משכנתא וחיובי כרטיסים של אותו חודש.
          לחודשים ללא חיוב כולל מסונכרן נכללים רק חיובים עתידיים ותשלומים ידועים.
          יתרת חודשי תחזית קודמים אינה נצברת; הוצאות אחרות אינן כלולות.
        </span>
        <button className="text-button" onClick={onSettings}>
          הגדרת הכנסה <ArrowLeft size={14} />
        </button>
      </div>
    </section>
  );
}
function ForecastTooltip({ items }) {
  return (
    <div className="forecast-tooltip" role="tooltip">
      <b>איך חושב?</b>
      <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div>
  );
}
function ForecastLine({ label, detail, value, hidden, positive = false, explanation }) {
  return (
    <div className="forecast-line" tabIndex={0} aria-label={`פירוט חישוב ${label}`}>
      <span>
        {label} <CircleHelp className="forecast-help-icon" size={12} aria-hidden="true" />
        {detail && <small>{detail}</small>}
      </span>
      <strong dir="ltr">
        {hidden
          ? "••••••"
          : value === null
            ? "—"
            : `${value > 0 && positive ? "+" : ""}${shekel(value)}`}
      </strong>
      <ForecastTooltip items={explanation} />
    </div>
  );
}
function Cashflow({ transactions, hidden }) {
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${bankDate(new Date()).slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 5 + i);
    return {
      key: d.toISOString().slice(0, 7),
      name: new Intl.DateTimeFormat("he-IL", {
        month: "short",
        timeZone: "Asia/Jerusalem",
      }).format(d),
      income: 0,
      expense: 0,
      net: 0,
    };
  });
  transactions
    .filter((t) => t.currency === "ILS")
    .forEach((t) => {
      const m = months.find((m) => m.key === t.date.slice(0, 7));
      if (m) {
        if (t.amount >= 0) m.income += t.amount;
        else m.expense -= t.amount;
      }
    });
  months.forEach((m) => {
    m.net = m.income - m.expense;
  });
  const max = Math.max(
      ...months.flatMap((m) => [m.income, m.expense, Math.abs(m.net)]),
      100000,
    ),
    ceiling = Math.ceil(max / 500000) * 500000;
  return (
    <section className="panel cashflow">
      <div className="panel-heading">
        <div>
          <h2>איך הכסף זז?</h2>
          <p>הכנסות מול הוצאות בחשבונות הבנק, בחצי השנה האחרונה</p>
        </div>
        <span className="chart-unit">₪ ILS</span>
      </div>
      <div className="chart-legend">
        <span>
          <i style={{ background: "#6b5ce7" }} /> הכנסות
        </span>
        <span>
          <i style={{ background: "#d6d0fb" }} /> הוצאות
        </span>
        <span>
          <i style={{ background: "#35a77b" }} /> תזרים נטו
        </span>
      </div>
      <div
        className="bar-chart"
        aria-label="גרף הכנסות, הוצאות ותזרים נטו בחצי השנה האחרונה"
      >
        <div className="y-labels">
          {[1, 0.5, 0, -0.5, -1].map((v) => (
            <span key={v}>{hidden ? "•••" : amount(ceiling * v)}</span>
          ))}
        </div>
        <div className="plot">
          <div className="grid-lines">
            {[1, 2, 3, 4, 5].map((i) => (
              <i key={i} />
            ))}
          </div>
          <div className="bars">
            {months.map((m, i) => (
              <div
                className={`bar-group ${i === 5 ? "current" : ""}`}
                key={m.key}
              >
                <div
                  className="bar-pair"
                  tabIndex={0}
                  aria-label={`${m.name}: הכנסות ${shekel(m.income)}, הוצאות ${shekel(m.expense)}, תזרים נטו ${shekel(m.net)}`}
                >
                  {m.income > 0 && (
                    <i
                      className="income-bar"
                      style={{ height: `${(m.income / ceiling) * 50}%` }}
                    />
                  )}
                  {m.expense > 0 && (
                    <i
                      className="expense-bar"
                      style={{ height: `${(m.expense / ceiling) * 50}%` }}
                    />
                  )}
                  {m.net !== 0 && (
                    <i
                      className={`net-bar ${m.net > 0 ? "positive" : "negative"}`}
                      style={{ height: `${(Math.abs(m.net) / ceiling) * 50}%` }}
                    />
                  )}
                  {!hidden && (
                    <div className="bar-tooltip">
                      <b>{m.name}</b>
                      <span>הכנסות {shekel(m.income)}</span>
                      <span>הוצאות {shekel(m.expense)}</span>
                      <span>תזרים נטו {shekel(m.net)}</span>
                    </div>
                  )}
                </div>
                <span>{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
function RecurringPayments({ data, providers, hidden }) {
  const today = bankDate(new Date());
  const recurring = useMemo(() => recurringPayments(data.transactions, data.accounts, providers, today), [data.transactions, data.accounts, providers, today]);
  const shownMoney = (value, currency) => hidden ? "••••••" : shekel(value, currency);
  const frequency = (months) => ({ 1: "חודשי", 2: "כל חודשיים", 12: "שנתי" })[months] || "טרם זוהתה";
  function evidence(row) {
    return <details className="recurring-evidence">
      <summary>לפי {row.evidence.length} חיובים</summary>
      <div>
        <p>{row.months ? `החיובים האחרונים הופיעו בתדירות ${frequency(row.months)}. מועד החידוש והעלות הם אומדן לפי החיוב האחרון.`
          : "אין מספיק חיובים במרווח קבוע כדי לקבוע תדירות. חיוב בודד אינו מוכיח מנוי שנתי."}</p>
        {row.variable && <p>הסכום משתנה: {shownMoney(row.minAmount, row.currency)}–{shownMoney(row.maxAmount, row.currency)}. האומדן משתמש בחיוב האחרון.</p>}
        <ul>{[...row.evidence].reverse().map((tx, index) => <li key={tx.id || index}><span>{formatDate(`${tx.date}T12:00:00Z`)}</span><bdi>{shownMoney(tx.amount, row.currency)}</bdi></li>)}</ul>
      </div>
    </details>;
  }
  function rowsTable(rows, uncertain = false) {
    return <div className="table-scroll"><table className="recurring-table">
      <thead><tr><th>בית עסק / שירות</th><th>תדירות</th><th>החיוב האחרון</th><th>עלות חודשית משוערת</th><th>החידוש הבא · אומדן</th><th>איך זוהה?</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        <td><strong>{row.description}</strong><small>{providers[row.account.provider]?.name || row.account.provider} · ••{row.account.number.slice(-4)}</small></td>
        <td><span className={`recurring-frequency ${uncertain ? "uncertain" : ""}`}>{frequency(row.months)}</span></td>
        <td><bdi>{shownMoney(row.amount, row.currency)}</bdi><small>{formatDate(`${row.lastDate}T12:00:00Z`)}</small></td>
        <td><bdi>{row.monthlyAmount === null ? "—" : shownMoney(row.monthlyAmount, row.currency)}</bdi></td>
        <td>{row.nextDate ? formatDate(`${row.nextDate}T12:00:00Z`) : "לא ידוע"}{row.overdue && <small className="recurring-overdue">טרם נראה חיוב נוסף</small>}</td>
        <td>{evidence(row)}</td>
      </tr>)}</tbody>
    </table></div>;
  }
  return <section className="panel recurring-panel" aria-label="מנויים וחיובים חוזרים">
    <div className="panel-heading"><div><h2><RefreshCw size={18} /> מנויים וחיובים חוזרים <span className="count">{recurring.detected.length}</span></h2>
      <p>חודשי, כל חודשיים ושנתי · זיהוי מקומי לפי כל היסטוריית החיובים שסונכרנה</p></div>
      <div className="recurring-total"><small>עלות חודשית משוערת</small>
        {recurring.totals.length ? recurring.totals.map((total) => <strong key={total.currency}><bdi>{shownMoney(total.amount, total.currency)}</bdi></strong>) : <strong>—</strong>}
      </div>
    </div>
    {recurring.detected.length ? rowsTable(recurring.detected) : <Empty icon={RefreshCw} title="עדיין לא זוהה דפוס של חיוב חוזר" description="הזיהוי דורש כמה חיובים במרווח קבוע. מנוי שנתי דורש שני חיובים בהפרש של כשנה; אפשר לסנכרן היסטוריה ארוכה יותר בהגדרות." />}
    {!!recurring.candidates.length && <details className="recurring-review"><summary>{recurring.candidates.length} שירותים ללא תדירות מזוהה · לבדיקה</summary>
      <p>חיובים שעשויים להיות מנויים או ביטוחים. אינם נכללים בעלות החודשית עד שיזוהה דפוס חוזר.</p>{rowsTable(recurring.candidates, true)}</details>}
    {!!recurring.inactive.length && <details className="recurring-review inactive"><summary>{recurring.inactive.length} דפוסים קודמים ללא חידוש בזמן · אינם נכללים בסכום</summary>
      <p>לא נמצא חיוב נוסף לאחר המועד הצפוי ותקופת חסד. ייתכן שהשירות הסתיים או שחסרה היסטוריה מסונכרנת.</p>{rowsTable(recurring.inactive)}</details>}
    <p className="recurring-note">העלות החודשית היא החיוב האחרון חלקי מספר החודשים במחזור. עסקאות בתשלומים, החזרי כספים וחיובי הסליקה של הכרטיס בבנק אינם נכללים. האומדן אינו מתווסף לתחזית התזרים.</p>
    {data.truncated && <p className="recurring-note">הזיהוי מתבסס על התנועות המוצגות בלבד; היסטוריה נוספת אינה כלולה בנתונים שנטענו.</p>}
  </section>;
}

function Spending({ transactions, hidden, periodLabel, providers }) {
  const [activeName, setActiveName] = useState(null);
  const [detailName, setDetailName] = useState(null);
  const tooltipId = useId();
  const detailId = useId();
  const closeDetails = () => { setActiveName(null); setDetailName(null); };
  useEffect(closeDetails, [periodLabel]);
  const categoryOf = (transaction) => transaction.category_source === "chatgpt" && transaction.category_description === transaction.description
    ? transaction.category : "טרם סווג עם ChatGPT";
  const charges = transactions.filter((transaction) => transaction.amount < 0 && transaction.currency === "ILS");
  const groups = {};
  charges.forEach((t) => {
    const category = categoryOf(t);
    groups[category] = (groups[category] || 0) - t.amount;
  });
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, x) => s + x[1], 0);
  const percentLabel = (value) => value / total < 0.001 ? "<0.1%"
    : new Intl.NumberFormat("he-IL", { style: "percent", maximumFractionDigits: 1 }).format(value / total);
  let offset = 0;
  const parts = sorted.map(([name, value]) => {
    const start = offset;
    offset += (value / (total || 1)) * 100;
    return { name, value, start, percent: (value / total) * 100, color: cardCategoryColor(name) };
  });
  const active = parts.find((part) => part.name === activeName);
  const detail = parts.find((part) => part.name === detailName);
  const detailTransactions = detail ? charges.filter((transaction) => categoryOf(transaction) === detail.name)
    .sort((a, b) => (b.processed_date || b.date).localeCompare(a.processed_date || a.date) || b.date.localeCompare(a.date)) : [];
  const arcPath = (start, percent) => {
    if (percent >= 100) return "M 50 8 A 42 42 0 1 1 50 92 A 42 42 0 1 1 50 8";
    const point = (part) => {
      const angle = (part / 100) * Math.PI * 2 - Math.PI / 2;
      return `${50 + 42 * Math.cos(angle)} ${50 + 42 * Math.sin(angle)}`;
    };
    return `M ${point(start)} A 42 42 0 ${percent > 50 ? 1 : 0} 1 ${point(start + percent)}`;
  };
  const interaction = (name) => ({
    onPointerEnter: () => { setActiveName(name); setDetailName(name); }, onPointerLeave: () => setActiveName(null),
    onFocus: () => { setActiveName(name); setDetailName(name); }, onBlur: () => setActiveName(null),
    onClick: () => { setActiveName(name); setDetailName(name); },
    onKeyDown: (event) => {
      if (["Enter", " ", "Escape"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "Escape") closeDetails();
        else { setActiveName(name); setDetailName(name); }
      }
    },
  });
  return (
    <section className="panel spending" aria-label="הוצאות אשראי לפי קטגוריות">
      <div className="panel-heading">
        <div>
          <h2>לאן הכסף הולך?</h2>
          <p>חיובי אשראי · {periodLabel} · קטגוריות ChatGPT · לפי מועד החיוב · שקלים</p>
        </div>
        <span className="little-icon">
          <ArrowUpLeft size={18} />
        </span>
      </div>
      {!total ? (
        <Empty
          icon={SlidersHorizontal}
          title="עוד אין חיובי אשראי בתקופה הזו"
          description="בחרו תקופה אחרת או סנכרנו כרטיסי אשראי. את הסיווג מפעילים בעמוד תנועות אשראי."
        />
      ) : (
        <>
          <div className="donut">
            <svg viewBox="0 0 100 100" role="group" aria-label="חלוקת חיובי האשראי לכל הקטגוריות">
              <circle cx="50" cy="50" r="42" className="donut-track" />
              {parts.map((part) => <path key={part.name} d={arcPath(part.start, part.percent)}
                className={`donut-segment ${activeName === part.name || detailName === part.name ? "active" : ""}`}
                stroke={part.color} role="button" tabIndex={0}
                aria-label={`${part.name} · ${percentLabel(part.value)}`} aria-describedby={activeName === part.name ? tooltipId : undefined}
                aria-expanded={detailName === part.name} aria-controls={detail ? detailId : undefined}
                data-category={part.name} data-start={part.start} data-percent={part.percent} data-amount={part.value} {...interaction(part.name)} />)}
            </svg>
            <div className="donut-center" onClick={closeDetails}>
              <small>סך חיובי האשראי</small>
              <strong dir="ltr">{hidden ? "••••••" : shekel(total)}</strong>
              <span>
                {charges.length}{" "}
                תנועות
              </span>
            </div>
            {active && <div className="donut-tooltip" id={tooltipId} role="tooltip">
              <strong>{active.name}</strong>
              <span><bdi>{percentLabel(active.value)}</bdi>{!hidden && <> · <bdi>{shekel(active.value)}</bdi></>}</span>
            </div>}
          </div>
          <div className="spending-legend">
            {parts.map(({ name, value, color }) => (
              <div key={name} className={activeName === name || detailName === name ? "active" : ""} role="button" tabIndex={0}
                aria-expanded={detailName === name} aria-controls={detail ? detailId : undefined}
                aria-label={`${name} · ${percentLabel(value)}`} aria-describedby={activeName === name ? tooltipId : undefined} {...interaction(name)}>
                <span>
                  <i style={{ background: color }} />
                  {name}
                </span>
                <b><bdi>{percentLabel(value)}</bdi></b>
                <em dir="ltr">{hidden ? "•••" : shekel(value)}</em>
              </div>
            ))}
          </div>
          {detail && <section className="spending-breakdown" id={detailId} aria-label={`תנועות שנכללו ב${detail.name}`}>
            <div className="spending-breakdown-heading"><div>
              <h3><i style={{ background: detail.color }} />{detail.name}</h3>
              <p>{detailTransactions.length} חיובים · {periodLabel}</p>
            </div><strong><bdi>{hidden ? "••••••" : shekel(detail.value)}</bdi></strong>
              <button className="icon-button" aria-label="סגירת פירוט הקטגוריה" onClick={closeDetails}><X size={15} /></button>
            </div>
            <ul>{detailTransactions.map((transaction) => <li key={transaction.id} data-transaction-id={transaction.id} data-amount={-transaction.amount}>
              <div><strong>{transaction.description}</strong>
                <small>חיוב: {formatDate(`${transaction.processed_date || transaction.date}T12:00:00Z`)}{transaction.processed_date && transaction.processed_date !== transaction.date ? ` · עסקה: ${formatDate(`${transaction.date}T12:00:00Z`)}` : ""}</small>
                <small>{providers[transaction.provider]?.name || transaction.provider} · ••{String(transaction.account_number || "").slice(-4)}{transaction.installment_number && transaction.installment_total ? ` · תשלום ${transaction.installment_number} מתוך ${transaction.installment_total}` : ""}</small>
              </div><bdi>{hidden ? "••••••" : shekel(-transaction.amount)}</bdi>
            </li>)}</ul>
            <p className="spending-breakdown-note">אלה כל החיובים שנכללו בפרוסה זו, לפי מועד החיוב בתקופה המוצגת.</p>
          </section>}
        </>
      )}
    </section>
  );
}
function ConnectionCard({
  connection: c,
  accounts,
  transactions,
  providers,
  jobs,
  lastRun,
  hidden,
  onSync,
  onDelete,
  onForget,
  showCardSelection = false,
  onCardEnabledChange,
  updatingCardId,
}) {
  const related = accounts.filter((a) =>
      a.connection_id === c.id && (showCardSelection || a.enabled !== false)),
    job = jobs.find((j) => j.connectionId === c.id),
    provider = providers[c.provider],
    failed = lastRun?.status === "failed" || (!lastRun && c.status === "failed");
  return (
    <article className="connection-card">
      <div className="connection-top">
        <Logo provider={c.provider} />
        <div>
          <strong>{provider?.name || c.provider}</strong>
          <span>{c.name}</span>
        </div>
        {onDelete ? (
          <button
            className="icon-button delete-connection"
            aria-label={`ניתוק ${c.name}`}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        ) : (
          <span
            className={`connection-status ${failed ? "failed" : c.synced_at ? "connected" : ""}`}
          >
            {failed ? <AlertCircle size={12} /> : c.synced_at ? <Check size={11} /> : <Clock3 size={11} />}
          </span>
        )}
      </div>
      {showCardSelection && provider?.kind === "card" && related.length > 0 && (
        <p className="card-import-help">בחרו אילו כרטיסים לייבא. כיבוי מוחק את התנועות של הכרטיס.</p>
      )}
      <div className="connection-value">
        {related.length ? (
          related.map((a) => {
            const enabled = a.enabled !== false;
            const creditUsageCard = ["isracard", "amex"].includes(c.provider);
            const payment = enabled && creditUsageCard
              ? nextKnownCardPayment(a, transactions, bankDate(new Date()))
              : null;
            const displayedAmount = enabled ? creditUsageCard ? payment?.amount : a.balance : null;
            return <div key={a.id} className={enabled ? "" : "card-import-disabled"}>
              <span>
                {provider?.kind === "card" ? "כרטיס אשראי" : "חשבון"}{" "}
                <bdi>••{a.number.slice(-4)}</bdi>
              </span>
              {showCardSelection && provider?.kind === "card" && (
                <label className="card-import-choice">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={!!updatingCardId || !!job}
                    onChange={(event) => onCardEnabledChange(a, event.target.checked)}
                  />
                  {enabled ? "לייבא כרטיס זה" : "לא לייבא כרטיס זה"}
                </label>
              )}
              {creditUsageCard && enabled && <span>חיוב קרוב לפי תנועות שסונכרנו</span>}
              <strong dir="ltr">
                {!enabled ? "לא מיובא" : Number.isFinite(displayedAmount)
                  ? hidden
                    ? "••••••"
                    : shekel(displayedAmount, a.currency)
                  : "—"}
              </strong>
              {creditUsageCard && enabled && (
                <span className="next-charge">
                  <CalendarDays size={12} />
                  {payment
                    ? `${payment.estimated ? "אומדן חלקי" : "חיוב מסונכרן"} · ${formatDate(`${payment.date}T12:00:00Z`)}`
                    : "אין חיוב עתידי מתוארך"}
                </span>
              )}
              {enabled && provider?.id === "visaCal" &&
                Number.isFinite(a.next_charge) &&
                (
                  <span className="next-charge">
                    <CalendarDays size={12} />
                    החיוב הבא: {hidden ? "••••••" : shekel(a.next_charge, a.currency)}
                    {a.next_charge_date &&
                      ` · ${formatDate(`${a.next_charge_date}T12:00:00`)}`}
                  </span>
                )}
            </div>;
          })
        ) : (
          <span className="no-account">
            {accounts.some((a) => a.connection_id === c.id)
              ? "לא נבחרו כרטיסים לייבוא"
              : failed ? "לא התקבלו נתונים מהסנכרון" : "מוכן לסנכרון הראשון"}
          </span>
        )}
      </div>
      <div className="connection-footer">
        <span>
          <span className={`mini-dot ${c.synced_at ? "green" : ""}`} />
          {job?.status === "waiting_mfa"
            ? "ממתין לאימות"
            : job
              ? "מסנכרן…"
              : failed
                ? "הסנכרון נכשל"
                : ago(c.synced_at)}
        </span>
        <button
          className="icon-button"
          disabled={!!job}
          aria-label={`סנכרון ${c.name}`}
          onClick={onSync}
        >
          {job ? <Spinner /> : <RefreshCw size={15} />}
        </button>
      </div>
      {failed && (
        <p className="connection-error">
          <AlertCircle size={14} />
          <span>{syncFailureMessage(c, lastRun)}</span>
        </p>
      )}
      {onForget && (
        <button className="text-button forget-button" onClick={onForget}>
          <KeyRound size={12} /> מחיקת פרטי כניסה שמורים
        </button>
      )}
    </article>
  );
}

function UpcomingCardCharges({ data, providers, hidden, onViewAll }) {
  const cardAccounts = data.accounts.filter((account) =>
    account.enabled !== false && providers[account.provider]?.kind === "card");
  const { charges, totals, unknownCount, partial } = upcomingCardCharges(
    cardAccounts, data.transactions, bankDate(new Date()),
  );
  return (
    <section className="panel upcoming-card-charges" aria-label="חיובים קרובים בכרטיסי האשראי">
      <div className="panel-heading">
        <div>
          <h2>חיובים קרובים בכרטיסי האשראי <span className="count">{charges.length}</span></h2>
          <p>החיוב הבא הידוע של כל כרטיס שנבחר לייבוא</p>
        </div>
        <button className="text-button" onClick={onViewAll}>
          לכל תנועות האשראי <ArrowLeft size={15} />
        </button>
      </div>
      {charges.length ? (
        <>
          <div className="upcoming-card-summary">
            <span>סך החיובים הקרובים הידועים</span>
            <div className="upcoming-card-totals">
              {totals.map(({ currency, amount }) => (
                <strong key={currency}><bdi>{hidden ? "••••••" : shekel(amount, currency)}</bdi></strong>
              ))}
            </div>
            {(partial || data.truncated) && (
              <small>אומדן חלקי: {unknownCount > 0 ? `${unknownCount} כרטיסים ללא חיוב עתידי ידוע. ` : ""}חיובים משוערים עשויים להשתנות.</small>
            )}
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>כרטיס</th><th>מועד חיוב</th><th>מקור הסכום</th><th className="amount-head">חיוב קרוב</th></tr></thead>
              <tbody>
                {charges.map(({ account, amount, date, estimated }) => (
                  <tr key={account.id}>
                    <td>
                      <div className="table-account">
                        <Logo provider={account.provider} size="tiny" />
                        <span>{providers[account.provider]?.name || account.provider}<small>••{account.number.slice(-4)}</small></span>
                      </div>
                    </td>
                    <td className="date-cell">{formatDate(date)}</td>
                    <td><span className={`status-pill ${estimated ? "projected" : ""}`}><i />{estimated ? "אומדן מתנועות" : "חיוב מסונכרן"}</span></td>
                    <td className="amount-cell"><bdi>{hidden ? "•••••" : shekel(amount, account.currency)}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty
          icon={CalendarDays}
          title={cardAccounts.length ? "אין חיובים עתידיים ידועים" : "אין כרטיסים מיובאים"}
          description={cardAccounts.length
            ? "לא נמצא חיוב מתוארך בסנכרון האחרון. הסכום עדיין לא ידוע."
            : "בחרו כרטיס לייבוא כדי לראות את החיוב הקרוב שלו."}
        />
      )}
    </section>
  );
}

function CardCategoryControls({ onDataChange, onAiConnect }) {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [refreshAll, setRefreshAll] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const refreshed = useRef("");
  const refreshData = useRef(onDataChange);
  refreshData.current = onDataChange;
  useEffect(() => {
    let mounted = true;
    let checking = false;
    async function load() {
      if (checking) return;
      checking = true;
      try {
        const value = await api("/ai/categorization");
        if (!mounted) return;
        setStatus(value);
        const job = value.job;
        if (job && ["completed", "failed"].includes(job.status) && job.updatedTransactions && refreshed.current !== job.id) {
          await refreshData.current?.();
          refreshed.current = job.id;
        }
      } catch (e) { if (mounted) setError(e.message); }
      finally { checking = false; }
    }
    load();
    api("/ai/status").then((value) => value.connected ? api("/ai/models") : [])
      .then((items) => { if (mounted) { setModels(items); setModel(items[0]?.id || ""); } })
      .catch((e) => mounted && setError(e.message));
    const interval = setInterval(load, 1500);
    return () => { mounted = false; clearInterval(interval); };
  }, []);
  const running = starting || status?.job?.status === "running";
  async function categorize(generalOnly = false) {
    setStarting(true); setError("");
    try {
      const job = await api("/ai/categorization", { method: "POST", body: { refresh: !generalOnly && refreshAll, generalOnly, model } });
      setStatus((previous) => ({ ...previous, job }));
    } catch (e) { setError(e.message); }
    finally { setStarting(false); }
  }
  return <div className="card-category-controls" aria-label="סיווג קטגוריות עם ChatGPT">
    <div><strong><Sparkles size={16} /> קטגוריות עם ChatGPT</strong>
      <p>הסיווג פועל רק בלחיצה. תיאורי בתי העסק נשלחים ל־OpenAI; לעסקים לא מוכרים מתבצע גם חיפוש ברשת. הסיווג והמקורות נשמרים אצלכם.</p>
      {status && <small>{status.pendingTransactions} תנועות ממתינות לסיווג מתוך {status.totalTransactions}
        {status.lastCategorizedAt ? ` · סיווג אחרון: ${syncDateFormat.format(new Date(status.lastCategorizedAt))}` : ""}</small>}
    </div>
    {status?.connected ? <div className="card-category-actions">
      <select value={model} onChange={(event) => setModel(event.target.value)} disabled={running} aria-label="מודל לסיווג קטגוריות">
        {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <label><input type="checkbox" checked={refreshAll} onChange={(event) => setRefreshAll(event.target.checked)} disabled={running} /> סיווג מחדש גם לתנועות שכבר סווגו</label>
      <button className="button white" onClick={() => categorize()} disabled={running || !model || !status.totalTransactions || (!refreshAll && !status.pendingTransactions)}>
        {running ? <Spinner /> : <Sparkles size={16} />} {running ? "מסווגים…" : "סיווג קטגוריות"}
      </button>
      <button className="button white" onClick={() => categorize(true)} disabled={running || !model || !status.generalTransactions}>בדיקה מחדש של כללי{status.generalTransactions ? ` (${status.generalTransactions})` : ""}</button>
    </div> : status && <button className="button white" onClick={onAiConnect}>חיבור ChatGPT לסיווג</button>}
    {status?.job && <div className="card-category-progress" role="status">
      {status.job.status === "running" ? `${status.job.stage === "researching" ? "בודקים בית עסק ברשת · " : ""}סווגו ${status.job.completedMerchants} מתוך ${status.job.totalMerchants} בתי עסק · עודכנו ${status.job.updatedTransactions} תנועות · הושלמו ${status.job.researchedMerchants || 0} בדיקות רשת`
        : status.job.status === "completed" ? `הסיווג הושלם · עודכנו ${status.job.updatedTransactions} תנועות` : status.job.error}
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

function CategoryBadge({ transaction: t }) {
  let sources = [];
  try { sources = JSON.parse(t.category_sources || "[]").filter((value) => {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  }); } catch { /* Older classifications have no sources. */ }
  const badge = <span className="category-pill" title={t.category_source === "chatgpt" ? "סווג עם ChatGPT" : undefined}>{t.category}{t.category_source === "chatgpt" && <Sparkles size={10} />}</span>;
  if (!t.category_explanation) return badge;
  return <details className="category-evidence">
    <summary aria-label={`פרטי הסיווג של ${t.description}`}>{badge}</summary>
    <div>
      <p>{t.category_explanation}</p>
      <small>ביטחון מדווח: {{ high: "גבוה", medium: "בינוני", low: "נמוך" }[t.category_confidence] || "לא צוין"} · {t.category_web_searched ? "נבדק ברשת" : "לפי תיאור בית העסק"}</small>
      {sources.map((url) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname} <ExternalLink size={11} /></a>)}
    </div>
  </details>;
}

function Transactions({
  data,
  providers,
  compact = false,
  hidden,
  onViewAll,
  sourceKind = "bank",
  onDataChange,
  onAiConnect,
}) {
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState(sourceKind),
    [billingMonth, setBillingMonth] = useState("all"),
    [connection, setConnection] = useState("all"),
    [category, setCategory] = useState("all"),
    [direction, setDirection] = useState("all"),
    [sort, setSort] = useState("desc"),
    [page, setPage] = useState(1);
  const sourceTransactions = useMemo(
    () =>
      data.transactions.filter((t) => providers[t.provider]?.kind === kind),
    [data.transactions, providers, kind],
  );
  const currentMonthStart = `${bankDate(new Date()).slice(0, 7)}-01`;
  const upcomingAccountPayments = data.accounts
    .filter((account) => providers[account.provider]?.kind === "card")
    .map((account) => account.next_charge_date)
    .filter((date) => typeof date === "string" && date >= bankDate(new Date()));
  const upcomingTransactionPayments = sourceTransactions
    .filter((transaction) => transaction.status !== "pending")
    .map((transaction) => transaction.processed_date)
    .filter((date) => typeof date === "string" && date >= bankDate(new Date()));
  const upcomingPaymentDate = (upcomingAccountPayments.length
    ? upcomingAccountPayments
    : upcomingTransactionPayments).sort()[0];
  const nextPaymentMonth = upcomingPaymentDate?.slice(0, 7) || null;
  const selectedBillingMonth = billingMonth === "next" ? nextPaymentMonth : billingMonth;
  const displayTransactions = useMemo(
    () => kind === "card" && !compact && selectedBillingMonth !== "all" && selectedBillingMonth
      ? [...sourceTransactions, ...projectedInstallmentsForMonth(sourceTransactions, selectedBillingMonth)]
      : sourceTransactions,
    [sourceTransactions, kind, compact, selectedBillingMonth],
  );
  const billingMonths = [
    ...Array.from({ length: 13 }, (_, index) => monthAfter(currentMonthStart, index)),
    ...[...new Set(sourceTransactions
      .map((transaction) => transaction.processed_date?.slice(0, 7))
      .filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month < currentMonthStart.slice(0, 7)))]
      .sort((a, b) => b.localeCompare(a))
      .map((month) => `${month}-01`),
  ];
  const categories = [...new Set(sourceTransactions.map((t) => t.category))];
  const panelTitle = compact
    ? "התנועות האחרונות בבנק"
    : kind === "bank" ? "תנועות בנק" : "תנועות בכרטיסי אשראי";
  const filtered = useMemo(
    () =>
      displayTransactions
        .filter(
          (t) =>
            (!search ||
              `${t.description} ${t.memo || ""}`
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (connection === "all" || t.connection_id === connection) &&
            (category === "all" || t.category === category) &&
            (kind !== "card" || selectedBillingMonth === "all" ||
              (t.status !== "pending" && t.processed_date?.slice(0, 7) === selectedBillingMonth)) &&
            (direction === "all" ||
              (direction === "income" ? t.amount > 0 : t.amount < 0)),
        )
        .sort((a, b) => {
          const aDate = kind === "card" && !compact ? a.processed_date || a.date : a.date;
          const bDate = kind === "card" && !compact ? b.processed_date || b.date : b.date;
          return (
          sort === "desc"
            ? bDate.localeCompare(aDate)
            : aDate.localeCompare(bDate)
          );
        }),
    [displayTransactions, search, connection, category, direction, sort, kind, selectedBillingMonth, compact],
  );
  const filteredTotals = useMemo(() => {
    const totals = new Map();
    for (const transaction of filtered) {
      const value = totals.get(transaction.currency) || { currency: transaction.currency, debits: 0, credits: 0, pending: 0, projected: 0 };
      if (transaction.projected || transaction.status === "projected") value.projected += Math.max(0, -transaction.amount);
      else if (transaction.status === "pending") value.pending += Math.max(0, -transaction.amount);
      else if (transaction.status === "completed") {
        value.debits += Math.max(0, -transaction.amount);
        value.credits += Math.max(0, transaction.amount);
      }
      totals.set(transaction.currency, value);
    }
    return [...totals.values()];
  }, [filtered]);
  useEffect(
    () => setPage(1),
    [search, connection, category, direction, sort, kind, billingMonth],
  );
  const pageSize = compact ? 5 : 10,
    totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    currentPage = Math.min(page, totalPages),
    rows = compact
      ? filtered.slice(0, 5)
      : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function download() {
    const esc = (v) =>
      `"${String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows = [
      kind === "card"
        ? ["תאריך חיוב", "תאריך עסקה", "תיאור", "חשבון", "קטגוריה", "סכום", "מטבע", "סטטוס"]
        : ["תאריך", "תיאור", "חשבון", "קטגוריה", "סכום", "מטבע", "סטטוס"],
      ...filtered.map((t) => [
        ...(kind === "card" ? [t.processed_date || ""] : []),
        t.date,
        t.description,
        t.connection_name,
        t.category,
        t.amount / 100,
        t.currency,
        t.projected ? "צפוי (אומדן)" : t.status,
      ]),
    ];
    const blob = new Blob(
      ["\ufeff", rows.map((r) => r.map(esc).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shklops-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <section
      className={`panel transactions ${compact ? "compact" : ""}`}
      aria-label={panelTitle}
    >
      <div className="panel-heading">
        <div>
          <h2>
            {panelTitle}{" "}
            <span className="count">
              {compact ? sourceTransactions.length : filtered.length}
            </span>
          </h2>
          <p>
            {compact
              ? kind === "bank"
                ? "חמש התנועות האחרונות מחשבונות הבנק"
                : "חמש התנועות האחרונות מכרטיסי האשראי"
              : "חפשו, סננו והורידו את הנתונים שלכם"}
          </p>
        </div>
        {compact ? (
          <button className="text-button" onClick={onViewAll}>
            {kind === "bank" ? "לכל תנועות הבנק" : "לכל תנועות האשראי"}{" "}
            <ArrowLeft size={15} />
          </button>
        ) : (
          <button
            className="button white"
            disabled={!filtered.length}
            onClick={download}
          >
            <Download size={16} /> ייצוא CSV
          </button>
        )}
      </div>
      {!compact && (
        <div className="transaction-source-tabs" role="tablist" aria-label="סוג התנועות">
          {[
            ["bank", "תנועות בנק"],
            ["card", "תנועות אשראי"],
          ].map(([source, label]) => (
            <button
              key={source}
              type="button"
              role="tab"
              aria-selected={kind === source}
              className={kind === source ? "active" : ""}
              onClick={() => {
                setKind(source);
                setConnection("all");
                setCategory("all");
                setBillingMonth("all");
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!compact && kind === "card" && <CardCategoryControls onDataChange={onDataChange} onAiConnect={onAiConnect} />}
      {!compact && (
        <div className="transaction-filters">
          <div className="search-input">
            <Search size={17} />
            <input
              placeholder="חיפוש בית עסק או תיאור…"
              aria-label="חיפוש תנועות"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {kind === "card" && (
            <select
              aria-label="חודש חיוב בכרטיס"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
            >
              <option value="all">כל מועדי החיוב</option>
              {nextPaymentMonth && (
                <option value="next">החיוב הבא · {formatMonth(`${nextPaymentMonth}-01`)}</option>
              )}
              {billingMonths.map((month) => (
                <option key={month} value={month.slice(0, 7)}>{formatMonth(month)}</option>
              ))}
            </select>
          )}
          <select
            aria-label="סינון לפי חשבון"
            value={connection}
            onChange={(e) => setConnection(e.target.value)}
          >
            <option value="all">כל החשבונות</option>
            {data.connections
              .filter(
                (c) => providers[c.provider]?.kind === kind,
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <select
            aria-label="סינון לפי קטגוריה"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">כל הקטגוריות</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="סינון לפי סוג תנועה"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="all">הכנסות והוצאות</option>
            <option value="income">הכנסות בלבד</option>
            <option value="expense">הוצאות בלבד</option>
          </select>
        </div>
      )}
      {!compact && kind === "card" && billingMonth !== "all" && (
        <p className="billing-filter-note">
          מוצגות תנועות עם תאריך חיוב מסונכרן ותשלומים עתידיים מחושבים. שורות המסומנות "צפוי" הן אומדן; הסכום והמועד עשויים להשתנות. תנועות בהמתנה או ללא תאריך חיוב אינן נכללות.
        </p>
      )}
      {!compact && kind === "card" && <section className="filtered-card-summary" aria-label="סיכום תנועות אשראי מסוננות">
        <div><strong>סיכום הסינון · {filtered.length} תנועות בכל העמודים</strong>
          <small>{selectedBillingMonth && selectedBillingMonth !== "all" ? `חודש חיוב: ${formatMonth(`${selectedBillingMonth}-01`)}` : "כל מועדי החיוב"}{category !== "all" ? ` · ${category}` : ""}</small>
        </div>
        <div className="filtered-card-totals">{filteredTotals.map((total) => <div key={total.currency}>
          <span className="filtered-debits">חיובים מסונכרנים <bdi>{hidden ? "••••••" : shekel(total.debits, total.currency)}</bdi></span>
          {total.credits > 0 && <span className="filtered-credits">זיכויים <bdi>{hidden ? "••••••" : shekel(total.credits, total.currency)}</bdi></span>}
          {total.pending > 0 && <span>חיובים בהמתנה <bdi>{hidden ? "••••••" : shekel(total.pending, total.currency)}</bdi></span>}
          {total.projected > 0 && <span>תשלומים צפויים · אומדן <bdi>{hidden ? "••••••" : shekel(total.projected, total.currency)}</bdi></span>}
        </div>)}</div>
      </section>}
      {data.truncated && (
        <p className="warning-text">
          מוצגות 10,000 התנועות האחרונות מתוך{" "}
          {data.total.toLocaleString("he-IL")}. גם הסיכומים והייצוא מתייחסים
          לנתונים המוצגים בלבד.
        </p>
      )}
      {rows.length ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>בית עסק / תיאור</th>
                  <th>
                    <button
                      onClick={() => setSort(sort === "desc" ? "asc" : "desc")}
                    >
                      {kind === "card" && !compact ? "תאריך חיוב" : "תאריך"}{" "}
                      <ChevronDown
                        size={12}
                        style={{
                          transform:
                            sort === "asc" ? "rotate(180deg)" : undefined,
                        }}
                      />
                    </button>
                  </th>
                  <th>חשבון</th>
                  <th>קטגוריה</th>
                  <th>סטטוס</th>
                  <th className="amount-head">סכום</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="merchant">
                        <span
                          className={`merchant-icon cat-${t.category === "הכנסה" ? "income" : t.category === "מזון וקניות" ? "food" : t.category === "תחבורה" ? "transport" : "other"}`}
                        >
                          {t.amount > 0 ? (
                            <ArrowDownLeft size={18} />
                          ) : t.category === "מזון וקניות" ? (
                            <Building2 size={18} />
                          ) : t.category === "תחבורה" ? (
                            <ArrowUpLeft size={18} />
                          ) : t.category === "מנויים" ? (
                            <RefreshCw size={17} />
                          ) : (
                            <CreditCard size={17} />
                          )}
                        </span>
                        <div>
                          <strong>{t.description}</strong>
                          {t.installment_number && t.installment_total && (
                            <small>תשלום {t.installment_number} מתוך {t.installment_total}</small>
                          )}
                          {t.memo && <small>{t.memo}</small>}
                        </div>
                      </div>
                    </td>
                    <td className="date-cell">
                      {kind === "card" && !compact
                        ? t.processed_date ? formatDate(t.processed_date) : "—"
                        : formatDate(t.date)}
                      {kind === "card" && !compact && (
                        <small>{t.projected ? "מועד משוער" : `עסקה: ${formatDate(t.date)}`}</small>
                      )}
                    </td>
                    <td>
                      <div className="table-account">
                        <Logo provider={t.provider} size="tiny" />
                        <span>
                          {providers[t.provider]?.name || t.provider}
                          <small>••{t.account_number.slice(-4)}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <CategoryBadge transaction={t} />
                    </td>
                    <td>
                      <span
                        className={`status-pill ${t.status === "pending" ? "pending" : t.projected ? "projected" : ""}`}
                      >
                        <i />
                        {t.projected ? "צפוי · אומדן" : t.status === "pending" ? "בהמתנה" : "הושלם"}
                      </span>
                    </td>
                    <td
                      className={`amount-cell ${t.amount > 0 ? "positive" : ""}`}
                    >
                      <bdi>
                        {hidden
                          ? "•••••"
                          : `${t.amount > 0 ? "+" : ""}${shekel(t.amount, t.currency)}`}
                      </bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!compact && (
            <div className="table-pagination">
              <span>
                מציגים {(currentPage - 1) * pageSize + 1}–
                {Math.min(currentPage * pageSize, filtered.length)} מתוך{" "}
                {filtered.length} תנועות
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label="עמוד קודם"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronRight size={17} />
                </button>
                <span>
                  {currentPage} / {totalPages}
                </span>
                <button
                  className="icon-button"
                  aria-label="עמוד הבא"
                  disabled={currentPage === totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronLeft size={17} />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Empty
          icon={Search}
          title={
            compact && !sourceTransactions.length
              ? kind === "bank"
                ? "אין תנועות בנק עדיין"
                : "אין תנועות בכרטיסי אשראי עדיין"
              : data.transactions.length
                ? "לא נמצאו תנועות תואמות"
                : "הסיפור הפיננסי שלכם מתחיל כאן"
          }
          description={
            data.transactions.length
              ? "נסו לשנות את החיפוש או את המסננים."
              : "חברו חשבון והפעילו סנכרון כדי לראות את התנועות."
          }
        />
      )}
    </section>
  );
}

function CredentialFields({ provider, disabled = false }) {
  return (
    <div className="credentials-fields">
      {provider?.fields.map((field) => (
        <label key={field}>
          {fieldLabels[field] || field}
          <input
            name={field}
            type={
              field === "password"
                ? "password"
                : field === "email"
                  ? "email"
                  : "text"
            }
            dir="ltr"
            autoComplete="off"
            required
            disabled={disabled}
            maxLength={1024}
            placeholder={
              field === "phoneNumber"
                ? "+972501234567"
                : field === "password"
                  ? "••••••••"
                  : ""
            }
          />
        </label>
      ))}
    </div>
  );
}
function ConnectionModal({ providers, user, live, onClose, onSaved }) {
  const [providerId, setProvider] = useState("hapoalim"),
    [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const provider = providers.find((p) => p.id === providerId);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.target);
    const credentials =
      !user.demo && live && remember
        ? Object.fromEntries(provider.fields.map((f) => [f, form.get(f)]))
        : {};
    try {
      await api("/connections", {
        method: "POST",
        body: {
          provider: providerId,
          name: form.get("name"),
          remember,
          credentials,
        },
      });
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="מחברים עוד חלק לתמונה"
      subtitle={
        user.demo
          ? "בחרו ספק כדי להוסיף חיבור לדוגמה. אין צורך בפרטי בנק."
          : "בחרו בנק או חברת אשראי. אפשר להזין פרטי כניסה בכל סנכרון."
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label>
          בנק או חברת אשראי
          <select
            value={providerId}
            onChange={(e) => setProvider(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          שם החיבור
          <input
            name="name"
            required
            maxLength={80}
            placeholder="למשל, החשבון המשותף"
          />
        </label>
        {provider?.mfa && (
          <div className="info-note compact-note">
            <ShieldCheck size={17} />
            <span>תומך באימות בקוד. חלון להזנת הקוד יופיע במהלך הסנכרון.</span>
          </div>
        )}
        {!user.demo && live && (
          <>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>שמירת פרטי הכניסה מוצפנים בשרת</span>
            </label>
            <small className="muted">
              ברירת המחדל היא הזנה מחדש בכל סנכרון. קודי אימות אינם נשמרים.
            </small>
            {remember && <CredentialFields provider={provider} />}
          </>
        )}
        {!user.demo && !live && (
          <div className="warning-text">
            הסריקה החיה אינה מופעלת בשרת זה. אפשר להכין חיבור ללא פרטי כניסה, או
            לצאת ולהיכנס להדגמה.
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Plus size={17} />} הוספת חשבון
          </button>
          <button type="button" className="button white" onClick={onClose}>
            ביטול
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CredentialsModal({ connection, provider, onSubmit, onClose }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      icon={KeyRound}
      title={`התחברות ל${provider?.name || connection.name}`}
      subtitle="הפרטים ישמשו לסנכרון הזה בלבד ולא יישמרו."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const credentials = Object.fromEntries(new FormData(e.target));
          setBusy(true);
          try {
            await onSubmit(credentials);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <CredentialFields provider={provider} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? <Spinner /> : <RefreshCw size={16} />} התחברות וסנכרון
        </button>
      </form>
    </Modal>
  );
}
function MfaModal({ job, demo, connection, onSubmit, onCancel }) {
  const [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    setCode("");
    setError("");
    setSubmitted(false);
  }, [job.challenge.id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil((job.challenge.expiresAt - now) / 1000),
  );
  return (
    <Modal
      icon={ShieldCheck}
      title="רק מוודאים שזה אתם"
      subtitle={`נדרש אימות נוסף עבור ${connection?.name || "החשבון שלכם"}. הסנכרון ממתין לכם כאן.`}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSubmit(code);
            setCode("");
            setSubmitted(true);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {demo ? (
          <div className="demo-mfa">
            <Sparkles size={18} />
            <span>
              זו הדגמה — לא נשלח SMS אמיתי. הזינו <b dir="ltr">123456</b> כדי
              לנסות את התהליך. אין בדיקה של הקוד מול בנק.
            </span>
          </div>
        ) : (
          <p className="mfa-instructions">
            הבנק שלח קוד לטלפון שמוגדר בחשבון. יש להזין את הקוד האחרון שהתקבל.
          </p>
        )}
        <label className="otp-label">
          קוד אימות חד־פעמי
          <input
            className="otp-input"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{4,10}"
            minLength={4}
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            dir="ltr"
            required
            placeholder="· · · · · ·"
            disabled={submitted}
          />
        </label>
        <div className="mfa-timer">
          <Clock3 size={14} /> הקוד יפוג בעוד{" "}
          <bdi>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </bdi>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          disabled={busy || submitted || seconds === 0}
        >
          {busy || submitted ? <Spinner /> : <ShieldCheck size={17} />}{" "}
          {submitted ? "ממשיכים בסנכרון…" : "אימות והמשך סנכרון"}
        </button>
        <button
          type="button"
          className="text-button mfa-cancel"
          onClick={onCancel}
        >
          ביטול הסנכרון
        </button>
        <small className="auth-note">
          <LockKeyhole size={13} /> קוד האימות אינו נשמר במסד הנתונים.
        </small>
      </form>
    </Modal>
  );
}
function AiAssistant({ userId }) {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const result = new URLSearchParams(window.location.search).get("ai");
    if (result) window.history.replaceState({}, "", window.location.pathname);
    if (result === "error") setError("חיבור ChatGPT לא הושלם. נסו שוב ובדקו שאישרתם שימוש בתוכנית.");
    api("/ai/status").then((value) => {
      if (!active) return;
      setStatus(value);
      if (value.error) setError(value.error.message);
      if (value.connected) return api("/ai/models").then((items) => {
        if (active) { setModels(items); setModel(items[0]?.id || ""); }
      });
    }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [userId]);
  async function connect(newAccount = false) {
    setBusy(true);
    setError("");
    try {
      const { url } = await api("/ai/connect", { method: "POST", body: { newAccount } });
      window.location.assign(url);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/ai/disconnect", { method: "POST", body: {} });
      setStatus({ connected: false, email: status?.email });
      setModels([]); setModel(""); setTurns([]);
      if (!result.revoked) setError("החיבור המקומי נותק, אך לא התקבל אישור ביטול מ־ChatGPT. אפשר לנתק גם בהגדרות ChatGPT.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function ask(event) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    try {
      const response = await api("/ai/ask", { method: "POST", body: {
        question: text, model, history: turns.slice(-4).map(({ question, answer }) => ({ question, answer })),
      } });
      setTurns((previous) => [...previous, { question: text, ...response }]);
      setQuestion("");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="panel ai-panel" aria-label="שאלו את שקלופס">
    <div className="panel-heading">
      <div><h2>שאלו את שקלופס</h2><p>שאלות על תנועות, הוצאות ותזרים — עם נתונים ודרך החישוב.</p></div>
      <span className="little-icon"><MessageCircle size={20} /></span>
    </div>
    <div className="ai-body">
      <div className="info-note"><ShieldCheck size={19} /><div>
        <strong>השאלות והתוצאות שנדרשות לתשובה נשלחות ל־OpenAI</strong>
        <p>פרטי הכניסה לבנק אינם נשלחים. החישובים נעשים בשרת Shklops, והמודל מקבל רק תוצאות של שאילתות קריאה מוגבלות.</p>
      </div></div>
      {status === null ? <Spinner /> : !status.connected ? <div className="ai-connect">
        <Sparkles size={27} />
        <h3>חברו את תוכנית ChatGPT שלכם</h3>
        <p>החיבור נעשה בדפדפן דרך OpenAI. השימוש כפוף לזמינות ולמגבלות התוכנית שלכם.</p>
        <button className="button primary" disabled={busy} onClick={() => connect()}>
          {busy ? <Spinner /> : <ExternalLink size={17} />} המשך עם ChatGPT
        </button>
        {status.email && <button className="text-button" disabled={busy} onClick={() => connect(true)}>חיבור חשבון ChatGPT אחר</button>}
      </div> : <>
        <div className="ai-toolbar">
          <span><CheckCircle2 size={16} /> מחובר ל־ChatGPT{status.email ? ` · ${status.email}` : ""}</span>
          <label>מודל
            <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="מודל ChatGPT">
              {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button className="text-button" disabled={busy} onClick={disconnect}>ניתוק ChatGPT</button>
        </div>
        <div className="ai-turns" aria-live="polite">
          {!turns.length && <div className="ai-suggestions">
            <p>למשל:</p>
            {["כמה הוצאתי בבנק החודש?", "מהם חיובי הכרטיסים הידועים לחודש הבא?", "איך חושבה תחזית התזרים לחודש הבא?"].map((sample) =>
              <button key={sample} onClick={() => setQuestion(sample)}>{sample}</button>)}
          </div>}
          {turns.map((turn, index) => <div className="ai-turn" key={index}>
            <div className="ai-question">{turn.question}</div>
            <div className="ai-answer">{turn.answer}</div>
            <details><summary>הנתונים ששימשו לתשובה</summary>
              <AiSources sources={turn.sources} />
            </details>
          </div>)}
        </div>
        <form className="ai-form" onSubmit={ask}>
          <input aria-label="השאלה שלכם" value={question} onChange={(event) => setQuestion(event.target.value)}
            maxLength={1000} placeholder="מה תרצו לדעת על הכסף שלכם?" disabled={busy || !model} />
          <button className="button primary" disabled={busy || !model || !question.trim()}>
            {busy ? <Spinner /> : <ArrowLeft size={17} />} שליחה
          </button>
        </form>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <small className="ai-usage">אפשר לבדוק ולנהל את מגבלת השימוש ב־<a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noreferrer">הגדרות ChatGPT</a>.</small>
    </div>
  </section>;
}

function AiSources({ sources }) {
  const showMoney = (value, currency = "ILS") => value == null ? "לא ידוע" : shekel(Math.round(value * 100), currency);
  return <div className="ai-sources">{sources.map(({ data }, index) => {
    if (data.error) return <p key={index}>לא התקבלו נתונים עבור חלק מהבקשה.</p>;
    const values = data.estimatedClosingBalance !== undefined ? [
      ["יתרה נוכחית בבנק", data.openingBankBalance],
      ["הכנסה חודשית", data.monthlyIncome],
      ["משכנתא", data.recurringMortgage],
      ["חיובי כרטיסים ידועים", data.knownCardCharges],
      ["יתרה צפויה", data.estimatedClosingBalance],
    ] : data.bankIncome !== undefined ? [
      ["זיכויים בבנק", data.bankIncome], ["חיובים בבנק", data.bankExpenses],
      ["תזרים נטו בבנק", data.bankNet], ["קניות בכרטיסי אשראי", data.cardPurchases],
    ] : null;
    return <div key={index}>
      <strong>{data.month ? formatMonth(`${data.month}-01`) : `${data.start} – ${data.end}`}</strong>
      {values && <dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><bdi>{showMoney(value)}</bdi></dd></div>)}</dl>}
      {data.partial && <p>זהו אומדן חלקי לפי הנתונים הזמינים. חיובים נוספים עשויים לשנות אותו.</p>}
      {data.cardBreakdown?.map((card, cardIndex) => <p key={cardIndex}>
        כרטיס {card.card}: <bdi>{card.source === "unknown" ? "לא ידוע" : showMoney(card.amount)}</bdi>
        {card.date ? ` · ${formatDate(card.date)}` : ""}
      </p>)}
      {data.transactions && <>
        {data.completedTotals?.map((total, totalIndex) => <p key={totalIndex}>
          {total.source === "bank" ? "בנק" : "כרטיסי אשראי"}: חיובים <bdi>{showMoney(total.debits, total.currency)}</bdi>
          {" · "}זיכויים <bdi>{showMoney(total.credits, total.currency)}</bdi> · תנועות שהושלמו בלבד
        </p>)}
        <p>{data.truncated ? "מוצגות עד 30 תנועות תואמות." : `${data.totalMatches} תנועות תואמות`}</p>
        <div className="ai-source-table"><table><thead><tr><th>תאריך</th><th>תיאור</th><th>חשבון / כרטיס</th><th>סכום</th></tr></thead>
          <tbody>{data.transactions.map((transaction) => <tr key={transaction.id}>
            <td>{formatDate(transaction.date)}</td><td>{transaction.description}</td><td>{transaction.cardOrAccount}</td>
            <td><bdi>{showMoney(transaction.amount, transaction.currency)}</bdi></td>
          </tr>)}</tbody></table></div>
      </>}
    </div>;
  })}</div>;
}

function Settings({
  tab,
  setTab,
  settings,
  setSettings,
  user,
  live,
  data,
  providers,
  jobs,
  latestRuns,
  updatingCardId,
  onCardEnabledChange,
  onConnectionSync,
  onDelete,
  onForget,
  onConnect,
  notify,
  onError,
}) {
  const [draft, setDraft] = useState(settings),
    [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <div className="settings-layout">
      <div className="settings-nav">
        {[
          ["sync", RefreshCw, "העדפות סנכרון"],
          ["accounts", Wallet, "חשבונות וכרטיסים"],
          ["security", ShieldCheck, "אבטחה וחשבון"],
          ["architecture", Database, "אחסון והתחברות"],
        ].map(([id, Icon, name]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={18} />
            {name}
            <ChevronLeft size={15} />
          </button>
        ))}
      </div>
      <div className="panel settings-panel">
        {tab === "sync" && (
          <>
            <div className="panel-heading">
              <div>
                <h2>בדיוק כמו שמתאים לכם</h2>
                <p>ההעדפות יחולו על הסנכרון הבא</p>
              </div>
              <span className="little-icon">
                <SlidersHorizontal size={20} />
              </span>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                try {
                  const result = await api("/settings", {
                    method: "PUT",
                    body: draft,
                  });
                  setSettings(result);
                  notify("ההעדפות נשמרו");
                } catch (e) {
                  onError(e.message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <div className="setting-row">
                <div>
                  <strong>כמה אחורה לסנכרן?</strong>
                  <p>טווח התנועות שייבקש הסורק מהבנק. הזמינות תלויה בספק.</p>
                </div>
                <select
                  aria-label="טווח סנכרון"
                  value={draft.daysBack}
                  onChange={(e) =>
                    setDraft({ ...draft, daysBack: Number(e.target.value) })
                  }
                >
                  {[30, 60, 90, 180, 365, 730].map((days) => (
                    <option key={days} value={days}>
                      {days} ימים אחורה
                    </option>
                  ))}
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>הכנסה חודשית קבועה</strong>
                  <p>
                    הסכום החודשי נטו יתווסף לתחזית התזרים. הזינו 0 כדי להשאיר את
                    התחזית כבויה.
                  </p>
                </div>
                <label className="setting-income">
                  <span>₪</span>
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    step="0.01"
                    aria-label="הכנסה חודשית קבועה"
                    value={(draft.monthlyIncome || 0) / 100}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        monthlyIncome: Math.max(
                          0,
                          Math.round(Number(e.target.value || 0) * 100),
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <div className="setting-row">
                <div>
                  <strong>איחוד עסקאות בתשלומים</strong>
                  <p>בקשה להציג תשלומים כעסקה אחת, כשנתמך על ידי הסורק.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.combineInstallments}
                  aria-label="איחוד עסקאות בתשלומים"
                  className={`switch ${draft.combineInstallments ? "on" : ""}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      combineInstallments: !draft.combineInstallments,
                    })
                  }
                >
                  <span />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>סנכרון ידני</strong>
                  <p>הסנכרון מתחיל בלחיצה שלכם. אין תזמון אוטומטי בגרסה זו.</p>
                </div>
                <span className="tiny-pill">בשליטתכם</span>
              </div>
              <div className="setting-row">
                <div>
                  <strong>אימות נוסף</strong>
                  <p>
                    כש־ONE ZERO מבקש קוד, חלון אימות ייפתח אוטומטית. חלון
                    הסנכרון ממתין עד שתי דקות.
                  </p>
                </div>
                <ShieldCheck size={24} className="purple-text" />
              </div>
              <div className="settings-save">
                <span>
                  <CheckCheck size={15} /> נשמר רק בחשבון שלכם
                </span>
                <button className="button primary" disabled={saving}>
                  {saving ? <Spinner /> : <Check size={17} />} שמירת שינויים
                </button>
              </div>
            </form>
          </>
        )}
        {tab === "accounts" && (
          <>
            <div className="panel-heading">
              <div>
                <h2>הבנקים והכרטיסים שלכם</h2>
                <p>ניהול חיבורים, סנכרון ובחירת כרטיסים לייבוא</p>
              </div>
              <Wallet size={23} />
            </div>
            <div className="settings-body settings-accounts-body">
              <div className="info-note">
                <ShieldCheck size={19} />
                <div>
                  <strong>החיבור משמש לקריאת נתונים בלבד</strong>
                  <p>הסנכרון לא מבצע העברות או תשלומים. ייתכן שהבנק יבקש קוד אימות במהלך ההתחברות.</p>
                </div>
              </div>
              <div className="connection-grid settings-connection-grid">
                {data.connections.map((connection) => (
                  <ConnectionCard
                    key={connection.id}
                    connection={connection}
                    accounts={data.accounts}
                    transactions={data.transactions}
                    providers={providers}
                    jobs={jobs}
                    lastRun={latestRuns.get(connection.id)}
                    showCardSelection
                    updatingCardId={updatingCardId}
                    onCardEnabledChange={onCardEnabledChange}
                    onSync={() => onConnectionSync(connection)}
                    onDelete={() => onDelete(connection)}
                    onForget={connection.remembered ? () => onForget(connection) : null}
                  />
                ))}
                <button className="add-account-tile large" onClick={onConnect}>
                  <span><Plus size={24} /></span>
                  <strong>מחברים חשבון נוסף</strong>
                  <small>בחרו בנק או חברת אשראי</small>
                </button>
              </div>
            </div>
          </>
        )}
        {tab === "security" && (
          <>
            <div className="panel-heading">
              <div>
                <h2>החשבון והפרטיות שלכם</h2>
                <p>ההגדרות בפועל של סביבת ההרצה הזו</p>
              </div>
              <ShieldCheck size={24} />
            </div>
            <div className="settings-body">
              <div className="security-user">
                <span className="avatar">{user.name.slice(0, 1)}</span>
                <div>
                  <strong>{user.name}</strong>
                  <p>{user.demo ? "משתמש הדגמה נפרד" : user.email}</p>
                </div>
                <span className="tiny-pill">
                  {user.demo ? "נתונים בדויים" : "חשבון מקומי"}
                </span>
              </div>
              {[
                [
                  LockKeyhole,
                  "כניסה עם סיסמה",
                  "סיסמאות משתמשים מגובבות ב־scrypt. הסשן נשמר בעוגייה מסוג HttpOnly, ולא ב־localStorage.",
                ],
                [
                  KeyRound,
                  "פרטי בנק",
                  "ברירת המחדל: לא נשמרים. אם בוחרים לזכור אותם, הם מוצפנים ב־AES-256-GCM בשרת.",
                ],
                [
                  Fingerprint,
                  "קודי אימות",
                  "קוד OTP נשלח רק לריצת הסנכרון הנוכחית. הוא אינו נכתב למסד או להיסטוריה.",
                ],
                [
                  Server,
                  "מצב סריקה חיה",
                  live
                    ? "מופעל בשרת. סנכרון אמיתי דורש פרטי כניסה וגישה ליעדי הבנק."
                    : "כבוי. ההדגמה פועלת על נתונים בדויים ואינה פונה לבנקים.",
                ],
              ].map(([Icon, title, text]) => (
                <div className="security-row" key={title}>
                  <Icon size={21} />
                  <div>
                    <strong>{title}</strong>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "architecture" && (
          <>
            <div className="panel-heading">
              <div>
                <h2>איך כדאי להפעיל את זה?</h2>
                <p>המלצת אחסון והתחברות לאתר עם כמה משתמשים</p>
              </div>
              <Database size={24} />
            </div>
            <div className="settings-body">
              <div className="recommendation">
                <span className="eyebrow">ההמלצה לפריסה אמיתית</span>
                <h3>Supabase + שרת סנכרון נפרד</h3>
                <p>
                  Supabase Postgres לתנועות ולחשבונות, Supabase Auth לכניסה,
                  ו־Node עם Chromium לסנכרון הבנקים.
                </p>
                <div className="recommend-grid">
                  <div>
                    <Database size={21} />
                    <strong>Postgres</strong>
                    <p>נתונים עם user_id, הרשאות RLS, גיבויים והצפנת דיסק.</p>
                  </div>
                  <div>
                    <Fingerprint size={21} />
                    <strong>Supabase Auth</strong>
                    <p>
                      אימייל וקוד / קישור כניסה, Google, ו־TOTP כאימות נוסף.
                    </p>
                  </div>
                  <div>
                    <KeyRound size={21} />
                    <strong>מנהל סודות</strong>
                    <p>
                      מפתח KMS מחוץ למסד. פרטי בנק מוצפנים; OTP בזיכרון בלבד.
                    </p>
                  </div>
                  <div>
                    <RefreshCw size={21} />
                    <strong>עובד סנכרון</strong>
                    <p>
                      תור Redis / BullMQ עם בעלות על משימה, זמן קצוב וניקוי
                      הדפדפן.
                    </p>
                  </div>
                </div>
              </div>
              <div className="info-note">
                <AlertCircle size={19} />
                <div>
                  <strong>מה עובד כאן עכשיו?</strong>
                  <p>
                    SQLite מקומי וסשנים נפרדים לכל משתמש. חיבור Supabase, כניסת
                    Google, גיבויים ופריסה בענן עדיין אינם מוגדרים. כל אלה
                    מפורטים במסמך הפריסה בפרויקט.
                  </p>
                </div>
              </div>
              <p className="muted architecture-note">
                משימות סנכרון עם Chromium זקוקות לשרת או Container ארוך־חיים.
                אין להריץ אותן ישירות בדפדפן או בפונקציה עם זמן ריצה קצר.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
