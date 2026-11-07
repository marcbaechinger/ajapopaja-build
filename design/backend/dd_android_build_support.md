# Design Document: Android (Kotlin/Java) Build Support in the Container (`dd_android_build_support.md`)

## 1. Overview

The `ajapopaja-build` Docker container (see `Dockerfile`) is the execution
environment where coding agents (interactive sessions and CoderBot batch
sessions) check out remote repositories and run build/test/lint commands. Today
it ships the Python backend toolchain plus Node.js and the `pi` coding agent,
but it has **no Java/JDK, no Gradle, and no Android SDK**.

When an agent checks out a remote repository that contains an Android project
(written in Kotlin and/or Java) and is asked to build it, the agent currently
fails: the required toolchain is simply not present. This document evaluates
what is needed and describes the concrete changes to make the container capable
of building such projects and producing build artifacts (e.g. an APK or AAR) by
running the project's Gradle build.

Downloading the resulting APK to the host, and installing/running it on a
physical device or emulator, are **out of scope** for this evaluation. We only
care about having every tool and dependency available so that a Gradle build
can run and produce artifacts.

## 2. Scope

### 2.1 In scope

- Provide a JDK suitable for Android Gradle Plugin (AGP) builds.
- Provide the ability to run Gradle builds (via the project's Gradle wrapper,
  and optionally a globally installed Gradle for wrapper-less projects).
- Provide the Android SDK (command-line tools, platform tools, build tools and
  the required Android platform) so AGP can compile and package the app.
- Accept the Android SDK licenses so non-interactive builds do not hang.
- Make the toolchain discoverable via the standard environment variables.
- Ensure the container has network access to the repositories the toolchain
  downloads from (Gradle distributions, Maven Central, Google Maven, Google's
  `dl.google.com` SDK repository).

### 2.2 Out of scope

- Downloading/transferring produced artifacts (APK/AAB/AAR) to the host.
- Installing or running the app on a physical device or an Android emulator
  (`adb` install, emulator/system images, KVM/USB passthrough).
- Signing/publishing to an app store.
- Android NDK/CMake native builds (only if a project requires native code; can
  be added on demand later).
- Building iOS/Flutter/React Native toolchains.

## 3. Requirements

### 3.1 Functional requirements

| # | Requirement | Rationale |
|---|-------------|-----------|
| R1 | A Java Development Kit (JDK) is installed and set as `JAVA_HOME`. | AGP and Gradle are JVM tools and require a JDK. |
| R2 | The project's Gradle build can be invoked (`./gradlew`), including downloading the Gradle distribution and Maven dependencies. | Virtually all Android projects ship a Gradle wrapper. |
| R3 | The Android SDK is available at a well-known location exposed via `ANDROID_HOME` / `ANDROID_SDK_ROOT`. | AGP locates the SDK through these variables (or `sdk.dir`). |
| R4 | The required Android platform and build-tools are present, or can be fetched automatically by AGP. | `platforms;android-XX` and `build-tools;XX` are needed to compile and package. |
| R5 | All Android SDK licenses are accepted non-interactively. | `sdkmanager`/AGP otherwise block waiting for license confirmation. |
| R6 | Kotlin projects build without a separately installed Kotlin compiler. | The Kotlin Gradle plugin resolves the compiler from Maven. |
| R7 | The toolchain works for a freshly checked-out repository with no committed `local.properties`. | Remote repos must not rely on host-specific SDK paths. |

### 3.2 Non-functional requirements

- **Reproducibility**: builds should behave the same across container recreations.
- **Image size**: the full Android SDK is several GB; the image should stay lean
  by installing only what is needed and deferring the rest to on-demand download.
- **Idempotency**: re-running the SDK install/acceptance steps must be safe.
- **Non-interactive**: license acceptance and downloads must never prompt.
- **Security**: license acceptance is a build-time step; no device credentials or
  signing keys are baked into the image.

## 4. Component Analysis

### 4.1 Java Development Kit (JDK)

Android Gradle Plugin 8.x requires **JDK 17**. Gradle 8.x runs on JDK 17 and
(8.5+) also supports JDK 21. The current base image
(`ghcr.io/astral-sh/uv:python3.11-bookworm-slim`, Debian bookworm) provides
OpenJDK 17 in its apt repositories, so JDK 17 is the lowest-friction choice and
satisfies AGP 8.x and Gradle 8.x.

- Package: `openjdk-17-jdk-headless` (no GUI/AWT needed for builds).
- `JAVA_HOME` must point to `/usr/lib/jvm/java-17-openjdk-amd64`.

### 4.2 Gradle

