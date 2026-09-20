import { useEffect, useState } from "react";
import {
  api, qs, useApi, useUI, useDebounced, Modal, Btn, Badge, Chip, Pager, Card, Empty, Loading, SearchBox, Table, KV, Thumbs,
  StatusBadge, PRIORITY_COLOR, C, S, fmt, fmtDate, timeAgo, userLabel,
} from "./ui.js";
import { CATEGORY_LABEL } from "./Overview.js";

const STATUS_CHIPS = [
  ["active", "Needs action"],
  ["open", "Open"],
  ["in_review", "In review"],
  ["resolved", "Resolved"],
  ["rejected", "Rejected"],
  ["all", "All"],
];

export default function Reports({ openUser, openId, onOpenedId, onChanged, tick }) {
  const [status, setStatus] = useState("active");
  const [category, setCategory] = useState("all");
  const [unread, setUnread] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  useEffect(() => setPage(1), [status, category, unread, dq]);

  // Opened from the overview / a badge: jump straight to that report.
  useEffect(() => {
    if (openId) {
      setSelected(openId);
      onOpenedId && onOpenedId();
    }
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useApi(`/api/admin/reports${qs({ status, category, unread, q: dq, page, t: tick })}`);
  const d = list.data;
  const counts = d ? d.counts : {};
  const chipCount = (k) =>
    k === "active" ? (counts.open || 0) + (counts.in_review || 0) : k === "all" ? undefined : counts[k] || 0;

  return (
    <div>
      <div style={{ ...S.toolbar }}>
        {STATUS_CHIPS.map(([k, label]) => (
          <Chip key={k} active={status === k} onClick={() => setStatus(k)} count={d ? chipCount(k) : undefined}>
            {label}
          </Chip>
        ))}
        <Chip active={unread} onClick={() => setUnread(!unread)} dot>
          Unread only
        </Chip>
      </div>
      <div style={S.toolbar}>
        <SearchBox value={q} onChange={setQ} placeholder="Search report #, user id, @username, text…" />
        <select style={{ ...S.input, width: "auto" }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All topics</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
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
            <Table head={["", "#", "Topic", "From", "Message", "📸", "💬", "Priority", "Status", "Last activity"]} empty={d.items.length ? null : "No reports here."}>
              {d.items.map((r) => (
                <tr key={r._id} onClick={() => setSelected(r._id)} style={{ cursor: "pointer", background: r.unreadByAdmin ? "rgba(59,130,246,.07)" : "transparent" }}>
                  <td style={{ ...S.td, color: "#f87171", width: 14 }}>{r.unreadByAdmin ? "●" : ""}</td>
                  <td style={S.td}>#{r.reportNumber}</td>
                  <td style={S.td}>{CATEGORY_LABEL[r.category] || r.category}</td>
                  <td style={S.td}>
                    {r.reporterUsername ? `@${r.reporterUsername}` : r.reporterName || "—"}
                    <div style={{ fontSize: 11, color: C.muted }}>{r.reporterTelegramId}</div>
                  </td>
                  <td style={{ ...S.td, maxWidth: 320, color: C.muted }}>{r.text}</td>
                  <td style={S.td}>{r.photoCount || ""}</td>
                  <td style={S.td}>{r.replyCount || ""}</td>
                  <td style={S.td}>
                    <Badge color={PRIORITY_COLOR[r.priority]}>{r.priority}</Badge>
                  </td>
                  <td style={S.td}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td style={{ ...S.td, color: C.muted, whiteSpace: "nowrap" }}>{timeAgo(r.lastActivityAt)}</td>
                </tr>
              ))}
            </Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} />
          </>
        )}
      </Card>

      {selected && (
        <ReportModal
          id={selected}
          openUser={openUser}
          onClose={() => setSelected(null)}
          onChanged={() => {
            list.reload();
            onChanged && onChanged();
          }}
        />
      )}
    </div>
  );
}

