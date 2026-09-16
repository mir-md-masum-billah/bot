import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable");
}

// Cache the connection across serverless invocations to avoid
// exhausting MongoDB connections on every request.
let cached = global._mongoose;
if (!cached) {
  cached = global._mongoose = { conn: null, promise: null };
}

export async function dbConnect() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
      })
      .then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    // Without this, a single failed connect (Atlas blip, cold-start DNS
    // hiccup) leaves a permanently rejected promise in the cache and every
    // later update handled by this warm container fails too.
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}
