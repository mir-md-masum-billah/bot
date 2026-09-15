export default function Home() {
  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>📢 Promotion Bot</h1>
        <p style={styles.text}>
          This server hosts the Telegram bot webhook and its admin dashboard.
        </p>
        <a href="/admin" style={styles.link}>
          Go to Admin Dashboard →
        </a>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f172a",
    fontFamily: "system-ui, sans-serif",
  },
  card: {
    background: "#1e293b",
    padding: "40px",
    borderRadius: "16px",
    textAlign: "center",
    color: "#f8fafc",
  },
  title: { margin: 0, marginBottom: "8px" },
  text: { color: "#94a3b8", marginBottom: "20px" },
  link: {
    display: "inline-block",
    padding: "10px 18px",
    borderRadius: "8px",
    background: "#3b82f6",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 600,
  },
};
