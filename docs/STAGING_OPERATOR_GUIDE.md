# Staging operator quick guide

**Start Program.** On the opted-in staging station, open **Live Control → Independent Program → Start Program**. Open a single receiver on the worker host, for example `ffplay udp://127.0.0.1:5102` when using the default output port. Read the actual port in Live Control. Confirm both picture and audio at that receiver. The initial slate carries silence. Independent Program and OBS stream/record have separate start and stop buttons.

**Take a source or scene.** In the independent scene editor, select an imported video and image, position the image, save the scene and check Preview. Choose **Take** and confirm picture and audio at the receiver. To take a network scene, select the station's configured MPEG-TS input and wait for **Ready**. The input preview shows the direct MPEG-TS URL when the administrator configured URL mode. In UDP mode, an isolated OBS contribution can supply the input. Use **Take slate** to return to the fallback image.

**Manage the watermark.** Open **Program watermark**, select the station logo or upload a PNG, JPEG or WebP, enable it and set its size, corner, insets and opacity. Check Preview, choose **Apply to Program**, then inspect a receiver frame. To remove it, clear Enable and Apply. Applied settings survive a service restart.

**Manage ads.** Open **Ad placements**. Add image or MP4 creatives to the library, create placements and append creatives to each playlist. Set each rectangle and layer, then the display, gap, fade and movement per item. Enter scheduled windows in the selected IANA time zone. Review overlap outlines, enable the desired placements and choose **Apply ads to Program**. Use each placement's Pause, Resume, Skip or Disable now controls during operation. Gaps reveal the lower layers. The global watermark draws above all ads.

**Recover a source.** On selected network input loss, Program switches to the ready second input if automatic backup is enabled. Otherwise it uses the slate. Let the returning signal stabilize for five seconds, then take it explicitly. A healthy transport can carry black or silent content. Take slate, restore the asset, verify the picture and audio and retake. For a missing ad creative, skip or disable the affected placement and apply a revised playlist.

**Recover delivery or the service.** For a blank UDP receiver, check its host and port and reopen it. Live Control shows SRT sender and optional receiver health plus HLS status. An HLS writing error leaves other outputs running. Correct the storage issue before starting a new HLS session. With the separate Program runtime enabled, restarting the web service leaves Program running. Restarting the Program runtime creates a new session if auto-start is enabled. Check the output, saved watermark, playlists, overrides and source after an interruption.

[Detailed staging setup](INDEPENDENT_PROGRAM_STAGING.md) · [Current acceptance](BROADCAST_READINESS_AR.md)
