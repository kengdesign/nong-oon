# Phase 3 integration and LIFF feedback correction

The previously deployed production source supplied by the owner is reconciled onto main. This includes continuous delivery configuration tooling, 15 minute snooze, caregiver escalation after 30 minutes, LIFF navigation/login, emergency contacts, dose confirmation and the voice-consent foundation. No production configuration, recipient allowlist, credentials, backups or patient records are committed.

## UI correction
The reported green “unused invite codes cancelled” label was persistent global feedback, not the family action button. Cancellation success now belongs to a static live status inside the family component. Navigation destroys that component. Other feedback clears on tab navigation and expires after five seconds. Replacing a message cancels its previous timer.

## Voice and OCR increment
Existing LINE audio transcription and private label-review pipelines are retained. Explicit taken commands accept Thai polite suffixes and the verb รับประทาน, while questions, negations and mixed instructions cannot automatically acknowledge a round. An acknowledgement still requires the owner's explicit confirmation. Explicitly labelled OCR dates, weekdays and times can contain Thai digits; evidence retains the original text. No clock time or regimen is inferred from meal instructions. Settings now links directly to the existing image/audio review screen.

## Deployment
For an installation that already completed Phase 3, extract the update in the same project root and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\deploy-ui-voice-ocr.ps1'
```

This script checks the existing production config and active Phase 3 flags, runs checks/tests and a pinned Wrangler dry run, then deploys with that unchanged config. It does not migrate the database or rebuild delivery settings. The older deploy-phase3.ps1 is for first-time Phase 3 migration, not this UI update. Close and reopen LIFF afterwards.

## Evidence and limitations
The owner reports real-device success for snooze, acknowledgement history and suppression after acknowledgement. Caregiver handset receipt is not yet independently demonstrated. Local SQLite tests and a minimal DOM regression cover the implementation; real-browser execution was unavailable because this runtime has no installed Chromium binary. Provider accuracy on real Thai audio/photos remains to be measured. No production deployment of this UI update has been performed by the development runtime.
