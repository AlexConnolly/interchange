# Audio

Every sound in the game is a **recorded clip**. Nothing is synthesised at
runtime, on purpose: an oscillator through a filter is recognisably a computer
pretending to be a lorry, and the whole difference between "a game with engine
noise" and "a game that sounds like a road" is in the recording.

Drop the files listed below into this directory. They are all optional — a
missing clip is silent, logs itself once in the console, and changes nothing
else. Half a sound library is a normal state to be in while a sound library is
being assembled.

`packages/client/src/sound.ts` is the loader; `MANIFEST` there is the authority
on names.

## What is wanted

| File | What it is | Notes |
|---|---|---|
| `engine-diesel.mp3` | A lorry, idling and pulling | **Looped.** Must be seamless, and it is played back at 0.92–1.08 speed so pick something without an obvious rhythm |
| `engine-petrol.mp3` | A car, lighter and higher | **Looped**, same requirements |
| `horn.mp3` | One press of a horn | One-shot, short. Fired every 9–35 seconds at most |
| `wind.mp3` | Light wind in hedges | **Looped**, and long — 30 s or more. Anything with a recognisable event in it becomes maddening once you have heard it forty times |
| `rain.mp3` | Steady rain | **Looped**, long, same reason |
| `ui-click.mp3` | Pressing something | Short and soft. It plays on *every* button, so anything with character in it will wear out fast |
| `ui-confirm.mp3` | A purchase going through | Slightly warmer than the click |

`.mp3` because every browser decodes it and the files are small. `.ogg` or
`.wav` work too — change the extension in `MANIFEST` if you use them.

## The three loops must actually loop

The engines, the wind and the rain are `loop = true` on an
`AudioBufferSourceNode`, which means the last sample runs straight into the
first with no crossfade. A clip that does not start and end at the same
amplitude will click, once per loop, for ever. It is the single most common way
this goes wrong.

## Levels

Mix them quiet. The game sets its own gains — engines at about 0.55, horns at
0.42, ambience under 0.3 — and a clip normalised to 0 dBFS will still be too
loud after that. Something peaking around −12 dBFS leaves the game's mix room to
work.

## What the game does with them

- **Engines** are a pool of six positional voices handed to the nearest
  vehicles, detuned a few per cent each from the vehicle's id so six voices
  playing one recording do not drone in unison. Beyond 26 tiles a vehicle is not
  played at all rather than played quietly: a dozen distant engines summing to a
  mush is worse than silence.
- **Wind** runs always, and its level rises with how overcast it is.
- **Rain** follows the rain, which is only heavy weather — a few hours of a day,
  several days apart.
- **Horns** come from a random vehicle in earshot, at a randomised 9–35 second
  gap so they do not become a metronome.
- **Clicks** are wired to every `button` in the interface by one listener, so
  nothing has to remember to make a noise.
