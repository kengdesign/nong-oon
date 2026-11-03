// One eligible record per action. Never include old schedules, future or expired doses.
export function actionableDoses(doses, version, now) {
  return doses.filter(d => d.status === 'pending' && d.scheduleVersion === version
    && Number.isFinite(d.dueAt) && Number.isFinite(d.expiresAt)
    && d.dueAt <= now && now < d.expiresAt)
    .sort((a,b) => b.dueAt-a.dueAt || String(a.doseId).localeCompare(String(b.doseId)));
}
