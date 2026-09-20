import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Shared building blocks for the admin dashboard: theme, fetch helper,
// toasts, image lightbox, promise-based dialogs, small widgets.
// (Client-only — never import server code such as lib/db.js from here.)

export const C = {
  bg: "#0b1220",
  panel: "#111a2e",
  panel2: "#16213a",
  border: "#233252",
  text: "#e8eefc",
  muted: "#8ea0c4",
  primary: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  amber: "#f59e0b",
  purple: "#a78bfa",
};

// ---------- fetch helper ----------
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    window.location.href = "/admin/login";
    throw new Error("Session expired — please log in again");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // non-JSON body
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

export function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const photoUrl = (fileId) => `/api/admin/submission-photo/${encodeURIComponent(fileId)}`;

// ---------- formatting ----------
export const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n ?? "—");

export function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(d) {
  if (!d) return "—";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (Number.isNaN(s)) return "—";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
}

export const userLabel = (u, id) => {
  if (u && u.username) return `@${u.username}`;
  if (u && u.firstName) return `${u.firstName} (${id ?? u.telegramId})`;
  return String(id ?? (u && u.telegramId) ?? "—");
};

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ---------- provider: toast + lightbox + dialogs ----------
const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [images, setImages] = useState(null); // { urls, index }
  const [dialog, setDialog] = useState(null); // { opts, resolve }
  const idRef = useRef(0);

  const toast = useCallback((msg, type = "ok") => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === "err" ? 6000 : 3500);
  }, []);

  const openImages = useCallback((urls, index = 0) => setImages({ urls, index }), []);

  // ask({ title, message, fields, confirmText, danger }) -> values | null
  const ask = useCallback(
    (opts) => new Promise((resolve) => setDialog({ opts, resolve })),
    []
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        setImages(null);
        setDialog((d) => {
          if (d) d.resolve(null);
          return null;
        });
      }
      if (images && e.key === "ArrowRight") setImages((im) => (im ? { ...im, index: (im.index + 1) % im.urls.length } : im));
      if (images && e.key === "ArrowLeft") setImages((im) => (im ? { ...im, index: (im.index - 1 + im.urls.length) % im.urls.length } : im));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images]);

  return (
    <UICtx.Provider value={{ toast, openImages, ask }}>
      {children}

      <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 3000 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: t.type === "err" ? "#450a0a" : t.type === "warn" ? "#422006" : "#052e16",
              border: `1px solid ${t.type === "err" ? "#7f1d1d" : t.type === "warn" ? "#854d0e" : "#166534"}`,
              color: t.type === "err" ? "#fecaca" : t.type === "warn" ? "#fde68a" : "#bbf7d0",
              padding: "10px 14px",
              borderRadius: 10,
              fontSize: 13,
              maxWidth: 360,
              boxShadow: "0 6px 20px rgba(0,0,0,.4)",
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>

      {images && (
        <div style={S.overlay} onClick={() => setImages(null)}>
          <img
            src={images.urls[images.index]}
            alt="screenshot"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "92vw", maxHeight: "86vh", borderRadius: 10, background: "#000" }}
          />
          <div style={{ color: "#cbd5e1", marginTop: 10, fontSize: 13 }} onClick={(e) => e.stopPropagation()}>
            {images.urls.length > 1 && (
              <>
                <button
                  style={S.lightBtn}
                  onClick={() => setImages({ ...images, index: (images.index - 1 + images.urls.length) % images.urls.length })}
                >
                  ◀
                </button>
                <span style={{ margin: "0 12px" }}>
                  {images.index + 1} / {images.urls.length}
                </span>
                <button style={S.lightBtn} onClick={() => setImages({ ...images, index: (images.index + 1) % images.urls.length })}>
                  ▶
                </button>
              </>
            )}
            <a href={images.urls[images.index]} target="_blank" rel="noreferrer" style={{ color: C.primary, marginLeft: 16 }}>
              Open original
            </a>
            <button style={{ ...S.lightBtn, marginLeft: 16 }} onClick={() => setImages(null)}>
              ✕ Close
            </button>
          </div>
        </div>
      )}

      {dialog && (
        <FormDialog
          opts={dialog.opts}
          onDone={(values) => {
            dialog.resolve(values);
            setDialog(null);
          }}
        />
      )}
    </UICtx.Provider>
  );
}

