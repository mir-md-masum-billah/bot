import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { dbConnect } from "../../lib/db.js";
import { isAuthed } from "../../lib/adminAuth.js";

export async function getServerSideProps({ req }) {
  if (!isAuthed(req)) {
    return { redirect: { destination: "/admin/login", permanent: false } };
  }
  return { props: {} };
}

export default function AdminDashboard() {
  const [tab, setTab] = useState("tasks");
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const router = useRouter();

  async function loadAll() {
    const [s, t, u] = await Promise.all([
      fetch("/api/admin/stats").then((r) => r.json()),
      fetch("/api/admin/tasks").then((r) => r.json()),
      fetch("/api/admin/users").then((r) => r.json()),
    ]);
    setStats(s);
    setTasks(t);
    setUsers(u);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function updateTask(id, patch) {
    await fetch("/api/admin/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    loadAll();
  }

  async function deleteTask(id) {
    if (!confirm("Delete this task?")) return;
    await fetch("/api/admin/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadAll();
  }

  async function toggleBan(telegramId, isBanned) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, isBanned: !isBanned }),
    });
    loadAll();
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <h1 style={s.h1}>📢 Promotion Bot — Admin</h1>
        <nav style={s.nav}>
          <button style={tab === "tasks" ? s.navActive : s.navBtn} onClick={() => setTab("tasks")}>
            Tasks
          </button>
          <button style={tab === "users" ? s.navActive : s.navBtn} onClick={() => setTab("users")}>
            Users
          </button>
        </nav>
      </header>

      {stats && (
        <div style={s.statsRow}>
          <StatCard label="Users" value={stats.userCount} />
          <StatCard label="Active tasks" value={stats.activeTasks} />
          <StatCard label="Total tasks" value={stats.totalTasks} />
        </div>
      )}

      {tab === "tasks" && (
        <div style={s.card}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Type</th>
                <th style={s.th}>Target</th>
                <th style={s.th}>Owner</th>
                <th style={s.th}>Price</th>
                <th style={s.th}>Progress</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t._id}>
                  <td style={s.td}>{t.type}</td>
                  <td style={s.td}>{t.targetChatTitle || t.targetChatId}</td>
                  <td style={s.td}>{t.ownerTelegramId}</td>
                  <td style={s.td}>{t.pricePerAction}</td>
                  <td style={s.td}>{t.completedCount}/{t.goalCount}</td>
                  <td style={s.td}>
                    <span style={s.badge(t.status)}>{t.status}</span>
                  </td>
                  <td style={s.td}>
                    {t.status === "active" ? (
                      <button style={s.smallBtn} onClick={() => updateTask(t._id, { status: "paused" })}>
                        Pause
                      </button>
                    ) : (
                      t.status !== "deleted" && (
                        <button style={s.smallBtn} onClick={() => updateTask(t._id, { status: "active" })}>
                          Resume
                        </button>
                      )
                    )}
                    {t.status !== "deleted" && (
                      <button style={s.smallBtnDanger} onClick={() => deleteTask(t._id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td style={s.td} colSpan={7}>No tasks yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "users" && (
        <div style={s.card}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Telegram ID</th>
                <th style={s.th}>Username</th>
                <th style={s.th}>Donated</th>
                <th style={s.th}>Earned</th>
                <th style={s.th}>Banned</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id}>
                  <td style={s.td}>{u.telegramId}</td>
                  <td style={s.td}>{u.username || "—"}</td>
                  <td style={s.td}>{u.donatedBalance}</td>
                  <td style={s.td}>{u.earnedBalance}</td>
                  <td style={s.td}>{u.isBanned ? "Yes" : "No"}</td>
                  <td style={s.td}>
                    <button style={s.smallBtn} onClick={() => toggleBan(u.telegramId, u.isBanned)}>
                      {u.isBanned ? "Unban" : "Ban"}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td style={s.td} colSpan={6}>No users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={s.statCard}>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh",
    background: "#0f172a",
    color: "#f8fafc",
    fontFamily: "system-ui, sans-serif",
    padding: "24px 32px",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" },
  h1: { fontSize: "20px", margin: 0 },
  nav: { display: "flex", gap: "8px" },
  navBtn: {
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid #334155",
    background: "transparent",
    color: "#cbd5e1",
    cursor: "pointer",
  },
  navActive: {
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid #3b82f6",
    background: "#3b82f6",
    color: "#fff",
    cursor: "pointer",
  },
  statsRow: { display: "flex", gap: "16px", marginBottom: "24px" },
  statCard: {
    background: "#1e293b",
    borderRadius: "12px",
    padding: "16px 24px",
    minWidth: "140px",
  },
  statValue: { fontSize: "28px", fontWeight: 700 },
  statLabel: { fontSize: "13px", color: "#94a3b8" },
  card: { background: "#1e293b", borderRadius: "12px", padding: "16px", overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  th: { textAlign: "left", padding: "10px", borderBottom: "1px solid #334155", color: "#94a3b8" },
  td: { padding: "10px", borderBottom: "1px solid #27364a" },
  smallBtn: {
    padding: "4px 10px",
    marginRight: "6px",
    borderRadius: "6px",
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#f8fafc",
    cursor: "pointer",
    fontSize: "12px",
  },
  smallBtnDanger: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid #7f1d1d",
    background: "#450a0a",
    color: "#fca5a5",
    cursor: "pointer",
    fontSize: "12px",
  },
  badge: (status) => ({
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    background:
      status === "active" ? "#064e3b" : status === "paused" ? "#78350f" : "#334155",
    color: status === "active" ? "#6ee7b7" : status === "paused" ? "#fcd34d" : "#cbd5e1",
  }),
};
