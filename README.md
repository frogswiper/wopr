# W.O.P.R. // SHALL WE PLAY A GAME?

A 1983 NORAD war-room terminal for Ollama, styled after *WarGames*. It boots on the big board,
logs on as **JOSHUA**, and **speaks** with a flat, word-by-word synthesizer voice. The first thing it
says is *"SHALL WE PLAY A GAME?"*. Behind the 1983 front end, any local or Ollama cloud model does
the talking. By default that is the newest **GLM cloud model**.

## Install on Linux / macOS (one line)

```bash
curl -fsSL https://raw.githubusercontent.com/frogswiper/wopr/main/install.sh | bash
```

The installer:

1. installs **Ollama** if it isn't present (official `ollama.com` installer)
2. starts the Ollama server if it isn't running
3. runs `ollama signin`. If a link is shown, open it, approve, and the install continues
4. finds the **newest GLM cloud model** on ollama.com (currently `glm-5.3:cloud`) and pulls it
5. sets up the **espeak-ng** voice synthesizer. Most Linux desktops already have its library, so the
   installer only unpacks the small command-line tool, with no sudo. Otherwise it asks your package
   manager. macOS uses the built-in `say` instead
6. uses the system Node.js 18+ if there is one; otherwise it downloads a checksum-verified Node 22
   into `~/.local/share/wopr/node` (no sudo)
7. installs W.O.P.R. to `~/.local/share/wopr/app`, adds the `wopr` command and a menu entry, then launches it

Options (set them before `bash`, e.g. `curl … | WOPR_MODEL=glm-5.2:cloud bash`):

| variable | default | |
|---|---|---|
| `WOPR_MODEL` | newest `glm-*:cloud` | model to pull and select at start |
| `WOPR_PORT` | `1983` | local web port (bound to 127.0.0.1 only) |
| `WOPR_NO_ESPEAK` | — | `1` = don't install espeak-ng (the browser's speech is used instead) |
| `WOPR_NO_LAUNCH` | — | `1` = don't launch at the end |

Settings are saved in `~/.config/wopr/wopr.env`. Run the one-liner again to update.

## Install on Windows 10 / 11

Open **PowerShell** (a normal window, not as administrator) and run:

```powershell
irm https://raw.githubusercontent.com/frogswiper/wopr/main/install.ps1 | iex
```

The Windows installer:

1. installs **Ollama** if it isn't present (winget, or the official `OllamaSetup.exe`)
2. starts the Ollama server if it isn't running
3. runs `ollama signin`. If a link is shown, open it, approve, and the install continues
4. finds the **newest GLM cloud model** on ollama.com and pulls it
5. sets up **espeak-ng** for Joshua's voice. It unpacks the official Windows package without admin rights; only if that fails does it install it normally (one Windows permission prompt). Without it, Joshua uses Windows' own speech voices
6. uses Node.js 18+ if it is installed; otherwise it downloads a checksum-verified Node 22
   into `%LOCALAPPDATA%\wopr\node` (no admin)
7. installs W.O.P.R. to `%LOCALAPPDATA%\wopr\app`, saves settings to `%APPDATA%\wopr\wopr.env`, adds
   **Start Menu and desktop shortcuts** and the `wopr` command (new terminals), then launches it

It opens full screen in its own **Edge** kiosk window (Chrome or Brave if Edge is missing), with
autoplay allowed. Esc exits; Alt+F4 also works. Set options the same way as on Linux, e.g.
`$env:WOPR_MODEL = 'glm-5.2:cloud'; irm … | iex`. Run the one-liner again to update.

## Run

    wopr                # starts server.js if needed and opens W.O.P.R. full screen

`wopr` opens its own **full-screen kiosk window** with a dedicated Firefox or Chromium/Chrome profile.
Audio is allowed without a click, so Joshua can speak first.
**Press Esc to log off.** Esc stops a reply or a speech first. When idle, it shuts down W.O.P.R.
and closes the window. `/logoff` does the same, and Alt+F4 also works.
`WOPR_BROWSER=default wopr` opens a normal browser tab instead. In a normal tab the voice
starts after your first key press.

## What's inside

- **Boot**: the NORAD big board, then the system log and a dial-up to the inference node. Then
  `LOGON: JOSHUA`, and *"SHALL WE PLAY A GAME?"*, typed and spoken.
- **Terminal**: David's blue IMSAI screen. Every reply streams in upper case and is read aloud a
  sentence at a time.
- **Voice synthesizer**: espeak-ng (or `say` on macOS) is run by the local server. In the browser it
  passes through a small-speaker filter, a ring modulator and a comb filter. You can set the voice,
  rate, pitch, intonation, word gap and amount of "machine". Low intonation and a gap between
  words give the flat, stilted delivery of the film. Without espeak-ng it falls back to the
  browser's own speech.
- **Big board**: a live NORAD map with the US in blue, the USSR in red and the rest of the world in
  green. W.O.P.R. runs war simulations on it while it thinks. Click it to watch full screen.
- **W.O.P.R. core**: the cabinet's indicator lamps. They blink harder while it thinks and talks.
- **DEFCON** readiness display, plus panels for model, voice, prime directive, parameters and
  telemetry, and game logs saved in the browser.

### Games

Type `LIST GAMES`, or click LIST GAMES.

- **GLOBAL THERMONUCLEAR WAR**: pick a side and list targets. The war then plays out full screen on
  the big board, followed by a montage of scenarios, every one ending in *WINNER: NONE*.
- **TIC-TAC-TOE**: one player against a perfect opponent. With `NUMBER OF PLAYERS: 0` (or
  `/learn`), W.O.P.R. plays itself until it learns something.
- **Everything else** (chess, poker, Falken's Maze, …) is played by the model in plain text.

Type `/help` in the terminal for every command (`/play`, `/voice`, `/say`, `/name`, `/defcon`, …).
Change what Joshua calls you with `/name` or the OPERATOR field; the default is PROFESSOR FALKEN.

## Manual / development

    git clone https://github.com/frogswiper/wopr && cd wopr
    node server.js      # needs Node 18+, Ollama on 127.0.0.1:11434; espeak-ng optional

Env vars: `WOPR_PORT` (1983), `WOPR_BIND` (127.0.0.1), `OLLAMA_URL` (http://127.0.0.1:11434),
`WOPR_MODEL` (glm-5.3:cloud), `WOPR_TTS` (path to espeak-ng / espeak / say, or `off`).

- `server.js` has no dependencies. It serves `public/`, runs the speech synthesizer for
  `POST /wopr/say`, and proxies only these Ollama endpoints: version, tags, ps, show, chat,
  generate, pull. Delete, create and push are blocked. State-changing requests need an
  `X-Wopr` header and a same-origin request.
- Game logs and settings are stored in the browser's localStorage (`wopr.v1`).
- `public/worldmap.js` is generated from Natural Earth 1:110m data (public domain) by
  `tools/build-map.py`.
- Fonts: VT323 and Share Tech Mono, both SIL Open Font License (see `public/fonts/`).

---
Fan project. Not affiliated with or endorsed by MGM or the makers of *WarGames* (1983).
