import { useEffect, useRef, useState } from "react";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME;

export default function AddBotPage() {
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [activeToken, setActiveToken] = useState(null);
  const [activeType, setActiveType] = useState(null);
  const [status, setStatus] = useState(null); // pending | verified | failed | expired
  const [statusDetail, setStatusDetail] = useState(null);
  const [error, setError] = useState(null);
  const widgetContainerRef = useRef(null);

  // ---- Telegram Login Widget (only needed for the Channel flow, since
  // channel deep links can't carry a token — see README-ADD-BOT.md) ----
  useEffect(() => {
    if (!widgetContainerRef.current || telegramConnected) return;

    window.onTelegramAuth = async (user) => {
      try {
        const res = await fetch("/api/telegram/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        if (!res.ok) throw new Error("Telegram login verification failed");
        setTelegramConnected(true);
      } catch (err) {
        setError("Telegram account যাচাই করা যায়নি, আবার চেষ্টা করুন।");
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    widgetContainerRef.current.innerHTML = "";
    widgetContainerRef.current.appendChild(script);
  }, [telegramConnected]);

  // ---- Poll status once a request is in flight ----
  useEffect(() => {
    if (!activeToken || status === "verified" || status === "failed" || status === "expired") {
      return;
    }
    const interval = setInterval(async () => {
      const res = await fetch(`/api/telegram/status/${activeToken}`);
      const data = await res.json();
      setStatus(data.status);
      setStatusDetail(data);
    }, 2000);
    return () => clearInterval(interval);
  }, [activeToken, status]);

  async function startAddFlow(type) {
    setError(null);
    setStatus(null);
    setStatusDetail(null);

    if (type === "channel" && !telegramConnected) {
      setError("প্রথমে উপরের Telegram বাটন দিয়ে আপনার Telegram account connect করুন।");
      return;
    }

    try {
      const res = await fetch("/api/telegram/create-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "Request তৈরি করা যায়নি।");
        return;
      }
      setActiveToken(data.token);
      setActiveType(type);
      setStatus("pending");
      // Opens Telegram's native "Choose a Channel"/"Choose a Group"
      // selector — this is Telegram's own UI, not anything custom-built.
      window.open(data.deepLink, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError("কিছু একটা ভুল হয়েছে, আবার চেষ্টা করুন।");
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h2>Telegram Bot যোগ করুন</h2>

      <div ref={widgetContainerRef} style={{ marginBottom: 16 }} />
      {!telegramConnected && (
        <p style={{ fontSize: 13, color: "#666" }}>
          Channel-এ bot add করতে হলে প্রথমে Telegram দিয়ে sign in করুন — Group-এর
          জন্য এটা লাগবে না।
        </p>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={() => startAddFlow("channel")}>📢 Add to Channel</button>
        <button onClick={() => startAddFlow("group")}>👥 Add to Group</button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {status && (
        <div style={{ marginTop: 20, padding: 12, border: "1px solid #ddd" }}>
          {status === "pending" && (
            <p>
              Telegram-এ {activeType === "channel" ? "channel" : "group"} select করে bot
              add করুন — এখানে automatically আপডেট হবে।
            </p>
          )}
          {status === "verified" && (
            <p style={{ color: "green" }}>
              ✅ Bot সফলভাবে "{statusDetail?.chatTitle}"-তে admin হিসেবে যোগ হয়েছে।
              {statusDetail?.failureReason?.startsWith("missing_permissions") && (
                <>
                  {" "}
                  (কিছু permission মিসিং: {statusDetail.failureReason.replace(
                    "missing_permissions:",
                    ""
                  )})
                </>
              )}
            </p>
          )}
          {status === "failed" && (
            <p style={{ color: "crimson" }}>
              ❌ Bot admin হিসেবে verify করা যায়নি ({statusDetail?.failureReason}).
            </p>
          )}
          {status === "expired" && <p>⏱️ Request-এর সময় শেষ, আবার চেষ্টা করুন।</p>}
        </div>
      )}
    </div>
  );
}
