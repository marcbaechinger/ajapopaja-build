# Building Android Projects in the Ajapopaja Build Container

The container image includes the toolchain needed to build Kotlin/Java Android
projects. A normal project build uses the Gradle wrapper committed to the
repository:

```bash
./gradlew assembleDebug
```

## Installed toolchain

| Component | Location / version |
|-----------|--------------------|
| JDK | OpenJDK 17 (`JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`) |
| Android SDK root | `/opt/android-sdk` (`ANDROID_HOME` and `ANDROID_SDK_ROOT`) |
| Android command-line tools | `/opt/android-sdk/cmdline-tools/latest/bin` |
| Platform tools (`adb`, etc.) | `/opt/android-sdk/platform-tools` |

Gradle itself is not installed globally because Android projects ship a wrapper
(`gradlew`). The wrapper downloads the project's exact Gradle distribution from
`services.gradle.org` on first use.

The image contains the command-line tools and accepted SDK licenses, but not a
fixed Android platform or build-tools version. On the first build, the Android
Gradle Plugin downloads the `compileSdk` platform and build-tools requested by
the project from `dl.google.com`. AGP, AndroidX and Kotlin dependencies come from
Google Maven and Maven Central.

## `local.properties`

Do **not** commit `local.properties`; it contains machine-specific paths. If a
checked-out project has a stale file whose `sdk.dir` points somewhere that does
not exist in the container, remove it before building:

```bash
rm -f local.properties
./gradlew assembleDebug
```

No replacement is needed: AGP discovers the SDK through `ANDROID_HOME` (or
`ANDROID_SDK_ROOT`). If the file is required for some other tooling, point its
`sdk.dir` at `/opt/android-sdk`.

## Native code

The NDK and CMake are intentionally not part of the base image. If a project
needs them, install the versions it requests on demand, for example:

```bash
sdkmanager --install "ndk;27.0.12077973" "cmake;3.22.1"
```

## Artifacts and limitations

A successful build produces artifacts inside the workspace, for example:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Transferring artifacts to a host, installing/running on a device or emulator,
release signing, and publishing to an app store are outside the supported build
flow.
