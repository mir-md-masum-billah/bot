import Head from "next/head";
import { useEffect, useRef, useState } from "react";

// Human-verification "drag the puzzle piece" widget, opened by the bot as a
// Telegram WebApp (see humanVerifyMenu in bot/keyboards.js). Solving it
// POSTs Telegram.WebApp.initData to /api/verify, which checks Telegram's
// signature server-side and marks the user verified directly in the
// database — see pages/api/verify.js for why this replaced the original
// sendData()-based approach (sendData only works for reply-keyboard Mini
// Apps, not the inline "Verify" button used here, so the bot never
// actually heard about it).
//
// This is a simple horizontal drag-to-target puzzle, not a security
// mechanism — it's friction against casual bots/scripts, not a real CAPTCHA
// service. Swap in a real provider here if you need stronger protection.
export default function Verify() {
  const trackRef = useRef(null);
  const [maxOffset, setMaxOffset] = useState(1);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | saving | done | error
  const dragStartRef = useRef({ pointerX: 0, offset: 0 });

  const PIECE_SIZE = 64;
  const SUCCESS_RATIO = 0.9;

  useEffect(() => {
    const tg = typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
    function measure() {
      if (trackRef.current) {
        setMaxOffset(Math.max(1, trackRef.current.offsetWidth - PIECE_SIZE));
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  async function reportSuccess() {
    const tg = typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp;
    setSolved(true);
    setOffset(maxOffset);
    setTimeout(async () => {
      const initData = tg && tg.initData;
      if (!initData) {
        // Opened outside Telegram (e.g. testing in a plain browser) — nothing
        // to verify against, just no-op instead of throwing.
        return;
      }
      setStatus("saving");
      try {
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          setStatus("done");
          setTimeout(() => {
            try {
              tg.close();
            } catch (e) {
              // ignore
            }
          }, 700);
        } else {
          setStatus("error");
        }
      } catch (e) {
        setStatus("error");
      }
    }, 650);
  }

  function retry() {
    setSolved(false);
    setOffset(0);
    setStatus("idle");
  }

  function onPointerDown(e) {
    if (solved) return;
    setDragging(true);
    dragStartRef.current = {
      pointerX: e.clientX ?? e.touches?.[0]?.clientX ?? 0,
      offset,
    };
    e.target.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging || solved) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const delta = x - dragStartRef.current.pointerX;
    const next = Math.min(maxOffset, Math.max(0, dragStartRef.current.offset + delta));
    setOffset(next);
  }

  function onPointerUp() {
    if (!dragging || solved) return;
    setDragging(false);
    if (offset >= maxOffset * SUCCESS_RATIO) {
      reportSuccess();
    } else {
      setOffset(0);
    }
  }

  const progress = Math.round((offset / maxOffset) * 100);

  return (
    <div style={styles.page}>
      <Head>
        <title>Verify you're human</title>
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </Head>

      <div style={styles.card}>
        <h1 style={styles.title}>Verify you're human</h1>

        <div style={styles.progressRow}>
          <span style={styles.progressLabel}>🖐 Drag the puzzle piece</span>
          <div style={styles.progressBarOuter}>
            <div style={{ ...styles.progressBarInner, width: `${progress}%` }} />
          </div>
          <span style={styles.progressPct}>{progress}%</span>
        </div>

        <div ref={trackRef} style={styles.puzzleArea}>
          <div style={styles.watermark}>PR GRAM</div>

          <div style={styles.slotOutline} />

          <div
            style={{
              ...styles.piece,
              transform: `translateY(-50%) translateX(${offset}px)`,
              cursor: solved ? "default" : dragging ? "grabbing" : "grab",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
          />

          {solved && (
            <div style={styles.perfectBadge}>
              <span style={{ marginRight: 6 }}>✓</span> Perfect!
            </div>
          )}
        </div>

        {status === "idle" && <p style={styles.hint}>ⓘ Place the piece in the matching slot</p>}
        {status === "saving" && <p style={styles.hint}>Confirming with Telegram…</p>}
        {status === "done" && (
          <p style={{ ...styles.hint, color: GREEN }}>
            ✅ Verified! Closing — go back and tap Continue.
          </p>
        )}
        {status === "error" && (
          <>
            <p style={{ ...styles.hint, color: "#f87171" }}>
              Couldn't confirm verification. Please try again.
            </p>
            <button style={styles.accessibleLink} onClick={retry}>
              Try again
            </button>
          </>
        )}

        {!solved && (
          <button style={styles.accessibleLink} onClick={reportSuccess}>
            Use accessible verification
          </button>
        )}
      </div>
    </div>
  );
}

const GREEN = "#22c55e";

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#111827",
    fontFamily: "system-ui, sans-serif",
    padding: "16px",
    touchAction: "none",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    color: "#f8fafc",
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 20px",
  },
  progressRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
    fontSize: 14,
    color: "#cbd5e1",
  },
  progressLabel: { whiteSpace: "nowrap" },
  progressBarOuter: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    background: "#1f2937",
    overflow: "hidden",
  },
  progressBarInner: {
    height: "100%",
    background: GREEN,
    transition: "width 0.05s linear",
  },
  progressPct: { color: GREEN, fontWeight: 600, minWidth: 36, textAlign: "right" },
  puzzleArea: {
    position: "relative",
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: 20,
    background: "linear-gradient(135deg, #052e1a, #0a3d24)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
  },
  watermark: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 42,
    fontWeight: 800,
    color: "rgba(255,255,255,0.08)",
    userSelect: "none",
  },
  slotOutline: {
    position: "absolute",
    top: "50%",
    right: 24,
    transform: "translateY(-50%)",
    width: 64,
    height: 64,
    borderRadius: 14,
    border: "2px dashed rgba(255,255,255,0.35)",
  },
  piece: {
    position: "absolute",
    top: "50%",
    left: 24,
    transform: "translateY(-50%)",
    width: 64,
    height: 64,
    borderRadius: 14,
    background: "#e5e7eb",
    boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
    touchAction: "none",
  },
  perfectBadge: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: GREEN,
    color: "#052e1a",
    fontWeight: 700,
    padding: "10px 20px",
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
  },
  hint: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 14,
  },
  accessibleLink: {
    marginTop: 6,
    background: "none",
    border: "none",
    color: "#93c5fd",
    textDecoration: "underline",
    fontSize: 14,
    padding: 0,
    cursor: "pointer",
  },
};
