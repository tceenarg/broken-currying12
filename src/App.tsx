import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

/* =======================
   TYPES
======================= */
type OpType = "AL" | "SAT";
type Operation = {
  id: string;
  fon: string;
  tip: OpType;
  pay: number;
  fiyat: number; // işlem fiyatı
  tarih: string; // YYYY-MM-DD
};

type PortfolioDoc = {
  ops: Operation[];
  prices: Record<string, number>; // fon -> güncel fiyat (sayısal)
};

/* =======================
   HELPERS
======================= */
function uid() {
  try {
    // @ts-ignore
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymKey(d: string) {
  return (d || "").slice(0, 7); // YYYY-MM
}

function cleanFon(v: string) {
  return (v ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function parseNumberTR(s: string) {
  // "1,23" / "1.23" / "1 234,56" gibi
  const t = (s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function allowDecimalInput(raw: string) {
  // sadece rakam, virgül, nokta, eksi kalsın
  return (raw ?? "").replace(/[^\d,.\-]/g, "");
}

function n2(x: number) {
  return Number.isFinite(x) ? x.toFixed(2) : "-";
}
function n4(x: number) {
  return Number.isFinite(x) ? x.toFixed(4) : "-";
}

/* =======================
   SIMPLE CHARTS (SVG)
======================= */
function LineChartSVG({
  data,
  height = 260,
  titleLeft,
  titleRight,
  isPercent = false,
}: {
  data: { x: string; y: number }[];
  height?: number;
  titleLeft?: string;
  titleRight?: string;
  isPercent?: boolean;
}) {
  const W = 1000;
  const H = height;
  const PAD = 34;

  if (!data.length) {
    return (
      <div className="emptyBox" style={{ height }}>
        <div className="emptyTitle">Veri yok</div>
        <div className="emptySub">İşlem ekle + fiyat gir.</div>
      </div>
    );
  }

  const ys = data.map((d) => d.y).filter((y) => Number.isFinite(y));
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const x = (i: number) =>
    PAD + (i * (W - PAD * 2)) / Math.max(1, data.length - 1);
  const y = (v: number) => {
    if (maxY === minY) return H / 2;
    const t = (v - minY) / (maxY - minY);
    return H - PAD - t * (H - PAD * 2);
  };

  const pts = data.map((d, i) => `${x(i)},${y(d.y)}`).join(" ");
  const last = data[data.length - 1]?.y;

  return (
    <div className="chartWrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="chart">
        <defs>
          <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(120,180,255,0.40)" />
            <stop offset="100%" stopColor="rgba(120,180,255,0.00)" />
          </linearGradient>
        </defs>

        <line
          x1={PAD}
          y1={H - PAD}
          x2={W - PAD}
          y2={H - PAD}
          className="axis"
        />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="axis" />

        <polyline
          points={pts}
          className="lineGlow"
          fill="none"
          strokeWidth={8}
        />
        <polyline points={pts} className="line" fill="none" strokeWidth={3} />
        <polyline
          points={`${PAD},${H - PAD} ${pts} ${W - PAD},${H - PAD}`}
          fill="url(#areaGrad)"
          stroke="none"
        />

        <text x={PAD} y={PAD - 10} className="chartText">
          {titleLeft ??
            `min/max: ${n2(minY)}${isPercent ? "%" : ""} / ${n2(maxY)}${
              isPercent ? "%" : ""
            }`}
        </text>
        <text x={W - PAD} y={PAD - 10} textAnchor="end" className="chartText">
          {titleRight ?? `son: ${n2(last)}${isPercent ? "%" : ""}`}
        </text>
      </svg>
    </div>
  );
}

function BarChartSVG({
  data,
  height = 220,
  suffix = "₺",
}: {
  data: { x: string; y: number }[];
  height?: number;
  suffix?: string;
}) {
  const W = 1000;
  const H = height;
  const PAD = 34;

  if (!data.length) {
    return (
      <div className="emptyBox" style={{ height }}>
        <div className="emptyTitle">Veri yok</div>
        <div className="emptySub">Satış yaptıysan burada çıkar.</div>
      </div>
    );
  }

  const ys = data.map((d) => d.y);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const range = maxY - minY || 1;

  const zeroY = H - PAD - ((0 - minY) / range) * (H - PAD * 2);
  const barW = (W - PAD * 2) / data.length;

  return (
    <div className="chartWrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="chart">
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} className="axis" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="axis" />

        {data.map((d, i) => {
          const x0 = PAD + i * barW + barW * 0.18;
          const w = barW * 0.64;
          const v = d.y;
          const yv = H - PAD - ((v - minY) / range) * (H - PAD * 2);
          const top = Math.min(yv, zeroY);
          const h = Math.abs(zeroY - yv);
          const isPos = v >= 0;

          return (
            <rect
              key={d.x + i}
              x={x0}
              y={top}
              width={w}
              height={h}
              rx={10}
              className={isPos ? "barPos" : "barNeg"}
            />
          );
        })}

        <text x={PAD} y={PAD - 10} className="chartText">
          min/max: {n2(minY)}
          {suffix} / {n2(maxY)}
          {suffix}
        </text>
      </svg>
    </div>
  );
}

/* =======================
   LOGIN
======================= */
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function giris() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e: any) {
      setMsg(e?.message || "Giriş hatası");
    } finally {
      setBusy(false);
    }
  }

  async function kayit() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await createUserWithEmailAndPassword(auth, email, pass);
    } catch (e: any) {
      setMsg(e?.message || "Kayıt hatası");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <style>{css}</style>

      <div className="login">
        <div className="brand">
          <div className="dot" />
          <div>
            <div className="brandTitle">FonAnaliz</div>
            <div className="brandSub">minimal • futuristik • tek kullanıcı</div>
          </div>
        </div>

        <div className="field">
          <label>Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="mail@ornek.com"
          />
        </div>

        <div className="field">
          <label>Şifre</label>
          <input
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="••••••••"
            type="password"
          />
        </div>

        <div className="row">
          <button className="btn primary" onClick={giris} disabled={busy}>
            {busy ? "..." : "Giriş"}
          </button>
          <button className="btn ghost" onClick={kayit} disabled={busy}>
            {busy ? "..." : "Kayıt Ol"}
          </button>
        </div>

        {msg && <div className="msg">{msg}</div>}
        <div className="hint">Firebase Auth → Email/Password açık olmalı.</div>
      </div>
    </div>
  );
}

/* =======================
   DASHBOARD
======================= */
function Dashboard({ user }: { user: User }) {
  const [ops, setOps] = useState<Operation[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({}); // input için string draft
  const [loading, setLoading] = useState(true);

  const [toast, setToast] = useState("");
  const toastTimer = useRef<any>(null);

  // işlem formu (string tutuyoruz, virgül yazılsın)
  const [fon, setFon] = useState("HOY");
  const [tip, setTip] = useState<OpType>("AL");
  const [payStr, setPayStr] = useState("100");
  const [fiyatStr, setFiyatStr] = useState("1,0000");
  const [tarih, setTarih] = useState(todayYMD());

  // csv import
  const [importText, setImportText] = useState("");

  // charts
  const [period, setPeriod] = useState<"1A" | "3A" | "1Y" | "Tümü">("1Y");
  const [pnlMode, setPnlMode] = useState<"Günlük" | "Aylık">("Aylık");

  // bulk modal
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<Record<string, string>>({});

  function notify(s: string) {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }

  async function saveDoc(
    nextOps: Operation[],
    nextPrices: Record<string, number>
  ) {
    const ref = doc(db, "portfolios", user.uid);
    await setDoc(ref, { ops: nextOps, prices: nextPrices }, { merge: true });
  }

  async function loadDoc() {
    setLoading(true);
    try {
      const ref = doc(db, "portfolios", user.uid);
      const snap = await getDoc(ref);
      const d = snap.exists() ? (snap.data() as any) : null;

      const loaded: PortfolioDoc = d
        ? { ops: d.ops || [], prices: d.prices || {} }
        : { ops: [], prices: {} };

      const loadedOps: Operation[] = (loaded.ops || []).map((o: any) => ({
        id: String(o.id || uid()),
        fon: cleanFon(String(o.fon || "")),
        tip: (o.tip === "SAT" ? "SAT" : "AL") as OpType,
        pay: Number(o.pay || 0),
        fiyat: Number(o.fiyat || 0),
        tarih: String(o.tarih || todayYMD()),
      }));

      const loadedPrices: Record<string, number> = loaded.prices || {};

      setOps(loadedOps);
      setPrices(loadedPrices);

      // input draft'larını doldur
      const dDraft: Record<string, string> = {};
      for (const [k, v] of Object.entries(loadedPrices)) {
        if (typeof v === "number" && Number.isFinite(v))
          dDraft[k] = String(v).replace(".", ",");
      }
      setPriceDraft(dDraft);
    } catch (e: any) {
      notify(e?.message || "Firestore yükleme hatası");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  const funds = useMemo(() => {
    const s = new Set<string>();
    ops.forEach((o) => o.fon && s.add(o.fon));
    return Array.from(s).sort();
  }, [ops]);

  // bulk modal açılınca draft'ı doldur
  useEffect(() => {
    if (!bulkOpen) return;
    const d: Record<string, string> = {};
    funds.forEach((f) => {
      const v = prices[f];
      d[f] =
        typeof v === "number" && Number.isFinite(v)
          ? String(v).replace(".", ",")
          : priceDraft[f] ?? "";
    });
    setBulkDraft(d);
  }, [bulkOpen, funds, prices, priceDraft]);

  /* --------- holdings + avg cost + realized by fund --------- */
  const perFund = useMemo(() => {
    const by: Record<
      string,
      { pay: number; cost: number; avg: number; realized: number }
    > = {};
    const sorted = [...ops].sort((a, b) =>
      a.tarih > b.tarih ? 1 : a.tarih < b.tarih ? -1 : 0
    );

    for (const o of sorted) {
      if (!o.fon) continue;
      if (!by[o.fon]) by[o.fon] = { pay: 0, cost: 0, avg: 0, realized: 0 };
      const s = by[o.fon];

      if (o.tip === "AL") {
        s.pay += o.pay;
        s.cost += o.pay * o.fiyat;
        s.avg = s.pay > 0 ? s.cost / s.pay : 0;
      } else {
        const sellQty = Math.min(o.pay, s.pay);
        const avgBefore = s.pay > 0 ? s.cost / s.pay : 0;
        s.realized += sellQty * (o.fiyat - avgBefore);
        s.pay -= sellQty;
        s.cost -= sellQty * avgBefore;
        s.avg = s.pay > 0 ? s.cost / s.pay : 0;
      }
    }
    return by;
  }, [ops]);

  const rows = useMemo(() => {
    return Object.entries(perFund)
      .map(([fon, s]) => {
        const cur = prices[fon];
        const has = typeof cur === "number" && Number.isFinite(cur);
        const value = has ? s.pay * cur : null;
        const unreal = value === null ? null : value - s.cost;
        const totalPnL = unreal === null ? null : unreal + s.realized;
        const pct =
          totalPnL === null || s.cost <= 0 ? null : (totalPnL / s.cost) * 100;

        return {
          fon,
          pay: s.pay,
          cost: s.cost,
          avg: s.avg,
          realized: s.realized,
          cur: has ? cur : undefined,
          value,
          totalPnL,
          pct,
        };
      })
      .sort((a, b) => a.fon.localeCompare(b.fon));
  }, [perFund, prices]);

  const totals = useMemo(() => {
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalValue = rows.reduce((s, r) => s + (r.value ?? 0), 0);
    const anyPrice = rows.some((r) => typeof r.cur === "number");
    const realized = rows.reduce((s, r) => s + r.realized, 0);
    const pnl = anyPrice ? totalValue - totalCost + realized : null;
    const pct = pnl === null || totalCost <= 0 ? null : (pnl / totalCost) * 100;
    return { totalCost, totalValue, realized, pnl, pct, anyPrice };
  }, [rows]);

  /* --------- equity curve from position changes (uses current prices) --------- */
  const equitySeries = useMemo(() => {
    if (!ops.length) return [];
    const sortedOps = [...ops].sort((a, b) =>
      a.tarih > b.tarih ? 1 : a.tarih < b.tarih ? -1 : 0
    );
    const datesAll = Array.from(new Set(sortedOps.map((o) => o.tarih))).sort();

    let dates = datesAll;
    const now = new Date();
    const within = (d: string, days: number) => {
      const dt = new Date(d + "T00:00:00");
      if (isNaN(dt.getTime())) return false;
      return now.getTime() - dt.getTime() <= days * 86400000;
    };
    if (period === "1A") dates = datesAll.filter((d) => within(d, 30));
    if (period === "3A") dates = datesAll.filter((d) => within(d, 90));
    if (period === "1Y") dates = datesAll.filter((d) => within(d, 365));
    if (!dates.length) dates = datesAll;

    const holdings: Record<string, number> = {};
    let idx = 0;
    const out: { x: string; y: number }[] = [];

    for (const d of dates) {
      while (idx < sortedOps.length && sortedOps[idx].tarih <= d) {
        const o = sortedOps[idx];
        holdings[o.fon] =
          (holdings[o.fon] || 0) + (o.tip === "AL" ? o.pay : -o.pay);
        idx++;
      }
      let total = 0;
      let used = false;
      for (const f of Object.keys(holdings)) {
        const sh = holdings[f] || 0;
        if (!sh) continue;
        const pr = prices[f];
        if (typeof pr === "number" && Number.isFinite(pr)) {
          total += sh * pr;
          used = true;
        }
      }
      if (used) out.push({ x: d, y: total });
    }

    if (out.length > 220) {
      const step = Math.ceil(out.length / 220);
      return out.filter((_, i) => i % step === 0);
    }
    return out;
  }, [ops, prices, period]);

  /* --------- drawdown from equity --------- */
  const drawdownSeries = useMemo(() => {
    if (!equitySeries.length) return [];
    let peak = -Infinity;
    return equitySeries.map((p) => {
      peak = Math.max(peak, p.y);
      const dd = peak > 0 ? (p.y - peak) / peak : 0; // <=0
      return { x: p.x, y: dd * 100 }; // %
    });
  }, [equitySeries]);

  const maxDrawdown = useMemo(() => {
    if (!drawdownSeries.length) return 0;
    return Math.min(...drawdownSeries.map((d) => d.y));
  }, [drawdownSeries]);

  /* --------- realized PnL by date (sales only) --------- */
  const realizedByDate = useMemo(() => {
    const sorted = [...ops].sort((a, b) =>
      a.tarih > b.tarih ? 1 : a.tarih < b.tarih ? -1 : 0
    );
    const st: Record<string, { pay: number; cost: number }> = {};
    const pnlDay: Record<string, number> = {};

    for (const o of sorted) {
      if (!st[o.fon]) st[o.fon] = { pay: 0, cost: 0 };
      const s = st[o.fon];

      if (o.tip === "AL") {
        s.pay += o.pay;
        s.cost += o.pay * o.fiyat;
      } else {
        const sellQty = Math.min(o.pay, s.pay);
        const avg = s.pay > 0 ? s.cost / s.pay : 0;
        const pnl = sellQty * (o.fiyat - avg);
        pnlDay[o.tarih] = (pnlDay[o.tarih] || 0) + pnl;
        s.pay -= sellQty;
        s.cost -= sellQty * avg;
      }
    }
    return pnlDay;
  }, [ops]);

  const pnlBars = useMemo(() => {
    const keys = Object.keys(realizedByDate).sort();
    if (!keys.length) return [];

    if (pnlMode === "Günlük") {
      let ks = keys;
      const now = new Date();
      const within = (d: string, days: number) => {
        const dt = new Date(d + "T00:00:00");
        if (isNaN(dt.getTime())) return false;
        return now.getTime() - dt.getTime() <= days * 86400000;
      };
      if (period === "1A") ks = keys.filter((k) => within(k, 30));
      if (period === "3A") ks = keys.filter((k) => within(k, 90));
      if (period === "1Y") ks = keys.filter((k) => within(k, 365));
      if (!ks.length) ks = keys;

      const arr = ks.map((k) => ({ x: k, y: realizedByDate[k] }));
      if (arr.length > 60) {
        const step = Math.ceil(arr.length / 60);
        return arr.filter((_, i) => i % step === 0);
      }
      return arr;
    }

    // Monthly
    const m: Record<string, number> = {};
    for (const k of keys) {
      const mk = ymKey(k);
      m[mk] = (m[mk] || 0) + realizedByDate[k];
    }
    let mk = Object.keys(m).sort();
    if (period === "1A") mk = mk.slice(Math.max(0, mk.length - 1));
    if (period === "3A") mk = mk.slice(Math.max(0, mk.length - 3));
    if (period === "1Y") mk = mk.slice(Math.max(0, mk.length - 12));
    return mk.map((k) => ({ x: k, y: m[k] }));
  }, [realizedByDate, pnlMode, period]);

  /* =======================
     ACTIONS
  ======================= */
  async function addOp() {
    const f = cleanFon(fon);
    const payClean = allowDecimalInput(payStr);
    const fiyatClean = allowDecimalInput(fiyatStr);

    const p = parseNumberTR(payClean);
    const pr = parseNumberTR(fiyatClean);

    if (!f) return notify("Fon kodu yaz");
    if (!tarih) return notify("Tarih seç");
    if (!Number.isFinite(p) || p <= 0) return notify("Pay yanlış");
    if (!Number.isFinite(pr) || pr < 0) return notify("Fiyat yanlış");

    const next = [...ops, { id: uid(), fon: f, tip, pay: p, fiyat: pr, tarih }];
    setOps(next);
    try {
      await saveDoc(next, prices);
      notify("İşlem eklendi ✅");
    } catch (e: any) {
      notify(e?.message || "Kaydetme hatası");
    }
  }

  async function delOp(id: string) {
    const next = ops.filter((x) => x.id !== id);
    setOps(next);
    try {
      await saveDoc(next, prices);
    } catch {}
  }

  // fiyat inputu: ekranda string tut, parse olursa kaydet
  async function setOnePriceDraft(code: string, raw: string) {
    const v = allowDecimalInput(raw);
    setPriceDraft((p) => ({ ...p, [code]: v }));

    const t = v.trim();
    const next = { ...prices };

    if (!t) {
      delete next[code];
      setPrices(next);
      try {
        await saveDoc(ops, next);
      } catch {}
      return;
    }

    const n = parseNumberTR(t);
    if (!Number.isFinite(n)) return; // yazarken saçma ara değerlerde kaydetme
    next[code] = n;
    setPrices(next);
    try {
      await saveDoc(ops, next);
    } catch {}
  }

  async function bulkApply() {
    const next: Record<string, number> = { ...prices };
    const nextDraft: Record<string, string> = { ...priceDraft };

    for (const f of funds) {
      const raw = allowDecimalInput(bulkDraft[f] ?? "");
      nextDraft[f] = raw;

      const t = raw.trim();
      if (!t) {
        delete next[f];
        continue;
      }
      const n = parseNumberTR(t);
      if (Number.isFinite(n)) next[f] = n;
    }

    setPrices(next);
    setPriceDraft(nextDraft);

    try {
      await saveDoc(ops, next);
      notify("Fiyatlar kaydedildi ✅");
    } catch (e: any) {
      notify(e?.message || "Fiyat kaydetme hatası");
    }
    setBulkOpen(false);
  }

  function exportCSV() {
    const header = "tarih,fon,tip,pay,fiyat\n";
    const body = [...ops]
      .sort((a, b) => (a.tarih > b.tarih ? 1 : a.tarih < b.tarih ? -1 : 0))
      .map((o) => `${o.tarih},${o.fon},${o.tip},${o.pay},${o.fiyat}`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fonanaliz_ops.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseCSVToOps(text: string): Operation[] {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return [];

    const delim = lines[0].includes(";") ? ";" : ",";
    const head = lines[0].toLowerCase();
    const hasHeader =
      head.includes("tarih") ||
      head.includes("date") ||
      head.includes("fon") ||
      head.includes("tip");
    const startIdx = hasHeader ? 1 : 0;

    const out: Operation[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i].split(delim).map((x) => x.trim());
      if (parts.length < 5) continue;
      const [t, f, tp, py, pr] = parts;
      const tarih = (t || "").slice(0, 10);
      const fon = cleanFon(f);
      const tip = (
        String(tp).toUpperCase().includes("SAT") ? "SAT" : "AL"
      ) as OpType;
      const pay = parseNumberTR(allowDecimalInput(py));
      const fiyat = parseNumberTR(allowDecimalInput(pr));
      if (!fon || !tarih || !Number.isFinite(pay) || !Number.isFinite(fiyat))
        continue;
      out.push({ id: uid(), tarih, fon, tip, pay, fiyat });
    }
    return out;
  }

  async function importCSV() {
    const incoming = parseCSVToOps(importText);
    if (!incoming.length)
      return notify("CSV okunamadı. Format: tarih,fon,tip,pay,fiyat");
    const next = [...ops, ...incoming];
    setOps(next);
    setImportText("");
    try {
      await saveDoc(next, prices);
      notify(`İçe aktarıldı ✅ (${incoming.length} satır)`);
    } catch (e: any) {
      notify(e?.message || "Import kaydetme hatası");
    }
  }

  async function clearAll() {
    if (!window.confirm("Tüm işlemler silinsin mi?")) return;
    const next: Operation[] = [];
    setOps(next);
    try {
      await saveDoc(next, prices);
      notify("Temizlendi ✅");
    } catch {}
  }

  async function onFilePick(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setImportText(text);
    notify("Dosya yüklendi. Şimdi İçe Aktar’a bas.");
  }

  /* =======================
     UI
  ======================= */
  return (
    <div className="app">
      <style>{css}</style>
      {toast && <div className="toast">{toast}</div>}

      <header className="topbar">
        <div className="topLeft">
          <div className="dot" />
          <div>
            <div className="topTitle">FonAnaliz</div>
            <div className="topSub">{user.email} • manuel fiyat • hızlı</div>
          </div>
        </div>
        <div className="topRight">
          <button className="btn ghost" onClick={() => setBulkOpen(true)}>
            Toplu Fiyat Gir
          </button>
          <button className="btn ghost" onClick={exportCSV}>
            CSV Export
          </button>
          <button className="btn danger" onClick={() => signOut(auth)}>
            Çıkış
          </button>
        </div>
      </header>

      <main className="container">
        {/* KPIs */}
        <section className="kpis">
          <div className="kpi">
            <div className="kpiLabel">Toplam Maliyet</div>
            <div className="kpiVal">{n2(totals.totalCost)} ₺</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Gerçekleşen K/Z</div>
            <div className={`kpiVal ${totals.realized >= 0 ? "pos" : "neg"}`}>
              {n2(totals.realized)} ₺
            </div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Toplam K/Z</div>
            <div
              className={`kpiVal ${
                totals.pnl !== null && totals.pnl >= 0 ? "pos" : "neg"
              }`}
            >
              {totals.pnl === null
                ? "Fiyat yok"
                : `${n2(totals.pnl)} ₺ (${n2(totals.pct ?? 0)}%)`}
            </div>
          </div>
        </section>

        {/* Period selector */}
        <section className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">Zaman Aralığı</div>
              <div className="cardSub">Grafikler aynı aralığı kullanır</div>
            </div>
            <div className="pillRow" style={{ margin: 0 }}>
              {(["1A", "3A", "1Y", "Tümü"] as const).map((p) => (
                <button
                  key={p}
                  className={`pill ${period === p ? "on" : ""}`}
                  onClick={() => setPeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {!totals.anyPrice && (
            <div className="hintRow">
              Grafik ve değerler için fonlara <b>manuel güncel fiyat</b> gir
              (Toplu Fiyat Gir).
            </div>
          )}
        </section>

        {/* Equity chart */}
        <section className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">Portföy Değeri</div>
              <div className="cardSub">
                Mevcut fiyatla (pozisyon değişimine göre)
              </div>
            </div>
          </div>
          <LineChartSVG
            data={equitySeries}
            height={260}
            titleLeft="Portföy Değeri"
            titleRight={
              equitySeries.length
                ? `son: ${n2(equitySeries[equitySeries.length - 1].y)} ₺`
                : ""
            }
          />
        </section>

        {/* Drawdown */}
        <section className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">Drawdown</div>
              <div className="cardSub">Zirveden düşüş (%)</div>
            </div>
            <div className="chip">
              max DD: <b className="neg">{n2(maxDrawdown)}%</b>
            </div>
          </div>
          <LineChartSVG
            data={drawdownSeries}
            height={240}
            titleLeft="Drawdown (%)"
            isPercent
          />
        </section>

        {/* Daily/Monthly PnL */}
        <section className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">Kâr/Zarar</div>
              <div className="cardSub">Satışlardan gerçekleşen (realized)</div>
            </div>
            <div className="pillRow" style={{ margin: 0 }}>
              {(["Günlük", "Aylık"] as const).map((m) => (
                <button
                  key={m}
                  className={`pill ${pnlMode === m ? "on" : ""}`}
                  onClick={() => setPnlMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <BarChartSVG data={pnlBars} height={220} suffix="₺" />
          <div className="hintRow" style={{ marginTop: 10 }}>
            Not: Bu tablo <b>satış kâr/zararı</b>. (AL işlemleri tek başına kâr
            üretmez)
          </div>
        </section>

        {/* Add operation */}
        <section className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">İşlem Ekle</div>
              <div className="cardSub">
                Virgül ile yaz: 1,23 (klavye sorununu bypass eder)
              </div>
            </div>
            <div className="topRight">
              <button className="btn ghost" onClick={clearAll}>
                Portföyü Temizle
              </button>
            </div>
          </div>

          <div className="formGrid">
            <div className="field">
              <label>Fon</label>
              <input
                value={fon}
                onChange={(e) => setFon(e.target.value)}
                placeholder="HOY"
              />
            </div>

            <div className="field">
              <label>Tip</label>
              <select
                value={tip}
                onChange={(e) => setTip(e.target.value as OpType)}
              >
                <option value="AL">Alış</option>
                <option value="SAT">Satış</option>
              </select>
            </div>

            <div className="field">
              <label>Pay</label>
              <input
                value={payStr}
                onChange={(e) => setPayStr(allowDecimalInput(e.target.value))}
                inputMode="text"
                placeholder="100"
              />
            </div>

            <div className="field">
              <label>İşlem Fiyatı</label>
              <input
                value={fiyatStr}
                onChange={(e) => setFiyatStr(allowDecimalInput(e.target.value))}
                inputMode="text"
                placeholder="1,2345"
              />
            </div>

            <div className="field">
              <label>Tarih</label>
              <input
                value={tarih}
                onChange={(e) => setTarih(e.target.value)}
                type="date"
              />
            </div>

            <div className="field">
              <label>&nbsp;</label>
              <button className="btn primary" onClick={addOp}>
                Ekle
              </button>
            </div>
          </div>
        </section>

        {/* Funds table */}
        <section className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">Fonlar</div>
              <div className="cardSub">
                Güncel fiyat gir → anında değer & K/Z
              </div>
            </div>
          </div>

          {loading ? (
            <div className="muted">Yükleniyor…</div>
          ) : rows.length === 0 ? (
            <div className="muted">Henüz işlem yok.</div>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fon</th>
                    <th className="r">Pay</th>
                    <th className="r">Ort. Maliyet</th>
                    <th className="r">Maliyet</th>
                    <th className="r">Güncel Fiyat</th>
                    <th className="r">Değer</th>
                    <th className="r">Realized</th>
                    <th className="r">Toplam K/Z</th>
                    <th className="r">%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r0) => (
                    <tr key={r0.fon}>
                      <td className="mono">{r0.fon}</td>
                      <td className="r">{r0.pay}</td>
                      <td className="r">{n4(r0.avg)}</td>
                      <td className="r">{n2(r0.cost)} ₺</td>
                      <td className="r">
                        <input
                          className="miniInput"
                          placeholder="1,2345"
                          inputMode="text"
                          value={priceDraft[r0.fon] ?? ""}
                          onChange={(e) =>
                            setOnePriceDraft(r0.fon, e.target.value)
                          }
                        />
                      </td>
                      <td className="r">
                        {r0.value === null ? "—" : `${n2(r0.value)} ₺`}
                      </td>
                      <td className={`r ${r0.realized >= 0 ? "pos" : "neg"}`}>
                        {n2(r0.realized)} ₺
                      </td>
                      <td
                        className={`r ${
                          r0.totalPnL !== null && r0.totalPnL >= 0
                            ? "pos"
                            : "neg"
                        }`}
                      >
                        {r0.totalPnL === null ? "—" : `${n2(r0.totalPnL)} ₺`}
                      </td>
                      <td
                        className={`r ${
                          r0.pct !== null && r0.pct >= 0 ? "pos" : "neg"
                        }`}
                      >
                        {r0.pct === null ? "—" : `${n2(r0.pct)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="hintRow">
                Toplu girmek için sağ üstten <b>Toplu Fiyat Gir</b>.
              </div>
            </div>
          )}
        </section>

        {/* CSV Import */}
        <section className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">CSV İçe Aktar</div>
              <div className="cardSub">
                Format: <span className="mono">tarih,fon,tip,pay,fiyat</span>
              </div>
            </div>
            <div className="topRight">
              <label
                className="btn ghost"
                style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
              >
                Dosya Seç
                <input
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={(e) => onFilePick(e.target.files?.[0] || null)}
                />
              </label>
              <button className="btn primary" onClick={importCSV}>
                İçe Aktar
              </button>
            </div>
          </div>

          <textarea
            className="ta"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={`tarih,fon,tip,pay,fiyat
2025-01-10,HOY,AL,100,1,00
2025-02-03,HOY,SAT,20,1,20`}
          />
        </section>

        {/* Operations */}
        <section className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">İşlemler</div>
              <div className="cardSub">Kayıtların</div>
            </div>
          </div>

          {ops.length === 0 ? (
            <div className="muted">Henüz işlem yok.</div>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Fon</th>
                    <th>Tip</th>
                    <th className="r">Pay</th>
                    <th className="r">Fiyat</th>
                    <th className="r">Tutar</th>
                    <th className="r">Sil</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ops]
                    .sort((a, b) =>
                      a.tarih > b.tarih ? -1 : a.tarih < b.tarih ? 1 : 0
                    )
                    .map((o) => (
                      <tr key={o.id}>
                        <td>{o.tarih}</td>
                        <td className="mono">{o.fon}</td>
                        <td className={o.tip === "AL" ? "pos" : "neg"}>
                          {o.tip}
                        </td>
                        <td className="r">{o.pay}</td>
                        <td className="r">{n4(o.fiyat)}</td>
                        <td className="r">{n2(o.pay * o.fiyat)} ₺</td>
                        <td className="r">
                          <button
                            className="btn tiny"
                            onClick={() => delOp(o.id)}
                          >
                            X
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* BULK PRICE MODAL */}
      {bulkOpen && (
        <div className="modalBg" onClick={() => setBulkOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <div>
                <div className="modalTitle">Toplu Fiyat Gir</div>
                <div className="modalSub">Virgül destekli (1,2345)</div>
              </div>
              <div className="topRight">
                <button
                  className="btn ghost"
                  onClick={() => setBulkOpen(false)}
                >
                  Kapat
                </button>
                <button className="btn primary" onClick={bulkApply}>
                  Kaydet
                </button>
              </div>
            </div>

            {funds.length === 0 ? (
              <div className="muted">
                Önce işlem ekle (fon listesi oluşsun).
              </div>
            ) : (
              <div className="tableWrap" style={{ marginTop: 12 }}>
                <table className="table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>Fon</th>
                      <th className="r">Güncel Fiyat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funds.map((f) => (
                      <tr key={f}>
                        <td className="mono">{f}</td>
                        <td className="r">
                          <input
                            className="miniInput"
                            inputMode="text"
                            placeholder="1,2345"
                            value={bulkDraft[f] ?? ""}
                            onChange={(e) =>
                              setBulkDraft((p) => ({
                                ...p,
                                [f]: allowDecimalInput(e.target.value),
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="hintRow" style={{ marginTop: 12 }}>
              Kaydet deyince tablo + grafikler anında güncellenir.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =======================
   ROOT
======================= */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Yükleniyor…</div>;
  if (!user) return <LoginScreen />;
  return <Dashboard user={user} />;
}

/* =======================
   CSS (minimal + futuristik)
======================= */
const css = `
:root{
  --bg:#05070f;
  --card:rgba(255,255,255,.04);
  --stroke:rgba(255,255,255,.10);
  --txt:#eaf0ff;
  --muted:rgba(234,240,255,.65);
  --pri:#7dd3fc;
  --pri2:#a78bfa;
  --pos:#4ade80;
  --neg:#fb7185;
  --shadow: 0 22px 60px rgba(0,0,0,.55);
  --r:18px;
}
*{ box-sizing:border-box; }
html,body{ height:100%; }
body{
  margin:0;
  background:
    radial-gradient(1200px 600px at 20% -10%, rgba(125,211,252,.18), transparent 55%),
    radial-gradient(900px 500px at 85% 0%, rgba(167,139,250,.14), transparent 55%),
    radial-gradient(700px 500px at 50% 110%, rgba(125,211,252,.10), transparent 55%),
    var(--bg);
  color:var(--txt);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
}
.page{ min-height:100vh; display:grid; place-items:center; padding:22px; }
.login{
  width:420px; max-width:100%;
  border:1px solid var(--stroke);
  background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02));
  border-radius: 22px;
  padding: 22px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(10px);
}
.brand{ display:flex; gap:12px; align-items:center; margin-bottom:14px; }
.dot{
  width:12px; height:12px; border-radius:999px;
  background: linear-gradient(90deg, var(--pri), var(--pri2));
  box-shadow: 0 0 18px rgba(125,211,252,.35);
}
.brandTitle{ font-weight:900; letter-spacing:.4px; font-size:18px; }
.brandSub{ font-size:12px; color:var(--muted); margin-top:3px; }
.field{ display:flex; flex-direction:column; gap:7px; margin-top:10px; }
label{ font-size:12px; color:var(--muted); }
input,select,textarea{
  padding: 11px 12px;
  border-radius: 14px;
  border:1px solid var(--stroke);
  background: rgba(0,0,0,.25);
  color: var(--txt);
  outline:none;
}
input:focus,select:focus,textarea:focus{
  border-color: rgba(125,211,252,.55);
  box-shadow: 0 0 0 3px rgba(125,211,252,.10);
}
.row{ display:flex; gap:10px; margin-top:14px; }
.btn{
  border-radius: 14px;
  border:1px solid var(--stroke);
  background: rgba(255,255,255,.04);
  color: var(--txt);
  padding: 11px 12px;
  cursor:pointer;
  transition: transform .08s ease, background .2s ease, opacity .2s ease;
}
.btn:hover{ background: rgba(255,255,255,.06); }
.btn:active{ transform: scale(.98); }
.btn:disabled{ opacity:.55; cursor:not-allowed; }
.btn.primary{
  border: none;
  color:#05101a;
  font-weight:900;
  background: linear-gradient(90deg, var(--pri), var(--pri2));
}
.btn.ghost{ background: rgba(255,255,255,.03); }
.btn.danger{ background: rgba(251,113,133,.12); border-color: rgba(251,113,133,.22); }
.btn.tiny{ padding:7px 9px; border-radius: 12px; }
.msg{ margin-top:12px; font-size:12px; color:var(--muted); }
.hint{ margin-top:10px; font-size:12px; color:var(--muted); }

.app{ min-height:100vh; }
.topbar{
  position: sticky; top:0; z-index:20;
  display:flex; justify-content:space-between; align-items:center;
  padding: 14px 18px;
  border-bottom:1px solid var(--stroke);
  background: rgba(0,0,0,.35);
  backdrop-filter: blur(10px);
}
.topLeft{ display:flex; gap:12px; align-items:center; }
.topTitle{ font-weight:900; letter-spacing:.4px; }
.topSub{ font-size:12px; color:var(--muted); margin-top:2px; }
.topRight{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }

.container{
  max-width: 1150px;
  margin: 0 auto;
  padding: 18px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
.kpis{
  display:grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.kpi{
  border:1px solid var(--stroke);
  background: var(--card);
  border-radius: var(--r);
  padding: 14px;
  box-shadow: var(--shadow);
}
.kpiLabel{ font-size:12px; color:var(--muted); }
.kpiVal{ margin-top:8px; font-size:22px; font-weight:900; }
.pos{ color: var(--pos) !important; }
.neg{ color: var(--neg) !important; }
.muted{ color: var(--muted); }

.card{
  border:1px solid var(--stroke);
  background: var(--card);
  border-radius: var(--r);
  padding: 14px;
  box-shadow: var(--shadow);
}
.cardHead{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:10px; }
.cardTitle{ font-weight:900; }
.cardSub{ font-size:12px; color:var(--muted); margin-top:3px; }

.formGrid{
  display:grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
  align-items:end;
}

.tableWrap{
  border:1px solid var(--stroke);
  border-radius: 16px;
  overflow:auto;
}
.table{
  width:100%;
  border-collapse:collapse;
  min-width: 980px;
}
.table th, .table td{
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.table th{
  position: sticky; top:0;
  font-size:12px;
  color: var(--muted);
  background: rgba(0,0,0,.28);
  backdrop-filter: blur(10px);
  text-align:left;
}
.r{ text-align:right; }
.mono{ font-weight:900; letter-spacing:.5px; }

.miniInput{
  width: 140px;
  padding: 8px 10px;
  border-radius: 12px;
}

.hintRow{
  padding: 10px 12px;
  font-size: 12px;
  color: var(--muted);
  background: rgba(0,0,0,.18);
  border-radius: 14px;
}

.toast{
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid var(--stroke);
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow);
  font-size: 13px;
}

.pillRow{ display:flex; gap:8px; margin: 10px 0 12px; flex-wrap:wrap; }
.pill{
  padding: 7px 10px;
  border-radius: 999px;
  border:1px solid var(--stroke);
  background: rgba(255,255,255,.03);
  color: var(--txt);
  cursor:pointer;
}
.pill.on{
  border-color: rgba(125,211,252,.55);
  background: rgba(125,211,252,.12);
}
.chip{
  padding: 8px 10px;
  border-radius: 999px;
  border:1px solid var(--stroke);
  background: rgba(0,0,0,.18);
  font-size: 12px;
  color: var(--muted);
}

.chartWrap{ border-radius: 18px; overflow:hidden; border:1px solid var(--stroke); background: rgba(0,0,0,.20); }
.chart{ display:block; }
.axis{ stroke: rgba(255,255,255,.18); stroke-width:2; }
.lineGlow{ stroke: rgba(125,211,252,.25); }
.line{ stroke: rgba(125,211,252,.95); }
.chartText{ fill: rgba(234,240,255,.70); font-size: 20px; }

.barPos{ fill: rgba(74,222,128,.65); }
.barNeg{ fill: rgba(251,113,133,.65); }

.emptyBox{
  border:1px solid var(--stroke);
  background: rgba(0,0,0,.22);
  border-radius: 18px;
  display:grid; place-items:center;
}
.emptyTitle{ font-weight:900; }
.emptySub{ font-size:12px; color:var(--muted); margin-top:4px; }

.ta{
  width:100%;
  min-height: 140px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

/* modal */
.modalBg{
  position: fixed; inset:0;
  background: rgba(0,0,0,.62);
  display:grid; place-items:center;
  padding: 16px;
  z-index: 999;
}
.modal{
  width: 760px; max-width: 100%;
  border:1px solid var(--stroke);
  background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  border-radius: 22px;
  padding: 14px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(10px);
}
.modalHead{ display:flex; justify-content:space-between; align-items:center; gap:12px; }

@media (max-width: 980px){
  .kpis{ grid-template-columns: 1fr; }
  .formGrid{ grid-template-columns: 1fr 1fr; }
  .table{ min-width: 860px; }
}
`;
