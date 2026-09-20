import { useEffect, useState } from "react";
import { qs, useApi, useDebounced, Btn, Pager, Card, Loading, SearchBox, Table, C, S, fmt, fmtDate } from "./ui.js";

const TYPES = ["earn_task", "spend_task", "donate", "refund", "commission", "admin_adjust", "submission_penalty"];

export default function Transactions({ openUser, tick, initialUser }) {
  const [who, setWho] = useState(initialUser ? String(initialUser) : "");
  const dwho = useDebounced(who);
  const [type, setType] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [dwho, type]);
  useEffect(() => {
    if (initialUser) setWho(String(initialUser));
  }, [initialUser]);

  const list = useApi(`/api/admin/transactions${qs({ telegramId: dwho, type, page, t: tick })}`);
  const d = list.data;

  return (
    <div>
      <div style={S.toolbar}>
        <SearchBox value={who} onChange={setWho} placeholder="Filter by Telegram ID…" />
        <select style={{ ...S.input, width: "auto" }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
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
            <Table head={["When", "User", "Type", "Amount", "Note"]} empty={d.items.length ? null : "No transactions."}>
              {d.items.map((t) => (
                <tr key={t._id}>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{fmtDate(t.createdAt)}</td>
                  <td style={S.td}>
                    <a style={{ color: C.primary, cursor: "pointer" }} onClick={() => openUser(t.telegramId)}>
                      {t.userName || t.telegramId}
                    </a>
                    <div style={{ fontSize: 11, color: C.muted }}>{t.telegramId}</div>
                  </td>
                  <td style={S.td}>{t.type}</td>
                  <td style={{ ...S.td, color: t.amount < 0 ? "#fca5a5" : "#86efac", fontWeight: 600 }}>
                    {t.amount > 0 ? "+" : ""}
                    {fmt(t.amount)}
                  </td>
                  <td style={{ ...S.td, color: C.muted }}>{t.note || ""}</td>
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
