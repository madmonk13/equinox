# Equinox

A browser-based strategy-and-arena game of Light against Dark.
Chess-like board turns where every capture becomes a real-time duel.

## Run

Open `index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8137
```

The page loads `js/bundle.js`, a single classic script generated from the ES modules in `js/`
(browsers refuse to load modules from `file://`). After editing anything in `js/`, rebuild:

```bash
node build.mjs
```

## Features

- 9×9 board with fixed light/dark squares and a cycling **luminance** band that grants battle bonuses
- Five **power points** (heal pieces, block spells, capture all five to win)
- 16 piece types with ground / flying / teleport movement and distinct arena attacks
  - **Light:** Knight, Archer, Valkyrie (returning spear), Giant (boulder + stomp), Cavalier (lance charge, shield),
    Griffin (dive over pillars), Phoenix (invulnerable fire burst), Archmage
  - **Dark:** Orc, Goblin (rapid javelins), Troll (regenerates), Banshee (slowing wail), Manticore (spike volley),
    Doppelgänger (copies its foe), Dragon (flame spray), Necromancer (life-draining bolt)
- Seven once-per-game spells: Teleport, Heal, Shift Time, Exchange, Summon Elemental (Raise Wraith for Dark), Revive, Imprison
- Computer opponent (Easy / Normal / Hard) for both board strategy and arena combat
- Two-player hotseat (Light: WASD + Space, Dark: Arrows + Enter)
- Saves automatically at the end of every turn (browser local storage); **Continue game** on the menu resumes it
- **How to play → Pieces** guide: each piece's stats, board reach, and arena attack drawn to scale
- Monochrome SVG icons (`js/icons.js`, sources in [CREDITS.md](CREDITS.md)) and synthesized sound effects

## Code map

| File | Purpose |
| --- | --- |
| `js/data.js` | Board layout, piece stats, spells |
| `js/icons.js` | Monochrome glyphs for pieces, spells and UI |
| `js/rules.js` | Movement, luminance cycle, spell targeting, victory |
| `js/combat.js` | Real-time arena (canvas) |
| `js/ai.js` | Board AI and combat AI |
| `js/guide.js` | Pieces guide in How to play, generated from the piece data |
| `js/main.js` | UI controller, turn flow and saving; `GAME_TITLE` lives here |
| `js/audio.js` | Sound effects |

