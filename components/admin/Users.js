import { useEffect, useState } from "react";
import {
  api, qs, useApi, useUI, useDebounced, Modal, Btn, Badge, Chip, Pager, Card, Loading, SearchBox, Table, KV, StatusBadge, C, S, fmt, fmtDate, timeAgo, userLabel,
} from "./ui.js";
import { CATEGORY_LABEL } from "./Overview.js";

export default function Users({ openUser, tick, initialBanned }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [banned, setBanned] = useState(Boolean(initialBanned));
  const [sort, setSort] = useState("new");
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [dq, banned, sort]);
  useEffect(() => setBanned(Boolean(initialBanned)), [initialBanned]);

  const list = useApi(`/api/admin/users${qs({ q: dq, banned, sort, page, t: tick })}`);
  const d = list.data;

  return (
    <div>
      <div style={S.toolbar}>
        <SearchBox value={q} onChange={setQ} placeholder="Search Telegram ID, @username, name…" />
        <Chip active={banned} onClick={() => setBanned(!banned)}>
          🚫 Banned only
        </Chip>
        <select style={{ ...S.input, width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
          <option value="earned">Most earned</option>
          <option value="donated">Most donated</option>
          <option value="xp">Most XP</option>
        </select>
        <Btn onClick={list.reload}>↻ Refresh</Btn>
      </div>
      <Card>
        {list.error && <div style={{ color: "#fca5a5", marginBottom: 10 }}>{list.error}</div>}
        {!d ? (
          <Loading />
        ) : (
          <>
            <Table head={["Telegram ID", "User", "Donated", "Earned", "XP", "Joined", "Status"]} empty={d.items.length ? null : "No users match."}>
              {d.items.map((u) => (
                <tr key={u._id} onClick={() => openUser(u.telegramId)} style={{ cursor: "pointer" }}>
                  <td style={S.td}>{u.telegramId}</td>
                  <td style={S.td}>
                    {u.username ? `@${u.username}` : "—"}
                    <div style={{ fontSize: 11, color: C.muted }}>{[u.firstName, u.lastName].filter(Boolean).join(" ")}</div>
                  </td>
                  <td style={S.td}>{fmt(u.donatedBalance)}</td>
                  <td style={S.td}>{fmt(u.earnedBalance)}</td>
                  <td style={S.td}>{fmt(u.xp || 0)}</td>
                  <td style={{ ...S.td, color: C.muted }}>{timeAgo(u.createdAt)}</td>
                  <td style={S.td}>
                    {u.isBanned ? <Badge color="red">banned</Badge> : <Badge color="green">ok</Badge>}
                    {u.adminNotes && u.adminNotes.length > 0 && <span title="Has admin notes"> 📝</span>}
                  </td>
                </tr>
              ))}
            </Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

// Full profile popup — reachable from every tab via openUser(telegramId).
export function UserModal({ telegramId, onClose, onChanged, openReport, goTab }) {
  const { toast, ask } = useUI();
  const { data, loading, error, reload } = useApi(`/api/admin/users${qs({ telegramId })}`);
  const [tab, setTab] = useState("profile");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function patch(body, okMsg) {
    setBusy(true);
    try {
      const r = await api("/api/admin/users", { method: "PATCH", body: { telegramId, ...body } });
      const failed = (r.delivery || []).filter((x) => !x.ok);
      if (failed.length) toast(`Saved, but the user could not be messaged: ${failed[0].error || "unknown"}`, "warn");
      else toast(okMsg || "Saved");
      await reload();
      onChanged && onChanged();
      return true;
    } catch (e) {
      toast(e.message, "err");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function ban() {
    const v = await ask({
      title: `Ban user ${telegramId}`,
      message: "A banned user can't use the bot (except to send an appeal with /report).",
      fields: [
        { name: "banReason", label: "Reason (kept in the record and shown to the user)", type: "textarea", required: true, minLength: 3 },
        { name: "notify", label: "Tell the user in the bot", type: "checkbox", defaultValue: true },
      ],
      confirmText: "Ban user",
      danger: true,
    });
    if (v) await patch({ isBanned: true, banReason: v.banReason, notifyUser: v.notify }, "User banned");
  }

  async function unban() {
    const v = await ask({
      title: `Unban user ${telegramId}`,
      fields: [{ name: "notify", label: "Tell the user in the bot", type: "checkbox", defaultValue: true }],
      confirmText: "Unban",
    });
    if (v) await patch({ isBanned: false, notifyUser: v.notify }, "User unbanned");
  }

  async function adjust() {
    const v = await ask({
      title: `Adjust balance of ${telegramId}`,
      message:
        "Positive = add GRAM (to the donated balance). Negative = remove GRAM (donated first, then earned; never below 0).\nEvery change is saved as a transaction and in the activity log.",
      fields: [
        { name: "amount", label: "Amount (e.g. 5000 or -2000)", type: "number", required: true },
        { name: "note", label: "Reason / note (kept in the record)", type: "text", required: true, minLength: 3 },
        { name: "notify", label: "Tell the user in the bot", type: "checkbox", defaultValue: true },
      ],
      confirmText: "Apply",
    });
    if (v) await patch({ adjustAmount: Number(v.amount), note: v.note, notifyUser: v.notify }, "Balance updated");
  }

  async function message() {
    const v = await ask({
      title: `Message user ${telegramId}`,
      message: "Sent from the bot as “📩 Message from admin”.",
      fields: [{ name: "message", label: "Message", type: "textarea", required: true }],
      confirmText: "Send",
    });
    if (!v) return;
    setBusy(true);
    try {
      const r = await api("/api/admin/users", { method: "POST", body: { telegramId, message: v.message } });
      toast(r.ok ? "Message delivered" : `Not delivered: ${r.error || "unknown"}`, r.ok ? "ok" : "warn");
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    if (await patch({ addNote: note }, "Note added")) setNote("");
  }

  if (loading && !data) {
    return (
      <Modal title={`User ${telegramId}`} onClose={onClose}>
        {error ? <div style={{ color: "#fca5a5" }}>{error}</div> : <Loading />}
      </Modal>
    );
  }
  if (!data) {
    return (
      <Modal title={`User ${telegramId}`} onClose={onClose}>
        <div style={{ color: "#fca5a5" }}>{error || "Could not load this user."}</div>
      </Modal>
    );
  }

  const { user: u, transactions, tasks, workerSubmissions, ownerSubmissions, reports, referrals } = data;
  const TABS = [
    ["profile", "Profile"],
    ["transactions", `Coins (${transactions.length})`],
    ["tasks", `Tasks (${tasks.length})`],
    ["subs", `Screenshots (${workerSubmissions.length + ownerSubmissions.length})`],
    ["reports", `Reports (${reports.length})`],
  ];

  return (
    <Modal
      title={
        <span>
          👤 {userLabel(u, u.telegramId)} {u.isBanned ? <Badge color="red">BANNED</Badge> : null}
        </span>
      }
      onClose={onClose}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {u.isBanned ? (
          <Btn small disabled={busy} onClick={unban} kind="success">
            ✅ Unban
          </Btn>
        ) : (
          <Btn small disabled={busy} onClick={ban} kind="danger">
            🚫 Ban
          </Btn>
        )}
        <Btn small disabled={busy} onClick={adjust}>
          💰 Adjust balance
        </Btn>
        <Btn small disabled={busy} onClick={message}>
          📩 Send message
        </Btn>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {TABS.map(([k, label]) => (
          <Chip key={k} active={tab === k} onClick={() => setTab(k)}>
            {label}
          </Chip>
        ))}
      </div>

      {tab === "profile" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 }}>
          <div>
            <KV label="Telegram ID">{u.telegramId}</KV>
            <KV label="Name">{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</KV>
            <KV label="Username">{u.username ? `@${u.username}` : "—"}</KV>
            <KV label="Joined">{fmtDate(u.createdAt)}</KV>
            <KV label="Donated balance">{fmt(u.donatedBalance)} GRAM</KV>
            <KV label="Earned balance">{fmt(u.earnedBalance)} GRAM</KV>
            <KV label="Total">
              <b>{fmt(u.totalBalance)} GRAM</b>
            </KV>
            <KV label="XP / tasks done">
              {fmt(u.xp || 0)} XP · {fmt(u.totalTasksCompleted || 0)} tasks
            </KV>
            <KV label="Referred by">{u.referredBy || "—"}</KV>
            <KV label="Invited users">{fmt(referrals)}</KV>
            <KV label="Verified (anti-bot)">{u.isVerified === false ? "waiting for check" : "yes"}</KV>
            <KV label="Notifications">{u.notificationsEnabled === false ? "off" : "on"}</KV>
            {u.isBanned && (
              <KV label="Ban">
                {u.banReason || "—"} <span style={{ color: C.muted }}>({fmtDate(u.bannedAt)})</span>
              </KV>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>🔒 Private admin notes</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
              {(u.adminNotes || []).length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No notes yet.</div>}
              {(u.adminNotes || []).map((n) => (
                <div key={n._id} style={{ background: "#2b2410", border: "1px solid #5b4a12", borderRadius: 8, padding: "6px 10px", fontSize: 13, whiteSpace: "pre-wrap" }}>
                  {n.text}
                  <div style={{ fontSize: 11, color: C.muted }}>
                    {n.by} · {fmtDate(n.createdAt)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={S.input} placeholder="Add a note about this user…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
              <Btn disabled={busy || !note.trim()} onClick={addNote}>
                Add
              </Btn>
            </div>
          </div>
        </div>
      )}

      {tab === "transactions" && (
        <>
          <Table head={["When", "Type", "Amount", "Note"]} empty={transactions.length ? null : "No transactions."}>
            {transactions.map((t) => (
              <tr key={t._id}>
                <td style={{ ...S.td, whiteSpace: "nowrap" }}>{fmtDate(t.createdAt)}</td>
                <td style={S.td}>{t.type}</td>
                <td style={{ ...S.td, color: t.amount < 0 ? "#fca5a5" : "#86efac" }}>
                  {t.amount > 0 ? "+" : ""}
                  {fmt(t.amount)}
                </td>
                <td style={{ ...S.td, color: C.muted }}>{t.note || ""}</td>
              </tr>
            ))}
          </Table>
          <div style={{ marginTop: 10 }}>
            <Btn small onClick={() => goTab("transactions", { telegramId: u.telegramId })}>
              See all in the Transactions tab →
            </Btn>
          </div>
        </>
      )}

      {tab === "tasks" && (
        <Table head={["#", "Type", "Target", "Price", "Progress", "Status"]} empty={tasks.length ? null : "No tasks created."}>
          {tasks.map((t) => (
            <tr key={t._id}>
              <td style={S.td}>{t.taskNumber || "—"}</td>
              <td style={S.td}>{t.type}</td>
              <td style={S.td}>{t.targetChatTitle || t.targetChatId}</td>
              <td style={S.td}>{fmt(t.pricePerAction)}</td>
              <td style={S.td}>
                {t.completedCount}/{t.goalCount}
              </td>
              <td style={S.td}>
                <StatusBadge status={t.status} />
              </td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "subs" && (
        <>
          <div style={{ fontSize: 12, color: C.muted, margin: "0 0 6px" }}>As worker</div>
          <Table head={["#", "Status", "By", "Reason", "When"]} empty={workerSubmissions.length ? null : "None."}>
            {workerSubmissions.map((s) => (
              <tr key={s._id}>
                <td style={S.td}>#{s.submissionNumber ?? "—"}</td>
                <td style={S.td}>
                  <StatusBadge status={s.status} />
                </td>
                <td style={S.td}>{s.decidedBy || "—"}</td>
                <td style={{ ...S.td, color: C.muted }}>{s.adminNote || s.rejectReason || ""}</td>
                <td style={S.td}>{fmtDate(s.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <div style={{ fontSize: 12, color: C.muted, margin: "14px 0 6px" }}>As task owner (reviewing others)</div>
          <Table head={["#", "Status", "By", "Reason", "When"]} empty={ownerSubmissions.length ? null : "None."}>
            {ownerSubmissions.map((s) => (
              <tr key={s._id}>
                <td style={S.td}>#{s.submissionNumber ?? "—"}</td>
                <td style={S.td}>
                  <StatusBadge status={s.status} />
                </td>
                <td style={S.td}>{s.decidedBy || "—"}</td>
                <td style={{ ...S.td, color: C.muted }}>{s.adminNote || s.rejectReason || ""}</td>
                <td style={S.td}>{fmtDate(s.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {tab === "reports" && (
        <Table head={["#", "Topic", "Message", "Status", "When"]} empty={reports.length ? null : "This user never filed a report."}>
          {reports.map((r) => (
            <tr key={r._id} style={{ cursor: "pointer" }} onClick={() => openReport(r._id)}>
              <td style={S.td}>#{r.reportNumber}</td>
              <td style={S.td}>{CATEGORY_LABEL[r.category] || r.category}</td>
              <td style={{ ...S.td, maxWidth: 280, color: C.muted }}>{r.text.length > 90 ? `${r.text.slice(0, 90)}…` : r.text}</td>
              <td style={S.td}>
                <StatusBadge status={r.status} />
              </td>
              <td style={S.td}>{fmtDate(r.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Modal>
  );
}
