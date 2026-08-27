# Audio

Every sound in the game is a **recorded clip**. Nothing is synthesised at
runtime, on purpose: an oscillator through a filter is recognisably a computer
pretending to be a lorry, and the whole difference between "a game with engine
noise" and "a game that sounds like a road" is in the recording.

`packages/client/src/sound.ts` is the loader; `MANIFEST` there is the authority
on names. A missing clip is silent, logs itself once in the console, and changes
nothing else — so the set can be replaced one file at a time.

## What is here, and where it came from

Everything below the music came from [Pixabay](https://pixabay.com/sound-effects/)
under the [Pixabay Content Licence](https://pixabay.com/service/license-summary/):
free for commercial and non-commercial use, no attribution required, and no
redistribution of the clips on their own. Most of them originate from
Freesound's CC0 pool, mirrored by Pixabay's `freesound_community` account.
Attribution is recorded here anyway, because a file with no provenance is a
file nobody can ever safely replace or defend.

| File | What it is | Source |
|---|---|---|
| `engine-diesel.mp3` | A lorry idling. Mono, 27 s, looped | *Diesel Truck Idling Front*, `freesound_community` |
| `engine-petrol.mp3` | A car idling, lighter and higher. Mono, 22 s, looped | *car idle 1 blyth 21 6 12*, `freesound_community` |
| `engine-tractor.mp3` | A tractor, which knocks rather than hums. Mono, 33 s, looped | *Diesel tractor 2*, `freesound_community` |
| `horn.mp3` | One press of a period horn. Mono, 1.3 s | *Vintage Car Horn*, `Universfield` |
| `wind.mp3` | Wind in trees. Stereo, 42 s, looped | *wind in the trees*, `freesound_community` |
| `rain.mp3` | Steady rain, no thunder. Stereo, 48 s, looped | *Steady Rain 2 short*, `freesound_community` |
| `ui-click.mp3` | A page turning. Pressing a row, a tab, anything inside a panel. Mono, 0.34 s | *Page Turn*, `freesound_community` |
| `ui-open.mp3` | A book being opened. A panel appearing. Mono, 0.40 s | *Book Opening*, `Soumages` |
| `ui-close.mp3` | And shut again. Mono, 0.17 s | *Book Closing* (Read, Library, Book), `freesound_community` |
| `ui-confirm.mp3` | A purchase going through. Mono, 1 s | *Positive Notification*, `Universfield` |
| `bird.mp3` | A chaffinch, for a letter arriving. Mono, 1.28 s | *Chaffinch March 2011*, Adam Clark — see below |
| `music-summer.mp3` | Background music, warm half of the year. Looped | *Settled in F* |
| `music-winter.mp3` | Background music, cold half. Looped | *Room of Ashen Notes* |

### The bird is not from Pixabay

`bird.mp3` came from the **Internet Archive** rather than Pixabay, under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — *Chaffinch March
2011* by Adam Clark, `archive.org/details/ChaffinchMarch2011`.

Sourcing it took some looking, and the reason is worth recording. Wikimedia
Commons has a great deal of birdsong and almost none of it is usable here: of 123
recordings checked across eight searches, **zero** were CC0 — they are
overwhelmingly CC BY-SA, because most of them are Xeno-canto uploads. Share-alike
is a licensing decision about the whole project rather than about one sound
effect, so it was not mine to make. The Archive's CC0 pool had a chaffinch in it,
which is also simply the right bird: it is the one you actually hear from a
hedgerow in an English March, which is the month this game opens in.

## How they were prepared

None of them arrived loopable or level-matched, and the processing is not
cosmetic — two of the three things below were bugs found by measurement rather
than guesses.

**The loops are spliced, not trimmed.** A recording of an engine does not
happen to end where it began, so looping the raw file clicks once per lap. Each
loop is built by taking a section and crossfading its *tail into its head*: the
result begins a second or two into the section and ends with the material from
the section's start, faded in. Played on repeat, the join lands exactly where
the recording already flowed on from itself, with a crossfade over the splice.

**Mono for anything with a position, stereo for the room.** The engines and the
horn go through a `PannerNode` at a point in the world; a stereo source at a
point is a contradiction and the panner has to collapse it anyway. Wind and rain
go straight to the master, and their width is most of what makes them ambience.

**The interface is paper, not electronics.** The first set used a synthesised
UI blip, which was wrong for a reason worth stating: this is 1985, the player is
a haulier with a ledger and a clipboard, and there is nothing in the district
that could make that noise. Three clips rather than one, because opening a panel
and pressing a row inside it are not the same gesture — the book opens, the book
shuts, and everything else is a page. Which one plays is decided by the panel
state and not by the button, since a dock button, a map marker, a list row and
the settings cog all open panels; see `press` and `claimPress` in `sound.ts`,
where a queued page turn is replaced by the book if the press turned out to open
something.

**Leading silence is removed from the one-shots.** The first cut of
`ui-click.mp3` decoded with **150 ms of silence in front of the click**, which is
not heard as a quiet sound — it is heard as a slow interface. Every one-shot is
now verified to start on sample zero.

The book clips were caught by the same check and it caught two more things. The
raw *Book Opening* had **278 ms** in front of it. *Book Closing* looked clean to
`silencedetect` and still decoded with 30 ms of −54 dBFS noise floor before the
thump — below the threshold that finds silence, above the one that finds signal,
and the only way to tell the difference was to look at the samples. And the page
turn came out at **−23.9 dBFS** rather than −12, because shortening it to a third
of a second had removed the loudest moment along with the tail: normalising
before trimming measures a peak that is no longer in the file.

**Levels sit near −12 dBFS peak.** The game applies its own gains on top
(engines about 0.55, horns 0.42, ambience under 0.3, music 0.42), so a clip
normalised to 0 dBFS is still far too loud after that.

`art/`-style rebuild script: the ffmpeg pipeline that produced these lives in
the scratchpad rather than the repo, because it ran once. If a clip is replaced,
the three rules above are what to reproduce.

**The bird, exactly**, since it is the newest and the recipe is short. The source
is 58 seconds of a chaffinch singing in the open; the phrase used starts at 7.05 s,
which is where the per-half-second RMS of the whole recording peaks *and* where the
quietest run-in was — both measured rather than chosen by ear:

    ffmpeg -ss 7.05 -t 1.28 -i chaffinch-raw.mp3       -af "highpass=f=420,afade=t=in:st=0:d=0.025,afade=t=out:st=1.13:d=0.15,volume=-10.6dB"       -ac 1 -ar 44100 -codec:a libmp3lame -q:a 5 bird.mp3

The high-pass takes out the wind rumble under the recording. The fades are what
stop a one-shot clicking at either end. The −10.6 dB is not a taste judgement: the
cut peaks at −1.9 dB and `ui-open.mp3` peaks at −12.5, and this is the difference —
the bird fires *unprompted*, so it is levelled to the quietest of the one-shots
rather than the loudest. Result: mean −28.7 dB, peak −11.3 dB, which sits between
`ui-open` and `ui-confirm`.

A first attempt used `dynaudnorm` and came out at mean −12.1 dB, peak 0.0 dB —
clipping, and about sixteen decibels louder than everything around it. Normalising
by a measured gain rather than by an automatic one is the whole lesson.

## MP3 loops seamlessly in Chrome — measured, not assumed

The usual advice is that MP3 cannot loop gaplessly because the encoder pads the
start. That is worth checking rather than believing: decoding these files with
`decodeAudioData` gives **zero leading samples and exactly the authored
duration** (27.100 s, 42.500 s, 48.000 s), because Chrome honours the LAME
gapless metadata that ffmpeg writes. So MP3 it is, and every browser can play
it. If a future browser is found that does not trim the padding, the fix is Ogg
Vorbis for the five loops and a change of extension in `MANIFEST` — nothing else.

## What the game does with them

- **Engines** are a pool of six positional voices handed to the nearest
  vehicles, detuned a few per cent each from the vehicle's id so six voices
  playing one recording do not drone in unison. Beyond 26 tiles a vehicle is not
  played at all rather than played quietly: a dozen distant engines summing to a
  mush is worse than silence. Three clips — lorry, car, tractor — chosen by what
  the thing is.
- **Wind** runs always, and its level rises with how overcast it is.
- **Rain** follows the rain, which is only heavy weather — a few hours of a day,
  several days apart.
- **Horns** come from a random vehicle in earshot, at a randomised 9–35 second
  gap so they do not become a metronome.
- **Clicks** are wired to every `button` in the interface by one listener, so
  nothing has to remember to make a noise.
- **Music** is the two tracks running at once, crossfaded on how far into winter
  it is, with a constant-power pair of gains so the middle of the fade is not a
  dip. Both start together at the top of the track and never restart, so the
  winter track does not announce the first cold day by beginning at its first
  bar.
