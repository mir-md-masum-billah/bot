import mongoose from "mongoose";

// A single document per counter `name`, atomically incremented. Used to
// generate the sequential "Task №123,456 completed" number shown to users
// after a successful earn-check — purely cosmetic, not a database key.
const CounterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  value: { type: Number, default: 0 },
});

const Counter = mongoose.models.Counter || mongoose.model("Counter", CounterSchema);

export async function nextCounterValue(name, startAt = 0) {
  const doc = await Counter.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // First-ever increment on a brand new counter starts from startAt+1
  // instead of 1, so the displayed numbers can start somewhere realistic.
  return doc.value === 1 && startAt > 0 ? startAt + 1 : doc.value;
}

export default Counter;