function ReportModal({ id, onClose, onChanged, openUser }) {
  const { toast, ask } = useUI();
  const { data, loading, error, reload } = useApi(`/api/admin/reports?id=${id}`);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // The server marks the report read as soon as it is opened.
  const loadedId = data && data.report ? data.report._id : null;
  useEffect(() => {
    if (loadedId) onChanged();
  }, [loadedId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(body, okMsg) {
    setBusy(true);
    try {
      const r = await api("/api/admin/reports", { method: "PATCH", body: { id, ...body } });
      const failed = (r.delivery || []).filter((x) => !x.ok);
      if (failed.length) toast(`Saved, but the user could not be messaged: ${failed[0].error || "unknown error"}`, "warn");
      else toast(okMsg || "Saved");
      await reload();
      onChanged();
      return true;
    } catch (e) {
      toast(e.message, "err");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!reply.trim()) return;
    if (await patch({ reply }, "Reply sent to the user")) setReply("");
  }

  async function addNote() {
    if (!note.trim()) return;
    if (await patch({ note }, "Note added")) setNote("");
  }

  async function closeAs(status) {
    const v = await ask({
      title: status === "resolved" ? "Resolve this report" : "Reject this report",
      message:
        status === "resolved"
          ? "The reporter gets a message that it was resolved. Add what you did so they know."
          : "The reporter is told the report was closed without action. A reason is required.",
      fields: [
        {
          name: "resolution",
          label: status === "resolved" ? "What was done (shown to the user)" : "Reason (shown to the user)",
          type: "textarea",
          required: status === "rejected",
          minLength: status === "rejected" ? 3 : 0,
        },
        { name: "notify", label: "Send this to the user in the bot", type: "checkbox", defaultValue: true },
      ],
      confirmText: status === "resolved" ? "Resolve" : "Reject",
      danger: status === "rejected",
    });
    if (!v) return;
    await patch({ status, resolution: v.resolution, notifyUser: v.notify }, status === "resolved" ? "Report resolved" : "Report rejected");
  }

  if (loading && !data) {
    return (
      <Modal title="Report" onClose={onClose}>
        {error ? <div style={{ color: "#fca5a5" }}>{error}</div> : <Loading />}
      </Modal>
    );
  }
  if (!data) {
    return (
      <Modal title="Report" onClose={onClose}>
        <div style={{ color: "#fca5a5" }}>{error || "Could not load this report."}</div>
      </Modal>
    );
  }

  const { report: r, reporter, task, submission, reporterReportCount } = data;
  const closed = r.status === "resolved" || r.status === "rejected";

  return (
    <Modal
      title={
        <span>
          🆘 Report #{r.reportNumber} <StatusBadge status={r.status} />{" "}
          <Badge color={PRIORITY_COLOR[r.priority]}>{r.priority}</Badge>
        </span>
      }
      onClose={onClose}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
            {CATEGORY_LABEL[r.category] || r.category} · filed {fmtDate(r.createdAt)}
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {r.text}
          </div>

          <div style={{ margin: "14px 0 6px", fontSize: 12, color: C.muted }}>Screenshots ({(r.photos || []).length})</div>
          <Thumbs ids={r.photos} size={110} />

          {(task || submission) && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Related</div>
              {task && (
                <KV label="Task">
                  {task.taskNumber ? `#${task.taskNumber} ` : ""}
                  {task.targetChatTitle || task.targetChatId} · {task.type} · {fmt(task.pricePerAction)} GRAM · <StatusBadge status={task.status} />
                  {task.conditionText && <div style={{ color: C.muted, fontSize: 12 }}>Conditions: {task.conditionText}</div>}
                </KV>
              )}
              {submission && (
                <KV label="Submission">
                  #{submission.submissionNumber ?? "—"} · <StatusBadge status={submission.status} />
                  {submission.rejectReason && <div style={{ color: C.muted, fontSize: 12 }}>Reject reason: {submission.rejectReason}</div>}
                  <div style={{ marginTop: 6 }}>
                    <Thumbs ids={[submission.photoFileId]} size={90} />
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                    Manage it in the Submissions tab (search “{submission.submissionNumber}”).
                  </div>
                </KV>
              )}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Reporter</div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>{userLabel(reporter, r.reporterTelegramId)}</div>
            <div style={{ color: C.muted, fontSize: 12 }}>
              ID {r.reporterTelegramId} · {reporterReportCount} report{reporterReportCount === 1 ? "" : "s"} total
              {reporter && (
                <>
                  {" "}
                  · balance {fmt((reporter.donatedBalance || 0) + (reporter.earnedBalance || 0))} GRAM
                </>
              )}
            </div>
            {reporter && reporter.isBanned && (
              <div style={{ marginTop: 6 }}>
                <Badge color="red">BANNED</Badge> <span style={{ color: C.muted, fontSize: 12 }}>{reporter.banReason}</span>
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <Btn small onClick={() => openUser(r.reporterTelegramId)}>
                Open user (ban / balance / message)
              </Btn>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "14px 0" }}>
            {r.status !== "in_review" && !closed && (
              <Btn small disabled={busy} onClick={() => patch({ status: "in_review" }, "Marked in review")}>
                🔎 In review
              </Btn>
            )}
            {!closed && (
              <>
                <Btn small kind="success" disabled={busy} onClick={() => closeAs("resolved")}>
                  ✅ Resolve
                </Btn>
                <Btn small kind="danger" disabled={busy} onClick={() => closeAs("rejected")}>
                  ❌ Reject
                </Btn>
              </>
            )}
            {closed && (
              <Btn small disabled={busy} onClick={() => patch({ status: "open" }, "Report re-opened")}>
                ↩ Re-open
              </Btn>
            )}
            <select
              style={{ ...S.input, width: "auto", padding: "4px 8px", fontSize: 12 }}
              value={r.priority}
              disabled={busy}
              onChange={(e) => patch({ priority: e.target.value }, "Priority updated")}
            >
              {["low", "normal", "high", "urgent"].map((p) => (
                <option key={p} value={p}>
                  priority: {p}
                </option>
              ))}
            </select>
          </div>

          {closed && r.resolution && (
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
              📌 {r.status === "resolved" ? "Resolution" : "Reason"} ({fmtDate(r.resolvedAt)}): {r.resolution}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20, fontSize: 12, color: C.muted }}>Conversation with the user</div>
      <div style={{ display: "grid", gap: 8, margin: "8px 0 12px" }}>
        {(r.replies || []).length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No replies yet.</div>}
        {(r.replies || []).map((m) => (
          <div
            key={m._id}
            style={{
              justifySelf: m.from === "admin" ? "end" : "start",
              maxWidth: "88%",
              background: m.from === "admin" ? "#172554" : C.panel2,
              border: `1px solid ${m.from === "admin" ? "#1e3a8a" : C.border}`,
              borderRadius: 12,
              padding: "8px 12px",
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>
              {m.from === "admin" ? "You (sent via bot)" : "User"} · {fmtDate(m.createdAt)}
            </div>
            {m.text}
            {m.photos && m.photos.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <Thumbs ids={m.photos} size={80} />
              </div>
            )}
          </div>
        ))}
      </div>
      <textarea
        style={{ ...S.input, minHeight: 80, resize: "vertical" }}
        placeholder="Write a reply — it is sent to the user in the bot right away…"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
      />
      <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
        <Btn kind="primary" disabled={busy || !reply.trim()} onClick={sendReply}>
          📨 Send reply to user
        </Btn>
      </div>

      <div style={{ marginTop: 20, fontSize: 12, color: C.muted }}>🔒 Private notes (only admins see these)</div>
      <div style={{ display: "grid", gap: 6, margin: "8px 0" }}>
        {(r.notes || []).map((n) => (
          <div key={n._id} style={{ background: "#2b2410", border: "1px solid #5b4a12", borderRadius: 8, padding: "6px 10px", fontSize: 13, whiteSpace: "pre-wrap" }}>
            {n.text}
            <div style={{ fontSize: 11, color: C.muted }}>
              {n.by} · {fmtDate(n.createdAt)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={S.input} placeholder="Add a private note (what you checked, what you decided…)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
        <Btn disabled={busy || !note.trim()} onClick={addNote}>
          Add note
        </Btn>
      </div>
    </Modal>
  );
}
