// Asset manifest. Every sprite/audio file is imported so Vite inlines it as a
// base64 data URI (assetsInlineLimit is huge) -> single-file HTML. Sources are
// the WebP / MP3 outputs of `npm run assets` + `npm run audio` (run those once
// before dev/build).

import bg from './assets-webp/Main/bg_extended.webp'
import table from './assets-webp/Main/table.webp'
import tray from './assets-webp/Main/coin-tray.webp'
import bubble from './assets-webp/Main/cloud-popup.webp'
import dealBtn from './assets-webp/Main/deal-btn.webp'
import mergeBtn from './assets-webp/Main/merge-btn.webp'
import heart from './assets-webp/Main/heart.webp'
import logo from './assets-webp/Main/gamelogo.webp'
import patienceFrame from './assets-webp/Main/patience-frame.webp'
import patienceContainer from './assets-webp/Main/patience-container.webp'
import patienceFill from './assets-webp/Main/patience-fill.webp'
import patienceLabel from './assets-webp/Main/PATIENCe.webp'
import hand from './assets-webp/Main/hand-pointer.webp'
import tapHint from './assets-webp/Main/tap-to-merge.webp'
import coinGlow from './assets-webp/Main/coin-glow.webp'
import sunrays from './assets-webp/Main/sunrays.webp'
import ecLogo from './assets-webp/Main/endscreen-logo.webp'
import ecCta from './assets-webp/Main/endscreen-play-now.webp'

import person1 from './assets-webp/Main/1-person.webp'
import person1angry from './assets-webp/Main/1-person-angry.webp'
import person2 from './assets-webp/Main/2-person.webp'
import person2angry from './assets-webp/Main/2-person-angry.webp'
import person3 from './assets-webp/Main/3-person.webp'
import person3angry from './assets-webp/Main/3-person-angry.webp'

import bgm from './assets-webp/Audio/bgm.mp3'
import sfxMerge from './assets-webp/Audio/sfx-merge.mp3'
import sfxCoin from './assets-webp/Audio/sfx-coin.mp3'
import sfxDeliver from './assets-webp/Audio/sfx-deliver.mp3'
import sfxClick from './assets-webp/Audio/sfx-click.mp3'
import sfxWrong from './assets-webp/Audio/sfx-wrong.mp3'
import sfxPop from './assets-webp/Audio/sfx-pop.mp3'
import sfxHello from './assets-webp/Audio/sfx-hello.mp3'
import sfxHi from './assets-webp/Audio/sfx-hi.mp3'
import sfxGruntM from './assets-webp/Audio/sfx-grunt-m.mp3'
import sfxGruntF from './assets-webp/Audio/sfx-grunt-f.mp3'
import sfxBubble from './assets-webp/Audio/sfx-bubble.mp3'

type NumMap = Record<number, string>

function keyByNum(glob: Record<string, string>, re: RegExp): NumMap {
  const map: NumMap = {}
  for (const [path, url] of Object.entries(glob)) {
    const m = path.match(re)
    if (m) map[Number(m[1])] = url
  }
  return map
}

const coinGlob = import.meta.glob('./assets-webp/Main/[1-6]-coin.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>
const popupGlob = import.meta.glob('./assets-webp/Main/[1-6]-popup.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>

/** value (1..6) -> data URI of the coin token. */
export const COIN: NumMap = keyByNum(coinGlob, /\/(\d)-coin\.webp$/)
/** value (1..6) -> data URI of the request popup badge. */
export const POPUP: NumMap = keyByNum(popupGlob, /\/(\d)-popup\.webp$/)

export const CUSTOMERS = [
  { normal: person1, angry: person1angry },
  { normal: person2, angry: person2angry },
  { normal: person3, angry: person3angry },
]

export const IMAGES = {
  bg,
  table,
  tray,
  bubble,
  dealBtn,
  mergeBtn,
  heart,
  logo,
  patienceFrame,
  patienceContainer,
  patienceFill,
  patienceLabel,
  hand,
  tapHint,
  coinGlow,
  sunrays,
  ecLogo,
  ecCta,
}

export const AUDIO = {
  bgm,
  sfxMerge,
  sfxCoin,
  sfxDeliver,
  sfxClick,
  sfxWrong,
  sfxPop,
  sfxHello,
  sfxHi,
  sfxGruntM,
  sfxGruntF,
  sfxBubble,
}

// Phaser texture-key helpers.
export const texKey = {
  coin: (v: number) => `coin_${v}`,
  popup: (v: number) => `popup_${v}`,
  customer: (i: number) => `cust_${i}`,
  customerAngry: (i: number) => `cust_${i}_angry`,
}
