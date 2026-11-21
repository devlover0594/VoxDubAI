# VoxDub AI Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict Ownership & PII Isolation**: A `UserProfile` document at `/users/{userId}` contains PII (`email`) and may only be read, created, or updated by the verified user whose `request.auth.uid == userId`. Collection listing on `/users` is forbidden.
2. **Project Ownership**: Every `DubbingProject` document at `/projects/{projectId}` must carry `ownerId == request.auth.uid`, and `ownerId` and `createdAt` are strictly immutable after creation.
3. **Verified Identity**: All read and write operations require a signed-in user with `request.auth.token.email_verified == true`.
4. **Temporal & Structural Integrity**: `createdAt` must equal `request.time` on creation, `updatedAt` must equal `request.time` on creation and updates, and all strings/lists must satisfy bounded size limits (`segments.size() <= 200`, `title.size() <= 180`).
5. **Query Security**: `allow list` on `/projects` explicitly requires `resource.data.ownerId == request.auth.uid` without relying on client-side filtering or `get()`/`exists()` calls.

## 2. Dirty Dozen Adversarial Payloads (Must All Be Denied)
1. **Unauthenticated read/write**: `auth = null` attempting `get(/projects/p1)` or `create(/projects/p1)`.
2. **Unverified email spoofing**: `auth = { uid: 'u1', token: { email: 'a@b.com', email_verified: false } }` attempting `set(/users/u1, ...)`.
3. **Cross-user PII read**: `uid = 'u2'` attempting `get(/users/u1)`.
4. **User collection scrape**: `uid = 'u1'` attempting `list(/users)`.
5. **Identity spoofing on project create**: `uid = 'u1'` creating `/projects/p1` with `ownerId: 'u2'`.
6. **Shadow / Ghost field injection**: `uid = 'u1'` creating `/projects/p1` with extra key `isAdmin: true` or `tier: 'enterprise'`.
7. **ID poisoning**: `uid = 'u1'` creating `/projects/../../etc/passwd` or a 200-char invalid ID.
8. **Immutable field tampering**: `uid = 'u1'` updating `/projects/p1` and changing `ownerId` or `createdAt`.
9. **Client-forged timestamp**: `uid = 'u1'` creating `/projects/p1` with a backdated `createdAt` not equal to `request.time`.
10. **Array flooding (Denial of Wallet)**: `uid = 'u1'` writing `/projects/p1` with `segments` containing `> 200` items.
11. **Type poisoning on update**: `uid = 'u1'` updating `/projects/p1` setting `voiceStyle: 'invalid_voice'` or `durationSeconds: 'nan'`.
12. **Cross-user project listing / deletion**: `uid = 'u2'` attempting `list(/projects)` without owner filter or `delete(/projects/p1)` owned by `u1`.
