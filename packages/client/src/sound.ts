/**
 * Sound: engines where the lorries are, weather overhead, and a click when you
 * press something.
 *
 * **Every sound here is a recorded clip.** Nothing is synthesised at runtime.
 * That is a deliberate constraint and the right one: an oscillator through a
 * filter is recognisably a computer pretending to be a lorry, and the difference
 * between "a game with engine noise" and "a game that sounds like a road" is
 * entirely in the recording. The cost is that this file does nothing at all
 * until the clips exist — see `MANIFEST` for what it wants and
 * `packages/client/public/audio/README.md` for the shape of each one.
 *
 * A missing clip is not an error. It is silent, it says so once in the console,
 * and everything else carries on — because half a sound library is a normal
 * state to be in while a sound library is being assembled, and a game that
 * refuses to start over a missing horn is useless during exactly the period you
 * are adding horns.
 *
 * Three kinds of sound, and they need different machinery:
 *
 *   **Positional loops** — engines. A pool of voices assigned to the nearest
 *   vehicles, for the same reason the lights are a pool: thirty simultaneous
 *   panner nodes is real CPU, and you cannot hear more than a handful of engines
 *   apart anyway.
 *
 *   **Ambient loops** — wind, rain. Not positional: weather is everywhere, and
 *   panning it would mean deciding where the sky is.
 *
 *   **One-shots** — horns, clicks. Fired and forgotten.
 */

/** Where the clips live, relative to the client's public root. */
const DIR = 'audio/';

/**
 * What the game asks for.
 *
 * Named by what they *are* rather than by what they sound like, so a better
 * recording can replace one without anything else changing. Every one is
 * optional.
 */
export const MANIFEST = {
  /** A lorry idling and pulling, seamless. Looped, so it must not click. */
  engine: 'engine-diesel.mp3',
  /** A car, lighter and higher. Looped. */
  engineCar: 'engine-petrol.mp3',
  /**
   * A tractor, which is a diesel but not that diesel.
   *
   * Worth a third clip rather than reusing the lorry's, because the difference
   * is not subtle: a lorry hums and a tractor knocks, and the knock is most of
   * what tells you there is one out in a field you cannot quite see.
   */
  engineTractor: 'engine-tractor.mp3',
  /** A horn, one press. Two would be better than one but one will do. */
  horn: 'horn.mp3',
  /** Light wind in hedges. Long, looped, and it must not have a shape you can
   *  learn — anything with a recognisable event in it becomes maddening. */
  wind: 'wind.mp3',
  /** Rain, steady, looped. */
  rain: 'rain.mp3',
  /** A soft click for pressing something in the interface. */
  click: 'ui-click.mp3',
  /** A slightly warmer one for a purchase going through. */
  confirm: 'ui-confirm.mp3',
  /**
   * Music, one track for the warm half of the year and one for the cold.
   *
   * Crossfaded on the *season* rather than switched, because a cut between two
   * pieces of music is the most jarring thing an interface can do — and because
   * the seasons themselves cross over: there is a fortnight in October that is
   * neither, and the music should be neither too.
   */
  musicSummer: 'music-summer.mp3',
  musicWinter: 'music-winter.mp3',
} as const;

export type SoundName = keyof typeof MANIFEST;

/** How many engines can be heard at once. */
const VOICES = 6;

/**
 * How far a sound carries, in tiles.
 *
 * Beyond this it is not attenuated to a whisper, it is *not played* — "if you're
 * too far away, we don't want to be playing the audio because it's just gonna
 * sound really bad", which is right: a dozen distant engines summing to a mush
 * is worse than silence, and the mush is what a pure distance model gives you.
 */
const EARSHOT = 26;

interface Voice {
  source: AudioBufferSourceNode | null;
  panner: PannerNode;
  gain: GainNode;
  /** Which vehicle it is following, or -1. */
  id: number;
  /** Which clip it is playing, so a car does not become a lorry mid-note. */
  clip: SoundName | null;
}

/** Which engine a thing has. Three, because a tractor is not a lorry. */
export type Engine = 'diesel' | 'petrol' | 'tractor';

export interface Heard {
  id: number;
  x: number;
  z: number;
  engine: Engine;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly missing = new Set<SoundName>();
  private voices: Voice[] = [];
  private ambient = new Map<SoundName, { gain: GainNode; source: AudioBufferSourceNode }>();
  private started = false;
  /**
   * Two volume multipliers, applied where the game asks for a level rather than
   * as gain nodes of their own.
   *
   * The alternative — a music bus and an effects bus between every source and
   * the master — is the textbook answer and buys nothing here: nothing in this
   * game needs to duck one against the other, and every level in it is already
   * computed per frame from something (the weather, the distance, the season).
   * Multiplying at the point the level is decided is one operation in the same
   * expression that was already there.
   */
  private musicLevel = 1;
  private effectsLevel = 1;
  private muted = false;
  /** Wall-clock of the last horn, so they stay occasional. */
  private lastHorn = 0;

