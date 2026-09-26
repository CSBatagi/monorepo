#!/usr/bin/env node
// Builds a `csdm video --config-file` JSON for a whole-match recording from a `csdm json` match export.
//
// It reproduces what an admin does by hand in CS Demo Manager's Video tab:
//   - one sequence starting at the end of round 1's freeze time (the app's default start tick);
//   - ending one second after the match's last kill, or after the last round's end when that is later
//     (bomb exploded or defused, time ran out); xplay stops recording right after the match, so the
//     demo's own last tick is not a usable end;
//   - "Generate cameras" with the killer's point of view two seconds before each kill;
//   - player voices on, X-ray off, every player's kills shown in the kill feed.
//
// The FFmpeg settings are written into the config (see ENCODER_PROFILES), so a render machine does not
// depend on what its CS Demo Manager settings.json happens to contain.
//
// No dependencies, so it runs with plain Node or with CS Demo Manager's bundled runtime:
//   set ELECTRON_RUN_AS_NODE=1 && cs-demo-manager.exe build-video-config.js ...

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WORLD_WEAPON_TYPE = 'world';

const DEFAULTS = {
  beforeKillSeconds: 2,
  afterEndSeconds: 1,
  width: 1920,
  height: 1080,
  framerate: 60,
  recordingSystem: 'HLAE',
  encoderSoftware: 'FFmpeg',
  showAssists: true,
  deathNoticesDuration: 5,
  encoder: 'x264',
};

// With HLAE, the video is encoded once, inside HLAE's FFmpeg pipe, as
// `-c:v <videoCodec> -pix_fmt yuv420p <outputParameters>`; CS Demo Manager then only copies that stream and
// adds the game audio encoded with audioCodec/audioBitrate. constantRateFactor is used only when
// outputParameters is empty. No raw frames are written to disk.
const COMMON_FFMPEG_SETTINGS = {
  customExecutableLocation: '', // CS Demo Manager's own FFmpeg
  audioCodec: 'aac',
  audioBitrate: 256,
  constantRateFactor: 23,
  videoContainer: 'mp4',
  inputParameters: '',
};

const ENCODER_PROFILES = {
  // The club's desktop settings (CPU encoding).
  x264: {
    ...COMMON_FFMPEG_SETTINGS,
    videoCodec: 'libx264',
    outputParameters: '-pix_fmt yuv420p -profile:v high -level 4.0 -preset medium -movflags +faststart -ac 2 -ar 48000 ',
  },
  // Same container and audio, encoded on the NVIDIA GPU so the render machine's CPU stays free for CS2.
  nvenc: {
    ...COMMON_FFMPEG_SETTINGS,
    videoCodec: 'h264_nvenc',
    // CQ 24 with a 16 Mbit/s cap: close to YouTube's recommended 1080p60 upload bitrate.
    outputParameters: '-preset p5 -tune hq -rc vbr -cq 24 -b:v 0 -maxrate 16M -bufsize 32M -profile:v high',
  },
};

function round(value) {
  return Math.round(value);
}

// Returns { startTick, endTick, playerCameras, playersOptions } for the match.
function buildWholeMatchSequence(match, options = {}) {
  const beforeKillSeconds = options.beforeKillSeconds ?? DEFAULTS.beforeKillSeconds;
  const afterEndSeconds = options.afterEndSeconds ?? DEFAULTS.afterEndSeconds;
  const tickrate = round(match.tickrate);
  if (!Number.isFinite(tickrate) || tickrate <= 0) {
    throw new Error(`Invalid tickrate in match export: ${match.tickrate}`);
  }

  const allRounds = [...(match.rounds ?? [])].sort((a, b) => a.number - b.number);
  // Optionally only a range of rounds (previews and quick tests); the end rule is unchanged when the range
  // reaches the last round.
  let rounds = allRounds;
  if (options.roundRange) {
    const { from, to = allRounds.length } = options.roundRange;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > allRounds.length) {
      throw new Error(`The match has ${allRounds.length} rounds, cannot record rounds ${from}-${to}`);
    }
    rounds = allRounds.slice(from - 1, to);
  }
  const firstRound = rounds[0];
  const lastRound = rounds[rounds.length - 1];
  const isPartial = rounds !== allRounds;
  const kills = [...(match.kills ?? [])]
    .filter((kill) => !isPartial || (kill.tick >= firstRound.freezetimeEndTick && kill.tick <= lastRound.endTick))
    .sort((a, b) => a.tick - b.tick);
  if (kills.length === 0) {
    throw new Error('The match has no kills, nothing to record');
  }

  const startTick = firstRound ? firstRound.freezetimeEndTick : tickrate;

  const lastKillTick = kills[kills.length - 1].tick;
  const lastRoundEndTick = lastRound ? lastRound.endTick : 0;
  // The generated actions file quits the game 64 ticks after the end tick; that command must fall inside
  // the demo or CS2 never exits and the CLI waits forever.
  const lastUsableTick = match.tickCount - 64 - 2;
  let endTick = Math.min(Math.max(lastKillTick, lastRoundEndTick) + afterEndSeconds * tickrate, lastUsableTick);
  // Optional length cap (smoke tests after a CS2, HLAE or CS Demo Manager update).
  if (options.maxSeconds !== undefined) {
    endTick = Math.min(endTick, startTick + round(options.maxSeconds * tickrate));
  }
  if (endTick <= startTick) {
    throw new Error(`End tick ${endTick} is not after start tick ${startTick}`);
  }

  const playerCameras = [];
  for (const kill of kills) {
    if (kill.tick < startTick || kill.tick > endTick) {
      continue;
    }
    if (kill.weaponType === WORLD_WEAPON_TYPE || !kill.killerSteamId || kill.killerSteamId === '0') {
      continue;
    }
    playerCameras.push({
      tick: Math.max(startTick, round(kill.tick - beforeKillSeconds * tickrate)),
      playerSteamId: kill.killerSteamId,
      playerName: kill.killerName,
    });
  }

  // CS Demo Manager writes each name into `mirv_replace_name ... "<name>"`, and CS2 has no way to escape a
  // double quote there, so a name like `here comes the "D"` would break the command.
  const playersOptions = (match.players ?? []).map((player) => ({
    steamId: player.steamId,
    playerName: String(player.name ?? '').replace(/"/g, "'"),
    showKill: true,
    highlightKill: false,
    isVoiceEnabled: true,
  }));

  return { startTick, endTick, playerCameras, playersOptions, lastKillTick, lastRoundEndTick };
}

