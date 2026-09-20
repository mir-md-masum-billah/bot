import { useEffect, useState } from "react";
import { qs, useApi, useDebounced, Btn, Badge, Pager, Card, Loading, SearchBox, Table, C, S, fmtDate } from "./ui.js";

const GROUPS = [
  ["all", "All actions"],
  ["user", "Users (ban, balance, message)"],
  ["report", "Reports"],
  ["submission", "Screenshots"],
  ["task", "Tasks"],
  ["broadcast", "Broadcasts"],
];

const colorFor = (a) =>
  a.includes("delete") || a.includes("reject") || a.includes("ban") ? "red" : a.startsWith("report") ? "blue" : a.startsWith("broadcast") ? "purple" : "gray";

export default function ActivityLog({ tick }) {
  const [action, setAction] = useState("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [action, dq]);

  const list = useApi(`/api/admin/logs${qs({ action, q: dq, page, t: tick })}`);
  const d = list.data;

  return (
    <div>
      <div style={S.toolbar}>
        <SearchBox value={q} onChange={setQ} placeholder="Search the log (id, text)…" />
        <select style={{ ...S.input, width: "auto" }} value={action} onChange={(e) => setAction(e.target.value)}>
          {GROUPS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Btn onClick={list.reload}>↻ Refresh</Btn>
      </div>
      <Card title="Everything done from this dashboard is recorded here">
        {list.error && <div style={{ color: "#fca5a5", marginBottom: 10 }}>{list.error}</div>}
        {!d ? (
          <Loading />
        ) : (
          <>
            <Table head={["When", "Action", "What happened", "Target", "IP"]} empty={d.items.length ? null : "Nothing logged yet."}>
              {d.items.map((l) => (
                <tr key={l._id}>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{fmtDate(l.createdAt)}</td>
                  <td style={S.td}>
                    <Badge color={colorFor(l.action)}>{l.action}</Badge>
                  </td>
                  <td style={{ ...S.td, maxWidth: 520 }}>{l.summary}</td>
                  <td style={{ ...S.td, color: C.muted, fontSize: 12 }}>
                    {l.targetType}
                    {l.targetId ? ` · ${String(l.targetId).slice(-10)}` : ""}
                  </td>
                  <td style={{ ...S.td, color: C.muted, fontSize: 12 }}>{l.ip}</td>
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
