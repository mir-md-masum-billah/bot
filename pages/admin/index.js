import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import { UIProvider, api, C, Badge } from "../../components/admin/ui.js";
import Overview from "../../components/admin/Overview.js";
import Reports from "../../components/admin/Reports.js";
import Submissions from "../../components/admin/Submissions.js";
import Users, { UserModal } from "../../components/admin/Users.js";
import Tasks from "../../components/admin/Tasks.js";
import Transactions from "../../components/admin/Transactions.js";
import Broadcast from "../../components/admin/Broadcast.js";
import ActivityLog from "../../components/admin/ActivityLog.js";

// NOTE: server-only code (auth, database) is imported INSIDE
// getServerSideProps and nowhere else. A top-level `import { dbConnect }`
// here used to be bundled into the browser (146 kB) and threw
// "Please define the MONGODB_URI" → "Application error: a client-side
// exception has occurred".
export async function getServerSideProps({ req }) {
  const { isAuthed } = await import("../../lib/adminAuth.js");
  if (!isAuthed(req)) {
    return { redirect: { destination: "/admin/login", permanent: false } };
  }
  return { props: {} };
}

const TABS = [
  ["overview", "📊 Overview"],
  ["reports", "🆘 Reports"],
  ["submissions", "📸 Screenshots"],
  ["users", "👥 Users"],
  ["tasks", "📋 Tasks"],
  ["transactions", "💰 Transactions"],
  ["broadcast", "📢 Broadcast"],
  ["log", "🧾 Activity log"],
];

const GLOBAL_CSS = `
  html, body { margin: 0; background: ${C.bg}; }
  * { box-sizing: border-box; }
  tr:hover td { background: rgba(255,255,255,.02); }
  ::-webkit-scrollbar { height: 8px; width: 8px; }
  ::-webkit-scrollbar-thumb { background: #2a3a5f; border-radius: 8px; }
  a { text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

export default function AdminDashboard() {
  const [tab, setTab] = useState("overview");
  const [tick, setTick] = useState(0); // bump to make every open list reload
  const [badges, setBadges] = useState({ pendingSubmissions: 0, openReports: 0, unreadReports: 0 });
  const [userId, setUserId] = useState(null);
  const [openReportId, setOpenReportId] = useState(null);
  const [preset, setPreset] = useState({}); // e.g. { banned: true } or { txnUser: 123 }

  const refreshBadges = useCallback(async () => {
    try {
      setBadges(await api("/api/admin/stats?lite=1"));
    } catch (e) {
      // keep the old numbers; api() already redirects on 401
    }
  }, []);

  useEffect(() => {
    refreshBadges();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refreshBadges();
    }, 30000);
    return () => clearInterval(t);
  }, [refreshBadges]);

  const go = useCallback((t, opts = {}) => {
    setPreset(opts);
    setTab(t);
    setUserId(null);
  }, []);

  const openReport = useCallback((id) => {
    setOpenReportId(id);
    setTab("reports");
    setUserId(null);
  }, []);

  const changed = useCallback(() => refreshBadges(), [refreshBadges]);

  async function logout() {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch (e) {
      // ignore
    }
    window.location.href = "/admin/login";
  }

  const badgeFor = (k) =>
    k === "reports" ? badges.unreadReports || badges.openReports : k === "submissions" ? badges.pendingSubmissions : 0;

  return (
    <UIProvider>
      <Head>
        <title>Admin Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style>{GLOBAL_CSS}</style>
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 100, background: C.bg, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 18, flex: "0 0 auto" }}>⚙️ Promo Bot Admin</h1>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => {
                setTick((n) => n + 1);
                refreshBadges();
              }}
              style={btn}
            >
              ↻ Refresh all
            </button>
            <button onClick={logout} style={btn}>
              Log out
            </button>
          </div>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 16px 10px", display: "flex", gap: 6, overflowX: "auto" }}>
            {TABS.map(([k, label]) => {
              const n = badgeFor(k);
              const active = tab === k;
              return (
                <button
                  key={k}
                  onClick={() => go(k)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: `1px solid ${active ? C.primary : C.border}`,
                    background: active ? C.primary : C.panel,
                    color: active ? "#fff" : C.muted,
                    cursor: "pointer",
                    fontSize: 13,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                  {n > 0 && (
                    <Badge color="red" style={{ marginLeft: 8 }}>
                      {n}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ maxWidth: 1280, margin: "0 auto", padding: 16 }}>
          {tab === "overview" && <Overview go={go} openReport={openReport} tick={tick} />}
          {tab === "reports" && (
            <Reports
              tick={tick}
              openUser={setUserId}
              openId={openReportId}
              onOpenedId={() => setOpenReportId(null)}
              onChanged={changed}
            />
          )}
          {tab === "submissions" && <Submissions tick={tick} openUser={setUserId} onChanged={changed} />}
          {tab === "users" && <Users tick={tick} openUser={setUserId} initialBanned={preset.banned} />}
          {tab === "tasks" && <Tasks tick={tick} openUser={setUserId} />}
          {tab === "transactions" && <Transactions tick={tick} openUser={setUserId} initialUser={preset.telegramId} />}
          {tab === "broadcast" && <Broadcast />}
          {tab === "log" && <ActivityLog tick={tick} />}
        </div>

        {userId && (
          <UserModal
            key={userId}
            telegramId={userId}
            onClose={() => setUserId(null)}
            onChanged={() => {
              changed();
              setTick((n) => n + 1);
            }}
            openReport={openReport}
            goTab={go}
          />
        )}
      </div>
    </UIProvider>
  );
}

const btn = {
  background: C.panel2,
  border: `1px solid ${C.border}`,
  color: C.text,
  padding: "7px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 13,
};
