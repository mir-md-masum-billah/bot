import { useEffect, useRef, useState } from "react";
import { api, useApi, useUI, Btn, Card, C, S, fmt } from "./ui.js";

const MAX = 3500;

export default function Broadcast() {
  const { toast, ask } = useUI();
  const [text, setText] = useState("");
  const [respectMute, setRespectMute] = useState(true);
  const [testTo, setTestTo] = useState("");
  const [run, setRun] = useState(null); // { sent, failed, done, stopped }
  const stopRef = useRef(false);
  const aud = useApi(`/api/admin/broadcast?respectMute=${respectMute ? 1 : 0}`);
  const audience = aud.data ? aud.data.audience : null;

  useEffect(() => () => {
    stopRef.current = true;
  }, []);

  async function sendTest() {
    if (!text.trim() || !testTo.trim()) return;
    try {
      const r = await api("/api/admin/broadcast", { method: "POST", body: { message: text, testTo: Number(testTo) } });
      toast(r.ok ? "Test message delivered" : `Not delivered: ${r.error}`, r.ok ? "ok" : "warn");
    } catch (e) {
      toast(e.message, "err");
    }
  }

  async function start() {
    const v = await ask({
      title: "Send to everyone?",
      message: `This sends your message to ${fmt(audience)} users right now and cannot be undone.\n\n“${text.slice(0, 200)}${text.length > 200 ? "…" : ""}”`,
      fields: [{ name: "confirm", label: "Type SEND to confirm", type: "text", required: true }],
      confirmText: "Send broadcast",
      danger: true,
    });
    if (!v || v.confirm.trim().toUpperCase() !== "SEND") {
      if (v) toast("Not sent — you must type SEND", "warn");
      return;
    }
    stopRef.current = false;
    let cursor = 0;
    let totals = { sent: 0, failed: 0 };
    setRun({ ...totals, done: false, stopped: false });
    try {
      // Keep asking the server for the next batch until it says it's done.
      for (;;) {
        const r = await api("/api/admin/broadcast", { method: "POST", body: { message: text, cursor, respectMute, totals } });
        totals = { sent: totals.sent + r.sent, failed: totals.failed + r.failed };
        cursor = r.nextCursor;
        setRun({ ...totals, done: r.done, stopped: false });
        if (r.done) break;
        if (stopRef.current) {
          setRun({ ...totals, done: true, stopped: true });
          toast("Stopped. Users already messaged keep the message.", "warn");
          return;
        }
      }
      toast(`Broadcast finished: ${fmt(totals.sent)} delivered`);
    } catch (e) {
      setRun({ ...totals, done: true, stopped: true });
      toast(`Broadcast interrupted: ${e.message}`, "err");
    }
  }

  const running = run && !run.done;
  const pct = audience && run ? Math.min(100, Math.round(((run.sent + run.failed) / Math.max(1, audience)) * 100)) : 0;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      <Card title="📢 Broadcast a message to bot users">
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
          Plain text only. Banned users never receive it. Send a test to yourself first (your Telegram ID, and you must have started the bot).
        </div>
        <textarea
          style={{ ...S.input, minHeight: 150, resize: "vertical" }}
          maxLength={MAX}
          placeholder="Write your announcement…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={running}
        />
        <div style={{ fontSize: 11, color: C.muted, textAlign: "right" }}>
          {text.length}/{MAX}
        </div>

        <label style={{ display: "flex", gap: 8, fontSize: 13, margin: "10px 0", alignItems: "center" }}>
          <input type="checkbox" checked={respectMute} onChange={(e) => setRespectMute(e.target.checked)} disabled={running} />
          Skip users who turned notifications off
        </label>
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          Audience: <b>{audience === null ? "…" : fmt(audience)}</b> users
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...S.input, maxWidth: 200 }} placeholder="Your Telegram ID" value={testTo} onChange={(e) => setTestTo(e.target.value.replace(/\D/g, ""))} />
          <Btn disabled={!text.trim() || !testTo || running} onClick={sendTest}>
            Send test to me
          </Btn>
          <span style={{ flex: 1 }} />
          {running ? (
            <Btn kind="danger" onClick={() => (stopRef.current = true)}>
              ⏹ Stop after this batch
            </Btn>
          ) : (
            <Btn kind="primary" disabled={!text.trim() || !audience} onClick={start}>
              🚀 Send to everyone
            </Btn>
          )}
        </div>

        {run && (
          <div style={{ marginTop: 16 }}>
            <div style={{ height: 8, background: C.bg, borderRadius: 999, overflow: "hidden", border: `1px solid ${C.border}` }}>
              <div style={{ width: `${run.done && !run.stopped ? 100 : pct}%`, height: "100%", background: run.stopped ? C.amber : C.green, transition: "width .3s" }} />
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              ✅ {fmt(run.sent)} delivered · ❌ {fmt(run.failed)} failed (blocked the bot) {run.done ? (run.stopped ? "· stopped" : "· finished") : "· sending…"}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
