// Transcription is a proposal, never a medication instruction or automatic mutation.
export function classifyVoiceIntent(text) {
  const value = String(text ?? '').trim().normalize('NFC').replace(/\s+/g, '').replace(/[.!。！]+$/u, '');
  if (/^(?:ทาน|กิน|รับประทาน)ยา(?:ไป)?แล้ว(?:ครับ|ค่ะ|คะ)?$/u.test(value)) return { intent: 'propose_taken', requiresConfirmation: true };
  if (/^(?:ทาน|กิน|รับประทาน)ยา(?:ไป)?แล้ว(?:รึยัง|หรือยัง)(?:ครับ|ค่ะ|คะ)?[?？]?$/u.test(value)) return { intent: 'read_status', requiresConfirmation: false };
  return { intent: 'unknown', requiresConfirmation: false };
}
