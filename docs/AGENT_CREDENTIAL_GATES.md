# Gates: Station Agent credential lifecycle

Scope: Add per-station credential rotation and revocation while preserving existing enrollment until that station is rotated.

- [x] G1: Scoped pairing, rotation, revocation, and authenticated Agent transport pass isolated integration tests
  CHECK: node --test backend/test/obs-flow.test.js
  EXPECT: # fail 0
  CWD: ..
  EVIDENCE: automatic-evidence=v1; definition-sha256=f270faece23ef8255fd816ba1c24c3730f96d2e128b833c399a0cdd168aa4812; exit=0; EXPECT=matched; output-sha256=40fda4b2b1766ead2c31ce8b6c19749aac160dd5b102a667b0ecd57d0c52c08e; output-bytes=508; shell=C:\Windows\system32\cmd.exe; cwd=C:\Users\AMJAD\OneDrive\Desktop\obs; path=214c5f0e4b6e/27 entries

- [x] G2: Expired Agent connections and pending commands are removed by the watchdog
  CHECK: node --test backend/test/agent-liveness.test.js
  EXPECT: # fail 0
  CWD: ..
  EVIDENCE: automatic-evidence=v1; definition-sha256=d0f7e74696e896d28ded2b14ad2938d0a02eecf62a13628c61f0e8ade98b3b66; exit=0; EXPECT=matched; output-sha256=71d829495be5c2a86d73916cd128011dc4cf2c389c2e73e066de9843c7144f28; output-bytes=253; shell=C:\Windows\system32\cmd.exe; cwd=C:\Users\AMJAD\OneDrive\Desktop\obs; path=214c5f0e4b6e/27 entries
