import { useEffect, useState } from "react";
import { api, qs, useApi, useUI, useDebounced, Modal, Btn, Badge, Chip, Pager, Card, Loading, SearchBox, Table, KV, StatusBadge, C, S, fmt, fmtDate, userLabel } from "./ui.js";

const STATUS = [
  ["", "All"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["completed", "Completed"],
  ["deleted", "Deleted"],
];
const TYPES = ["channel", "group", "views", "bot", "boost", "reactions"];
const ICON = { channel: "📢", group: "👥", views: "👁", bot: "🤖", boost: "⚡️", reactions: "❤️" };

export default function Tasks({ openUser, tick }) {
  const { toast, ask } = useUI();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [reported, setReported] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => setPage(1), [status, type, reported, dq]);

  const list = useApi(`/api/admin/tasks${qs({ status, type, reported, q: dq, page, t: tick })}`);
  const d = list.data;

  async function call(id, method, body, okMsg) {
    setBusyId(id);
    try {
      const r = await api("/api/admin/tasks", { method, body: { id, ...body } });
      toast(okMsg + (r.refunded ? ` — refunded ${fmt(r.refunded)} GRAM` : ""));
      list.reload();
      return true;
    } catch (e) {
      toast(e.message, "err");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function togglePause(t) {
    const pausing = t.status === "active";
    const v = await ask({
      title: pausing ? "Pause this task" : "Resume this task",
      fields: [
        ...(pausing ? [{ name: "reason", label: "Reason (optional, kept in the log)", type: "text" }] : []),
        { name: "notify", label: "Tell the owner in the bot", type: "checkbox", defaultValue: pausing },
      ],
      confirmText: pausing ? "Pause" : "Resume",
    });
    if (!v) return;
    await call(t._id, "PATCH", { status: pausing ? "paused" : "active", reason: v.reason, notifyOwner: v.notify }, pausing ? "Task paused" : "Task resumed");
  }

  async function editPrice(t) {
    const v = await ask({
      title: "Change price per action",
      message: `Currently ${fmt(t.pricePerAction)} GRAM. Only affects future completions.`,
      fields: [
        { name: "price", label: "New price (GRAM)", type: "number", required: true, defaultValue: t.pricePerAction },
        { name: "notify", label: "Tell the owner in the bot", type: "checkbox", defaultValue: false },
      ],
      confirmText: "Save price",
    });
    if (v) await call(t._id, "PATCH", { pricePerAction: Number(v.price), notifyOwner: v.notify }, "Price updated");
  }

  async function remove(t) {
    const remaining = Math.max(t.goalCount - t.completedCount, 0) * t.pricePerAction;
    const v = await ask({
      title: "Delete this task",
      message: `Task "${t.targetChatTitle || t.targetChatId}" will be removed for everyone.\nUnused budget: ${fmt(remaining)} GRAM.`,
      fields: [
        { name: "reason", label: "Reason (kept in the log, shown to the owner if notified)", type: "text" },
        { name: "refund", label: `Refund ${fmt(remaining)} GRAM to the owner (untick for scam/abuse)`, type: "checkbox", defaultValue: true },
        { name: "notify", label: "Tell the owner in the bot", type: "checkbox", defaultValue: true },
      ],
      confirmText: "Delete task",
      danger: true,
    });
    if (v) await call(t._id, "DELETE", { refund: v.refund, reason: v.reason, notifyOwner: v.notify }, "Task deleted");
  }

  return (
    <div>
      <div style={S.toolbar}>
        {STATUS.map(([k, label]) => (
          <Chip key={k || "all"} active={status === k} onClick={() => setStatus(k)}>
            {label}
          </Chip>
        ))}
        <Chip active={reported} onClick={() => setReported(!reported)}>
          🚩 Reported by workers
        </Chip>
      </div>
      <div style={S.toolbar}>
        <SearchBox value={q} onChange={setQ} placeholder="Search title, @username, task #, owner id…" />
        <select style={{ ...S.input, width: "auto" }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {ICON[t]} {t}
            </option>
          ))}
        </select>
        <Btn onClick={list.reload}>↻ Refresh</Btn>
      </div>
      <Card>
        {list.error && <div style={{ color: "#fca5a5", marginBottom: 10 }}>{list.error}</div>}
        {!d ? (
          <Loading />
        ) : (
          <>
            <Table head={["#", "Type", "Target", "Owner", "Price", "Progress", "Reports", "Status", "Actions"]} empty={d.items.length ? null : "No tasks match."}>
              {d.items.map((t) => (
                <tr key={t._id}>
                  <td style={S.td}>{t.taskNumber || "—"}</td>
                  <td style={S.td}>
                    {ICON[t.type]} {t.type}
                    {t.requiresProof && <div style={{ fontSize: 11, color: C.muted }}>📸 proof</div>}
                  </td>
                  <td style={{ ...S.td, maxWidth: 220 }}>
                    <a style={{ color: C.primary, cursor: "pointer" }} onClick={() => setDetail(t._id)}>
                      {t.targetChatTitle || t.targetChatId}
                    </a>
                    {t.targetChatUsername && <div style={{ fontSize: 11, color: C.muted }}>@{t.targetChatUsername}</div>}
                  </td>
                  <td style={S.td}>
                    <a style={{ color: C.primary, cursor: "pointer" }} onClick={() => openUser(t.ownerTelegramId)}>
                      {t.ownerTelegramId}
                    </a>
                  </td>
                  <td style={S.td}>{fmt(t.pricePerAction)}</td>
                  <td style={S.td}>
                    {fmt(t.completedCount)}/{fmt(t.goalCount)}
                  </td>
                  <td style={S.td}>{t.reportCount ? <Badge color="red">🚩 {t.reportCount}</Badge> : ""}</td>
                  <td style={S.td}>
                    <StatusBadge status={t.status} />
                  </td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    {(t.status === "active" || t.status === "paused") && (
                      <>
                        <Btn small disabled={busyId === t._id} onClick={() => togglePause(t)} style={{ marginRight: 6 }}>
                          {t.status === "active" ? "Pause" : "Resume"}
                        </Btn>
                        <Btn small disabled={busyId === t._id} onClick={() => editPrice(t)} style={{ marginRight: 6 }}>
                          Price
                        </Btn>
                      </>
                    )}
                    {t.status !== "deleted" && (
                      <Btn small kind="danger" disabled={busyId === t._id} onClick={() => remove(t)}>
                        Delete
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} />
          </>
        )}
      </Card>
      {detail && <TaskModal id={detail} openUser={openUser} onClose={() => setDetail(null)} />}
    </div>
  );
}

function TaskModal({ id, onClose, openUser }) {
  const { data, loading, error } = useApi(`/api/admin/tasks?id=${id}`);
  if (!data) {
    return (
      <Modal title="Task" onClose={onClose} width={640}>
        {loading ? <Loading /> : <div style={{ color: "#fca5a5" }}>{error}</div>}
      </Modal>
    );
  }
  const { task: t, owner, submissionCount } = data;
  return (
    <Modal title={`${ICON[t.type] || ""} Task ${t.taskNumber ? `#${t.taskNumber}` : ""}`} onClose={onClose} width={680}>
      <KV label="Target">{t.targetChatTitle || t.targetChatId}</KV>
      <KV label="Chat id / link">
        {t.targetChatId} {t.targetInviteLink && <a style={{ color: C.primary }} href={t.targetInviteLink} target="_blank" rel="noreferrer">invite link</a>}
      </KV>
      <KV label="Owner">
        <a style={{ color: C.primary, cursor: "pointer" }} onClick={() => openUser(t.ownerTelegramId)}>
          {userLabel(owner, t.ownerTelegramId)}
        </a>
      </KV>
      <KV label="Status">
        <StatusBadge status={t.status} />
      </KV>
      <KV label="Price / progress">
        {fmt(t.pricePerAction)} GRAM · {fmt(t.completedCount)}/{fmt(t.goalCount)} done · {fmt(t.refundedCount || 0)} refunded for unsubscribes
      </KV>
      <KV label="Audience">
        {t.audienceMode} {t.languages && t.languages.length ? `· ${t.languages.join(", ")}` : ""} · paid with {t.paymentMethod}
      </KV>
      {t.requiresProof && <KV label="Conditions">{t.conditionText || "—"} <span style={{ color: C.muted }}>({submissionCount} screenshots)</span></KV>}
      <KV label="Created">{fmtDate(t.createdAt)}</KV>

      <div style={{ margin: "16px 0 6px", fontSize: 12, color: C.muted }}>🚩 Worker reports ({(t.reports || []).length})</div>
      {(t.reports || []).length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13 }}>None.</div>
      ) : (
        (t.reports || []).map((r, i) => (
          <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
            {r.reason} <span style={{ color: C.muted, fontSize: 11 }}>· user {r.telegramId} · {fmtDate(r.createdAt)}</span>
          </div>
        ))
      )}
    </Modal>
  );
}
