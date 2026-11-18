PUT YOUR OWN RECORDED SOUNDS HERE (optional)

If a file below exists, it plays instead of the robot voice + synth effect.
If it doesn't exist, the built-in text-to-speech is used automatically.

  ahhh.mp3                   lid opens
  gulp.mp3                   lid closes
  take-out-the-trash.mp3     bin is full
  please-recycle.mp3         said by the WASTE bin when it sees something recyclable
  please-throw-in-waste.mp3  said by the RECYCLING bin when it sees something that isn't recyclable

Tips
- Record on your phone (Voice Memos / Recorder) and convert to .mp3 or .wav.
  If you use .wav or another name, change the file name in config.js -> SOUNDS -> files.
- Trim the silence at the start so the bin reacts instantly.
- Want variety? Record several and list them all, e.g.
      files: ['gulp.mp3', 'gulp-2.mp3', 'burp.mp3']
  and one is picked at random each time.
- To give each bin a different recorded voice you'd need separate events; ask
  the team member who owns app.js, or just use the text-to-speech voices,
  which are already different per bin (config.js -> BINS -> voiceHints/pitch).
