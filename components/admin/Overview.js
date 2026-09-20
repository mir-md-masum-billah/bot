import { useApi, Card, Btn, Badge, Loading, C, fmt, fmtDate, timeAgo, PRIORITY_COLOR } from "./ui.js";

const CATEGORY_LABEL = {
  balance: "💰 Balance",
  task: "📋 Task",
  dispute: "⚖️ Dispute",
  abuse: "🚫 Abuse/scam",
  bug: "🐞 Bug",
  other: "❓ Other",
};
export { CATEGORY_LABEL };

function Stat({ label, value, sub, color, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.panel,
        border: `1px solid ${color || C.border}`,
        borderRadius: 14,
        padding: "14px 16px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 700, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Overview({ go, openReport, tick }) {
  const stats = useApi(`/api/admin/stats?t=${tick}`);
  const reports = useApi(`/api/admin/reports?status=active&limit=6&t=${tick}`);
  const subs = useApi(`/api/admin/submissions?status=pending&limit=6&t=${tick}`);
  const s = stats.data;

  if (!s) return stats.error ? <div style={{ color: "#fca5a5" }}>{stats.error}</div> : <Loading />;

  const maxSignup = Math.max(1, ...s.signupsByDay.map((d) => d.count));
  const typeIcons = { channel: "📢", group: "👥", views: "👁", bot: "🤖", boost: "⚡️", reactions: "❤️" };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <Stat
          label="Open reports"
          value={fmt(s.openReports)}
          sub={s.unreadReports ? `${s.unreadReports} unread` : "all read"}
          color={s.openReports ? C.amber : undefined}
          onClick={() => go("reports")}
        />
        <Stat
          label="Pending screenshots"
          value={fmt(s.pendingSubmissions)}
          color={s.pendingSubmissions ? C.amber : undefined}
          onClick={() => go("submissions")}
        />
        <Stat label="Users" value={fmt(s.userCount)} sub={`+${fmt(s.newToday)} today · +${fmt(s.new7d)} this week`} onClick={() => go("users")} />
        <Stat label="Banned users" value={fmt(s.bannedUsers)} color={s.bannedUsers ? C.red : undefined} onClick={() => go("users", { banned: true })} />
        <Stat label="Active tasks" value={fmt(s.activeTasks)} sub={`${fmt(s.pausedTasks)} paused · ${fmt(s.completedTasks)} completed`} onClick={() => go("tasks")} />
        <Stat
          label="GRAM in circulation"
          value={fmt((s.donatedInCirculation || 0) + (s.earnedInCirculation || 0))}
          sub={`${fmt(s.donatedInCirculation)} donated · ${fmt(s.earnedInCirculation)} earned`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <Card title="🆘 Reports needing attention" right={<Btn small onClick={() => go("reports")}>View all</Btn>}>
          {reports.loading && !reports.data ? (
            <Loading />
          ) : reports.data && reports.data.items.length ? (
            reports.data.items.map((r) => (
              <div
                key={r._id}
                onClick={() => openReport(r._id)}
                style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer", alignItems: "center" }}
              >
                <span style={{ color: r.unreadByAdmin ? "#f87171" : "transparent" }}>●</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>
                    #{r.reportNumber} · {CATEGORY_LABEL[r.category] || r.category}{" "}
                    <Badge color={PRIORITY_COLOR[r.priority]}>{r.priority}</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.text}</div>
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>{timeAgo(r.lastActivityAt)}</div>
              </div>
            ))
          ) : (
            <div style={{ color: C.muted, fontSize: 13 }}>🎉 No open reports.</div>
          )}
        </Card>

        <Card title="📸 Pending screenshots" right={<Btn small onClick={() => go("submissions")}>View all</Btn>}>
          {subs.loading && !subs.data ? (
            <Loading />
          ) : subs.data && subs.data.items.length ? (
            subs.data.items.map((x) => (
              <div key={x._id} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}`, alignItems: "center" }}>
                <div style={{ flex: 1, fontSize: 13 }}>
                  {x.task ? x.task.targetChatTitle || x.task.targetChatId : "task"}
                  <div style={{ fontSize: 12, color: C.muted }}>
                    worker {x.workerTelegramId} → owner {x.ownerTelegramId}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>auto-approves {fmtDate(x.expiresAt)}</div>
              </div>
            ))
          ) : (
            <div style={{ color: C.muted, fontSize: 13 }}>Nothing waiting.</div>
          )}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <Card title="New users — last 14 days">
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
            {s.signupsByDay.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.count}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                <div style={{ fontSize: 10, color: C.muted, textAlign: "center" }}>{d.count || ""}</div>
                <div style={{ background: C.primary, borderRadius: 4, height: `${Math.max(3, (d.count / maxSignup) * 90)}%`, opacity: d.count ? 1 : 0.25 }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginTop: 4 }}>
            <span>{s.signupsByDay[0].day.slice(5)}</span>
            <span>{s.signupsByDay[13].day.slice(5)}</span>
          </div>
        </Card>

        <Card title="Active tasks by type">
          {Object.keys(s.tasksByType).length ? (
            Object.entries(s.tasksByType).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
                <span>
                  {typeIcons[k] || "•"} {k}
                </span>
                <b>{fmt(v)}</b>
              </div>
            ))
          ) : (
            <div style={{ color: C.muted, fontSize: 13 }}>No active tasks.</div>
          )}
        </Card>

        <Card title="Coin movement — last 7 days">
          {s.transactions7d.length ? (
            s.transactions7d.map((t) => (
              <div key={t.type} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
                <span>
                  {t.type} <span style={{ color: C.muted }}>×{fmt(t.count)}</span>
                </span>
                <b style={{ color: t.total < 0 ? "#fca5a5" : "#86efac" }}>
                  {t.total > 0 ? "+" : ""}
                  {fmt(t.total)}
                </b>
              </div>
            ))
          ) : (
            <div style={{ color: C.muted, fontSize: 13 }}>No transactions yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