  constructor() {
    try {
      this.muted = window.localStorage.getItem('interchange.mute') === '1';
    } catch {
      // Private browsing, or storage disabled. Not muted, and not a problem.
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Start, on a user gesture.
   *
   * Browsers will not let audio begin without one, and calling this before the
   * player has touched anything creates a context stuck in `suspended` that
   * silently never plays. So it is called from the first pointer or key event and
   * is safe to call again after that.
   */
  async start(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    this.started = true;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      /*
       * A linear distance model, not inverse.
       *
       * Inverse-square is physically right and wrong here for the same reason the
       * point lights needed a linear falloff: a tile is a symbolic unit, not a
       * metre, so the physical curve puts everything either deafening or
       * inaudible. Linear over a fixed earshot is the one that behaves.
       */
      this.ctx.listener.forwardX?.setValueAtTime(0, this.ctx.currentTime);
      await this.loadAll();
      this.makeVoices();
    } catch {
      // No audio available at all. Everything below is a no-op from here.
      this.ctx = null;
    }
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all((Object.keys(MANIFEST) as SoundName[]).map(async (name) => {
      try {
        const res = await fetch(DIR + MANIFEST[name]);
        if (!res.ok) throw new Error(String(res.status));
        this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        this.missing.add(name);
      }
    }));
    if (this.missing.size > 0) {
      // Once, listing all of them, rather than one line per failed fetch.
      console.info(
        `[sound] no clip for: ${[...this.missing].join(', ')} — `
        + `drop files in packages/client/public/audio/ (see the README there)`,
      );
    }
  }

  private makeVoices(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.voices = [];
    for (let i = 0; i < VOICES; i++) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'linear';
      panner.refDistance = 2;
      panner.maxDistance = EARSHOT;
      panner.rolloffFactor = 1;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      panner.connect(gain);
      gain.connect(this.master);
      this.voices.push({ source: null, panner, gain, id: -1, clip: null });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem('interchange.mute', muted ? '1' : '0');
    } catch { /* storage unavailable; the setting simply does not persist */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  /** Where the player's ears are: the point the camera is looking at. */
  listenAt(x: number, y: number, z: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, ctx.currentTime, 0.05);
      l.positionY.setTargetAtTime(y + 6, ctx.currentTime, 0.05);
      l.positionZ.setTargetAtTime(z, ctx.currentTime, 0.05);
    } else {
      // Safari and older Chrome. Deprecated and still the only way there.
      (l as unknown as { setPosition: (a: number, b: number, c: number) => void })
        .setPosition(x, y + 6, z);
    }
  }

  /**
   * Hand the engine voices to the nearest vehicles.
   *
   * Nearest-first, and a voice already following a vehicle keeps it — swapping
   * voices between vehicles every frame would restart buffers and produce a
   * clicking mess. A voice whose vehicle has gone out of earshot fades to nothing
   * and becomes available.
   */
  engines(heard: Heard[], camX: number, camZ: number): void {
    const ctx = this.ctx;
    if (!ctx || this.voices.length === 0) return;

    const inRange = heard
      .map((h) => ({ h, d: Math.hypot(h.x - camX, h.z - camZ) }))
      .filter((e) => e.d < EARSHOT)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.voices.length);

