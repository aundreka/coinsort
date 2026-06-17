// Audio shrinker. Re-encodes the source clips to mono / low bitrate using the
// ffmpeg binary bundled by `ffmpeg-static` (no system ffmpeg required). BGM is
// the heaviest asset, so it is downmixed + trimmed to a short loop; SFX are
// downmixed to mono at a modest bitrate. Output -> src/assets-webp/Audio/**.
// Run once with `npm run audio`.
import ffmpegPath from 'ffmpeg-static'
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve('src/assets/Audio')
const OUT = path.resolve('src/assets-webp/Audio')
mkdirSync(OUT, { recursive: true })

// [sourceName, outputName, ffmpeg encode args]
const JOBS = [
  ['smooth-dudes_loop-05.wav', 'bgm.mp3', ['-ac', '1', '-b:a', '64k', '-t', '16']],
  ['Cartoon Upgrade 1.mp3', 'sfx-merge.mp3', ['-ac', '1', '-b:a', '96k']],
  ['Coin.wav', 'sfx-coin.mp3', ['-ac', '1', '-b:a', '96k', '-t', '1.5']],
  ['Gem Collect Sparkle.wav', 'sfx-deliver.mp3', ['-ac', '1', '-b:a', '96k', '-t', '2']],
  ['Click.mp3', 'sfx-click.mp3', ['-ac', '1', '-b:a', '96k']],
  ['Wrong Answer.wav', 'sfx-wrong.mp3', ['-ac', '1', '-b:a', '96k', '-t', '2']],
  ['pop.wav', 'sfx-pop.mp3', ['-ac', '1', '-b:a', '96k', '-t', '1']],
  // Customer voices + coin pickup (src/assets/Audio/New Folder)
  ['New Folder/Hello.wav', 'sfx-hello.mp3', ['-ac', '1', '-b:a', '96k', '-t', '1.6']],
  ['New Folder/Female Saying Hi 2.mp3', 'sfx-hi.mp3', ['-ac', '1', '-b:a', '96k', '-t', '1.6']],
  ['New Folder/Male Grunt.mp3', 'sfx-grunt-m.mp3', ['-ac', '1', '-b:a', '96k', '-t', '1.3']],
  ['New Folder/Female Grunt 01.mp3', 'sfx-grunt-f.mp3', ['-ac', '1', '-b:a', '96k', '-t', '1.3']],
  ['New Folder/Pop with Bubbles.wav', 'sfx-bubble.mp3', ['-ac', '1', '-b:a', '96k', '-t', '1.2']],
]

let totalIn = 0
let totalOut = 0
for (const [inName, outName, args] of JOBS) {
  const inPath = path.join(SRC, inName)
  const outPath = path.join(OUT, outName)
  execFileSync(ffmpegPath, ['-y', '-i', inPath, ...args, outPath], { stdio: 'pipe' })
  const inSize = statSync(inPath).size
  const outSize = statSync(outPath).size
  totalIn += inSize
  totalOut += outSize
  console.log(`${inName}  ${(inSize / 1024).toFixed(0)}KB -> ${(outSize / 1024).toFixed(0)}KB`)
}

const mb = (b) => (b / 1024 / 1024).toFixed(2)
console.log(`\nAudio: ${mb(totalIn)} MB -> ${mb(totalOut)} MB`)
