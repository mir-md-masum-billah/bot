import { checkCredentials, createSessionCookie } from "../../../lib/adminAuth.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const { username, password } = req.body || {};
  if (!checkCredentials(username, password)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  res.setHeader("Set-Cookie", createSessionCookie());
  res.status(200).json({ ok: true });
}