    const claimed = new Set<number>();
    // Voices that already have one of the winners keep it.
    for (const v of this.voices) {
      const still = inRange.find((e) => e.h.id === v.id);
      if (still) {
        claimed.add(v.id);
        this.aim(v, still.h);
      } else {
        v.id = -1;
        v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      }
    }
    // Free voices take whatever is left, nearest first.
    for (const e of inRange) {
      if (claimed.has(e.h.id)) continue;
      const free = this.voices.find((v) => v.id === -1);
      if (!free) break;
      claimed.add(e.h.id);
      this.play(free, e.h);
    }
  }

  private clipFor(h: Heard): SoundName {
    if (h.engine === 'petrol') return 'engineCar';
    if (h.engine === 'tractor') return 'engineTractor';
    return 'engine';
  }

  private play(v: Voice, h: Heard): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const want = this.clipFor(h);
    const buffer = this.buffers.get(want);
    if (!buffer) {
      // No clip for this kind of vehicle. Leave the voice free rather than
      // claiming it, or a missing lorry sound would silence the cars too.
      return;
    }
    if (v.source) {
      try { v.source.stop(); } catch { /* already stopped */ }
      v.source.disconnect();
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    /*
     * A little detune per vehicle, from its id.
     *
     * Six voices playing one recording in unison is a drone rather than traffic.
     * A few per cent of playback rate is enough that two lorries never beat
     * against each other, and it is stable per vehicle so one does not wobble in
     * pitch as it drives.
     */
    const seed = ((h.id * 2654435761) >>> 0) / 4294967296;
    source.playbackRate.value = 0.92 + seed * 0.16;
    source.connect(v.panner);
    source.start(0, seed * buffer.duration);
    v.source = source;
    v.clip = want;
    v.id = h.id;
    this.aim(v, h);
    v.gain.gain.setTargetAtTime(0.55 * this.effectsLevel, ctx.currentTime, 0.35);
  }

  private aim(v: Voice, h: Heard): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (v.panner.positionX) {
      v.panner.positionX.setTargetAtTime(h.x, ctx.currentTime, 0.08);
      v.panner.positionZ.setTargetAtTime(h.z, ctx.currentTime, 0.08);
    } else {
      (v.panner as unknown as { setPosition: (a: number, b: number, c: number) => void })
        .setPosition(h.x, 0, h.z);
    }
    // A vehicle that changed kind — the pool reassigned an id — restarts.
    if (v.clip !== this.clipFor(h)) this.play(v, h);
  }

  /**
   * A horn, now and then, from somewhere there is traffic.
   *
   * Rate-limited hard. An occasional horn a few seconds apart reads as a road
   * with people on it; one every second reads as a traffic jam, and one every
   * frame reads as a fault. The gap is randomised so it does not become a
   * metronome.
   */
  maybeHorn(heard: Heard[], camX: number, camZ: number, now: number): void {
    const ctx = this.ctx;
    if (!ctx || heard.length === 0) return;
    if (now - this.lastHorn < this.hornGap) return;
    this.lastHorn = now;
    this.hornGap = 9000 + Math.random() * 26000;
    const near = heard.filter((h) => Math.hypot(h.x - camX, h.z - camZ) < EARSHOT * 0.7);
    if (near.length === 0) return;
    const pick = near[Math.floor(Math.random() * near.length)];
    this.oneShot('horn', 0.42, pick.x, pick.z);
  }

  private hornGap = 14000;

  /** A one-shot, positional if given a place and flat if not. */
  oneShot(name: SoundName, volume = 1, x?: number, z?: number): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!ctx || !this.master || !buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume * this.effectsLevel;
    if (x !== undefined && z !== undefined) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'linear';
      panner.refDistance = 2;
      panner.maxDistance = EARSHOT;
      if (panner.positionX) {
        panner.positionX.value = x;
        panner.positionZ.value = z;
      }
      source.connect(panner);
      panner.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(this.master);
    source.start();
    // Web Audio nodes are collected once they have finished and disconnected,
    // but only if nothing still references them — hence the explicit tidy.
    source.onended = () => { source.disconnect(); gain.disconnect(); };
  }

  /**
   * How loud the two halves of the mix are, 0..1 each.
   *
   * Separate because they answer different complaints. Music is a matter of
   * taste and gets turned off by people who are listening to something else;
   * engines and weather are the *game* making noise and get turned down by
   * people who want it quieter, not gone.
   */
  setLevels(music: number, effects: number): void {
    this.musicLevel = Math.max(0, Math.min(1, music));
    this.effectsLevel = Math.max(0, Math.min(1, effects));
  }

  /**
   * The two music tracks, crossfaded by how far into winter it is.
   *
   * Both loop from the moment there is any music at all, and only their gains
   * move. Starting the winter track when winter arrives would mean it always
   * begins at its first bar on the first cold day, which is a cue — and a piece
   * of background music that announces itself has stopped being background.
   *
   * `winter` is 0 in high summer and 1 in deep winter. The two gains are a
   * constant-power pair rather than a linear pair: two tracks at half volume
   * each are *quieter* than one at full, so a linear crossfade dips in the
   * middle and the district goes oddly silent every April.
   */
  music(winter: number, volume: number): void {
    const w = Math.max(0, Math.min(1, winter));
    // sin/cos of a quarter turn: the squares sum to one, so total power holds.
    const a = Math.cos(w * Math.PI / 2);
    const b = Math.sin(w * Math.PI / 2);
    this.ambientLevel('musicSummer', a * volume * this.musicLevel);
    this.ambientLevel('musicWinter', b * volume * this.musicLevel);
  }

  /**
   * An ambient loop at a given level, started on first use and left running.
   *
   * Started once and then only its gain changes, because restarting a loop
   * whenever the weather shifts would be audible as a seam every time — and
   * weather shifts continuously.
   */
  ambientLevel(name: SoundName, level: number): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!ctx || !this.master || !buffer) return;
    const music = name === 'musicSummer' || name === 'musicWinter';
    // Music arrives with `musicLevel` already in it, from `music()` above.
    if (!music) level *= this.effectsLevel;
    let entry = this.ambient.get(name);
    if (!entry) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.master);
      /*
       * Ambience starts anywhere in its clip; music starts at the beginning.
       *
       * A random offset into thirty seconds of wind is what stops two sessions
       * sounding identical, and nobody can tell where a hedge started. A random
       * offset into a composed piece drops you into the middle of a phrase,
       * which is the one thing a piece of music cannot survive.
       */
      const music = name === 'musicSummer' || name === 'musicWinter';
      source.start(0, music ? 0 : Math.random() * buffer.duration);
      entry = { gain, source };
      this.ambient.set(name, entry);
    }
    entry.gain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, level)), ctx.currentTime, 0.6,
    );
  }
}