function buildVideoConfig(match, options) {
  const sequence = buildWholeMatchSequence(match, options);
  const encoder = options.encoder ?? DEFAULTS.encoder;
  const ffmpegSettings = ENCODER_PROFILES[encoder];
  if (!ffmpegSettings) {
    throw new Error(`Unknown encoder "${encoder}", expected one of: ${Object.keys(ENCODER_PROFILES).join(', ')}`);
  }
  return {
    demoPath: options.demoPath,
    outputFolderPath: options.outputFolderPath,
    recordingSystem: options.recordingSystem ?? DEFAULTS.recordingSystem,
    recordingOutput: 'video',
    encoderSoftware: options.encoderSoftware ?? DEFAULTS.encoderSoftware,
    framerate: options.framerate ?? DEFAULTS.framerate,
    width: options.width ?? DEFAULTS.width,
    height: options.height ?? DEFAULTS.height,
    closeGameAfterRecording: true,
    concatenateSequences: true,
    trueView: false,
    ffmpegSettings: { ...ffmpegSettings },
    ...(options.outputFileName ? { outputFileName: options.outputFileName } : {}),
    sequences: [
      {
        number: 1,
        startTick: sequence.startTick,
        endTick: sequence.endTick,
        showXRay: false,
        showAssists: DEFAULTS.showAssists,
        showOnlyDeathNotices: false,
        deathNoticesDuration: DEFAULTS.deathNoticesDuration,
        recordAudio: true,
        playerVoicesEnabled: true,
        playersOptions: sequence.playersOptions,
        playerCameras: sequence.playerCameras,
        cameras: [],
      },
    ],
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    args[key] = value;
    i++;
  }
  return args;
}

function numberArg(args, key) {
  if (args[key] === undefined) {
    return undefined;
  }
  const value = Number(args[key]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${key} must be a non-negative number`);
  }
  return value;
}

// "2" = rounds 1-2, "20-24" = rounds 20-24, "20-" = round 20 to the end.
function roundRangeArg(value) {
  if (value === undefined) {
    return undefined;
  }
  const match = /^(\d+)(?:-(\d*))?$/.exec(value);
  if (!match) {
    throw new Error('--rounds must look like 2, 20-24 or 20-');
  }
  if (match[2] === undefined) {
    return { from: 1, to: Number(match[1]) };
  }
  return { from: Number(match[1]), to: match[2] === '' ? undefined : Number(match[2]) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [matchJsonPath] = args._;
  if (!matchJsonPath || !args.demo || !args.output) {
    console.error(
      'Usage: build-video-config.js <match.json> --demo <demo.dem> --output <folder> [--out config.json]\n' +
        '       [--encoder x264|nvenc] [--rounds N | A-B | A-] [--width 1920] [--height 1080] [--framerate 60]\n' +
        '       [--max-seconds S] [--before-kill 2] [--after-end 1] [--file-name name]',
    );
    process.exit(2);
  }

  const match = JSON.parse(fs.readFileSync(matchJsonPath, 'utf8'));
  const config = buildVideoConfig(match, {
    demoPath: path.resolve(args.demo),
    outputFolderPath: path.resolve(args.output),
    encoder: args.encoder,
    roundRange: roundRangeArg(args.rounds),
    width: numberArg(args, 'width'),
    height: numberArg(args, 'height'),
    framerate: numberArg(args, 'framerate'),
    maxSeconds: numberArg(args, 'max-seconds'),
    beforeKillSeconds: numberArg(args, 'before-kill'),
    afterEndSeconds: numberArg(args, 'after-end'),
    outputFileName: args['file-name'],
  });

  const json = JSON.stringify(config, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json);
  } else {
    process.stdout.write(json + '\n');
  }

  const [sequence] = config.sequences;
  const seconds = ((sequence.endTick - sequence.startTick) / match.tickrate).toFixed(1);
  console.error(
    `${match.mapName}: ticks ${sequence.startTick}-${sequence.endTick} (${seconds}s), ` +
      `${sequence.playerCameras.length} camera switches, ${sequence.playersOptions.length} players, ` +
      `${config.ffmpegSettings.videoCodec}`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { buildWholeMatchSequence, buildVideoConfig, roundRangeArg, ENCODER_PROFILES };
