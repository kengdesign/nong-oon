# Voice command review flow

Follow-up to PR #42, which the owner deployed successfully. Public health and feedback.mjs were fetched after the deployment and match the active delivery flag and feedback implementation. No new reminder was sent by the development runtime.

Short voice commands with a recognized intent now get a dedicated review card instead of an empty new-medication schedule form. Taken commands link to the selected patient's current rounds for an explicit acknowledgement; status questions link to that patient's recorded history. Neither rendering nor following these links writes a report. Unknown intent retains the existing manual schedule-review flow, so a longer dictated prescription remains reviewable. The source audio remains available under the existing private endpoint and consent/expiry rules.

The image/audio list explains how to submit a clear LINE photo or audio note and avoid duplicate uploads while processing. Failed jobs show a plain-language recovery message. No new AI calls, endpoint, config, database migration or dependency is added.

Deploy only after the successful Phase 3 installation, from that same project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\deploy-media-review.ps1'
```

This uses the existing active config unchanged. Local automated tests use synthetic inputs and a minimal DOM; handset rendering and recognition accuracy with real audio/photos still require real-device verification. This follow-up has not been deployed by the development runtime.