Most Android projects commit a Gradle wrapper (`gradlew`, `gradle/wrapper/*`),
which downloads the exact Gradle distribution from `services.gradle.org` on
first invocation and caches it under `~/.gradle`. No global Gradle install is
strictly required, but installing a global Gradle is a convenience for
wrapper-less projects. **Recommendation:** rely on the wrapper as the primary
path; a global Gradle is optional and can be added later if needed.

### 4.3 Android SDK

The Android SDK is not a single package; it is a family of components installed
via the `sdkmanager` from the "command-line tools" package:

| Component | Purpose | Needed by default? |
|-----------|---------|--------------------|
| `cmdline-tools;latest` | `sdkmanager`/`avdmanager` CLI | Yes (baked in) |
| `platform-tools` | `adb`, `fastboot` | Yes (useful; not required by AGP itself) |
| `platforms;android-XX` | `android.jar`, framework stubs | Yes (AGP compile target) |
| `build-tools;XX.Y.Z` | `aapt2`, `zipalign`, `apksigner`, `d8` | Yes (AGP packaging) |
| `ndk` / `cmake` | Native code | Optional, on demand |

AGP can **auto-download missing SDK components** (platform and build-tools) when
the licenses have been accepted; this is controlled by the
`android.builder.sdkDownload` property (default `true`). Therefore the container
does not need the full SDK pre-baked — it only needs the command-line tools and
the accepted licenses, and AGP/Gradle will fetch the rest on first build.

### 4.4 Kotlin

No separate Kotlin installation is required. A Kotlin Android project applies
the **Kotlin Gradle plugin**, which is resolved from Maven (Google/Maven Central)
and brings the Kotlin compiler as a build dependency. The only requirement is a
compatible JDK and network access to Maven repositories. This is already covered
by R1 and R2.

## 5. Delivery Options for the SDK

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. Bundle the full SDK** | Pre-install a fixed platform/build-tools set in the image. | Fast first build; offline for known targets. | Large image (GBs); fixed versions may not match every project; must rebuild image to add versions. |
| **B. Bundle command-line tools + licenses, install on demand** | Bake `cmdline-tools` and accepted licenses; let AGP auto-download the platform/build-tools it needs. | Lean image; adapts to any project's `compileSdk`/`buildToolsVersion`; no image rebuild for new SDK versions. | First build downloads a few hundred MB; requires runtime network to Google's SDK repo. |
| **C. Nothing baked in** | Agent installs JDK/SDK itself on demand. | Smallest image. | Repeated, slow per-session setup; fragile; agents must know/remember the exact install steps; no shared cache. |

**Recommendation: Option B** (hybrid). Bake in the JDK, the Android command-line
tools, the accepted license files, and optionally `platform-tools`; let AGP
fetch the exact platform/build-tools versions the project requests. This keeps
the image small, matches any project, and still makes the first build a
single, standard `./gradlew` invocation.

## 6. Required Changes

### 6.1 `Dockerfile`

Extend the base image (Debian bookworm) with the JDK and the Android
command-line tools, and accept licenses.

1. **Install JDK and `unzip`** — add to the existing apt install (or a new `RUN`
   step):

   ```dockerfile
   RUN apt-get update && apt-get install -y --no-install-recommends \
       openjdk-17-jdk-headless \
       unzip \
       && rm -rf /var/lib/apt/lists/*
   ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
   ```

2. **Install the Android command-line tools** into a stable path:

   ```dockerfile
   ENV ANDROID_HOME=/opt/android-sdk
   ENV ANDROID_SDK_ROOT=/opt/android-sdk
   RUN mkdir -p ${ANDROID_HOME}/cmdline-tools \
       && curl -fsSL -o /tmp/cmdline-tools.zip \
          https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
       && unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_HOME}/cmdline-tools \
       && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
       && rm /tmp/cmdline-tools.zip
   ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"
   ```

3. **Accept licenses non-interactively** (this creates the
   `${ANDROID_HOME}/licenses/*` files AGP checks):

   ```dockerfile
   RUN yes | sdkmanager --licenses > /dev/null
   ```

4. *(Optional, recommended)* Pre-install `platform-tools` to avoid a download on
   the very first build:

   ```dockerfile
   RUN sdkmanager --install "platform-tools"
   ```

   Do **not** pre-install a fixed `platforms;android-XX`/`build-tools` set in the
   image (see Option B); let AGP fetch the project-specific versions.

> Note: the command-line-tools ZIP URL is version-pinned and changes over time.
> It should be promoted to a build `ARG` (e.g. `ANDROID_CMDLINE_TOOLS_URL`) so the
> version can be bumped without editing the `Dockerfile`.

