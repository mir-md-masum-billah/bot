import { useEffect, useState } from "react";
import { api, qs, useApi, useUI, useDebounced, Btn, Chip, Pager, Card, Loading, SearchBox, Table, Thumbs, StatusBadge, C, S, fmt, fmtDate, userLabel } from "./ui.js";

const CHIPS = [
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["", "All"],
];

export default function Submissions({ openUser, onChanged, tick, initialQuery }) {
  const { toast, ask } = useUI();
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState(initialQuery || "");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => setPage(1), [status, dq]);

  const list = useApi(`/api/admin/submissions${qs({ status, q: dq, page, t: tick })}`);
  const d = list.data;
  const counts = d ? d.counts : {};

  async function review(sub, action) {
    const price = sub.task ? fmt(sub.task.pricePerAction) : "the reward";
    let title, message, fields, confirmText, danger = false;

    if (action === "approve" && sub.status === "pending") {
      title = "Approve this screenshot";
      message = `You are doing the owner's job. The worker receives +${price} GRAM. Nobody is penalized.`;
      fields = [{ name: "note", label: "Note (optional, kept in the record)", type: "text" }];
      confirmText = "Approve & pay worker";
    } else if (action === "approve") {
      title = "Overturn the rejection";
      message =
        `The owner rejected this. Approving it will:\n• pay the WORKER +${price} GRAM\n• take ${price} GRAM from the OWNER as a penalty and send them a warning.`;
      fields = [{ name: "note", label: "Reason (shown to the owner)", type: "textarea", required: true, minLength: 3 }];
      confirmText = "Overturn & penalize owner";
      danger = true;
    } else if (sub.status === "approved") {
      title = "Reverse this approval";
      message = `This takes ${price} GRAM back from the WORKER (never below 0) and sends them a warning.`;
      fields = [{ name: "note", label: "Reason (shown to the worker)", type: "textarea", required: true, minLength: 3 }];
      confirmText = "Reverse & claw back";
      danger = true;
    } else {
      title = "Reject this screenshot";
      message = "No coins are taken (nobody was paid yet). The worker is told the reason and can dispute it.";
      fields = [{ name: "note", label: "Reason (shown to the worker)", type: "textarea", required: true, minLength: 3 }];
      confirmText = "Reject";
      danger = true;
    }

    const v = await ask({ title, message, fields, confirmText, danger });
    if (!v) return;
    setBusyId(sub._id);
    try {
      await api("/api/admin/submissions", { method: "POST", body: { id: sub._id, action, note: v.note || undefined } });
      toast("Done");
      list.reload();
      onChanged && onChanged();
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div style={S.toolbar}>
        {CHIPS.map(([k, label]) => (
          <Chip key={k || "all"} active={status === k} onClick={() => setStatus(k)} count={d ? (k ? counts[k] || 0 : undefined) : undefined}>
            {label}
          </Chip>
        ))}
        <SearchBox value={q} onChange={setQ} placeholder="Search user id or submission #…" />
        <Btn onClick={list.reload}>↻ Refresh</Btn>
      </div>
      <Card>
        {list.error && <div style={{ color: "#fca5a5", marginBottom: 10 }}>{list.error}</div>}
        {!d ? (
          <Loading />
        ) : (
          <>
            <Table head={["#", "Screenshot", "Task / conditions", "Worker", "Owner", "Status", "Decision", "Actions"]} empty={d.items.length ? null : "No submissions."}>
              {d.items.map((sub) => (
                <tr key={sub._id}>
                  <td style={S.td}>#{sub.submissionNumber ?? "—"}<div style={{ fontSize: 11, color: C.muted }}>{fmtDate(sub.createdAt)}</div></td>
                  <td style={S.td}>
                    <Thumbs ids={[sub.photoFileId]} size={64} />
                  </td>
                  <td style={{ ...S.td, maxWidth: 260 }}>
                    {sub.task ? (
                      <>
                        <div>{sub.task.targetChatTitle || sub.task.targetChatId}</div>
                        <div style={{ fontSize: 12, color: C.muted }}>{fmt(sub.task.pricePerAction)} GRAM</div>
                        {sub.task.conditionText && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>📝 {sub.task.conditionText}</div>}
                      </>
                    ) : (
                      <span style={{ color: C.muted }}>task removed</span>
                    )}
                  </td>
                  <td style={S.td}>
                    <a style={{ color: C.primary, cursor: "pointer" }} onClick={() => openUser(sub.workerTelegramId)}>
                      {userLabel(sub.worker, sub.workerTelegramId)}
                    </a>
                  </td>
                  <td style={S.td}>
                    <a style={{ color: C.primary, cursor: "pointer" }} onClick={() => openUser(sub.ownerTelegramId)}>
                      {userLabel(sub.owner, sub.ownerTelegramId)}
                    </a>
                  </td>
                  <td style={S.td}>
                    <StatusBadge status={sub.status} />
                    {sub.adminOverrode && <div style={{ color: "#f87171", fontSize: 11, marginTop: 4 }}>overridden by admin</div>}
                    {sub.status === "pending" && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>auto-approves {fmtDate(sub.expiresAt)}</div>}
                  </td>
                  <td style={{ ...S.td, maxWidth: 240, fontSize: 12 }}>
                    <div>{sub.decidedBy ? `by ${sub.decidedBy}` : "—"}</div>
                    {(sub.adminNote || sub.rejectReason) && <div style={{ color: C.muted }}>{sub.adminNote || sub.rejectReason}</div>}
                  </td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    {sub.status !== "approved" && (
                      <Btn small kind="success" disabled={busyId === sub._id} onClick={() => review(sub, "approve")} style={{ marginRight: 6 }}>
                        {sub.status === "rejected" ? "Overturn ✓" : "Approve"}
                      </Btn>
                    )}
                    {sub.status !== "rejected" && (
                      <Btn small kind="danger" disabled={busyId === sub._id} onClick={() => review(sub, "reject")}>
                        {sub.status === "approved" ? "Reverse ✗" : "Reject"}
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
    </div>
  );
}
