# Deployment helpers

## Scoped bubblewrap seccomp profile (`seccomp-bwrap.json`)

Docker's default seccomp profile blocks `CLONE_NEWUSER` for processes without
`CAP_SYS_ADMIN`. Bubblewrap needs an unprivileged user namespace to build the
dev-server/agent sandbox, so the deployment uses a scoped copy of Docker's
default profile instead of `--privileged`, `--cap-add SYS_ADMIN`, or
`seccomp=unconfined`.

**Source:** Docker/Moby **v29.9.2**, `profiles/seccomp/default.json` (vendored in
that release under `vendor/github.com/moby/profiles/seccomp/default.json`):

```text
https://raw.githubusercontent.com/moby/moby/docker-v29.9.2/vendor/github.com/moby/profiles/seccomp/default.json
```

`defaultAction` remains `SCMP_ACT_ERRNO`. Every unrelated rule is unchanged.

### Exact diff from the default profile

Only the user-namespace path is relaxed:

1. Add an allow rule for `clone` when `arg0` has the `CLONE_NEWUSER` bit set
   (and the equivalent `arg1` rule for the s390/s390x clone ABI).
2. Add an allow rule for `unshare` when `arg0` has the `CLONE_NEWUSER` bit set.
   `unshare` with other flags still requires `CAP_SYS_ADMIN`.
3. Change the `clone3` rule from `SCMP_ACT_ERRNO` / `ENOSYS` (excluding
   `CAP_SYS_ADMIN`) to `SCMP_ACT_ALLOW` without a capability filter. `clone3`
   keeps its flags behind a pointer, so seccomp cannot mask-check them; the
   kernel still enforces capability checks. Returning `ENOSYS` would force some
   callers away from the user-namespace path.

```diff
--- default.json (Moby v29.9.2)
+++ seccomp-bwrap.json
@@ -720,6 +720,42 @@
 		},
 		{
 			"names": [
+				"unshare"
+			],
+			"action": "SCMP_ACT_ALLOW",
+			"args": [
+				{
+					"index": 0,
+					"value": 268435456,
+					"valueTwo": 268435456,
+					"op": "SCMP_CMP_MASKED_EQ"
+				}
+			],
+			"comment": "Allow unprivileged creation of a user namespace (CLONE_NEWUSER); other unshare flags still require CAP_SYS_ADMIN (scoped bubblewrap change)."
+		},
+		{
+			"names": [
+				"clone"
+			],
+			"action": "SCMP_ACT_ALLOW",
+			"args": [
+				{
+					"index": 0,
+					"value": 268435456,
+					"valueTwo": 268435456,
+					"op": "SCMP_CMP_MASKED_EQ"
+				}
+			],
+			"comment": "Allow unprivileged clone with CLONE_NEWUSER (scoped bubblewrap change).",
+			"excludes": {
+				"arches": [
+					"s390",
+					"s390x"
+				]
+			}
+		},
+		{
+			"names": [
 				"clone"
 			],
 			"action": "SCMP_ACT_ALLOW",
@@ -748,6 +784,27 @@
 			"args": [
 				{
 					"index": 1,
+					"value": 268435456,
+					"valueTwo": 268435456,
+					"op": "SCMP_CMP_MASKED_EQ"
+				}
+			],
+			"comment": "s390 parameter ordering for clone is different; allow unprivileged CLONE_NEWUSER (scoped bubblewrap change).",
+			"includes": {
+				"arches": [
+					"s390",
+					"s390x"
+				]
+			}
+		},
+		{
+			"names": [
+				"clone"
+			],
+			"action": "SCMP_ACT_ALLOW",
+			"args": [
+				{
+					"index": 1,
 					"value": 2114060288,
 					"op": "SCMP_CMP_MASKED_EQ"
 				}
@@ -769,13 +826,8 @@
 			"names": [
 				"clone3"
 			],
-			"action": "SCMP_ACT_ERRNO",
-			"errnoRet": 38,
-			"excludes": {
-				"caps": [
-					"CAP_SYS_ADMIN"
-				]
-			}
+			"action": "SCMP_ACT_ALLOW",
+			"comment": "Allow clone3 without CAP_SYS_ADMIN (scoped bubblewrap change). Its flags are behind a pointer, so they cannot be filtered; kernel capability checks still apply."
 		},
 		{
 			"names": [
```

### Refreshing after a Docker upgrade

Download the default profile from the new Moby release, diff it against this
file, and re-apply the three user-namespace changes above. Keep
`defaultAction: SCMP_ACT_ERRNO` and all other rules intact. Update the source
version in this file and in `INSTALL.md`, then run the backend deployment tests.
