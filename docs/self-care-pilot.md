# Single-account self-care pilot

SELF_CARE_ONLY=true limits the pilot to the record owner. No second real LINE account is required for this scope. The UI omits invitation acceptance and the caregiver tab, and the API rejects invitation creation/acceptance and denies existing caregiver access while preserving owner access and member revocation.

Synthetic identities are used only in isolated automated tests, never provisioned through a production login bypass or linked to the owner's data. Existing tests cover invitation expiry/replay, limited grants, reporting and revocation. These tests do not prove a second real LINE login.

Caregiver support remains unreleased until separately tested with a consenting real second account. That gate does not block an owner-only pilot. Delivery is still disabled; enabling continuous reminders requires review of recipient, duration and the outstanding operational load checks. This change alone does not authorize continuous sending or public production release.