function FormDialog({ opts, onDone }) {
  const fields = opts.fields || [];
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? (f.type === "checkbox" ? false : "")]))
  );
  const [error, setError] = useState("");

  function submit() {
    for (const f of fields) {
      const v = values[f.name];
      if (f.required && (v === "" || v === undefined || v === null)) {
        setError(`${f.label} is required`);
        return;
      }
      if (f.minLength && String(v).trim().length < f.minLength) {
        setError(`${f.label} must be at least ${f.minLength} characters`);
        return;
      }
    }
    onDone(values);
  }

  return (
    <div style={S.overlay} onClick={() => onDone(null)}>
      <div style={{ ...S.modal, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>{opts.title}</h3>
        {opts.message && <p style={{ margin: "0 0 14px", color: C.muted, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{opts.message}</p>}
        {fields.map((f) => (
          <label key={f.name} style={{ display: "block", marginBottom: 12, fontSize: 12, color: C.muted }}>
            {f.type === "checkbox" ? null : <div style={{ marginBottom: 4 }}>{f.label}{f.required ? " *" : ""}</div>}
            {f.type === "textarea" ? (
              <textarea
                autoFocus={fields[0] === f}
                style={{ ...S.input, minHeight: 90, resize: "vertical" }}
                value={values[f.name]}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            ) : f.type === "checkbox" ? (
              <span style={{ display: "flex", gap: 8, alignItems: "flex-start", color: C.text, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!values[f.name]}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })}
                  style={{ marginTop: 3 }}
                />
                <span>{f.label}</span>
              </span>
            ) : f.type === "select" ? (
              <select
                style={S.input}
                value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus={fields[0] === f}
                style={S.input}
                type={f.type === "number" ? "number" : "text"}
                value={values[f.name]}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            )}
            {f.hint && <div style={{ marginTop: 4, fontSize: 11, color: C.muted }}>{f.hint}</div>}
          </label>
        ))}
        {error && <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={() => onDone(null)}>Cancel</Btn>
          <Btn kind={opts.danger ? "danger" : "primary"} onClick={submit}>
            {opts.confirmText || "Confirm"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- widgets ----------
export function Modal({ title, onClose, children, width = 880 }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div style={{ ...S.overlay, alignItems: "flex-start", overflowY: "auto", padding: "4vh 12px" }} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button style={S.x} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Btn({ kind = "default", small, disabled, style, ...rest }) {
  const base = {
    default: { background: C.panel2, border: `1px solid ${C.border}`, color: C.text },
    primary: { background: C.primary, border: `1px solid ${C.primary}`, color: "#fff" },
    danger: { background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5" },
    success: { background: "#052e16", border: "1px solid #166534", color: "#86efac" },
    ghost: { background: "transparent", border: `1px solid ${C.border}`, color: C.muted },
  }[kind];
  return (
    <button
      disabled={disabled}
      style={{
        ...base,
        padding: small ? "4px 10px" : "8px 14px",
        fontSize: small ? 12 : 13,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    />
  );
}

const BADGE_COLORS = {
  green: ["#052e16", "#86efac"],
  red: ["#450a0a", "#fca5a5"],
  amber: ["#422006", "#fcd34d"],
  blue: ["#172554", "#93c5fd"],
  purple: ["#2e1065", "#c4b5fd"],
  gray: ["#1e293b", "#cbd5e1"],
};
export function Badge({ color = "gray", children, style }) {
  const [bg, fg] = BADGE_COLORS[color] || BADGE_COLORS.gray;
  return (
    <span style={{ background: bg, color: fg, padding: "2px 9px", borderRadius: 999, fontSize: 11, whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

export const STATUS_COLOR = {
  active: "green",
  paused: "amber",
  completed: "blue",
  deleted: "gray",
  pending: "amber",
  approved: "green",
  rejected: "red",
  open: "amber",
  in_review: "blue",
  resolved: "green",
};

export function StatusBadge({ status }) {
  return <Badge color={STATUS_COLOR[status] || "gray"}>{String(status).replace("_", " ")}</Badge>;
}

export const PRIORITY_COLOR = { low: "gray", normal: "blue", high: "amber", urgent: "red" };

export function Chip({ active, onClick, children, count, dot }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        border: `1px solid ${active ? C.primary : C.border}`,
        background: active ? C.primary : "transparent",
        color: active ? "#fff" : C.muted,
        cursor: "pointer",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {count !== undefined && count !== null && <span style={{ marginLeft: 6, opacity: 0.8 }}>{count}</span>}
      {dot && <span style={{ marginLeft: 6, color: "#f87171" }}>●</span>}
    </button>
  );
}

export function Pager({ page, pages, total, onPage }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 12, color: C.muted, gap: 8, flexWrap: "wrap" }}>
      <span>{fmt(total)} result{total === 1 ? "" : "s"}</span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Btn small disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ◀ Prev
        </Btn>
        <span>
          Page {page} / {pages}
        </span>
        <Btn small disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next ▶
        </Btn>
      </span>
    </div>
  );
}

export function Card({ title, right, children, style }) {
  return (
    <div style={{ ...S.card, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          <div>{right}</div>
        </div>
      )}
      {children}
    </div>
  );
}

export function Empty({ children }) {
  return <div style={{ padding: "28px 12px", textAlign: "center", color: C.muted, fontSize: 13 }}>{children}</div>;
}

export function Loading() {
  return <div style={{ padding: "28px 12px", textAlign: "center", color: C.muted, fontSize: 13 }}>Loading…</div>;
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <input
      style={{ ...S.input, maxWidth: 300 }}
      value={value}
      placeholder={placeholder || "Search…"}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Row of screenshot thumbnails; clicking opens the lightbox.
export function Thumbs({ ids, size = 72 }) {
  const { openImages } = useUI();
  if (!ids || !ids.length) return <span style={{ color: C.muted, fontSize: 12 }}>no screenshots</span>;
  const urls = ids.map(photoUrl);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {urls.map((u, i) => (
        <img
          key={u}
          src={u}
          alt={`screenshot ${i + 1}`}
          loading="lazy"
          onClick={() => openImages(urls, i)}
          style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, cursor: "zoom-in", border: `1px solid ${C.border}`, background: "#000" }}
        />
      ))}
    </div>
  );
}

export function Table({ head, children, empty, colSpan }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={S.table}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={S.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
          {empty && (
            <tr>
              <td style={S.td} colSpan={colSpan || head.length}>
                <Empty>{empty}</Empty>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function KV({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ width: 130, color: C.muted, flexShrink: 0 }}>{label}</div>
      <div style={{ minWidth: 0, wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

export const S = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,.78)",
    zIndex: 2000,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  modal: {
    width: "100%",
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 20px 60px rgba(0,0,0,.5)",
  },
  x: { background: "transparent", border: "none", color: C.muted, fontSize: 18, cursor: "pointer" },
  lightBtn: { background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, padding: "5px 12px", cursor: "pointer" },
  card: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: C.bg,
    border: `1px solid ${C.border}`,
    color: C.text,
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "9px 10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontWeight: 500, whiteSpace: "nowrap" },
  td: { padding: "9px 10px", borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" },
  toolbar: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 },
};

// ---------- data hook ----------
// useApi(url) loads `url` (a string, or null to skip) and reloads whenever
// it changes. Late responses from an older url are ignored.
export function useApi(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState("");
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!url) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await api(url);
      if (mine === seq.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (mine === seq.current) setError(e.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}
