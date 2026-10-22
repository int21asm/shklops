import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bankDate } from "../shared/calendar.js";
import { formatMoney as shekel } from "../shared/currency.js";
import { cardForecastForMonth, monthlyCashflow, mortgageEstimateForMonth, nextKnownCardPayment, projectedInstallmentsForMonth } from "../shared/forecast.js";
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
  accounts: "חשבונות וכרטיסים",
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
  const [page, setPage] = useState("dashboard"),
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
    [hidden, setHidden] = useState(false),
    [help, setHelp] = useState(false),
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
  function navigate(target, kind = "bank") {
    if (target === "transactions") setTransactionsKind(kind);
    setPage(target);
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
        <small className="nav-caption">ניווט</small>
        <nav>
          {[
            [LayoutDashboard, "dashboard"],
            [ArrowRight, "transactions"],
            [Wallet, "accounts"],
            [Settings2, "settings"],
          ].map(([Icon, key]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => navigate(key)}
            >
              <Icon size={20} />
              <span>{labels[key]}</span>
              {key === "accounts" && <b>{data.connections.length}</b>}
              {page === key && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <Sparkles size={21} />
            </span>
            <strong>התמונה המלאה מתחילה כאן</strong>
            <p>חברו את כל החשבונות וגלו לאן הכסף שלכם הולך.</p>
            <button onClick={() => setModal({ type: "connect" })}>
              חיבור חשבון נוסף <ArrowUpLeft size={15} />
            </button>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={18} /> עזרה ומידע
          </button>
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
                    : page === "accounts"
                      ? "הבנקים וכרטיסי האשראי שמחוברים למרחב שלכם."
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
              {page !== "settings" && (
                <button
                  className="button primary"
                  onClick={
                    page === "accounts"
                      ? () => setModal({ type: "connect" })
                      : syncAll
                  }
                  disabled={active.length > 0}
                >
                  {active.length ? (
                    <Spinner />
                  ) : page === "accounts" ? (
                    <Plus size={17} />
                  ) : (
                    <RefreshCw size={16} />
                  )}{" "}
                  {active.length
                    ? "מסנכרנים…"
                    : page === "accounts"
                      ? "חיבור חשבון חדש"
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
                <Spending transactions={visibleTransactions} hidden={hidden} />
              </div>
              <CashflowForecast
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
                {["bank", "card"].map((kind) => (
                  <Transactions
                    key={kind}
                    sourceKind={kind}
                    data={data}
                    providers={providerMap}
                    compact
                    hidden={hidden}
                    onViewAll={() => navigate("transactions", kind)}
                  />
                ))}
              </div>
            </>
          )}
          {page === "transactions" && (
            <Transactions
              key={transactionsKind}
              sourceKind={transactionsKind}
              data={data}
              providers={providerMap}
            />
          )}
          {page === "accounts" && (
            <>
              <div className="info-note">
                <ShieldCheck size={19} />
                <div>
                  <strong>החיבור משמש לקריאת נתונים בלבד</strong>
                  <p>
                    הסנכרון לא מבצע העברות או תשלומים. ייתכן שהבנק יבקש קוד
                    אימות במהלך ההתחברות.
                  </p>
                </div>
              </div>
              <div className="connection-grid">
                {data.connections.map((c) => (
                  <ConnectionCard
                    key={c.id}
                    connection={c}
                    accounts={data.accounts}
                    transactions={data.transactions}
                    providers={providerMap}
                    jobs={active}
                    lastRun={latestRuns.get(c.id)}
                    showCardSelection
                    updatingCardId={updatingCardId}
                    onCardEnabledChange={changeCardEnabled}
                    onSync={() => requestConnectionSync(c)}
                    onDelete={() => setModal({ type: "delete", connection: c })}
                    onForget={
                      c.remembered
                        ? async () => {
                            try {
                              await api(`/connections/${c.id}/forget`, {
                                method: "POST",
                                body: {},
                              });
                              await refresh();
                              setToast("פרטי הכניסה נמחקו");
                            } catch (e) {
                              setError(e.message);
                            }
                          }
                        : null
                    }
                  />
                ))}
                <button
                  className="add-account-tile large"
                  onClick={() => setModal({ type: "connect" })}
                >
                  <span>
                    <Plus size={24} />
                  </span>
                  <strong>מחברים חשבון נוסף</strong>
                  <small>בחרו בנק או חברת אשראי</small>
                </button>
              </div>
            </>
          )}
          {page === "settings" && (
            <Settings
              settings={settings}
              setSettings={setSettings}
              user={user}
              live={live}
              onConnect={() => setModal({ type: "connect" })}
              onAccounts={() => navigate("accounts")}
              notify={setToast}
              onError={setError}
            />
          )}
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
      {help && (
        <Modal
          title="נעים להכיר, Shklops"
          icon={CircleHelp}
          subtitle="מרחב אחד שמרכז מידע פיננסי מבנקים וכרטיסי אשראי בישראל."
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <p>
              חברו חשבון, הפעילו סנכרון, וקבלו את התנועות בסקירה ובטבלה. כשסורק
              הבנק תומך בכך, בקשת אימות תופיע אוטומטית ותאפשר להזין קוד.
            </p>
            <p>
              אימות קוד זמין כרגע ב־ONE ZERO. בנקים אחרים עשויים לדרוש פעולה
              באתר הבנק; האפליקציה תציג הודעת כישלון במקום להניח שהסנכרון הצליח.
            </p>
            <p>
              האתר מבוסס על ספריית <b>israeli-bank-scrapers</b> ומושפע מפרויקט כספיון המקורי.
              זהו פרויקט עצמאי, ללא שיוך לבנקים.
            </p>
            <button
              className="button primary"
              onClick={() => {
                setHelp(false);
                navigate("settings");
              }}
            >
              להגדרות ואבטחה <ArrowLeft size={15} />
            </button>
          </div>
        </Modal>
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
  if (!monthlyIncome) missing.push("הכנסה חודשית קבועה בהגדרות");
  if (mortgage === null)
    missing.push('חיוב "טפחות - לווים" בחודש הקודם');
  const ready = missing.length === 0;
  const cashflow = monthlyCashflow({
    income: ready ? monthlyIncome : null,
    mortgage,
    cardPayments,
    cardComplete: !forecastPartial,
  });
  const projected = cashflow.amount;
  const shownMoney = (value) => hidden ? "••••••" : shekel(value);
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
    `הכנסה חודשית: ${monthlyIncome ? shownMoney(monthlyIncome) : "לא הוגדרה"}`,
    `פחות משכנתא: ${mortgage === null ? "לא ידועה" : shownMoney(mortgage)}`,
    `פחות חיובי כרטיסים שזוהו: ${forecastPartial && cardPayments === 0 ? "לא ידועים" : shownMoney(cardPayments)}`,
    `תוצאה ל־${formatMonth(selectedMonth)}: ${projected === null ? "לא ניתן לחשב" : shownMoney(projected)}${forecastPartial ? " · אומדן חלקי" : ""}`,
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
        <div className={`forecast-result ${forecastPartial ? "partial" : ""}`} tabIndex={0} aria-label="פירוט חישוב התזרים">
          <span>{forecastPartial ? "תזרים לפי חיובים זמינים בלבד" : "תזרים נטו בחודש"} <CircleHelp className="forecast-help-icon" size={13} aria-hidden="true" /></span>
          <strong
            className={
              projected === null || forecastPartial
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
              ? forecastPartial
                ? projected === null
                  ? "אין סכום חיוב עתידי ידוע לכרטיסים בחודש זה, ולכן לא ניתן לחשב תזרים אמין."
                  : "תרחיש חלקי: חסר סכום חיוב מסונכרן לחלק מהכרטיסים. התזרים בפועל עלול להיות נמוך יותר."
                : "הכנסה חודשית פחות משכנתא וחיובי כרטיסים לחודש שנבחר."
              : `כדי להציג תחזית, צריך להשלים: ${missing.join(" · ")}.`}
          </p>
          <ForecastTooltip items={resultExplanation} />
        </div>
        <div className="forecast-breakdown">
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
          כל חודש מחושב בנפרד: הכנסה פחות משכנתא וחיובי כרטיסים של אותו חודש.
          לחודשים ללא חיוב כולל מסונכרן נכללים רק חיובים עתידיים ותשלומים ידועים.
          יתרת הבנק והוצאות אחרות אינן כלולות.
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
function Spending({ transactions, hidden }) {
  const palette = ["#6955df", "#9681f0", "#b7a5f3", "#d6caf7", "#e9e2fa"];
  const groups = {};
  transactions
    .filter((t) => t.amount < 0 && t.currency === "ILS")
    .forEach((t) => {
      groups[t.category] = (groups[t.category] || 0) - t.amount;
    });
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]),
    top = sorted.slice(0, 4);
  if (sorted.length > 4)
    top.push(["אחר", sorted.slice(4).reduce((s, x) => s + x[1], 0)]);
  const total = top.reduce((s, x) => s + x[1], 0);
  let offset = 0;
  const parts = top.map(([name, value], i) => {
    const start = offset;
    offset += (value / (total || 1)) * 100;
    return `${palette[i]} ${start}% ${offset}%`;
  });
  return (
    <section className="panel spending">
      <div className="panel-heading">
        <div>
          <h2>לאן הכסף הולך?</h2>
          <p>התפלגות ההוצאות בחשבונות הבנק בתקופה</p>
        </div>
        <span className="little-icon">
          <ArrowUpLeft size={18} />
        </span>
      </div>
      {!total ? (
        <Empty
          icon={SlidersHorizontal}
          title="עוד אין הוצאות בתקופה הזו"
          description="אחרי סנכרון, תראו כאן את החלוקה לקטגוריות."
        />
      ) : (
        <>
          <div
            className="donut"
            style={{ background: `conic-gradient(${parts.join(",")})` }}
          >
            <div>
              <small>סך ההוצאות</small>
              <strong dir="ltr">{hidden ? "••••••" : shekel(total)}</strong>
              <span>
                {
                  transactions.filter(
                    (t) => t.amount < 0 && t.currency === "ILS",
                  ).length
                }{" "}
                תנועות
              </span>
            </div>
          </div>
          <div className="spending-legend">
            {top.map(([name, value], i) => (
              <div key={name}>
                <span>
                  <i style={{ background: palette[i] }} />
                  {name}
                </span>
                <b>
                  {Math.round((value / total) * 100)}
                  <small>%</small>
                </b>
                <em dir="ltr">{hidden ? "•••" : shekel(value)}</em>
              </div>
            ))}
          </div>
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

function Transactions({
  data,
  providers,
  compact = false,
  hidden,
  onViewAll,
  sourceKind = "bank",
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
    ? kind === "bank"
      ? "התנועות האחרונות בבנק"
      : "התנועות האחרונות בכרטיסי האשראי"
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
                      <span className="category-pill">{t.category}</span>
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
function Settings({
  settings,
  setSettings,
  user,
  live,
  onConnect,
  onAccounts,
  notify,
  onError,
}) {
  const [tab, setTab] = useState("sync"),
    [draft, setDraft] = useState(settings),
    [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <div className="settings-layout">
      <div className="settings-nav">
        {[
          ["sync", RefreshCw, "העדפות סנכרון"],
          ["connections", Link2, "חיבורים"],
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
                  {[30, 60, 90, 180, 365].map((days) => (
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
        {tab === "connections" && (
          <>
            <div className="panel-heading">
              <div>
                <h2>הבנקים והכרטיסים שלכם</h2>
                <p>כל חיבור מקבל סנכרון נפרד והיסטוריית תנועות משלו.</p>
              </div>
              <Link2 size={23} />
            </div>
            <div className="settings-body">
              <div className="info-note">
                <Landmark size={22} />
                <p>
                  ניתן לחבר בנקים וחברות אשראי שנתמכים ב־israeli-bank-scrapers.
                  חיבור שהוסף לא נחשב מסונכרן עד שהבנק מחזיר נתונים.
                </p>
              </div>
              <div className="modal-actions">
                <button className="button primary" onClick={onConnect}>
                  <Plus size={17} /> חיבור חשבון חדש
                </button>
                <button className="button white" onClick={onAccounts}>
                  ניהול החיבורים
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