### 6.2 `local.properties` handling (agent guidance)

Android projects must not commit `local.properties` (it is machine-specific and
points `sdk.dir` at a local SDK path). If a checked-out repo contains a stale
`local.properties`, AGP would prefer its `sdk.dir` over `ANDROID_HOME` and fail.
The agent guidance (a small skill/howto note) should instruct the agent to:

- Remove or ignore any committed `local.properties` before building, or
- Ensure `ANDROID_HOME`/`ANDROID_SDK_ROOT` is set (the image default) and no
  `local.properties` overrides it.

### 6.3 Environment variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `JAVA_HOME` | `/usr/lib/jvm/java-17-openjdk-amd64` | JDK location |
| `ANDROID_HOME` | `/opt/android-sdk` | SDK root (modern name) |
| `ANDROID_SDK_ROOT` | `/opt/android-sdk` | SDK root (legacy fallback) |
| `PATH` | `...:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools` | CLI discovery |

No `docker-compose.yml` changes are required because these are baked-in defaults
and no new host ports or mounts are needed. The SDK lives in the image; if SDK
component caching across recreations is desired later, a volume could be added
for `${ANDROID_HOME}` (and/or `~/.gradle`), but that is an optimization, not a
requirement.

### 6.4 Network access

The container must be able to reach, at build and runtime:

- `services.gradle.org` (Gradle distribution from the wrapper)
- `repo.maven.apache.org` / `repo1.maven.org` (Maven Central)
- `dl.google.com` (SDK components) and `maven.google.com` (AGP, AndroidX, Kotlin
  stdlib)

The container already performs network installs at build time (`apt-get`,
`npm install`, Node download), and runtime builds already assume outbound access
for the agent's `npm install`/pip workflows, so no special network plumbing is
expected. This should be verified (see §8).

## 7. Build Flow (Target End State)

```text
agent checks out remote repo
        |
        v
(no local.properties, or it is removed/ignored)
        |
        v
./gradlew assembleDebug          <-- wrapper downloads Gradle distribution
        |                            (services.gradle.org)
        v
Gradle resolves AGP + Kotlin plugin (Google/Maven Central)
        |
        v
AGP locates SDK via ANDROID_HOME; licenses already accepted
        |
        v
AGP auto-downloads missing platform/build-tools (dl.google.com)
        |
        v
compile Kotlin/Java -> dex (d8) -> package (aapt2) -> sign (apksigner)
        |
        v
artifact: app/build/outputs/apk/debug/app-debug.apk
```

## 8. Verification Plan

1. **Image builds**: `./docker-build.sh` (or `docker build .`) succeeds and the
   image contains `java -version` (JDK 17) and
   `sdkmanager --version` on `PATH`.
2. **License state**: `${ANDROID_HOME}/licenses/android-sdk-license` exists and
   contains an accepted hash.
3. **End-to-end build**: inside a running container, check out a minimal
   Kotlin Android sample (e.g. a `com.android.application` project with a Gradle
   wrapper), run `./gradlew assembleDebug`, and confirm an APK is produced under
   `app/build/outputs/apk/debug/`.
4. **Non-interactive check**: run the same build in a fresh container with no
   TTY (`docker run` without `-it`) to confirm nothing prompts.
5. **Regression**: confirm the existing Python/Node toolchain and the standard
   backend build/test commands still pass (image change is additive).

## 9. Risks and Open Questions

- **SDK auto-download relies on runtime network** to `dl.google.com`; if the
  production host restricts egress, Option B may need a proxy or a pre-baked
  platform/build-tools set (revert to Option A for the most common
  `compileSdk`).
- **JDK version drift**: AGP 9.x may require a newer JDK; the `openjdk-17`
  choice should be revisited when the toolchain baseline changes.
- **Image size** grows by roughly the JDK (~300 MB) plus command-line tools
  (~150 MB) plus optional `platform-tools`; still far smaller than a full SDK.
- **Gradle/Maven cache persistence**: by default `~/.gradle` is in the container
  writable layer and is lost on recreation; a named volume is a future
  optimization for faster repeat builds.
- **NDK/CMake**: not included; projects with native code will need an
  on-demand `sdkmanager --install "ndk;..." "cmake;..."` step.

## 10. Out of Scope (reaffirmed)

Artifact retrieval (APK download to host), device/emulator install and run,
app signing for release, and store publishing are explicitly out of scope for
this evaluation. This document only ensures the toolchain and dependencies are
available so a Gradle build can run and produce artifacts.
