// A tap is only an attempt to open the dialer, never evidence of a completed call.
export function nextContact(contacts, attempt, now = Date.now()) {
  if (!attempt || now < attempt.at || now - attempt.at >= 30 * 60 * 1000) return null;
  const ordered = [...contacts].sort((a,b) => a.priority-b.priority);
  const index = ordered.findIndex(c => c.priority === attempt.priority && c.phone === attempt.phone);
  return index < 0 ? null : ordered[index+1] ?? null;
}
