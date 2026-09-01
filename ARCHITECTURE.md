# Game runtime layout

`index.html` owns only markup, styling, third-party scripts, and the ordered runtime script list. Game code lives under `js/`.

| File | Responsibility |
| --- | --- |
| `core.js` | Renderer, scene, audio, shared state, broadphase helpers, and reusable effects |
| `destruction.js` | Structural cooking, fracture handoff, support integration, and voxel promotion |
| `world.js` | Map construction, voxel props, NPC creation, and pickups |
| `combat.js` | Weapons, rockets, explosions, hit detection, and structural damage |
| `climbing.js` | Surface sampling and traversal graph generation |
| `player-controller.js` | Input, player collision, traversal state, and movement |
| `player-character.js` | Character mesh, weapon rig, IK animation, and camera |
| `ui-effects.js` | HUD feedback and short-lived visual effects |
| `rigid-body.js` | Dynamic debris contacts, support, settling, and fracture release |
| `actors.js` | Enemy, dummy, pickup, and projectile updates |
| `game-loop.js` | Frame orchestration, profiling, and startup |

`voxel_physics.js` remains a standalone destruction engine loaded before these files.

## Load-order rule

The runtime currently uses ordered classic scripts so the refactor does not change game behavior. Files share the existing top-level bindings and must stay in the order listed in `index.html`. New subsystem code should go in the narrowest matching file; avoid adding gameplay code back to `index.html`.
